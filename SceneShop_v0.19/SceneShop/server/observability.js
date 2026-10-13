const crypto = require('crypto');
const os = require('os');
const { AsyncLocalStorage } = require('async_hooks');

const storage = new AsyncLocalStorage();

function randomHex(bytes) {
  return crypto.randomBytes(bytes).toString('hex');
}

function parseTraceparent(value) {
  const raw = String(value || '').trim().toLowerCase();
  const m = /^([0-9a-f]{2})-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/.exec(raw);
  if (!m || m[1] === 'ff') return null;
  if (/^0{32}$/.test(m[2]) || /^0{16}$/.test(m[3])) return null;
  return { version: m[1], traceId: m[2], parentSpanId: m[3], flags: m[4] };
}

function createTraceContext({ requestId = null, traceparent = null, source = 'http' } = {}) {
  const parent = parseTraceparent(traceparent);
  const traceId = parent ? parent.traceId : randomHex(16);
  const spanId = randomHex(8);
  const flags = parent ? parent.flags : '01';
  return {
    requestId: requestId || crypto.randomUUID(),
    traceId,
    spanId,
    parentSpanId: parent ? parent.parentSpanId : null,
    traceparent: `00-${traceId}-${spanId}-${flags}`,
    sampled: (parseInt(flags, 16) & 1) === 1,
    source,
    startedAt: Date.now(),
  };
}

function labelKey(labels = {}) {
  return Object.entries(labels)
    .filter(([, v]) => v !== undefined && v !== null)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${String(v)}`)
    .join(',');
}

function metricKey(name, labels) {
  const suffix = labelKey(labels);
  return suffix ? `${name}{${suffix}}` : name;
}

class MetricsRegistry {
  constructor({ clock = () => Date.now() } = {}) {
    this.clock = clock;
    this.startedAt = clock();
    this.counters = new Map();
    this.gauges = new Map();
    this.histograms = new Map();
  }

  inc(name, labels = {}, value = 1) {
    const key = metricKey(name, labels);
    this.counters.set(key, Number(this.counters.get(key) || 0) + Number(value || 0));
  }

  set(name, value, labels = {}) {
    this.gauges.set(metricKey(name, labels), Number(value || 0));
  }

  observe(name, value, labels = {}) {
    const key = metricKey(name, labels);
    const n = Number(value || 0);
    const cur = this.histograms.get(key) || { count: 0, sum: 0, min: null, max: null };
    cur.count += 1;
    cur.sum += n;
    cur.min = cur.min == null ? n : Math.min(cur.min, n);
    cur.max = cur.max == null ? n : Math.max(cur.max, n);
    this.histograms.set(key, cur);
  }

  snapshot() {
    const histograms = {};
    for (const [key, v] of this.histograms) {
      histograms[key] = { ...v, avg: v.count ? v.sum / v.count : 0 };
    }
    return {
      startedAt: this.startedAt,
      uptimeMs: Math.max(0, this.clock() - this.startedAt),
      process: {
        pid: process.pid,
        hostname: os.hostname(),
        node: process.version,
        rssBytes: process.memoryUsage().rss,
        heapUsedBytes: process.memoryUsage().heapUsed,
      },
      counters: Object.fromEntries(this.counters),
      gauges: Object.fromEntries(this.gauges),
      histograms,
    };
  }

  reset() {
    this.startedAt = this.clock();
    this.counters.clear();
    this.gauges.clear();
    this.histograms.clear();
  }
}

const metrics = new MetricsRegistry();

function currentContext() {
  return storage.getStore() || null;
}

function runWithContext(context, fn) {
  return storage.run(context, fn);
}

function httpMiddleware(req, res, next) {
  const context = createTraceContext({
    requestId: req.requestId,
    traceparent: req.headers && req.headers.traceparent,
    source: 'http',
  });
  req.traceId = context.traceId;
  req.spanId = context.spanId;
  res.setHeader('Traceparent', context.traceparent);
  res.setHeader('X-SceneShop-Trace-Id', context.traceId);
  const start = process.hrtime.bigint();
  let recorded = false;
  const record = () => {
    if (recorded) return;
    recorded = true;
    const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
    metrics.inc('http_requests_total', { method: req.method, status: res.statusCode });
    metrics.observe('http_request_duration_ms', durationMs, { method: req.method, status: res.statusCode });
  };
  res.once('finish', record);
  res.once('close', record);
  storage.run(context, next);
}

function structuredLog(level, message, fields = {}) {
  const ctx = currentContext();
  const row = {
    ts: new Date().toISOString(),
    level: String(level || 'info').toLowerCase(),
    message: String(message || ''),
    ...(ctx ? { requestId: ctx.requestId, traceId: ctx.traceId, spanId: ctx.spanId } : {}),
    ...fields,
  };
  const line = JSON.stringify(row);
  if (row.level === 'error') console.error(line);
  else if (row.level === 'warn') console.warn(line);
  else console.log(line);
  return row;
}

module.exports = {
  parseTraceparent,
  createTraceContext,
  MetricsRegistry,
  metrics,
  currentContext,
  runWithContext,
  httpMiddleware,
  structuredLog,
};
