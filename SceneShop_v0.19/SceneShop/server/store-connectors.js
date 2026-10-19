/**
 * Conexão direta com a loja oficial (VTEX, Shopify, Nuvemshop): o SceneShop cria o cupom de cada
 * clique na própria loja e lê os pedidos dela, sem depender de a loja informar as vendas.
 *
 * As credenciais NUNCA ficam no banco do SceneShop: vêm do ambiente (sceneshop.env / secret manager),
 * com o prefixo SCENESHOP_LOJA_<ID DA LOJA>, por exemplo para a loja "jbl-oficial":
 *   SCENESHOP_LOJA_JBL_OFICIAL_KEY     (VTEX: X-VTEX-API-AppKey)
 *   SCENESHOP_LOJA_JBL_OFICIAL_TOKEN   (VTEX: AppToken · Shopify: Admin API access token · Nuvemshop: access token)
 *   SCENESHOP_LOJA_JBL_OFICIAL_API     (opcional: endereço da API, usado em testes/homologação)
 *
 * Todo conector responde:
 *   createCoupon({ code, discountPct, expiresAt })  -> { ok, applyUrl?(productUrl) }
 *   listOrders({ since })                            -> [{ orderId, status: "paid"|"cancelled"|"pending",
 *                                                         coupons: [], refs: [texto com UTMs/landing], total,
 *                                                         items: [{ sku, price, qty }], createdAt }]
 */
"use strict";

const PLATFORMS = {
  vtex: "VTEX",
  shopify: "Shopify",
  nuvemshop: "Nuvemshop",
  awin: "Awin (rede de afiliados)",
  afiliado: "Marketplace (programa de afiliados)",
};

const envPrefix = (sellerId) => "SCENESHOP_LOJA_" + String(sellerId).toUpperCase().replace(/[^A-Z0-9]+/g, "_");
function credentials(seller) {
  const p = envPrefix(seller.id), e = (k) => String(process.env[`${p}_${k}`] || "").trim();
  return { prefix: p, key: e("KEY"), token: e("TOKEN"), api: e("API").replace(/\/$/, "") };
}
function credentialStatus(seller) {
  const c = seller.connection || {}, cr = credentials(seller);
  const needs = c.platform === "vtex" ? ["KEY", "TOKEN"] : ["shopify", "nuvemshop", "awin"].includes(c.platform) ? ["TOKEN"] : [];
  const missing = needs.filter((k) => !cr[k.toLowerCase()]).map((k) => `${cr.prefix}_${k}`);
  return { prefix: cr.prefix, needs: needs.map((k) => `${cr.prefix}_${k}`), missing, ready: !!c.platform && c.platform !== "afiliado" && !missing.length };
}

async function http(url, { method = "GET", headers = {}, body, timeout = 15000 } = {}) {
  const res = await fetch(url, { method, headers: { Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(timeout) });
  const text = await res.text();
  let data = null; try { data = text ? JSON.parse(text) : null; } catch (e) { data = text; }
  if (!res.ok) {
    const msg = data && typeof data === "object" ? (data.message || data.error || data.errors && JSON.stringify(data.errors) || data.description) : String(text).slice(0, 200);
    const err = new Error(`${res.status} ${msg || res.statusText}`); err.status = res.status; throw err;
  }
  return data;
}
const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);
const withQuery = (u, params) => { const url = new URL(u); for (const [k, v] of Object.entries(params)) if (v != null && v !== "") url.searchParams.set(k, v); return url.toString(); };

// ------------------------------------------------------------------ VTEX
// O cupom VTEX aponta para uma promoção pela utm_source: a loja cria UMA promoção "SceneShop"
// (condição utm_source = sceneshop, com o desconto combinado); o SceneShop cria um cupom por clique.
// A VTEX também grava utm_campaign do link em marketingData: o pedido é reconhecido mesmo sem cupom.
function vtex(seller) {
  const c = seller.connection, cr = credentials(seller);
  const base = cr.api || `https://${c.account}.vtexcommercestable.com.br`;
  const headers = { "X-VTEX-API-AppKey": cr.key, "X-VTEX-API-AppToken": cr.token };
  const utmSource = c.utmSource || "sceneshop";
  const mapStatus = (s) => /cancel/.test(s) ? "cancelled" : /^(payment-approved|ready-for-handling|start-handling|handling|invoiced|invoice)$/.test(s) ? "paid" : "pending";
  return {
    async test() { await http(withQuery(`${base}/api/oms/pvt/orders`, { page: 1, per_page: 1 }), { headers }); return { ok: true }; },
    async createCoupon({ code }) {
      await http(`${base}/api/rnb/pvt/coupon`, { method: "POST", headers, body: { couponCode: code, utmSource, utmCampaign: code, isArchived: false, maxItemsPerClient: 0, expirationIntervalPerUse: "00:00:00" } });
      return { ok: true };
    },
    linkParams: (ref) => ({ utm_source: utmSource, utm_medium: "scene", utm_campaign: ref, utmi_cp: ref }),
    async listOrders({ since }) {
      const out = [];
      const range = `creationDate:[${new Date(since).toISOString()} TO ${new Date().toISOString()}]`;
      for (let page = 1; page <= 30; page++) {
        const list = await http(withQuery(`${base}/api/oms/pvt/orders`, { f_creationDate: range, page, per_page: 100, orderBy: "creationDate,asc" }), { headers });
        const rows = (list && list.list) || [];
        for (const r of rows) {
          const o = await http(`${base}/api/oms/pvt/orders/${encodeURIComponent(r.orderId)}`, { headers });
          const m = o.marketingData || {};
          out.push({
            orderId: o.orderId, status: mapStatus(String(o.status || r.status || "")),
            coupons: [m.coupon].filter(Boolean), refs: [m.utmCampaign, m.utmiCampaign, m.utmiPart, m.utmMedium].filter(Boolean),
            total: Number(o.value || r.totalValue || 0) / 100,
            items: (o.items || []).map((i) => ({ sku: String(i.refId || i.sellerSku || i.id || ""), price: Number(i.sellingPrice ?? i.price) / 100, qty: Number(i.quantity) || 1 })),
            createdAt: Date.parse(o.creationDate || r.creationDate) || Date.now(),
          });
        }
        if (rows.length < 100) break;
      }
      return out;
    },
  };
}

// ------------------------------------------------------------------ Shopify
// Uma regra de preço "SceneShop" (criada pelo SceneShop na primeira conexão, com o desconto da loja)
// e um código por clique. O link /discount/<código>?redirect=<produto> já aplica o cupom no carrinho.
// landing_site do pedido guarda a URL de entrada (com ss_ref): reconhece o pedido mesmo sem cupom.
function shopify(seller, { save } = {}) {
  const c = seller.connection, cr = credentials(seller);
  const shop = String(c.account || "").replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  const base = cr.api || `https://${shop}/admin/api/2024-10`;
  const headers = { "X-Shopify-Access-Token": cr.token };
  async function priceRule(discountPct) {
    if (c.priceRuleId) return c.priceRuleId;
    const r = await http(`${base}/price_rules.json`, { method: "POST", headers, body: { price_rule: {
      title: "SceneShop", target_type: "line_item", target_selection: "all", allocation_method: "across",
      value_type: "percentage", value: `-${Number(discountPct).toFixed(1)}`, customer_selection: "all", starts_at: new Date().toISOString() } } });
    c.priceRuleId = r.price_rule.id; if (save) save();
    return c.priceRuleId;
  }
  return {
    async test() { await http(`${base}/shop.json`, { headers }); return { ok: true }; },
    async createCoupon({ code, discountPct }) {
      if (!(Number(discountPct) > 0)) return { ok: false, reason: "sem desconto: o pedido é reconhecido pelo link (landing_site)" };
      const id = await priceRule(discountPct);
      await http(`${base}/price_rules/${id}/discount_codes.json`, { method: "POST", headers, body: { discount_code: { code } } });
      return { ok: true, applyUrl: (productUrl) => { const u = new URL(productUrl); return `${u.origin}/discount/${encodeURIComponent(code)}?redirect=${encodeURIComponent(u.pathname + u.search)}`; } };
    },
    linkParams: (ref) => ({ ss_ref: ref, utm_source: "sceneshop", utm_medium: "scene", utm_campaign: ref }),
    async listOrders({ since }) {
      const out = [];
      let url = withQuery(`${base}/orders.json`, { status: "any", updated_at_min: new Date(since).toISOString(), limit: 250 });
      for (let i = 0; i < 20 && url; i++) {
        const res = await fetch(url, { headers: { ...headers, Accept: "application/json" }, signal: AbortSignal.timeout(15000) });
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        const data = await res.json();
        for (const o of data.orders || []) {
          const fs = String(o.financial_status || "");
          out.push({
            orderId: String(o.name || o.id), status: o.cancelled_at || /refunded|voided/.test(fs) ? "cancelled" : /paid/.test(fs) ? "paid" : "pending",
            coupons: (o.discount_codes || []).map((d) => d.code), refs: [o.landing_site, o.referring_site, o.note].filter(Boolean),
            total: Number(o.total_price || 0),
            items: (o.line_items || []).map((l) => ({ sku: String(l.sku || ""), price: Number(l.price), qty: Number(l.quantity) || 1 })),
            createdAt: Date.parse(o.created_at) || Date.now(),
          });
        }
        const link = res.headers.get("link") || "";
        const next = /<([^>]+)>;\s*rel="next"/.exec(link);
        url = next ? next[1] : null;
      }
      return out;
    },
  };
}

// ------------------------------------------------------------------ Nuvemshop
// Cupom de uso único com o desconto da loja; o comprador vê o código antes de ir à loja.
function nuvemshop(seller) {
  const c = seller.connection, cr = credentials(seller);
  const base = cr.api || `https://api.nuvemshop.com.br/v1/${encodeURIComponent(c.account)}`;
  const headers = { Authentication: `bearer ${cr.token}`, "User-Agent": "SceneShop (https://sceneshop.app)" };
  return {
    async test() { await http(withQuery(`${base}/orders`, { per_page: 1 }), { headers }); return { ok: true }; },
    async createCoupon({ code, discountPct, expiresAt }) {
      if (!(Number(discountPct) > 0)) return { ok: false, reason: "sem desconto: o pedido é reconhecido pelo link" };
      await http(`${base}/coupons`, { method: "POST", headers, body: { code, type: "percentage", value: Number(discountPct).toFixed(2), max_uses: 1, start_date: isoDay(Date.now()), end_date: isoDay(expiresAt) } });
      return { ok: true };
    },
    linkParams: (ref) => ({ ss_ref: ref, utm_source: "sceneshop", utm_medium: "scene", utm_campaign: ref }),
    async listOrders({ since }) {
      const out = [];
      for (let page = 1; page <= 30; page++) {
        let rows;
        try { rows = await http(withQuery(`${base}/orders`, { updated_at_min: new Date(since).toISOString(), per_page: 200, page }), { headers }); }
        catch (e) { if (e.status === 404) break; throw e; } // a Nuvemshop responde 404 quando a página não existe
        for (const o of rows || []) {
          const ps = String(o.payment_status || ""), st = String(o.status || "");
          out.push({
            orderId: String(o.number || o.id), status: st === "cancelled" || /refunded|voided/.test(ps) ? "cancelled" : ps === "paid" ? "paid" : "pending",
            coupons: (o.coupon || []).map((x) => x.code || x).filter(Boolean), refs: [o.landing_url, o.note, o.owner_note].filter(Boolean),
            total: Number(o.total || 0),
            items: (o.products || []).map((p) => ({ sku: String(p.sku || ""), price: Number(p.price), qty: Number(p.quantity) || 1 })),
            createdAt: Date.parse(o.created_at) || Date.now(),
          });
        }
        if (!rows || rows.length < 200) break;
      }
      return out;
    },
  };
}

// ------------------------------------------------------------------ Awin (rede de afiliados)
// Marcas como Oakley e JBL vendem pelo próprio site (Salesforce/SAP Commerce) e pagam afiliados pela Awin.
// O SceneShop entra como publisher: o link de cada clique leva clickref=<referência of_…> e a Awin
// devolve, pela API de transações, cada venda com esse clickref. Nada depende da loja informar.
//   conta = ID do publisher SceneShop na Awin · advertiserId = ID do anunciante (awinmid)
function awin(seller) {
  const c = seller.connection, cr = credentials(seller);
  const base = cr.api || "https://api.awin.com";
  const fmt = (ms) => new Date(ms).toISOString().slice(0, 19);
  const q = (from, to) => withQuery(`${base}/publishers/${encodeURIComponent(c.account)}/transactions/`, { startDate: fmt(from), endDate: fmt(to), timezone: "UTC", dateType: "transaction", advertiserId: c.advertiserId || undefined, accessToken: cr.token });
  return {
    async test() { const now = Date.now(); await http(q(now - 24 * 3600e3, now)); return { ok: true }; },
    async createCoupon() { return { ok: false, reason: "Awin: a venda é reconhecida pelo clickref do link" }; },
    buildLink(productUrl, ref) {
      return withQuery("https://www.awin1.com/cread.php", { awinmid: c.advertiserId, awinaffid: c.account, clickref: ref, ued: productUrl });
    },
    linkParams: () => ({}),
    async listOrders({ since }) {
      const out = [], now = Date.now();
      for (let from = since; from < now; from += 30 * 24 * 3600e3) {
        const rows = await http(q(from, Math.min(now, from + 30 * 24 * 3600e3)));
        for (const t of rows || []) {
          if (c.advertiserId && String(t.advertiserId) !== String(c.advertiserId)) continue;
          const st = String(t.commissionStatus || "");
          const refs = Object.values(t.clickRefs || {}).filter(Boolean);
          out.push({
            network: "awin", orderId: `AWIN-${t.id}`, status: /declined|deleted/.test(st) ? "cancelled" : /pending|approved/.test(st) ? "paid" : "pending",
            coupons: [], refs, total: Number((t.saleAmount || {}).amount || 0), items: [],
            networkCommission: Number((t.commissionAmount || {}).amount || 0),
            createdAt: Date.parse(String(t.transactionDate || "").replace(/(\d)$/, "$1Z")) || Date.now(),
          });
        }
      }
      return out;
    },
  };
}

function connectorFor(seller, opts) {
  const p = seller && seller.connection && seller.connection.platform;
  if (p === "vtex") return vtex(seller, opts);
  if (p === "shopify") return shopify(seller, opts);
  if (p === "nuvemshop") return nuvemshop(seller, opts);
  if (p === "awin") return awin(seller, opts);
  return null;
}

module.exports = { PLATFORMS, envPrefix, credentials, credentialStatus, connectorFor };
