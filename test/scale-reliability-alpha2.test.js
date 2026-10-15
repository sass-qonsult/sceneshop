const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { MemoryCacheCoordinator, RedisCacheCoordinator } = require('../server/operations/cache-coordinator');
const { compareRecoveryManifest, collectRecoveryManifest } = require('../server/operations/recovery-postgres');
const offers = require('../server/offers');

class FakeRedis {
  constructor(shared) {
    this.shared = shared || { values:new Map(), expiries:new Map(), zsets:new Map(), subscribers:new Map() };
    this.isOpen = false;
  }
  duplicate(){ return new FakeRedis(this.shared); }
  on(){}
  async connect(){ this.isOpen=true; }
  async quit(){ this.isOpen=false; }
  _expired(key){ const at=this.shared.expiries.get(key); if(at && at<=Date.now()){ this.shared.values.delete(key); this.shared.expiries.delete(key); return true; } return false; }
  async ping(){ return 'PONG'; }
  async get(key){ this._expired(key); return this.shared.values.has(key)?this.shared.values.get(key):null; }
  async set(key,value,opts={}){ this._expired(key); if(opts.NX && this.shared.values.has(key)) return null; this.shared.values.set(key,String(value)); if(opts.PX) this.shared.expiries.set(key,Date.now()+Number(opts.PX)); return 'OK'; }
  async del(key){ const had=this.shared.values.delete(key); this.shared.expiries.delete(key); return had?1:0; }
  async incr(key){ const next=Number(await this.get(key)||0)+1; this.shared.values.set(key,String(next)); return next; }
  async publish(channel,message){ for(const fn of this.shared.subscribers.get(channel)||[]) fn(message); return (this.shared.subscribers.get(channel)||[]).length; }
  async subscribe(channel,fn){ const list=this.shared.subscribers.get(channel)||[]; list.push(fn); this.shared.subscribers.set(channel,list); return list.length; }
  async zAdd(key,rows){ const m=this.shared.zsets.get(key)||new Map(); for(const row of rows)m.set(row.value,Number(row.score)); this.shared.zsets.set(key,m); return rows.length; }
  async zRemRangeByScore(key,min,max){ const m=this.shared.zsets.get(key)||new Map(); let n=0; for(const [v,s] of [...m]) if(s>=Number(min)&&s<=Number(max)){m.delete(v);n++;} return n; }
  async zCount(key,min,max){ const m=this.shared.zsets.get(key)||new Map(); const lo=Number(min); const hi=max==='+inf'?Infinity:Number(max); return [...m.values()].filter(s=>s>=lo&&s<=hi).length; }
  async eval(_script,{keys,arguments:args}){ const current=await this.get(keys[0]); if(current===args[0]) return this.del(keys[0]); return 0; }
}

test('alpha.2 memory cache uses namespace generations for O(1) invalidation', async()=>{
  const cache=new MemoryCacheCoordinator({instanceId:'one'}); await cache.init();
  await cache.set('offers','product-1',{price:10},{ttlMs:5000});
  assert.deepEqual(await cache.get('offers','product-1'),{price:10});
  const inv=await cache.invalidate('offers',{reason:'product-update'});
  assert.equal(inv.epoch,2);
  assert.equal(await cache.get('offers','product-1'),null);
  await cache.set('offers','product-1',{price:11},{ttlMs:5000});
  assert.deepEqual(await cache.get('offers','product-1'),{price:11});
});

test('alpha.2 memory lease excludes concurrent owner and releases by token', async()=>{
  const cache=new MemoryCacheCoordinator({instanceId:'one'});
  const a=await cache.acquireLease('rebuild-index',{ttlMs:5000});
  assert.ok(a); assert.equal(await cache.acquireLease('rebuild-index',{ttlMs:5000}),null);
  assert.equal(await a.release(),true);
  const b=await cache.acquireLease('rebuild-index',{ttlMs:5000}); assert.ok(b);
});

test('alpha.2 Redis coordinator invalidates across clients and uses token-safe lease', async()=>{
  const shared={ values:new Map(), expiries:new Map(), zsets:new Map(), subscribers:new Map() };
  const firstClient=new FakeRedis(shared), secondClient=new FakeRedis(shared);
  const a=new RedisCacheCoordinator({client:firstClient,publisher:firstClient.duplicate(),subscriber:firstClient.duplicate(),instanceId:'a',heartbeatTtlMs:60000});
  const b=new RedisCacheCoordinator({client:secondClient,publisher:secondClient.duplicate(),subscriber:secondClient.duplicate(),instanceId:'b',heartbeatTtlMs:60000});
  await a.init(); await b.init();
  await a.set('offers','p1',{n:1},{ttlMs:5000}); assert.deepEqual(await b.get('offers','p1'),{n:1});
  const event=await b.invalidate('offers',{reason:'test'}); assert.equal(event.epoch,2); assert.equal(await a.get('offers','p1'),null);
  const lease=await a.acquireLease('singleton',{ttlMs:5000}); assert.ok(lease); assert.equal(await b.acquireLease('singleton',{ttlMs:5000}),null);
  assert.equal(await lease.release(),true); assert.ok(await b.acquireLease('singleton',{ttlMs:5000}));
  const health=await a.health(); assert.equal(health.ok,true); assert.equal(health.activeInstances,2);
  await a.close(); await b.close();
});

test('alpha.2 offers invalidate delegates to distributed coordinator', async()=>{
  let call=null;
  offers.configureCache({ get:async()=>null,set:async()=>true,invalidate:async(ns,meta)=>{call={ns,meta};return{namespace:ns,epoch:9};} });
  const result=await offers.invalidateProduct('p42',{action:'update'});
  assert.equal(result.epoch,9); assert.equal(call.ns,'offers'); assert.equal(call.meta.productId,'p42'); assert.equal(call.meta.action,'update');
  offers._resetCache();
});

test('alpha.2 recovery manifest accepts direct Postgres repository shape',async()=>{
  const repo={ kind:'postgres', readDomain:async(fn)=>fn({ query:async(sql)=>{
    if(/state_snapshots/.test(sql)) return {rowCount:1,rows:[{revision:4,payload:'{\"ok\":true}'}]};
    if(/schema_migrations/.test(sql)) return {rowCount:1,rows:[{version:'0027_cache_coordination_recovery.sql'}]};
    if(/pg_current_wal_lsn/.test(sql)) return {rowCount:1,rows:[{wal_lsn:'0/ABC'}]};
    if(/count\(\*\)/.test(sql)) return {rowCount:1,rows:[{n:0}]};
    throw new Error('unexpected query '+sql);
  }}) };
  const manifest=await collectRecoveryManifest(repo);
  assert.equal(manifest.revision,4); assert.equal(manifest.latestMigration,'0027_cache_coordination_recovery.sql'); assert.match(manifest.snapshotSha256,/^[a-f0-9]{64}$/);
});

test('alpha.2 recovery manifest comparison catches restore drift',()=>{
  const expected={revision:7,snapshotSha256:'a'.repeat(64),latestMigration:'0027_cache_coordination_recovery.sql',counts:{sceneshop_products:4,sceneshop_sales:2}};
  assert.equal(compareRecoveryManifest(expected,{...expected,counts:{...expected.counts}}).ok,true);
  const bad=compareRecoveryManifest(expected,{...expected,revision:6,counts:{sceneshop_products:3,sceneshop_sales:2}});
  assert.equal(bad.ok,false); assert.deepEqual(bad.mismatches.map(x=>x.field),['revision','counts.sceneshop_products']);
});

test('alpha.2 migration creates durable recovery checkpoint authority',()=>{
  const sql=fs.readFileSync(path.join(__dirname,'..','server','data','migrations','0027_cache_coordination_recovery.sql'),'utf8');
  assert.match(sql,/CREATE TABLE IF NOT EXISTS sceneshop_recovery_checkpoints/i);
  assert.match(sql,/source_snapshot_sha256/i);
  assert.match(sql,/VERIFIED/);
  assert.match(sql,/FAILED/);
});

test('alpha.2 production readiness requires Redis cache coordination',()=>{
  const indexSrc=fs.readFileSync(path.join(__dirname,'..','server','index.js'),'utf8');
  const runtimeSrc=fs.readFileSync(path.join(__dirname,'..','server','runtime-config.js'),'utf8');
  assert.match(runtimeSrc,/config\.CACHE_BACKEND !== 'redis'/);
  assert.match(indexSrc,/cacheRuntime\.health\(\)/);
  assert.match(indexSrc,/activeInstances/);
});

test('alpha.2 recovery gate provisions isolated restore PostgreSQL and fresh Redis',()=>{
  const compose=fs.readFileSync(path.join(__dirname,'..','compose.recovery-gate.yaml'),'utf8');
  assert.match(compose,/postgres_restore:/);
  assert.match(compose,/sceneshop_restore/);
  assert.match(compose,/redis_fresh:/);
  assert.match(compose,/--appendonly", "no/);
});

test('alpha.2 recovery gate performs physical backup, isolated restore and evidence hashing',()=>{
  const script=fs.readFileSync(path.join(__dirname,'..','tools','run-recovery-gate.sh'),'utf8');
  assert.match(script,/pg_dump/);
  assert.match(script,/pg_restore/);
  assert.match(script,/recovery-drill\.js --checkpoint/);
  assert.match(script,/--verify=\$CHECKPOINT_ID/);
  assert.match(script,/recovery-restored-smoke\.js/);
  assert.match(script,/sha256sum/);
  assert.match(script,/recovery-evidence-/);
});

test('alpha.2 restored smoke requires empty Redis before restored app readiness',()=>{
  const src=fs.readFileSync(path.join(__dirname,'..','tools','recovery-restored-smoke.js'),'utf8');
  assert.match(src,/redis\.dbSize\(\)/);
  assert.match(src,/dbsize !== 0/);
  assert.match(src,/appSmoke\(databaseUrl, redisUrl, report\)/);
  assert.match(src,/appReadyOnFreshRedis/);
});

test('alpha.2 composite gate cannot pass without foundation and recovery gates',()=>{
  const src=fs.readFileSync(path.join(__dirname,'..','tools','run-alpha2-gate.sh'),'utf8');
  const foundation=src.indexOf('run-foundation-gate.sh');
  const recovery=src.indexOf('run-recovery-gate.sh');
  assert.ok(foundation>=0 && recovery>foundation);
});
