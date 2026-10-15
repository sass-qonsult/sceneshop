const test = require('node:test');
const assert = require('node:assert/strict');
const { MemorySessionRepository } = require('../server/realtime/session-memory');
const { RedisSessionRepository } = require('../server/realtime/session-redis');
const { PostgresPlaybackRepository } = require('../server/repositories/playback-postgres');

class FakeMulti {
  constructor(client){ this.client=client; this.jobs=[]; }
  expire(...a){ this.jobs.push(()=>this.client.expire(...a)); return this; }
  hSet(...a){ this.jobs.push(()=>this.client.hSet(...a)); return this; }
  async exec(){ const out=[]; for(const j of this.jobs) out.push(await j()); return out; }
}
class FakeRedis {
  constructor(){ this.hashes=new Map(); this.sets=new Map(); this.expiry=new Map(); this.isOpen=true; }
  async ping(){ return 'PONG'; }
  async exists(k){ return this.hashes.has(k)||this.sets.has(k) ? 1 : 0; }
  async hSet(k,obj){ const m=this.hashes.get(k)||{}; Object.assign(m,obj); this.hashes.set(k,m); return Object.keys(obj).length; }
  async hGetAll(k){ return { ...(this.hashes.get(k)||{}) }; }
  async sAdd(k,v){ const s=this.sets.get(k)||new Set(); const before=s.size; s.add(v); this.sets.set(k,s); return s.size>before?1:0; }
  async sRem(k,v){ const s=this.sets.get(k)||new Set(); const had=s.delete(v); this.sets.set(k,s); return had?1:0; }
  async sMembers(k){ return [...(this.sets.get(k)||new Set())]; }
  async sCard(k){ return (this.sets.get(k)||new Set()).size; }
  async expire(k,secs){ this.expiry.set(k,secs); return 1; }
  multi(){ return new FakeMulti(this); }
  async quit(){ this.isOpen=false; }
}

test('Commerce browsing is per viewer and does not move shared playback head', () => {
  const r = new MemorySessionRepository();
  const s = r.create('demo-01', 10, 'track-1', { mode:'PARTNER_NATIVE' });
  r.addDevice(s.code,'device-aaaa');
  r.addDevice(s.code,'device-bbbb');
  r.updatePlayback(s.code,{time:20,playing:true,sceneId:'c2'});
  const a = r.setBrowse(s.code,'device-aaaa',{position:5,sceneId:'c1'});
  assert.equal(a.state,'BROWSING'); assert.equal(a.browsePosition,5);
  r.updatePlayback(s.code,{time:30,playing:true,sceneId:'c3'});
  assert.equal(r.getViewer(s.code,'device-aaaa').browsePosition,5);
  const b = r.getViewer(s.code,'device-bbbb');
  assert.equal(b.state,'LIVE'); assert.equal(b.browsePosition,30);
  assert.equal(r.get(s.code).playbackPosition,30);
  const live = r.goLive(s.code,'device-aaaa');
  assert.equal(live.state,'LIVE'); assert.equal(live.browsePosition,30); assert.equal(live.browseSceneId,'c3');
  r.close();
});

test('Redis repository persists pairing, audience and viewer state independently', async () => {
  const fake = new FakeRedis();
  const r = new RedisSessionRepository({ client:fake, ttlMs:60_000 });
  await r.init();
  const s = await r.create('movie-1',12,'track-1',{mode:'COMPANION',partnerId:'p1'});
  assert.equal(s.mode,'COMPANION'); assert.equal(s.playbackPosition,12);
  const first = await r.addDevice(s.code,'device-aaaa');
  const second = await r.addDevice(s.code,'device-aaaa');
  assert.equal(first.isNew,true); assert.equal(second.isNew,false);
  await r.phoneConnected(s.code,'sock-1'); await r.phoneConnected(s.code,'sock-2');
  assert.equal((await r.get(s.code)).phones,2);
  await r.setBrowse(s.code,'device-aaaa',{position:4,sceneId:'c1'});
  await r.updatePlayback(s.code,{time:25,playing:true,sceneId:'c3'});
  const viewer = await r.getViewer(s.code,'device-aaaa');
  assert.equal(viewer.state,'BROWSING'); assert.equal(viewer.browsePosition,4);
  const live = await r.goLive(s.code,'device-aaaa');
  assert.equal(live.state,'LIVE'); assert.equal(live.browsePosition,25);
  await r.phoneDisconnected(s.code,'sock-1');
  assert.equal((await r.get(s.code)).phones,1);
});

test('Redis resync updates playback confidence without forcing an exploring viewer live', async () => {
  const r = new RedisSessionRepository({ client:new FakeRedis(), ttlMs:60_000 });
  await r.init();
  const s=await r.create('movie-1',30,'track-1',{mode:'COMPANION'});
  await r.setBrowse(s.code,'device-aaaa',{position:10,sceneId:'old'});
  const updated=await r.resync(s.code,{position:45.5,confidence:0.97,sceneId:'new'});
  assert.equal(updated.playbackPosition,45.5); assert.equal(updated.syncConfidence,0.97);
  const viewer=await r.getViewer(s.code,'device-aaaa');
  assert.equal(viewer.state,'BROWSING'); assert.equal(viewer.browsePosition,10);
});

test('Postgres playback repository records durable session checkpoint and sync observation', async () => {
  const calls=[];
  const fakeStore={
    backendKind:()=> 'postgres',
    writeDomain: async fn => fn({ query: async (sql,params)=>{ calls.push({sql,params}); return {rowCount:1,rows:[]}; } })
  };
  const repo=new PostgresPlaybackRepository({store:fakeStore});
  const session={code:'ABC123',workId:'w1',mode:'COMPANION',playbackPosition:12.5,playbackObservedAt:1000,syncConfidence:0.88,lastSyncAt:1000};
  await repo.createSession(session);
  await repo.recordSync({...session,playbackPosition:22,lastSyncAt:2000},{source:'AUDIO_FINGERPRINT',recognizedSyncId:'SYNC-X',fingerprintId:null,metadata:{deviceId:'d'}});
  const sql=calls.map(x=>x.sql).join('\n');
  assert.match(sql,/INSERT INTO sceneshop_playback_sessions/);
  assert.match(sql,/INSERT INTO sceneshop_sync_observations/);
  assert.ok(calls.some(x=>x.params && x.params.includes('SYNC-X')));
});

test('memory session health exposes realtime backend', async () => {
  const r=new MemorySessionRepository();
  r.create('w',0,null);
  const h=await r.health();
  assert.deepEqual(h,{ok:true,backend:'memory',sessions:1});
  await r.close();
});

test('shared playback session no longer carries a global Browse Head', () => {
  const r = new MemorySessionRepository();
  const s = r.create('w', 7, 't', { mode: 'COMPANION' });
  assert.equal(Object.prototype.hasOwnProperty.call(s, 'browsePosition'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(s, 'browseSceneId'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(s, 'state'), false);
  const viewer = r.setBrowse(s.code, 'device-aaaa', { position: 2, sceneId: 'c1' });
  assert.equal(viewer.state, 'BROWSING');
  assert.equal(r.get(s.code).playbackPosition, 7);
  r.close();
});

test('Postgres playback repository persists Browse Head per viewer/device', async () => {
  const calls=[];
  const fakeStore={
    backendKind:()=> 'postgres',
    writeDomain: async fn => fn({ query: async (sql,params)=>{ calls.push({sql,params}); return {rowCount:1,rows:[]}; } }),
    readDomain: async fn => fn({ query: async (sql,params)=>{ calls.push({sql,params}); return {rowCount:1,rows:[{device_id:'device-aaaa',state:'BROWSING',browse_position:'12.5',browse_scene_id:'c2',updated_at:new Date()}]}; } }),
  };
  const repo=new PostgresPlaybackRepository({store:fakeStore});
  const session={code:'ABC123',playbackPosition:22};
  const viewer={deviceId:'device-aaaa',state:'BROWSING',browsePosition:12.5,browseSceneId:'c2'};
  await repo.recordViewerState(session,viewer);
  const loaded=await repo.getViewerState('ABC123','device-aaaa');
  assert.equal(loaded.state,'BROWSING');
  assert.equal(loaded.browsePosition,12.5);
  assert.equal(loaded.browseSceneId,'c2');
  assert.match(calls.map(x=>x.sql).join('\n'),/sceneshop_playback_viewers/);
});
