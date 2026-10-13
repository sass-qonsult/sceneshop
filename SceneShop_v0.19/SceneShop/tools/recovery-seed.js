#!/usr/bin/env node
const { PostgresStateRepository } = require('../server/data/postgres-state');
const store = require('../server/store');

function need(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} é obrigatório.`);
  return value;
}

async function seedRecoveryDatabase(url = need('DATABASE_URL')) {
  const repo = new PostgresStateRepository({ connectionString: url });
  try {
    await repo.init();
    const current = await repo.load();
    if (current) return { ok: true, seeded: false, revision: repo.revision };
    const snapshot = JSON.parse(JSON.stringify(store.state));
    snapshot.recoveryGateSeed = { createdAt: new Date().toISOString(), purpose: 'v0.17-alpha2-recovery-drill' };
    await repo.save(snapshot);
    return { ok: true, seeded: true, revision: repo.revision };
  } finally {
    await repo.close().catch(() => {});
  }
}

async function main() {
  console.log(JSON.stringify(await seedRecoveryDatabase(), null, 2));
}

if (require.main === module) main().catch((err) => { console.error(err.stack || err.message); process.exitCode = 1; });
module.exports = { seedRecoveryDatabase };
