const test=require('node:test');
const assert=require('node:assert/strict');
process.env.SCENESHOP_MEMORY='1';
const store=require('../server/store');
const {privacy}=require('../server/repositories');
const httpSecurity=require('../server/security/http');
const {hashDevice}=require('../server/privacy');

test.beforeEach(()=>store.useMemory(true));

test('privacy preferences default to analytics/personalization on and marketing off',async()=>{
  const p=await privacy.getUser('ana');
  assert.equal(p.analytics,true);assert.equal(p.personalization,true);assert.equal(p.marketing,false);
});

test('privacy preferences and DSAR requests are persisted per user',async()=>{
  const p=await privacy.setUser('ana',{analytics:false,personalization:false,marketing:true,policyVersion:'2'});
  assert.equal(p.analytics,false);assert.equal(p.marketing,true);assert.equal(p.policyVersion,'2');
  const r=await privacy.createRequest('ana',{type:'EXPORT'});
  assert.equal(r.request.type,'EXPORT');
  assert.equal((await privacy.listRequests('ana')).length,1);
});

test('device consent stores only a hashable anonymous subject identifier',async()=>{
  const hash=hashDevice('mobile-device-1234');
  assert.match(hash,/^[a-f0-9]{64}$/);
  const p=await privacy.setDevice(hash,{analytics:false,personalization:true,marketing:false});
  assert.equal(p.subjectId,hash);assert.equal(JSON.stringify(store.state.privacyPreferences).includes('mobile-device-1234'),false);
});

test('retention policy is bounded and keeps long-lived audit/financial classes',async()=>{
  const out=await privacy.setRetention('org-demo-produtora',{viewerDays:0,syncDays:9999,activationDays:1,auditDays:2,financialDays:99999},'produtora');
  assert.equal(out.policy.viewerDays,1);assert.equal(out.policy.syncDays,365);assert.equal(out.policy.activationDays,30);assert.equal(out.policy.auditDays,365);assert.equal(out.policy.financialDays,3650);
});

test('HTTP security middleware emits request id, CSP and partner SDK cross-origin resource policy',()=>{
  const headers={};const req={headers:{},path:'/js/sceneshop-partner-sdk.js',secure:false};const res={setHeader:(k,v)=>headers[k]=v};
  let next=false;httpSecurity.middleware(req,res,()=>next=true);
  assert.equal(next,true);assert.ok(req.requestId);assert.equal(headers['X-Request-Id'],req.requestId);assert.match(headers['Content-Security-Policy'],/default-src 'self'/);assert.equal(headers['Cross-Origin-Resource-Policy'],'cross-origin');assert.equal(headers['Access-Control-Allow-Origin'],'*');
});

test('HTTP security middleware preserves a valid correlation id and rejects malformed one',()=>{
  const mk=(id)=>{const h={};const req={headers:{'x-request-id':id},path:'/api/test',secure:false};httpSecurity.middleware(req,{setHeader:(k,v)=>h[k]=v},()=>{});return{req,h};};
  assert.equal(mk('req-12345678').req.requestId,'req-12345678');
  assert.notEqual(mk('<bad>').req.requestId,'<bad>');
});

test('privacy export never exposes password hashes or session bearer material',async()=>{
  const out=await privacy.exportUser('ana');
  const raw=JSON.stringify(out);
  assert.equal(out.account.username,'ana');
  assert.equal(raw.includes(store.state.accounts.ana.pass),false);
  assert.equal(raw.includes('password_hash'),false);
  assert.equal(raw.includes('authSessions'),false);
});

test('privacy deletion blocks anonymizing the last active organization owner',async()=>{
  const blocked=await privacy.anonymizeUser('ana');
  assert.equal(blocked.code,409);
  assert.deepEqual(blocked.blockingOrganizations,['org-demo-ana']);
  assert.equal(store.state.authors.ana.name,'Ana Legendas');
});

test('privacy anonymization revokes access while preserving audit and financial evidence',async()=>{
  const s=store.state;
  const at=Date.now();
  s.organizationMembers['org-demo-ana:produtora']={organizationId:'org-demo-ana',username:'produtora',role:'OWNER',status:'ACTIVE',joinedAt:at,createdAt:at,updatedAt:at};
  s.authSessions||={};
  s.authSessions['sid-ana-test']={sid:'sid-ana-test',username:'ana',tokenVersion:s.accounts.ana.tokenVersion,issuedAt:at,expiresAt:at+60_000,revokedAt:null};
  s.audit.push({seq:1,at,actor:'ana',action:'test',data:{},prev:'GENESIS',hash:'preserved-hash'});
  const salesBefore=Object.keys(s.sales).length, auditBefore=s.audit.length;
  const out=await privacy.anonymizeUser('ana');
  assert.equal(out.ok,true);
  assert.equal(s.authors.ana.name,'Deleted User');
  assert.equal(s.authors.ana.document,null);
  assert.equal(s.authSessions['sid-ana-test'].revokeReason,'privacy_anonymized');
  assert.equal(s.organizationMembers['org-demo-ana:ana'].status,'SUSPENDED');
  assert.equal((await privacy.getUser('ana')).analytics,false);
  assert.equal(Object.keys(s.sales).length,salesBefore);
  assert.equal(s.audit.length,auditBefore);
  assert.ok(out.preserved.includes('financial'));
});

test('retention execution deletes only expired ephemeral organization data',async()=>{
  const s=store.state, now=Date.now(), old=now-400*864e5, recent=now-2*864e5;
  await privacy.setRetention('org-demo-produtora',{securityEventDays:30,activationDays:30},'produtora');
  s.distributionEvents=[
    {id:'old-e',organizationId:'org-demo-produtora',occurredAt:old},
    {id:'new-e',organizationId:'org-demo-produtora',occurredAt:recent},
    {id:'other-e',organizationId:'org-demo-ana',occurredAt:old},
  ];
  s.commerceActivations={
    'old-a':{id:'old-a',organizationId:'org-demo-produtora',occurredAt:old},
    'new-a':{id:'new-a',organizationId:'org-demo-produtora',occurredAt:recent},
    'other-a':{id:'other-a',organizationId:'org-demo-ana',occurredAt:old},
  };
  const salesBefore=Object.keys(s.sales).length, auditBefore=s.audit.length;
  const out=await privacy.runRetention('org-demo-produtora',now);
  assert.deepEqual(out.deleted,{distributionEvents:1,commerceActivations:1});
  assert.deepEqual(s.distributionEvents.map(e=>e.id).sort(),['new-e','other-e']);
  assert.deepEqual(Object.keys(s.commerceActivations).sort(),['new-a','other-a']);
  assert.equal(Object.keys(s.sales).length,salesBefore);
  assert.equal(s.audit.length,auditBefore);
});

test('compliance report counts pending privacy requests and reports protected evidence classes',async()=>{
  await privacy.createRequest('ana',{type:'EXPORT',organizationId:'org-demo-produtora'});
  const r=await privacy.complianceReport('org-demo-produtora');
  assert.equal(r.privacyRequests.pending,1);
  assert.equal(r.controls.financialRetentionProtected,true);
  assert.equal(r.controls.rawPlatformSecretsRejected,true);
});

test('AI key storage is environment-only and legacy browser secret persistence is disabled',()=>{
  const aiSource=require('fs').readFileSync(require('path').join(__dirname,'..','server','ai.js'),'utf8');
  const studioSource=require('fs').readFileSync(require('path').join(__dirname,'..','public','studio.html'),'utf8');
  assert.equal(aiSource.includes('secrets.json'),false);
  assert.match(aiSource,/process\.env\.GEMINI_API_KEY/);
  assert.match(aiSource,/SECRET_STORAGE_DISABLED/);
  assert.equal(studioSource.includes('type="password" placeholder="AIza'),false);
});

test('alpha.2 migration adds anonymization markers without deleting durable audit or financial tables',()=>{
  const sql=require('fs').readFileSync(require('path').join(__dirname,'..','server','data','migrations','0025_privacy_execution_anonymization.sql'),'utf8');
  assert.match(sql,/anonymized_at/i);
  assert.match(sql,/processed_by/i);
  assert.doesNotMatch(sql,/DROP\s+TABLE/i);
  assert.doesNotMatch(sql,/DELETE\s+FROM\s+sceneshop_(audit|sales|financial)/i);
});
