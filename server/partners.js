/**
 * Parceiros corporativos (emissoras, streamings, agências).
 *
 * O parceiro embute o player do SceneShop no próprio site/app usando uma chave pública
 * (ex.: pk_aurora_demo). A chave só funciona nos domínios cadastrados, e só dá acesso
 * às obras liberadas para aquele parceiro. O player assume a marca do parceiro.
 */
const store = require("./store");
const sessions = require("./sessions");
const { DEMO } = require("./config");

const S = () => store.state;

const byKey = (key) => Object.values(S().partners).find((p) => p.publicKey === key) || null;

function hostOf(req) {
  const src = req.headers.origin || req.headers.referer || "";
  try { return new URL(src).hostname; } catch (e) { return null; }
}

function isFirstParty(req) {
  const host = hostOf(req);
  if (!host) return false;
  const own = new Set([String(req.headers.host || "").split(":")[0].toLowerCase()]);
  try { if (process.env.PUBLIC_URL) own.add(new URL(process.env.PUBLIC_URL).hostname.toLowerCase()); } catch (e) {}
  return own.has(host.toLowerCase());
}

/**
 * Decide se a requisição pode acessar a obra.
 *  - com chave: parceiro válido + domínio autorizado + obra liberada para ele
 *  - sem chave: só no modo demonstração (site do próprio SceneShop)
 */
function resolve(req, workId) {
  // celular que entrou pelo QR code de uma sessão do parceiro herda o acesso dela
  const sess = req.query.session && sessions.get(req.query.session);
  if (sess && sess.workId === workId) return { partner: sess.partnerId ? S().partners[sess.partnerId] : null };
  const key = req.headers["x-sceneshop-key"] || req.query.key;
  // Site do próprio SceneShop (ex.: /assistir): acesso primário, sem chave de parceiro.
  // Usa o mesmo critério de origem que já valida o domínio dos parceiros.
  if (!key) return DEMO || isFirstParty(req) ? { partner: null } : { error: "Chave de parceiro obrigatória.", code: 401 };
  const p = byKey(key);
  if (!p) return { error: "Chave de parceiro inválida.", code: 401 };
  const host = hostOf(req);
  if (!host || !p.domains.includes(host)) return { error: `Domínio não autorizado para ${p.name}.`, code: 403 };
  if (workId && !(S().workPartners[workId] || []).includes(p.id)) return { error: "Obra não liberada para este parceiro.", code: 403 };
  return { partner: p };
}

const publicView = (p) => p && { id: p.id, name: p.name, kind: p.kind, brand: p.brand };

module.exports = { resolve, byKey, publicView, hostOf, isFirstParty };
