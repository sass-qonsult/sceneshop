#!/usr/bin/env node
/**
 * SceneShop v0.17 foundation live validation harness.
 *
 * Requires real PostgreSQL + Redis. The PostgreSQL test is isolated in a
 * random schema and removed at the end. Redis uses a random key prefix.
 * No production media or user data is required.
 */
const crypto = require('crypto');
const { spawn } = require('child_process');
const { PostgresStateRepository } = require('../server/data/postgres-state');
const { RedisSessionRepository } = require('../server/realtime/session-redis');
const { configureSocketRedis } = require('../server/realtime/socket-redis');
const { PostgresOutboxRepository } = require('../server/operations/outbox-postgres');
const { RedisCacheCoordinator } = require('../server/operations/cache-coordinator');

function need(name, fallback = '') {
  const value = process.env[name] || fallback;
  if (!value) throw new Error(`${name} é obrigatório para validação live.`);
  return value;
}

function requirePackage(name) {
  try { return require(name); }
  catch (err) { const e = new Error(`Dependência '${name}' não instalada; execute npm install/npm ci antes da validação live.`); e.cause = err; throw e; }
}

function scopedPostgresUrl(base, schema) {
  const u = new URL(base);
  u.searchParams.set('options', `-c search_path=${schema}`);
  return u.toString();
}

function wait(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function outboxLeaseValidation(repo, report) {
  const workerA = new PostgresOutboxRepository({ store: repo, workerId: 'live-worker-a' });
  const workerB = new PostgresOutboxRepository({ store: repo, workerId: 'live-worker-b' });
  await repo.writeDomain(async (client) => {
    await client.query(
      `INSERT INTO sceneshop_outbox(topic,aggregate_type,aggregate_id,payload)
       SELECT 'release.live', 'validation', 'event-' || n::text, jsonb_build_object('n', n)
       FROM generate_series(1,4) AS n`
    );
  });
  await Promise.all([
    workerA.heartbeat({ host: 'live-gate', pid: process.pid, version: 'validation' }),
    workerB.heartbeat({ host: 'live-gate', pid: process.pid, version: 'validation' }),
  ]);
  const first = await workerA.claimBatch({ limit: 2, leaseMs: 60000 });
  const second = await workerB.claimBatch({ limit: 2, leaseMs: 60000 });
  const firstIds = new Set(first.map((event) => event.id));
  const overlap = second.some((event) => firstIds.has(event.id));
  if (first.length !== 2 || second.length !== 2 || overlap) throw new Error('Leasing concorrente do outbox não isolou os workers.');

  const acked = await workerA.ack(first[0].id);
  if (!acked || !acked.publishedAt) throw new Error('ACK live do outbox não persistiu published_at.');
  const dead = await workerA.fail(first[1].id, new Error('expected_live_dead_letter'), { delayMs: 10, maxAttempts: 1 });
  if (!dead || !dead.deadLetteredAt) throw new Error('Falha terminal live não foi enviada para dead letter.');
  for (const event of second) {
    const row = await workerB.ack(event.id);
    if (!row || !row.publishedAt) throw new Error('Worker B não conseguiu ACK do lease próprio.');
  }
  const health = await workerA.health({ staleWorkerMs: 120000 });
  if (health.activeWorkers < 2) throw new Error(`Heartbeats live insuficientes (${health.activeWorkers}).`);
  if (health.deadLetters < 1) throw new Error('Health live não contabilizou dead letter.');
  report.outbox = {
    ok: true,
    leasedByWorkerA: first.map((event) => event.id),
    leasedByWorkerB: second.map((event) => event.id),
    overlap: false,
    deadLettered: dead.id,
    activeWorkers: health.activeWorkers,
  };
}

async function postgresValidation(baseUrl, report, { keepSchema = false } = {}) {
  const { Pool } = requirePackage('pg');
  const schema = `sceneshop_live_${crypto.randomBytes(6).toString('hex')}`;
  const admin = new Pool({ connectionString: baseUrl });
  const scopedUrl = scopedPostgresUrl(baseUrl, schema);
  let repo1;
  let repo2;
  try {
    await admin.query(`CREATE SCHEMA "${schema}"`);
    const probe = new Pool({ connectionString: scopedUrl });
    const current = await probe.query('SELECT current_schema() AS schema');
    await probe.end();
    if (current.rows[0].schema !== schema) throw new Error(`search_path isolado não foi aplicado (${current.rows[0].schema}).`);

    repo1 = new PostgresStateRepository({ connectionString: scopedUrl });
    await repo1.init();
    const healthAfterMigrations = await repo1.health();
    if (!healthAfterMigrations.ok || !healthAfterMigrations.migrationOk) throw new Error(`Migrations não saudáveis: ${healthAfterMigrations.error || 'unknown'}`);

    // store.state is seeded synchronously on module load; no backend override is needed here.
    // Keeping SCENESHOP_MEMORY untouched prevents a CI-level override from leaking into the live gate.
    const store = require('../server/store');
    const seed = JSON.parse(JSON.stringify(store.state));
    seed.releaseValidationMarker = crypto.randomUUID();
    await repo1.save(seed);
    const loaded = await repo1.load();
    if (loaded.releaseValidationMarker !== seed.releaseValidationMarker) throw new Error('Round-trip PostgreSQL divergiu.');

    repo2 = new PostgresStateRepository({ connectionString: scopedUrl });
    await repo2.init();
    await repo2.load();
    const next = { ...loaded, releaseValidationMarker: crypto.randomUUID() };
    await repo1.save(next);
    let conflict = false;
    try { await repo2.save({ ...loaded, releaseValidationMarker: crypto.randomUUID() }); }
    catch (err) { conflict = err && err.code === 'SCENESHOP_CONCURRENT_WRITE'; }
    if (!conflict) throw new Error('Writer PostgreSQL obsoleto não foi rejeitado.');

    await outboxLeaseValidation(repo1, report);

    await repo1.close(); repo1 = null;
    const repo3 = new PostgresStateRepository({ connectionString: scopedUrl });
    await repo3.init();
    const afterRestart = await repo3.load();
    const restartOk = afterRestart && afterRestart.releaseValidationMarker === next.releaseValidationMarker;
    const finalHealth = await repo3.health();
    await repo3.close();
    if (!restartOk) throw new Error('Persistência PostgreSQL não sobreviveu ao restart do repository.');

    report.postgres = { ok: true, schema, restartOk, optimisticConcurrency: true, health: finalHealth };
    return { scopedUrl, seed, schema };
  } finally {
    if (repo1) await repo1.close().catch(() => {});
    if (repo2) await repo2.close().catch(() => {});
    if (!keepSchema) await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).catch(() => {});
    await admin.end();
  }
}

async function dropPostgresSchema(baseUrl, schema) {
  if (!schema) return;
  const { Pool } = requirePackage('pg');
  const admin = new Pool({ connectionString: baseUrl });
  try { await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); }
  finally { await admin.end(); }
}

async function redisValidation(redisUrl, report) {
  const { createClient } = requirePackage('redis');
  requirePackage('@socket.io/redis-adapter');
  const prefix = `sceneshop:live:${crypto.randomBytes(6).toString('hex')}`;
  const client = createClient({ url: redisUrl });
  await client.connect();
  const repo = new RedisSessionRepository({ client, ttlMs: 60_000, prefix });
  try {
    await repo.init();
    const session = await repo.create('live-work', 12, 'live-track', { mode: 'COMPANION', syncConfidence: 0.91 });
    await repo.addDevice(session.code, 'device-live-0001');
    await repo.setBrowse(session.code, 'device-live-0001', { position: 4, sceneId: 'scene-old' });
    await repo.updatePlayback(session.code, { time: 28, playing: true, sceneId: 'scene-now' });
    const before = await repo.getViewer(session.code, 'device-live-0001');
    if (before.state !== 'BROWSING' || before.browsePosition !== 4) throw new Error('Browse Head Redis foi contaminado pelo Playback Head.');
    await repo.resync(session.code, { position: 31.5, confidence: 0.99, sceneId: 'scene-resync' });
    const after = await repo.getViewer(session.code, 'device-live-0001');
    if (after.state !== 'BROWSING' || after.browsePosition !== 4) throw new Error('Re-sync forçou viewer Redis para LIVE.');
    const ttl = await client.ttl(repo.key(session.code));
    if (!(ttl > 0)) throw new Error('TTL Redis não foi aplicado.');

    const { Server } = requirePackage('socket.io');
    const io1 = new Server({ serveClient: false });
    const io2 = new Server({ serveClient: false });
    const a1 = await configureSocketRedis(io1, { url: redisUrl, enabled: true });
    const a2 = await configureSocketRedis(io2, { url: redisUrl, enabled: true });
    try {
      const probe = `probe:${crypto.randomUUID()}`;
      let received = false;
      io2.on(probe, (value) => { if (value === 'ok') received = true; });
      io1.serverSideEmit(probe, 'ok');
      for (let i = 0; i < 30 && !received; i += 1) await wait(50);
      if (!received) throw new Error('Socket.IO Redis adapter não propagou serverSideEmit entre instâncias.');
    } finally {
      await Promise.allSettled([a1.close(), a2.close()]);
      // Servers created without an HTTP server have no engine; socket.io 4.8 close() then throws.
      await Promise.allSettled([io1, io2].map((io) => Promise.resolve().then(() => io.close())));
    }

    report.redis = { ok: true, prefix, ttlSeconds: ttl, viewerIsolation: true, resyncPreservesBrowsing: true, socketPubSub: true };
  } finally {
    const keys = await client.sendCommand(['KEYS', `${prefix}:*`]).catch(() => []);
    if (keys && keys.length) await client.del(keys);
    await client.quit();
  }
}


async function cacheCoordinationValidation(redisUrl, report) {
  const { createClient } = requirePackage('redis');
  const prefix = `sceneshop:livecache:${crypto.randomBytes(6).toString('hex')}`;
  const a = new RedisCacheCoordinator({ url: redisUrl, prefix, instanceId: 'live-cache-a', heartbeatTtlMs: 60000 });
  const b = new RedisCacheCoordinator({ url: redisUrl, prefix, instanceId: 'live-cache-b', heartbeatTtlMs: 60000 });
  try {
    await a.init(); await b.init();
    await a.set('offers', 'live-product', { price: 101 }, { ttlMs: 60000 });
    const crossInstance = await b.get('offers', 'live-product');
    if (!crossInstance || crossInstance.price !== 101) throw new Error('Cache Redis não foi compartilhado entre instâncias.');
    const invalidation = await b.invalidate('offers', { reason: 'live-gate' });
    const stale = await a.get('offers', 'live-product');
    if (stale !== null) throw new Error('Invalidação por geração não removeu visibilidade da geração antiga.');
    const lease = await a.acquireLease('live-singleton', { ttlMs: 30000 });
    if (!lease) throw new Error('Primeira instância não adquiriu lease Redis.');
    if (await b.acquireLease('live-singleton', { ttlMs: 30000 })) throw new Error('Lease Redis permitiu dois proprietários simultâneos.');
    if (!(await lease.release())) throw new Error('Release token-safe do lease Redis falhou.');
    if (!(await b.acquireLease('live-singleton', { ttlMs: 30000 }))) throw new Error('Lease Redis não ficou disponível após release.');
    const health = await a.health();
    if (!health.ok || health.activeInstances < 2) throw new Error(`Coordenação Redis não observou duas instâncias (${health.activeInstances || 0}).`);
    report.cacheCoordination = { ok: true, prefix, sharedRead: true, invalidationEpoch: invalidation.epoch, leaseExclusive: true, activeInstances: health.activeInstances };
  } finally {
    await Promise.allSettled([a.close(), b.close()]);
    const cleanup = createClient({ url: redisUrl });
    await cleanup.connect();
    const keys = await cleanup.sendCommand(['KEYS', `${prefix}:*`]).catch(() => []);
    if (keys && keys.length) await cleanup.del(keys);
    await cleanup.quit();
  }
}

function buildAppSmokeEnv(scopedUrl, redisUrl, baseEnv = process.env) {
  const env = {
    ...baseEnv,
    NODE_ENV: 'production', DEMO: '0', DATA_BACKEND: 'postgres', DATABASE_URL: scopedUrl,
    SESSION_BACKEND: 'redis', REDIS_URL: redisUrl, CACHE_BACKEND: 'redis', CACHE_PREFIX: 'sceneshop:live-app', PUBLIC_URL: 'https://localhost.invalid',
    SESSION_SECRET: 'sceneshop-live-validation-0123456789abcdef', TRUST_PROXY: '0',
  };
  delete env.SCENESHOP_MEMORY;
  return env;
}

async function appSmoke(scopedUrl, redisUrl, report) {
  const code = `
    const { bootstrap, server, shutdown } = require('./server/index');
    (async()=>{ await bootstrap(); await new Promise(r=>server.listen(0,'127.0.0.1',r)); const p=server.address().port;
      const ready=await fetch('http://127.0.0.1:'+p+'/api/ready'); const body=await ready.json();
      if(!ready.ok||!body.ok) throw new Error('ready failed '+JSON.stringify(body));
      if(body.data?.backend!=='postgres') throw new Error('ready did not use postgres '+JSON.stringify(body.data));
      if(body.realtime?.sessions?.backend!=='redis') throw new Error('ready did not use redis sessions '+JSON.stringify(body.realtime));
      if(body.cache?.backend!=='redis') throw new Error('ready did not use redis cache '+JSON.stringify(body.cache));
      const live=await fetch('http://127.0.0.1:'+p+'/api/live'); const liveBody=await live.json();
      if(!live.ok||!liveBody.ok) throw new Error('live failed '+JSON.stringify(liveBody));
      if(liveBody.version!==require('./package.json').version) throw new Error('live version mismatch '+JSON.stringify(liveBody));
      if(require('./package.json').version.startsWith('0.19.') && (liveBody.release?.channel!=='rc'||liveBody.release?.latestMigration!=='0027_cache_coordination_recovery.sql'||liveBody.release?.nativeBridgeVersion!==1)) throw new Error('v0.19 release contract metadata missing '+JSON.stringify(liveBody.release));
      const works=await fetch('http://127.0.0.1:'+p+'/api/works'); if(!works.ok) throw new Error('works '+works.status);
      console.log(JSON.stringify({ok:true,ready:body})); await shutdown();
    })().catch(async e=>{ console.error(e.stack||e.message); try{await shutdown()}catch(_){} process.exit(1); });
  `;
  const env = buildAppSmokeEnv(scopedUrl, redisUrl);
  const output = [];
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['-e', code], { cwd: require('path').join(__dirname, '..'), env, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', (d) => output.push(d.toString()));
    child.stderr.on('data', (d) => output.push(d.toString()));
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('Smoke test da aplicação excedeu 30s.')); }, 30_000);
    child.on('exit', (status) => { clearTimeout(timer); status === 0 ? resolve() : reject(new Error(`App smoke falhou (${status}): ${output.join('')}`)); });
  });
  report.app = { ok: true };
}

async function main() {
  const databaseUrl = need('LIVE_DATABASE_URL', process.env.DATABASE_URL || '');
  const redisUrl = need('LIVE_REDIS_URL', process.env.REDIS_URL || '');
  const report = { startedAt: new Date().toISOString(), node: process.version };
  let pgResult;
  try {
    pgResult = await postgresValidation(databaseUrl, report, { keepSchema: true });
    await redisValidation(redisUrl, report);
    await cacheCoordinationValidation(redisUrl, report);
    await appSmoke(pgResult.scopedUrl, redisUrl, report);
    report.ok = !!(report.postgres && report.postgres.ok && report.redis && report.redis.ok && report.cacheCoordination && report.cacheCoordination.ok && report.outbox && report.outbox.ok && report.app && report.app.ok);
  } finally {
    if (pgResult && pgResult.schema) await dropPostgresSchema(databaseUrl, pgResult.schema).catch(() => {});
  }
  report.finishedAt = new Date().toISOString();
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 2;
}

if (require.main === module) main().catch((err) => { console.error(err.stack || err.message); process.exitCode = 1; });
module.exports = { scopedPostgresUrl, outboxLeaseValidation, postgresValidation, redisValidation, cacheCoordinationValidation, buildAppSmokeEnv, appSmoke, dropPostgresSchema };
