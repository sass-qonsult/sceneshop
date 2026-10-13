(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports) module.exports=api;
  if(root) root.SceneShopMobileCore=api;
})(typeof window!=='undefined'?window:globalThis,function(){
  'use strict';
  function n(v,fallback=0){const x=Number(v);return Number.isFinite(x)?Math.max(0,x):fallback;}
  function sceneId(scene){return scene&&(scene.sceneId||scene.id)||null;}
  function start(scene){return n(scene&&scene.start,0);}
  function end(scene){return n(scene&&scene.end,start(scene));}
  function activeScene(timeline,position){return (timeline&&timeline.scenes||[]).find((s)=>position>=start(s)&&position<end(s))||null;}
  class CompanionState{
    constructor(initial={}){
      this.mode=initial.mode==='BROWSING'?'BROWSING':'LIVE';
      this.playbackPosition=n(initial.playbackPosition,0);
      this.browsePosition=n(initial.browsePosition,this.playbackPosition);
      this.browseSceneId=initial.browseSceneId||null;
      this.syncConfidence=Math.max(0,Math.min(1,Number(initial.syncConfidence)||0));
      this.lastSyncAt=initial.lastSyncAt||null;
      this._lastPlaybackSceneId=initial.lastPlaybackSceneId||null;
      this._missedSceneIds=Array.isArray(initial.missedSceneIds)?[...new Set(initial.missedSceneIds)]:[];
    }
    applySync({position,confidence,observedAt=Date.now()}={}){this.playbackPosition=n(position,this.playbackPosition);this.syncConfidence=Math.max(0,Math.min(1,Number(confidence)||0));this.lastSyncAt=observedAt;if(this.mode==='LIVE')this.browsePosition=this.playbackPosition;return this.snapshot();}
    tick(position,timeline=null){this.playbackPosition=n(position,this.playbackPosition);const current=activeScene(timeline,this.playbackPosition),currentId=sceneId(current);if(this.mode==='LIVE'){this.browsePosition=this.playbackPosition;this.browseSceneId=currentId;}else if(currentId&&currentId!==this._lastPlaybackSceneId&&currentId!==this.browseSceneId&&!this._missedSceneIds.includes(currentId)){this._missedSceneIds.push(currentId);}if(currentId)this._lastPlaybackSceneId=currentId;return this.snapshot();}
    browse(scene){if(!scene)return this.snapshot();this.mode='BROWSING';this.browsePosition=start(scene);this.browseSceneId=sceneId(scene);return this.snapshot();}
    goLive(timeline=null){this.mode='LIVE';this.browsePosition=this.playbackPosition;const current=activeScene(timeline,this.playbackPosition);this.browseSceneId=sceneId(current);return this.snapshot();}
    visibleScenes(timeline,policy){const scenes=[...(timeline&&timeline.scenes||[])];const visibility=String(policy&&policy.visibility||timeline&&timeline.policy&&timeline.policy.visibility||'PAST_AND_CURRENT').toUpperCase();if(visibility==='FULL')return scenes;if(visibility==='PAST_ONLY')return scenes.filter((s)=>end(s)<=this.playbackPosition);return scenes.filter((s)=>start(s)<=this.playbackPosition);}
    missedScenes(timeline){const ids=new Set(this._missedSceneIds);return (timeline&&timeline.scenes||[]).filter((s)=>ids.has(sceneId(s)));}
    consumeMissed(timeline){const out=this.missedScenes(timeline);this._missedSceneIds=[];return out;}
    clearMissed(){this._missedSceneIds=[];return this.snapshot();}
    snapshot(){return{mode:this.mode,playbackPosition:this.playbackPosition,browsePosition:this.browsePosition,browseSceneId:this.browseSceneId,syncConfidence:this.syncConfidence,lastSyncAt:this.lastSyncAt,missedSceneIds:[...this._missedSceneIds]};}
  }
  return{CompanionState,activeScene};
});
