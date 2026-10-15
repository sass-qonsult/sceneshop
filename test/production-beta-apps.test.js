'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const cp=require('node:child_process');
const ROOT=path.join(__dirname,'..');const read=(p)=>fs.readFileSync(path.join(ROOT,p),'utf8');const contract=require('../clients/native-bridge-contract');
test('bridge adds governed notification registration without generic execution',()=>{assert.equal(contract.validType('NOTIFICATION_REGISTER'),true);assert.equal(contract.validType('EVAL_JS'),false);});
test('web shell emits lifecycle and accepts governed native events',()=>{const s=read('public/js/app-shell.js');assert.match(s,/SceneShopNativeEvent/);assert.match(s,/sceneshop:app-lifecycle/);assert.match(s,/visibilitychange/);assert.match(s,/window\.addEventListener\('online'/);});
test('mobile companion persists background state and revalidates on resume',()=>{const s=read('public/js/mobile.js');assert.match(s,/refreshAfterResume/);assert.match(s,/persistCore\(\)/);assert.match(s,/state\.socket\.connect\(\)/);assert.match(s,/state\.foreground && state\.playing/);});
test('notification permission is user initiated from mobile UI',()=>{assert.match(read('public/mobile.html'),/enableNotifications/);const s=read('public/js/mobile.js');assert.match(s,/NOTIFICATION_PERMISSION/);assert.match(s,/NOTIFICATION_REGISTER/);});
test('android receives shares, reports lifecycle and requests notification permission',()=>{const m=read('apps/mobile/android/app/src/main/AndroidManifest.xml');const a=read('apps/mobile/android/app/src/main/java/io/sceneshop/mobile/MainActivity.kt');assert.match(m,/POST_NOTIFICATIONS/);assert.match(m,/android.intent.action.SEND/);assert.match(a,/SHARE_RECEIVED/);assert.match(a,/APP_LIFECYCLE/);assert.match(a,/requestPermissions/);});
test('ios includes share extension, lifecycle and APNS registration seam',()=>{const p=read('apps/mobile/ios/project.yml');const a=read('apps/mobile/ios/SceneShopMobile/AppDelegate.swift');const w=read('apps/mobile/ios/SceneShopMobile/SceneShopWebViewController.swift');const x=read('apps/mobile/ios/SceneShopShareExtension/ShareViewController.swift');assert.match(p,/SceneShopShareExtension/);assert.match(a,/didRegisterForRemoteNotificationsWithDeviceToken/);assert.match(a,/applicationDidEnterBackground/);assert.match(w,/requestAuthorization/);assert.match(x,/sceneshop/);});
test('platform build workflows compile on their native runners',()=>{const android=read('.github/workflows/v0.18-android-build.yml');const ios=read('.github/workflows/v0.18-ios-build.yml');assert.match(android,/runs-on: ubuntu-latest/);assert.match(android,/assembleDebug/);assert.match(ios,/runs-on: macos-15/);assert.match(ios,/xcodebuild/);});
test('production signing materialization never prints secret values',()=>{const out=cp.execFileSync(process.execPath,['tools/native-signing-config.js'],{cwd:ROOT,encoding:'utf8',env:{...process.env,SCENESHOP_APPLE_TEAM_ID:'ABCDEFGHIJ',SCENESHOP_ANDROID_SIGNING_CERT_SHA256:'AA'.repeat(32),SCENESHOP_ANDROID_KEYSTORE_BASE64:'SECRET-KEYSTORE-BYTES',SCENESHOP_ANDROID_KEYSTORE_PASSWORD:'SECRET_STORE',SCENESHOP_ANDROID_KEY_ALIAS:'release',SCENESHOP_ANDROID_KEY_PASSWORD:'SECRET_KEY'}});assert.doesNotMatch(out,/SECRET_STORE|SECRET_KEY|SECRET-KEYSTORE-BYTES/);const report=JSON.parse(out);assert.equal(report.ready,true);});
test('production beta QA matrix covers web desktop android and ios runtime boundaries',()=>{const report=JSON.parse(cp.execFileSync(process.execPath,['tools/app-qa-matrix.js'],{cwd:ROOT,encoding:'utf8'}));assert.equal(report.ok,true);assert.equal(report.rows,12);});
test('native build evidence binds artifact hash to current commit and package version',()=>{const tmp=path.join(ROOT,'artifacts','native-build-test.bin');fs.mkdirSync(path.dirname(tmp),{recursive:true});fs.writeFileSync(tmp,'SceneShop build evidence');try{const out=cp.execFileSync(process.execPath,['tools/native-build-evidence.js','--platform=desktop','--artifact=artifacts/native-build-test.bin'],{cwd:ROOT,encoding:'utf8'});const evidence=JSON.parse(out);assert.equal(evidence.ok,true);assert.equal(evidence.platform,'desktop');assert.equal(evidence.packageVersion,require('../package.json').version);assert.match(evidence.artifact.sha256,/^[a-f0-9]{64}$/);}finally{fs.rmSync(tmp,{force:true});}});

test('signed native build evidence requires cryptographic signature proof',()=>{
  const tmp=path.join(ROOT,'artifacts','native-build-signed-test.bin');fs.mkdirSync(path.dirname(tmp),{recursive:true});fs.writeFileSync(tmp,'fake signed artifact');
  try {
    const run=cp.spawnSync(process.execPath,['tools/native-build-evidence.js','--platform=android','--artifact=artifacts/native-build-signed-test.bin','--signed'],{cwd:ROOT,encoding:'utf8'});
    assert.notEqual(run.status,0);
    assert.match(`${run.stderr}${run.stdout}`,/signature-evidence/);
  } finally { fs.rmSync(tmp,{force:true}); }
});

test('signature verifier parses Android certificate digest and Apple TeamIdentifier',()=>{
  const {parseApkSignerDigest,parseCodeSignTeam}=require('../tools/native-signature-verify');
  assert.equal(parseApkSignerDigest('Signer #1 certificate SHA-256 digest: AA:bb:01'),'AABB01');
  assert.equal(parseCodeSignTeam('TeamIdentifier=ABCDE12345\n'),'ABCDE12345');
});
