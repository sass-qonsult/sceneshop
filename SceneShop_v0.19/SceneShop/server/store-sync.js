/**
 * Sincronização de vendas direto da loja (sem depender de a loja informar).
 *
 * A cada SCENESHOP_STORE_SYNC_MINUTES (padrão 10) o SceneShop lê os pedidos das lojas conectadas
 * e reconhece os que vieram de um clique: pelo cupom SS-XXXXXX ou pela referência of_… que o link
 * leva nas UTMs / URL de entrada. Pedido pago vira venda; cancelado ou devolvido estorna a comissão.
 *
 * Marketplaces (Mercado Livre, Amazon, Magalu) não abrem os pedidos a terceiros: o relatório do
 * programa de afiliados é importado em CSV (importReport).
 */
"use strict";
const store = require("./store");
const audit = require("./audit");
const catalog = require("./catalog");
const official = require("./official");
const connectors = require("./store-connectors");
const { parsePrice } = require("./price");

const S = () => store.state;
const REF_RE = /\bof_[A-Za-z0-9_-]{10,16}\b/;
const CODE_RE = /\bSS-[2-9A-HJ-NP-Z]{6}\b/i;
const OVERLAP = 2 * 24 * 3600e3;  // relê 2 dias: pedidos aprovados ou cancelados depois

function findRef(order) {
  for (const c of order.coupons || []) {
    const ref = (S().issuedCoupons || {})[String(c).toUpperCase()];
    if (ref) return { ref, how: "loja_cupom" };
  }
  for (const t of order.refs || []) {
    const m = REF_RE.exec(String(t));
    if (m && S().issuedOffers[m[0]]) return { ref: m[0], how: order.network ? "rede_afiliados" : "loja_link" };
  }
  return null;
}

/** Preço do item do clique: pelo SKU do produto; senão o único item; senão o item mais caro dentro do preço garantido. */
function itemFor(order, payload) {
  const prod = catalog.getProduct(payload.pid) || {};
  const items = (order.items || []).filter((i) => i.price > 0);
  if (prod.sku) { const hit = items.find((i) => i.sku && i.sku.toLowerCase() === String(prod.sku).toLowerCase()); if (hit) return { ...hit, match: "sku" }; }
  if (items.length === 1) return { ...items[0], match: "único item" };
  const cap = payload.prc / 100 + 0.001;
  const within = items.filter((i) => i.price <= cap).sort((a, b) => b.price - a.price);
  if (within.length) return { ...within[0], match: "estimado" };
  if (items.length) return { ...items[0], match: "estimado" };
  // sem itens (rede de afiliados): o valor da venda inteiro, dividido em unidades que não passam do preço garantido
  const qty = Math.min(20, Math.max(1, Math.ceil(Number(order.total || 0) / (payload.prc / 100) - 1e-9)));
  return { price: Math.round((Number(order.total || 0) / qty) * 100) / 100, qty, match: "total do pedido" };
}

async function syncSeller(seller, deps, { since } = {}) {
  const conn = connectors.connectorFor(seller, { save: () => store.save() });
  const status = connectors.credentialStatus(seller);
  if (!conn || !status.ready) return { error: status.missing.length ? `Faltam no servidor: ${status.missing.join(", ")}` : "Loja sem conexão.", code: 400 };
  const c = seller.connection;
  const from = since || Math.max(0, (c.lastSyncAt || Date.now() - 7 * 24 * 3600e3) - OVERLAP);
  const result = { lidos: 0, reconhecidos: 0, vendas: 0, estornos: 0, recusados: 0, erros: [] };
  try {
    const orders = await conn.listOrders({ since: from });
    result.lidos = orders.length;
    for (const o of orders) {
      const hit = findRef(o);
      if (!hit) continue;
      const p = S().issuedOffers[hit.ref];
      if (!p || p.sid !== seller.id) continue;
      result.reconhecidos++;
      if (o.status === "paid") {
        const it = itemFor(o, p);
        const r = await Promise.resolve(official.processOrder(seller, { orderId: o.orderId, ref: hit.ref, unitPrice: it.price, quantity: it.qty, orderedAt: o.createdAt, via: hit.how }, deps));
        if (r && r.ok && !r.duplicate) { result.vendas++; audit.log("sistema", "venda_sincronizada", { sellerId: seller.id, orderId: o.orderId, ref: hit.ref, via: hit.how, item: it.match }); }
        else if (r && r.error) { result.recusados++; result.erros.push(`${o.orderId}: ${r.error}`); }
      } else if (o.status === "cancelled") {
        const known = S().orders.find((x) => x.sellerId === seller.id && x.orderId === o.orderId && x.status === "pago");
        if (known) { const r = await Promise.resolve(official.processOrder(seller, { orderId: o.orderId, status: "devolvido" }, deps)); if (r && r.ok && !r.duplicate) result.estornos++; }
      }
    }
    c.lastSyncAt = Date.now(); c.lastSync = c.lastSyncAt; c.lastError = null;
  } catch (e) {
    c.lastError = String(e.message || e).slice(0, 200);
    result.erros.push(c.lastError);
  }
  result.erros = result.erros.slice(0, 20);
  c.lastResult = { ...result, at: Date.now() };
  store.save();
  return { ok: !c.lastError, ...result };
}

async function syncAll(deps) {
  for (const s of Object.values(S().sellers || {})) {
    if (s.active === false || !s.connection || !connectors.credentialStatus(s).ready) continue;
    try { await syncSeller(s, deps); } catch (e) { console.error(`[loja] sincronização ${s.id}: ${e.message}`); }
  }
}

let timer = null;
function start(deps) {
  const minutes = Number(process.env.SCENESHOP_STORE_SYNC_MINUTES || 10);
  if (!(minutes > 0) || timer) return;
  timer = setInterval(() => { syncAll(deps).catch(() => {}); }, minutes * 60e3);
  timer.unref && timer.unref();
}
function stop() { clearInterval(timer); timer = null; }

// ------------------------------------------------------------------ relatório de afiliados (CSV)
function parseCsv(text) {
  const lines = String(text || "").replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return [];
  const sep = (lines[0].match(/;/g) || []).length > (lines[0].match(/,/g) || []).length ? ";" : lines[0].includes("\t") ? "\t" : ",";
  const split = (l) => { const out = []; let cur = "", q = false; for (let i = 0; i < l.length; i++) { const ch = l[i]; if (ch === '"') { if (q && l[i + 1] === '"') { cur += '"'; i++; } else q = !q; } else if (ch === sep && !q) { out.push(cur); cur = ""; } else cur += ch; } out.push(cur); return out.map((x) => x.trim()); };
  const head = split(lines[0]).map((h) => h.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, ""));
  return lines.slice(1).map((l) => { const cells = split(l); const row = {}; head.forEach((h, i) => (row[h] = cells[i] ?? "")); row.__cells = cells; return row; });
}
const pick = (row, names) => { for (const k of Object.keys(row)) if (names.some((n) => k.includes(n))) return row[k]; return ""; };
function parseDate(v) {
  const s = String(v || "").trim(); if (!s) return null;
  const br = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s);
  const t = br ? Date.parse(`${br[3]}-${br[2].padStart(2, "0")}-${br[1].padStart(2, "0")}T12:00:00`) : Date.parse(s);
  return isNaN(t) ? null : t;
}

/** Importa o relatório do programa de afiliados (Mercado Livre, Amazon, Magalu...). */
async function importReport(organizationId, sellerId, csv, actor, deps) {
  const seller = official.ownSeller(organizationId, sellerId);
  if (!seller) return { error: "Loja não encontrada nesta organização.", code: 404 };
  const rows = parseCsv(csv).slice(0, 5000);
  if (!rows.length) return { error: "Arquivo vazio ou sem cabeçalho." };
  const out = { linhas: rows.length, vendas: 0, semReferencia: 0, duplicadas: 0, recusadas: 0, erros: [] };
  seller.affiliateSales = seller.affiliateSales || [];
  for (const row of rows) {
    const orderId = String(pick(row, ["pedido", "order", "id da venda", "venda", "id"]) || "").slice(0, 64);
    const value = parsePrice(pick(row, ["valor", "value", "amount", "preco", "price", "total"]));
    const commission = parsePrice(pick(row, ["comiss", "commission", "ganho", "earning"]));
    let at = parseDate(pick(row, ["data", "date"])) || Date.now();
    const status = String(pick(row, ["status", "situa"]) || "").toLowerCase();
    const joined = row.__cells.join(" ");
    const ref = (REF_RE.exec(joined) || [])[0] || ((S().issuedCoupons || {})[((CODE_RE.exec(joined) || [])[0] || "").toUpperCase()]);
    if (!orderId) { out.recusadas++; continue; }
    if (ref && S().issuedOffers[ref] && S().issuedOffers[ref].sid === seller.id) {
      // relatório com só a data (sem hora): vale o momento do clique, se for no mesmo dia
      const off = S().issuedOffers[ref];
      if (!/\d{1,2}:\d{2}/.test(String(pick(row, ["data", "date"]))) && at > off.iat - 36 * 3600e3 && at < off.exp + 36 * 3600e3) at = Math.min(Math.max(at, off.iat + 1000), off.exp, Math.max(off.iat + 1000, store.now())); // nunca no futuro (relatório de hoje importado de manhã)
      const cancelled = /cancel|devolv|estorn|refund/.test(status);
      const r = await Promise.resolve(official.processOrder(seller, cancelled ? { orderId, status: "devolvido" } : { orderId, ref, unitPrice: value, quantity: 1, orderedAt: at, via: "relatorio_afiliado" }, deps));
      if (r && r.duplicate) out.duplicadas++; else if (r && r.ok) out.vendas++; else { out.recusadas++; if (r && r.error) out.erros.push(`${orderId}: ${r.error}`); }
      continue;
    }
    // sem referência do SceneShop: entra no desempenho da loja (receita/comissão do programa), sem atribuir a trilha
    if (seller.affiliateSales.some((x) => x.orderId === orderId)) { out.duplicadas++; continue; }
    seller.affiliateSales.push({ orderId, value: Number.isFinite(value) ? value : 0, commission: Number.isFinite(commission) ? commission : 0, at, status: status || "pago", tag: String(pick(row, ["etiqueta", "tag", "tracking", "subid", "sub id"]) || "").slice(0, 60) });
    out.semReferencia++;
  }
  out.erros = out.erros.slice(0, 20);
  audit.log(actor, "relatorio_afiliado_importado", { sellerId, linhas: out.linhas, vendas: out.vendas, semReferencia: out.semReferencia });
  store.save();
  return { ok: true, ...out };
}

/** Desempenho por loja: cliques enviados, vendas confirmadas por origem, receita e comissão. */
function performance(organizationId) {
  const sellers = Object.values(S().sellers || {}).filter((s) => s.organizationId === organizationId);
  return sellers.map((s) => {
    const clicks = Object.values(S().issuedOffers || {}).filter((p) => p.sid === s.id);
    const orders = (S().orders || []).filter((o) => o.sellerId === s.id && o.status === "pago");
    const sales = new Map((S().sales || []).filter((x) => x.store === s.id || x.sellerId === s.id).map((x) => [x.id, x]));
    const byVia = {};
    let revenue = 0, commission = 0;
    for (const o of orders) {
      byVia[o.via || "referencia"] = (byVia[o.via || "referencia"] || 0) + 1;
      revenue += Number(o.amount || 0);
      const sale = sales.get(o.saleId); if (sale && sale.financials) commission += Number(sale.financials.commission || 0);
    }
    const aff = (s.affiliateSales || []).filter((x) => !/cancel|devolv|estorn|refund/.test(x.status || ""));
    return {
      sellerId: s.id, name: s.name, platform: s.connection && connectors.PLATFORMS[s.connection.platform] || null,
      clicks: clicks.length, coupons: clicks.filter((p) => p.cpn).length, orders: orders.length, revenue: Math.round(revenue * 100) / 100, commission: Math.round(commission * 100) / 100,
      conversion: clicks.length ? Math.round((orders.length / clicks.length) * 1000) / 10 : 0, byVia,
      affiliate: { orders: aff.length, revenue: Math.round(aff.reduce((n, x) => n + x.value, 0) * 100) / 100, commission: Math.round(aff.reduce((n, x) => n + x.commission, 0) * 100) / 100 },
      lastSync: s.connection && s.connection.lastSync || null, lastError: s.connection && s.connection.lastError || null, lastResult: s.connection && s.connection.lastResult || null,
    };
  });
}

module.exports = { syncSeller, syncAll, start, stop, importReport, performance, parseCsv, findRef, itemFor };
