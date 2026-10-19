// Simulador das APIs de loja (VTEX, Shopify, Nuvemshop) para os testes da sincronização de vendas.
// Uso: node test/store-mock.mjs 3996   ->  /vtex  /shopify  /nuvem
// Controle: POST /__order { platform, id, coupon?, landing?, utmCampaign?, sku, price, qty, status }  ·  GET /__state
import http from "node:http";

export function start(port = 3996) {
  const st = { coupons: { vtex: [], shopify: [], nuvem: [] }, orders: { vtex: [], shopify: [], nuvem: [], awin: [] }, priceRules: [], auth: [] };
  const json = (res, code, body, headers = {}) => { res.writeHead(code, { "Content-Type": "application/json", ...headers }); res.end(JSON.stringify(body)); };
  const read = (req) => new Promise((r) => { let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => { try { r(b ? JSON.parse(b) : {}); } catch (e) { r({}); } }); });
  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url, "http://x");
    const p = u.pathname;
    if (p === "/__state") return json(res, 200, st);
    if (p === "/__order" && req.method === "POST") {
      const o = await read(req);
      const list = st.orders[o.platform];
      const i = list.findIndex((x) => x.id === o.id);
      if (i >= 0) list[i] = { ...list[i], ...o }; else list.push({ created: new Date().toISOString(), ...o });
      return json(res, 200, { ok: true });
    }
    // ---------------- VTEX
    if (p.startsWith("/vtex/")) {
      st.auth.push(["vtex", req.headers["x-vtex-api-appkey"], req.headers["x-vtex-api-apptoken"]]);
      if (req.headers["x-vtex-api-apptoken"] !== "vtex-token") return json(res, 401, { message: "unauthorized" });
      if (p === "/vtex/api/rnb/pvt/coupon" && req.method === "POST") { const b = await read(req); st.coupons.vtex.push(b); return json(res, 200, b); }
      if (p === "/vtex/api/oms/pvt/orders") return json(res, 200, { list: st.orders.vtex.map((o) => ({ orderId: o.id, creationDate: o.created, status: o.status, totalValue: Math.round(o.price * (o.qty || 1) * 100) })), paging: {} });
      const m = /^\/vtex\/api\/oms\/pvt\/orders\/(.+)$/.exec(p);
      if (m) { const o = st.orders.vtex.find((x) => x.id === decodeURIComponent(m[1])); if (!o) return json(res, 404, {});
        return json(res, 200, { orderId: o.id, status: o.status, creationDate: o.created, value: Math.round(o.price * (o.qty || 1) * 100), marketingData: { coupon: o.coupon || null, utmCampaign: o.utmCampaign || null, utmSource: "sceneshop" }, items: [{ refId: o.sku, sellingPrice: Math.round(o.price * 100), quantity: o.qty || 1 }] }); }
    }
    // ---------------- Shopify
    if (p.startsWith("/shopify/")) {
      if (req.headers["x-shopify-access-token"] !== "shop-token") return json(res, 401, { errors: "Invalid API key or access token" });
      if (p === "/shopify/shop.json") return json(res, 200, { shop: { id: 1 } });
      if (p === "/shopify/price_rules.json" && req.method === "POST") { const b = await read(req); const r = { id: 900 + st.priceRules.length, ...b.price_rule }; st.priceRules.push(r); return json(res, 201, { price_rule: r }); }
      const dc = /^\/shopify\/price_rules\/(\d+)\/discount_codes\.json$/.exec(p);
      if (dc && req.method === "POST") { const b = await read(req); st.coupons.shopify.push({ rule: Number(dc[1]), ...b.discount_code }); return json(res, 201, { discount_code: b.discount_code }); }
      if (p === "/shopify/orders.json") return json(res, 200, { orders: st.orders.shopify.map((o) => ({ id: o.id, name: `#${o.id}`, created_at: o.created, financial_status: o.status, cancelled_at: o.cancelled ? o.created : null, total_price: String(o.price * (o.qty || 1)), discount_codes: o.coupon ? [{ code: o.coupon }] : [], landing_site: o.landing || null, line_items: [{ sku: o.sku, price: String(o.price), quantity: o.qty || 1 }] })) });
    }
    // ---------------- Awin (publisher API)
    const aw = /^\/awin\/publishers\/(\d+)\/transactions\/$/.exec(p);
    if (aw) {
      if (u.searchParams.get("accessToken") !== "awin-token") return json(res, 401, { error: "unauthorized" });
      if (!u.searchParams.get("startDate") || u.searchParams.get("timezone") !== "UTC") return json(res, 400, { error: "bad params" });
      return json(res, 200, st.orders.awin.map((o) => ({ id: o.id, advertiserId: o.advertiserId, saleAmount: { amount: o.price, currency: "BRL" }, commissionAmount: { amount: o.commission || 0, currency: "BRL" }, commissionStatus: o.status, transactionDate: o.created.slice(0, 19), clickRefs: { clickRef: o.clickref } })));
    }
    // ---------------- Nuvemshop
    if (p.startsWith("/nuvem/")) {
      if (req.headers["authentication"] !== "bearer nuvem-token") return json(res, 401, { description: "unauthorized" });
      if (p === "/nuvem/coupons" && req.method === "POST") { const b = await read(req); st.coupons.nuvem.push(b); return json(res, 201, { id: st.coupons.nuvem.length, ...b }); }
      if (p === "/nuvem/orders") { if (Number(u.searchParams.get("page") || 1) > 1) return json(res, 404, { description: "Last page is 1" });
        return json(res, 200, st.orders.nuvem.map((o) => ({ id: o.id, number: o.id, created_at: o.created, status: o.cancelled ? "cancelled" : "open", payment_status: o.status, total: String(o.price * (o.qty || 1)), coupon: o.coupon ? [{ code: o.coupon }] : [], landing_url: o.landing || null, products: [{ sku: o.sku, price: String(o.price), quantity: o.qty || 1 }] }))); }
    }
    json(res, 404, { error: "not found", path: p });
  });
  return new Promise((r) => server.listen(port, "127.0.0.1", () => r({ server, st, base: `http://127.0.0.1:${port}` })));
}

if (import.meta.url === `file://${process.argv[1]}`) start(Number(process.argv[2]) || 3996).then(({ base }) => console.log(`store mock em ${base}`));
