#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const cp = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const MATRIX_PATH = path.join(ROOT, 'docs/ux/PRODUCTION_BETA_APP_QA_MATRIX_R0_1.json');
const matrix = JSON.parse(fs.readFileSync(MATRIX_PATH, 'utf8'));
const arg = (name) => {
  const prefix = `--${name}=`;
  const value = process.argv.find((item) => item.startsWith(prefix));
  return value ? value.slice(prefix.length) : null;
};
const id = arg('id');
const result = String(arg('result') || '').toUpperCase();
const checks = String(arg('checks') || '').split(',').map((x) => x.trim()).filter(Boolean);
const runtime = arg('runtime');
const outArg = arg('out');
const physicalDevice = process.argv.includes('--physical-device');
const notes = arg('notes');
if (!id) throw new Error('--id is required');
if (!['PASS', 'FAIL'].includes(result)) throw new Error('--result must be PASS or FAIL');
const row = matrix.matrix.find((item) => item.id === id);
if (!row) throw new Error(`unknown QA row: ${id}`);
if (runtime && runtime !== row.runtime) throw new Error(`runtime mismatch: expected "${row.runtime}"`);
const missingChecks = row.required.filter((required) => !checks.includes(required));
if (result === 'PASS' && missingChecks.length) throw new Error(`PASS is invalid; missing required checks: ${missingChecks.join(', ')}`);
if (id === 'ios-current-device' && result === 'PASS' && !physicalDevice) throw new Error('ios-current-device PASS requires --physical-device');
const gitCommit = cp.execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
const packageVersion = require(path.join(ROOT, 'package.json')).version;
const evidence = {
  schemaVersion: 1,
  gate: `SceneShop ${packageVersion} application QA`,
  ok: result === 'PASS' && missingChecks.length === 0,
  id,
  surface: row.surface,
  runtime: row.runtime,
  result,
  requiredChecks: row.required,
  executedChecks: checks,
  missingChecks,
  physicalDevice,
  gitCommit,
  packageVersion,
  executedAt: new Date().toISOString(),
  runner: {
    os: process.env.RUNNER_OS || process.platform,
    arch: process.arch,
    nameHash: process.env.RUNNER_NAME ? crypto.createHash('sha256').update(process.env.RUNNER_NAME).digest('hex') : null,
  },
  notes: notes || null,
};
const text = JSON.stringify(evidence, null, 2) + '\n';
if (outArg) {
  const out = path.resolve(ROOT, outArg);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, text);
}
process.stdout.write(text);
if (!evidence.ok) process.exitCode = 2;
