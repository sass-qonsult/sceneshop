const os = require('os');
const crypto = require('crypto');
const pkg = require('../../package.json');
const { PostgresOutboxRepository } = require('./outbox-postgres');

function createOperationsRuntime({ store } = {}) {
  if (!store) throw new TypeError('createOperationsRuntime requer store.');
  let repository = null;
  const workerId = `${os.hostname()}:${process.pid}:web:${crypto.randomUUID().slice(0, 8)}`;

  return {
    async init() {
      if (store.backendKind() === 'postgres') repository = new PostgresOutboxRepository({ store, workerId });
      return this.health();
    },
    async health() {
      if (!repository) return { ok: true, backend: 'disabled', reason: `data_backend_${store.backendKind()}` };
      try {
        const queue = await repository.health({ staleWorkerMs: Number(process.env.OUTBOX_WORKER_STALE_MS || 120000) });
        return { ok: true, backend: 'postgres', queue };
      } catch (err) {
        return { ok: false, backend: 'postgres', error: err.message };
      }
    },
    async heartbeat(metadata = {}) {
      if (!repository) return false;
      return repository.heartbeat({ host: os.hostname(), pid: process.pid, version: pkg.version, role: 'web', ...metadata });
    },
    async close() {},
  };
}

module.exports = { createOperationsRuntime };
