/**
 * Playback/commerce sessions.
 * v0.9 alpha.7: memory for local/demo; Redis authoritative for production realtime.
 */
const crypto = require('crypto');
const config = require('./config');
const { MemorySessionRepository } = require('./realtime/session-memory');
const { RedisSessionRepository } = require('./realtime/session-redis');

let repo = null;

function createRepository() {
  if (process.env.SCENESHOP_MEMORY || config.SESSION_BACKEND === 'memory') return new MemorySessionRepository();
  if (config.SESSION_BACKEND === 'redis') return new RedisSessionRepository({ url: config.REDIS_URL });
  throw new Error(`SESSION_BACKEND inválido: ${config.SESSION_BACKEND}. Use 'memory' ou 'redis'.`);
}

function R() { if (!repo) repo = createRepository(); return repo; }

function publicView(s) {
  return {
    code: s.code,
    workId: s.workId,
    trackId: s.trackId,
    partnerId: s.partnerId || null,
    bindingId: s.bindingId || null,
    mode: s.mode || 'PARTNER_NATIVE',
    time: Number(s.time ?? s.playbackPosition ?? 0),
    playbackPosition: Number(s.playbackPosition ?? s.time ?? 0),
    playbackObservedAt: s.playbackObservedAt || null,
    playing: !!s.playing,
    sceneId: s.sceneId || null,
    syncConfidence: s.syncConfidence == null ? null : Number(s.syncConfidence),
    lastSyncAt: s.lastSyncAt || null,
    // segundos desde a última posição conhecida (medidos no servidor: sem depender do relógio do celular).
    // No modo COMPANION (sincronizado pelo som de outra tela) o filme continua andando depois da sincronização.
    observedAgoSeconds: (() => { const at = Number(s.playbackObservedAt || s.lastSyncAt || 0); return at ? Math.max(0, (Date.now() - at) / 1000) : 0; })(),
    phones: Number(s.phones || 0),
  };
}

function canControl(s, token) {
  if (!s || typeof token !== 'string' || !token) return false;
  const a = Buffer.from(token);
  const b = Buffer.from(s.controllerToken || '');
  return a.length === b.length && a.length > 0 && crypto.timingSafeEqual(a, b);
}

module.exports = {
  init: () => R().init(),
  close: () => R().close(),
  health: () => R().health(),
  backendKind: () => R().kind,
  create: (...args) => R().create(...args),
  get: (...args) => R().get(...args),
  setPartner: (...args) => R().setPartner(...args),
  addDevice: (...args) => R().addDevice(...args),
  phoneConnected: (...args) => R().phoneConnected(...args),
  phoneDisconnected: (...args) => R().phoneDisconnected(...args),
  updatePlayback: (...args) => R().updatePlayback(...args),
  setTrack: (...args) => R().setTrack(...args),
  getViewer: (...args) => R().getViewer(...args),
  setBrowse: (...args) => R().setBrowse(...args),
  goLive: (...args) => R().goLive(...args),
  resync: (...args) => R().resync(...args),
  publicView,
  canControl,
  _useRepositoryForTest(next) { repo = next; },
};
