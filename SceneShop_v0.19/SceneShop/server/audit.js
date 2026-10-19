/**
 * Trilha de auditoria à prova de adulteração.
 *
 * Cada registro guarda o hash do anterior (como uma pequena "blockchain" local):
 * se alguém alterar ou apagar um registro antigo, a verificação aponta onde a
 * cadeia quebrou. Registra login, publicação, moderação, KYC, saques e alertas.
 * Guardar esses registros é exigência comum de prevenção à lavagem de dinheiro.
 */
const crypto = require("crypto");
const store = require("./store");

const S = () => store.state;
// v2: chaves ordenadas. O PostgreSQL (jsonb) não preserva a ordem das chaves de `data`; sem ordenar,
// a cadeia parecia "quebrada" depois de recarregar o estado. Registros antigos (sem `v`) seguem o cálculo original.
const canonical = (v) => Array.isArray(v) ? v.map(canonical)
  : v && typeof v === "object" ? Object.keys(v).sort().reduce((o, k) => { o[k] = canonical(v[k]); return o; }, {}) : v;
const digest = (e) => crypto.createHash("sha256")
  .update(JSON.stringify(e.v === 2 ? [e.seq, e.at, e.actor, e.action, canonical(e.data), e.prev] : [e.seq, e.at, e.actor, e.action, e.data, e.prev])).digest("hex");

function prepareEntry(list, actor, action, data = {}, at = store.now()) {
  const prev = list.length ? list[list.length - 1].hash : "GENESIS";
  const e = { seq: list.length + 1, at, actor: actor || "sistema", action, data: JSON.parse(JSON.stringify(data ?? {})), prev, v: 2 };
  e.hash = digest(e);
  return e;
}

function log(actor, action, data = {}) {
  const list = S().audit;
  const e = prepareEntry(list, actor, action, data);
  list.push(e);
  store.save();
  return e;
}

function verifyChain() {
  const list = S().audit;
  for (let i = 0; i < list.length; i++) {
    const e = list[i];
    const prev = i ? list[i - 1].hash : "GENESIS";
    if (e.prev !== prev || e.hash !== digest(e) || e.seq !== i + 1) return { ok: false, brokenAt: e.seq, total: list.length };
  }
  return { ok: true, total: list.length };
}

function recent(n = 50, filter = {}) {
  return S().audit.filter((e) => !filter.actor || e.actor === filter.actor).slice(-n).reverse();
}

module.exports = { prepareEntry, log, verifyChain, recent };
