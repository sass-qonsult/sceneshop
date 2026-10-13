const crypto = require('crypto');
const now = () => Date.now();
const uuid = (p) => `${p}-${crypto.randomUUID()}`;
const MODES = new Set(['TARGETED','DISCOVERY','HYBRID']);
const DEPTHS = new Set(['FAST','STANDARD','DEEP']);
const CATEGORIES = new Set(['FASHION','APPAREL','FOOTWEAR','WATCHES','JEWELRY','VEHICLES','ELECTRONICS','FURNITURE','HOME_DECOR','COSMETICS','FOOD_BEVERAGE','SPORTS','TRAVEL_HOSPITALITY','ACCESSORIES','OTHER','ALL']);
const sha = (v) => crypto.createHash('sha256').update(typeof v === 'string' ? v : JSON.stringify(v)).digest('hex');
const clone = (v) => v == null ? v : JSON.parse(JSON.stringify(v));
const {normalizeVerification,requiresOperatorFlag,flagReason}=require('../ai/redundancy');

function ensure(s){
  s.aiCommercialAssets ||= {};
  s.aiAssetReferences ||= {};
  s.aiAnalysisJobs ||= {};
  s.aiJobAssets ||= {};
  s.aiDetectionCandidates ||= {};
  s.aiRedundantVerifications ||= {};
  s.aiOperatorFlags ||= {};
  s.aiPlacements ||= {};
}
function normalizeMode(v){ const m=String(v||'TARGETED').toUpperCase(); return MODES.has(m)?m:null; }
function normalizeDepth(v){ const d=String(v||'STANDARD').toUpperCase(); return DEPTHS.has(d)?d:null; }
function normalizeCategories(v){
  const arr=Array.isArray(v)?v:[];
  return [...new Set(arr.map(x=>String(x||'').trim().toUpperCase()).filter(x=>CATEGORIES.has(x)))];
}
function publicAsset(a, refs=[]){ return {...clone(a), references: refs.map(clone)}; }

class StateAiPipelineRepository {
  constructor(getState,save){ this.getState=getState; this.save=save; }
  S(){ const s=this.getState(); ensure(s); return s; }
  listAssets(orgId){ const s=this.S(); return Object.values(s.aiCommercialAssets).filter(a=>a.organizationId===orgId).map(a=>publicAsset(a,Object.values(s.aiAssetReferences).filter(r=>r.assetId===a.id))).sort((a,b)=>b.updatedAt-a.updatedAt); }
  getAsset(orgId,id){ const s=this.S(),a=s.aiCommercialAssets[id]; return a&&a.organizationId===orgId?publicAsset(a,Object.values(s.aiAssetReferences).filter(r=>r.assetId===id)):null; }
  createAsset(orgId,body,actor){
    const name=String(body.name||'').trim(); if(!name)return{errors:['name é obrigatório.']};
    const row={id:uuid('asset'),organizationId:orgId,productId:body.productId||null,ownerId:body.ownerId||null,brand:String(body.brand||'').trim()||null,model:String(body.model||'').trim()||null,name:name.slice(0,180),category:String(body.category||'OTHER').trim().toUpperCase(),description:String(body.description||'').slice(0,1200),sku:String(body.sku||'').trim()||null,status:'DRAFT',metadata:{...(body.metadata||{})},createdBy:actor,createdAt:now(),updatedAt:now()};
    this.S().aiCommercialAssets[row.id]=row; this.save(); return{asset:publicAsset(row)};
  }
  addReference(orgId,assetId,body){ const s=this.S(),a=s.aiCommercialAssets[assetId]; if(!a||a.organizationId!==orgId)return{error:'Ativo comercial não encontrado.',code:404}; const uri=String(body.uri||'').trim();if(!uri)return{errors:['uri é obrigatório.']}; const mediaType=String(body.mediaType||'IMAGE').toUpperCase();if(!['IMAGE','VIDEO','CATALOG','DATASHEET'].includes(mediaType))return{errors:['mediaType inválido.']}; const row={id:uuid('assetref'),assetId,mediaType,uri,angle:String(body.angle||'').trim()||null,sha256:body.sha256||null,status:'ACTIVE',metadata:{...(body.metadata||{})},createdAt:now()};s.aiAssetReferences[row.id]=row;this.save();return{reference:clone(row)}; }
  createJob(orgId,work,body,actor){
    const mode=normalizeMode(body.mode),scanDepth=normalizeDepth(body.scanDepth); if(!mode)return{errors:['mode inválido.']}; if(!scanDepth)return{errors:['scanDepth inválido.']};
    const categories=normalizeCategories(body.categories); const assetIds=[...new Set((body.assetIds||[]).map(String))]; const s=this.S();
    const invalid=assetIds.filter(id=>!s.aiCommercialAssets[id]||s.aiCommercialAssets[id].organizationId!==orgId); if(invalid.length)return{errors:['Há ativos comerciais inválidos para esta organização.']};
    if(mode==='TARGETED'&&!assetIds.length)return{errors:['TARGETED exige ao menos um assetId.']};
    if(mode==='DISCOVERY'&&assetIds.length)return{errors:['DISCOVERY não recebe assetIds; use HYBRID.']};
    if(mode==='HYBRID'&&!assetIds.length)return{errors:['HYBRID exige ao menos um assetId.']};
    const config={mode,scanDepth,categories,assetIds,minimumConfidence:Number(body.minimumConfidence??0.5),includeBackground:!!body.includeBackground,minimumScreenSeconds:Number(body.minimumScreenSeconds??0)};
    const row={id:uuid('aijob'),organizationId:orgId,workId:work.id,mode,requestedCategories:categories,scanDepth,status:'QUEUED',requestedBy:actor,config,configSha256:sha(config),primaryProvider:String(body.primaryProvider||'SCENESHOP_GEMINI').toUpperCase(),engineVersion:String(body.engineVersion||'v0.14-alpha.1'),createdAt:now(),startedAt:null,finishedAt:null,errorMessage:null};
    s.aiAnalysisJobs[row.id]=row;s.aiJobAssets[row.id]=assetIds.map(assetId=>({analysisJobId:row.id,assetId,required:true}));this.save();return{job:clone(row)};
  }
  getJob(orgId,id){ const s=this.S(),j=s.aiAnalysisJobs[id];if(!j||j.organizationId!==orgId)return null;return{...clone(j),assetIds:(s.aiJobAssets[id]||[]).map(x=>x.assetId)}; }
  listJobs(orgId,workId=null){ return Object.values(this.S().aiAnalysisJobs).filter(j=>j.organizationId===orgId&&(!workId||j.workId===workId)).sort((a,b)=>b.createdAt-a.createdAt).map(clone); }
  startJob(orgId,id){ const j=this.S().aiAnalysisJobs[id];if(!j||j.organizationId!==orgId)return{error:'Job não encontrado.',code:404};if(j.status!=='QUEUED')return{errors:['Job não está QUEUED.']};j.status='RUNNING';j.startedAt=now();this.save();return{job:clone(j)}; }
  failJob(orgId,id,error){ const j=this.S().aiAnalysisJobs[id];if(!j||j.organizationId!==orgId)return{error:'Job não encontrado.',code:404};j.status='FAILED';j.errorMessage=String(error||'Falha').slice(0,1000);j.finishedAt=now();this.save();return{job:clone(j)}; }
  completeJob(orgId,id){ const j=this.S().aiAnalysisJobs[id];if(!j||j.organizationId!==orgId)return{error:'Job não encontrado.',code:404};j.status='COMPLETED';j.finishedAt=now();this.save();return{job:clone(j)}; }
  recordPrimaryCandidate(orgId,jobId,input){
    const s=this.S(),j=s.aiAnalysisJobs[jobId];if(!j||j.organizationId!==orgId)return{error:'Job não encontrado.',code:404};if(!['RUNNING','COMPLETED'].includes(j.status))return{errors:['Job precisa estar RUNNING/COMPLETED.']};
    const assetId=input.assetId||null;if(assetId&&(!s.aiCommercialAssets[assetId]||s.aiCommercialAssets[assetId].organizationId!==orgId))return{errors:['assetId inválido.']};
    const start=Number(input.startSeconds),end=Number(input.endSeconds),best=input.bestSeconds==null?start:Number(input.bestSeconds);if(!Number.isFinite(start)||!Number.isFinite(end)||end<start)return{errors:['Intervalo temporal inválido.']};
    const primaryPayload=clone(input.primaryPayload||{}); const fingerprint=sha({assetId,name:input.name||null,brand:input.brand||null,model:input.model||null,start,end,best,confidence:Number(input.confidence||0),primaryPayload});
    const row={id:uuid('cand'),analysisJobId:jobId,organizationId:orgId,assetId,category:String(input.category||'OTHER').toUpperCase(),candidateName:String(input.name||'').slice(0,180)||null,candidateDescription:String(input.description||'').slice(0,1200)||null,proposedBrand:String(input.brand||'').slice(0,160)||null,proposedModel:String(input.model||'').slice(0,160)||null,startSeconds:start,endSeconds:end,bestSeconds:best,box2d:clone(input.box2d||null),primaryConfidence:Math.max(0,Math.min(1,Number(input.confidence||0))),primaryPayload,primaryFrozenAt:now(),primaryFingerprint:fingerprint,reviewStatus:'DETECTED',createdAt:now()};
    s.aiDetectionCandidates[row.id]=row;this.save();return{candidate:clone(row)};
  }
  recordPrimaryBatch(orgId,jobId,items){ const out=[];for(const item of items||[]){const r=this.recordPrimaryCandidate(orgId,jobId,item);if(r.errors||r.error)return r;out.push(r.candidate);}return{candidates:out}; }
  listCandidates(orgId,jobId=null){ return Object.values(this.S().aiDetectionCandidates).filter(c=>c.organizationId===orgId&&(!jobId||c.analysisJobId===jobId)).sort((a,b)=>a.startSeconds-b.startSeconds).map(clone); }
  getCandidate(orgId,id){ const c=this.S().aiDetectionCandidates[id];return c&&c.organizationId===orgId?clone(c):null; }
  recordRedundantVerification(orgId,candidateId,input,actor){
    const s=this.S(),c=s.aiDetectionCandidates[candidateId];if(!c||c.organizationId!==orgId)return{error:'Candidato não encontrado.',code:404};
    if(!c.primaryFrozenAt||!c.primaryFingerprint)return{errors:['Identificação primária ainda não foi congelada.']};
    const n=normalizeVerification(input);if(n.errors)return n;const v={id:uuid('verify'),candidateId,organizationId:orgId,...n.verification,checkedBy:actor,checkedAt:now()};s.aiRedundantVerifications[v.id]=v;
    let flag=null;if(requiresOperatorFlag(v.state)){flag={id:uuid('flag'),candidateId,organizationId:orgId,verificationId:v.id,reason:flagReason(v),status:'OPEN',assignedTo:null,createdAt:now(),updatedAt:now(),resolvedAt:null,resolution:{}};s.aiOperatorFlags[flag.id]=flag;}
    this.save();return{verification:clone(v),flag:clone(flag),primaryFingerprint:c.primaryFingerprint};
  }
  listVerifications(orgId,candidateId){return Object.values(this.S().aiRedundantVerifications).filter(v=>v.organizationId===orgId&&(!candidateId||v.candidateId===candidateId)).sort((a,b)=>b.checkedAt-a.checkedAt).map(clone);}
  listOperatorFlags(orgId,status='OPEN'){const st=status?String(status).toUpperCase():null;return Object.values(this.S().aiOperatorFlags).filter(f=>f.organizationId===orgId&&(!st||f.status===st)).sort((a,b)=>b.createdAt-a.createdAt).map(clone);}
  reviewCandidate(orgId,candidateId,body,actor){
    const s=this.S(),c=s.aiDetectionCandidates[candidateId];if(!c||c.organizationId!==orgId)return{error:'Candidato não encontrado.',code:404};const decision=String(body.decision||'').toUpperCase();if(!['APPROVE','REJECT'].includes(decision))return{errors:['decision deve ser APPROVE ou REJECT.']};
    const primaryFingerprint=c.primaryFingerprint;let placement=null;
    if(decision==='APPROVE'){
      const resolvedAssetId=String(body.assetId||c.assetId||'').trim();const a=s.aiCommercialAssets[resolvedAssetId];if(!a||a.organizationId!==orgId)return{errors:['A aprovação exige um CommercialAsset válido desta organização.']};
      const job=s.aiAnalysisJobs[c.analysisJobId];if(!job)return{errors:['Job de origem não encontrado.']};c.resolvedAssetId=resolvedAssetId;c.reviewStatus='APPROVED';
      placement={id:uuid('placement'),organizationId:orgId,workId:job.workId,assetId:resolvedAssetId,sourceCandidateId:c.id,physicalStartSeconds:c.startSeconds,physicalEndSeconds:c.endSeconds,displayStartSeconds:Number(body.displayStartSeconds??c.startSeconds),displayEndSeconds:Number(body.displayEndSeconds??c.endSeconds),status:'APPROVED',priority:Number(body.priority||0),policy:{...(body.policy||{})},approvedBy:actor,approvedAt:now(),createdAt:now()};
      if(placement.displayEndSeconds<placement.displayStartSeconds)return{errors:['Janela comercial inválida.']};s.aiPlacements[placement.id]=placement;
    }else{c.reviewStatus='REJECTED';c.resolvedAssetId=null;}
    c.reviewedBy=actor;c.reviewedAt=now();c.reviewNote=String(body.note||'').slice(0,1000)||null;
    if(c.primaryFingerprint!==primaryFingerprint)throw new Error('PRIMARY_IDENTIFICATION_MUTATED');
    this.save();return{candidate:clone(c),placement:clone(placement)};
  }
  resolveOperatorFlag(orgId,flagId,body,actor){const s=this.S(),f=s.aiOperatorFlags[flagId];if(!f||f.organizationId!==orgId)return{error:'Flag não encontrado.',code:404};if(f.status!=='OPEN')return{errors:['Flag já foi resolvido.']};const reviewed=this.reviewCandidate(orgId,f.candidateId,body,actor);if(reviewed.error||reviewed.errors)return reviewed;f.status='RESOLVED';f.resolvedAt=now();f.updatedAt=now();f.resolution={decision:String(body.decision||'').toUpperCase(),note:String(body.note||'').slice(0,1000)||null,assetId:reviewed.candidate.resolvedAssetId||null,placementId:reviewed.placement&&reviewed.placement.id||null,resolvedBy:actor};this.save();return{flag:clone(f),...reviewed};}
  listPlacements(orgId,workId=null){return Object.values(this.S().aiPlacements).filter(p=>p.organizationId===orgId&&(!workId||p.workId===workId)).sort((a,b)=>a.displayStartSeconds-b.displayStartSeconds).map(clone);}
}
module.exports={StateAiPipelineRepository,normalizeMode,normalizeDepth,normalizeCategories,sha};
