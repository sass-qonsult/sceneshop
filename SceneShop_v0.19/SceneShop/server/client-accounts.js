/**
 * Contas de clientes (rcprep.16) — cada cliente (Sony, Netflix, uma produtora, um canal…) é uma
 * ORGANIZAÇÃO do SceneShop. Este módulo guarda o CONTRATO comercial de cada cliente e monta os
 * relatórios separados por cliente → título (obra/programa) → produto.
 *
 * Contrato (store.state.clientContracts[organizationId]):
 *   terms     condições padrão do cliente
 *   works     condições específicas por título/programa  (sobrepõem as padrão)
 *   products  condições específicas por produto          (sobrepõem as do título)
 * Cada nível pode definir:
 *   commissionRate  comissão sobre o valor da venda (0–1) paga pela loja/marca
 *   ownerShareRate  parte da comissão que fica com o cliente dono do conteúdo (0–1); o resto é do SceneShop
 *   cpcFee          valor fixo por clique qualificado cobrado do cliente (R$)
 *   cpaFee          valor fixo por pedido cobrado do cliente (R$)
 * E no nível do cliente: monthlyFee (mensalidade da plataforma), currency, contractRef, vigência e notas.
 *
 * A comissão e a divisão definidas aqui entram na venda no momento em que ela acontece
 * (commercial-policy.resolve) e ficam congeladas nela; mudar o contrato não reescreve o passado.
 * Cada alteração do contrato gera uma nova versão (histórico das últimas 30).
 */
const store = require("./store");
const catalog = require("./catalog");

const S = () => store.state;
const round = (v) => Math.round((Number(v) || 0) * 100) / 100;
const RATE_FIELDS = ["commissionRate", "ownerShareRate"];
const FEE_FIELDS = ["cpcFee", "cpaFee"];
const MAX_HISTORY = 30;

function contracts() {
  if (!S().clientContracts) S().clientContracts = {};
  return S().clientContracts;
}

// ------------------------------------------------------------------ validação
function cleanLevel(input, label) {
  const out = {};
  const errors = [];
  for (const f of RATE_FIELDS) {
    const raw = input && input[f];
    if (raw === undefined || raw === null || raw === "") continue;
    let n = Number(String(raw).replace(",", "."));
    if (n > 1 && n <= 100) n = n / 100; // aceita 12 (por cento) ou 0.12
    if (!Number.isFinite(n) || n < 0 || n > 1) { errors.push(`${label}: ${f} deve estar entre 0% e 100%.`); continue; }
    out[f] = Math.round(n * 10000) / 10000;
  }
  for (const f of FEE_FIELDS) {
    const raw = input && input[f];
    if (raw === undefined || raw === null || raw === "") continue;
    const n = Number(String(raw).replace(",", "."));
    if (!Number.isFinite(n) || n < 0 || n > 100000) { errors.push(`${label}: ${f} inválido.`); continue; }
    out[f] = round(n);
  }
  const notes = input && input.notes != null ? String(input.notes).trim().slice(0, 500) : "";
  if (notes) out.notes = notes;
  return { value: out, errors };
}

function parseDate(v) {
  if (v === undefined || v === null || v === "") return null;
  const n = typeof v === "number" ? v : Date.parse(v);
  return Number.isFinite(n) ? n : NaN;
}

function normalizeContract(organizationId, input = {}, previous = null) {
  const errors = [];
  const base = cleanLevel(input.terms || {}, "Condições do cliente");
  errors.push(...base.errors);
  const works = {};
  for (const [workId, level] of Object.entries(input.works || {})) {
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(workId)) { errors.push(`Título inválido: ${workId}`); continue; }
    const c = cleanLevel(level, `Título ${workId}`); errors.push(...c.errors);
    if (Object.keys(c.value).length) works[workId] = c.value;
  }
  const products = {};
  for (const [productId, level] of Object.entries(input.products || {})) {
    if (!/^[A-Za-z0-9_.:-]{1,120}$/.test(productId)) { errors.push(`Produto inválido: ${productId}`); continue; }
    const c = cleanLevel(level, `Produto ${productId}`); errors.push(...c.errors);
    if (Object.keys(c.value).length) products[productId] = c.value;
  }
  const monthlyFee = input.monthlyFee === undefined || input.monthlyFee === "" || input.monthlyFee === null ? null : Number(String(input.monthlyFee).replace(",", "."));
  if (monthlyFee !== null && (!Number.isFinite(monthlyFee) || monthlyFee < 0)) errors.push("Mensalidade inválida.");
  const startsAt = parseDate(input.startsAt), endsAt = parseDate(input.endsAt);
  if (Number.isNaN(startsAt) || Number.isNaN(endsAt)) errors.push("Datas de vigência inválidas.");
  if (startsAt && endsAt && endsAt <= startsAt) errors.push("O fim da vigência deve ser depois do início.");
  const status = ["active", "paused", "ended"].includes(input.status) ? input.status : (previous && previous.status) || "active";
  const currency = /^[A-Z]{3}$/.test(String(input.currency || "")) ? input.currency : (previous && previous.currency) || "BRL";
  if (errors.length) return { errors };
  return {
    value: {
      organizationId, status, currency,
      contractRef: String(input.contractRef || "").trim().slice(0, 80) || null,
      startsAt: startsAt || null, endsAt: endsAt || null,
      monthlyFee: monthlyFee === null ? null : round(monthlyFee),
      notes: String(input.notes || "").trim().slice(0, 2000) || null,
      terms: base.value, works, products,
    },
  };
}

// ------------------------------------------------------------------ leitura / gravação
function get(organizationId) {
  const c = contracts()[organizationId];
  return c ? JSON.parse(JSON.stringify(c)) : null;
}

function save(organizationId, input, actor = "system") {
  const prev = contracts()[organizationId] || null;
  const n = normalizeContract(organizationId, input, prev);
  if (n.errors) return { error: n.errors.join(" "), errors: n.errors, code: 400 };
  const now = store.now();
  const version = (prev ? Number(prev.version || 0) : 0) + 1;
  const history = prev ? [{ version: prev.version, updatedAt: prev.updatedAt, updatedBy: prev.updatedBy, snapshot: { ...prev, history: undefined } }, ...(prev.history || [])].slice(0, MAX_HISTORY) : [];
  const next = { ...n.value, version, createdAt: prev ? prev.createdAt : now, updatedAt: now, updatedBy: actor, history };
  contracts()[organizationId] = next;
  store.save();
  return { contract: get(organizationId) };
}

function active(contract, at) {
  if (!contract || contract.status !== "active") return false;
  if (contract.startsAt && at < contract.startsAt) return false;
  if (contract.endsAt && at >= contract.endsAt) return false;
  return true;
}

// ------------------------------------------------------------------ atribuição: venda/clique → título → cliente
function trackOf(trackId) { return trackId ? (S().tracks || {})[trackId] || null : null; }

function workOrganization(workId) {
  if (!workId) return null;
  const w = catalog.getWork(workId) || (S().userWorks || {})[workId] || null;
  if (w && w.organizationId) return w.organizationId;
  // obras de demonstração: a organização da trilha oficial é a dona
  const official = Object.values(S().tracks || {}).find((t) => t.workId === workId && t.type === "official" && t.organizationId);
  return official ? official.organizationId : null;
}

function workOfClick(click) {
  if (!click) return null;
  return click.workId || (trackOf(click.trackId) || {}).workId || null;
}

function workOfSale(sale) {
  if (!sale) return null;
  if (sale.workId) return sale.workId;
  const t = trackOf(sale.trackId); if (t) return t.workId;
  const offer = sale.offerId ? (S().issuedOffers || {})[sale.offerId] : null; if (offer && offer.wid) return offer.wid;
  const click = sale.clickId ? (S().clicks || []).find((c) => c.id === sale.clickId) : null;
  return workOfClick(click);
}

/**
 * Condições do contrato que valem para uma venda (ou null se o cliente não tem contrato ativo).
 * Prioridade: produto > título > padrão do cliente.
 */
// versão do contrato que valia no instante `at` (o contrato não reescreve cliques e vendas anteriores a ele)
function contractAt(organizationId, at) {
  const c = contracts()[organizationId];
  if (!c) return null;
  if (at >= Number(c.updatedAt || 0)) return c;
  for (const h of c.history || []) if (h.snapshot && at >= Number(h.updatedAt || 0)) return h.snapshot;
  return null;
}

function termsFor({ workId, productId, at = store.now() } = {}) {
  const organizationId = workOrganization(workId);
  if (!organizationId) return null;
  const c = contractAt(organizationId, at);
  if (!active(c, at)) return null;
  const out = { organizationId, contractVersion: c.version, source: {} };
  const layers = [["client", c.terms || {}], ["work", (c.works || {})[workId] || {}], ["product", (c.products || {})[productId] || {}]];
  for (const [name, layer] of layers) for (const f of [...RATE_FIELDS, ...FEE_FIELDS]) if (layer[f] != null) { out[f] = layer[f]; out.source[f] = name; }
  return out;
}

function termsForSale(sale) {
  if (!sale) return null;
  return termsFor({ workId: workOfSale(sale), productId: sale.productId, at: sale.at || store.now() });
}

// ------------------------------------------------------------------ relatórios
function emptyRow(extra) {
  return { ...extra, clicks: 0, qualifiedClicks: 0, orders: 0, refunds: 0, gmv: 0, commission: 0, clientShare: 0, sceneshopShare: 0, partnerShare: 0, cpcFees: 0, cpaFees: 0 };
}
function finalize(row) {
  for (const k of ["gmv", "commission", "clientShare", "sceneshopShare", "partnerShare", "cpcFees", "cpaFees"]) row[k] = round(row[k]);
  row.fees = round(row.cpcFees + row.cpaFees);
  row.conversion = row.qualifiedClicks ? Math.round((row.orders / row.qualifiedClicks) * 1000) / 10 : 0;
  row.sceneshopRevenue = round(row.sceneshopShare + row.fees);
  return row;
}

function inPeriod(at, from, to) { return (!from || at >= from) && (!to || at < to); }

/**
 * Relatório de um cliente: totais, por título e por produto, no período [from, to).
 * works: lista das obras do cliente (inclusive excluídas) para nomear as linhas.
 */
function report(organizationId, { from = null, to = null, works = [], productName = null } = {}) {
  const contract = contracts()[organizationId] || null;
  const workTitle = new Map(works.map((w) => [w.id, { title: w.title, archived: !!w.archivedAt }]));
  const total = emptyRow({ organizationId });
  const byWork = new Map(), byProduct = new Map();
  const W = (id) => { if (!byWork.has(id)) byWork.set(id, emptyRow({ workId: id, title: (workTitle.get(id) || {}).title || id, archived: !!(workTitle.get(id) || {}).archived })); return byWork.get(id); };
  const P = (id) => { if (!byProduct.has(id)) byProduct.set(id, emptyRow({ productId: id, name: (productName && productName(id)) || ((catalog.getProduct(id) || {}).name) || id })); return byProduct.get(id); };
  const belongs = (workId) => workId && workOrganization(workId) === organizationId;
  // rcprep.17: cascata cliente → título → produto → pedidos (conciliação)
  const byWP = new Map();
  const WP = (workId, productId) => { const k = `${workId}|${productId}`; if (!byWP.has(k)) byWP.set(k, { ...emptyRow({ workId, productId, name: (productName && productName(productId)) || ((catalog.getProduct(productId) || {}).name) || productId }), orderList: [] }); return byWP.get(k); };
  const storeName = (s) => { const id = s.sellerId || s.store; const sl = id && (S().sellers || {})[id]; return (sl && sl.name) || id || "—"; };

  const addClick = (workId, productId, qualified, at) => {
    const rows = [total, W(workId), ...(productId ? [P(productId), WP(workId, productId)] : [])];
    const terms = qualified ? termsFor({ workId, productId, at }) : null;
    for (const r of rows) { r.clicks++; if (qualified) { r.qualifiedClicks++; if (terms && terms.cpcFee) r.cpcFees += terms.cpcFee; } }
  };
  for (const c of S().clicks || []) {
    if (!inPeriod(c.at, from, to)) continue;
    const workId = workOfClick(c); if (!belongs(workId)) continue;
    addClick(workId, c.productId, !c.anonymous, c.at);
  }
  // cliques das ofertas dinâmicas (Commerce Core)
  for (const a of Object.values(S().commerceActivations || {})) {
    if (!inPeriod(a.occurredAt, from, to) || !belongs(a.workId)) continue;
    addClick(a.workId, a.productId, true, a.occurredAt);
  }
  for (const s of S().sales || []) {
    if (!inPeriod(s.at, from, to)) continue;
    const workId = workOfSale(s); if (!belongs(workId)) continue;
    const rows = [total, W(workId), ...(s.productId ? [P(s.productId), WP(workId, s.productId)] : [])];
    const f = s.financials || {};
    if (s.productId) {
      const now = store.now();
      const status = s.reversed ? "estornado" : s.paidAt ? "pago" : (f.releaseAt && now < f.releaseAt) ? "custodia" : "liberado";
      WP(workId, s.productId).orderList.push({ saleId: s.id, at: s.at, store: storeName(s), orderId: s.orderId || null, value: round(s.value), commission: round(f.commission), clientShare: round(f.ownerShare), status, attribution: s.attribution || null });
    }
    if (s.reversed) { rows.forEach((r) => r.refunds++); continue; }
    const terms = termsFor({ workId, productId: s.productId, at: s.at });
    for (const r of rows) {
      r.orders++;
      r.gmv += Number(s.value || 0);
      r.commission += Number(f.commission || 0);
      r.clientShare += Number(f.ownerShare || 0);
      r.sceneshopShare += Number(f.sceneshopShare || 0);
      r.partnerShare += Number(f.partnerPart || 0);
      if (terms && terms.cpaFee) r.cpaFees += terms.cpaFee;
    }
  }
  // títulos sem movimento também aparecem
  for (const w of works) if (!w.archivedAt || byWork.has(w.id)) W(w.id);

  const months = from && to ? Math.max(1, Math.round((to - from) / (30 * 864e5))) : 1;
  const monthly = contract && contract.monthlyFee ? round(contract.monthlyFee * months) : 0;
  finalize(total);
  total.monthlyFees = monthly;
  total.sceneshopRevenue = round(total.sceneshopRevenue + monthly);
  // saldo: o que o cliente recebe da comissão menos o que paga ao SceneShop (cliques, pedidos, mensalidade)
  total.netToClient = round(total.clientShare - total.fees - monthly);
  return {
    organizationId, from, to, currency: (contract && contract.currency) || "BRL",
    contract: contract ? { version: contract.version, status: contract.status, contractRef: contract.contractRef, activeNow: active(contract, store.now()) } : null,
    totals: total,
    byWork: [...byWork.values()].map(finalize).map((w) => ({
      ...w,
      products: [...byWP.values()].filter((x) => x.workId === w.workId).map((x) => { const { orderList, ...row } = x; return { ...finalize(row), sales: orderList.sort((a, b) => b.at - a.at).slice(0, 200) }; })
        .sort((a, b) => b.gmv - a.gmv || b.clicks - a.clicks),
    })).sort((a, b) => b.gmv - a.gmv || b.clicks - a.clicks || a.title.localeCompare(b.title)),
    byProduct: [...byProduct.values()].map(finalize).sort((a, b) => b.gmv - a.gmv || b.clicks - a.clicks),
  };
}

const CSV_COLS = [["level", "Nível"], ["id", "ID"], ["name", "Nome"], ["clicks", "Cliques"], ["qualifiedClicks", "Cliques qualificados"], ["orders", "Pedidos"], ["refunds", "Estornos"], ["conversion", "Conversão %"],
  ["gmv", "Vendas (GMV)"], ["commission", "Comissão"], ["clientShare", "Parte do cliente"], ["sceneshopShare", "Parte SceneShop"], ["partnerShare", "Parte do canal parceiro"], ["cpcFees", "Taxa por clique"], ["cpaFees", "Taxa por pedido"]];
function toCsv(rep, orgName) {
  const esc = (v) => { const s = String(v ?? ""); return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const line = (level, id, name, r) => CSV_COLS.map(([k]) => esc(k === "level" ? level : k === "id" ? id : k === "name" ? name : r[k])).join(";");
  const out = [CSV_COLS.map(([, h]) => h).join(";")];
  out.push(line("cliente", rep.organizationId, orgName || rep.organizationId, rep.totals));
  rep.byWork.forEach((w) => {
    out.push(line("titulo", w.workId, w.title, w));
    (w.products || []).forEach((p) => out.push(line("titulo > produto", `${w.workId}/${p.productId}`, `${w.title} > ${p.name}`, p)));
  });
  rep.byProduct.forEach((p) => out.push(line("produto (todos os titulos)", p.productId, p.name, p)));
  // pedidos para conciliação
  const orders = [];
  rep.byWork.forEach((w) => (w.products || []).forEach((p) => (p.sales || []).forEach((o) => orders.push({ w, p, o }))));
  if (orders.length) {
    out.push("");
    out.push(["Pedidos", "Data", "Título", "Produto", "Loja", "Pedido na loja", "Valor", "Comissão", "Parte do cliente", "Situação"].join(";"));
    orders.sort((a, b) => b.o.at - a.o.at).forEach(({ w, p, o }) => out.push(["pedido", new Date(o.at).toISOString().slice(0, 10), w.title, p.name, o.store, o.orderId || o.saleId, o.value, o.commission, o.clientShare, o.status].map(esc).join(";")));
  }
  return "﻿" + out.join("\n") + "\n";
}

module.exports = { get, save, termsFor, termsForSale, workOrganization, workOfSale, workOfClick, report, toCsv, normalizeContract };
