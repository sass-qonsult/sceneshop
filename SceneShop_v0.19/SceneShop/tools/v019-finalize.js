#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const { buildRcManifest } = require('./v019-rc-manifest');
const { buildPromotionPlan, applyPromotion } = require('./v019-promote');

const ROOT = path.join(__dirname, '..');

function arg(name) {
  const prefix = `--${name}=`;
  const hit = process.argv.find((value) => value.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : null;
}

function runJson(command, args, { cwd = ROOT } = {}) {
  const result = cp.spawnSync(command, args, { cwd, encoding: 'utf8' });
  let payload = null;
  try { payload = JSON.parse(result.stdout || '{}'); } catch (error) {
    const detail = (result.stderr || result.stdout || error.message || '').trim();
    throw new Error(`unable to parse ${command} output as JSON${detail ? `: ${detail}` : ''}`);
  }
  return { status: result.status ?? 1, payload, stderr: (result.stderr || '').trim() };
}

function buildFinalizationPlan({ importReport, manifest, promotionPlan }) {
  const blockers = [];
  if (!importReport?.complete) blockers.push(...(importReport?.blockers || ['external evidence incomplete']));
  if (manifest && manifest.eligible !== true) blockers.push(...(manifest.blockers || ['RC manifest is not eligible']));
  if (promotionPlan && promotionPlan.eligible !== true) blockers.push(...(promotionPlan.blockers || ['RC promotion plan is not eligible']));
  return {
    schemaVersion: 1,
    release: 'SceneShop v0.19 RC finalization',
    evidenceComplete: importReport?.complete === true,
    manifestEligible: manifest ? manifest.eligible === true : null,
    promotionEligible: promotionPlan ? promotionPlan.eligible === true : null,
    eligible: blockers.length === 0,
    blockers: [...new Set(blockers)],
  };
}

async function main() {
  const apply = process.argv.includes('--apply');
  const source = arg('source') || 'artifacts/external-evidence';
  const receiptArg = arg('receipt') || 'artifacts/rc-gate/v0.19-finalization.json';
  const sourceAbs = path.resolve(ROOT, source);
  const receipt = path.resolve(ROOT, receiptArg);

  if (!fs.existsSync(sourceAbs) || !fs.statSync(sourceAbs).isDirectory()) {
    throw new Error(`external evidence directory not found: ${sourceAbs}`);
  }

  const dryImport = runJson(process.execPath, ['tools/v019-evidence-import.js', `--source=${path.relative(ROOT, sourceAbs) || '.'}`]);
  if (dryImport.status !== 0 && dryImport.status !== 2) throw new Error(dryImport.stderr || 'external evidence dry-run failed');

  if (!apply) {
    const report = {
      ...buildFinalizationPlan({ importReport: dryImport.payload }),
      mode: 'dry-run',
      gitCommit: dryImport.payload.gitCommit,
      packageVersion: dryImport.payload.packageVersion,
      source: sourceAbs,
      import: dryImport.payload,
      nextAction: dryImport.payload.complete
        ? 'Run the same command with --apply to import, verify and promote atomically.'
        : 'Complete the missing external evidence set and retry.',
    };
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
    if (!report.evidenceComplete) process.exitCode = 2;
    return;
  }

  const appliedImport = runJson(process.execPath, [
    'tools/v019-evidence-import.js',
    `--source=${path.relative(ROOT, sourceAbs) || '.'}`,
    '--apply',
    '--require-complete',
  ]);
  if (appliedImport.status !== 0 || appliedImport.payload.complete !== true) {
    const report = {
      ...buildFinalizationPlan({ importReport: appliedImport.payload }),
      mode: 'apply',
      phase: 'evidence-import',
      source: sourceAbs,
      import: appliedImport.payload,
    };
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
    process.exitCode = 2;
    return;
  }

  const manifest = await buildRcManifest({ rootDir: ROOT });
  const promotionPlan = buildPromotionPlan({ rootDir: ROOT, manifest });
  const preApply = buildFinalizationPlan({ importReport: appliedImport.payload, manifest, promotionPlan });
  if (!preApply.eligible) {
    const report = {
      ...preApply,
      mode: 'apply',
      phase: 'verify',
      gitCommit: manifest.gitCommit,
      packageVersion: manifest.candidateVersion,
      import: appliedImport.payload,
      manifest,
      promotionPlan,
    };
    fs.mkdirSync(path.dirname(receipt), { recursive: true });
    fs.writeFileSync(receipt, JSON.stringify(report, null, 2) + '\n');
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
    process.exitCode = 3;
    return;
  }

  const promoted = applyPromotion(ROOT, promotionPlan);
  const finalManifest = await buildRcManifest({ rootDir: ROOT });
  const finalPlan = buildPromotionPlan({ rootDir: ROOT, manifest: finalManifest });
  const refsOk = promoted.branchCommit === finalManifest.gitCommit
    && promoted.tagCommit === finalManifest.gitCommit
    && finalPlan.branchState === 'ALREADY_AT_HEAD'
    && finalPlan.tagState === 'ALREADY_AT_HEAD';

  const report = {
    schemaVersion: 1,
    release: 'SceneShop v0.19 RC finalization',
    mode: 'apply',
    phase: 'complete',
    gitCommit: finalManifest.gitCommit,
    packageVersion: finalManifest.candidateVersion,
    eligible: finalManifest.eligible === true && refsOk,
    blockers: refsOk ? [] : ['post-promotion ref verification failed'],
    importedEvidence: appliedImport.payload.copied || [],
    manifest: finalManifest,
    promotion: { ...finalPlan, applied: promoted },
    finalizedAt: new Date().toISOString(),
  };
  fs.mkdirSync(path.dirname(receipt), { recursive: true });
  fs.writeFileSync(receipt, JSON.stringify(report, null, 2) + '\n');
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  if (!report.eligible) process.exitCode = 4;
}

if (require.main === module) main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});

module.exports = { buildFinalizationPlan, runJson };
