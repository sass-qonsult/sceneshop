// rcprep.9: preços sem teto, lojas da organização, link do produto, registro manual de vendas e auditoria v2.
const test = require("node:test");
const assert = require("node:assert/strict");

test("preço no padrão brasileiro, sem o teto de 999.999", () => {
  const { parsePrice, validPrice } = require("../server/price");
  assert.equal(parsePrice("1.250.000,00"), 1250000);
  assert.equal(parsePrice("1.250.000"), 1250000);
  assert.equal(parsePrice("899,90"), 899.9);
  assert.equal(parsePrice("R$ 2.000,00"), 2000);
  assert.equal(parsePrice("59.9"), 59.9);
  assert.ok(Number.isNaN(parsePrice("abc")));
  assert.ok(validPrice(1250000) && validPrice(999999999999.99));
  assert.ok(!validPrice(0) && !validPrice(1e12));
});

test("auditoria v2 não depende da ordem das chaves (jsonb)", () => {
  const store = require("../server/store");
  store.useMemory();
  const audit = require("../server/audit");
  audit.log("x", "teste", { z: 1, a: { c: 2, b: 3 } });
  const e = store.state.audit.at(-1);
  e.data = { a: { b: 3, c: 2 }, z: 1 };
  assert.equal(audit.verifyChain().ok, true);
});

test("loja da organização, link do produto com ss_ref e venda registrada pela produtora", async () => {
  const store = require("../server/store");
  store.useMemory();
  const catalog = require("../server/catalog");
  const official = require("../server/official");
  catalog.addProduct({ id: "p-rc9", name: "Relógio", brand: "X", referencePrice: 1250000, images: [] });
  assert.ok(official.createSeller("org-a", { name: "Loja", storeUrl: "ftp://x" }, "u").errors);
  const c = official.createSeller("org-a", { name: "Loja Oficial X", storeUrl: "https://www.x.com.br", cnpj: "12345678000195" }, "u");
  assert.ok(c.secret && c.seller.id);
  assert.equal(c.seller.cnpj, "12.345.678/0001-95");
  assert.equal(official.sellersView(true, "org-b").length === 0 || official.sellersView(true, "org-b").every((s) => s.organizationId !== "org-a"), true);
  const id = c.seller.id;
  assert.ok(official.setOffer("p-rc9", { sellerId: id, price: "1.250.000,00", commission: 0.1, url: "https://www.x.com.br/relogio" }, "u", { organizationId: "org-b" }).errors, "outra organização não usa a loja");
  assert.ok(official.setOffer("p-rc9", { sellerId: id, price: "1.250.000,00", commission: 0.1, url: "https://www.x.com.br/relogio" }, "u", { organizationId: "org-a" }).offer);
  const link = official.buildRedirect({ productId: "p-rc9", click: null, workId: "w1" });
  assert.match(link.url, /^https:\/\/www\.x\.com\.br\/relogio\?ss_ref=of_/);
  assert.match(link.url, /utm_source=sceneshop/);
  const refs = official.referrals("org-a", id).referrals;
  assert.equal(refs.length, 1);
  assert.ok(official.referrals("org-b", id).error);
  const deps = { money: require("../server/money"), aml: require("../server/aml") };
  assert.ok(official.registerManualOrder("org-a", id, { orderId: "", ref: link.offerId, unitPrice: "10" }, "u", deps).error);
  const r = await Promise.resolve(official.registerManualOrder("org-a", id, { orderId: "PED-1", ref: link.offerId, unitPrice: "1.250.000,00" }, "u", deps));
  assert.equal(r.ok, true);
  assert.equal(official.referrals("org-a", id).referrals[0].order.orderId, "PED-1");
  const dup = await Promise.resolve(official.registerManualOrder("org-a", id, { orderId: "PED-1", ref: link.offerId, unitPrice: "1.250.000,00" }, "u", deps));
  assert.equal(dup.duplicate, true);
});

test("selo SceneShop: filtro no canto e na abertura", () => {
  const { filterFor } = require("../server/branding");
  assert.match(filterFor({ width: 1920, height: 1080 }, { style: "corner", seconds: 4 }), /scale=500:-1.*overlay=x=main_w-overlay_w-58:y=38/);
  assert.match(filterFor({ width: 1920, height: 1080 }, { style: "intro", seconds: 4 }), /overlay=x=\(main_w-overlay_w\)\/2/);
});
