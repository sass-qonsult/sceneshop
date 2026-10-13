/* SceneShop Partner SDK v1
 * Headless commerce-sync layer. It never hosts media and does not render UI unless the partner does so.
 */
(function(root){
  'use strict';
  class SceneShopPartnerSDK extends EventTarget{
    constructor(opts={}){super();this.apiBase=String(opts.apiBase||'').replace(/\/$/,'');this.token=opts.token||null;this.video=null;this.session=null;this.timeline=null;this.tickMs=Math.max(250,Number(opts.tickMs)||1000);this._lastTick=0;this._handlers=[];this._activeSceneId=null;}
    headers(extra={}){return Object.assign({'Content-Type':'application/json','Authorization':`Bearer ${this.token}`},extra);}
    async request(path,options={}){const r=await fetch(`${this.apiBase}${path}`,{...options,headers:this.headers(options.headers||{})});const data=await r.json().catch(()=>({}));if(!r.ok)throw new Error(data.error||`SceneShop HTTP ${r.status}`);return data;}
    async loadTimeline(){this.timeline=await this.request('/api/sdk/v1/timeline');return this.timeline;}
    sceneAt(position){return(this.timeline&&this.timeline.scenes||[]).find(s=>Number(position)>=Number(s.start||0)&&Number(position)<Number(s.end||0))||null;}
    emit(name,detail){this.dispatchEvent(new CustomEvent(name,{detail}));}
    async createSession(position=0){this.session=await this.request('/api/sdk/v1/sessions',{method:'POST',body:JSON.stringify({position})});return this.session;}
    async connect(video){if(!video)throw new Error('SceneShop Partner SDK requer um elemento/player de vídeo.');this.video=video;if(!this.timeline)await this.loadTimeline();if(!this.session)await this.createSession(Number(video.currentTime)||0);const push=(force=false)=>{const now=Date.now();if(!force&&now-this._lastTick<this.tickMs)return;this._lastTick=now;this.updatePlayback({position:Number(video.currentTime)||0,playing:!video.paused}).catch(e=>this.emit('error',{error:e}));};const onTime=()=>push(false),onForce=()=>push(true);for(const [ev,fn] of [['timeupdate',onTime],['play',onForce],['pause',onForce],['seeked',onForce],['ratechange',onForce]]){video.addEventListener(ev,fn);this._handlers.push([ev,fn]);}push(true);return this;}
    async updatePlayback({position,playing}){if(!this.session)throw new Error('Sessão SDK não iniciada.');const out=await this.request(`/api/sdk/v1/sessions/${encodeURIComponent(this.session.code)}/playback`,{method:'POST',body:JSON.stringify({position,playing})});const scene=out.activeScene||this.sceneAt(position);const id=scene&&scene.sceneId||null;if(id!==this._activeSceneId){this._activeSceneId=id;this.emit('commercechange',{scene,products:scene&&scene.products||[],position:Number(position)||0,session:out});}this.emit('playback',{position:Number(position)||0,playing:!!playing,scene});return out;}
    async resolveProduct({productId,assetId,placementId,campaignId,territory='GLOBAL',deviceId}){if(!this.timeline)await this.loadTimeline();return this.request('/api/commerce/resolve',{method:'POST',headers:{Authorization:''},body:JSON.stringify({workId:this.timeline.workId,productId,assetId,placementId,campaignId,territory,deviceId})});}
    disconnect(){if(this.video){for(const [ev,fn] of this._handlers)this.video.removeEventListener(ev,fn);}this._handlers=[];this.video=null;}
  }
  root.SceneShopPartner={create:(opts)=>new SceneShopPartnerSDK(opts),SceneShopPartnerSDK};
})(typeof globalThis!=='undefined'?globalThis:this);
