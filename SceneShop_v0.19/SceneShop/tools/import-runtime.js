#!/usr/bin/env node
const path = require("path");
const { createStateRepository } = require("../server/data");
const { readRuntimeFile, importRuntime } = require("../server/data/runtime-import");

function parseArgs(argv) {
  const out = {
    source: path.join(__dirname, "..", "data", "runtime.json"),
    backend: process.env.IMPORT_DATA_BACKEND || process.env.DATA_BACKEND || "postgres",
    databaseUrl: process.env.DATABASE_URL || "",
    dryRun: false,
    replace: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--source") out.source = path.resolve(argv[++i]);
    else if (a === "--backend") out.backend = String(argv[++i] || "").toLowerCase();
    else if (a === "--database-url") out.databaseUrl = argv[++i] || "";
    else if (a === "--dry-run") out.dryRun = true;
    else if (a === "--replace") out.replace = true;
    else if (a === "--help" || a === "-h") out.help = true;
    else throw new Error(`Argumento desconhecido: ${a}`);
  }
  return out;
}

function usage() {
  return `SceneShop runtime importer\n\n` +
    `Uso:\n` +
    `  node tools/import-runtime.js --dry-run [--source data/runtime.json]\n` +
    `  DATABASE_URL=postgres://... node tools/import-runtime.js --backend postgres [--replace]\n\n` +
    `Opções:\n` +
    `  --source <arquivo>       runtime.json de origem\n` +
    `  --backend <file|postgres> destino\n` +
    `  --database-url <url>     sobrescreve DATABASE_URL\n` +
    `  --dry-run                valida e relata sem gravar\n` +
    `  --replace                permite substituir destino já populado\n`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) return console.log(usage());

  if (args.dryRun) {
    const r = await readRuntimeFile(args.source);
    console.log(JSON.stringify({ dryRun: true, source: args.source, ...r, state: undefined }, null, 2));
    return;
  }

  const repo = createStateRepository({
    backend: args.backend,
    databaseUrl: args.databaseUrl,
  });
  const r = await importRuntime({ sourceFile: args.source, targetRepository: repo, replace: args.replace });
  console.log(JSON.stringify({ source: args.source, backend: args.backend, ...r }, null, 2));
}

main().catch((err) => {
  console.error(`Importação falhou: ${err.message}`);
  process.exitCode = 1;
});
