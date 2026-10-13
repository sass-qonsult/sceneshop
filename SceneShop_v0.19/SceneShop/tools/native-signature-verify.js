#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const cp = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const arg = (name) => {
  const prefix = `--${name}=`;
  const item = process.argv.find((value) => value.startsWith(prefix));
  return item ? item.slice(prefix.length) : null;
};
const normalizeHex = (value) => String(value || '').replace(/[^A-Fa-f0-9]/g, '').toUpperCase();
function sha256File(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function commandExists(name) { return cp.spawnSync('bash', ['-lc', `command -v ${name}`], { stdio: 'ignore' }).status === 0; }
function parseApkSignerDigest(text) {
  const match = String(text || '').match(/certificate SHA-256 digest:\s*([A-Fa-f0-9:]+)/i);
  return match ? normalizeHex(match[1]) : null;
}
function parseCodeSignTeam(text) {
  const match = String(text || '').match(/TeamIdentifier=([^\s]+)/);
  return match ? match[1].trim().toUpperCase() : null;
}
function findApp(dir) {
  const queue = [dir];
  while (queue.length) {
    const current = queue.shift();
    for (const name of fs.readdirSync(current)) {
      const full = path.join(current, name);
      const st = fs.statSync(full);
      if (st.isDirectory() && name.endsWith('.app')) return full;
      if (st.isDirectory()) queue.push(full);
    }
  }
  return null;
}
function verifyAndroid(artifact, expectedFingerprint) {
  if (!commandExists('apksigner')) throw new Error('apksigner is required for Android signature verification');
  if (!/^[A-F0-9]{64}$/.test(expectedFingerprint)) throw new Error('SCENESHOP_ANDROID_SIGNING_CERT_SHA256 must contain a 64-hex SHA-256 fingerprint');
  const run = cp.spawnSync('apksigner', ['verify', '--verbose', '--print-certs', artifact], { encoding: 'utf8' });
  if (run.status !== 0) throw new Error(`apksigner verification failed: ${(run.stderr || run.stdout || '').trim()}`);
  const digest = parseApkSignerDigest(`${run.stdout || ''}\n${run.stderr || ''}`);
  if (!digest) throw new Error('apksigner did not report a signer SHA-256 digest');
  if (digest !== expectedFingerprint) throw new Error(`Android signing fingerprint mismatch: ${digest} != ${expectedFingerprint}`);
  return { verifier: 'apksigner', identityType: 'sha256-cert-fingerprint', identity: digest };
}
function verifyIos(artifact, expectedTeam) {
  if (process.platform !== 'darwin') throw new Error('iOS signature verification requires macOS');
  if (!commandExists('codesign')) throw new Error('codesign is required for iOS signature verification');
  if (!/^[A-Z0-9]{10}$/.test(expectedTeam)) throw new Error('SCENESHOP_APPLE_TEAM_ID must contain a 10-character Apple Team ID');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sceneshop-ios-signature-'));
  try {
    let app = null;
    if (fs.statSync(artifact).isDirectory() && artifact.endsWith('.app')) app = artifact;
    else {
      if (!commandExists('ditto')) throw new Error('ditto is required to inspect packaged iOS artifacts');
      const unpack = cp.spawnSync('ditto', ['-x', '-k', artifact, tmp], { encoding: 'utf8' });
      if (unpack.status !== 0) throw new Error(`iOS artifact extraction failed: ${(unpack.stderr || '').trim()}`);
      app = findApp(tmp);
    }
    if (!app) throw new Error('no .app bundle found in iOS artifact');
    const verify = cp.spawnSync('codesign', ['--verify', '--deep', '--strict', '--verbose=2', app], { encoding: 'utf8' });
    if (verify.status !== 0) throw new Error(`codesign verification failed: ${(verify.stderr || verify.stdout || '').trim()}`);
    const detail = cp.spawnSync('codesign', ['-dv', '--verbose=4', app], { encoding: 'utf8' });
    if (detail.status !== 0) throw new Error(`codesign identity inspection failed: ${(detail.stderr || detail.stdout || '').trim()}`);
    const team = parseCodeSignTeam(`${detail.stdout || ''}\n${detail.stderr || ''}`);
    if (!team) throw new Error('codesign did not report TeamIdentifier');
    if (team !== expectedTeam) throw new Error(`Apple TeamIdentifier mismatch: ${team} != ${expectedTeam}`);
    return { verifier: 'codesign', identityType: 'apple-team-id', identity: team };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function buildSignatureEvidence({ platform, artifact, rootDir = ROOT } = {}) {
  const gitCommit = cp.execFileSync('git', ['rev-parse', 'HEAD'], { cwd: rootDir, encoding: 'utf8' }).trim();
  const packageVersion = require(path.join(rootDir, 'package.json')).version;
  const artifactPath = path.resolve(rootDir, artifact);
  if (!fs.existsSync(artifactPath)) throw new Error(`artifact not found: ${artifactPath}`);
  if (!['android', 'ios'].includes(platform)) throw new Error('platform must be android or ios');
  const verification = platform === 'android'
    ? verifyAndroid(artifactPath, normalizeHex(process.env.SCENESHOP_ANDROID_SIGNING_CERT_SHA256))
    : verifyIos(artifactPath, String(process.env.SCENESHOP_APPLE_TEAM_ID || '').trim().toUpperCase());
  return {
    schemaVersion: 1,
    gate: `SceneShop ${packageVersion} ${platform} signature verification`,
    ok: true,
    platform,
    gitCommit,
    packageVersion,
    verifiedAt: new Date().toISOString(),
    artifact: { name: path.basename(artifactPath), bytes: fs.statSync(artifactPath).size, sha256: sha256File(artifactPath) },
    verification,
  };
}

function main() {
  const platform = String(arg('platform') || '').toLowerCase();
  const artifact = arg('artifact');
  const outArg = arg('out');
  if (!artifact) throw new Error('--artifact is required');
  const evidence = buildSignatureEvidence({ platform, artifact });
  const text = JSON.stringify(evidence, null, 2) + '\n';
  if (outArg) {
    const out = path.resolve(ROOT, outArg);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, text);
  }
  process.stdout.write(text);
}
if (require.main === module) {
  try { main(); } catch (error) { console.error(error.stack || error.message); process.exitCode = 2; }
}
module.exports = { normalizeHex, parseApkSignerDigest, parseCodeSignTeam, buildSignatureEvidence };
