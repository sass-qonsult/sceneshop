const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs');
const path=require('path');
const store=require('../server/store');
const {StateDistributionRepository}=require('../server/repositories/distribution');
const {parseExternalUrl}=require('../server/distribution/platforms');
const {rankMatches}=require('../server/distribution/sync-match');
const tokens=require('../server/distribution/tokens');
const fp=require('../public/js/sync-fingerprint.js');

test.beforeEach(()=>store.useMemory(true));

test('distribution: parser recognizes YouTube, Instagram and TikTok bindings',()=>{
  assert.deepEqual(parseExternalUrl('https://youtu.be/abc123').platform,'YOUTUBE');
  assert.equal(parseExternalUrl('https://www.youtube.com/watch?v=z9Y').externalContentId,'z9Y');
  assert.equal(parseExternalUrl('https://www.instagram.com/reel/XYZ987/').platform,'INSTAGRAM');
  assert.equal(parseExternalUrl('https://www.tiktok.com/@creator/video/123456789').externalContentId,'123456789');
});

test('distribution: binding remains platform-neutral and organization-owned',()=>{
  const r=new StateDistributionRepository(()=>store.state,()=>{});
  const out=r.createBinding('org-demo-produtora',{workId:'demo-01',mode:'COMPANION',canonicalUrl:'https://www.youtube.com/watch?v=abc123',officialOwnerUrl:'https://produtora.example/bond'},'produtora');
  assert.equal(out.binding.platform,'YOUTUBE');
  assert.equal(out.binding.externalContentId,'abc123');
  assert.equal(out.binding.organizationId,'org-demo-produtora');
  assert.equal(out.binding.mode,'COMPANION');
});

test('distribution: temporal matcher recovers playback offset from independent sample offsets',()=>{
  const samples=[{hash:'aa01',offset:0},{hash:'aa02',offset:.5},{hash:'aa03',offset:1}];
  const rows=[
    {fingerprint_hash:'aa01',work_id:'w1',sync_id:'SYNC1',start_seconds:42,quality:.8},
    {fingerprint_hash:'aa02',work_id:'w1',sync_id:'SYNC1',start_seconds:42.5,quality:.8},
    {fingerprint_hash:'aa03',work_id:'w1',sync_id:'SYNC1',start_seconds:43,quality:.8},
    {fingerprint_hash:'aa01',work_id:'noise',sync_id:'N',start_seconds:9,quality:.4},
  ];
  const ranked=rankMatches(samples,rows);
  assert.equal(ranked[0].workId,'w1');
  assert.equal(ranked[0].position,42);
  assert.equal(ranked[0].matched,3);
  assert.ok(ranked[0].confidence>.9);
});

test('distribution: sync index import is isolated from media bytes and recognizable',()=>{
  const r=new StateDistributionRepository(()=>store.state,()=>{});
  const work={id:'demo-01',syncId:'SYNC-DEMO'};
  const out=r.importSyncIndex('org-demo-produtora',work,{format:'sceneshop-sync-index',version:1,syncId:'SYNC-DEMO',algorithm:'SS-AUDIO-SPECTRAL',algorithmVersion:1,duration:60,sourceSha256:'f'.repeat(64),windows:[{hash:'abcd01',offset:10,quality:.7},{hash:'abcd02',offset:10.5,quality:.8},{hash:'abcd03',offset:11,quality:.9}]},'produtora');
  assert.equal(out.build.windowCount,3);
  const hit=r.recognize([{hash:'abcd01',offset:0},{hash:'abcd02',offset:.5},{hash:'abcd03',offset:1}],{});
  assert.equal(hit[0].position,10);
  assert.equal(hit[0].syncId,'SYNC-DEMO');
});

test('distribution: SDK key stores hash only and browser token is scoped/expiring',()=>{
  const r=new StateDistributionRepository(()=>store.state,()=>{});
  const out=r.createSdkKey('org-demo-produtora',{label:'Embedded'},'produtora');
  assert.match(out.secret,/^ss_live_/);
  assert.equal(JSON.stringify(store.state.distributionSdkKeys).includes(out.secret),false);
  const auth=r.authenticateSdkKey(out.secret);
  assert.equal(auth.organizationId,'org-demo-produtora');
  const token=tokens.issueSdkToken({organizationId:auth.organizationId,workId:'demo-01',bindingId:'b1',mode:'EMBEDDED',scopes:auth.scopes},5000);
  const p=tokens.verify(token);
  assert.equal(p.workId,'demo-01');
  assert.ok(p.scopes.includes('playback:write'));
});

test('distribution: perceptual fingerprint emits compact non-media descriptors',()=>{
  const rate=8000,duration=4,n=rate*duration,s=new Float32Array(n);
  for(let i=0;i<n;i++)s[i]=.5*Math.sin(2*Math.PI*(440+(i/n)*80)*i/rate)+.15*Math.sin(2*Math.PI*1200*i/rate);
  const windows=fp.fingerprint(s,rate);
  assert.ok(windows.length>=4);
  assert.match(windows[0].hash,/^[0-9a-f]{6}$/);
  assert.equal(Object.prototype.hasOwnProperty.call(windows[0],'samples'),false);
});

test('distribution migration: SDK credentials, sync builds and org-owned bindings exist',()=>{
  const sql=fs.readFileSync(path.join(__dirname,'../server/data/migrations/0019_distribution_sdk_sync.sql'),'utf8');
  assert.match(sql,/sceneshop_distribution_sdk_keys/);
  assert.match(sql,/key_hash TEXT NOT NULL UNIQUE/);
  assert.match(sql,/sceneshop_sync_index_builds/);
  assert.match(sql,/organization_id/);
  assert.match(sql,/sceneshop_distribution_events/);
});
