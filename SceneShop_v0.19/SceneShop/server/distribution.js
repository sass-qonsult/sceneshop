const express=require('express');
const {distribution,content,playback}=require('./repositories');
const sessions=require('./sessions');
const tracks=require('./tracks');
const audit=require('./audit');
const {parseExternalUrl}=require('./distribution/platforms');
const sdkTokens=require('./distribution/tokens');
const acr=require('./acr');

const actor=req=>req.user?req.user.username:'integration';
const reply=(res,r,ok=200)=>{const {code,...body}=r||{};res.status(r&&(r.error||r.errors)?(code||400):ok).json(body);};
function timelineForPosition(timeline,policy,position){
  if(!timeline)return null; const p=policy||timeline.policy||{visibility:'PAST_AND_CURRENT'};let scenes=timeline.scenes||[];
  if(position!==undefined&&position!==null&&position!==''){const pos=Math.max(0,Number(position)||0);if(p.visibility==='PAST_ONLY')scenes=scenes.filter(s=>Number(s.end||0)<=pos);else if(p.visibility==='PAST_AND_CURRENT')scenes=scenes.filter(s=>Number(s.start||0)<=pos);}
  return{...timeline,policy:p,scenes};
}
function sdkBearer(req){const h=String(req.headers.authorization||'');return h.startsWith('Bearer ')?sdkTokens.verify(h.slice(7)):null;}
function hasScope(p,scope){return !!p&&Array.isArray(p.scopes)&&p.scopes.includes(scope);}

function routes({requireRole,orgAccess,antifraud,io}){
  const r=express.Router();
  // --------------------------- Studio / owner control plane
  r.get('/api/distribution/bindings',requireRole(),orgAccess.requireCapability('CONTENT_READ'),async(req,res,next)=>{try{res.json(await Promise.resolve(distribution.listBindings(req.organization.id,req.query.workId||null)));}catch(e){next(e);}});
  r.post('/api/distribution/bindings',requireRole(),orgAccess.requireCapability('CONTENT_WRITE'),async(req,res,next)=>{try{const b=req.body||{};const work=await Promise.resolve(content.getWorkForOrganizationAuthoritative(b.workId,req.organization.id));if(!work)return res.status(404).json({error:'Obra não encontrada nesta organização.'});const out=await Promise.resolve(distribution.createBinding(req.organization.id,b,actor(req)));if(out.binding)audit.log(actor(req),'distribution_binding_created',{organizationId:req.organization.id,bindingId:out.binding.id,workId:b.workId,platform:out.binding.platform,mode:out.binding.mode});reply(res,out,201);}catch(e){next(e);}});
  r.patch('/api/distribution/bindings/:id',requireRole(),orgAccess.requireCapability('CONTENT_WRITE'),async(req,res,next)=>{try{const out=await Promise.resolve(distribution.updateBinding(req.organization.id,req.params.id,req.body||{}));reply(res,out);}catch(e){next(e);}});
  r.get('/api/distribution/platform-connections',requireRole(),orgAccess.requireCapability('CONTENT_READ'),async(req,res,next)=>{try{res.json(await Promise.resolve(distribution.listPlatformConnections(req.organization.id)));}catch(e){next(e);}});
  r.post('/api/distribution/platform-connections',requireRole(),orgAccess.requireCapability('ORG_SETTINGS',{strong:true}),async(req,res,next)=>{try{const out=await Promise.resolve(distribution.createPlatformConnection(req.organization.id,req.body||{},actor(req)));if(out.connection)audit.log(actor(req),'distribution_platform_connection_created',{organizationId:req.organization.id,connectionId:out.connection.id,platform:out.connection.platform});reply(res,out,201);}catch(e){next(e);}});
  r.patch('/api/distribution/platform-connections/:id',requireRole(),orgAccess.requireCapability('ORG_SETTINGS',{strong:true}),async(req,res,next)=>{try{const out=await Promise.resolve(distribution.updatePlatformConnection(req.organization.id,req.params.id,req.body||{}));if(out.connection)audit.log(actor(req),'distribution_platform_connection_updated',{organizationId:req.organization.id,connectionId:out.connection.id,status:out.connection.status});reply(res,out);}catch(e){next(e);}});
  r.post('/api/distribution/bindings/:id/refresh',requireRole(),orgAccess.requireCapability('CONTENT_WRITE'),async(req,res,next)=>{try{const out=await Promise.resolve(distribution.refreshBindingMetadata(req.organization.id,req.params.id));if(out.binding)audit.log(actor(req),'distribution_binding_metadata_refreshed',{organizationId:req.organization.id,bindingId:out.binding.id,platform:out.binding.platform});reply(res,out);}catch(e){next(e);}});
  r.get('/api/distribution/works/:workId/timeline-policy',requireRole(),orgAccess.requireCapability('CONTENT_READ'),async(req,res,next)=>{try{const work=await Promise.resolve(content.getWorkForOrganizationAuthoritative(req.params.workId,req.organization.id));if(!work)return res.status(404).json({error:'Obra não encontrada.'});res.json(await Promise.resolve(distribution.getTimelinePolicy(work.id)));}catch(e){next(e);}});
  r.put('/api/distribution/works/:workId/timeline-policy',requireRole(),orgAccess.requireCapability('CONTENT_WRITE'),async(req,res,next)=>{try{const out=await Promise.resolve(distribution.setTimelinePolicy(req.organization.id,req.params.workId,req.body||{}));reply(res,out);}catch(e){next(e);}});
  r.post('/api/distribution/works/:workId/sync-index',requireRole(),orgAccess.requireCapability('CONTENT_WRITE'),async(req,res,next)=>{try{const work=await Promise.resolve(content.getWorkForOrganizationAuthoritative(req.params.workId,req.organization.id));if(!work)return res.status(404).json({error:'Obra não encontrada.'});const out=await Promise.resolve(distribution.importSyncIndex(req.organization.id,work,req.body||{},actor(req)));if(out.build)audit.log(actor(req),'sync_index_published',{organizationId:req.organization.id,workId:work.id,buildId:out.build.id,windows:out.build.windowCount});reply(res,out,201);}catch(e){next(e);}});
  r.get('/api/distribution/sdk-keys',requireRole(),orgAccess.requireCapability('ORG_SETTINGS'),async(req,res,next)=>{try{res.json(await Promise.resolve(distribution.listSdkKeys(req.organization.id)));}catch(e){next(e);}});
  r.post('/api/distribution/sdk-keys',requireRole(),orgAccess.requireCapability('ORG_SETTINGS',{strong:true}),async(req,res,next)=>{try{const out=await Promise.resolve(distribution.createSdkKey(req.organization.id,req.body||{},actor(req)));if(out.key)audit.log(actor(req),'distribution_sdk_key_created',{organizationId:req.organization.id,keyId:out.key.id});reply(res,out,201);}catch(e){next(e);}});
  r.delete('/api/distribution/sdk-keys/:id',requireRole(),orgAccess.requireCapability('ORG_SETTINGS',{strong:true}),async(req,res,next)=>{try{const out=await Promise.resolve(distribution.revokeSdkKey(req.organization.id,req.params.id));reply(res,out);}catch(e){next(e);}});

  // --------------------------- Partner server-to-server: exchange long-lived key for short browser token.
  r.post('/api/sdk/v1/token',async(req,res,next)=>{try{const raw=String(req.headers['x-sceneshop-sdk-key']||'');const key=await Promise.resolve(distribution.authenticateSdkKey(raw));if(!key)return res.status(401).json({error:'SDK_KEY_INVALID'});const binding=await Promise.resolve(distribution.getBinding((req.body||{}).bindingId));if(!binding||binding.organizationId!==key.organizationId||!binding.enabled)return res.status(404).json({error:'BINDING_NOT_FOUND'});const work=await Promise.resolve(content.getWorkAuthoritative(binding.workId));if(!work)return res.status(404).json({error:'WORK_NOT_FOUND'});const token=sdkTokens.issueSdkToken({organizationId:key.organizationId,workId:work.id,bindingId:binding.id,mode:binding.mode,scopes:key.scopes});res.json({token,expiresIn:900,work:{id:work.id,title:work.title,duration:work.duration,syncId:work.syncId},binding});}catch(e){next(e);}});

  // --------------------------- Browser/player SDK data plane.
  r.get('/api/sdk/v1/timeline',async(req,res,next)=>{try{const p=sdkBearer(req);if(!hasScope(p,'timeline:read'))return res.status(401).json({error:'SDK_TOKEN_INVALID'});const timeline=await Promise.resolve(content.getPublishedTimeline(p.workId));if(!timeline)return res.status(404).json({error:'COMMERCE_TRACK_NOT_FOUND'});const policy=await Promise.resolve(distribution.getTimelinePolicy(p.workId));res.json(timelineForPosition(timeline,policy,req.query.position));}catch(e){next(e);}});
  r.post('/api/sdk/v1/sessions',async(req,res,next)=>{try{const p=sdkBearer(req);if(!hasScope(p,'playback:write'))return res.status(401).json({error:'SDK_TOKEN_INVALID'});const binding=await Promise.resolve(distribution.getBinding(p.bindingId));if(!binding||binding.workId!==p.workId||binding.organizationId!==p.organizationId)return res.status(401).json({error:'SDK_BINDING_INVALID'});const track=await tracks.pickAuthoritative(p.workId,null);const position=Math.max(0,Number((req.body||{}).position)||0);const s=await Promise.resolve(sessions.create(p.workId,position,track&&track.id,{mode:p.mode,bindingId:p.bindingId}));const current=await Promise.resolve(sessions.get(s.code));await playback.createSession(current);await Promise.resolve(distribution.recordEvent({organizationId:p.organizationId,workId:p.workId,bindingId:p.bindingId,sessionId:current.code,eventType:'SDK_SESSION_CREATED',positionSeconds:position,metadata:{mode:p.mode}}));res.status(201).json({...sessions.publicView(current)});}catch(e){next(e);}});
  r.post('/api/sdk/v1/sessions/:code/playback',async(req,res,next)=>{try{const p=sdkBearer(req);if(!hasScope(p,'playback:write'))return res.status(401).json({error:'SDK_TOKEN_INVALID'});const s=await Promise.resolve(sessions.get(req.params.code));if(!s||s.workId!==p.workId||s.bindingId!==p.bindingId)return res.status(404).json({error:'SESSION_NOT_FOUND'});const work=await Promise.resolve(content.getWorkAuthoritative(p.workId));const position=Math.max(0,Math.min(Number(work.duration||Infinity),Number((req.body||{}).position)||0));const timeline=await Promise.resolve(content.getPublishedTimeline(p.workId));const scene=(timeline&&timeline.scenes||[]).find(sc=>position>=Number(sc.start||0)&&position<Number(sc.end||0));const updated=await Promise.resolve(sessions.updatePlayback(s.code,{time:position,playing:!!(req.body||{}).playing,sceneId:scene?scene.sceneId:null}));await playback.checkpoint(updated);if(io){io.to(s.code).emit('player:tick',{time:updated.playbackPosition,playing:updated.playing});if(scene&&scene.sceneId!==s.sceneId)io.to(s.code).emit('scene:change',{sceneId:scene.sceneId});}res.json({...sessions.publicView(updated),activeScene:scene||null});}catch(e){next(e);}});

  // --------------------------- Companion recognition / sync.
  async function recognizeBody(body){let workId=body.workId||null,binding=null;if(body.externalUrl){const parsed=parseExternalUrl(body.externalUrl);if(parsed&&parsed.externalContentId){binding=await Promise.resolve(distribution.findBindingByExternal(parsed.platform,parsed.externalContentId));if(binding)workId=binding.workId;}}const ranked=await Promise.resolve(distribution.recognize(body.samples||[],{workId}));const best=ranked[0];if(!best||best.matched<2||best.confidence<0.22)return null;const work=await Promise.resolve(content.getWorkAuthoritative(best.workId));if(!work)return null;const bindings=await Promise.resolve(distribution.listBindingsForWork(work.id));return{work:{id:work.id,title:work.title,duration:work.duration,syncId:work.syncId},position:best.position,confidence:best.confidence,matched:best.matched,total:best.total,binding:binding||null,bindings:bindings.map(b=>({id:b.id,mode:b.mode,platform:b.platform,externalContentId:b.externalContentId,canonicalUrl:b.canonicalUrl,officialOwnerUrl:b.officialOwnerUrl,label:b.label}))};}
  r.post('/api/sync/recognize',antifraud.rateLimit('verify'),async(req,res,next)=>{try{const out=await recognizeBody(req.body||{});out?res.json(out):res.status(404).json({error:'SYNC_NOT_RECOGNIZED'});}catch(e){next(e);}});
  async function startCompanion(out,source,metadata){const preferred=out.binding || out.bindings.find(b=>b.mode==='COMPANION') || null;const track=await tracks.pickAuthoritative(out.work.id,null);const s=await Promise.resolve(sessions.create(out.work.id,out.position,track&&track.id,{mode:'COMPANION',bindingId:preferred&&preferred.id,syncConfidence:out.confidence,lastSyncAt:Date.now()}));const current=await Promise.resolve(sessions.get(s.code));await playback.createSession(current);await playback.recordSync(current,{source,recognizedSyncId:out.work.syncId,position:out.position,confidence:out.confidence,...(metadata?{metadata}:{})});return{...out,session:sessions.publicView(current)};}
  r.post('/api/sync/start',antifraud.rateLimit('verify'),async(req,res,next)=>{try{const out=await recognizeBody(req.body||{});if(!out)return res.status(404).json({error:'SYNC_NOT_RECOGNIZED'});res.status(201).json(await startCompanion(out,'AUDIO_FINGERPRINT'));}catch(e){next(e);}});

  // --------------------------- Reconhecimento pela ACRCloud: o celular manda ~10 s de áudio (WAV), que não é guardado.
  const acrAudio=express.raw({type:()=>true,limit:'3mb'});
  async function recognizeAcr(req){
    const buf=Buffer.isBuffer(req.body)?req.body:Buffer.alloc(0);
    if(buf.length<4000)return{error:'SYNC_SAMPLE_TOO_SHORT',code:400};
    const mime=String(req.headers['content-type']||'audio/wav').split(';')[0];
    const result=await acr.identify(buf,mime);
    for(const m of result.matches){
      const work=await Promise.resolve(content.getWorkAuthoritative(m.workId));
      if(!work)continue;
      const bindings=await Promise.resolve(distribution.listBindingsForWork(work.id));
      const max=Number(work.duration)>0?Number(work.duration):Number.MAX_SAFE_INTEGER;
      // play_offset_ms marca o fim da amostra; somamos o tempo da consulta para chegar ao "agora".
      const position=Math.min(max,Math.max(0,(m.offsetSeconds||0)+(result.latencySeconds||0)));
      return{out:{work:{id:work.id,title:work.title,duration:work.duration,syncId:work.syncId},position,confidence:Math.max(0,Math.min(1,m.score/100)),provider:'acrcloud',acrid:m.acrid,binding:null,bindings:bindings.map(b=>({id:b.id,mode:b.mode,platform:b.platform,externalContentId:b.externalContentId,canonicalUrl:b.canonicalUrl,officialOwnerUrl:b.officialOwnerUrl,label:b.label}))}};
    }
    return{error:'SYNC_NOT_RECOGNIZED',code:404};
  }
  const acrRoute=(start)=>async(req,res,next)=>{try{
    if(!acr.identifyConfigured())return res.status(503).json({error:'ACR_NOT_CONFIGURED'});
    const r0=await recognizeAcr(req);if(r0.error)return res.status(r0.code).json({error:r0.error});
    res.status(start?201:200).json(start?await startCompanion(r0.out,'ACRCLOUD',{provider:'acrcloud',acrid:r0.out.acrid||null}):r0.out);
  }catch(e){if(e.acrCode||/ACRCloud/.test(e.message)){console.error('[acr]',e.message);return res.status(502).json({error:'ACR_UNAVAILABLE'});}next(e);}};
  r.post('/api/sync/acr/recognize',antifraud.rateLimit('verify'),acrAudio,acrRoute(false));
  r.post('/api/sync/acr/start',antifraud.rateLimit('verify'),acrAudio,acrRoute(true));

  return r;
}
module.exports={routes,timelineForPosition};
