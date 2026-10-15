/**
 * Monitoramento de prevenção à lavagem de dinheiro (AML).
 *
 * Regras (limites em config.js, VALORES DE EXEMPLO a validar com compliance):
 *   autocompra      muitas vendas do autor vindas do mesmo aparelho         -> alta
 *   pico            vendas em 7 dias muito acima da média das 4 semanas    -> média
 *   valor_elevado   comissão única alta                                     -> média
 *   volume_mensal   soma de comissões em 30 dias acima do limite            -> alta
 *   pep             pessoa politicamente exposta (diligência reforçada)    -> média
 *   preco_divergente loja cobrou acima do preço garantido                   -> alta
 *   cupom_reutilizado loja informou o mesmo cupom em mais de um pedido      -> alta
 *
 * Alerta "alta" aberto (ou já comunicado) bloqueia saques até a análise.
 * O moderador decide: "sem_irregularidade" ou "comunicado" (registro de comunicação
 * ao COAF — a comunicação em si é feita pelo compliance, fora do sistema).
 * O autor NÃO é informado do motivo (vedação de alertar o investigado).
 */
const store = require("./store");
const audit = require("./audit");
const { AML, STORE_COMMISSION, SPLIT } = require("./config");

const S = () => store.state;
const DAY = store.DAY;
const brl = (v) => "R$ " + v.toFixed(2).replace(".", ",");

function shareOf(sale) {
  // Autor/produtora recebe exatamente o valor congelado na venda. Uma política
  // comercial posterior não pode alterar AML, extrato ou histórico financeiro.
  if (sale.financials && Number.isFinite(Number(sale.financials.ownerShare))) return Number(sale.financials.ownerShare);
  const t = S().tracks[sale.trackId];
  const type = t ? t.type : "community";
  return Math.round(sale.value * (sale.commissionRate || STORE_COMMISSION[sale.store] || 0.05) * SPLIT[type].owner * 100) / 100;
}

function raise(authorId, rule, severity, detail, key) {
  // um alerta por regra/período: não duplica enquanto o anterior existir
  if (S().alerts.some((a) => a.key === key)) return null;
  const a = { id: "al" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), key, authorId, rule, severity, detail, at: store.now(), status: "aberto" };
  S().alerts.push(a);
  audit.log("sistema", "alerta_aml", { authorId, rule, severity });
  store.save();
  return a;
}

function evaluate(authorId) {
  const a = S().authors[authorId];
  if (!a) return [];
  const now = store.now();
  const sales = S().sales.filter((s) => s.authorId === authorId && !s.reversed);
  const clicks = new Map(S().clicks.map((c) => [c.id, c]));
  const month = Math.floor(now / (30 * DAY));
  const created = [];
  const push = (x) => x && created.push(x);

  // 1. Autocompra: mesmo aparelho concentrando as vendas do autor
  const last30 = sales.filter((s) => now - s.at <= 30 * DAY);
  const byDevice = {};
  last30.forEach((s) => { const d = (clicks.get(s.clickId) || {}).deviceId; if (d) byDevice[d] = (byDevice[d] || 0) + 1; });
  const [topDev, topN] = Object.entries(byDevice).sort((x, y) => y[1] - x[1])[0] || [null, 0];
  if (topN >= AML.SELF_PURCHASE_MIN && topN / last30.length >= AML.SELF_PURCHASE_RATIO) {
    push(raise(authorId, "autocompra", "alta",
      `${topN} de ${last30.length} vendas em 30 dias vieram do mesmo aparelho (${topDev}).`, `autocompra:${authorId}:${month}`));
  }

  // 2. Pico de vendas
  const last7 = sales.filter((s) => now - s.at <= 7 * DAY).length;
  const prev28 = sales.filter((s) => now - s.at > 7 * DAY && now - s.at <= 35 * DAY).length;
  const avgWeek = Math.max(prev28 / 4, 0.5);
  if (last7 >= AML.SPIKE_MIN && last7 >= AML.SPIKE_FACTOR * avgWeek) {
    push(raise(authorId, "pico", "media", `${last7} vendas em 7 dias; média anterior ${avgWeek.toFixed(1)} por semana.`, `pico:${authorId}:${Math.floor(now / (7 * DAY))}`));
  }

  // 3. Comissão única elevada
  last30.forEach((s) => {
    const sh = shareOf(s);
    if (sh >= AML.HIGH_VALUE_SHARE) push(raise(authorId, "valor_elevado", "media", `Comissão de ${brl(sh)} em uma única venda.`, `valor:${s.id}`));
  });

  // 4. Volume mensal
  const vol = last30.reduce((n, s) => n + shareOf(s), 0);
  if (vol >= AML.MONTHLY_LIMIT) push(raise(authorId, "volume_mensal", "alta", `${brl(vol)} em comissões nos últimos 30 dias.`, `volume:${authorId}:${month}`));

  // 5. PEP
  if (a.kycData && a.kycData.pep) push(raise(authorId, "pep", "media", "Declarou ser pessoa politicamente exposta: diligência reforçada.", `pep:${authorId}`));

  return created;
}

// Alerta de compliance contra um VENDEDOR (ex.: cobrou acima do preço garantido)
function raiseSeller(sellerId, detail, key, rule = "preco_divergente") {
  if (S().alerts.some((a) => a.key === key)) return null;
  const a = { id: "al" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), key, authorId: null, sellerId, rule, severity: "alta", detail, at: store.now(), status: "aberto" };
  S().alerts.push(a);
  audit.log("sistema", "alerta_vendedor", { sellerId, rule: a.rule });
  store.save();
  return a;
}

function evaluateAll() {
  Object.keys(S().authors).forEach(evaluate);
}

function blocksPayout(authorId) {
  return S().alerts.some((a) => a.authorId === authorId && ((a.status === "aberto" && a.severity === "alta") || a.status === "comunicado"));
}

function decide(alertId, decision, note, actor) {
  const a = S().alerts.find((x) => x.id === alertId);
  if (!a) return { error: "Alerta não encontrado." };
  if (!["sem_irregularidade", "comunicado"].includes(decision)) return { error: "Decisão inválida." };
  if (decision === "comunicado" && String(note || "").trim().length < 10) return { error: "Descreva o fundamento da comunicação (mín. 10 caracteres)." };
  a.status = decision;
  a.decidedBy = actor;
  a.decidedAt = store.now();
  a.note = String(note || "").slice(0, 500);
  audit.log(actor, "alerta_decisao", { alertId, authorId: a.authorId, rule: a.rule, decision });
  store.save();
  return { alert: a };
}

function list() {
  const order = { aberto: 0, comunicado: 1, sem_irregularidade: 2 };
  return S().alerts.map((a) => ({ ...a, authorName: a.sellerId ? (S().sellers[a.sellerId] || {}).name + " (vendedor)" : (S().authors[a.authorId] || {}).name }))
    .sort((x, y) => order[x.status] - order[y.status] || (y.severity === "alta") - (x.severity === "alta") || y.at - x.at);
}

module.exports = { raiseSeller, evaluate, evaluateAll, blocksPayout, decide, list };
