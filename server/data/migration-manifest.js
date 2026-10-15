const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

async function listMigrationManifest(migrationsDir) {
  const names = (await fs.readdir(migrationsDir))
    .filter((name) => /^\d+.*\.sql$/i.test(name))
    .sort();
  const entries = [];
  for (const name of names) {
    const sql = await fs.readFile(path.join(migrationsDir, name), 'utf8');
    entries.push({
      version: name,
      checksum: crypto.createHash('sha256').update(sql).digest('hex'),
      sql,
    });
  }
  return entries;
}

function validateMigrationManifest(entries) {
  if (!Array.isArray(entries) || !entries.length) throw new Error('Nenhuma migration SceneShop encontrada.');
  const seen = new Set();
  let previous = 0;
  for (const entry of entries) {
    const match = String(entry.version || '').match(/^(\d{4})_/);
    if (!match) throw new Error(`Migration fora do padrão NNNN_nome.sql: ${entry.version}`);
    const n = Number(match[1]);
    if (seen.has(n)) throw new Error(`Prefixo de migration duplicado: ${match[1]}`);
    if (n !== previous + 1) throw new Error(`Sequência de migrations possui lacuna: esperado ${String(previous + 1).padStart(4, '0')}, encontrado ${match[1]}.`);
    if (!/^[a-f0-9]{64}$/.test(entry.checksum || '')) throw new Error(`Checksum inválido em ${entry.version}.`);
    seen.add(n);
    previous = n;
  }
  return {
    count: entries.length,
    latest: entries[entries.length - 1].version,
    latestChecksum: entries[entries.length - 1].checksum,
  };
}

module.exports = { listMigrationManifest, validateMigrationManifest };
