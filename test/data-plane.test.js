const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("os");
const path = require("path");
const fs = require("fs/promises");
const { FileStateRepository } = require("../server/data/file-state");
const { createStateRepository } = require("../server/data");

async function tmpDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), "sceneshop-data-"));
}

test("data plane: file repository round-trips a snapshot", async () => {
  const dir = await tmpDir();
  const file = path.join(dir, "runtime.json");
  const repo = new FileStateRepository(file);
  await repo.init();
  assert.equal(await repo.load(), null);

  const state = { version: 6, nested: { ok: true }, list: [1, 2, 3] };
  await repo.save(state);
  assert.deepEqual(await repo.load(), state);
  assert.equal((await repo.health()).ok, true);
});

test("data plane: file repository replaces the whole snapshot atomically", async () => {
  const dir = await tmpDir();
  const file = path.join(dir, "runtime.json");
  const repo = new FileStateRepository(file);
  await repo.init();
  await repo.save({ version: 1, value: "old" });
  await repo.save({ version: 2, value: "new" });
  assert.deepEqual(await repo.load(), { version: 2, value: "new" });
  const names = await fs.readdir(dir);
  assert.deepEqual(names, ["runtime.json"]);
});

test("data plane: backend inválido falha fechado", () => {
  assert.throws(() => createStateRepository({ backend: "unknown" }), /DATA_BACKEND inválido/);
});

const { PostgresStateRepository } = require("../server/data/postgres-state");

test("data plane: postgres snapshot usa revisão otimista", async () => {
  const repo = new PostgresStateRepository({ connectionString: "postgres://unused", projector: async () => ({}) });
  let insert = true;
  const query = async (sql, params) => {
    if (/^(BEGIN|COMMIT|ROLLBACK)/.test(String(sql).trim())) return { rowCount: 0, rows: [] };
    if (/pg_advisory_xact_lock/.test(sql)) return { rowCount: 1, rows: [{}] };
    if (/INSERT INTO sceneshop_state_snapshots/.test(sql) && insert) {
      insert = false;
      return { rowCount: 1, rows: [{ revision: 0 }] };
    }
    if (/UPDATE sceneshop_state_snapshots/.test(sql)) {
      assert.equal(params[2], 0);
      return { rowCount: 1, rows: [{ revision: 1 }] };
    }
    if (/INSERT INTO sceneshop_outbox/.test(sql)) return { rowCount: 1, rows: [] };
    throw new Error(`SQL inesperado no fake: ${sql}`);
  };
  repo.pool = { connect: async () => ({ query, release() {} }) };
  await repo.save({ version: 6, a: 1 });
  assert.equal(repo.revision, 0);
  await repo.save({ version: 6, a: 2 });
  assert.equal(repo.revision, 1);
});

test("data plane: postgres rejeita writer obsoleto em vez de last-write-wins", async () => {
  const repo = new PostgresStateRepository({ connectionString: "postgres://unused", projector: async () => ({}) });
  repo.revision = 7;
  const query = async (sql) => {
    if (/^(BEGIN|ROLLBACK)/.test(String(sql).trim())) return { rowCount: 0, rows: [] };
    if (/pg_advisory_xact_lock/.test(sql)) return { rowCount: 1, rows: [{}] };
    if (/UPDATE sceneshop_state_snapshots/.test(sql)) return { rowCount: 0, rows: [] };
    return { rowCount: 0, rows: [] };
  };
  repo.pool = { connect: async () => ({ query, release() {} }) };
  await assert.rejects(
    repo.save({ version: 6 }),
    (err) => err && err.code === "SCENESHOP_CONCURRENT_WRITE"
  );
});
