// Cupom SceneShop por clique e leitura dos pedidos direto da loja (VTEX, Shopify, Nuvemshop) contra o simulador.
const test = require("node:test");
const assert = require("node:assert/strict");

test("cupom por clique criado na loja e venda lida da loja, sem a loja informar", async (t) => {
  const { start } = await import("./store-mock.mjs");
  const mock = await start(0 || 39961);
  t.after(() => mock.server.close());
  const store = require("../server/store");
  store.useMemory();
  const catalog = require("../server/catalog");
  const official = require("../server/official");
  const sync = require("../server/store-sync");
  const deps = { money: require("../server/money"), aml: require("../server/aml") };
  const org = "org-sync";
  const env = (id, k, v) => (process.env[`SCENESHOP_LOJA_${id.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_${k}`] = v);

  const mk = (name, platform, account, pct, api, creds) => {
    const r = official.createSeller(org, { name, storeUrl: "https://loja.example.com", platform, account, couponDiscountPct: pct }, "u");
    assert.ok(r.seller, JSON.stringify(r));
    const id = r.seller.id;
    for (const [k, v] of Object.entries(creds)) env(id, k, v);
    env(id, "API", `${mock.base}${api}`);
    return id;
  };
  const vtexId = mk("JBL Oficial", "vtex", "jbl", 5, "/vtex", { KEY: "vtex-key", TOKEN: "vtex-token" });
  const shopId = mk("Marca Shopify", "shopify", "marca.myshopify.com", 10, "/shopify", { TOKEN: "shop-token" });
  const nuvId = mk("Marca Nuvem", "nuvemshop", "123456", 0, "/nuvem", { TOKEN: "nuvem-token" });
  assert.ok(official.createSeller(org, { name: "X", storeUrl: "https://x.com", platform: "vtex" }, "u").errors, "VTEX exige a conta");

  const products = { [vtexId]: "fone-jbl", [shopId]: "camisa", [nuvId]: "bone" };
  for (const [sid, pid] of Object.entries(products)) {
    catalog.addProduct({ id: pid, name: pid, brand: "B", referencePrice: 500, sku: `SKU-${pid}`, images: [] });
    assert.ok(official.setOffer(pid, { sellerId: sid, price: 450, commission: 0.1, url: `https://loja.example.com/p/${pid}` }, "u", { organizationId: org }).offer);
  }

  // clique -> cupom criado na loja
  const v = await official.buildRedirectAsync({ productId: "fone-jbl", click: null, workId: "w1" });
  assert.match(v.coupon, /^SS-[2-9A-HJ-NP-Z]{6}$/);
  assert.equal(v.interstitial, true);
  assert.match(v.url, /utm_campaign=of_/);
  assert.equal(mock.st.coupons.vtex[0].couponCode, v.coupon);
  assert.equal(mock.st.coupons.vtex[0].utmSource, "sceneshop");
  const land = official.landing(v.offerId);
  assert.equal(land.coupon, v.coupon); assert.equal(land.discountPct, 5);

  const s = await official.buildRedirectAsync({ productId: "camisa", click: null, workId: "w1" });
  assert.match(s.url, /^https:\/\/loja\.example\.com\/discount\/SS-[^?]+\?redirect=%2Fp%2Fcamisa%3Fss_ref%3Dof_/, "Shopify aplica o cupom pelo link");
  assert.equal(mock.st.priceRules[0].value, "-10.0");
  assert.equal(mock.st.coupons.shopify[0].code, s.coupon);

  const n = await official.buildRedirectAsync({ productId: "bone", click: null, workId: "w1" });
  assert.equal(n.coupon, null, "desconto 0%: sem cupom, reconhece pelo link");
  assert.equal(n.interstitial, false);
  assert.match(n.url, /ss_ref=of_/);

  // pedidos na loja (ninguém avisa o SceneShop)
  const post = (o) => fetch(`${mock.base}/__order`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(o) });
  await post({ platform: "vtex", id: "V-1", coupon: v.coupon, sku: "SKU-fone-jbl", price: 427.5, qty: 1, status: "invoiced" });
  await post({ platform: "vtex", id: "V-2", sku: "OUTRO", price: 99, qty: 1, status: "invoiced" }); // compra sem SceneShop
  await post({ platform: "shopify", id: 1001, coupon: s.coupon, sku: "SKU-camisa", price: 405, qty: 2, status: "paid" });
  await post({ platform: "nuvem", id: 77, landing: `https://loja.example.com/p/bone?ss_ref=${n.offerId}`, sku: "SKU-bone", price: 450, qty: 1, status: "paid" });

  const rv = await sync.syncSeller(official.ownSeller(org, vtexId), deps);
  assert.equal(rv.ok, true, JSON.stringify(rv)); assert.equal(rv.lidos, 2); assert.equal(rv.reconhecidos, 1); assert.equal(rv.vendas, 1);
  const rs = await sync.syncSeller(official.ownSeller(org, shopId), deps);
  assert.equal(rs.vendas, 1, JSON.stringify(rs));
  const rn = await sync.syncSeller(official.ownSeller(org, nuvId), deps);
  assert.equal(rn.vendas, 1, JSON.stringify(rn));

  const orders = store.state.orders;
  assert.deepEqual(orders.map((o) => [o.orderId, o.via, o.amount]), [["V-1", "loja_cupom", 427.5], ["#1001", "loja_cupom", 810], ["77", "loja_link", 450]]);
  // ler de novo não duplica
  assert.equal((await sync.syncSeller(official.ownSeller(org, vtexId), deps)).vendas, 0);
  // cancelamento na loja estorna a comissão
  await post({ platform: "vtex", id: "V-1", status: "canceled" });
  const rc = await sync.syncSeller(official.ownSeller(org, vtexId), deps);
  assert.equal(rc.estornos, 1);
  assert.equal(store.state.orders.find((o) => o.orderId === "V-1").status, "devolvido");

  // chave errada: erro claro, nada registrado
  env(vtexId, "TOKEN", "errado");
  const bad = await sync.syncSeller(official.ownSeller(org, vtexId), deps);
  assert.equal(bad.ok, false); assert.match(official.ownSeller(org, vtexId).connection.lastError, /401/);

  // desempenho por loja
  const perf = sync.performance(org);
  const pv = perf.find((x) => x.sellerId === vtexId);
  assert.equal(pv.clicks, 1); assert.equal(pv.coupons, 1);
  const ps = perf.find((x) => x.sellerId === shopId);
  assert.equal(ps.orders, 1); assert.equal(ps.byVia.loja_cupom, 1);
});

test("relatório do programa de afiliados (CSV)", async () => {
  const store = require("../server/store");
  store.useMemory();
  const catalog = require("../server/catalog");
  const official = require("../server/official");
  const sync = require("../server/store-sync");
  const deps = { money: require("../server/money"), aml: require("../server/aml") };
  const org = "org-aff";
  const r = official.createSeller(org, { name: "Mercado Livre", kind: "marketplace", storeUrl: "https://www.mercadolivre.com.br", platform: "afiliado" }, "u");
  const id = r.seller.id;
  catalog.addProduct({ id: "caixa", name: "Caixa JBL", brand: "JBL", referencePrice: 600, images: [] });
  official.setOffer("caixa", { sellerId: id, price: 599, commission: 0.095, url: "https://mercadolivre.com/sec/abc" }, "u", { organizationId: org });
  const link = official.buildRedirect({ productId: "caixa", click: null, workId: "w1" });
  // datas do relatório: o dia de hoje (a venda nunca é anterior ao clique que a originou)
  const d = new Date(), hoje = `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
  const csv = `Data;ID da venda;Produto;Valor;Comissão;Etiqueta\n${hoje};ML-1;Caixa JBL;"599,00";"56,90";${link.offerId}\n${hoje};ML-2;Outro;120,00;11,40;sceneshop\n${hoje};ML-2;Outro;120,00;11,40;sceneshop\n`;
  const out = await sync.importReport(org, id, csv, "u", deps);
  assert.equal(out.ok, true); assert.equal(out.vendas, 1); assert.equal(out.semReferencia, 1); assert.equal(out.duplicadas, 1);
  const perf = sync.performance(org)[0];
  assert.equal(perf.orders, 1); assert.equal(perf.byVia.relatorio_afiliado, 1);
  assert.equal(perf.affiliate.orders, 1); assert.equal(perf.affiliate.revenue, 120);
  assert.ok((await sync.importReport("outra-org", id, csv, "u", deps)).error, "outra organização não importa");
});

test("Awin: clickref por clique e transações lidas da rede (Oakley/JBL)", async (t) => {
  const { start } = await import("./store-mock.mjs");
  const mock = await start(39962);
  t.after(() => mock.server.close());
  const store = require("../server/store");
  store.useMemory();
  const catalog = require("../server/catalog");
  const official = require("../server/official");
  const sync = require("../server/store-sync");
  const deps = { money: require("../server/money"), aml: require("../server/aml") };
  const org = "org-awin";
  assert.ok(official.createSeller(org, { name: "Oakley BR", storeUrl: "https://www.oakley.com/pt-br", platform: "awin", account: "123456" }, "u").errors, "Awin exige o anunciante");
  const r = official.createSeller(org, { name: "Oakley BR", storeUrl: "https://www.oakley.com/pt-br", platform: "awin", account: "123456", advertiserId: "7777" }, "u");
  const id = r.seller.id;
  process.env[`SCENESHOP_LOJA_${id.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_TOKEN`] = "awin-token";
  process.env[`SCENESHOP_LOJA_${id.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_API`] = `${mock.base}/awin`;
  catalog.addProduct({ id: "holbrook", name: "Holbrook", brand: "Oakley", referencePrice: 899, images: [] });
  official.setOffer("holbrook", { sellerId: id, price: 899, commission: 0.08, url: "https://www.oakley.com/pt-br/product/W0OO9102" }, "u", { organizationId: org });
  const link = await official.buildRedirectAsync({ productId: "holbrook", click: null, workId: "w1" });
  const u = new URL(link.url);
  assert.equal(u.origin + u.pathname, "https://www.awin1.com/cread.php");
  assert.equal(u.searchParams.get("awinmid"), "7777"); assert.equal(u.searchParams.get("awinaffid"), "123456");
  assert.equal(u.searchParams.get("clickref"), link.offerId); assert.equal(u.searchParams.get("ued"), "https://www.oakley.com/pt-br/product/W0OO9102");
  assert.equal(link.interstitial, false);
  const post = (o) => fetch(`${mock.base}/__order`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(o) });
  await post({ platform: "awin", id: 5001, advertiserId: 7777, price: 899, commission: 71.92, status: "pending", clickref: link.offerId });
  await post({ platform: "awin", id: 5002, advertiserId: 8888, price: 50, status: "approved", clickref: link.offerId }); // outro anunciante
  const a = await sync.syncSeller(official.ownSeller(org, id), deps);
  assert.equal(a.ok, true, JSON.stringify(a)); assert.equal(a.vendas, 1);
  assert.equal(store.state.orders[0].via, "rede_afiliados"); assert.equal(store.state.orders[0].orderId, "AWIN-5001");
  await post({ platform: "awin", id: 5003, advertiserId: 7777, price: 1798, status: "approved", clickref: link.offerId }); // 2 óculos no mesmo pedido
  assert.equal((await sync.syncSeller(official.ownSeller(org, id), deps)).vendas, 1);
  assert.equal(store.state.orders.find((o) => o.orderId === "AWIN-5003").amount, 1798);
  await post({ platform: "awin", id: 5001, status: "declined" });
  assert.equal((await sync.syncSeller(official.ownSeller(org, id), deps)).estornos, 1);
});
