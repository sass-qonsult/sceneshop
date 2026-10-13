const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs');
const path=require('path');
const adapters=require('../server/distribution/platform-adapters');
const {StateDistributionRepository}=require('../server/repositories/distribution');

function response(data,status=200){return{ok:status>=200&&status<300,status,json:async()=>data};}
function conn(platform){return{platform,status:'ACTIVE',credentialsRef:'env:SCENESHOP_TEST_PLATFORM_SECRET'};}

test('platform adapters resolve only referenced secrets, never raw credentials',()=>{
  assert.equal(adapters.secretFromRef('env:SCENESHOP_TEST_PLATFORM_SECRET',{SCENESHOP_TEST_PLATFORM_SECRET:'abc'}),'abc');
  assert.throws(()=>adapters.secretFromRef('abc',{}),/credentials_ref|runtime suporta/);
});

test('YouTube metadata adapter parses duration and canonical metadata',async()=>{
  let called;
  const fetchImpl=async(u)=>{called=String(u);return response({items:[{id:'yt123',snippet:{title:'Trailer',description:'Desc',channelId:'ch1',channelTitle:'Channel',publishedAt:'2026-01-01T00:00:00Z',thumbnails:{high:{url:'https://img.example/h.jpg'}}},contentDetails:{duration:'PT1M30S'},status:{embeddable:true,privacyStatus:'public'}}]});};
  const out=await adapters.youtube({externalContentId:'yt123'},conn('YOUTUBE'),{fetchImpl,secretResolver:()=> 'key'});
  assert.match(called,/youtube\/v3\/videos/);
  assert.equal(out.duration,90);
  assert.equal(out.title,'Trailer');
  assert.equal(out.thumbnail,'https://img.example/h.jpg');
});

test('Instagram metadata adapter maps professional-media metadata without persisting token',async()=>{
  let called;
  const fetchImpl=async(u)=>{called=String(u);return response({id:'ig1',caption:'Produto em cena\ntexto',media_type:'REELS',permalink:'https://instagram.com/reel/ig1',thumbnail_url:'https://img.example/i.jpg',timestamp:'2026-01-02T00:00:00Z',username:'creator'});};
  const out=await adapters.instagram({externalContentId:'ig1'},conn('INSTAGRAM'),{fetchImpl,secretResolver:()=> 'token'});
  assert.match(called,/graph\.instagram\.com/);
  assert.match(called,/access_token=token/);
  assert.equal(out.title,'Produto em cena');
  assert.equal(out.mediaType,'REELS');
});

test('TikTok metadata adapter uses video query with bearer token',async()=>{
  let req;
  const fetchImpl=async(u,opts)=>{req={url:String(u),opts};return response({data:{videos:[{id:'tt1',title:'Clip',video_description:'Desc',duration:44,cover_image_url:'https://img.example/t.jpg',embed_link:'https://tiktok.com/embed/tt1',share_url:'https://tiktok.com/@x/video/tt1'}]}});};
  const out=await adapters.tiktok({externalContentId:'tt1'},conn('TIKTOK'),{fetchImpl,secretResolver:()=> 'tk'});
  assert.match(req.url,/\/v2\/video\/query\//);
  assert.equal(req.opts.headers.Authorization,'Bearer tk');
  assert.deepEqual(JSON.parse(req.opts.body).filters.video_ids,['tt1']);
  assert.equal(out.duration,44);
});

test('state platform connections reject raw secrets and enforce org/platform binding isolation',()=>{
  const state={distributionBindings:{},distributionSdkKeys:{},syncFingerprints:{},syncIndexBuilds:{},timelinePolicies:{},distributionEvents:[],platformConnections:{}};
  const repo=new StateDistributionRepository(()=>state,()=>{});
  assert.ok(repo.createPlatformConnection('org-a',{platform:'YOUTUBE',credentialsRef:'env:YT',accessToken:'raw'},'owner').errors);
  const c=repo.createPlatformConnection('org-a',{platform:'YOUTUBE',credentialsRef:'env:YT'},'owner').connection;
  assert.ok(c.id);
  assert.ok(repo.createBinding('org-b',{workId:'w',platform:'YOUTUBE',connectionId:c.id},'x').errors);
  assert.ok(repo.createBinding('org-a',{workId:'w',platform:'INSTAGRAM',connectionId:c.id},'x').errors);
  const b=repo.createBinding('org-a',{workId:'w',platform:'YOUTUBE',connectionId:c.id},'x').binding;
  assert.equal(b.connectionId,c.id);
});

test('platform connector migration stores credential references, not access-token columns',()=>{
  const sql=fs.readFileSync(path.join(__dirname,'../server/data/migrations/0020_platform_connectors_mobile.sql'),'utf8');
  assert.match(sql,/credentials_ref TEXT NOT NULL/i);
  assert.doesNotMatch(sql,/access_token\s+TEXT/i);
  assert.match(sql,/connection_id TEXT REFERENCES sceneshop_platform_connections/i);
});

test('platform connection lifecycle supports rotation/disable without exposing secret value',()=>{
  const state={distributionBindings:{},distributionSdkKeys:{},syncFingerprints:{},syncIndexBuilds:{},timelinePolicies:{},distributionEvents:[],platformConnections:{}};
  const repo=new StateDistributionRepository(()=>state,()=>{});
  const c=repo.createPlatformConnection('org-a',{platform:'INSTAGRAM',credentialsRef:'env:IG_TOKEN'},'owner').connection;
  const changed=repo.updatePlatformConnection('org-a',c.id,{credentialsRef:'env:IG_TOKEN_ROTATED',status:'DISABLED'}).connection;
  assert.equal(changed.status,'DISABLED');
  assert.equal(changed.credentialsRef,'env:***');
  assert.equal(state.platformConnections[c.id].credentialsRef,'env:IG_TOKEN_ROTATED');
  assert.ok(repo.createBinding('org-a',{workId:'w',platform:'INSTAGRAM',connectionId:c.id},'x').errors);
});
