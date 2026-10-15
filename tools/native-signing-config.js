#!/usr/bin/env node
'use strict';
const fs=require('node:fs');const path=require('node:path');const cp=require('node:child_process');
const ROOT=path.join(__dirname,'..');
const strict=process.argv.includes('--strict');
const outArg=process.argv.find(x=>x.startsWith('--out='));
const OUT=path.resolve(ROOT,outArg?outArg.slice(6):'artifacts/native-signing');
const env=process.env;
const team=String(env.SCENESHOP_APPLE_TEAM_ID||'').trim().toUpperCase();
const rawFp=String(env.SCENESHOP_ANDROID_SIGNING_CERT_SHA256||'').replace(/[^A-Fa-f0-9]/g,'').toUpperCase();
const fpValid=/^[A-F0-9]{64}$/.test(rawFp);const fingerprint=fpValid?rawFp.match(/../g).join(':'):'';
const teamValid=/^[A-Z0-9]{10}$/.test(team);
const aps=String(env.SCENESHOP_APS_ENVIRONMENT||'production').toLowerCase();
const apsValid=['development','production'].includes(aps);
const androidSecrets={
  keystore:Boolean(env.SCENESHOP_ANDROID_KEYSTORE_FILE||env.SCENESHOP_ANDROID_KEYSTORE_BASE64),
  storePassword:Boolean(env.SCENESHOP_ANDROID_KEYSTORE_PASSWORD),
  alias:Boolean(env.SCENESHOP_ANDROID_KEY_ALIAS),
  keyPassword:Boolean(env.SCENESHOP_ANDROID_KEY_PASSWORD),
};
const androidSigningReady=fpValid&&Object.values(androidSecrets).every(Boolean);
const iosSigningReady=teamValid&&apsValid;
fs.rmSync(OUT,{recursive:true,force:true});fs.mkdirSync(path.join(OUT,'public','.well-known'),{recursive:true});fs.mkdirSync(path.join(OUT,'ios'),{recursive:true});
const aasa={applinks:{details:[{appIDs:[`${teamValid?team:'TEAMID'}.io.sceneshop.mobile`],components:[{'/':'/s/*',comment:'SceneShop session links'}]}]}};
const assetlinks=[{relation:['delegate_permission/common.handle_all_urls'],target:{namespace:'android_app',package_name:'io.sceneshop.mobile',sha256_cert_fingerprints:[fpValid?fingerprint:'REPLACE_WITH_PRODUCTION_SIGNING_CERT_SHA256']}}];
fs.writeFileSync(path.join(OUT,'public','.well-known','apple-app-site-association'),JSON.stringify(aasa,null,2)+'\n');
fs.writeFileSync(path.join(OUT,'public','.well-known','assetlinks.json'),JSON.stringify(assetlinks,null,2)+'\n');
const entitlements=`<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict>\n<key>com.apple.developer.associated-domains</key><array><string>applinks:app.sceneshop.io</string></array>\n<key>aps-environment</key><string>${apsValid?aps:'production'}</string>\n</dict></plist>\n`;
fs.writeFileSync(path.join(OUT,'ios','SceneShopMobile.production.entitlements'),entitlements);
const gitCommit=cp.execFileSync('git',['rev-parse','HEAD'],{cwd:ROOT,encoding:'utf8'}).trim();
const report={version:require(path.join(ROOT,'package.json')).version,gitCommit,apple:{teamConfigured:teamValid,apsEnvironment:apsValid?aps:null,signingReady:iosSigningReady},android:{fingerprintConfigured:fpValid,signingSecrets:androidSecrets,signingReady:androidSigningReady},outputs:{aasa:'public/.well-known/apple-app-site-association',assetlinks:'public/.well-known/assetlinks.json',iosEntitlements:'ios/SceneShopMobile.production.entitlements'},ready:androidSigningReady&&iosSigningReady};
fs.writeFileSync(path.join(OUT,'report.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
if(strict&&!report.ready)process.exit(2);
