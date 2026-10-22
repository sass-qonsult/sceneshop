'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const cp=require('node:child_process');
const {validateProductionRuntime}=require('../server/runtime-config');
const {buildSyntheticProductionConfig,buildReleaseContractReport}=require('../tools/v019-release-contract');
const {inspectStaticCompatibility}=require('../tools/v019-schema-compatibility');
const {buildPromotionPlan}=require('../tools/v019-promote');
const ROOT=path.join(__dirname,'..');
const pkg=require('../package.json');
const commit=cp.execFileSync('git',['rev-parse','HEAD'],{cwd:ROOT,encoding:'utf8'}).trim();

test('v0.19 package is the canonical rc.1 version',()=>{assert.equal(pkg.version,'0.19.0-rc.1');assert.equal(pkg.engines.node,'>=20');});

test('production runtime contract accepts hardened PostgreSQL/Redis configuration',()=>{
 const env={PUBLIC_URL:'https://app.sceneshop.example',SESSION_SECRET:'strong-session-secret-0123456789abcdef',OUTBOX_WEBHOOK_URL:'https://events.sceneshop.example/outbox',OUTBOX_WEBHOOK_SECRET:'strong-outbox-secret-0123456789'};
 const r=validateProductionRuntime(buildSyntheticProductionConfig(),env);assert.equal(r.ok,true);assert.deepEqual(r.errors,[]);
});

test('production runtime contract rejects placeholders and unsafe protocols',()=>{
 const cfg=buildSyntheticProductionConfig();cfg.DATABASE_URL='http://db.example/sceneshop';cfg.REDIS_URL='http://cache.example';
 const r=validateProductionRuntime(cfg,{PUBLIC_URL:'http://app.example',SESSION_SECRET:'replace-with-secret'});assert.equal(r.ok,false);assert.match(r.errors.join(' '),/SESSION_SECRET/);assert.match(r.errors.join(' '),/PUBLIC_URL/);assert.match(r.errors.join(' '),/DATABASE_URL/);assert.match(r.errors.join(' '),/REDIS_URL/);
});

test('v0.19 release contract pins schema bridge and surfaces',async()=>{const r=await buildReleaseContractReport({rootDir:ROOT});assert.equal(r.ok,true,r.reasons.join('; '));assert.equal(r.contract.database.migrationCount,27);assert.equal(r.contract.database.latestMigration,'0027_cache_coordination_recovery.sql');assert.equal(r.nativeBridge.node.version,1);assert.equal(r.nativeBridge.public.version,1);assert.deepEqual(r.surfaces.missing,[]);});

test('v0.19 schema is unchanged from v0.18 beta.1 and rollback-compatible',async()=>{const r=await inspectStaticCompatibility({rootDir:ROOT});assert.equal(r.ok,true,r.reasons.join('; '));assert.equal(r.rollback.compatible,true);assert.equal(r.rollback.migrationDiff,'');assert.equal(r.manifest.count,27);});


test('v0.19 native and desktop package metadata is aligned with the rc',()=>{
  const android=fs.readFileSync(path.join(ROOT,'apps/mobile/android/app/build.gradle.kts'),'utf8');
  const ios=fs.readFileSync(path.join(ROOT,'apps/mobile/ios/SceneShopMobile/Info.plist'),'utf8');
  const desktop=fs.readFileSync(path.join(ROOT,'apps/desktop/install-macos.command'),'utf8');
  assert.match(android,/versionCode = 7/); assert.match(android,/versionName = "0\.19\.0-rc\.1"/);
  assert.match(ios,/CFBundleShortVersionString<\/key><string>0\.19\.0<\/string>/);
  assert.match(desktop,/CFBundleShortVersionString<\/key><string>0\.19\.0<\/string>/);
});

test('v0.19 operational endpoints expose one release contract view',()=>{
  const src=fs.readFileSync(path.join(ROOT,'server/index.js'),'utf8');
  assert.match(src,/releaseRuntime/);
  assert.match(src,/rollbackCompatibleFrom/);
  assert.ok((src.match(/release: releaseRuntime/g)||[]).length>=3);
});

test('v0.19 promotion is fail-closed and reserves canonical release refs',()=>{const manifest={gitCommit:commit,candidateVersion:pkg.version,eligible:false,blockers:['foundation evidence missing']};const p=buildPromotionPlan({rootDir:ROOT,manifest,branch:'release/v0.19-test-never-create',tag:'v0.19.0-rc.1-test-never-create'});assert.equal(p.eligible,false);assert.match(p.blockers.join(' '),/foundation evidence missing/);assert.match(p.blockers.join(' '),/manifest is not eligible/);});

test('live smoke asserts v0.19 release metadata',()=>{const src=fs.readFileSync(path.join(ROOT,'tools/live-data-plane-validation.js'),'utf8');assert.match(src,/release\?\.channel!=='rc'/);assert.match(src,/0027_cache_coordination_recovery\.sql/);assert.match(src,/nativeBridgeVersion!==1/);});

test('foundation gate invokes isolated v0.19 schema compatibility when available',()=>{const src=fs.readFileSync(path.join(ROOT,'tools/run-foundation-gate.sh'),'utf8');assert.match(src,/rc:schema:live/);assert.match(src,/RC_DATABASE_URL/);});

test('v0.19 package exposes contract schema manifest verify and promotion commands',()=>{const s=pkg.scripts;for(const key of ['rc:contract','rc:schema','rc:schema:live','rc:manifest','rc:verify','rc:promote:dry','rc:promote'])assert.equal(typeof s[key],'string');assert.match(s['rc:verify'],/--require-eligible/);assert.match(s['rc:promote'],/--apply/);});

test('v0.19 rc workflow aggregates live backend and all application platforms',()=>{const w=fs.readFileSync(path.join(ROOT,'.github/workflows/v0.19-rc-gate.yml'),'utf8');for(const token of ['repository:','live-infrastructure:','desktop-build:','android-build:','ios-build:','npm run rc:manifest'])assert.match(w,new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));});


test('v0.19 exposes portable same-commit evidence import commands',()=>{const scripts=pkg.scripts;assert.match(scripts['rc:evidence:import:dry'],/v019-evidence-import/);assert.match(scripts['rc:evidence:import'],/--apply/);assert.match(scripts['rc:evidence:import'],/--require-complete/);});

test('v0.19 portable evidence importer validates every promotion evidence class before copy',()=>{const src=fs.readFileSync(path.join(ROOT,'tools/v019-evidence-import.js'),'utf8');for(const token of ['foundation-evidence-','recovery-evidence-','schema-compatibility.json','signedBuildFiles','native-signing','app-qa/executions','gitCommit','packageVersion'])assert.match(src,new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));});

test('v0.19 external evidence staging stays outside the source worktree',()=>{
  const ignore=fs.readFileSync(path.join(ROOT,'.gitignore'),'utf8');
  assert.match(ignore,/artifacts\/external-evidence\//);
  assert.match(ignore,/artifacts\/rcprep\*\//);
});

test('v0.19 gate messages use the current package version rather than historical v0.17 labels',()=>{
  const foundation=fs.readFileSync(path.join(ROOT,'tools/run-foundation-gate.sh'),'utf8');
  const recovery=fs.readFileSync(path.join(ROOT,'tools/run-recovery-gate.sh'),'utf8');
  assert.match(foundation,/SceneShop \$\{PACKAGE_VERSION\} foundation gate: PASS/);
  assert.match(recovery,/SceneShop \$\{PACKAGE_VERSION\} recovery gate: PASS/);
  assert.doesNotMatch(foundation,/v0\.17 foundation gate: PASS/);
  assert.doesNotMatch(recovery,/v0\.17 alpha\.2 recovery gate: PASS/);
});

test('v0.19 documents portable Linux Android iOS QA evidence aggregation',()=>{
  const doc=fs.readFileSync(path.join(ROOT,'docs/release/V0_19_EXTERNAL_RUNNER_KIT_R0_1.md'),'utf8');
  for(const token of ['Linux / infrastructure runner','Android runner','macOS / iOS runner','Web/Desktop QA','rc:evidence:import','rc:verify','rc:promote']) assert.match(doc,new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
});

test('v0.19 signed-build gate requires cryptographic signature verification',()=>{
  const {validateBuildEvidence}=require('../tools/v018-production-beta-manifest');
  const base={ok:true,gate:`SceneShop ${pkg.version} android build`,platform:'android',signed:true,signatureVerified:false,gitCommit:commit,packageVersion:pkg.version,artifact:{sha256:'a'.repeat(64),bytes:1}};
  const invalid=validateBuildEvidence(base,{platform:'android',gitCommit:commit,packageVersion:pkg.version,requireSigned:true});
  assert.equal(invalid.ok,false);assert.match(invalid.reasons.join(' '),/cryptographic signature verification/);
  const valid=validateBuildEvidence({...base,signatureVerified:true},{platform:'android',gitCommit:commit,packageVersion:pkg.version,requireSigned:true});
  assert.equal(valid.ok,true,valid.reasons.join('; '));
});

test('v0.19 exposes one-command fail-closed finalization and evidence export',()=>{
  const scripts=pkg.scripts;
  assert.match(scripts['rc:evidence:export'],/v019-evidence-export/);
  assert.match(scripts['rc:finalize:dry'],/v019-finalize/);
  assert.match(scripts['rc:finalize'],/v019-finalize/);
  assert.match(scripts['rc:finalize'],/--apply/);
});

test('v0.19 finalizer never promotes an incomplete external evidence set',()=>{
  const {buildFinalizationPlan}=require('../tools/v019-finalize');
  const plan=buildFinalizationPlan({importReport:{complete:false,blockers:['android build','ios build']}});
  assert.equal(plan.eligible,false);
  assert.deepEqual(plan.blockers,['android build','ios build']);
});

test('v0.19 evidence exporter is same-commit indexed and runner staging is ignored',()=>{
  const src=fs.readFileSync(path.join(ROOT,'tools/v019-evidence-export.js'),'utf8');
  const ignore=fs.readFileSync(path.join(ROOT,'.gitignore'),'utf8');
  assert.match(src,/gitCommit/);
  assert.match(src,/packageVersion/);
  assert.match(src,/sha256/);
  assert.match(src,/evidence-index\.json/);
  assert.match(ignore,/artifacts\/runner-export\//);
});
