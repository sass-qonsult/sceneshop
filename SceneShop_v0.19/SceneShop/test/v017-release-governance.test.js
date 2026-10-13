const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { findLatestEvidence, validateGateEvidence } = require('../tools/v017-release-manifest');

test('v0.17 release governance selects latest evidence deterministically', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sceneshop-evidence-'));
  fs.writeFileSync(path.join(dir, 'foundation-evidence-20260101T000000Z.json'), JSON.stringify({ ok:true, gate:'foundation', gitCommit:'a' }));
  fs.writeFileSync(path.join(dir, 'foundation-evidence-20260102T000000Z.json'), JSON.stringify({ ok:true, gate:'foundation', gitCommit:'b' }));
  const found = findLatestEvidence(dir, 'foundation-evidence-');
  assert.equal(found.data.gitCommit, 'b');
});

test('v0.17 release governance rejects stale evidence from another commit', () => {
  const result = validateGateEvidence({ ok:true, gate:'SceneShop v0.17 foundation', gitCommit:'old' }, { gateIncludes:'foundation', gitCommit:'new' });
  assert.equal(result.ok, false);
  assert.match(result.reasons.join(' '), /gitCommit mismatch/);
});

test('v0.17 release governance accepts matching PASS evidence', () => {
  const result = validateGateEvidence({ ok:true, gate:'SceneShop v0.17 alpha.2 recovery', gitCommit:'abc', packageVersion:'0.17.0-alpha.2' }, { gateIncludes:'recovery', gitCommit:'abc', packageVersion:'0.17.0-alpha.2' });
  assert.equal(result.ok, true);
  assert.deepEqual(result.reasons, []);
});


test('v0.17 release governance rejects evidence without candidate package version', () => {
  const result = validateGateEvidence({ ok:true, gate:'SceneShop v0.17 foundation', gitCommit:'abc' }, { gateIncludes:'foundation', gitCommit:'abc', packageVersion:'0.17.0-alpha.2' });
  assert.equal(result.ok, false);
  assert.match(result.reasons.join(' '), /packageVersion mismatch/);
});

test('v0.17 release workflow executes composite live gate before promotion verification', () => {
  const workflow = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'v0.17-release-gate.yml'), 'utf8');
  const gate = workflow.indexOf('npm run gate:alpha2');
  const verify = workflow.indexOf('npm run release:verify');
  assert.ok(gate >= 0 && verify > gate);
});

test('v0.17 foundation gate persists same-commit evidence metadata', () => {
  const script = fs.readFileSync(path.join(__dirname, '..', 'tools', 'run-foundation-gate.sh'), 'utf8');
  assert.match(script, /foundation-evidence-/);
  assert.match(script, /GIT_COMMIT=/);
  assert.match(script, /PACKAGE_VERSION=/);
  assert.match(script, /LOCK_SHA256=/);
});

test('v0.17 promotion command is fail-closed and creates only canonical refs', () => {
  const script = fs.readFileSync(path.join(__dirname, '..', 'tools', 'v017-promote.js'), 'utf8');
  assert.match(script, /release\/v0\.17/);
  assert.match(script, /v0\.17\.0-alpha\.2/);
  assert.match(script, /manifest\.eligible !== true/);
  assert.match(script, /tag', '-a'/);
});

test('v0.17 package exposes dry-run and apply promotion commands', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  assert.equal(pkg.scripts['release:promote:dry'], 'node tools/v017-promote.js');
  assert.equal(pkg.scripts['release:promote'], 'node tools/v017-promote.js --apply');
});
