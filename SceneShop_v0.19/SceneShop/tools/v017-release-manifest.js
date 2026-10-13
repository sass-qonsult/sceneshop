#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { collectPreflight } = require('./release-preflight');

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function currentGitCommit(rootDir) {
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: rootDir, encoding: 'utf8' }).trim();
}

function gitIsClean(rootDir) {
  return execFileSync('git', ['status', '--porcelain'], { cwd: rootDir, encoding: 'utf8' }).trim() === '';
}

function listEvidence(dir, prefix) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((name) => name.startsWith(prefix) && name.endsWith('.json'))
    .sort()
    .reverse()
    .map((name) => ({ name, path: path.join(dir, name) }));
}

function readEvidence(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    return { ok: false, parseError: error.message };
  }
}

function findLatestEvidence(dir, prefix) {
  const first = listEvidence(dir, prefix)[0];
  if (!first) return null;
  return { ...first, data: readEvidence(first.path) };
}

function validateGateEvidence(evidence, { gateIncludes, gitCommit, packageVersion } = {}) {
  const reasons = [];
  if (!evidence) return { ok: false, reasons: ['missing evidence'], evidence: null };
  const data = evidence.data || evidence;
  if (data.ok !== true) reasons.push('gate did not report ok=true');
  if (gateIncludes && !String(data.gate || '').toLowerCase().includes(String(gateIncludes).toLowerCase())) reasons.push(`unexpected gate: ${data.gate || 'missing'}`);
  if (gitCommit && data.gitCommit !== gitCommit) reasons.push(`gitCommit mismatch: ${data.gitCommit || 'missing'} != ${gitCommit}`);
  if (packageVersion && data.packageVersion !== packageVersion) reasons.push(`packageVersion mismatch: ${data.packageVersion || 'missing'} != ${packageVersion}`);
  return { ok: reasons.length === 0, reasons, evidence: data };
}

async function buildReleaseManifest({ rootDir = path.join(__dirname, '..') } = {}) {
  const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
  const gitCommit = currentGitCommit(rootDir);
  const preflight = await collectPreflight({ rootDir });
  const foundation = findLatestEvidence(path.join(rootDir, 'artifacts', 'foundation-gate'), 'foundation-evidence-');
  const recovery = findLatestEvidence(path.join(rootDir, 'artifacts', 'recovery-gate'), 'recovery-evidence-');
  const foundationCheck = validateGateEvidence(foundation, { gateIncludes: 'foundation', gitCommit, packageVersion: pkg.version });
  const recoveryCheck = validateGateEvidence(recovery, { gateIncludes: 'recovery', gitCommit, packageVersion: pkg.version });
  const blockers = [];
  if (pkg.version !== '0.17.0-alpha.2') blockers.push(`candidate version must be 0.17.0-alpha.2, found ${pkg.version}`);
  if (!preflight.lockfile.ok) blockers.push('strict dependency lock is not valid');
  if (!preflight.productionDependencies.ok) blockers.push('production dependency declarations are incomplete');
  if (!foundationCheck.ok) blockers.push(`foundation evidence invalid: ${foundationCheck.reasons.join('; ')}`);
  if (!recoveryCheck.ok) blockers.push(`recovery evidence invalid: ${recoveryCheck.reasons.join('; ')}`);
  if (!gitIsClean(rootDir)) blockers.push('git worktree is not clean');
  const manifest = {
    schemaVersion: 1,
    release: 'SceneShop v0.17 alpha.2',
    candidateVersion: pkg.version,
    gitCommit,
    generatedAt: new Date().toISOString(),
    eligible: blockers.length === 0,
    blockers,
    source: {
      packageLockSha256: sha256File(path.join(rootDir, 'package-lock.json')),
      migrationCount: preflight.migrations.count,
      latestMigration: preflight.migrations.latest,
      latestMigrationChecksum: preflight.migrations.latestChecksum,
      nodeEngine: preflight.lockfile.nodeEngine.declared,
    },
    gates: {
      foundation: foundationCheck,
      recovery: recoveryCheck,
    },
  };
  return manifest;
}

async function main() {
  const rootDir = path.join(__dirname, '..');
  const requireLive = process.argv.includes('--require-live');
  const outArg = process.argv.find((arg) => arg.startsWith('--out='));
  const outPath = outArg ? path.resolve(rootDir, outArg.slice('--out='.length)) : null;
  const manifest = await buildReleaseManifest({ rootDir });
  const text = JSON.stringify(manifest, null, 2) + '\n';
  if (outPath) {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, text);
  }
  process.stdout.write(text);
  if (requireLive && !manifest.eligible) process.exitCode = 2;
}

if (require.main === module) main().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
module.exports = { sha256File, listEvidence, readEvidence, findLatestEvidence, validateGateEvidence, buildReleaseManifest };
