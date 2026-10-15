const test = require("node:test");
const assert = require("node:assert/strict");

const { PostgresIdentityRepository, accountFromRow } = require("../server/repositories/identity-postgres");
const { projectState } = require("../server/data/postgres-projection");

function accountRow(overrides = {}) {
  return {
    username: "alice",
    password_hash: "scrypt$hash",
    role: "author",
    author_id: "alice",
    token_version: 3,
    demo: false,
    created_at: new Date("2026-10-02T12:00:00Z"),
    payload: { username: "alice", pass: "stale-payload", tokenVersion: 1 },
    ...overrides,
  };
}

test("identity authority: colunas PostgreSQL prevalecem sobre payload legado", () => {
  const a = accountFromRow(accountRow());
  assert.equal(a.username, "alice");
  assert.equal(a.pass, "scrypt$hash");
  assert.equal(a.tokenVersion, 3);
  assert.equal(a.authorId, "alice");
});

test("identity authority: leitura de conta usa PostgreSQL", async () => {
  const queries = [];
  const store = {
    readDomain: async (fn) => fn({ query: async (sql, params) => {
      queries.push({ sql, params });
      return { rowCount: 1, rows: [accountRow()] };
    } }),
  };
  const repo = new PostgresIdentityRepository({ store });
  const a = await repo.findAccount(" ALICE ");
  assert.equal(a.tokenVersion, 3);
  assert.equal(queries[0].params[0], "alice");
  assert.match(queries[0].sql, /FROM sceneshop_accounts/);
});

test("identity authority: nova sessão é persistida sem tocar snapshot", async () => {
  const calls = [];
  const store = {
    writeDomain: async (fn) => fn({ query: async (sql, params) => {
      calls.push({ sql, params });
      return { rowCount: 1, rows: [] };
    } }),
  };
  const repo = new PostgresIdentityRepository({ store });
  const result = await repo.createSession({
    id: "sid-1", username: "Alice", tokenVersion: 3,
    issuedAt: Date.parse("2026-10-02T12:00:00Z"),
    expiresAt: Date.parse("2026-10-09T12:00:00Z"),
  });
  assert.equal(result.id, "sid-1");
  assert.equal(calls.length, 3);
  assert.match(calls[0].sql, /INSERT INTO sceneshop_auth_sessions/);
  assert.match(calls[1].sql, /session_limit/);
  assert.match(calls[2].sql, /last_login_at/);
});

test("identity authority: logout-all incrementa tokenVersion e revoga sessões na mesma escrita", async () => {
  const draft = {
    version: 8,
    accounts: { alice: { username: "alice", tokenVersion: 3, role: "author", authorId: "alice" } },
    authors: { alice: { id: "alice", name: "Alice" } },
  };
  const sql = [];
  const client = { query: async (text) => {
    sql.push(text);
    if (/UPDATE sceneshop_accounts/.test(text)) return { rowCount: 1, rows: [{ token_version: 4 }] };
    return { rowCount: 1, rows: [] };
  } };
  const store = {
    atomicDomain: async (prepare) => {
      const prepared = await prepare(structuredClone(draft));
      const writeResult = await prepared.write(client);
      return { result: prepared.result, writeResult };
    },
  };
  const repo = new PostgresIdentityRepository({ store });
  const a = await repo.incrementTokenVersion("alice", { at: Date.now() });
  assert.equal(a.tokenVersion, 4);
  assert.ok(sql.some((q) => /UPDATE sceneshop_auth_sessions/.test(q)));
});

test("relational projector não apaga nem sobrescreve contas autoritativas", async () => {
  const queries = [];
  const client = { query: async (sql) => { queries.push(sql); return { rowCount: 0, rows: [] }; } };
  const state = {
    authors: { alice: { id: "alice", name: "Alice", type: "community", kyc: "pendente" } },
    accounts: { alice: { username: "alice", pass: "hash", role: "author", authorId: "alice", tokenVersion: 1 } },
    partners: {}, tracks: {}, sellers: {}, officialOffers: {}, issuedOffers: {}, clicks: [], sales: [],
    orders: [], reports: [], alerts: [], audit: [], events: [], workPartners: {}, codePools: {}, commercialPolicies: [],
  };
  await projectState(client, state);
  assert.equal(queries.some((q) => /DELETE FROM sceneshop_accounts/.test(q)), false);
  const accountInsert = queries.find((q) => /INSERT INTO sceneshop_accounts/.test(q));
  assert.match(accountInsert, /ON CONFLICT\(username\) DO NOTHING/);
});
