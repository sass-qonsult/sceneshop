// rcprep.17: conciliação em cascata cliente/canal → título → produto → pedidos, CSV com a mesma hierarquia
// e os pedidos, e o servidor informando qual entrega está instalada (build em /api/health e /api/live).
//   node test/rcprep17.api.mjs            (memória)
//   RC17_BACKEND=postgres DATABASE_URL=... node test/rcprep17.api.mjs
import assert from "node:assert/strict";

const PG = process.env.RC17_BACKEND === "postgres";
if (!PG) process.env.SCENESHOP_MEMORY = "1";
Object.assign(process.env, {
  DEMO: "1", DATA_BACKEND: PG ? "postgres" : "memory", SESSION_BACKEND: "memory",
  SESSION_SECRET: "sceneshop-rcprep17-secret-0123456789abcdef",
});
const { bootstrap, server, shutdown } = await import("../server/index.js");
const store = (await import("../server/store.js")).default;

let base;
const tokens = {};
const req = async (p, { method = "GET", body, as, org } = {}) => {
  const headers = { ...(as ? { authorization: `Bearer ${tokens[as]}` } : {}), ...(org ? { "x-sceneshop-organization": org } : {}) };
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(base + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const t = res.headers.get("content-type") || "";
  return { status: res.status, type: t, data: t.includes("json") ? await res.json() : await res.text() };
};
const ok = (cond, msg) => { assert.ok(cond, msg); console.log("  ✓", msg); };
const near = (a, b) => Math.abs(Number(a) - Number(b)) < 0.011;

let failed = false;
try {
  await bootstrap();
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
  await req("/api/dev/reset?all=1", { method: "POST" });
  for (const u of ["moderador", "produtora"]) tokens[u] = (await req("/api/auth/login", { method: "POST", body: { username: u, password: "demo1234" } })).data.token;
  const ORG = "org-demo-produtora";

  const health = (await req("/api/health")).data, live = (await req("/api/live")).data;
  ok(health.build && live.build === health.build && /^rcprep\.1[7-9]/.test(health.build), "o servidor informa a entrega instalada (build) em /api/health e /api/live");

  // uma venda nova para ter pedido conhecido
  const antifraud = (await import("../server/antifraud.js")).default || (await import("../server/antifraud.js"));
  const money = (await import("../server/money.js")).default || (await import("../server/money.js"));
  const tr = Object.values(store.state.tracks).find((t) => t.workId === "demo-01" && t.type === "official");
  const pid = tr.scenes.flatMap((s) => s.products.map((p) => p.id))[0];
  const { click } = await Promise.resolve(antifraud.registerClick({ trackId: tr.id, productId: pid, storeId: "amazon", deviceId: "viewer-rc17-conciliacao" }));
  const sale = money.registerSale({ clickId: click.id, value: 777, storeId: "amazon" });

  const det = (await req(`/api/admin/clients/${ORG}?days=3650`, { as: "moderador" })).data;
  const w = det.report.byWork.find((x) => x.workId === "demo-01");
  ok(w && Array.isArray(w.products) && w.products.length > 0, `cascata: cliente → título "${w.title}" → ${w.products.length} produtos`);
  const p = w.products.find((x) => x.productId === pid);
  ok(p && p.sales.some((o) => o.saleId === sale.id && near(o.value, 777) && o.status === "custodia" && o.store), "cada produto do título traz os pedidos (data, loja, valor, comissão, parte do cliente, situação)");
  const sumOrders = w.products.reduce((n, x) => n + x.sales.filter((o) => o.status !== "estornado").length, 0);
  ok(sumOrders === w.orders && w.products.every((x) => typeof x.orders === "number") && near(w.products.reduce((n, x) => n + x.gmv, 0), w.gmv), "os produtos somam exatamente o título (pedidos e vendas): a conciliação fecha");
  const totalsByWorks = det.report.byWork.reduce((n, x) => n + x.orders, 0);
  ok(totalsByWorks === det.report.totals.orders, "os títulos somam exatamente o total do cliente");

  const csv = (await req(`/api/admin/clients/${ORG}/report.csv?days=3650`, { as: "moderador" })).data;
  ok(/titulo > produto;demo-01\//.test(csv) && /\nPedidos;Data;Título;Produto;Loja/.test(csv) && csv.includes(sale.id), "CSV com título › produto e a lista de pedidos para conciliação");

  const me = (await req("/api/me/account-report?days=3650", { as: "produtora", org: ORG })).data;
  ok(me.report.byWork.find((x) => x.workId === "demo-01").products.some((x) => x.sales.some((o) => o.saleId === sale.id)), "o cliente vê a mesma cascata da própria conta");
} catch (e) {
  failed = true;
  console.error("✗ FALHOU:", e.stack || e.message);
} finally {
  await new Promise((r) => server.close(r));
  await (shutdown ? shutdown().catch(() => {}) : null);
  console.log(failed ? "\nrcprep.17: FALHOU" : "\nrcprep.17: tudo certo");
  process.exit(failed ? 1 : 0);
}
