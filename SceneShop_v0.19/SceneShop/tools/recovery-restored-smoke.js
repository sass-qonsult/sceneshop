#!/usr/bin/env node
const { createClient } = require('redis');
const { PostgresStateRepository } = require('../server/data/postgres-state');
const { appSmoke } = require('./live-data-plane-validation');

function need(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} é obrigatório.`);
  return value;
}

async function restoredSmoke({ databaseUrl = need('RECOVERY_DATABASE_URL'), redisUrl = need('RECOVERY_REDIS_URL') } = {}) {
  const redis = createClient({ url: redisUrl });
  await redis.connect();
  let dbsize;
  try {
    dbsize = Number(await redis.dbSize());
    if (dbsize !== 0) throw new Error(`Redis de recovery não está vazio antes do smoke (${dbsize} chaves).`);
  } finally {
    await redis.quit();
  }

  const repo = new PostgresStateRepository({ connectionString: databaseUrl });
  let health;
  let snapshot;
  try {
    await repo.init();
    health = await repo.health();
    snapshot = await repo.load();
    if (!health.ok || !health.migrationOk) throw new Error(`Restore PostgreSQL não está saudável: ${health.error || 'unknown'}`);
    if (!snapshot) throw new Error('Restore PostgreSQL não contém snapshot SceneShop.');
  } finally {
    await repo.close().catch(() => {});
  }

  const report = {};
  await appSmoke(databaseUrl, redisUrl, report);
  return {
    ok: true,
    redisWasEmpty: dbsize === 0,
    restoredRevision: Number(health.revision),
    latestMigration: health.latest_migration,
    appReadyOnFreshRedis: !!report.app?.ok,
  };
}

async function main() { console.log(JSON.stringify(await restoredSmoke(), null, 2)); }
if (require.main === module) main().catch((err) => { console.error(err.stack || err.message); process.exitCode = 1; });
module.exports = { restoredSmoke };
