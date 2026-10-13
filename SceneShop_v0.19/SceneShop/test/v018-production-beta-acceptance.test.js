'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');
const {
  validateCommon,
  validateBuildEvidence,
  validateSigningEvidence,
  loadQaEvidence,
} = require('../tools/v018-production-beta-manifest');
const { buildPromotionPlan } = require('../tools/v018-promote');

const ROOT = path.join(__dirname, '..');
const pkg = require('../package.json');
const commit = cp.execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
const matrix = require('../docs/ux/PRODUCTION_BETA_APP_QA_MATRIX_R0_1.json');

test('common evidence requires ok, current commit and current package version', () => {
  const good = validateCommon({ ok: true, gate: 'SceneShop foundation', gitCommit: commit, packageVersion: pkg.version }, { gitCommit: commit, packageVersion: pkg.version, gateIncludes: 'foundation' });
  assert.equal(good.ok, true);
  const stale = validateCommon({ ok: true, gate: 'SceneShop foundation', gitCommit: 'deadbeef', packageVersion: pkg.version }, { gitCommit: commit, packageVersion: pkg.version, gateIncludes: 'foundation' });
  assert.equal(stale.ok, false);
  assert.match(stale.reasons.join(' '), /gitCommit mismatch/);
});

test('build evidence binds platform artifact hash commit version and signing state', () => {
  const base = { ok: true, gate: 'SceneShop v0.18 android build', platform: 'android', gitCommit: commit, packageVersion: pkg.version, signed: false, artifact: { sha256: 'a'.repeat(64), bytes: 100 } };
  assert.equal(validateBuildEvidence(base, { platform: 'android', gitCommit: commit, packageVersion: pkg.version }).ok, true);
  const signed = validateBuildEvidence(base, { platform: 'android', gitCommit: commit, packageVersion: pkg.version, requireSigned: true });
  assert.equal(signed.ok, false);
  assert.match(signed.reasons.join(' '), /production-signed artifact required/);
});

test('signing evidence is same-commit and requires both mobile signing authorities', () => {
  const good = validateSigningEvidence({ ready: true, gitCommit: commit, version: pkg.version, android: { signingReady: true }, apple: { signingReady: true } }, { gitCommit: commit, packageVersion: pkg.version });
  assert.equal(good.ok, true);
  const missingApple = validateSigningEvidence({ ready: false, gitCommit: commit, version: pkg.version, android: { signingReady: true }, apple: { signingReady: false } }, { gitCommit: commit, packageVersion: pkg.version });
  assert.equal(missingApple.ok, false);
});

test('QA evidence requires every matrix row, runtime and declared checks', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sceneshop-qa-'));
  try {
    for (const row of matrix.matrix) {
      const evidence = {
        ok: true,
        id: row.id,
        runtime: row.runtime,
        result: 'PASS',
        executedChecks: row.required,
        physicalDevice: row.id === 'ios-current-device',
        gitCommit: commit,
        packageVersion: pkg.version,
      };
      fs.writeFileSync(path.join(dir, `${row.id}-20261004T000000Z.json`), JSON.stringify(evidence));
    }
    const good = loadQaEvidence(dir, matrix, { gitCommit: commit, packageVersion: pkg.version });
    assert.equal(good.ok, true);
    const target = path.join(dir, 'android-target-20261004T000000Z.json');
    const bad = JSON.parse(fs.readFileSync(target, 'utf8'));
    bad.executedChecks = bad.executedChecks.filter((x) => x !== 'secure-store');
    fs.writeFileSync(target, JSON.stringify(bad));
    const invalid = loadQaEvidence(dir, matrix, { gitCommit: commit, packageVersion: pkg.version });
    assert.equal(invalid.ok, false);
    assert.deepEqual(invalid.invalid, ['android-target']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('QA recorder refuses incomplete PASS and physical iOS device without attestation', () => {
  const incomplete = cp.spawnSync(process.execPath, ['tools/app-qa-evidence.js', '--id=web-chromium', '--result=PASS', '--checks=session-deeplink'], { cwd: ROOT, encoding: 'utf8' });
  assert.notEqual(incomplete.status, 0);
  assert.match(incomplete.stderr, /missing required checks/);
  const device = cp.spawnSync(process.execPath, ['tools/app-qa-evidence.js', '--id=ios-current-device', '--result=PASS', '--checks=apns-token,universal-link,share-extension,keychain,offline-reconnect'], { cwd: ROOT, encoding: 'utf8' });
  assert.notEqual(device.status, 0);
  assert.match(device.stderr, /physical-device/);
});

test('QA recorder emits current commit/version only for a complete row', () => {
  const out = cp.execFileSync(process.execPath, ['tools/app-qa-evidence.js', '--id=web-firefox', '--result=PASS', '--checks=session-deeplink,commerce-timeline,offline-shell'], { cwd: ROOT, encoding: 'utf8' });
  const evidence = JSON.parse(out);
  assert.equal(evidence.ok, true);
  assert.equal(evidence.gitCommit, commit);
  assert.equal(evidence.packageVersion, pkg.version);
});

test('v0.18 promotion remains fail-closed until complete beta.1 evidence exists', () => {
  const manifest = { gitCommit: commit, candidateVersion: '0.18.0-beta.1', betaCandidateEligible: false, productionDistributionReady: false, candidateBlockers: ['foundation evidence missing'] };
  const plan = buildPromotionPlan({ rootDir: ROOT, manifest, branch: 'release/v0.18-test-never-create', tag: 'v0.18.0-beta.1-test-never-create' });
  assert.equal(manifest.candidateVersion, '0.18.0-beta.1');
  assert.equal(plan.eligible, false);
  assert.doesNotMatch(plan.blockers.join(' '), /package version must be/);
  assert.match(plan.blockers.join(' '), /foundation evidence missing/);
  assert.match(plan.blockers.join(' '), /manifest is not eligible/);
});

test('v0.18 production beta workflow aggregates live and three platform build evidences', () => {
  const workflow = fs.readFileSync(path.join(ROOT, '.github/workflows/v0.18-production-beta-gate.yml'), 'utf8');
  assert.match(workflow, /live-infrastructure:/);
  assert.match(workflow, /desktop-build:/);
  assert.match(workflow, /android-build:/);
  assert.match(workflow, /ios-build:/);
  assert.match(workflow, /npm run beta:manifest/);
});

test('v0.18 package exposes fail-closed manifest verify and promotion commands', () => {
  const scripts = require('../package.json').scripts;
  assert.equal(scripts['beta:manifest'].includes('v018-production-beta-manifest.js'), true);
  assert.equal(scripts['beta:verify'].includes('--require-candidate'), true);
  assert.equal(scripts['beta:verify:distribution'].includes('--require-distribution'), true);
  assert.equal(scripts['beta:promote:dry'].includes('v018-promote.js'), true);
  assert.equal(scripts['beta:promote'].includes('--apply'), true);
});
