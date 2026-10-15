#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const {
  readJson,
  latestMatching,
  validateCommon,
  validateBuildEvidence,
  validateSigningEvidence,
  loadQaEvidence,
} = require('./v018-production-beta-manifest');

const ROOT = path.join(__dirname, '..');
const arg = (name) => {
  const prefix = `--${name}=`;
  const item = process.argv.find((value) => value.startsWith(prefix));
  return item ? item.slice(prefix.length) : null;
};
const apply = process.argv.includes('--apply');
const requireComplete = process.argv.includes('--require-complete');
const sourceArg = arg('source');
if (!sourceArg) throw new Error('--source=<evidence-directory> is required');
const source = path.resolve(ROOT, sourceArg);
if (!fs.existsSync(source) || !fs.statSync(source).isDirectory()) throw new Error(`evidence directory not found: ${source}`);

const pkg = require(path.join(ROOT, 'package.json'));
const gitCommit = cp.execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
const matrix = readJson(path.join(ROOT, 'docs/ux/PRODUCTION_BETA_APP_QA_MATRIX_R0_1.json'));
const target = path.join(ROOT, 'artifacts');

function existing(file) { return fs.existsSync(file) ? readJson(file) : null; }
function latest(dir, prefix) { return latestMatching(dir, (name) => name.startsWith(prefix) && name.endsWith('.json')); }
function rel(file) { return file ? path.relative(source, file).replaceAll('\\', '/') : null; }
function destination(relative) { return path.join(target, relative); }
function ensureParent(file) { fs.mkdirSync(path.dirname(file), { recursive: true }); }
function copy(sourceFile, relative) { const out = destination(relative); ensureParent(out); fs.copyFileSync(sourceFile, out); return out; }

const foundation = latest(path.join(source, 'foundation-gate'), 'foundation-evidence-');
const recovery = latest(path.join(source, 'recovery-gate'), 'recovery-evidence-');
const schemaFile = path.join(source, 'rc-gate', 'schema-compatibility.json');
const buildFiles = Object.fromEntries(['desktop', 'android', 'ios'].map((platform) => [platform, path.join(source, 'native-build', `${platform}.json`)]));
const signedBuildFiles = Object.fromEntries(['android', 'ios'].map((platform) => [platform, path.join(source, 'native-build', `${platform}-signed.json`)]));
const signingFile = path.join(source, 'native-signing', 'report.json');
const qaDir = path.join(source, 'app-qa', 'executions');

const checks = {
  foundation: validateCommon(foundation?.data, { gitCommit, packageVersion: pkg.version, gateIncludes: 'foundation' }),
  recovery: validateCommon(recovery?.data, { gitCommit, packageVersion: pkg.version, gateIncludes: 'recovery' }),
  schema: { ok: false, reasons: [], evidence: existing(schemaFile) },
  builds: {},
  signedBuilds: {},
  signing: validateSigningEvidence(existing(signingFile), { gitCommit, packageVersion: pkg.version }),
  qa: loadQaEvidence(qaDir, matrix, { gitCommit, packageVersion: pkg.version }),
};
if (!checks.schema.evidence) checks.schema.reasons.push('missing evidence');
else {
  const data = checks.schema.evidence;
  if (data.ok !== true) checks.schema.reasons.push('schema evidence did not report ok=true');
  if (data.gitCommit !== gitCommit) checks.schema.reasons.push(`gitCommit mismatch: ${data.gitCommit || 'missing'} != ${gitCommit}`);
  if (data.packageVersion !== pkg.version) checks.schema.reasons.push(`packageVersion mismatch: ${data.packageVersion || 'missing'} != ${pkg.version}`);
  if (data.live?.ok !== true) checks.schema.reasons.push('live schema verification required');
  if (data.static?.rollback?.compatible !== true) checks.schema.reasons.push('rollback compatibility required');
}
checks.schema.ok = checks.schema.reasons.length === 0;
for (const platform of ['desktop', 'android', 'ios']) {
  checks.builds[platform] = validateBuildEvidence(existing(buildFiles[platform]), { platform, gitCommit, packageVersion: pkg.version });
}
for (const platform of ['android', 'ios']) {
  checks.signedBuilds[platform] = validateBuildEvidence(existing(signedBuildFiles[platform]), { platform, gitCommit, packageVersion: pkg.version, requireSigned: true });
}

const requiredChecks = [
  ['foundation', checks.foundation.ok],
  ['recovery', checks.recovery.ok],
  ['schema', checks.schema.ok],
  ['desktop build', checks.builds.desktop.ok],
  ['android build', checks.builds.android.ok],
  ['ios build', checks.builds.ios.ok],
  ['QA matrix', checks.qa.ok],
  ['production signing', checks.signing.ok],
  ['signed android build', checks.signedBuilds.android.ok],
  ['signed ios build', checks.signedBuilds.ios.ok],
];
const blockers = requiredChecks.filter(([, ok]) => !ok).map(([name]) => name);

const plannedCopies = [];
if (foundation?.file && checks.foundation.ok) plannedCopies.push([foundation.file, `foundation-gate/${path.basename(foundation.file)}`]);
if (recovery?.file && checks.recovery.ok) plannedCopies.push([recovery.file, `recovery-gate/${path.basename(recovery.file)}`]);
if (checks.schema.ok) plannedCopies.push([schemaFile, 'rc-gate/schema-compatibility.json']);
for (const platform of ['desktop', 'android', 'ios']) if (checks.builds[platform].ok) plannedCopies.push([buildFiles[platform], `native-build/${platform}.json`]);
for (const platform of ['android', 'ios']) if (checks.signedBuilds[platform].ok) plannedCopies.push([signedBuildFiles[platform], `native-build/${platform}-signed.json`]);
if (checks.signing.ok) plannedCopies.push([signingFile, 'native-signing/report.json']);
if (checks.qa.ok) {
  for (const row of matrix.matrix) {
    const evidence = latest(qaDir, `${row.id}-`);
    if (evidence?.file) plannedCopies.push([evidence.file, `app-qa/executions/${path.basename(evidence.file)}`]);
  }
}

const report = {
  schemaVersion: 1,
  release: 'SceneShop v0.19 external evidence import',
  mode: apply ? 'apply' : 'dry-run',
  source,
  gitCommit,
  packageVersion: pkg.version,
  complete: blockers.length === 0,
  blockers,
  checks,
  plannedCopies: plannedCopies.map(([from, to]) => ({ from: rel(from), to })),
  copied: [],
};

if (requireComplete && blockers.length) {
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  process.exitCode = 2;
} else if (apply) {
  for (const [from, to] of plannedCopies) report.copied.push(path.relative(ROOT, copy(from, to)).replaceAll('\\', '/'));
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
} else {
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
}
