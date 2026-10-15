const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { PostgresContentRepository } = require('../server/repositories/content-postgres');

test('tenant isolation: migration scopes content, campaigns and commerce connections', () => {
  const sql = fs.readFileSync(path.join(__dirname,'..','server','data','migrations','0013_tenant_ownership_isolation.sql'),'utf8');
  for (const table of [
    'sceneshop_works','sceneshop_products','sceneshop_tracks','sceneshop_commercial_assets',
    'sceneshop_analysis_jobs','sceneshop_campaigns','sceneshop_commerce_track_publications',
    'sceneshop_merchant_connections','sceneshop_external_offers','sceneshop_offer_routing_policies',
  ]) assert.match(sql, new RegExp(`ALTER TABLE ${table}[\\s\\S]*organization_id`));
  assert.match(sql,/REFERENCES sceneshop_organizations\(id\) ON DELETE RESTRICT/);
});

test('tenant isolation: scoped reads always include organization_id', async () => {
  const calls=[];
  const store={ readDomain:async(fn)=>fn({query:async(sql,params)=>{ calls.push({sql,params}); return {rowCount:0,rows:[]}; }}) };
  const repo=new PostgresContentRepository({store});
  await repo.getWorkForOrganization('w1','org-a');
  await repo.listWorksByOrganization('org-a');
  await repo.getProductForOrganization('p1','org-a',{allowGlobal:false});
  await repo.listProductsByOrganization('org-a');
  await repo.getTrackForOrganization('t1','org-a');
  await repo.listTracksByOrganization('org-a');
  assert.ok(calls.every((c)=>/organization_id/.test(c.sql)));
  assert.ok(calls.some((c)=>c.params.includes('org-a')));
});

test('tenant isolation: track save rejects work from another organization before write', async () => {
  let wroteTrack=false;
  const store={ atomicDomain:async(fn)=>{
    const plan=await fn({});
    const client={query:async(sql)=>{
      if (/SELECT organization_id FROM sceneshop_works/.test(sql)) return {rowCount:1,rows:[{organization_id:'org-b'}]};
      if (/INSERT INTO sceneshop_tracks/.test(sql)) wroteTrack=true;
      return {rowCount:0,rows:[]};
    }};
    await assert.rejects(()=>plan.write(client),(e)=>e && e.code==='TENANT_MISMATCH');
    return {result:plan.result};
  }};
  const repo=new PostgresContentRepository({store});
  await repo.saveTrack({id:'t1',workId:'w1',authorId:'a1',organizationId:'org-a',type:'official',status:'ativa',title:'T',scenes:[]});
  assert.equal(wroteTrack,false);
});

test('tenant isolation: product update is constrained by product organization', async () => {
  let updateSql='';
  const store={ atomicDomain:async(fn)=>{
    const plan=await fn({userProducts:{}});
    const client={query:async(sql)=>{ if (/UPDATE sceneshop_products/.test(sql)) updateSql=sql; return {rowCount:1,rows:[]}; }};
    await plan.write(client); return {result:plan.result};
  }};
  const repo=new PostgresContentRepository({store});
  await repo.updateProduct({id:'p1',name:'P',organizationId:'org-a',createdBy:'a1',referencePrice:10});
  assert.match(updateSql,/WHERE id=\$1 AND organization_id=\$9/);
});

test('tenant isolation: studio product search includes selected tenant and global catalog only', async () => {
  let seen;
  const store={readDomain:async(fn)=>fn({query:async(sql,params)=>{ seen={sql,params}; return {rowCount:0,rows:[]}; }})};
  const repo=new PostgresContentRepository({store});
  await repo.searchProductsForOrganization('omega watch','org-a');
  assert.match(seen.sql,/organization_id=\$1 OR organization_id IS NULL/);
  assert.deepEqual(seen.params[0],'org-a');
  assert.equal(seen.params.length,3);
});

test('tenant isolation: public product search excludes organization-private inventory', async () => {
  let seen;
  const store={readDomain:async(fn)=>fn({query:async(sql,params)=>{ seen={sql,params}; return {rowCount:0,rows:[]}; }})};
  const repo=new PostgresContentRepository({store});
  await repo.searchPublicProducts('watch');
  assert.match(seen.sql,/organization_id IS NULL/);
});
