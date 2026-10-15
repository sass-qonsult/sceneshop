#!/usr/bin/env node
const { execFileSync } = require('child_process');
const path = require('path');
const { buildReleaseManifest } = require('./v017-release-manifest');

const DEFAULT_BRANCH = 'release/v0.17';
const DEFAULT_TAG = 'v0.17.0-alpha.2';

function git(rootDir, args, { allowFailure = false } = {}) {
  try {
    return execFileSync('git', args, { cwd: rootDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch (error) {
    if (allowFailure) return null;
    const stderr = String(error.stderr || '').trim();
    throw new Error(stderr || error.message);
  }
}

function resolveRef(rootDir, ref) {
  return git(rootDir, ['rev-parse', '--verify', ref], { allowFailure: true });
}

function buildPromotionPlan({ rootDir, manifest, branch = DEFAULT_BRANCH, tag = DEFAULT_TAG } = {}) {
  const blockers = [...(manifest.blockers || [])];
  const head = manifest.gitCommit;
  const branchCommit = resolveRef(rootDir, `refs/heads/${branch}`);
  const tagCommit = resolveRef(rootDir, `refs/tags/${tag}^{}`);

  if (manifest.eligible !== true) blockers.push('release manifest is not eligible');
  if (branchCommit && branchCommit !== head) blockers.push(`${branch} already points to ${branchCommit}, expected ${head}`);
  if (tagCommit && tagCommit !== head) blockers.push(`${tag} already points to ${tagCommit}, expected ${head}`);

  return {
    schemaVersion: 1,
    release: 'SceneShop v0.17 alpha.2 promotion',
    gitCommit: head,
    candidateVersion: manifest.candidateVersion,
    branch,
    tag,
    branchState: branchCommit ? (branchCommit === head ? 'ALREADY_AT_HEAD' : 'CONFLICT') : 'CREATE',
    tagState: tagCommit ? (tagCommit === head ? 'ALREADY_AT_HEAD' : 'CONFLICT') : 'CREATE',
    eligible: blockers.length === 0,
    blockers,
  };
}

function applyPromotion(rootDir, plan) {
  if (!plan.eligible) throw new Error(`promotion blocked: ${plan.blockers.join('; ')}`);
  if (plan.branchState === 'CREATE') git(rootDir, ['branch', plan.branch, plan.gitCommit]);
  if (plan.tagState === 'CREATE') {
    git(rootDir, ['tag', '-a', plan.tag, plan.gitCommit, '-m', 'SceneShop v0.17.0-alpha.2 — Scale & Reliability']);
  }
  return {
    branchCommit: resolveRef(rootDir, `refs/heads/${plan.branch}`),
    tagCommit: resolveRef(rootDir, `refs/tags/${plan.tag}^{}`),
  };
}

async function main() {
  const rootDir = path.join(__dirname, '..');
  const apply = process.argv.includes('--apply');
  const branchArg = process.argv.find((arg) => arg.startsWith('--branch='));
  const tagArg = process.argv.find((arg) => arg.startsWith('--tag='));
  const branch = branchArg ? branchArg.slice('--branch='.length) : DEFAULT_BRANCH;
  const tag = tagArg ? tagArg.slice('--tag='.length) : DEFAULT_TAG;
  const manifest = await buildReleaseManifest({ rootDir });
  const plan = buildPromotionPlan({ rootDir, manifest, branch, tag });

  if (!apply) {
    process.stdout.write(JSON.stringify({ mode: 'dry-run', ...plan }, null, 2) + '\n');
    if (!plan.eligible) process.exitCode = 2;
    return;
  }

  if (!plan.eligible) {
    process.stdout.write(JSON.stringify({ mode: 'apply', ...plan }, null, 2) + '\n');
    process.exitCode = 2;
    return;
  }

  const applied = applyPromotion(rootDir, plan);
  const result = { mode: 'apply', ...plan, applied };
  if (applied.branchCommit !== plan.gitCommit || applied.tagCommit !== plan.gitCommit) {
    result.eligible = false;
    result.blockers = [...result.blockers, 'post-promotion ref verification failed'];
    process.exitCode = 3;
  }
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}

if (require.main === module) main().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
module.exports = { DEFAULT_BRANCH, DEFAULT_TAG, resolveRef, buildPromotionPlan, applyPromotion };
