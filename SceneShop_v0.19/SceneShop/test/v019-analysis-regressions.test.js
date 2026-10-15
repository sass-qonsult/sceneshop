// Regressões encontradas na análise independente do candidato v0.19.0-rc.1-rcprep.5.
// Todas rodam sem PostgreSQL/Redis, para que o `npm test` comum as pegue.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");

test("páginas públicas não usam <script> embutido (a CSP script-src 'self' bloqueia)", () => {
  const csp = fs.readFileSync(path.join(ROOT, "server/security/http.js"), "utf8");
  assert.match(csp, /script-src 'self'/);
  const pages = [];
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).forEach((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p); else if (e.name.endsWith(".html")) pages.push(p);
  });
  walk(path.join(ROOT, "public"));
  const offenders = pages.filter((p) => /<script(?![^>]*\bsrc=)[^>]*>/i.test(fs.readFileSync(p, "utf8")));
  assert.deepEqual(offenders.map((p) => path.relative(ROOT, p)), []);
});

test("projeção PostgreSQL grava organizações antes de obras, produtos e trilhas", async () => {
  process.env.SCENESHOP_MEMORY = "1";
  const { projectState } = require("../server/data/postgres-projection");
  const store = require("../server/store");
  const order = [];
  const client = { query: async (sql) => { const m = /INSERT INTO (\w+)/.exec(sql); if (m) order.push(m[1]); return { rows: [], rowCount: 0 }; } };
  await projectState(client, JSON.parse(JSON.stringify(store.state)));
  const first = (t) => order.indexOf(t);
  assert.ok(first("sceneshop_organizations") >= 0, "organizações não são gravadas");
  assert.ok(first("sceneshop_accounts") < first("sceneshop_organizations"), "contas antes de organizações (created_by)");
  for (const t of ["sceneshop_works", "sceneshop_products", "sceneshop_tracks"]) {
    if (first(t) >= 0) assert.ok(first("sceneshop_organizations") < first(t), `organizações antes de ${t}`);
  }
});

test("manifesto de recuperação só conta tabelas que as migrações criam", () => {
  const dir = path.join(ROOT, "server/data/migrations");
  const created = new Set();
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".sql"))) {
    for (const m of fs.readFileSync(path.join(dir, f), "utf8").matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g)) created.add(m[1]);
  }
  const src = fs.readFileSync(path.join(ROOT, "server/operations/recovery-postgres.js"), "utf8");
  const tables = [...src.match(/const TABLES = \[([\s\S]*?)\]/)[1].matchAll(/'(\w+)'/g)].map((m) => m[1]);
  assert.ok(tables.length > 5);
  assert.deepEqual(tables.filter((t) => !created.has(t)), []);
});

test("gate de schema efêmero cria o schema antes de migrar", () => {
  const src = fs.readFileSync(path.join(ROOT, "tools/v019-schema-compatibility.js"), "utf8");
  const fn = src.slice(src.indexOf("async function buildEphemeralLiveCompatibility"), src.indexOf("async function main"));
  assert.ok(fn.indexOf("CREATE SCHEMA") >= 0 && fn.indexOf("CREATE SCHEMA") < fn.indexOf("repo.init()"));
});

test("commit atômico sincroniza o estado sem invalidar referências já guardadas", () => {
  process.env.SCENESHOP_MEMORY = "1";
  const { syncInto } = require("../server/store");
  const live = { mktOrders: [{ id: "o1", status: "aguardando_pagamento", items: [{ q: 1 }] }], old: true };
  const held = live.mktOrders[0];                       // ex.: o marketplace segura o pedido
  const snapshot = JSON.parse(JSON.stringify(live));    // a transação trabalha numa cópia
  snapshot.mktOrders[0].status = "pago"; snapshot.mktOrders.push({ id: "o2" }); delete snapshot.old;
  const out = syncInto(live, snapshot);
  assert.equal(out, live);
  assert.equal(live.mktOrders[0], held, "a referência guardada continua sendo o objeto vivo");
  held.items[0].sceneshop = { ok: true };               // escrita depois do commit não se perde
  assert.deepEqual(live.mktOrders[0].items[0].sceneshop, { ok: true });
  assert.equal(held.status, "pago");
  assert.equal(live.mktOrders.length, 2);
  assert.ok(!("old" in live));
});

test("produção começa vazia, com a mesma estrutura dos dados de demonstração", () => {
  process.env.SCENESHOP_MEMORY = "1";
  const st = require("../server/store");
  const demo = st.demoSeed(), prod = st.productionSeed();
  assert.deepEqual(Object.keys(prod).sort(), Object.keys(demo).sort(), "mesmas coleções");
  for (const k of Object.keys(demo)) assert.equal(Array.isArray(prod[k]), Array.isArray(demo[k]), `tipo de ${k}`);
  for (const k of ["accounts", "tracks", "sellers", "partners", "officialOffers", "organizations"]) assert.equal(Object.keys(prod[k]).length, 0, `${k} vazio`);
  for (const k of ["sales", "clicks", "reports"]) assert.equal(prod[k].length, 0, `${k} vazio`);
  assert.ok(prod.offerKeys.private && prod.offerKeys.public && prod.commercialPolicies.length === 1, "chaves e política comercial presentes");
});

test("produção não inventa preço: lojas simuladas só na demonstração", () => {
  const src = fs.readFileSync(path.join(ROOT, "server/adapters/index.js"), "utf8");
  assert.match(src, /adapters: DEMO \|\| process\.env\.SIMULATED_STORES === "1" \?/);
});

test("um evento de socket com erro não derruba o servidor (resync com dados inválidos do celular)", () => {
  const src = fs.readFileSync(path.join(ROOT, "server/index.js"), "utf8");
  const conn = src.slice(src.indexOf('io.on("connection"'));
  assert.match(conn.slice(0, 800), /socket\.on = \(event, handler\)/, "todos os eventos passam pelo protetor de erros");
  assert.match(src, /process\.on\("unhandledRejection"/);
  const resync = conn.slice(conn.indexOf('"sync:resync"'), conn.indexOf('socket.on("disconnect"'));
  assert.match(resync, /fingerprintId: null/, "id de fingerprint vindo do celular não vai para a coluna com chave estrangeira");
  assert.match(resync, /Math\.min\(1, Number\(confidence\)\)/, "confiança limitada a 0..1 (CHECK do banco)");
});
