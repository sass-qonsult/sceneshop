#!/usr/bin/env node
'use strict';
const fs=require('node:fs');const path=require('node:path');
const ROOT=path.join(__dirname,'..');const matrix=require(path.join(ROOT,'docs/ux/PRODUCTION_BETA_APP_QA_MATRIX_R0_1.json'));
const requiredIds=['web-chromium','web-firefox','web-webkit','desktop-linux','desktop-windows','desktop-macos','android-min','android-notification-boundary','android-target','ios-min','ios-current-simulator','ios-current-device'];
const rows=new Map(matrix.matrix.map(x=>[x.id,x]));const missing=requiredIds.filter(id=>!rows.has(id));
const invalid=matrix.matrix.filter(x=>!['WEB','DESKTOP','MOBILE'].includes(x.surface)||!Array.isArray(x.required)||!x.required.length).map(x=>x.id);
const report={version:require(path.join(ROOT,'package.json')).version,rows:matrix.matrix.length,requiredRows:requiredIds.length,missing,invalid,ok:missing.length===0&&invalid.length===0,executionPolicy:'STATIC_MATRIX_VALIDATION_ONLY_DEVICE_ROWS_REQUIRE_PLATFORM_EXECUTION'};
console.log(JSON.stringify(report,null,2));if(!report.ok)process.exit(1);
