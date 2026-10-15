#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { listMigrationManifest, validateMigrationManifest } = require('../server/data/migration-manifest');

const CRITICAL_LOCK_VERSIONS = Object.freeze({
  pg: '8.23.1',
  redis: '6.3.0',
  '@socket.io/redis-adapter': '8.3.0',
});

function resolveLockedDependency(packages, fromPath, dependencyName) {
  let base = fromPath || '';
  const candidates = [];
  while (base) {
    candidates.push(`${base}/node_modules/${dependencyName}`);
    const marker = base.lastIndexOf('/node_modules/');
    if (marker < 0) break;
    base = base.slice(0, marker);
  }
  candidates.push(`node_modules/${dependencyName}`);
  return candidates.find((candidate) => packages[candidate]) || null;
}

function inspectDependencyClosure(lock) {
  const packages = (lock && lock.packages) || {};
  const unresolved = [];
  for (const [packagePath, metadata] of Object.entries(packages)) {
    for (const field of ['dependencies', 'optionalDependencies']) {
      for (const [dependencyName, range] of Object.entries((metadata && metadata[field]) || {})) {
        if (!resolveLockedDependency(packages, packagePath, dependencyName)) {
          unresolved.push({ packagePath, field, dependencyName, range });
        }
      }
    }
    for (const [dependencyName, range] of Object.entries((metadata && metadata.peerDependencies) || {})) {
      if (metadata.peerDependenciesMeta && metadata.peerDependenciesMeta[dependencyName] && metadata.peerDependenciesMeta[dependencyName].optional) continue;
      if (!resolveLockedDependency(packages, packagePath, dependencyName)) {
        unresolved.push({ packagePath, field: 'peerDependencies', dependencyName, range });
      }
    }
  }
  return { ok: unresolved.length === 0, unresolved };
}

function inspectLockfile(pkg, lock) {
  const root = lock && lock.packages && lock.packages[''];
  const packages = (lock && lock.packages) || {};
  const declared = Object.keys(pkg.dependencies || {}).sort();
  const rootDeps = Object.keys((root && root.dependencies) || {}).sort();
  const missingFromRoot = declared.filter((name) => !rootDeps.includes(name));
  const extraInRoot = rootDeps.filter((name) => !declared.includes(name));
  const missingPackageEntries = declared.filter((name) => !packages[`node_modules/${name}`]);
  const criticalVersions = Object.entries(CRITICAL_LOCK_VERSIONS).map(([name, expected]) => {
    const entry = packages[`node_modules/${name}`];
    return {
      name,
      expected,
      actual: entry && entry.version,
      integrity: entry && entry.integrity,
      ok: !!entry && entry.version === expected && typeof entry.integrity === 'string' && entry.integrity.startsWith('sha512-'),
    };
  });
  const closure = inspectDependencyClosure(lock);
  const nodeEngine = pkg && pkg.engines && pkg.engines.node;
  const nodeEngineOk = typeof nodeEngine === 'string' && /(>=\s*20|>=20|22)/.test(nodeEngine);
  return {
    ok: !!root
      && root.version === pkg.version
      && !missingFromRoot.length
      && !extraInRoot.length
      && !missingPackageEntries.length
      && criticalVersions.every((entry) => entry.ok)
      && closure.ok
      && nodeEngineOk,
    packageVersion: pkg.version,
    lockRootVersion: root && root.version,
    missingFromRoot,
    extraInRoot,
    missingPackageEntries,
    criticalVersions,
    closure,
    nodeEngine: { declared: nodeEngine || null, ok: nodeEngineOk },
  };
}

async function collectPreflight({ rootDir = path.join(__dirname, '..') } = {}) {
  const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
  const lock = JSON.parse(fs.readFileSync(path.join(rootDir, 'package-lock.json'), 'utf8'));
  const lockfile = inspectLockfile(pkg, lock);
  const migrationsDir = path.join(rootDir, 'server', 'data', 'migrations');
  const migrations = validateMigrationManifest(await listMigrationManifest(migrationsDir));
  const requiredProd = ['pg', 'redis', '@socket.io/redis-adapter'];
  const declaredProd = requiredProd.filter((name) => pkg.dependencies && pkg.dependencies[name]);
  const missingProdDeclarations = requiredProd.filter((name) => !declaredProd.includes(name));
  return {
    version: pkg.version,
    node: process.version,
    lockfile,
    migrations,
    productionDependencies: { ok: !missingProdDeclarations.length, required: requiredProd, missing: missingProdDeclarations },
  };
}

async function main() {
  const strict = process.argv.includes('--strict');
  const report = await collectPreflight();
  const blockers = [];
  if (!report.productionDependencies.ok) blockers.push(`dependências de produção ausentes: ${report.productionDependencies.missing.join(', ')}`);
  if (strict && !report.lockfile.ok) blockers.push(`package-lock incompleto: ${report.lockfile.missingPackageEntries.join(', ') || 'versão/root divergente'}`);
  report.strict = strict;
  report.blockers = blockers;
  report.ok = blockers.length === 0;
  console.log(JSON.stringify(report, null, 2));
  if (blockers.length) process.exitCode = 2;
}

if (require.main === module) main().catch((err) => { console.error(err.stack || err.message); process.exitCode = 1; });
module.exports = { CRITICAL_LOCK_VERSIONS, resolveLockedDependency, inspectDependencyClosure, inspectLockfile, collectPreflight };
