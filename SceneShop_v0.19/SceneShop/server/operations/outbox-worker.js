const os = require('os');
const crypto = require('crypto');
const pkg = require('../../package.json');
const { metrics, createTraceContext, runWithContext, structuredLog } = require('../observability');

function calculateBackoff(attempt, { baseMs = 1000, maxMs = 60000 } = {}) {
  const n = Math.max(1, Number(attempt) || 1);
  const base = Math.max(1, Number(baseMs) || 1000);
  const max = Math.max(base, Number(maxMs) || 60000);
  return Math.min(max, base * (2 ** Math.min(20, n - 1)));
}

class OutboxWorker {
  constructor({
    repository,
    handler,
    workerId = `${os.hostname()}:${process.pid}:${crypto.randomUUID().slice(0, 8)}`,
    batchSize = 20,
    leaseMs = 30000,
    pollMs = 1000,
    maxAttempts = 8,
    baseBackoffMs = 1000,
    maxBackoffMs = 60000,
    clock = () => Date.now(),
  } = {}) {
    if (!repository) throw new TypeError('OutboxWorker requer repository.');
    if (typeof handler !== 'function') throw new TypeError('OutboxWorker requer handler(event).');
    this.repository = repository;
    this.handler = handler;
    this.workerId = workerId;
    this.batchSize = Math.max(1, Math.min(200, Number(batchSize) || 20));
    this.leaseMs = Math.max(1000, Number(leaseMs) || 30000);
    this.pollMs = Math.max(100, Number(pollMs) || 1000);
    this.maxAttempts = Math.max(1, Number(maxAttempts) || 8);
    this.baseBackoffMs = Math.max(1, Number(baseBackoffMs) || 1000);
    this.maxBackoffMs = Math.max(this.baseBackoffMs, Number(maxBackoffMs) || 60000);
    this.clock = clock;
    this.running = false;
    this.timer = null;
    this.inFlight = null;
    this.startedAt = null;
    this.lastTickAt = null;
    this.lastError = null;
  }

  async tick() {
    const tickStarted = this.clock();
    this.lastTickAt = tickStarted;
    await this.repository.heartbeat({ host: os.hostname(), pid: process.pid, version: pkg.version, batchSize: this.batchSize });
    const events = await this.repository.claimBatch({ limit: this.batchSize, leaseMs: this.leaseMs });
    metrics.set('outbox_worker_last_batch_size', events.length, { worker: this.workerId });
    const result = { claimed: events.length, published: 0, failed: 0, deadLettered: 0 };
    for (const event of events) {
      const context = createTraceContext({ requestId: `outbox:${event.id}`, source: 'outbox' });
      await runWithContext(context, async () => {
        const started = this.clock();
        try {
          await this.handler(event, context);
          await this.repository.ack(event.id);
          result.published += 1;
          metrics.inc('outbox_events_published_total', { topic: event.topic });
          metrics.observe('outbox_event_handler_duration_ms', this.clock() - started, { topic: event.topic, outcome: 'ok' });
        } catch (err) {
          const delayMs = calculateBackoff(event.attempts, { baseMs: this.baseBackoffMs, maxMs: this.maxBackoffMs });
          const failed = await this.repository.fail(event.id, err, { delayMs, maxAttempts: this.maxAttempts });
          result.failed += 1;
          if (failed && failed.deadLetteredAt) result.deadLettered += 1;
          metrics.inc('outbox_events_failed_total', { topic: event.topic });
          metrics.observe('outbox_event_handler_duration_ms', this.clock() - started, { topic: event.topic, outcome: 'error' });
          structuredLog('warn', 'outbox_delivery_failed', { eventId: event.id, topic: event.topic, attempt: event.attempts, delayMs, error: String(err && err.message || err) });
        }
      });
    }
    metrics.observe('outbox_worker_tick_duration_ms', this.clock() - tickStarted, { worker: this.workerId });
    return result;
  }

  async _loop() {
    if (!this.running) return;
    try {
      this.inFlight = this.tick();
      await this.inFlight;
      this.lastError = null;
    } catch (err) {
      this.lastError = String(err && err.message || err);
      structuredLog('error', 'outbox_worker_tick_failed', { workerId: this.workerId, error: this.lastError });
    } finally {
      this.inFlight = null;
      if (this.running) this.timer = setTimeout(() => this._loop(), this.pollMs);
    }
  }

  start() {
    if (this.running) return false;
    this.running = true;
    this.startedAt = this.clock();
    this._loop();
    return true;
  }

  async stop() {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.inFlight) await this.inFlight.catch(() => {});
  }

  status() {
    return {
      workerId: this.workerId,
      running: this.running,
      startedAt: this.startedAt,
      lastTickAt: this.lastTickAt,
      lastError: this.lastError,
      batchSize: this.batchSize,
      pollMs: this.pollMs,
      maxAttempts: this.maxAttempts,
    };
  }
}

module.exports = { OutboxWorker, calculateBackoff };
