const path = require("path");
const { FileStateRepository } = require("./file-state");
const { PostgresStateRepository } = require("./postgres-state");

const RUNTIME_FILE = path.join(__dirname, "..", "..", "data", "runtime.json");

function createStateRepository({ backend, databaseUrl, runtimeFile = RUNTIME_FILE } = {}) {
  if (backend === "postgres") {
    return new PostgresStateRepository({ connectionString: databaseUrl });
  }
  if (backend === "file") return new FileStateRepository(runtimeFile);
  throw new Error(`DATA_BACKEND inválido: ${backend}. Use 'file' ou 'postgres'.`);
}

module.exports = { createStateRepository, RUNTIME_FILE };
