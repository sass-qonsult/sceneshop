const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const { inspectDependencyClosure, inspectLockfile, collectPreflight } = require('../tools/release-preflight');
const { listMigrationManifest, validateMigrationManifest } = require('../server/data/migration-manifest');
const { buildAppSmokeEnv } = require('../tools/live-data-plane-validation');

test('release preflight: migration chain is contiguous through Scale & Reliability alpha.2', async () => {
  const dir = path.join(__dirname, '..', 'server', 'data', 'migrations');
  const report = validateMigrationManifest(await listMigrationManifest(dir));
  assert.equal(report.count, 27);
  assert.equal(report.latest, '0027_cache_coordination_recovery.sql');
  assert.match(report.latestChecksum, /^[a-f0-9]{64}$/);
});

test('release preflight: lockfile drift is detected instead of silently accepted', () => {
  const pkg = { version: '1.0.0', dependencies: { a: '^1.0.0', b: '^1.0.0' } };
  const lock = { packages: { '': { version: '1.0.0', dependencies: { a: '^1.0.0', b: '^1.0.0' } }, 'node_modules/a': { version: '1.0.0' } } };
  const r = inspectLockfile(pkg, lock);
  assert.equal(r.ok, false);
  assert.deepEqual(r.missingPackageEntries, ['b']);
});

test('release preflight: current project declares all production data-plane dependencies', async () => {
  const report = await collectPreflight({ rootDir: path.join(__dirname, '..') });
  assert.equal(report.version, require('../package.json').version);
  assert.equal(report.productionDependencies.ok, true);
  assert.equal(report.lockfile.ok, true);
  assert.deepEqual(report.lockfile.missingPackageEntries, []);
});


test('release preflight: dependency closure detects unresolved transitive packages', () => {
  const lock = {
    packages: {
      '': { version: '1.0.0', dependencies: { a: '1.0.0' } },
      'node_modules/a': { version: '1.0.0', dependencies: { b: '^1.0.0' } },
    },
  };
  const result = inspectDependencyClosure(lock);
  assert.equal(result.ok, false);
  assert.equal(result.unresolved.length, 1);
  assert.equal(result.unresolved[0].dependencyName, 'b');
});

test('release preflight: current critical data-plane lock is exact and transitively closed', async () => {
  const report = await collectPreflight({ rootDir: path.join(__dirname, '..') });
  assert.equal(report.lockfile.ok, true);
  assert.equal(report.lockfile.closure.ok, true);
  assert.equal(report.lockfile.nodeEngine.ok, true);
  assert.deepEqual(
    report.lockfile.criticalVersions.map(({ name, expected, actual, ok }) => ({ name, expected, actual, ok })),
    [
      { name: 'pg', expected: '8.23.1', actual: '8.23.1', ok: true },
      { name: 'redis', expected: '6.3.0', actual: '6.3.0', ok: true },
      { name: '@socket.io/redis-adapter', expected: '8.3.0', actual: '8.3.0', ok: true },
    ],
  );
});


test('live gate: production app smoke cannot inherit memory backend', () => {
  const env = buildAppSmokeEnv(
    'postgresql://u:p@127.0.0.1:5432/db',
    'redis://127.0.0.1:6379',
    { SCENESHOP_MEMORY: '1', DEMO: '1', OTHER: 'kept' },
  );
  assert.equal(env.SCENESHOP_MEMORY, undefined);
  assert.equal(env.DATA_BACKEND, 'postgres');
  assert.equal(env.SESSION_BACKEND, 'redis');
  assert.equal(env.CACHE_BACKEND, 'redis');
  assert.equal(env.NODE_ENV, 'production');
  assert.equal(env.DEMO, '0');
  assert.equal(env.OTHER, 'kept');
});
