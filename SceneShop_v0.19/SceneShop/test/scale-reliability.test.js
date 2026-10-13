const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { calculateBackoff, OutboxWorker } = require('../server/operations/outbox-worker');
const { parseTraceparent, createTraceContext, MetricsRegistry } = require('../server/observability');

class FakeOutboxRepository {
  constructor(events = []) {
    this.events = events.map((x) => ({ attempts: 1, ...x }));
    this.acked = [];
    this.failed = [];
    this.heartbeats = [];
  }
  async heartbeat(meta) { this.heartbeats.push(meta); return true; }
  async claimBatch() { const out = this.events; this.events = []; return out; }
  async ack(id) { this.acked.push(id); return { id, publishedAt: Date.now() }; }
  async fail(id, err, opts) {
    const row = { id, error: String(err.message || err), opts, deadLetteredAt: opts.maxAttempts <= 1 ? Date.now() : null };
    this.failed.push(row);
    return row;
  }
}

test('scale/reliability: exponential retry backoff is bounded', () => {
  assert.equal(calculateBackoff(1, { baseMs: 1000, maxMs: 10000 }), 1000);
  assert.equal(calculateBackoff(2, { baseMs: 1000, maxMs: 10000 }), 2000);
  assert.equal(calculateBackoff(4, { baseMs: 1000, maxMs: 10000 }), 8000);
  assert.equal(calculateBackoff(8, { baseMs: 1000, maxMs: 10000 }), 10000);
});

test('scale/reliability: worker ACKs successful events and retries failures', async () => {
  const repo = new FakeOutboxRepository([
    { id: 1, topic: 'commerce.ok', payload: {} },
    { id: 2, topic: 'commerce.fail', payload: {} },
  ]);
  const worker = new OutboxWorker({
    repository: repo,
    handler: async (event) => { if (event.id === 2) throw new Error('destination_down'); },
    workerId: 'worker-test',
    baseBackoffMs: 500,
    maxBackoffMs: 5000,
    maxAttempts: 4,
    clock: (() => { let n = 1000; return () => n += 5; })(),
  });
  const result = await worker.tick();
  assert.deepEqual(result, { claimed: 2, published: 1, failed: 1, deadLettered: 0 });
  assert.deepEqual(repo.acked, [1]);
  assert.equal(repo.failed.length, 1);
  assert.equal(repo.failed[0].id, 2);
  assert.equal(repo.failed[0].opts.delayMs, 500);
  assert.equal(repo.heartbeats.length, 1);
});

test('scale/reliability: worker marks terminal failure as dead letter', async () => {
  const repo = new FakeOutboxRepository([{ id: 9, topic: 'test', attempts: 1 }]);
  const worker = new OutboxWorker({ repository: repo, handler: async () => { throw new Error('boom'); }, workerId: 'dead-test', maxAttempts: 1 });
  const result = await worker.tick();
  assert.equal(result.deadLettered, 1);
  assert.ok(repo.failed[0].deadLetteredAt);
});

test('observability: W3C traceparent continues trace with a new span', () => {
  const inbound = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01';
  const parsed = parseTraceparent(inbound);
  assert.equal(parsed.traceId, '4bf92f3577b34da6a3ce929d0e0e4736');
  const ctx = createTraceContext({ requestId: 'request-123', traceparent: inbound });
  assert.equal(ctx.traceId, parsed.traceId);
  assert.equal(ctx.parentSpanId, '00f067aa0ba902b7');
  assert.match(ctx.spanId, /^[a-f0-9]{16}$/);
  assert.notEqual(ctx.spanId, ctx.parentSpanId);
  assert.match(ctx.traceparent, /^00-4bf92f3577b34da6a3ce929d0e0e4736-[a-f0-9]{16}-01$/);
});

test('observability: metrics snapshot exposes counters, gauges and latency summaries', () => {
  let now = 1000;
  const m = new MetricsRegistry({ clock: () => now });
  m.inc('requests', { status: 200 });
  m.inc('requests', { status: 200 }, 2);
  m.set('queue_depth', 7);
  m.observe('latency_ms', 10);
  m.observe('latency_ms', 30);
  now = 1500;
  const s = m.snapshot();
  assert.equal(s.counters['requests{status=200}'], 3);
  assert.equal(s.gauges.queue_depth, 7);
  assert.deepEqual(s.histograms.latency_ms, { count: 2, sum: 40, min: 10, max: 30, avg: 20 });
  assert.equal(s.uptimeMs, 500);
});

test('scale/reliability migration adds leased queue and worker heartbeat authority', () => {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'server', 'data', 'migrations', '0026_scale_reliability_foundation.sql'), 'utf8');
  assert.match(sql, /attempts INTEGER NOT NULL DEFAULT 0/i);
  assert.match(sql, /dead_lettered_at TIMESTAMPTZ/i);
  assert.match(sql, /sceneshop_worker_heartbeats/i);
  const source = fs.readFileSync(path.join(__dirname, '..', 'server', 'operations', 'outbox-postgres.js'), 'utf8');
  assert.match(source, /FOR UPDATE SKIP LOCKED/i);
  assert.match(source, /locked_by/i);
});
