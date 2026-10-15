function requireSocketRedis() {
  try { return require('@socket.io/redis-adapter'); }
  catch (err) {
    const e = new Error("Realtime distribuído requer '@socket.io/redis-adapter'. Instale as dependências antes de usar SESSION_BACKEND=redis.");
    e.cause = err; throw e;
  }
}

function requireRedis() {
  try { return require('redis'); }
  catch (err) {
    const e = new Error("Realtime distribuído requer o pacote 'redis'.");
    e.cause = err; throw e;
  }
}

async function configureSocketRedis(io, { url, enabled }) {
  if (!enabled) return { kind: 'memory', close: async () => {}, health: async () => ({ ok: true, backend: 'memory' }) };
  if (!url) throw new Error('REDIS_URL é obrigatório para o adapter Socket.IO Redis.');
  const { createAdapter } = requireSocketRedis();
  const { createClient } = requireRedis();
  const pubClient = createClient({ url });
  const subClient = pubClient.duplicate();
  pubClient.on('error', (err) => console.error('Socket Redis pub error:', err.message));
  subClient.on('error', (err) => console.error('Socket Redis sub error:', err.message));
  await Promise.all([pubClient.connect(), subClient.connect()]);
  io.adapter(createAdapter(pubClient, subClient, { key: 'sceneshop:socket.io' }));
  return {
    kind: 'redis',
    async health() {
      try { return { ok: (await pubClient.ping()) === 'PONG', backend: 'redis' }; }
      catch (err) { return { ok: false, backend: 'redis', error: err.message }; }
    },
    async close() {
      const jobs = [];
      if (pubClient.isOpen) jobs.push(pubClient.quit());
      if (subClient.isOpen) jobs.push(subClient.quit());
      await Promise.allSettled(jobs);
    },
  };
}

module.exports = { configureSocketRedis };
