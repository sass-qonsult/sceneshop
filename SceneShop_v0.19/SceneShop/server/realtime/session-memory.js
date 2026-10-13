const crypto = require('crypto');

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const TTL_MS = 4 * 60 * 60 * 1000;

class MemorySessionRepository {
  constructor({ ttlMs = TTL_MS } = {}) {
    this.kind = 'memory';
    this.ttlMs = ttlMs;
    this.sessions = new Map();
    this.cleanup = setInterval(() => this.prune(), 10 * 60 * 1000);
    this.cleanup.unref();
  }

  async init() { return this; }

  newCode() {
    let code;
    do {
      code = Array.from(crypto.randomBytes(6), (b) => ALPHABET[b % ALPHABET.length]).join('');
    } while (this.sessions.has(code));
    return code;
  }

  create(workId, time = 0, trackId = null, opts = {}) {
    const now = Date.now();
    const position = Math.max(0, Number(time) || 0);
    const s = {
      code: this.newCode(),
      controllerToken: crypto.randomBytes(32).toString('base64url'),
      workId,
      trackId,
      partnerId: opts.partnerId || null,
      bindingId: opts.bindingId || null,
      mode: opts.mode || 'PARTNER_NATIVE',
      time: position,
      playbackPosition: position,
      playbackObservedAt: now,
      playing: false,
      sceneId: null,
      syncConfidence: opts.syncConfidence == null ? null : Number(opts.syncConfidence),
      lastSyncAt: opts.lastSyncAt || null,
      createdAt: now,
      lastSeen: now,
      phones: 0,
      saved: new Set(),
      devices: new Set(),
      phoneSockets: new Set(),
      viewers: new Map(),
    };
    this.sessions.set(s.code, s);
    return s;
  }

  get(code) {
    const s = this.sessions.get(String(code || '').toUpperCase());
    if (!s) return null;
    if (Date.now() - s.lastSeen > this.ttlMs) {
      this.sessions.delete(s.code);
      return null;
    }
    return s;
  }

  setPartner(code, partnerId) {
    const s = this.get(code); if (!s) return null;
    s.partnerId = partnerId || null; s.lastSeen = Date.now(); return s;
  }

  addDevice(code, deviceId) {
    const s = this.get(code); if (!s) return { session: null, isNew: false };
    const before = s.devices.size;
    s.devices.add(deviceId);
    s.lastSeen = Date.now();
    return { session: s, isNew: s.devices.size > before };
  }

  phoneConnected(code, socketId) {
    const s = this.get(code); if (!s) return null;
    s.phoneSockets.add(socketId);
    s.phones = s.phoneSockets.size;
    s.lastSeen = Date.now();
    return s;
  }

  phoneDisconnected(code, socketId) {
    const s = this.get(code); if (!s) return null;
    s.phoneSockets.delete(socketId);
    s.phones = s.phoneSockets.size;
    s.lastSeen = Date.now();
    return s;
  }

  updatePlayback(code, { time, playing, sceneId } = {}) {
    const s = this.get(code); if (!s) return null;
    const position = Math.max(0, Number(time) || 0);
    const now = Date.now();
    s.time = position;
    s.playbackPosition = position;
    s.playbackObservedAt = now;
    s.playing = !!playing;
    if (sceneId !== undefined) s.sceneId = sceneId || null;
    s.lastSeen = now;
    return s;
  }

  setTrack(code, trackId) {
    const s = this.get(code); if (!s) return null;
    s.trackId = trackId || null;
    s.sceneId = null;
    s.lastSeen = Date.now();
    return s;
  }

  getViewer(code, deviceId) {
    const s = this.get(code); if (!s) return null;
    const current = s.viewers.get(deviceId);
    if (current) return { ...current };
    return {
      deviceId, state: 'LIVE', browsePosition: s.playbackPosition,
      browseSceneId: s.sceneId || null, updatedAt: Date.now(),
    };
  }

  setBrowse(code, deviceId, { position, sceneId } = {}) {
    const s = this.get(code); if (!s) return null;
    const current = this.getViewer(code, deviceId);
    const viewer = {
      ...current, state: 'BROWSING',
      browsePosition: position == null ? current.browsePosition : Math.max(0, Number(position) || 0),
      browseSceneId: sceneId || null, updatedAt: Date.now(),
    };
    s.viewers.set(deviceId, viewer); s.lastSeen = Date.now();
    return viewer;
  }

  goLive(code, deviceId) {
    const s = this.get(code); if (!s) return null;
    const viewer = {
      deviceId, state: 'LIVE', browsePosition: s.playbackPosition,
      browseSceneId: s.sceneId || null, updatedAt: Date.now(),
    };
    s.viewers.set(deviceId, viewer); s.lastSeen = Date.now();
    return viewer;
  }

  resync(code, { position, confidence, sceneId } = {}) {
    const s = this.get(code); if (!s) return null;
    const now = Date.now();
    if (position != null) {
      s.time = Math.max(0, Number(position) || 0);
      s.playbackPosition = s.time;
      s.playbackObservedAt = now;
    }
    if (sceneId !== undefined) s.sceneId = sceneId || null;
    s.syncConfidence = confidence == null ? null : Math.max(0, Math.min(1, Number(confidence) || 0));
    s.lastSyncAt = now;
    s.lastSeen = now;
    return s;
  }

  prune() {
    const now = Date.now();
    for (const [code, s] of this.sessions) if (now - s.lastSeen > this.ttlMs) this.sessions.delete(code);
  }

  async health() { return { ok: true, backend: 'memory', sessions: this.sessions.size }; }
  async close() { clearInterval(this.cleanup); }
}

module.exports = { MemorySessionRepository, TTL_MS, ALPHABET };
