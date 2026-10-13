#!/usr/bin/env node
const os = require('os');
const crypto = require('crypto');
const store = require('../server/store');
const { PostgresOutboxRepository } = require('../server/operations/outbox-postgres');
const { OutboxWorker } = require('../server/operations/outbox-worker');
const { createHttpPublisher } = require('../server/operations/publishers');
const { structuredLog } = require('../server/observability');

async function main() {
  if ((process.env.DATA_BACKEND || '').toLowerCase() !== 'postgres') {
    throw new Error('Outbox worker exige DATA_BACKEND=postgres.');
  }
  const url = process.env.OUTBOX_WEBHOOK_URL;
  if (!url) throw new Error('OUTBOX_WEBHOOK_URL é obrigatório para o worker de entrega.');
  await store.init();
  const workerId = process.env.OUTBOX_WORKER_ID || `${os.hostname()}:${process.pid}:${crypto.randomUUID().slice(0, 8)}`;
  const repository = new PostgresOutboxRepository({ store, workerId });
  const publisher = createHttpPublisher({
    url,
    secret: process.env.OUTBOX_WEBHOOK_SECRET || '',
    timeoutMs: Number(process.env.OUTBOX_WEBHOOK_TIMEOUT_MS || 10000),
  });
  const worker = new OutboxWorker({
    repository,
    handler: publisher,
    workerId,
    batchSize: Number(process.env.OUTBOX_BATCH_SIZE || 20),
    leaseMs: Number(process.env.OUTBOX_LEASE_MS || 30000),
    pollMs: Number(process.env.OUTBOX_POLL_MS || 1000),
    maxAttempts: Number(process.env.OUTBOX_MAX_ATTEMPTS || 8),
    baseBackoffMs: Number(process.env.OUTBOX_BACKOFF_BASE_MS || 1000),
    maxBackoffMs: Number(process.env.OUTBOX_BACKOFF_MAX_MS || 60000),
  });
  worker.start();
  structuredLog('info', 'outbox_worker_started', { workerId, destination: new URL(url).origin, batchSize: worker.batchSize });

  const shutdown = async (signal) => {
    structuredLog('info', 'outbox_worker_stopping', { workerId, signal });
    await worker.stop();
    await store.close();
    process.exit(0);
  };
  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  structuredLog('error', 'outbox_worker_start_failed', { error: err.stack || err.message });
  process.exitCode = 1;
});
