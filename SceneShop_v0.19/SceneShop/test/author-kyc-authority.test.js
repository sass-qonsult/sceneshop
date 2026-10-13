const test = require("node:test");
const assert = require("node:assert/strict");
const { PostgresIdentityRepository } = require("../server/repositories/identity-postgres");
const { projectState } = require("../server/data/postgres-projection");

function draftState() {
  return {
    version: 9,
    authors: { alice: { id: "alice", name: "Alice Example", type: "community", kyc: "pendente", document: null } },
    accounts: { alice: { username: "alice", role: "author", authorId: "alice", tokenVersion: 1 } },
    audit: [],
  };
}

test("KYC authority: submissão congela hash/máscara e grava auditoria na mesma operação", async () => {
  const sql = [];
  const store = {
    atomicDomain: async (prepare) => {
      const prepared = await prepare(structuredClone(draftState()));
      const client = { query: async (text) => {
        sql.push(text);
        if (/SELECT 1 FROM sceneshop_authors/.test(text)) return { rowCount: 1, rows: [{ '?column?': 1 }] };
        return { rowCount: 1, rows: [] };
      } };
      const writeResult = await prepared.write(client);
      return { result: prepared.result, writeResult };
    },
  };
  const repo = new PostgresIdentityRepository({ store });
  const a = await repo.submitAuthorKyc({
    authorId: "alice", documentHash: "a".repeat(64), documentMasked: "***.456.789-**",
    legalName: "Alice Example", subjectType: "PF", pep: true, submittedAt: Date.now(), actor: "alice",
  });
  assert.equal(a.kyc, "em_analise");
  assert.equal(a.kycData.pep, true);
  assert.ok(sql.some((q) => /INSERT INTO sceneshop_author_kyc/.test(q)));
  assert.ok(sql.some((q) => /INSERT INTO sceneshop_audit_log/.test(q)));
});

test("KYC authority: documento duplicado é convertido em conflito de domínio", async () => {
  const store = {
    atomicDomain: async (prepare) => {
      const prepared = await prepare(structuredClone(draftState()));
      const err = new Error("duplicate"); err.code = "23505";
      const client = { query: async (text) => {
        if (/SELECT 1 FROM sceneshop_authors/.test(text)) return { rowCount: 1, rows: [] };
        if (/INSERT INTO sceneshop_author_kyc/.test(text)) throw err;
        return { rowCount: 1, rows: [] };
      } };
      await prepared.write(client);
      return { result: prepared.result };
    },
  };
  const repo = new PostgresIdentityRepository({ store });
  await assert.rejects(
    repo.submitAuthorKyc({ authorId: "alice", documentHash: "b".repeat(64), documentMasked: "***", legalName: "Alice Example", subjectType: "PF", pep: false, submittedAt: Date.now() }),
    (err) => err.code === "KYC_DOCUMENT_EXISTS"
  );
});

test("KYC authority: decisão atualiza tabela própria, autor e auditoria", async () => {
  const sql = [];
  const store = {
    atomicDomain: async (prepare) => {
      const prepared = await prepare(structuredClone(draftState()));
      const client = { query: async (text) => { sql.push(text); return { rowCount: 1, rows: [] }; } };
      await prepared.write(client);
      return { result: prepared.result };
    },
  };
  const repo = new PostgresIdentityRepository({ store });
  const a = await repo.decideAuthorKyc("alice", "aprovado", { actor: "compliance", at: Date.now() });
  assert.equal(a.kyc, "aprovado");
  assert.ok(sql.some((q) => /INSERT INTO sceneshop_author_kyc/.test(q)));
  assert.ok(sql.some((q) => /UPDATE sceneshop_authors SET kyc_status/.test(q)));
  assert.ok(sql.some((q) => /INSERT INTO sceneshop_audit_log/.test(q)));
});

test("KYC authority: fila de análise é lida do PostgreSQL", async () => {
  const store = {
    readDomain: async (fn) => fn({ query: async () => ({ rowCount: 1, rows: [{
      id: "alice", name: "Alice", document: "***.456.789-**", pep: true, subject_type: "PF", submitted_at: new Date("2026-10-02T20:00:00Z"),
    }] }) }),
  };
  const repo = new PostgresIdentityRepository({ store });
  const rows = await repo.listPendingKyc();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].pep, true);
  assert.equal(rows[0].type, "PF");
});

test("relational projector não sobrescreve autor/KYC autoritativo", async () => {
  const queries = [];
  const client = { query: async (sql) => { queries.push(sql); return { rowCount: 0, rows: [] }; } };
  const state = {
    authors: { alice: { id: "alice", name: "Alice stale", type: "community", kyc: "pendente" } },
    accounts: { alice: { username: "alice", pass: "hash", role: "author", authorId: "alice", tokenVersion: 1 } },
    partners: {}, tracks: {}, sellers: {}, officialOffers: {}, issuedOffers: {}, clicks: [], sales: [],
    orders: [], reports: [], alerts: [], audit: [], events: [], workPartners: {}, codePools: {}, commercialPolicies: [],
  };
  await projectState(client, state);
  const authorInsert = queries.find((q) => /INSERT INTO sceneshop_authors/.test(q));
  const kycInsert = queries.find((q) => /INSERT INTO sceneshop_author_kyc/.test(q));
  assert.match(authorInsert, /ON CONFLICT\(id\) DO NOTHING/);
  assert.match(kycInsert, /ON CONFLICT\(author_id\) DO NOTHING/);
});
