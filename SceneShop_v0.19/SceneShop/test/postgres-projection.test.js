const test = require("node:test");
const assert = require("node:assert/strict");

process.env.SCENESHOP_MEMORY = "1";
const store = require("../server/store");
const { rowsFromState } = require("../server/data/postgres-projection");

test("relational projection covers the current SceneShop state and catalog", () => {
  store.useMemory(true);
  const rows = rowsFromState(store.state);
  assert.equal(rows.accounts.length, Object.keys(store.state.accounts).length);
  assert.equal(rows.authors.length, Object.keys(store.state.authors).length);
  assert.equal(rows.tracks.length, Object.keys(store.state.tracks).length);
  assert.equal(rows.sellers.length, Object.keys(store.state.sellers).length);
  assert.equal(rows.officialOffers.length, Object.keys(store.state.officialOffers).length);
  assert.equal(rows.clicks.length, store.state.clicks.length);
  assert.equal(rows.sales.length, store.state.sales.length);
  assert.equal(rows.commissions.length, store.state.sales.length);
  assert.ok(rows.works.length >= 1);
  assert.ok(rows.products.length >= 15);
  assert.equal(rows.scenes.length, rows.tracks.reduce((n, t) => n + (t.scenes || []).length, 0));
  const expectedSceneProducts = rows.tracks.reduce(
    (n, t) => n + (t.scenes || []).reduce((m, scene) => m + (scene.products || []).length, 0),
    0
  );
  assert.equal(rows.sceneProducts.length, expectedSceneProducts);
});

test("commerce projection preserves issued offer identifiers", () => {
  store.useMemory(true);
  store.state.issuedOffers.sample = {
    oid: "sample",
    pid: "relogio-classico",
    sid: "urbano-oficial",
    prc: 120000,
    cur: "BRL",
    com: 0.12,
    iat: Date.now(),
    exp: Date.now() + 10000,
  };
  const rows = rowsFromState(store.state);
  assert.equal(rows.issuedOffers[0].oid, "sample");
});
