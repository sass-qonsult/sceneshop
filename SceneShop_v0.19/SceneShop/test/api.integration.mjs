import assert from 'node:assert/strict';

// API_IT_BACKEND=postgres roda o mesmo roteiro contra o PostgreSQL de DATABASE_URL (banco vazio),
// para pegar consultas SQL que o modo em memória não exercita.
const usePostgres = process.env.API_IT_BACKEND === 'postgres';
if (!usePostgres) process.env.SCENESHOP_MEMORY = '1';
process.env.DEMO = '1';
process.env.DATA_BACKEND = usePostgres ? 'postgres' : 'memory';
process.env.SESSION_BACKEND = 'memory';
process.env.SESSION_SECRET = 'sceneshop-api-integration-secret-0123456789';

const { bootstrap, server, shutdown } = await import('../server/index.js');
const mfaMod = await import('../server/security/mfa.js');
const mfa = mfaMod.default || mfaMod;
const catalogMod = await import('../server/catalog.js');
const catalog = catalogMod.default || catalogMod;
const repositoriesMod = await import('../server/repositories/index.js');
const repositories = repositoriesMod.default || repositoriesMod;

function jsonHeaders(token) {
  return { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) };
}

async function request(base, path, { method='GET', token, body, redirect='follow', headers={} }={}) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { ...jsonHeaders(token), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect,
  });
  const type = res.headers.get('content-type') || '';
  const data = type.includes('application/json') ? await res.json() : await res.text();
  return { res, data };
}

let failed = false;
try {
  await bootstrap();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;

  // health / readiness
  {
    const { res, data } = await request(base, '/api/ready');
    assert.equal(res.status, 200);
    assert.equal(data.ok, true);
  }

  // reset deterministic demo state
  {
    const { res } = await request(base, '/api/dev/reset', { method:'POST', body:{} });
    assert.equal(res.status, 200);
  }

  // producer authentication and authoritative catalog
  const login = await request(base, '/api/auth/login', {
    method:'POST', body:{ username:'produtora', password:'demo1234' },
  });
  assert.equal(login.res.status, 200);
  assert.ok(login.data.token);
  const producerToken = login.data.token;

  const me = await request(base, '/api/me', { token: producerToken });
  assert.equal(me.res.status, 200);
  assert.equal(me.data.username, 'produtora');
  assert.equal(me.data.role, 'producer');

  const works = await request(base, '/api/works');
  assert.equal(works.res.status, 200);
  assert.ok(Array.isArray(works.data) && works.data.length > 0);
  const work = works.data[0];

  const workView = await request(base, `/api/works/${encodeURIComponent(work.id)}`);
  assert.equal(workView.res.status, 200);
  assert.equal(workView.data.id, work.id);
  assert.ok(workView.data.track);

  // playback session exposes a public pairing code but keeps the controller token private
  const created = await request(base, '/api/sessions', {
    method:'POST', body:{ workId: work.id, time: 12, mode:'COMPANION' },
  });
  assert.equal(created.res.status, 201);
  assert.equal(created.data.mode, 'COMPANION');
  assert.ok(created.data.code);
  assert.ok(created.data.controllerToken);
  const sessionCode = created.data.code;
  const controllerToken = created.data.controllerToken;

  const sessionPublic = await request(base, `/api/sessions/${encodeURIComponent(sessionCode)}`);
  assert.equal(sessionPublic.res.status, 200);
  assert.equal(sessionPublic.data.code, sessionCode);
  assert.equal(sessionPublic.data.controllerToken, undefined);

  // Official offers are reachable through the real HTTP authorization path.
  const officialOffers = await request(base, '/api/me/official-offers', { token: producerToken });
  assert.equal(officialOffers.res.status, 200);
  assert.ok(Array.isArray(officialOffers.data));

  // KYC submission and moderation use real routes and role boundaries.
  const authorLogin = await request(base, '/api/auth/login', {
    method:'POST', body:{ username:'ana', password:'demo1234' },
  });
  assert.equal(authorLogin.res.status, 200);
  const authorToken = authorLogin.data.token;
  const kycSubmit = await request(base, '/api/me/kyc', {
    method:'POST', token:authorToken,
    body:{ name:'Ana Silva', document:'529.982.247-25', birth:'1990-04-12', bank:'ana@pix.test', accepted:true },
  });
  assert.ok([200, 400].includes(kycSubmit.res.status));
  // Demo data can already have a KYC record after prior compatibility migrations; either way the route must not 500.
  assert.notEqual(kycSubmit.res.status, 500);

  const modLogin = await request(base, '/api/auth/login', {
    method:'POST', body:{ username:'moderador', password:'demo1234' },
  });
  assert.equal(modLogin.res.status, 200);
  const modToken = modLogin.data.token;
  const queue = await request(base, '/api/aml/kyc', { token:modToken });
  assert.equal(queue.res.status, 200);
  assert.ok(Array.isArray(queue.data));

  // Multi-tenant organization API: create a second organization and isolate membership roles.
  const orgList = await request(base, '/api/me/organizations', { token:producerToken });
  assert.equal(orgList.res.status, 200);
  assert.ok(Array.isArray(orgList.data) && orgList.data.some((o) => o.membership && o.membership.role === 'OWNER'));
  const createdOrg = await request(base, '/api/organizations', { method:'POST', token:producerToken, body:{ name:'Canal RC Integration', kind:'CHANNEL' } });
  assert.equal(createdOrg.res.status, 201);
  assert.equal(createdOrg.data.organization.membership.role, 'OWNER');
  const orgId = createdOrg.data.organization.id;
  const addMember = await request(base, `/api/organizations/${encodeURIComponent(orgId)}/members`, { method:'POST', token:producerToken, body:{ username:'ana', role:'COMMERCIAL' } });
  assert.equal(addMember.res.status, 201);
  assert.equal(addMember.data.member.role, 'COMMERCIAL');
  const memberList = await request(base, `/api/organizations/${encodeURIComponent(orgId)}/members`, { token:authorToken });
  assert.equal(memberList.res.status, 200);
  assert.ok(memberList.data.some((m) => m.username === 'ana' && m.role === 'COMMERCIAL'));

  const selectedContext = await request(base, '/api/me/context', { token:authorToken, headers:{ 'x-sceneshop-organization':orgId } });
  assert.equal(selectedContext.res.status, 200);
  assert.equal(selectedContext.data.organization.id, orgId);
  assert.equal(selectedContext.data.membership.role, 'COMMERCIAL');

  // Secure team invitation: token is issued once, accepted by the invited account and cannot be reused.
  const promoLogin = await request(base, '/api/auth/login', { method:'POST', body:{ username:'promo_x', password:'demo1234' } });
  assert.equal(promoLogin.res.status, 200);
  const promoToken = promoLogin.data.token;
  const invite = await request(base, `/api/organizations/${encodeURIComponent(orgId)}/invites`, {
    method:'POST', token:producerToken, headers:{ 'x-sceneshop-organization':orgId }, body:{ username:'promo_x', role:'ANALYST', expiresHours:24 },
  });
  assert.equal(invite.res.status, 201);
  assert.ok(invite.data.token);
  const acceptedInvite = await request(base, '/api/organization-invites/accept', { method:'POST', token:promoToken, body:{ token:invite.data.token } });
  assert.equal(acceptedInvite.res.status, 200);
  assert.equal(acceptedInvite.data.member.role, 'ANALYST');
  const reusedInvite = await request(base, '/api/organization-invites/accept', { method:'POST', token:promoToken, body:{ token:invite.data.token } });
  assert.equal(reusedInvite.res.status, 404);

  // Tenant ownership: resources belong to the organization, not to the individual creator.
  const tenantProduct = await request(base, '/api/products', {
    method:'POST', token:producerToken, headers:{ 'x-sceneshop-organization':orgId },
    body:{ name:'Produto Tenant Integration', brand:'SceneShop Test', category:'Teste', referencePrice:199.9, description:'Produto isolado por organização.' },
  });
  assert.equal(tenantProduct.res.status, 201);
  assert.equal(tenantProduct.data.organizationId, orgId);
  const tenantProductId = tenantProduct.data.id;
  const publicTenantSearch = await request(base, '/api/products?q=Produto%20Tenant%20Integration');
  assert.equal(publicTenantSearch.res.status, 200);
  assert.ok(!publicTenantSearch.data.some((p)=>p.id===tenantProductId));
  const publicTenantProduct = await request(base, `/api/products/${encodeURIComponent(tenantProductId)}`);
  assert.equal(publicTenantProduct.res.status, 404);

  // A COMMERCIAL member of the same organization can maintain the shared inventory.
  const teamEdit = await request(base, `/api/products/${encodeURIComponent(tenantProductId)}`, {
    method:'PUT', token:authorToken, headers:{ 'x-sceneshop-organization':orgId }, body:{ referencePrice:209.9 },
  });
  assert.equal(teamEdit.res.status, 200);
  assert.equal(teamEdit.data.referencePrice, 209.9);

  const orgProducts = await request(base, '/api/me/products', { token:authorToken, headers:{ 'x-sceneshop-organization':orgId } });
  assert.equal(orgProducts.res.status, 200);
  assert.ok(orgProducts.data.some((p)=>p.id===tenantProductId));

  const authorOwnOrg = (await request(base, '/api/me/organizations', { token:authorToken })).data.find((o)=>o.id!==orgId);
  assert.ok(authorOwnOrg);
  const crossTenantEdit = await request(base, `/api/products/${encodeURIComponent(tenantProductId)}`, {
    method:'PUT', token:authorToken, headers:{ 'x-sceneshop-organization':authorOwnOrg.id }, body:{ referencePrice:1 },
  });
  assert.equal(crossTenantEdit.res.status, 404);
  const isolatedProducts = await request(base, '/api/me/products', { token:authorToken, headers:{ 'x-sceneshop-organization':authorOwnOrg.id } });
  assert.equal(isolatedProducts.res.status, 200);
  assert.ok(!isolatedProducts.data.some((p)=>p.id===tenantProductId));

  // MFA lifecycle: setup -> enable -> password challenge -> TOTP -> strong session.
  const setupMfa = await request(base, '/api/me/mfa/setup', { method:'POST', token:producerToken, body:{} });
  assert.equal(setupMfa.res.status, 201);
  assert.ok(setupMfa.data.secret && setupMfa.data.otpauth);
  const firstCode = mfa.totp(setupMfa.data.secret);
  const enabledMfa = await request(base, '/api/me/mfa/enable', { method:'POST', token:producerToken, body:{ code:firstCode } });
  assert.equal(enabledMfa.res.status, 200);
  assert.equal(enabledMfa.data.enabled, true);

  // Logout-all invalidates the actual token through the HTTP middleware path.
  const logout = await request(base, '/api/auth/logout-all', { method:'POST', token:producerToken, body:{} });
  assert.equal(logout.res.status, 200);
  const afterLogout = await request(base, '/api/me', { token:producerToken });
  assert.equal(afterLogout.res.status, 401);

  const challengedLogin = await request(base, '/api/auth/login', { method:'POST', body:{ username:'produtora', password:'demo1234' } });
  assert.equal(challengedLogin.res.status, 200);
  assert.equal(challengedLogin.data.mfaRequired, true);
  assert.ok(challengedLogin.data.challenge);
  const mfaLogin = await request(base, '/api/auth/mfa', { method:'POST', body:{ challenge:challengedLogin.data.challenge, code:mfa.totp(setupMfa.data.secret) } });
  assert.equal(mfaLogin.res.status, 200);
  assert.ok(mfaLogin.data.token);
  const strongToken = mfaLogin.data.token;

  // An OWNER can require MFA for organization writes, and password-only members are then blocked.
  const securityUpdate = await request(base, `/api/organizations/${encodeURIComponent(orgId)}/settings`, {
    method:'PATCH', token:strongToken, headers:{ 'x-sceneshop-organization':orgId }, body:{ security:{ requireMfaForWrites:true } },
  });
  assert.equal(securityUpdate.res.status, 200);
  const blockedWithoutMfa = await request(base, `/api/products/${encodeURIComponent(tenantProductId)}`, {
    method:'PUT', token:authorToken, headers:{ 'x-sceneshop-organization':orgId }, body:{ referencePrice:219.9 },
  });
  assert.equal(blockedWithoutMfa.res.status, 403);
  assert.equal(blockedWithoutMfa.data.error, 'MFA_REQUIRED');

  // v0.11 Commerce Core: governed sponsor/campaign/provider/offer/routing plus first-party activation.
  const producerOrg = orgList.data.find((o)=>o.id==='org-demo-produtora') || orgList.data[0];
  const commerceHeaders = { 'x-sceneshop-organization':producerOrg.id };
  const providers = await request(base, '/api/commerce/providers', { token:strongToken, headers:commerceHeaders });
  assert.equal(providers.res.status, 200);
  assert.ok(providers.data.some((p)=>p.providerCode==='amazon') && providers.data.some((p)=>p.providerCode==='brand_direct'));
  const sponsor = await request(base, '/api/commerce/sponsors', { method:'POST', token:strongToken, headers:commerceHeaders, body:{ name:'Omega Integration' } });
  assert.equal(sponsor.res.status, 201);
  const campaign = await request(base, '/api/commerce/campaigns', { method:'POST', token:strongToken, headers:commerceHeaders, body:{ name:'Bond Integration', sponsorId:sponsor.data.sponsor.id, status:'ACTIVE', territories:['BR'], productIds:['relogio-classico'] } });
  assert.equal(campaign.res.status, 201);
  const directConn = await request(base, '/api/commerce/connections', { method:'POST', token:strongToken, headers:commerceHeaders, body:{ providerCode:'brand_direct', label:'Omega Direct' } });
  const amazonConn = await request(base, '/api/commerce/connections', { method:'POST', token:strongToken, headers:commerceHeaders, body:{ providerCode:'amazon', label:'Amazon BR' } });
  assert.equal(directConn.res.status, 201); assert.equal(amazonConn.res.status, 201);
  const directOffer = await request(base, '/api/commerce/offers', { method:'POST', token:strongToken, headers:commerceHeaders, body:{ connectionId:directConn.data.connection.id, productId:'relogio-classico', destinationUrl:'https://example.com/omega', price:29990, currency:'BRL', territory:'BR', commissionRate:.12, cta:'EXPLORE' } });
  const amazonOffer = await request(base, '/api/commerce/offers', { method:'POST', token:strongToken, headers:commerceHeaders, body:{ connectionId:amazonConn.data.connection.id, productId:'relogio-classico', destinationUrl:'https://example.com/amazon', price:27990, currency:'BRL', territory:'BR', commissionRate:.08, cta:'BUY' } });
  assert.equal(directOffer.res.status, 201); assert.equal(amazonOffer.res.status, 201);
  const route = await request(base, '/api/commerce/routing-policies', { method:'POST', token:strongToken, headers:commerceHeaders, body:{ productId:'relogio-classico', campaignId:campaign.data.campaign.id, territory:'BR', strategy:'BRAND_DIRECT_FIRST', offerIds:[amazonOffer.data.offer.id,directOffer.data.offer.id] } });
  assert.equal(route.res.status, 201);
  const preview = await request(base, '/api/commerce/resolve-preview', { method:'POST', token:strongToken, headers:commerceHeaders, body:{ productId:'relogio-classico', campaignId:campaign.data.campaign.id, territory:'BR' } });
  assert.equal(preview.res.status, 200);
  assert.equal(preview.data.offers[0].provider.kind, 'BRAND_DIRECT');
  const timeline = await request(base, '/api/works/demo-01/commerce-timeline');
  assert.equal(timeline.res.status, 200);
  const watchPlacement = timeline.data.scenes.flatMap((sc)=>sc.products||[]).find((p)=>p.productId==='relogio-classico');
  assert.ok(watchPlacement);
  const publicResolution = await request(base, '/api/commerce/resolve', { method:'POST', body:{ workId:'demo-01', productId:'relogio-classico', placementId:watchPlacement.placementId, campaignId:campaign.data.campaign.id, territory:'BR', deviceId:'integration-phone' } });
  assert.equal(publicResolution.res.status, 200);
  assert.equal(publicResolution.data.offers[0].destinationUrl, undefined);
  assert.match(publicResolution.data.offers[0].activationUrl, /^\/api\/commerce\/activations\//);
  const activation = await request(base, publicResolution.data.offers[0].activationUrl, { redirect:'manual' });
  assert.equal(activation.res.status, 302);
  assert.equal(activation.res.headers.get('location'), 'https://example.com/omega');

  // v0.13 Distribution/Sync: external platform binding -> sync index -> Companion recognition/session.
  const demoWork = catalog.getWork('demo-01');
  catalog.addWork({ ...demoWork, organizationId:producerOrg.id, ownerId:'produtora-demo', syncId:'SYNC-DEMO-INTEGRATION' });
  const ytBinding = await request(base, '/api/distribution/bindings', {
    method:'POST', token:strongToken, headers:commerceHeaders,
    body:{ workId:'demo-01', mode:'COMPANION', canonicalUrl:'https://www.youtube.com/watch?v=SceneShopDemo001', officialOwnerUrl:'https://producer.example/demo', label:'YouTube Demo' },
  });
  assert.equal(ytBinding.res.status, 201);
  assert.equal(ytBinding.data.binding.platform, 'YOUTUBE');
  const rejectedRawPlatformSecret = await request(base, '/api/distribution/platform-connections', {
    method:'POST', token:strongToken, headers:commerceHeaders, body:{ platform:'YOUTUBE', label:'Unsafe', credentialsRef:'env:YOUTUBE_API_KEY', accessToken:'raw-secret' },
  });
  assert.equal(rejectedRawPlatformSecret.res.status, 400);
  const ytConnection = await request(base, '/api/distribution/platform-connections', {
    method:'POST', token:strongToken, headers:commerceHeaders, body:{ platform:'YOUTUBE', label:'YouTube Metadata', credentialsRef:'env:YOUTUBE_API_KEY', scopes:['metadata:read'] },
  });
  assert.equal(ytConnection.res.status, 201);
  assert.equal(ytConnection.data.connection.credentialsRef, 'env:***');
  const linkedBinding = await request(base, `/api/distribution/bindings/${encodeURIComponent(ytBinding.data.binding.id)}`, {
    method:'PATCH', token:strongToken, headers:commerceHeaders, body:{ connectionId:ytConnection.data.connection.id },
  });
  assert.equal(linkedBinding.res.status, 200);
  assert.equal(linkedBinding.data.binding.connectionId, ytConnection.data.connection.id);
  const platformConnections = await request(base, '/api/distribution/platform-connections', { token:strongToken, headers:commerceHeaders });
  assert.equal(platformConnections.res.status, 200);
  assert.ok(platformConnections.data.some((c)=>c.id===ytConnection.data.connection.id && c.credentialsRef==='env:***'));
  const syncManifest = { format:'sceneshop-sync-index', version:1, syncId:'SYNC-DEMO-INTEGRATION', algorithm:'SS-AUDIO-SPECTRAL', algorithmVersion:1, duration:60, sourceSha256:'a'.repeat(64), windows:[
    {hash:'abc101',offset:10,quality:.8},{hash:'abc102',offset:10.5,quality:.8},{hash:'abc103',offset:11,quality:.9},{hash:'abc104',offset:11.5,quality:.9}
  ]};
  const indexed = await request(base, '/api/distribution/works/demo-01/sync-index', { method:'POST', token:strongToken, headers:commerceHeaders, body:syncManifest });
  assert.equal(indexed.res.status, 201);
  assert.equal(indexed.data.build.windowCount, 4);
  const recognized = await request(base, '/api/sync/recognize', { method:'POST', body:{ externalUrl:'https://youtu.be/SceneShopDemo001', samples:[{hash:'abc101',offset:0},{hash:'abc102',offset:.5},{hash:'abc103',offset:1}] } });
  assert.equal(recognized.res.status, 200);
  assert.equal(recognized.data.work.id, 'demo-01');
  assert.equal(recognized.data.position, 10);
  const companionStarted = await request(base, '/api/sync/start', { method:'POST', body:{ externalUrl:'https://www.youtube.com/watch?v=SceneShopDemo001', samples:[{hash:'abc101',offset:0},{hash:'abc102',offset:.5},{hash:'abc103',offset:1}] } });
  assert.equal(companionStarted.res.status, 201);
  assert.equal(companionStarted.data.session.mode, 'COMPANION');
  assert.equal(companionStarted.data.session.controllerToken, undefined);

  // Partner-Native/Embedded use a long-lived server key only to mint a short-lived browser token.
  const embeddedBinding = await request(base, '/api/distribution/bindings', {
    method:'POST', token:strongToken, headers:commerceHeaders,
    body:{ workId:'demo-01', mode:'EMBEDDED', platform:'PARTNER_APP', canonicalUrl:'https://app.producer.example/demo', label:'Partner App' },
  });
  assert.equal(embeddedBinding.res.status, 201);
  const sdkKey = await request(base, '/api/distribution/sdk-keys', { method:'POST', token:strongToken, headers:commerceHeaders, body:{ label:'Integration SDK' } });
  assert.equal(sdkKey.res.status, 201);
  assert.ok(sdkKey.data.secret.startsWith('ss_live_'));
  const sdkToken = await request(base, '/api/sdk/v1/token', { method:'POST', headers:{'x-sceneshop-sdk-key':sdkKey.data.secret}, body:{bindingId:embeddedBinding.data.binding.id} });
  assert.equal(sdkToken.res.status, 200);
  const timelineSdk = await request(base, '/api/sdk/v1/timeline', { token:sdkToken.data.token });
  assert.equal(timelineSdk.res.status, 200);
  assert.equal(timelineSdk.data.workId, 'demo-01');
  const sdkSession = await request(base, '/api/sdk/v1/sessions', { method:'POST', token:sdkToken.data.token, body:{position:18} });
  assert.equal(sdkSession.res.status, 201);
  assert.equal(sdkSession.data.mode, 'EMBEDDED');
  const sdkPlayback = await request(base, `/api/sdk/v1/sessions/${encodeURIComponent(sdkSession.data.code)}/playback`, { method:'POST', token:sdkToken.data.token, body:{position:19,playing:true} });
  assert.equal(sdkPlayback.res.status, 200);
  assert.equal(sdkPlayback.data.playing, true);

  // v0.14 AI: governed asset -> frozen primary -> isolated redundancy -> operator review -> placement.
  const aiAsset = await request(base, '/api/ai/assets', {
    method:'POST', token:strongToken, headers:commerceHeaders,
    body:{ name:'Omega Seamaster Integration', brand:'Omega', model:'Diver 300M', category:'WATCHES', productId:'relogio-classico' },
  });
  assert.equal(aiAsset.res.status, 201);
  const aiRef = await request(base, `/api/ai/assets/${encodeURIComponent(aiAsset.data.id)}/references`, {
    method:'POST', token:strongToken, headers:commerceHeaders,
    body:{ mediaType:'IMAGE', uri:'/uploads/images/omega-integration.jpg', angle:'front' },
  });
  assert.equal(aiRef.res.status, 201);
  const aiJob = repositories.ai.createJob(producerOrg.id, catalog.getWork('demo-01'), { mode:'TARGETED', assetIds:[aiAsset.data.id], scanDepth:'STANDARD' }, 'integration-engine').job;
  repositories.ai.startJob(producerOrg.id, aiJob.id);
  const aiCandidate = repositories.ai.recordPrimaryCandidate(producerOrg.id, aiJob.id, {
    assetId:aiAsset.data.id, name:'Steel dive watch', brand:'Omega', model:'Seamaster', category:'WATCHES', startSeconds:18, endSeconds:24, bestSeconds:21, confidence:.88, primaryPayload:{integration:true},
  }).candidate;
  const frozenFingerprint = aiCandidate.primaryFingerprint;
  const redundant = await request(base, `/api/ai/candidates/${encodeURIComponent(aiCandidate.id)}/verifications`, {
    method:'POST', token:strongToken, headers:commerceHeaders,
    body:{ provider:'GOOGLE_VISUAL', state:'CONFLICT', proposedBrand:'Omega', proposedModel:'Speedmaster', confidence:.82, evidence:{ source:'integration-mock' } },
  });
  assert.equal(redundant.res.status, 201);
  assert.equal(redundant.data.primaryFingerprint, frozenFingerprint);
  assert.equal(redundant.data.flag.status, 'OPEN');
  const flags = await request(base, '/api/ai/operator-flags?status=OPEN', { token:strongToken, headers:commerceHeaders });
  assert.equal(flags.res.status, 200);
  assert.ok(flags.data.some((f)=>f.id===redundant.data.flag.id));
  const resolvedFlag = await request(base, `/api/ai/operator-flags/${encodeURIComponent(redundant.data.flag.id)}/resolve`, {
    method:'POST', token:strongToken, headers:commerceHeaders,
    body:{ decision:'APPROVE', assetId:aiAsset.data.id, displayStartSeconds:17, displayEndSeconds:28, note:'Operator confirmed target asset' },
  });
  assert.equal(resolvedFlag.res.status, 200);
  assert.equal(resolvedFlag.data.flag.status, 'RESOLVED');
  assert.equal(resolvedFlag.data.candidate.primaryFingerprint, frozenFingerprint);
  assert.equal(resolvedFlag.data.placement.assetId, aiAsset.data.id);
  const aiPlacements = await request(base, '/api/ai/placements?workId=demo-01', { token:strongToken, headers:commerceHeaders });
  assert.equal(aiPlacements.res.status, 200);
  assert.ok(aiPlacements.data.some((p)=>p.id===resolvedFlag.data.placement.id));
  const aiWorkspace = await request(base, '/api/ai/workspace?workId=demo-01', { token:strongToken, headers:commerceHeaders });
  assert.equal(aiWorkspace.res.status, 200);
  assert.ok(aiWorkspace.data.assets.some((a)=>a.id===aiAsset.data.id));
  assert.ok(aiWorkspace.data.candidates.some((c)=>c.id===aiCandidate.id));
  assert.ok(aiWorkspace.data.placements.some((p)=>p.id===resolvedFlag.data.placement.id));
  assert.equal(aiWorkspace.data.workId, 'demo-01');
  const mobileSurface = await request(base, '/mobile.html');
  assert.equal(mobileSurface.res.status, 200);
  assert.match(String(mobileSurface.data), /Enquanto você explorava/);
  assert.match(String(mobileSurface.data), /mobile-core\.js/);

  // v0.16 Security/Privacy: self export, governed DSAR processing, retention and secret hardening.
  const privacyExport = await request(base, '/api/me/privacy/export', { token:authorToken });
  assert.equal(privacyExport.res.status, 200);
  assert.equal(privacyExport.data.account.username, 'ana');
  assert.equal(JSON.stringify(privacyExport.data).includes('demo1234'), false);

  const deleteRequest = await request(base, '/api/me/privacy/requests', {
    method:'POST', token:authorToken, body:{ type:'DELETE', organizationId:authorOwnOrg.id },
  });
  assert.equal(deleteRequest.res.status, 201);
  assert.equal(deleteRequest.data.request.type, 'DELETE');

  // Privacy-request execution is an internal sensitive action and requires moderator MFA.
  const modMfaSetup = await request(base, '/api/me/mfa/setup', { method:'POST', token:modToken, body:{} });
  assert.equal(modMfaSetup.res.status, 201);
  const modMfaEnable = await request(base, '/api/me/mfa/enable', { method:'POST', token:modToken, body:{ code:mfa.totp(modMfaSetup.data.secret) } });
  assert.equal(modMfaEnable.res.status, 200);
  await request(base, '/api/auth/logout-all', { method:'POST', token:modToken, body:{} });
  const modChallenge = await request(base, '/api/auth/login', { method:'POST', body:{ username:'moderador', password:'demo1234' } });
  assert.equal(modChallenge.data.mfaRequired, true);
  const modStrongLogin = await request(base, '/api/auth/mfa', { method:'POST', body:{ challenge:modChallenge.data.challenge, code:mfa.totp(modMfaSetup.data.secret) } });
  assert.equal(modStrongLogin.res.status, 200);
  const strongModToken = modStrongLogin.data.token;

  const blockedDeletion = await request(base, `/api/privacy/requests/${encodeURIComponent(deleteRequest.data.request.id)}/process`, { method:'POST', token:strongModToken, body:{} });
  assert.equal(blockedDeletion.res.status, 409);
  assert.ok(blockedDeletion.data.blockingOrganizations.includes(authorOwnOrg.id));

  // Ownership transfer unlocks anonymization; durable audit/financial evidence is preserved by policy.
  const secondOwnerAdded = await request(base, `/api/organizations/${encodeURIComponent(authorOwnOrg.id)}/members`, {
    method:'POST', token:authorToken, body:{ username:'produtora', role:'ADMIN' },
  });
  assert.equal(secondOwnerAdded.res.status, 201);
  const secondOwnerPromoted = await request(base, `/api/organizations/${encodeURIComponent(authorOwnOrg.id)}/members/produtora`, {
    method:'PATCH', token:authorToken, body:{ role:'OWNER' },
  });
  assert.equal(secondOwnerPromoted.res.status, 200);
  const completedDeletion = await request(base, `/api/privacy/requests/${encodeURIComponent(deleteRequest.data.request.id)}/process`, { method:'POST', token:strongModToken, body:{} });
  assert.equal(completedDeletion.res.status, 200);
  assert.equal(completedDeletion.data.request.status, 'COMPLETED');
  assert.ok(completedDeletion.data.result.preserved.includes('financial'));
  const deletedSessionUse = await request(base, '/api/me', { token:authorToken });
  assert.equal(deletedSessionUse.res.status, 401);

  const compliance = await request(base, `/api/organizations/${encodeURIComponent(producerOrg.id)}/compliance`, { token:strongToken, headers:commerceHeaders });
  assert.equal(compliance.res.status, 200);
  assert.equal(compliance.data.controls.financialRetentionProtected, true);
  const retentionRun = await request(base, `/api/organizations/${encodeURIComponent(producerOrg.id)}/retention/run`, { method:'POST', token:strongToken, headers:commerceHeaders, body:{} });
  assert.equal(retentionRun.res.status, 200);
  assert.ok(retentionRun.data.deleted);

  const rawAiSecretRejected = await request(base, '/api/ai/key', { method:'POST', token:strongToken, body:{ key:'AIzaSy-should-never-be-stored' } });
  assert.equal(rawAiSecretRejected.res.status, 410);
  assert.equal(rawAiSecretRejected.data.code, 'SECRET_STORAGE_DISABLED');

  // controller token must be a secret distinct from the public pairing code
  assert.notEqual(controllerToken, sessionCode);

  console.log(JSON.stringify({ ok:true, base, workId:work.id, sessionCode, checks:125 }, null, 2));
} catch (err) {
  failed = true;
  console.error(err.stack || err.message);
} finally {
  await shutdown().catch(() => {});
  if (failed) process.exitCode = 1;
}
