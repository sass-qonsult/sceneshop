const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("os");
const path = require("path");
const fs = require("fs/promises");
const { FileStateRepository } = require("../server/data/file-state");
const { readRuntimeFile, importRuntime, summarizeState } = require("../server/data/runtime-import");

async function temp() {
  return fs.mkdtemp(path.join(os.tmpdir(), "sceneshop-import-"));
}

function sampleState() {
  return {
    version: 6,
    accounts: { ana: { username: "ana" } },
    authors: { ana: { id: "ana" } },
    tracks: { t1: { id: "t1" } },
    partners: {}, sellers: {}, officialOffers: {}, userWorks: {}, userProducts: {},
    clicks: [], sales: [], orders: [], audit: [], events: [],
  };
}

test("runtime import: valida arquivo, checksum e resumo", async () => {
  const dir = await temp();
  const source = path.join(dir, "runtime.json");
  await fs.writeFile(source, JSON.stringify(sampleState()));
  const r = await readRuntimeFile(source);
  assert.match(r.checksum, /^[a-f0-9]{64}$/);
  assert.equal(r.summary.accounts, 1);
  assert.equal(r.summary.tracks, 1);
  assert.deepEqual(r.summary, summarizeState(sampleState()));
});

test("runtime import: round-trip para repository e bloqueia overwrite implícito", async () => {
  const dir = await temp();
  const source = path.join(dir, "source.json");
  const target = path.join(dir, "target.json");
  const state = sampleState();
  await fs.writeFile(source, JSON.stringify(state));

  const first = await importRuntime({ sourceFile: source, targetRepository: new FileStateRepository(target) });
  assert.equal(first.imported, true);
  assert.equal(first.verified, true);
  assert.deepEqual(JSON.parse(await fs.readFile(target, "utf8")), state);

  await assert.rejects(
    importRuntime({ sourceFile: source, targetRepository: new FileStateRepository(target) }),
    /já contém estado/
  );

  const replaced = await importRuntime({ sourceFile: source, targetRepository: new FileStateRepository(target), replace: true });
  assert.equal(replaced.verified, true);
});

test("runtime import: rejeita estado antigo/incompleto", async () => {
  const dir = await temp();
  const source = path.join(dir, "bad.json");
  await fs.writeFile(source, JSON.stringify({ version: 4 }));
  await assert.rejects(readRuntimeFile(source), /incompatível/);
});
