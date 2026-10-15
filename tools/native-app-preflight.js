#!/usr/bin/env node
'use strict';
const fs=require('node:fs');const path=require('node:path');const cp=require('node:child_process');
const ROOT=path.join(__dirname,'..');const strict=process.argv.includes('--strict');const env=process.env;
const required=[
  'apps/desktop/launcher.mjs','apps/desktop/install-linux.sh','apps/desktop/install-windows.ps1','apps/desktop/install-macos.command',
  'apps/mobile/android/settings.gradle.kts','apps/mobile/android/app/build.gradle.kts','apps/mobile/android/app/src/main/AndroidManifest.xml','apps/mobile/android/app/src/main/java/io/sceneshop/mobile/MainActivity.kt',
  'apps/mobile/ios/project.yml','apps/mobile/ios/SceneShopMobile/SceneShopWebViewController.swift','apps/mobile/ios/SceneShopMobile/SceneShopSecureStore.swift','apps/mobile/ios/SceneShopShareExtension/ShareViewController.swift',
  'public/.well-known/apple-app-site-association','public/.well-known/assetlinks.json','tools/native-signing-config.js','tools/app-qa-matrix.js','docs/ux/PRODUCTION_BETA_APP_QA_MATRIX_R0_1.json',
  '.github/workflows/v0.18-android-build.yml','.github/workflows/v0.18-ios-build.yml'
];
const exists=(f)=>fs.existsSync(path.join(ROOT,f));
const command=(name)=>{try{cp.execFileSync('bash',['-lc',`command -v ${name}`],{stdio:'ignore'});return true;}catch{return false;}};
const read=(f)=>exists(f)?fs.readFileSync(path.join(ROOT,f),'utf8'):'';
const aasa=read('public/.well-known/apple-app-site-association');const assetlinks=read('public/.well-known/assetlinks.json');
let desktopSmoke={ok:false,error:null};try{const out=cp.execFileSync(process.execPath,['apps/desktop/launcher.mjs','--dry-run','--base=http://127.0.0.1:3000'],{cwd:ROOT,encoding:'utf8'});desktopSmoke={ok:JSON.parse(out).url.includes('/desktop'),error:null};}catch(e){desktopSmoke={ok:false,error:String(e.message||e)};}
const team=String(env.SCENESHOP_APPLE_TEAM_ID||'').trim().toUpperCase();const fp=String(env.SCENESHOP_ANDROID_SIGNING_CERT_SHA256||'').replace(/[^A-Fa-f0-9]/g,'').toUpperCase();
const androidSigningSecrets={keystore:Boolean(env.SCENESHOP_ANDROID_KEYSTORE_FILE||env.SCENESHOP_ANDROID_KEYSTORE_BASE64),storePassword:Boolean(env.SCENESHOP_ANDROID_KEYSTORE_PASSWORD),alias:Boolean(env.SCENESHOP_ANDROID_KEY_ALIAS),keyPassword:Boolean(env.SCENESHOP_ANDROID_KEY_PASSWORD)};
const report={
  version:require(path.join(ROOT,'package.json')).version,
  structure:{ok:required.every(exists),missing:required.filter(f=>!exists(f))},
  contracts:{lifecycle:read('public/js/app-shell.js').includes('sceneshop:app-lifecycle'),shareReceive:read('apps/mobile/android/app/src/main/java/io/sceneshop/mobile/MainActivity.kt').includes('SHARE_RECEIVED')&&read('apps/mobile/ios/SceneShopShareExtension/ShareViewController.swift').includes('sceneshop'),notificationRegister:read('clients/native-bridge-contract.js').includes('NOTIFICATION_REGISTER')},
  desktop:{runtimeDetected:desktopSmoke.ok,smoke:desktopSmoke},
  android:{toolchain:command('gradle')||Boolean(env.ANDROID_HOME||env.ANDROID_SDK_ROOT),signingFingerprintConfigured:/^[A-F0-9]{64}$/.test(fp),signingSecrets:androidSigningSecrets,sourceAssociationPlaceholder:assetlinks.includes('REPLACE_WITH_PRODUCTION_SIGNING_CERT_SHA256')},
  ios:{toolchain:command('xcodebuild'),teamConfigured:/^[A-Z0-9]{10}$/.test(team),sourceAssociationPlaceholder:aasa.includes('TEAMID.'),shareExtension:exists('apps/mobile/ios/SceneShopShareExtension/ShareViewController.swift')},
  workflows:{android:exists('.github/workflows/v0.18-android-build.yml'),ios:exists('.github/workflows/v0.18-ios-build.yml')}
};
report.android.productionSigningConfigured=report.android.signingFingerprintConfigured&&Object.values(androidSigningSecrets).every(Boolean);
report.ios.productionSigningConfigured=report.ios.teamConfigured;
report.developmentReady=report.structure.ok&&Object.values(report.contracts).every(Boolean)&&report.desktop.runtimeDetected&&report.workflows.android&&report.workflows.ios;
report.productionReady=report.developmentReady&&report.android.toolchain&&report.android.productionSigningConfigured&&report.ios.toolchain&&report.ios.productionSigningConfigured;
report.blockers=[];
if(!report.structure.ok)report.blockers.push(`missing native app files: ${report.structure.missing.join(', ')}`);
if(!Object.values(report.contracts).every(Boolean))report.blockers.push('native lifecycle/share/notification contract incomplete');
if(!report.desktop.runtimeDetected)report.blockers.push('desktop runtime smoke unavailable');
if(!report.android.toolchain)report.blockers.push('Android SDK/Gradle toolchain unavailable');
if(!report.android.productionSigningConfigured)report.blockers.push('Android production signing environment incomplete');
if(!report.ios.toolchain)report.blockers.push('macOS/Xcode toolchain unavailable');
if(!report.ios.productionSigningConfigured)report.blockers.push('iOS Apple Team ID/signing environment incomplete');
console.log(JSON.stringify(report,null,2));
if(strict&&!report.productionReady)process.exit(2);if(!report.developmentReady)process.exit(1);
