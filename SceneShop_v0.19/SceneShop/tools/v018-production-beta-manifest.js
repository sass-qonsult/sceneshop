#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
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
function readJson(filePath) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); }
  catch (error) { return { ok: false, parseError: error.message }; }
}
function latestMatching(dir, predicate) {
  if (!fs.existsSync(dir)) return null;
  const names = fs.readdirSync(dir).filter(predicate).sort().reverse();
  if (!names.length) return null;
  const file = path.join(dir, names[0]);
  return { file, name: names[0], data: readJson(file) };
}
function validateCommon(data, { gitCommit, packageVersion, gateIncludes } = {}) {
  const reasons = [];
  if (!data) return { ok: false, reasons: ['missing evidence'], evidence: null };
  if (data.ok !== true) reasons.push('evidence did not report ok=true');
  if (gateIncludes && !String(data.gate || '').toLowerCase().includes(String(gateIncludes).toLowerCase())) reasons.push(`unexpected gate: ${data.gate || 'missing'}`);
  if (gitCommit && data.gitCommit !== gitCommit) reasons.push(`gitCommit mismatch: ${data.gitCommit || 'missing'} != ${gitCommit}`);
  if (packageVersion && data.packageVersion !== packageVersion) reasons.push(`packageVersion mismatch: ${data.packageVersion || 'missing'} != ${packageVersion}`);
  return { ok: reasons.length === 0, reasons, evidence: data };
}
function validateBuildEvidence(data, { platform, gitCommit, packageVersion, requireSigned = false } = {}) {
  const base = validateCommon(data, { gitCommit, packageVersion, gateIncludes: platform });
  const reasons = [...base.reasons];
  if (data && data.platform !== platform) reasons.push(`platform mismatch: ${data.platform || 'missing'} != ${platform}`);
  if (data && !/^[a-f0-9]{64}$/.test(String(data.artifact?.sha256 || ''))) reasons.push('artifact sha256 missing or invalid');
  if (data && !(Number(data.artifact?.bytes) > 0)) reasons.push('artifact bytes missing or invalid');
  if (requireSigned && data?.signed !== true) reasons.push('production-signed artifact required');
  if (requireSigned && data?.signatureVerified !== true) reasons.push('cryptographic signature verification evidence required');
  return { ok: reasons.length === 0, reasons, evidence: data || null };
}
function validateSigningEvidence(data, { gitCommit, packageVersion } = {}) {
  const reasons = [];
  if (!data) return { ok: false, reasons: ['missing signing evidence'], evidence: null };
  if (data.ready !== true) reasons.push('signing report did not report ready=true');
  if (gitCommit && data.gitCommit !== gitCommit) reasons.push(`gitCommit mismatch: ${data.gitCommit || 'missing'} != ${gitCommit}`);
  if (packageVersion && data.version !== packageVersion) reasons.push(`version mismatch: ${data.version || 'missing'} != ${packageVersion}`);
  if (data.android?.signingReady !== true) reasons.push('Android signing not ready');
  if (data.apple?.signingReady !== true) reasons.push('Apple signing not ready');
  return { ok: reasons.length === 0, reasons, evidence: data };
}
function loadQaEvidence(qaDir, matrix, { gitCommit, packageVersion } = {}) {
  const results = {};
  const missing = [];
  const invalid = [];
  for (const row of matrix.matrix) {
    const evidence = latestMatching(qaDir, (name) => name.startsWith(`${row.id}-`) && name.endsWith('.json'));
    if (!evidence) {
      missing.push(row.id);
      results[row.id] = { ok: false, reasons: ['missing evidence'], evidence: null };
      continue;
    }
    const data = evidence.data;
    const reasons = [];
    if (data.ok !== true || data.result !== 'PASS') reasons.push('QA row did not report PASS');
    if (data.id !== row.id) reasons.push(`id mismatch: ${data.id || 'missing'}`);
    if (data.runtime !== row.runtime) reasons.push(`runtime mismatch: ${data.runtime || 'missing'} != ${row.runtime}`);
    if (data.gitCommit !== gitCommit) reasons.push(`gitCommit mismatch: ${data.gitCommit || 'missing'} != ${gitCommit}`);
    if (data.packageVersion !== packageVersion) reasons.push(`packageVersion mismatch: ${data.packageVersion || 'missing'} != ${packageVersion}`);
    const executed = new Set(Array.isArray(data.executedChecks) ? data.executedChecks : []);
    const missed = row.required.filter((check) => !executed.has(check));
    if (missed.length) reasons.push(`required checks missing: ${missed.join(', ')}`);
    if (row.id === 'ios-current-device' && data.physicalDevice !== true) reasons.push('physical-device attestation missing');
    results[row.id] = { ok: reasons.length === 0, reasons, evidence: data };
    if (reasons.length) invalid.push(row.id);
  }
  return { ok: missing.length === 0 && invalid.length === 0, missing, invalid, rows: results };
}

async function buildProductionBetaManifest({ rootDir = path.join(__dirname, '..'), artifactsDir = path.join(rootDir, 'artifacts') } = {}) {
  const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
  const matrix = JSON.parse(fs.readFileSync(path.join(rootDir, 'docs/ux/PRODUCTION_BETA_APP_QA_MATRIX_R0_1.json'), 'utf8'));
  const gitCommit = currentGitCommit(rootDir);
  const preflight = await collectPreflight({ rootDir });
  const foundation = latestMatching(path.join(artifactsDir, 'foundation-gate'), (name) => name.startsWith('foundation-evidence-') && name.endsWith('.json'));
  const recovery = latestMatching(path.join(artifactsDir, 'recovery-gate'), (name) => name.startsWith('recovery-evidence-') && name.endsWith('.json'));
  const foundationCheck = validateCommon(foundation?.data, { gitCommit, packageVersion: pkg.version, gateIncludes: 'foundation' });
  const recoveryCheck = validateCommon(recovery?.data, { gitCommit, packageVersion: pkg.version, gateIncludes: 'recovery' });
  const builds = {};
  for (const platform of ['desktop', 'android', 'ios']) {
    const file = path.join(artifactsDir, 'native-build', `${platform}.json`);
    builds[platform] = validateBuildEvidence(fs.existsSync(file) ? readJson(file) : null, { platform, gitCommit, packageVersion: pkg.version });
  }
  const signedBuilds = {
    android: validateBuildEvidence(fs.existsSync(path.join(artifactsDir, 'native-build', 'android-signed.json')) ? readJson(path.join(artifactsDir, 'native-build', 'android-signed.json')) : null, { platform: 'android', gitCommit, packageVersion: pkg.version, requireSigned: true }),
    ios: validateBuildEvidence(fs.existsSync(path.join(artifactsDir, 'native-build', 'ios-signed.json')) ? readJson(path.join(artifactsDir, 'native-build', 'ios-signed.json')) : null, { platform: 'ios', gitCommit, packageVersion: pkg.version, requireSigned: true }),
  };
  const signingPath = path.join(artifactsDir, 'native-signing', 'report.json');
  const signing = validateSigningEvidence(fs.existsSync(signingPath) ? readJson(signingPath) : null, { gitCommit, packageVersion: pkg.version });
  const qa = loadQaEvidence(path.join(artifactsDir, 'app-qa', 'executions'), matrix, { gitCommit, packageVersion: pkg.version });

  const candidateBlockers = [];
  if (!/^0\.18\.0-(?:alpha\.\d+|beta\.\d+)$/.test(pkg.version)) candidateBlockers.push(`unexpected v0.18 candidate version: ${pkg.version}`);
  if (!preflight.lockfile.ok) candidateBlockers.push('strict dependency lock is not valid');
  if (!preflight.productionDependencies.ok) candidateBlockers.push('production dependency declarations are incomplete');
  if (!foundationCheck.ok) candidateBlockers.push(`foundation evidence invalid: ${foundationCheck.reasons.join('; ')}`);
  if (!recoveryCheck.ok) candidateBlockers.push(`recovery evidence invalid: ${recoveryCheck.reasons.join('; ')}`);
  for (const platform of ['desktop', 'android', 'ios']) if (!builds[platform].ok) candidateBlockers.push(`${platform} build evidence invalid: ${builds[platform].reasons.join('; ')}`);
  if (!qa.ok) candidateBlockers.push(`QA evidence incomplete: missing=[${qa.missing.join(',')}], invalid=[${qa.invalid.join(',')}]`);
  if (!gitIsClean(rootDir)) candidateBlockers.push('git worktree is not clean');

  const distributionBlockers = [...candidateBlockers];
  if (!signing.ok) distributionBlockers.push(`production signing evidence invalid: ${signing.reasons.join('; ')}`);
  if (!signedBuilds.android.ok) distributionBlockers.push(`signed Android build invalid: ${signedBuilds.android.reasons.join('; ')}`);
  if (!signedBuilds.ios.ok) distributionBlockers.push(`signed iOS build invalid: ${signedBuilds.ios.reasons.join('; ')}`);

  return {
    schemaVersion: 1,
    release: 'SceneShop v0.18 Production Beta',
    candidateVersion: pkg.version,
    gitCommit,
    generatedAt: new Date().toISOString(),
    betaCandidateEligible: candidateBlockers.length === 0,
    productionDistributionReady: distributionBlockers.length === 0,
    candidateBlockers,
    distributionBlockers,
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
      builds,
      qa,
      productionSigning: signing,
      signedBuilds,
    },
  };
}

async function main() {
  const rootDir = path.join(__dirname, '..');
  const requireCandidate = process.argv.includes('--require-candidate');
  const requireDistribution = process.argv.includes('--require-distribution');
  const outArg = process.argv.find((arg) => arg.startsWith('--out='));
  const outPath = outArg ? path.resolve(rootDir, outArg.slice('--out='.length)) : null;
  const manifest = await buildProductionBetaManifest({ rootDir });
  const text = JSON.stringify(manifest, null, 2) + '\n';
  if (outPath) { fs.mkdirSync(path.dirname(outPath), { recursive: true }); fs.writeFileSync(outPath, text); }
  process.stdout.write(text);
  if (requireDistribution && !manifest.productionDistributionReady) process.exitCode = 3;
  else if (requireCandidate && !manifest.betaCandidateEligible) process.exitCode = 2;
}
if (require.main === module) main().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
module.exports = { readJson, latestMatching, validateCommon, validateBuildEvidence, validateSigningEvidence, loadQaEvidence, buildProductionBetaManifest };
