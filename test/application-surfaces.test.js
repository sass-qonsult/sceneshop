'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const core=require('../clients/application-core');
const ROOT=path.join(__dirname,'..');
const read=(p)=>fs.readFileSync(path.join(ROOT,p),'utf8');

test('application core normalizes three official surfaces',()=>{
  assert.equal(core.normalizeSurface('web'),'WEB');
  assert.equal(core.normalizeSurface('desktop'),'DESKTOP');
  assert.equal(core.normalizeSurface('mobile'),'MOBILE');
  assert.equal(core.normalizeSurface('unknown'),'WEB');
});

test('session parsing never mistakes an html filename for a session',()=>{
  assert.equal(core.resolveSessionCode({pathname:'/mobile.html',search:''}),'');
  assert.equal(core.resolveSessionCode({pathname:'/desktop',search:'?code=ab12cd'}),'AB12CD');
  assert.equal(core.resolveSessionCode({pathname:'/s/K7Q2ZP',search:''}),'K7Q2ZP');
  assert.equal(core.resolveSessionCode({pathname:'/app',search:'?session=xyz_123'}),'XYZ_123');
});

test('surface links preserve session and shared source',()=>{
  const u=core.buildSurfaceUrl('desktop',{code:'k7q2zp',source:'https://example.com/watch?v=1'});
  assert.match(u,/^\/desktop\?/);
  assert.match(u,/code=K7Q2ZP/);
  assert.match(u,/source=https%3A%2F%2Fexample.com/);
});

test('surface capabilities preserve commerce and synchronization doctrine',()=>{
  const mobile=core.capabilities('mobile');
  const desktop=core.capabilities('desktop');
  assert.equal(mobile.commerceTimeline,true);
  assert.equal(mobile.externalPlaybackSync,true);
  assert.equal(mobile.compactLayout,true);
  assert.equal(desktop.keyboardNavigation,true);
  assert.equal(desktop.shareTarget,false);
});

test('responsive preference selects mobile, desktop standalone, then web',()=>{
  assert.equal(core.preferredSurface({coarsePointer:true,width:1200}),'MOBILE');
  assert.equal(core.preferredSurface({width:480}),'MOBILE');
  assert.equal(core.preferredSurface({standalone:true,width:1200}),'DESKTOP');
  assert.equal(core.preferredSurface({width:1200}),'WEB');
});

test('web desktop and mobile surfaces share canonical runtime modules',()=>{
  for(const file of ['public/app.html','public/desktop.html','public/mobile.html']){
    const html=read(file);
    for(const required of ['/js/mobile-core.js','/js/app-core.js','/js/app-shell.js','/js/mobile.js']) assert.ok(html.includes(required),`${file} missing ${required}`);
    assert.ok(html.includes('Commerce Timeline')||html.includes('scenes'),`${file} missing commerce UI`);
  }
});

test('each application surface has an installable manifest with app icons',()=>{
  for(const file of ['public/app.webmanifest','public/desktop.webmanifest','public/mobile.webmanifest']){
    const manifest=JSON.parse(read(file));
    assert.equal(manifest.display,'standalone');
    assert.ok(manifest.start_url.startsWith('/'));
    assert.ok(Array.isArray(manifest.icons)&&manifest.icons.some((x)=>x.sizes==='192x192'));
    assert.ok(manifest.icons.some((x)=>x.sizes==='512x512'));
  }
});

test('service worker pre-caches all three application entries',()=>{
  const sw=read('public/sw.js');
  for(const route of ["'/app'","'/desktop'","'/mobile'","'/offline.html'","'/js/native-bridge-contract.js'"]) assert.ok(sw.includes(route),`sw missing ${route}`);
  assert.match(sw,/sceneshop-app-v019-rc1/);
  assert.match(sw,/event\.request\.mode==='navigate'/);
  assert.doesNotMatch(sw,/caches\.match\(event\.request\)\|\|await caches\.match\('\/offline\.html'\)/);
});

test('server exposes stable routes for the three application surfaces',()=>{
  const server=read('server/index.js');
  assert.match(server,/app\.get\("\/app"/);
  assert.match(server,/app\.get\("\/desktop"/);
  assert.match(server,/app\.get\("\/mobile"/);
});

test('web and mobile expose governed share-out with native web-share and copy fallbacks',()=>{
  const web=read('public/app.html'), mobile=read('public/mobile.html'), desktop=read('public/desktop.html');
  assert.match(web,/data-share-app/);
  assert.match(mobile,/data-share-app/);
  assert.match(desktop,/data-share-app/);
  const shell=read('public/js/app-shell.js');
  assert.match(shell,/bridge\.request\('SHARE'/);
  assert.match(shell,/navigator\.share/);
  assert.match(shell,/navigator\.clipboard/);
  assert.match(shell,/button\.hidden=!caps\.shareTarget/);
});
