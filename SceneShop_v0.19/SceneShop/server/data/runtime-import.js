const fs = require("fs/promises");
const crypto = require("crypto");

function checksumBytes(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

function summarizeState(state) {
  const countObject = (v) => (v && typeof v === "object" && !Array.isArray(v) ? Object.keys(v).length : 0);
  const countArray = (v) => (Array.isArray(v) ? v.length : 0);
  return {
    version: Number(state && state.version) || 0,
    accounts: countObject(state && state.accounts),
    authors: countObject(state && state.authors),
    tracks: countObject(state && state.tracks),
    partners: countObject(state && state.partners),
    sellers: countObject(state && state.sellers),
    officialOffers: countObject(state && state.officialOffers),
    works: countObject(state && state.userWorks),
    products: countObject(state && state.userProducts),
    clicks: countArray(state && state.clicks),
    sales: countArray(state && state.sales),
    orders: countArray(state && state.orders),
    audit: countArray(state && state.audit),
    events: countArray(state && state.events),
  };
}

function validateState(state) {
  if (!state || typeof state !== "object" || Array.isArray(state)) {
    throw new Error("runtime.json inválido: raiz deve ser um objeto JSON.");
  }
  const version = Number(state.version) || 0;
  if (version < 5) throw new Error(`runtime.json incompatível: state.version=${version}; mínimo suportado é 5.`);
  for (const key of ["accounts", "authors", "tracks"]) {
    if (!state[key] || typeof state[key] !== "object" || Array.isArray(state[key])) {
      throw new Error(`runtime.json inválido: '${key}' ausente ou não é objeto.`);
    }
  }
  if (!Array.isArray(state.audit)) throw new Error("runtime.json inválido: 'audit' deve ser array.");
  return state;
}

async function readRuntimeFile(sourceFile) {
  const raw = await fs.readFile(sourceFile);
  let state;
  try {
    state = JSON.parse(raw.toString("utf8"));
  } catch (err) {
    const e = new Error(`runtime.json inválido: JSON não pôde ser lido (${err.message}).`);
    e.cause = err;
    throw e;
  }
  validateState(state);
  return {
    state,
    bytes: raw.length,
    checksum: checksumBytes(raw),
    summary: summarizeState(state),
  };
}

function stableStateChecksum(state) {
  return crypto.createHash("sha256").update(JSON.stringify(state)).digest("hex");
}

async function importRuntime({ sourceFile, targetRepository, dryRun = false, replace = false } = {}) {
  if (!sourceFile) throw new Error("sourceFile é obrigatório.");
  if (!targetRepository) throw new Error("targetRepository é obrigatório.");

  const source = await readRuntimeFile(sourceFile);
  if (dryRun) return { dryRun: true, imported: false, ...source };

  await targetRepository.init();
  try {
    const existing = await targetRepository.load();
    if (existing && !replace) {
      throw new Error("Destino já contém estado SceneShop. Use --replace explicitamente para sobrescrever.");
    }

    if (typeof targetRepository.importSnapshot === "function") {
      await targetRepository.importSnapshot(source.state, {
        sourceChecksum: source.checksum,
        sourceBytes: source.bytes,
        sourceVersion: source.summary.version,
        summary: source.summary,
        replace,
      });
    } else {
      await targetRepository.save(source.state);
    }

    const loaded = await targetRepository.load();
    const expected = stableStateChecksum(source.state);
    const actual = stableStateChecksum(loaded);
    if (expected !== actual) {
      throw new Error("Verificação pós-importação falhou: snapshot lido do destino diverge da origem.");
    }

    return {
      dryRun: false,
      imported: true,
      checksum: source.checksum,
      bytes: source.bytes,
      summary: source.summary,
      verified: true,
    };
  } finally {
    await targetRepository.close();
  }
}

module.exports = {
  checksumBytes,
  stableStateChecksum,
  summarizeState,
  validateState,
  readRuntimeFile,
  importRuntime,
};
