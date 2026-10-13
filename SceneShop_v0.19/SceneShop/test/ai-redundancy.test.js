const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs');
const path=require('path');
const {StateAiPipelineRepository}=require('../server/repositories/ai-pipeline');

function setup({targeted=true}={}){
  const state={}; const repo=new StateAiPipelineRepository(()=>state,()=>{}); const org='org-a'; const work={id:'work-1'};
  const asset=repo.createAsset(org,{name:'Omega Seamaster',brand:'Omega',model:'Diver 300M',category:'WATCHES'},'editor').asset;
  const job=repo.createJob(org,work,targeted?{mode:'TARGETED',assetIds:[asset.id]}:{mode:'DISCOVERY',categories:['WATCHES']},'editor').job;
  repo.startJob(org,job.id);
  const cand=repo.recordPrimaryCandidate(org,job.id,{assetId:targeted?asset.id:null,name:'Steel watch',brand:'Omega',model:'Seamaster',category:'WATCHES',startSeconds:12,endSeconds:18,bestSeconds:15,confidence:.87,primaryPayload:{source:'primary'}}).candidate;
  return{state,repo,org,work,asset,job,cand};
}

test('AI redundancy: CONFIRMED is separate evidence and does not create operator flag',()=>{
  const x=setup(); const fp=x.cand.primaryFingerprint;
  const out=x.repo.recordRedundantVerification(x.org,x.cand.id,{provider:'GOOGLE_VISUAL',state:'CONFIRMED',proposedBrand:'Omega',proposedModel:'Seamaster',confidence:.94,evidence:{pageMatches:8}},'operator');
  assert.equal(out.verification.provider,'GOOGLE_VISUAL');
  assert.equal(out.flag,null);
  assert.equal(x.repo.getCandidate(x.org,x.cand.id).primaryFingerprint,fp);
  assert.deepEqual(x.repo.getCandidate(x.org,x.cand.id).primaryPayload,{source:'primary'});
});

test('AI redundancy: conflict/no-match/inconclusive produce operator flag',()=>{
  const x=setup();
  for(const state of ['CONFLICT','NO_MATCH','INCONCLUSIVE','SOURCE_UNAVAILABLE']){
    const out=x.repo.recordRedundantVerification(x.org,x.cand.id,{provider:'MANUFACTURER_CATALOG',state,evidence:{state}},'operator');
    assert.equal(out.flag.status,'OPEN');
    assert.match(out.flag.reason,/^REDUNDANCY_/);
  }
  assert.equal(x.repo.listOperatorFlags(x.org).length,4);
});

test('AI review: human approval creates placement without rewriting primary identification',()=>{
  const x=setup();const fp=x.cand.primaryFingerprint;
  const out=x.repo.reviewCandidate(x.org,x.cand.id,{decision:'APPROVE',assetId:x.asset.id,displayStartSeconds:11,displayEndSeconds:22,priority:5,note:'Approved by content owner'},'editor');
  assert.equal(out.candidate.reviewStatus,'APPROVED');
  assert.equal(out.candidate.resolvedAssetId,x.asset.id);
  assert.equal(out.candidate.primaryFingerprint,fp);
  assert.equal(out.placement.assetId,x.asset.id);
  assert.equal(out.placement.displayStartSeconds,11);
  assert.equal(x.repo.listPlacements(x.org,x.work.id).length,1);
});

test('AI review: discovery candidate can be resolved to a separately created CommercialAsset',()=>{
  const x=setup({targeted:false});
  const v=x.repo.recordRedundantVerification(x.org,x.cand.id,{provider:'GOOGLE_VISUAL',state:'NO_MATCH'},'operator');
  const discovered=x.repo.createAsset(x.org,{name:'Unknown steel chronograph',category:'WATCHES'},'editor').asset;
  const out=x.repo.resolveOperatorFlag(x.org,v.flag.id,{decision:'APPROVE',assetId:discovered.id,note:'manually identified'},'operator');
  assert.equal(out.flag.status,'RESOLVED');
  assert.equal(out.candidate.resolvedAssetId,discovered.id);
  assert.equal(out.placement.assetId,discovered.id);
});

test('AI review: rejected candidate never creates placement',()=>{
  const x=setup();
  const out=x.repo.reviewCandidate(x.org,x.cand.id,{decision:'REJECT',note:'false positive'},'editor');
  assert.equal(out.candidate.reviewStatus,'REJECTED');
  assert.equal(out.placement,null);
  assert.equal(x.repo.listPlacements(x.org).length,0);
});

test('AI redundancy migration enforces frozen primary evidence at the database layer',()=>{
  const sql=fs.readFileSync(path.join(__dirname,'..','server','data','migrations','0022_ai_redundancy_operator_review.sql'),'utf8');
  assert.match(sql,/SCENESHOP_PRIMARY_IDENTIFICATION_IMMUTABLE/);
  assert.match(sql,/trg_sceneshop_guard_frozen_primary_detection/);
  assert.match(sql,/resolved_asset_id/);
  assert.match(sql,/verification_id/);
});
