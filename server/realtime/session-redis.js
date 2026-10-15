const crypto = require('crypto');
const { TTL_MS, ALPHABET } = require('./session-memory');

function requireRedis() {
  try { return require('redis'); }
  catch (err) {
    const e = new Error("SESSION_BACKEND=redis requer o pacote 'redis'. Instale as dependências antes de iniciar.");
    e.cause = err; throw e;
  }
}

const text = (v) => v == null ? '' : String(v);
const num = (v, fallback = 0) => v == null || v === '' ? fallback : Number(v);
const bool = (v) => v === true || v === '1' || v === 1 || v === 'true';

class RedisSessionRepository {
  constructor({ url, ttlMs = TTL_MS, client = null, prefix = 'sceneshop:playback' } = {}) {
    this.kind = 'redis';
    this.url = url;
    this.ttlMs = ttlMs;
    this.ttlSeconds = Math.max(60, Math.ceil(ttlMs / 1000));
    this.client = client;
    this.ownsClient = !client;
    this.prefix = prefix;
  }

  key(code) { return `${this.prefix}:session:${String(code || '').toUpperCase()}`; }
  devicesKey(code) { return `${this.key(code)}:devices`; }
  phonesKey(code) { return `${this.key(code)}:phones`; }
  viewerKey(code, deviceId) { return `${this.key(code)}:viewer:${deviceId}`; }

  async init() {
    if (!this.client) {
      if (!this.url) throw new Error('REDIS_URL é obrigatório para SESSION_BACKEND=redis.');
      const { createClient } = requireRedis();
      this.client = createClient({ url: this.url });
      this.client.on('error', (err) => console.error('Redis session error:', err.message));
      await this.client.connect();
    }
    await this.client.ping();
    return this;
  }

  async touch(code) {
    const multi = this.client.multi();
    multi.expire(this.key(code), this.ttlSeconds);
    multi.expire(this.devicesKey(code), this.ttlSeconds);
    multi.expire(this.phonesKey(code), this.ttlSeconds);
    await multi.exec();
  }

  async newCode() {
    for (let attempt = 0; attempt < 64; attempt += 1) {
      const code = Array.from(crypto.randomBytes(6), (b) => ALPHABET[b % ALPHABET.length]).join('');
      if (!(await this.client.exists(this.key(code)))) return code;
    }
    throw new Error('Não foi possível gerar código de sessão único.');
  }

  async create(workId, time = 0, trackId = null, opts = {}) {
    const code = await this.newCode();
    const now = Date.now();
    const position = Math.max(0, Number(time) || 0);
    const controllerToken = crypto.randomBytes(32).toString('base64url');
    const row = {
      code, controllerToken, workId: text(workId), trackId: text(trackId), partnerId: text(opts.partnerId),
      bindingId: text(opts.bindingId), mode: opts.mode || 'PARTNER_NATIVE',
      time: text(position), playbackPosition: text(position), playbackObservedAt: text(now),
      playing: '0', sceneId: '',
      syncConfidence: opts.syncConfidence == null ? '' : text(opts.syncConfidence), lastSyncAt: text(opts.lastSyncAt),
      createdAt: text(now), lastSeen: text(now),
    };
    await this.client.hSet(this.key(code), row);
    await this.touch(code);
    return this.get(code);
  }

  async get(code) {
    code = String(code || '').toUpperCase();
    if (!code) return null;
    const row = await this.client.hGetAll(this.key(code));
    if (!row || !Object.keys(row).length) return null;
    const [devices, phones] = await Promise.all([
      this.client.sMembers(this.devicesKey(code)),
      this.client.sCard(this.phonesKey(code)),
    ]);
    return {
      code,
      controllerToken: row.controllerToken,
      workId: row.workId,
      trackId: row.trackId || null,
      partnerId: row.partnerId || null,
      bindingId: row.bindingId || null,
      mode: row.mode || 'PARTNER_NATIVE',
      time: num(row.time),
      playbackPosition: num(row.playbackPosition, num(row.time)),
      playbackObservedAt: num(row.playbackObservedAt, null),
      playing: bool(row.playing),
      sceneId: row.sceneId || null,
      syncConfidence: row.syncConfidence === '' || row.syncConfidence == null ? null : Number(row.syncConfidence),
      lastSyncAt: num(row.lastSyncAt, null),
      createdAt: num(row.createdAt),
      lastSeen: num(row.lastSeen),
      phones: Number(phones || 0),
      saved: new Set(),
      devices: new Set(devices || []),
    };
  }

  async patch(code, values = {}) {
    code = String(code || '').toUpperCase();
    if (!(await this.client.exists(this.key(code)))) return null;
    const row = {};
    for (const [k, v] of Object.entries(values)) row[k] = text(v);
    row.lastSeen = text(Date.now());
    await this.client.hSet(this.key(code), row);
    await this.touch(code);
    return this.get(code);
  }

  setPartner(code, partnerId) { return this.patch(code, { partnerId: partnerId || '' }); }

  async addDevice(code, deviceId) {
    code = String(code || '').toUpperCase();
    if (!(await this.client.exists(this.key(code)))) return { session: null, isNew: false };
    const added = await this.client.sAdd(this.devicesKey(code), deviceId);
    await this.touch(code);
    return { session: await this.get(code), isNew: Number(added) > 0 };
  }

  async phoneConnected(code, socketId) {
    code = String(code || '').toUpperCase();
    if (!(await this.client.exists(this.key(code)))) return null;
    await this.client.sAdd(this.phonesKey(code), socketId);
    await this.touch(code);
    return this.get(code);
  }

  async phoneDisconnected(code, socketId) {
    code = String(code || '').toUpperCase();
    if (!(await this.client.exists(this.key(code)))) return null;
    await this.client.sRem(this.phonesKey(code), socketId);
    await this.touch(code);
    return this.get(code);
  }

  async updatePlayback(code, { time, playing, sceneId } = {}) {
    const s = await this.get(code); if (!s) return null;
    const now = Date.now();
    const position = Math.max(0, Number(time) || 0);
    const patch = {
      time: position, playbackPosition: position, playbackObservedAt: now,
      playing: playing ? 1 : 0,
    };
    if (sceneId !== undefined) patch.sceneId = sceneId || '';
    return this.patch(code, patch);
  }

  setTrack(code, trackId) { return this.patch(code, { trackId: trackId || '', sceneId: '' }); }

  async getViewer(code, deviceId) {
    const s = await this.get(code); if (!s) return null;
    const row = await this.client.hGetAll(this.viewerKey(code, deviceId));
    if (!row || !Object.keys(row).length) {
      return { deviceId, state: 'LIVE', browsePosition: s.playbackPosition, browseSceneId: s.sceneId || null, updatedAt: Date.now() };
    }
    return {
      deviceId, state: row.state || 'LIVE',
      browsePosition: num(row.browsePosition, s.playbackPosition),
      browseSceneId: row.browseSceneId || null, updatedAt: num(row.updatedAt, null),
    };
  }

  async setBrowse(code, deviceId, { position, sceneId } = {}) {
    const current = await this.getViewer(code, deviceId); if (!current) return null;
    const viewer = {
      deviceId, state: 'BROWSING',
      browsePosition: position == null ? current.browsePosition : Math.max(0, Number(position) || 0),
      browseSceneId: sceneId || '', updatedAt: Date.now(),
    };
    await this.client.hSet(this.viewerKey(code, deviceId), {
      state: viewer.state, browsePosition: text(viewer.browsePosition),
      browseSceneId: viewer.browseSceneId, updatedAt: text(viewer.updatedAt),
    });
    await this.client.expire(this.viewerKey(code, deviceId), this.ttlSeconds);
    await this.touch(code);
    return { ...viewer, browseSceneId: viewer.browseSceneId || null };
  }

  async goLive(code, deviceId) {
    const s = await this.get(code); if (!s) return null;
    const viewer = { deviceId, state: 'LIVE', browsePosition: s.playbackPosition, browseSceneId: s.sceneId || '', updatedAt: Date.now() };
    await this.client.hSet(this.viewerKey(code, deviceId), {
      state: viewer.state, browsePosition: text(viewer.browsePosition),
      browseSceneId: viewer.browseSceneId, updatedAt: text(viewer.updatedAt),
    });
    await this.client.expire(this.viewerKey(code, deviceId), this.ttlSeconds);
    await this.touch(code);
    return { ...viewer, browseSceneId: viewer.browseSceneId || null };
  }

  async resync(code, { position, confidence, sceneId } = {}) {
    const s = await this.get(code); if (!s) return null;
    const now = Date.now();
    const p = { lastSyncAt: now, syncConfidence: confidence == null ? '' : Math.max(0, Math.min(1, Number(confidence) || 0)) };
    if (position != null) {
      const value = Math.max(0, Number(position) || 0);
      p.time = value; p.playbackPosition = value; p.playbackObservedAt = now;
    }
    if (sceneId !== undefined) {
      p.sceneId = sceneId || '';
    }
    return this.patch(code, p);
  }

  async health() {
    try {
      const pong = await this.client.ping();
      return { ok: pong === 'PONG', backend: 'redis', prefix: this.prefix };
    } catch (err) { return { ok: false, backend: 'redis', error: err.message }; }
  }

  async close() {
    if (this.ownsClient && this.client && this.client.isOpen) await this.client.quit();
  }
}

module.exports = { RedisSessionRepository, requireRedis };
