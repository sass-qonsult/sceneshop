const crypto = require('crypto');
const os = require('os');
const pkg = require('../../package.json');

function safeName(value, fallback = 'default') {
  const out = String(value == null ? '' : value).trim().toLowerCase().replace(/[^a-z0-9:_-]+/g, '-').replace(/^-+|-+$/g, '');
  return out || fallback;
}
function keyHash(value) { return crypto.createHash('sha256').update(String(value)).digest('hex'); }
function boundedTtl(value, fallback = 300000) { return Math.max(1000, Math.min(24 * 60 * 60 * 1000, Number(value) || fallback)); }

class MemoryCacheCoordinator {
  constructor({ prefix = 'sceneshop', instanceId } = {}) {
    this.kind = 'memory';
    this.prefix = safeName(prefix, 'sceneshop');
    this.instanceId = instanceId || `${os.hostname()}:${process.pid}:${crypto.randomUUID().slice(0, 8)}`;
    this.epochs = new Map();
    this.entries = new Map();
    this.leases = new Map();
    this.startedAt = Date.now();
  }
  async init() { return this.health(); }
  epoch(namespace) { const n = safeName(namespace); return this.epochs.get(n) || 1; }
  entryKey(namespace, key) { return `${safeName(namespace)}:${this.epoch(namespace)}:${keyHash(key)}`; }
  async get(namespace, key) {
    const k = this.entryKey(namespace, key); const row = this.entries.get(k);
    if (!row) return null;
    if (row.expiresAt <= Date.now()) { this.entries.delete(k); return null; }
    return row.value;
  }
  async set(namespace, key, value, { ttlMs = 300000 } = {}) {
    this.entries.set(this.entryKey(namespace, key), { value, expiresAt: Date.now() + boundedTtl(ttlMs) });
    return true;
  }
  async invalidate(namespace, metadata = {}) {
    const n = safeName(namespace); const next = this.epoch(n) + 1; this.epochs.set(n, next);
    return { namespace: n, epoch: next, metadata };
  }
  async acquireLease(name, { ttlMs = 30000, owner } = {}) {
    const leaseName = safeName(name); const now = Date.now(); const ttl = boundedTtl(ttlMs, 30000);
    const current = this.leases.get(leaseName);
    if (current && current.expiresAt > now) return null;
    const token = `${owner || this.instanceId}:${crypto.randomUUID()}`;
    this.leases.set(leaseName, { token, expiresAt: now + ttl });
    return { name: leaseName, token, ttlMs: ttl, release: async () => {
      const row = this.leases.get(leaseName); if (row && row.token === token) { this.leases.delete(leaseName); return true; } return false;
    } };
  }
  async heartbeat() { return true; }
  async health() { return { ok: true, backend: 'memory', instanceId: this.instanceId, activeInstances: 1, startedAt: this.startedAt }; }
  async close() { this.entries.clear(); this.leases.clear(); }
}

function requireRedis() {
  try { return require('redis'); }
  catch (err) { const e = new Error("CACHE_BACKEND=redis requer o pacote 'redis'."); e.cause = err; throw e; }
}

class RedisCacheCoordinator {
  constructor({ url, prefix = 'sceneshop', instanceId, client = null, publisher = null, subscriber = null, heartbeatTtlMs = 90000 } = {}) {
    this.kind = 'redis';
    this.url = url;
    this.prefix = safeName(prefix, 'sceneshop');
    this.instanceId = instanceId || `${os.hostname()}:${process.pid}:${crypto.randomUUID().slice(0, 8)}`;
    this.client = client; this.publisher = publisher; this.subscriber = subscriber;
    this.ownsClients = !client;
    this.heartbeatTtlMs = boundedTtl(heartbeatTtlMs, 90000);
    this.heartbeatTimer = null;
    this.lastInvalidation = null;
  }
  epochKey(namespace) { return `${this.prefix}:cache:epoch:${safeName(namespace)}`; }
  dataKey(namespace, epoch, key) { return `${this.prefix}:cache:data:${safeName(namespace)}:${epoch}:${keyHash(key)}`; }
  leaseKey(name) { return `${this.prefix}:lease:${safeName(name)}`; }
  instancesKey() { return `${this.prefix}:instances`; }
  invalidationChannel() { return `${this.prefix}:cache:invalidate`; }

  async _connect(client) { if (client && !client.isOpen && typeof client.connect === 'function') await client.connect(); }
  async init() {
    if (!this.client) {
      if (!this.url) throw new Error('REDIS_URL é obrigatório para CACHE_BACKEND=redis.');
      const { createClient } = requireRedis();
      this.client = createClient({ url: this.url });
      this.publisher = this.client.duplicate();
      this.subscriber = this.client.duplicate();
      for (const c of [this.client, this.publisher, this.subscriber]) c.on('error', (err) => console.error('Redis cache/coordination error:', err.message));
    }
    this.publisher = this.publisher || (this.client.duplicate ? this.client.duplicate() : this.client);
    this.subscriber = this.subscriber || (this.client.duplicate ? this.client.duplicate() : this.client);
    await this._connect(this.client); await this._connect(this.publisher); await this._connect(this.subscriber);
    if (this.subscriber && typeof this.subscriber.subscribe === 'function') {
      await this.subscriber.subscribe(this.invalidationChannel(), (message) => {
        try { this.lastInvalidation = JSON.parse(message); } catch (_) { this.lastInvalidation = { raw: String(message) }; }
      });
    }
    await this.heartbeat();
    this.heartbeatTimer = setInterval(() => this.heartbeat().catch(() => {}), Math.max(5000, Math.floor(this.heartbeatTtlMs / 3)));
    if (this.heartbeatTimer.unref) this.heartbeatTimer.unref();
    return this.health();
  }
  async epoch(namespace) {
    const key = this.epochKey(namespace);
    let value = await this.client.get(key);
    if (value == null) { await this.client.set(key, '1', { NX: true }); value = await this.client.get(key); }
    return Math.max(1, Number(value) || 1);
  }
  async get(namespace, key) {
    const epoch = await this.epoch(namespace); const raw = await this.client.get(this.dataKey(namespace, epoch, key));
    if (raw == null) return null;
    try { return JSON.parse(raw); } catch (_) { await this.client.del(this.dataKey(namespace, epoch, key)); return null; }
  }
  async set(namespace, key, value, { ttlMs = 300000 } = {}) {
    const epoch = await this.epoch(namespace); const ttl = boundedTtl(ttlMs);
    await this.client.set(this.dataKey(namespace, epoch, key), JSON.stringify(value), { PX: ttl });
    return true;
  }
  async invalidate(namespace, metadata = {}) {
    const n = safeName(namespace); const epoch = Number(await this.client.incr(this.epochKey(n)));
    const event = { namespace: n, epoch, by: this.instanceId, at: Date.now(), metadata };
    await this.publisher.publish(this.invalidationChannel(), JSON.stringify(event));
    this.lastInvalidation = event;
    return event;
  }
  async acquireLease(name, { ttlMs = 30000, owner } = {}) {
    const leaseName = safeName(name); const ttl = boundedTtl(ttlMs, 30000); const token = `${owner || this.instanceId}:${crypto.randomUUID()}`;
    const result = await this.client.set(this.leaseKey(leaseName), token, { NX: true, PX: ttl });
    if (result !== 'OK') return null;
    const key = this.leaseKey(leaseName); const client = this.client;
    return { name: leaseName, token, ttlMs: ttl, release: async () => {
      const script = "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";
      const n = await client.eval(script, { keys: [key], arguments: [token] }); return Number(n) === 1;
    } };
  }
  async heartbeat(metadata = {}) {
    const now = Date.now(); const staleBefore = now - this.heartbeatTtlMs;
    await this.client.zAdd(this.instancesKey(), [{ score: now, value: this.instanceId }]);
    await this.client.zRemRangeByScore(this.instancesKey(), 0, staleBefore);
    const metaKey = `${this.prefix}:instance:${keyHash(this.instanceId)}`;
    await this.client.set(metaKey, JSON.stringify({ instanceId: this.instanceId, host: os.hostname(), pid: process.pid, version: pkg.version, at: now, ...metadata }), { PX: this.heartbeatTtlMs });
    return true;
  }
  async health() {
    try {
      const pong = await this.client.ping(); const now = Date.now();
      await this.client.zRemRangeByScore(this.instancesKey(), 0, now - this.heartbeatTtlMs);
      const activeInstances = Number(await this.client.zCount(this.instancesKey(), now - this.heartbeatTtlMs, '+inf'));
      return { ok: pong === 'PONG', backend: 'redis', instanceId: this.instanceId, activeInstances, heartbeatTtlMs: this.heartbeatTtlMs, lastInvalidation: this.lastInvalidation };
    } catch (err) { return { ok: false, backend: 'redis', instanceId: this.instanceId, error: err.message }; }
  }
  async close() {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer); this.heartbeatTimer = null;
    if (!this.ownsClients) return;
    const unique = [...new Set([this.subscriber, this.publisher, this.client].filter(Boolean))];
    await Promise.allSettled(unique.map((c) => c.isOpen && typeof c.quit === 'function' ? c.quit() : undefined));
  }
}

function createCacheCoordinator({ backend = 'memory', url, prefix = 'sceneshop', ...rest } = {}) {
  if (backend === 'redis') return new RedisCacheCoordinator({ url, prefix, ...rest });
  if (backend === 'memory') return new MemoryCacheCoordinator({ prefix, ...rest });
  throw new Error(`CACHE_BACKEND inválido: ${backend}. Use 'memory' ou 'redis'.`);
}

module.exports = { createCacheCoordinator, MemoryCacheCoordinator, RedisCacheCoordinator, keyHash, boundedTtl, safeName };
