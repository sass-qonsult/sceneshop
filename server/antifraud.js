/**
 * Antifraude
 *
 *  1. Limite de requisições por IP (login, cadastro, voto, denúncia, clique).
 *  2. Prova de audiência: só vota/denuncia quem está numa sessão ativa daquela obra
 *     (o celular entrou pelo QR code da TV). Impede robôs votando de fora.
 *  3. Identidade de aparelho: um voto por aparelho; denúncia repetida é recusada.
 *  4. Cliques: repetições do mesmo aparelho no mesmo produto em 10 min contam uma vez;
 *     clique sem aparelho nem sessão é registrado, mas não gera comissão.
 *
 * Limitação conhecida: o identificador de aparelho fica no navegador e pode ser apagado.
 * Na fase 2, somar sinais do servidor (IP, ASN, impressão do navegador, conta logada).
 */
const store = require("./store");
const sessions = require("./sessions");
const tracks = require("./tracks");
const { RATE, CLICK_DEDUPE_MINUTES } = require("./config");

const S = () => store.state;
const buckets = new Map(); // "nome|ip" -> { n, reset }

function allow(name, key, limit, windowMs = 60e3) {
  const k = `${name}|${key}`;
  const now = Date.now();
  let b = buckets.get(k);
  if (!b || now > b.reset) b = { n: 0, reset: now + windowMs };
  b.n += 1;
  buckets.set(k, b);
  return b.n <= limit;
}
setInterval(() => { const now = Date.now(); for (const [k, b] of buckets) if (now > b.reset) buckets.delete(k); }, 60e3).unref();

// Express calcula req.ip respeitando `trust proxy`. Não aceite X-Forwarded-For cru,
// pois um cliente direto poderia forjá-lo e contornar o rate limit.
const ipOf = (req) => req.ip || (req.socket && req.socket.remoteAddress) || "?";

// Middleware: limite por IP
function rateLimit(name) {
  return (req, res, next) => {
    if (allow(name, ipOf(req), RATE[name] || 30)) return next();
    res.set("Retry-After", "60").status(429).json({ error: "Muitas tentativas. Aguarde um minuto." });
  };
}

const validDevice = (d) => typeof d === "string" && /^[A-Za-z0-9_-]{8,64}$/.test(d);

// Prova de audiência para votar/denunciar
function checkViewer({ trackId, session: code, deviceId }) {
  if (!validDevice(deviceId)) return { error: "Aparelho não identificado.", code: 400 };
  const t = tracks.get(trackId);
  if (!t) return { error: "Trilha não encontrada.", code: 404 };
  const finish = (s) => {
    if (!s || s.workId !== t.workId || !s.devices.has(deviceId)) {
      return { error: "Só quem está assistindo pode votar ou denunciar. Conecte-se pelo QR code da TV.", code: 403 };
    }
    return { track: t, session: s };
  };
  const current = sessions.get(code);
  return current && typeof current.then === "function" ? current.then(finish) : finish(current);
}

// Registra (ou reaproveita) um clique rastreado
function registerClick({ trackId, productId, storeId, session, deviceId, partnerId }) {
  const t = tracks.get(trackId);
  const dev = validDevice(deviceId) ? deviceId : null;
  const finalize = (activeSession) => {
    const sess = activeSession ? session : null;
    const now = store.now();
    if (dev) {
      const dup = [...S().clicks].reverse().find((c) => c.deviceId === dev && c.trackId === trackId && c.productId === productId &&
        now - c.at < CLICK_DEDUPE_MINUTES * 60e3);
      if (dup) return { click: dup, duplicate: true };
    }
    const c = {
      id: "k" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
      trackId, authorId: t ? t.authorId : null, productId, store: storeId,
      deviceId: dev, session: sess, at: now, partnerId: partnerId || null,
      anonymous: !dev && !sess,
    };
    S().clicks.push(c);
    if (S().clicks.length > 20000) S().clicks.shift();
    store.save();
    return { click: c, duplicate: false };
  };
  if (!session) return finalize(null);
  const current = sessions.get(session);
  return current && typeof current.then === "function" ? current.then(finalize) : finalize(current);
}

module.exports = { allow, rateLimit, ipOf, checkViewer, registerClick, validDevice };
