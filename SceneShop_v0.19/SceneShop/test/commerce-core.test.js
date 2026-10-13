const test=require('node:test');
const assert=require('node:assert/strict');
process.env.SCENESHOP_MEMORY='1';
const store=require('../server/store');
const {commerce}=require('../server/repositories');
const {StateCommerceCoreRepository,policySpecificity,orderOffers,PROVIDERS}=require('../server/repositories/commerce-core');

test.beforeEach(()=>store.useMemory(true));

test('provider registry is marketplace-neutral and includes direct/open destinations',async()=>{
  const rows=await commerce.listProviders();
  for(const code of ['brand_direct','custom_store','private_marketplace','amazon','mercado_livre','shopee','lead_generation','dealer_locator','reservation']) assert.ok(rows.some(x=>x.providerCode===code));
});

test('governed commerce flow freezes a resolution and activation before redirect',async()=>{
  const org='org-demo-produtora';
  const sponsor=(await commerce.createSponsor(org,{name:'Omega'},'produtora')).sponsor;
  const campaign=(await commerce.createCampaign(org,{name:'Bond 2028',sponsorId:sponsor.id,status:'ACTIVE',territories:['BR'],productIds:['relogio-classico']},'produtora')).campaign;
  const brand=(await commerce.createConnection(org,{providerCode:'brand_direct',label:'Omega Brasil'},'produtora')).connection;
  const amazon=(await commerce.createConnection(org,{providerCode:'amazon',label:'Amazon BR'},'produtora')).connection;
  const direct=(await commerce.createOffer(org,{connectionId:brand.id,productId:'relogio-classico',destinationUrl:'https://example.com/omega',price:29990,currency:'BRL',territory:'BR',commissionRate:.12},'produtora')).offer;
  const market=(await commerce.createOffer(org,{connectionId:amazon.id,productId:'relogio-classico',destinationUrl:'https://example.com/amazon',price:27990,currency:'BRL',territory:'BR',commissionRate:.08},'produtora')).offer;
  await commerce.createRoutingPolicy(org,{productId:'relogio-classico',campaignId:campaign.id,territory:'BR',strategy:'BRAND_DIRECT_FIRST',offerIds:[market.id,direct.id]},'produtora');
  const out=await commerce.resolve(org,{productId:'relogio-classico',campaignId:campaign.id,territory:'BR'},{viewerDevice:'phone-123'});
  assert.equal(out.offers[0].provider.kind,'BRAND_DIRECT');
  assert.equal(out.offers[0].destinationUrl,undefined);
  assert.match(out.offers[0].activationUrl,/^\/api\/commerce\/activations\//);
  assert.equal(out.resolution.viewerHash.length,64);
  const act=await commerce.activate(out.resolution.id,out.offers[0].id,{source:'test'});
  assert.equal(act.destinationUrl,'https://example.com/omega');
  assert.ok(store.state.commerceActivations[act.activation.id]);
});

test('routing can choose lower price when policy says LOWEST_PRICE',async()=>{
  const org='org-demo-produtora';
  const c=(await commerce.createConnection(org,{providerCode:'custom_store'},'produtora')).connection;
  const a=(await commerce.createOffer(org,{connectionId:c.id,productId:'notebook-14',destinationUrl:'https://example.com/a',price:5000,territory:'GLOBAL'},'produtora')).offer;
  const b=(await commerce.createOffer(org,{connectionId:c.id,productId:'notebook-14',destinationUrl:'https://example.com/b',price:4500,territory:'GLOBAL'},'produtora')).offer;
  await commerce.createRoutingPolicy(org,{productId:'notebook-14',strategy:'LOWEST_PRICE',offerIds:[a.id,b.id]},'produtora');
  const out=await commerce.preview(org,{productId:'notebook-14',territory:'BR'});
  assert.equal(out.offers[0].id,b.id);
});

test('commerce data is tenant isolated in state repository',async()=>{
  const a='org-demo-produtora', b='org-demo-ana';
  const ca=(await commerce.createConnection(a,{providerCode:'amazon'},'produtora')).connection;
  await commerce.createOffer(a,{connectionId:ca.id,productId:'smartwatch',destinationUrl:'https://example.com/a',territory:'BR'},'produtora');
  assert.equal((await commerce.listOffers(a)).length,1);
  assert.equal((await commerce.listOffers(b)).length,0);
  const bad=await commerce.createOffer(b,{connectionId:ca.id,productId:'smartwatch',destinationUrl:'https://example.com/b'},'ana');
  assert.ok(bad.errors);
});

test('policy specificity favors placement then campaign then work then product',()=>{
  const ctx={placementId:'p',campaignId:'c',workId:'w',productId:'x',territory:'BR'};
  assert.ok(policySpecificity({placementId:'p',campaignId:null,workId:null,productId:null,territory:'GLOBAL'},ctx)>policySpecificity({productId:'x',territory:'GLOBAL'},ctx));
  assert.equal(policySpecificity({placementId:'other'},ctx),-1);
});

test('brand direct first ordering is deterministic',()=>{
  const providers=Object.fromEntries(PROVIDERS.map(x=>[x.id,x]));
  const rows=[{id:'m',providerId:'provider-amazon'},{id:'d',providerId:'provider-brand-direct'}];
  assert.equal(orderOffers(rows,{strategy:'BRAND_DIRECT_FIRST',offerIds:['m','d']},providers)[0].id,'d');
});

test('campaign product authorization blocks products outside an explicit campaign set',async()=>{
  const org='org-demo-produtora';
  const c=(await commerce.createCampaign(org,{name:'Campanha restrita',status:'ACTIVE',productIds:['smartwatch']},'produtora')).campaign;
  const conn=(await commerce.createConnection(org,{providerCode:'amazon'},'produtora')).connection;
  await commerce.createOffer(org,{connectionId:conn.id,productId:'notebook-14',destinationUrl:'https://example.com/notebook'},'produtora');
  const r=await commerce.preview(org,{productId:'notebook-14',campaignId:c.id,territory:'BR'});
  assert.equal(r.code,409);
});

test('territory filter does not leak offers from another market',async()=>{
  const org='org-demo-produtora';
  const conn=(await commerce.createConnection(org,{providerCode:'amazon'},'produtora')).connection;
  await commerce.createOffer(org,{connectionId:conn.id,productId:'smartwatch',destinationUrl:'https://example.com/us',territory:'US'},'produtora');
  const r=await commerce.preview(org,{productId:'smartwatch',territory:'BR'});
  assert.equal(r.code,404);
});

test('disabled offers are not eligible',async()=>{
  const org='org-demo-produtora';
  const conn=(await commerce.createConnection(org,{providerCode:'custom_store'},'produtora')).connection;
  await commerce.createOffer(org,{connectionId:conn.id,productId:'smartwatch',destinationUrl:'https://example.com/off',enabled:false},'produtora');
  const r=await commerce.preview(org,{productId:'smartwatch',territory:'GLOBAL'});
  assert.equal(r.code,404);
});

test('external offer rejects non-http destination',async()=>{
  const org='org-demo-produtora';
  const conn=(await commerce.createConnection(org,{providerCode:'custom_store'},'produtora')).connection;
  const r=await commerce.createOffer(org,{connectionId:conn.id,productId:'smartwatch',destinationUrl:'javascript:alert(1)'},'produtora');
  assert.ok(r.errors);
});

test('expired resolution cannot be activated',async()=>{
  const org='org-demo-produtora';
  const conn=(await commerce.createConnection(org,{providerCode:'custom_store'},'produtora')).connection;
  const offer=(await commerce.createOffer(org,{connectionId:conn.id,productId:'smartwatch',destinationUrl:'https://example.com/x'},'produtora')).offer;
  const r=await commerce.resolve(org,{productId:'smartwatch',territory:'GLOBAL'});
  store.state.commerceResolutions[r.resolution.id].expiresAt=Date.now()-1;
  const a=await commerce.activate(r.resolution.id,offer.id,{});
  assert.equal(a.code,404);
});

test('activation rejects an offer that was not frozen in the resolution',async()=>{
  const org='org-demo-produtora';
  const conn=(await commerce.createConnection(org,{providerCode:'custom_store'},'produtora')).connection;
  await commerce.createOffer(org,{connectionId:conn.id,productId:'smartwatch',destinationUrl:'https://example.com/a'},'produtora');
  const other=(await commerce.createOffer(org,{connectionId:conn.id,productId:'notebook-14',destinationUrl:'https://example.com/b'},'produtora')).offer;
  const r=await commerce.resolve(org,{productId:'smartwatch',territory:'GLOBAL'});
  const a=await commerce.activate(r.resolution.id,other.id,{});
  assert.equal(a.code,404);
});


test('commercial-asset-only campaigns and routing resolve without a canonical Product',async()=>{
  const org='org-demo-produtora';
  const assetId='asset-only-watch';
  store.state.aiCommercialAssets[assetId]={id:assetId,organizationId:org,name:'Relógio patrocinado',brand:'Marca X',status:'APPROVED'};
  const campaign=(await commerce.createCampaign(org,{name:'Campanha asset-first',status:'ACTIVE',assetIds:[assetId]},'produtora')).campaign;
  assert.deepEqual(campaign.assetIds,[assetId]);
  const conn=(await commerce.createConnection(org,{providerCode:'brand_direct',label:'Loja oficial'},'produtora')).connection;
  const offer=(await commerce.createOffer(org,{connectionId:conn.id,assetId,destinationUrl:'https://example.com/asset',price:1200,territory:'BR'},'produtora')).offer;
  const policy=(await commerce.createRoutingPolicy(org,{assetId,campaignId:campaign.id,territory:'BR',strategy:'PRIORITY',offerIds:[offer.id]},'produtora')).policy;
  assert.equal(policy.assetId,assetId);
  const out=await commerce.resolve(org,{assetId,campaignId:campaign.id,territory:'BR'},{viewerDevice:'phone-asset'});
  assert.equal(out.resolution.assetId,assetId);
  assert.equal(out.resolution.productId,null);
  assert.equal(out.offers[0].id,offer.id);
});

test('campaign asset authorization blocks another CommercialAsset',async()=>{
  const org='org-demo-produtora';
  store.state.aiCommercialAssets['asset-a']={id:'asset-a',organizationId:org,name:'A'};
  store.state.aiCommercialAssets['asset-b']={id:'asset-b',organizationId:org,name:'B'};
  const campaign=(await commerce.createCampaign(org,{name:'Asset restricted',status:'ACTIVE',assetIds:['asset-a']},'produtora')).campaign;
  const conn=(await commerce.createConnection(org,{providerCode:'custom_store'},'produtora')).connection;
  await commerce.createOffer(org,{connectionId:conn.id,assetId:'asset-b',destinationUrl:'https://example.com/b'},'produtora');
  const out=await commerce.preview(org,{assetId:'asset-b',campaignId:campaign.id,territory:'GLOBAL'});
  assert.equal(out.code,409);
});

test('commerce asset campaign migration links campaigns and routing directly to CommercialAsset',()=>{
  const fs=require('fs'),path=require('path');
  const sql=fs.readFileSync(path.join(__dirname,'..','server','data','migrations','0023_campaign_assets_commerce_timeline.sql'),'utf8');
  assert.match(sql,/sceneshop_campaign_assets/);
  assert.match(sql,/asset_id TEXT REFERENCES sceneshop_commercial_assets/);
});
