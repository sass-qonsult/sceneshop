#!/usr/bin/env node
'use strict';
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { buildProductionBetaManifest } = require('./v018-production-beta-manifest');

const DEFAULT_BRANCH = 'release/v0.18';
const DEFAULT_TAG = 'v0.18.0-beta.1';
function git(rootDir, args, { allowFailure = false } = {}) {
  try { return execFileSync('git', args, { cwd: rootDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(); }
  catch (error) { if (allowFailure) return null; throw new Error(String(error.stderr || error.message).trim()); }
}
function resolveRef(rootDir, ref) { return git(rootDir, ['rev-parse', '--verify', ref], { allowFailure: true }); }
function buildPromotionPlan({ rootDir, manifest, branch = DEFAULT_BRANCH, tag = DEFAULT_TAG } = {}) {
  const blockers = [...(manifest.candidateBlockers || [])];
  const head = manifest.gitCommit;
  if (manifest.betaCandidateEligible !== true) blockers.push('Production Beta candidate manifest is not eligible');
  if (manifest.candidateVersion !== '0.18.0-beta.1') blockers.push(`package version must be 0.18.0-beta.1 before promotion, found ${manifest.candidateVersion}`);
  const branchCommit = resolveRef(rootDir, `refs/heads/${branch}`);
  const tagCommit = resolveRef(rootDir, `refs/tags/${tag}^{}`);
  if (branchCommit && branchCommit !== head) blockers.push(`${branch} already points to ${branchCommit}, expected ${head}`);
  if (tagCommit && tagCommit !== head) blockers.push(`${tag} already points to ${tagCommit}, expected ${head}`);
  return {
    schemaVersion: 1,
    release: 'SceneShop v0.18 Production Beta promotion',
    gitCommit: head,
    candidateVersion: manifest.candidateVersion,
    branch,
    tag,
    branchState: branchCommit ? (branchCommit === head ? 'ALREADY_AT_HEAD' : 'CONFLICT') : 'CREATE',
    tagState: tagCommit ? (tagCommit === head ? 'ALREADY_AT_HEAD' : 'CONFLICT') : 'CREATE',
    productionDistributionReady: manifest.productionDistributionReady,
    eligible: blockers.length === 0,
    blockers,
  };
}
function applyPromotion(rootDir, plan) {
  if (!plan.eligible) throw new Error(`promotion blocked: ${plan.blockers.join('; ')}`);
  if (plan.branchState === 'CREATE') git(rootDir, ['branch', plan.branch, plan.gitCommit]);
  if (plan.tagState === 'CREATE') git(rootDir, ['tag', '-a', plan.tag, plan.gitCommit, '-m', 'SceneShop v0.18.0-beta.1 — Production Beta']);
  return { branchCommit: resolveRef(rootDir, `refs/heads/${plan.branch}`), tagCommit: resolveRef(rootDir, `refs/tags/${plan.tag}^{}`) };
}
async function main() {
  const rootDir = path.join(__dirname, '..');
  const apply = process.argv.includes('--apply');
  const manifest = await buildProductionBetaManifest({ rootDir });
  const plan = buildPromotionPlan({ rootDir, manifest });
  if (!apply || !plan.eligible) {
    process.stdout.write(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', ...plan }, null, 2) + '\n');
    if (!plan.eligible) process.exitCode = 2;
    return;
  }
  const applied = applyPromotion(rootDir, plan);
  const result = { mode: 'apply', ...plan, applied };
  if (applied.branchCommit !== plan.gitCommit || applied.tagCommit !== plan.gitCommit) {
    result.eligible = false; result.blockers = [...result.blockers, 'post-promotion ref verification failed']; process.exitCode = 3;
  }
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}
if (require.main === module) main().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
module.exports = { DEFAULT_BRANCH, DEFAULT_TAG, resolveRef, buildPromotionPlan, applyPromotion };
