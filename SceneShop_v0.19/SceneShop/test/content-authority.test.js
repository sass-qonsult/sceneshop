const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PostgresContentRepository, workFromRow, hydrateTrack } = require('../server/repositories/content-postgres');
const { projectState } = require('../server/data/postgres-projection');

function baseWorkRow(overrides={}) {
  return {
    id:'film-1', title:'Film 1', duration_seconds:'120.5', video_url:null, poster_url:'/poster.jpg', owner_id:'prod-1',
    pilot:true, sync_id:'SYNC-ABC', payload:{ title:'stale', duration:1, syncId:'OLD', scenes:[] }, updated_at:new Date('2026-10-03T09:00:00Z'), ...overrides,
  };
}

test('content authority: colunas PostgreSQL prevalecem no conteúdo', () => {
  const w=workFromRow(baseWorkRow());
  assert.equal(w.title,'Film 1');
  assert.equal(w.duration,120.5);
  assert.equal(w.syncId,'SYNC-ABC');
  assert.equal(w.ownerId,'prod-1');
});

test('content authority: trilha é reconstruída de cenas e produtos relacionais', () => {
  const head={ id:'t1', scenes:[] };
  const track=hydrateTrack(head,[
    { scene_id:'s2', title:'B', start_seconds:'20', end_seconds:'30', position:1, payload:{} },
    { scene_id:'s1', title:'A', start_seconds:'0', end_seconds:'10', position:0, payload:{thumb:'/a.jpg'} },
  ],[
    { scene_id:'s1', product_id:'p2', match_type:'parecido', position:1, box:null, payload:{} },
    { scene_id:'s1', product_id:'p1', match_type:'exato', position:0, box:{x:1}, payload:{} },
  ]);
  assert.deepEqual(track.scenes.map(s=>s.id),['s1','s2']);
  assert.deepEqual(track.scenes[0].products.map(p=>p.id),['p1','p2']);
  assert.equal(track.scenes[0].thumb,'/a.jpg');
});

test('content authority: saveTrack grava head, substitui cenas e scene-products', async () => {
  const sql=[];
  const draft={ version:9, tracks:{} };
  const store={ atomicDomain: async (prepare) => {
    const prepared=await prepare(structuredClone(draft));
    const client={ query:async (text)=>{sql.push(text);return {rowCount:1,rows:[]};} };
    await prepared.write(client);
    return { result:prepared.result };
  }};
  const repo=new PostgresContentRepository({store});
  const t={id:'t1',workId:'film-1',type:'official',authorId:'prod-1',title:'Official',offset:0,status:'ativa',scenes:[{id:'s1',title:'A',start:0,end:10,products:[{id:'p1',match:'exato'}]}]};
  const saved=await repo.saveTrack(t);
  assert.equal(saved.id,'t1');
  assert.ok(sql.some(q=>/INSERT INTO sceneshop_tracks/.test(q)));
  assert.ok(sql.some(q=>/DELETE FROM sceneshop_track_scenes/.test(q)));
  assert.ok(sql.some(q=>/INSERT INTO sceneshop_scene_products/.test(q)));
});

test('content authority: projector legado não apaga nem sobrescreve conteúdo PostgreSQL', async () => {
  const queries=[];
  const client={query:async(sql)=>{queries.push(sql);return {rowCount:0,rows:[]};}};
  const state={authors:{},accounts:{},partners:{},tracks:{},sellers:{},officialOffers:{},issuedOffers:{},clicks:[],sales:[],orders:[],reports:[],alerts:[],audit:[],events:[],workPartners:{},codePools:{},commercialPolicies:[]};
  await projectState(client,state);
  for (const table of ['sceneshop_works','sceneshop_products','sceneshop_tracks','sceneshop_track_scenes','sceneshop_scene_products']) {
    assert.equal(queries.some(q=>q.includes(`DELETE FROM ${table}`)),false,table);
  }
  const wi=queries.find(q=>/INSERT INTO sceneshop_works/.test(q));
  const pi=queries.find(q=>/INSERT INTO sceneshop_products/.test(q));
  assert.match(wi,/ON CONFLICT\(id\) DO NOTHING/);
  assert.match(pi,/ON CONFLICT\(id\) DO NOTHING/);
});

test('content authority: migration fixa Sync ID e vincula CommercialAsset a Product', () => {
  const sql=fs.readFileSync(path.join(__dirname,'../server/data/migrations/0010_content_commerce_authority.sql'),'utf8');
  assert.match(sql,/sync_id/i);
  assert.match(sql,/product_id TEXT REFERENCES sceneshop_products/i);
  assert.match(sql,/source_track_id/i);
  assert.match(sql,/thumbnail_url/i);
});

test('Commerce Timeline: publicação retornada agrupa produtos da mesma cena comercial', async () => {
  let n=0;
  const store={readDomain:async(fn)=>fn({query:async(sql)=>{
    n++;
    if (/commerce_track_publications/.test(sql)) return {rowCount:1,rows:[{id:'ct:film-1:r2',work_id:'film-1',revision:'2',published_at:new Date('2026-10-03T10:00:00Z'),manifest:{syncId:'SYNC-ABC'}}]};
    if (/commerce_timeline_policies/.test(sql)) return {rowCount:1,rows:[{visibility:'PAST_AND_CURRENT',thumbnails_enabled:true,missed_items_enabled:true,allow_scene_seek:false,metadata:{}}]};
    return {rowCount:2,rows:[
      {position:0,placement_id:'pl1',display_start_seconds:'10',display_end_seconds:'20',thumbnail_url:'/s1.jpg',source_scene_id:'s1',priority:2,policy:{},asset_id:'a1',product_id:'p1',name:'Watch',brand:'Omega',model:null,category:'Watch',description:null,sku:'x'},
      {position:1,placement_id:'pl2',display_start_seconds:'10',display_end_seconds:'20',thumbnail_url:'/s1.jpg',source_scene_id:'s1',priority:1,policy:{},asset_id:'a2',product_id:'p2',name:'Suit',brand:'Tom Ford',model:null,category:'Fashion',description:null,sku:'y'},
    ]};
  }})};
  const repo=new PostgresContentRepository({store});
  const timeline=await repo.getPublishedTimeline('film-1');
  assert.equal(timeline.revision,2);
  assert.equal(timeline.scenes.length,1);
  assert.equal(timeline.scenes[0].products.length,2);
  assert.equal(timeline.policy.visibility,'PAST_AND_CURRENT');
  assert.equal(n,3);
});

test('Commerce Track: publicar trilha oficial cria revisão imutável, assets, placements e outbox', async () => {
  const sql=[];
  const store={writeDomain:async(fn)=>fn({query:async(text,params)=>{
    sql.push(text);
    if (/SELECT \* FROM sceneshop_tracks WHERE id=\$1/.test(text)) return {rowCount:1,rows:[{id:'t1',work_id:'film-1',type:'official',author_id:'prod-1',title:'Official',offset_seconds:'0',status:'ativa',created_at:new Date(),payload:{}}]};
    if (/FROM sceneshop_track_scenes/.test(text)) return {rowCount:1,rows:[{track_id:'t1',scene_id:'s1',title:'Scene',start_seconds:'10',end_seconds:'20',position:0,payload:{thumb:'/scene.jpg'}}]};
    if (/FROM sceneshop_scene_products/.test(text)) return {rowCount:1,rows:[{track_id:'t1',scene_id:'s1',product_id:'p1',match_type:'exato',position:0,box:null,payload:{}}]};
    if (/SELECT id,sync_id,organization_id FROM sceneshop_works/.test(text)) return {rowCount:1,rows:[{id:'film-1',sync_id:'SYNC-ABC'}]};
    if (/COALESCE\(MAX\(revision\)/.test(text)) return {rowCount:1,rows:[{next:'3'}]};
    if (/SELECT \* FROM sceneshop_products/.test(text)) return {rowCount:1,rows:[{id:'p1',name:'Watch',brand:'Omega',category:'Watch',sku:'O1',image_url:'/w.jpg',reference_price:'100',created_by:'prod-1',payload:{description:'D'}}]};
    return {rowCount:1,rows:[]};
  }})};
  const repo=new PostgresContentRepository({store});
  const out=await repo.publishTrackAsCommerceTrack('t1','prod-1');
  assert.equal(out.revision,3);
  assert.equal(out.entries,1);
  assert.equal(out.syncId,'SYNC-ABC');
  assert.ok(sql.some(q=>/INSERT INTO sceneshop_commerce_track_publications/.test(q)));
  assert.ok(sql.some(q=>/INSERT INTO sceneshop_commercial_assets/.test(q)));
  assert.ok(sql.some(q=>/INSERT INTO sceneshop_placements/.test(q)));
  assert.ok(sql.some(q=>/commerce_track\.published/.test(q)));
});

test('content authority: produtos oficiais da produtora vêm do PostgreSQL e não do snapshot', async () => {
  const calls=[];
  const store={readDomain:async(fn)=>fn({query:async(sql,params)=>{
    calls.push({sql,params});
    return {rowCount:2,rows:[{product_id:'p-created'},{product_id:'p-track'}]};
  }})};
  const repo=new PostgresContentRepository({store});
  const ids=await repo.listOfficialProductIdsByAuthor('prod-1');
  assert.deepEqual(ids,['p-created','p-track']);
  assert.match(calls[0].sql,/sceneshop_scene_products/);
  assert.match(calls[0].sql,/sceneshop_products/);
  assert.deepEqual(calls[0].params,['prod-1']);
});

test('content authority: autorização de oferta oficial consulta ownership relacional', async () => {
  const seen=[];
  const store={readDomain:async(fn)=>fn({query:async(sql,params)=>{
    seen.push({sql,params});
    return {rowCount:1,rows:[{'?column?':1}]};
  }})};
  const repo=new PostgresContentRepository({store});
  assert.equal(await repo.authorOwnsOfficialProduct('prod-1','p1'),true);
  assert.match(seen[0].sql,/t\.type='official'/);
  assert.match(seen[0].sql,/p\.created_by=\$1/);
  assert.deepEqual(seen[0].params,['prod-1','p1']);
});
