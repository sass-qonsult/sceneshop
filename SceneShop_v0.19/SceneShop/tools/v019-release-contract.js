#!/usr/bin/env node
'use strict';
const fs=require('node:fs');
const path=require('node:path');
const { validateProductionRuntime }=require('../server/runtime-config');
const { inspectStaticCompatibility }=require('./v019-schema-compatibility');
function buildSyntheticProductionConfig(){return {IS_PRODUCTION:true,DEMO:false,TRUST_PROXY:true,DATA_BACKEND:'postgres',DATABASE_URL:'postgresql://user:pass@db.example:5432/sceneshop',SESSION_BACKEND:'redis',CACHE_BACKEND:'redis',REDIS_URL:'rediss://cache.example:6379',CACHE_PREFIX:'sceneshop'};}
async function buildReleaseContractReport({rootDir=path.join(__dirname,'..')}={}){
  const contract=JSON.parse(fs.readFileSync(path.join(rootDir,'docs/release/V0_19_RELEASE_CONTRACT_R0_1.json'),'utf8'));
  const pkg=JSON.parse(fs.readFileSync(path.join(rootDir,'package.json'),'utf8'));
  const nodeBridge=require(path.join(rootDir,'clients/native-bridge-contract.js'));
  const publicBridge=require(path.join(rootDir,'public/js/native-bridge-contract.js'));
  const schema=await inspectStaticCompatibility({rootDir});
  const compose=fs.readFileSync(path.join(rootDir,'compose.yaml'),'utf8');
  const postgresImage=(compose.match(/image:\s*postgres:([0-9.]+)-alpine/)||[])[1]||null;
  const redisImage=(compose.match(/image:\s*redis:([0-9.]+)-alpine/)||[])[1]||null;
  const env={PUBLIC_URL:'https://app.sceneshop.example',SESSION_SECRET:'rc-contract-validation-0123456789abcdef',OUTBOX_WEBHOOK_URL:'https://events.sceneshop.example/outbox',OUTBOX_WEBHOOK_SECRET:'rc-outbox-validation-0123456789abcdef'};
  const runtime=validateProductionRuntime(buildSyntheticProductionConfig(),env);
  const reasons=[];
  if(pkg.version!==contract.packageVersion) reasons.push(`package version mismatch: ${pkg.version}`);
  if(pkg.engines?.node!==contract.nodeEngine) reasons.push(`node engine mismatch: ${pkg.engines?.node||'missing'}`);
  for(const bridge of [nodeBridge,publicBridge]){
    if(bridge.MESSAGE_VERSION!==contract.nativeBridge.messageVersion) reasons.push(`native bridge message version mismatch: ${bridge.MESSAGE_VERSION}`);
    if(bridge.MAX_PAYLOAD_BYTES!==contract.nativeBridge.maxPayloadBytes) reasons.push(`native bridge max payload mismatch: ${bridge.MAX_PAYLOAD_BYTES}`);
  }
  if(!runtime.ok) reasons.push(`synthetic production runtime invalid: ${runtime.errors.join('; ')}`);
  if(!schema.ok) reasons.push(`schema contract invalid: ${schema.reasons.join('; ')}`);
  if(postgresImage!==contract.validatedInfrastructure.postgres) reasons.push(`PostgreSQL image mismatch: ${postgresImage||'missing'} != ${contract.validatedInfrastructure.postgres}`);
  if(redisImage!==contract.validatedInfrastructure.redis) reasons.push(`Redis image mismatch: ${redisImage||'missing'} != ${contract.validatedInfrastructure.redis}`);
  const requiredFiles=['public/app.html','public/desktop.html','public/mobile.html','apps/desktop/launcher.mjs','apps/mobile/android/app/build.gradle.kts','apps/mobile/ios/project.yml'];
  const missing=requiredFiles.filter(f=>!fs.existsSync(path.join(rootDir,f))); if(missing.length) reasons.push(`application surfaces missing: ${missing.join(', ')}`);
  const androidGradle=fs.readFileSync(path.join(rootDir,'apps/mobile/android/app/build.gradle.kts'),'utf8');
  const iosPlist=fs.readFileSync(path.join(rootDir,'apps/mobile/ios/SceneShopMobile/Info.plist'),'utf8');
  const desktopMac=fs.readFileSync(path.join(rootDir,'apps/desktop/install-macos.command'),'utf8');
  const androidVersion=(androidGradle.match(/versionName\s*=\s*"([^"]+)"/)||[])[1]||null;
  const coreVersion=pkg.version.replace(/-rc\.\d+$/,'');
  const iosVersion=(iosPlist.match(/CFBundleShortVersionString<\/key><string>([^<]+)/)||[])[1]||null;
  const desktopVersion=(desktopMac.match(/CFBundleShortVersionString<\/key><string>([^<]+)/)||[])[1]||null;
  if(androidVersion!==pkg.version) reasons.push(`Android version mismatch: ${androidVersion||'missing'} != ${pkg.version}`);
  if(iosVersion!==coreVersion) reasons.push(`iOS version mismatch: ${iosVersion||'missing'} != ${coreVersion}`);
  if(desktopVersion!==coreVersion) reasons.push(`Desktop macOS version mismatch: ${desktopVersion||'missing'} != ${coreVersion}`);
  return {schemaVersion:1,gate:'SceneShop v0.19 release contract',ok:reasons.length===0,reasons,packageVersion:pkg.version,contract,runtime:{ok:runtime.ok,warnings:runtime.warnings},schema:{ok:schema.ok,migrationSetSha256:schema.migrationSetSha256,rollback:schema.rollback},nativeBridge:{node:{version:nodeBridge.MESSAGE_VERSION,maxPayloadBytes:nodeBridge.MAX_PAYLOAD_BYTES},public:{version:publicBridge.MESSAGE_VERSION,maxPayloadBytes:publicBridge.MAX_PAYLOAD_BYTES}},infrastructure:{postgres:postgresImage,redis:redisImage},surfaces:{required:requiredFiles,missing},appVersions:{android:androidVersion,ios:iosVersion,desktopMac:desktopVersion}};
}
async function main(){const report=await buildReleaseContractReport();process.stdout.write(JSON.stringify(report,null,2)+'\n');if(!report.ok)process.exitCode=2;}
if(require.main===module)main().catch(e=>{console.error(e.stack||e.message);process.exitCode=1;});
module.exports={buildSyntheticProductionConfig,buildReleaseContractReport};
