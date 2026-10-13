const test = require('node:test');
const assert = require('node:assert/strict');
const { CompanionState } = require('../clients/mobile-core');

const timeline={scenes:[
  {sceneId:'s1',start:10,end:20},
  {sceneId:'s2',start:30,end:40},
  {sceneId:'s3',start:50,end:60},
]};

test('mobile core separates playback head from browse head',()=>{
  const s=new CompanionState();
  s.applySync({position:12,confidence:.9,observedAt:1});
  s.tick(12,timeline);
  s.browse(timeline.scenes[0]);
  s.tick(32,timeline);
  assert.equal(s.snapshot().mode,'BROWSING');
  assert.equal(s.snapshot().playbackPosition,32);
  assert.equal(s.snapshot().browsePosition,10);
  assert.equal(s.snapshot().browseSceneId,'s1');
  assert.deepEqual(s.snapshot().missedSceneIds,['s2']);
});

test('mobile core goLive changes only commercial browse state',()=>{
  const s=new CompanionState({playbackPosition:32});
  s.browse(timeline.scenes[0]);
  s.goLive(timeline);
  assert.equal(s.snapshot().mode,'LIVE');
  assert.equal(s.snapshot().browsePosition,32);
  assert.equal(s.snapshot().browseSceneId,'s2');
});

test('mobile core applies spoiler policy consistently',()=>{
  const s=new CompanionState({playbackPosition:35});
  assert.deepEqual(s.visibleScenes(timeline,{visibility:'PAST_ONLY'}).map(x=>x.sceneId),['s1']);
  assert.deepEqual(s.visibleScenes(timeline,{visibility:'PAST_AND_CURRENT'}).map(x=>x.sceneId),['s1','s2']);
  assert.deepEqual(s.visibleScenes(timeline,{visibility:'FULL'}).map(x=>x.sceneId),['s1','s2','s3']);
});

test('mobile core missed commercial scenes can be consumed independently',()=>{
  const s=new CompanionState({playbackPosition:12});
  s.browse(timeline.scenes[0]);
  s.tick(32,timeline);
  s.tick(52,timeline);
  assert.deepEqual(s.consumeMissed(timeline).map(x=>x.sceneId),['s2','s3']);
  assert.deepEqual(s.snapshot().missedSceneIds,[]);
});

test('mobile core can clear missed commercial scenes without moving either playhead',()=>{
  const s=new CompanionState({playbackPosition:12});
  s.browse(timeline.scenes[0]);
  s.tick(32,timeline);
  const before=s.snapshot();
  s.clearMissed();
  const after=s.snapshot();
  assert.equal(after.mode,'BROWSING');
  assert.equal(after.playbackPosition,before.playbackPosition);
  assert.equal(after.browsePosition,before.browsePosition);
  assert.deepEqual(after.missedSceneIds,[]);
});


test('mobile core reports no active commercial scene in timeline gaps',()=>{
  const { activeScene } = require('../clients/mobile-core');
  assert.equal(activeScene(timeline,25), null);
  assert.equal(activeScene(timeline,32).sceneId, 's2');
});


test('mobile core clears live commercial scene while playback crosses a timeline gap',()=>{
  const s=new CompanionState({playbackPosition:12});
  s.tick(12,timeline);
  assert.equal(s.snapshot().browseSceneId,'s1');
  s.tick(25,timeline);
  assert.equal(s.snapshot().mode,'LIVE');
  assert.equal(s.snapshot().browseSceneId,null);
  assert.equal(s.snapshot().browsePosition,25);
});
