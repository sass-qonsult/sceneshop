const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs');
const path=require('path');
const {StateAiPipelineRepository}=require('../server/repositories/ai-pipeline');

function fixture(){const state={};let saves=0;return{state,repo:new StateAiPipelineRepository(()=>state,()=>{saves++;}),saves:()=>saves};}
const work={id:'work-1',title:'Film',duration:120};

test('AI pipeline: governed commercial asset with visual references',()=>{
  const f=fixture();
  const a=f.repo.createAsset('org-a',{name:'Omega Seamaster',brand:'Omega',model:'Diver 300M',category:'WATCHES'},'editor');
  assert.ok(a.asset.id.startsWith('asset-'));
  const ref=f.repo.addReference('org-a',a.asset.id,{mediaType:'IMAGE',uri:'/uploads/omega-front.jpg',angle:'front'});
  assert.equal(ref.reference.assetId,a.asset.id);
  assert.equal(f.repo.listAssets('org-a')[0].references.length,1);
  assert.equal(f.repo.listAssets('org-b').length,0);
});

test('AI pipeline: TARGETED, DISCOVERY and HYBRID enforce different inputs',()=>{
  const f=fixture();
  const asset=f.repo.createAsset('org-a',{name:'Aston Martin DB12',category:'VEHICLES'},'editor').asset;
  let r=f.repo.createJob('org-a',work,{mode:'TARGETED',assetIds:[],scanDepth:'STANDARD'},'editor');
  assert.ok(r.errors);
  r=f.repo.createJob('org-a',work,{mode:'TARGETED',assetIds:[asset.id],scanDepth:'STANDARD'},'editor');
  assert.equal(r.job.mode,'TARGETED');
  r=f.repo.createJob('org-a',work,{mode:'DISCOVERY',assetIds:[asset.id],categories:['WATCHES']},'editor');
  assert.ok(r.errors);
  r=f.repo.createJob('org-a',work,{mode:'DISCOVERY',categories:['WATCHES','VEHICLES'],scanDepth:'DEEP'},'editor');
  assert.deepEqual(r.job.requestedCategories,['WATCHES','VEHICLES']);
  r=f.repo.createJob('org-a',work,{mode:'HYBRID',assetIds:[asset.id],categories:['FASHION']},'editor');
  assert.equal(r.job.mode,'HYBRID');
});

test('AI pipeline: primary detection is frozen with auditable fingerprint',()=>{
  const f=fixture();
  const asset=f.repo.createAsset('org-a',{name:'Tom Ford Tuxedo',category:'APPAREL'},'editor').asset;
  const j=f.repo.createJob('org-a',work,{mode:'TARGETED',assetIds:[asset.id]},'editor').job;
  f.repo.startJob('org-a',j.id);
  const r=f.repo.recordPrimaryCandidate('org-a',j.id,{assetId:asset.id,name:'Black tuxedo',brand:'Tom Ford',model:'Windsor',category:'APPAREL',startSeconds:20,endSeconds:34,bestSeconds:27,confidence:.91,box2d:{x:20,y:10,w:35,h:70},primaryPayload:{visibleText:'TOM FORD'}});
  assert.match(r.candidate.primaryFingerprint,/^[a-f0-9]{64}$/);
  assert.ok(r.candidate.primaryFrozenAt);
  assert.equal(r.candidate.reviewStatus,'DETECTED');
  const again=f.repo.getCandidate('org-a',r.candidate.id);
  assert.equal(again.primaryFingerprint,r.candidate.primaryFingerprint);
  assert.equal(f.repo.getCandidate('org-b',r.candidate.id),null);
});

test('AI pipeline migration adds operational targeted inventory and immutable primary fields',()=>{
  const sql=fs.readFileSync(path.join(__dirname,'..','server','data','migrations','0021_ai_pipeline_operational.sql'),'utf8');
  assert.match(sql,/sceneshop_analysis_job_assets/);
  assert.match(sql,/primary_fingerprint/);
  assert.match(sql,/config_sha256/);
});
