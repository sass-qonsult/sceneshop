const store = require("../store");
const { StateIdentityRepository } = require("./identity");
const { PostgresIdentityRepository } = require("./identity-postgres");
const { PostgresContentRepository } = require("./content-postgres");
const { PostgresPlaybackRepository } = require("./playback-postgres");
const { StateOrganizationRepository } = require("./organization");
const { PostgresOrganizationRepository } = require("./organization-postgres");
const { StateCommerceCoreRepository } = require('./commerce-core');
const { PostgresCommerceCoreRepository } = require('./commerce-core-postgres');
const { StatePaymentRepository } = require('./payments');
const { PostgresPaymentRepository } = require('./payments-postgres');
const { StateDistributionRepository } = require('./distribution');
const { PostgresDistributionRepository } = require('./distribution-postgres');
const { StateAiPipelineRepository } = require('./ai-pipeline');
const { PostgresAiPipelineRepository } = require('./ai-pipeline-postgres');
const { StatePrivacyRepository } = require('./privacy');
const { PostgresPrivacyRepository } = require('./privacy-postgres');
const crypto = require("crypto");
const catalog = require("../catalog");

const stateIdentity = new StateIdentityRepository(() => store.state, () => store.save());
const postgresIdentity = new PostgresIdentityRepository({ store });
const postgresContent = new PostgresContentRepository({ store });
const postgresPlayback = new PostgresPlaybackRepository({ store });
const stateOrganizations = new StateOrganizationRepository(() => store.state, () => store.save());
const postgresOrganizations = new PostgresOrganizationRepository({ store });
const stateCommerce = new StateCommerceCoreRepository(() => store.state, () => store.save());
const postgresCommerce = new PostgresCommerceCoreRepository({ store });
const statePayments = new StatePaymentRepository(() => store.state, () => store.save());
const postgresPayments = new PostgresPaymentRepository({ store });
const stateDistribution = new StateDistributionRepository(() => store.state, () => store.save());
const postgresDistribution = new PostgresDistributionRepository({ store });
const stateAi = new StateAiPipelineRepository(() => store.state, () => store.save());
const postgresAi = new PostgresAiPipelineRepository({ store });
const statePrivacy = new StatePrivacyRepository(() => store.state, () => store.save());
const postgresPrivacy = new PostgresPrivacyRepository({ store });

function impl() {
  return store.backendKind() === "postgres" ? postgresIdentity : stateIdentity;
}

const identity = {
  normalizeUsername: (v) => stateIdentity.normalizeUsername(v),
  findAccount: (v) => stateIdentity.findAccount(v), // compatibility-only synchronous view
  findAuthor: (v) => stateIdentity.findAuthor(v),   // compatibility-only synchronous view
  existsUsername: (v) => stateIdentity.existsUsername(v),
  createIdentity: (v) => stateIdentity.createIdentity(v),
  incrementTokenVersion: (v) => stateIdentity.incrementTokenVersion(v),

  findAccountAuthoritative: (v) => impl().findAccountAuthoritative ? impl().findAccountAuthoritative(v) : impl().findAccount(v),
  findAuthorAuthoritative: (v) => impl().findAuthorAuthoritative ? impl().findAuthorAuthoritative(v) : impl().findAuthor(v),
  existsUsernameAuthoritative: (v) => impl().existsUsernameAuthoritative ? impl().existsUsernameAuthoritative(v) : impl().existsUsername(v),
  createIdentityAuthoritative: (v) => impl().createIdentityAuthoritative ? impl().createIdentityAuthoritative(v) : impl().createIdentity(v),
  incrementTokenVersionAuthoritative: (v, opts) => impl().incrementTokenVersionAuthoritative ? impl().incrementTokenVersionAuthoritative(v, opts) : impl().incrementTokenVersion(v),
  submitAuthorKycAuthoritative: (v) => impl().submitAuthorKycAuthoritative ? impl().submitAuthorKycAuthoritative(v) : impl().submitAuthorKyc(v),
  decideAuthorKycAuthoritative: (id, status, opts) => impl().decideAuthorKycAuthoritative ? impl().decideAuthorKycAuthoritative(id, status, opts) : impl().decideAuthorKyc(id, status, opts),
  listPendingKycAuthoritative: () => impl().listPendingKycAuthoritative ? impl().listPendingKycAuthoritative() : impl().listPendingKyc(),
  createSession: (v) => impl().createSession(v),
  verifyPrincipal: (v) => impl().verifyPrincipal(v),
  publicPrincipal: (v) => impl().publicPrincipal(v),
  getMfaAuthoritative: (u) => impl().getMfa ? impl().getMfa(u) : null,
  saveMfaSetupAuthoritative: (u,r) => impl().saveMfaSetup ? impl().saveMfaSetup(u,r) : null,
  enableMfaAuthoritative: (u) => impl().enableMfa ? impl().enableMfa(u) : null,
  disableMfaAuthoritative: (u) => impl().disableMfa ? impl().disableMfa(u) : null,
  listSessionsAuthoritative: (u) => impl().listSessions ? impl().listSessions(u) : [],
  adminUpdateAccountAuthoritative: (u, patch) => impl().adminUpdateAccount(u, patch),
  revokeSessionAuthoritative: (u,sid,reason) => impl().revokeSession ? impl().revokeSession(u,sid,reason) : false,
};

// aliases used by the PostgreSQL implementation itself
PostgresIdentityRepository.prototype.findAccountAuthoritative = PostgresIdentityRepository.prototype.findAccount;
PostgresIdentityRepository.prototype.findAuthorAuthoritative = PostgresIdentityRepository.prototype.findAuthor;
PostgresIdentityRepository.prototype.existsUsernameAuthoritative = PostgresIdentityRepository.prototype.existsUsername;
PostgresIdentityRepository.prototype.createIdentityAuthoritative = PostgresIdentityRepository.prototype.createIdentity;
PostgresIdentityRepository.prototype.incrementTokenVersionAuthoritative = PostgresIdentityRepository.prototype.incrementTokenVersion;
PostgresIdentityRepository.prototype.submitAuthorKycAuthoritative = PostgresIdentityRepository.prototype.submitAuthorKyc;
PostgresIdentityRepository.prototype.decideAuthorKycAuthoritative = PostgresIdentityRepository.prototype.decideAuthorKyc;
PostgresIdentityRepository.prototype.listPendingKycAuthoritative = PostgresIdentityRepository.prototype.listPendingKyc;


function contentImpl() {
  return store.backendKind() === "postgres" ? postgresContent : null;
}

const content = {
  getWorkAuthoritative: (id) => contentImpl() ? contentImpl().getWork(id) : catalog.getWork(id),
  listWorksAuthoritative: () => contentImpl() ? contentImpl().listWorks() : catalog.listWorks(),
  listWorksByOwnerAuthoritative: (ownerId) => contentImpl() ? contentImpl().listWorksByOwner(ownerId) : Object.values(store.state.userWorks || {}).filter((w) => w.ownerId === ownerId),
  listWorksByOrganizationAuthoritative: (organizationId) => contentImpl() ? contentImpl().listWorksByOrganization(organizationId) : Object.values(store.state.userWorks || {}).filter((w) => w.organizationId === organizationId),
  getWorkForOrganizationAuthoritative: (id, organizationId) => contentImpl() ? contentImpl().getWorkForOrganization(id, organizationId) : (() => { const w=catalog.getWork(id); return w && w.organizationId===organizationId ? w : null; })(),
  createWorkAuthoritative: async (work, partnerIds=[]) => {
    const normalized = { ...work, syncId: work.syncId || `SYNC-${crypto.randomBytes(10).toString("hex").toUpperCase()}` };
    if (contentImpl()) { const w = await contentImpl().createWork(normalized, partnerIds); catalog.addWork(w); return w; }
    store.state.userWorks[normalized.id]=normalized; store.state.workPartners[normalized.id]=[...partnerIds]; catalog.addWork(normalized); store.save(); return normalized;
  },
  getProductAuthoritative: (id) => contentImpl() ? contentImpl().getProduct(id) : catalog.getProduct(id),
  listProductsAuthoritative: () => contentImpl() ? contentImpl().listProducts() : catalog.listProducts(),
  searchPublicProductsAuthoritative: (q) => {
    if (contentImpl()) return contentImpl().searchPublicProducts(q);
    const norm=(x)=>String(x||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,''); const words=norm(q).split(/\s+/).filter(Boolean);
    return catalog.listProducts().filter((p)=>!p.organizationId&&words.every((w)=>norm(`${p.name} ${p.brand} ${p.category} ${p.sku||''}`).includes(w))).slice(0,30);
  },
  getPublicProductAuthoritative: (id) => contentImpl() ? contentImpl().getPublicProduct(id) : (() => { const p=catalog.getProduct(id); return p && !p.organizationId ? p : null; })(),
  searchProductsAuthoritative: (q, ownerId) => contentImpl() ? contentImpl().searchProducts(q, ownerId) : catalog.searchProducts(q, ownerId),
  listProductsByOwnerAuthoritative: (ownerId) => contentImpl() ? contentImpl().listProductsByOwner(ownerId) : Object.values(store.state.userProducts || {}).filter((p) => p.createdBy === ownerId),
  listProductsByOrganizationAuthoritative: (organizationId) => contentImpl() ? contentImpl().listProductsByOrganization(organizationId) : Object.values(store.state.userProducts || {}).filter((p) => p.organizationId === organizationId),
  searchProductsForOrganizationAuthoritative: (q, organizationId) => {
    if (contentImpl()) return contentImpl().searchProductsForOrganization(q, organizationId);
    const norm=(x)=>String(x||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,''); const words=norm(q).split(/\s+/).filter(Boolean);
    return catalog.listProducts().filter((p)=>(!p.organizationId||p.organizationId===organizationId)&&words.every((w)=>norm(`${p.name} ${p.brand} ${p.category} ${p.sku||''}`).includes(w))).sort((a,b)=>(b.organizationId===organizationId)-(a.organizationId===organizationId)).slice(0,30);
  },
  getProductForOrganizationAuthoritative: (id, organizationId, opts={}) => {
    if (contentImpl()) return contentImpl().getProductForOrganization(id, organizationId, opts);
    const p=catalog.getProduct(id); if (!p) return null; const allowGlobal=opts.allowGlobal!==false;
    return p.organizationId===organizationId || (allowGlobal && !p.organizationId) ? p : null;
  },
  createProductAuthoritative: async (product) => {
    if (contentImpl()) { const p = await contentImpl().createProduct(product); catalog.addProduct(p); return p; }
    store.state.userProducts[product.id]=product; catalog.addProduct(product); store.save(); return product;
  },
  updateProductAuthoritative: async (product) => {
    if (contentImpl()) { const p = await contentImpl().updateProduct(product); catalog.addProduct(p); return p; }
    store.state.userProducts[product.id]=product; catalog.addProduct(product); store.save(); return product;
  },
  getTrackAuthoritative: (id) => contentImpl() ? contentImpl().getTrack(id) : (store.state.tracks[id] || null),
  listTracksByWorkAuthoritative: (workId) => contentImpl() ? contentImpl().listTracksByWork(workId) : Object.values(store.state.tracks || {}).filter((t) => t.workId === workId),
  listTracksByAuthorAuthoritative: (authorId, workId=null) => contentImpl() ? contentImpl().listTracksByAuthor(authorId, workId) : Object.values(store.state.tracks || {}).filter((t) => t.authorId===authorId && (!workId || t.workId===workId)),
  listTracksByOrganizationAuthoritative: (organizationId, workId=null) => contentImpl() ? contentImpl().listTracksByOrganization(organizationId, workId) : Object.values(store.state.tracks || {}).filter((t) => t.organizationId===organizationId && (!workId || t.workId===workId)),
  getTrackForOrganizationAuthoritative: (id, organizationId) => contentImpl() ? contentImpl().getTrackForOrganization(id, organizationId) : (() => { const t=store.state.tracks[id]; return t && t.organizationId===organizationId ? t : null; })(),
  listOfficialProductIdsByOrganizationAuthoritative: (organizationId) => {
    if (contentImpl()) return contentImpl().listOfficialProductIdsByOrganization(organizationId);
    const ids=new Set(Object.values(store.state.tracks||{}).filter((t)=>t.organizationId===organizationId&&t.type==='official'&&t.status!=='removida').flatMap((t)=>(t.scenes||[]).flatMap((sc)=>(sc.products||[]).map((x)=>x.id))));
    Object.values(store.state.userProducts||{}).filter((p)=>p.organizationId===organizationId).forEach((p)=>ids.add(p.id)); return [...ids].sort();
  },
  organizationOwnsOfficialProductAuthoritative: (organizationId, productId) => {
    if (contentImpl()) return contentImpl().organizationOwnsOfficialProduct(organizationId, productId);
    const created=(store.state.userProducts[productId]||{}).organizationId===organizationId;
    const tracked=Object.values(store.state.tracks||{}).some((t)=>t.organizationId===organizationId&&t.type==='official'&&t.status!=='removida'&&(t.scenes||[]).some((sc)=>(sc.products||[]).some((x)=>x.id===productId)));
    return created||tracked;
  },
  listOfficialProductIdsByAuthorAuthoritative: (authorId) => {
    if (contentImpl()) return contentImpl().listOfficialProductIdsByAuthor(authorId);
    const ids = new Set(
      Object.values(store.state.tracks || {})
        .filter((t) => t.authorId === authorId && t.type === 'official' && t.status !== 'removida')
        .flatMap((t) => (t.scenes || []).flatMap((sc) => (sc.products || []).map((x) => x.id)))
    );
    Object.values(store.state.userProducts || {}).filter((p) => p.createdBy === authorId).forEach((p) => ids.add(p.id));
    return [...ids].sort();
  },
  authorOwnsOfficialProductAuthoritative: (authorId, productId) => {
    if (contentImpl()) return contentImpl().authorOwnsOfficialProduct(authorId, productId);
    const created = (store.state.userProducts[productId] || {}).createdBy === authorId;
    const tracked = Object.values(store.state.tracks || {}).some((t) =>
      t.authorId === authorId && t.type === 'official' && t.status !== 'removida' &&
      (t.scenes || []).some((sc) => (sc.products || []).some((x) => x.id === productId))
    );
    return created || tracked;
  },
  saveTrackAuthoritative: async (track, topic) => {
    if (contentImpl()) return contentImpl().saveTrack(track, topic);
    store.state.tracks[track.id]=track; store.save(); return track;
  },
  publishTrackAsCommerceTrack: (trackId, actor, organizationId=null) => contentImpl() ? contentImpl().publishTrackAsCommerceTrack(trackId, actor, organizationId) : null,
  getPublishedTimeline: (workId) => contentImpl() ? contentImpl().getPublishedTimeline(workId) : (() => {
    const t=Object.values(store.state.tracks||{}).filter((x)=>x.workId===workId&&x.type==='official'&&x.status==='ativa').sort((a,b)=>Number(b.updatedAt||b.createdAt||0)-Number(a.updatedAt||a.createdAt||0))[0];
    if(!t)return null;
    return {workId,publicationId:`state:${t.id}`,revision:1,organizationId:t.organizationId||null,publishedAt:t.updatedAt||t.createdAt||null,manifest:{sourceTrackId:t.id},policy:{visibility:'PAST_AND_CURRENT',thumbnailsEnabled:true,missedItemsEnabled:true,allowSceneSeek:false,metadata:{}},scenes:(t.scenes||[]).map((sc)=>({sceneId:sc.id,start:Number(sc.start||0),end:Number(sc.end||0),thumbnail:sc.thumb||null,products:(sc.products||[]).map((p)=>({placementId:`${t.id}:${sc.id}:${p.id}`,assetId:null,productId:p.id,name:(catalog.getProduct(p.id)||{}).name||p.id,brand:(catalog.getProduct(p.id)||{}).brand||null,priority:0,policy:{}}))}))};
  })(),
};


function organizationImpl() {
  return store.backendKind() === "postgres" ? postgresOrganizations : stateOrganizations;
}

const organizations = {
  listForUser: (username) => organizationImpl().listForUser(username),
  get: (orgId) => organizationImpl().get(orgId),
  getMembership: (orgId, username) => organizationImpl().getMembership(orgId, username),
  create: (body, actor) => organizationImpl().create(body, actor),
  listMembers: (orgId) => organizationImpl().listMembers(orgId),
  updateSettings: (orgId, patch) => organizationImpl().updateSettings(orgId, patch),
  addMember: (orgId, username, role, actor) => organizationImpl().addMember(orgId, username, role, actor),
  setMemberRole: (orgId, username, role) => organizationImpl().setMemberRole(orgId, username, role),
  removeMember: (orgId, username) => organizationImpl().removeMember(orgId, username),
  createInvite: (orgId, body, actor) => organizationImpl().createInvite(orgId, body, actor),
  listInvites: (orgId) => organizationImpl().listInvites(orgId),
  revokeInvite: (orgId, inviteId) => organizationImpl().revokeInvite(orgId, inviteId),
  acceptInvite: (token, username) => organizationImpl().acceptInvite(token, username),
};


function commerceImpl(){ return store.backendKind() === "postgres" ? postgresCommerce : stateCommerce; }
const commerce = {
  listProviders: () => commerceImpl().listProviders(),
  createSponsor: (orgId,body,actor) => commerceImpl().createSponsor(orgId,body,actor),
  listSponsors: (orgId) => commerceImpl().listSponsors(orgId),
  createCampaign: (orgId,body,actor) => commerceImpl().createCampaign(orgId,body,actor),
  listCampaigns: (orgId) => commerceImpl().listCampaigns(orgId),
  createConnection: (orgId,body,actor) => commerceImpl().createConnection(orgId,body,actor),
  listConnections: (orgId) => commerceImpl().listConnections(orgId),
  createOffer: (orgId,body,actor) => commerceImpl().createOffer(orgId,body,actor),
  listOffers: (orgId) => commerceImpl().listOffers(orgId),
  createRoutingPolicy: (orgId,body,actor) => commerceImpl().createRoutingPolicy(orgId,body,actor),
  listRoutingPolicies: (orgId) => commerceImpl().listRoutingPolicies(orgId),
  resolve: (orgId,ctx,opts) => commerceImpl().resolve(orgId,ctx,opts),
  preview: (orgId,ctx) => commerceImpl().preview(orgId,ctx),
  activate: (resolutionId,offerId,meta) => commerceImpl().activate(resolutionId,offerId,meta),
};


function paymentsImpl(){ return store.backendKind() === 'postgres' ? postgresPayments : statePayments; }
const payments = {
  listProviders: () => paymentsImpl().listProviders(),
  createConnection: (orgId,body,actor) => paymentsImpl().createConnection(orgId,body,actor),
  listConnections: (orgId) => paymentsImpl().listConnections(orgId),
  createIntent: (orgId,body,actor,key) => paymentsImpl().createIntent(orgId,body,actor,key),
  getIntent: (orgId,id) => paymentsImpl().getIntent(orgId,id),
  listIntents: (orgId) => paymentsImpl().listIntents(orgId),
  ingestEvent: (orgId,connectionId,event,rawBody) => paymentsImpl().ingestEvent(orgId,connectionId,event,rawBody),
  listJournal: (orgId) => paymentsImpl().listJournal(orgId),
  postJournal: (orgId,args) => paymentsImpl().postJournal(orgId,args),
  requestRefund: (orgId,body,actor,key) => paymentsImpl().requestRefund(orgId,body,actor,key),
  recordSettlement: (orgId,body,actor,key) => paymentsImpl().recordSettlement(orgId,body,actor,key),
  requestPayout: (orgId,body,actor,key) => paymentsImpl().requestPayout(orgId,body,actor,key),
  markPayoutPaid: (orgId,id,body,actor) => paymentsImpl().markPayoutPaid(orgId,id,body,actor),
  reconcile: (orgId,body,actor) => paymentsImpl().reconcile(orgId,body,actor),
  listReconciliation: (orgId) => paymentsImpl().listReconciliation(orgId),
  listPayouts: (orgId) => paymentsImpl().listPayouts(orgId),
  listSettlements: (orgId) => paymentsImpl().listSettlements(orgId),
  accountBalance: (orgId,code,partyId) => paymentsImpl().accountBalance(orgId,code,partyId),
};


function aiImpl(){ return store.backendKind() === 'postgres' ? postgresAi : stateAi; }
const ai = {
  listAssets: (...a) => aiImpl().listAssets(...a),
  getAsset: (...a) => aiImpl().getAsset(...a),
  createAsset: (...a) => aiImpl().createAsset(...a),
  addReference: (...a) => aiImpl().addReference(...a),
  createJob: (...a) => aiImpl().createJob(...a),
  getJob: (...a) => aiImpl().getJob(...a),
  listJobs: (...a) => aiImpl().listJobs(...a),
  startJob: (...a) => aiImpl().startJob(...a),
  failJob: (...a) => aiImpl().failJob(...a),
  completeJob: (...a) => aiImpl().completeJob(...a),
  recordPrimaryCandidate: (...a) => aiImpl().recordPrimaryCandidate(...a),
  recordPrimaryBatch: (...a) => aiImpl().recordPrimaryBatch(...a),
  listCandidates: (...a) => aiImpl().listCandidates(...a),
  getCandidate: (...a) => aiImpl().getCandidate(...a),
  recordRedundantVerification: (...a) => aiImpl().recordRedundantVerification(...a),
  listVerifications: (...a) => aiImpl().listVerifications(...a),
  listOperatorFlags: (...a) => aiImpl().listOperatorFlags(...a),
  reviewCandidate: (...a) => aiImpl().reviewCandidate(...a),
  resolveOperatorFlag: (...a) => aiImpl().resolveOperatorFlag(...a),
  listPlacements: (...a) => aiImpl().listPlacements(...a),
};

const playback = {
  createSession: (s) => postgresPlayback.createSession(s),
  checkpoint: (s) => postgresPlayback.checkpoint(s),
  recordSync: (s,o) => postgresPlayback.recordSync(s,o),
};


function distributionImpl(){ return store.backendKind() === "postgres" ? postgresDistribution : stateDistribution; }
const distribution = {
  listBindings: (...a) => distributionImpl().listBindings(...a),
  getBinding: (...a) => distributionImpl().getBinding(...a),
  listBindingsForWork: (...a) => distributionImpl().listBindingsForWork(...a),
  findBindingByExternal: (...a) => distributionImpl().findBindingByExternal(...a),
  createBinding: (...a) => distributionImpl().createBinding(...a),
  updateBinding: (...a) => distributionImpl().updateBinding(...a),
  createPlatformConnection: (...a) => distributionImpl().createPlatformConnection(...a),
  listPlatformConnections: (...a) => distributionImpl().listPlatformConnections(...a),
  getPlatformConnection: (...a) => distributionImpl().getPlatformConnection(...a),
  updatePlatformConnection: (...a) => distributionImpl().updatePlatformConnection(...a),
  refreshBindingMetadata: (...a) => distributionImpl().refreshBindingMetadata(...a),
  getTimelinePolicy: (...a) => distributionImpl().getTimelinePolicy(...a),
  setTimelinePolicy: (...a) => distributionImpl().setTimelinePolicy(...a),
  importSyncIndex: (...a) => distributionImpl().importSyncIndex(...a),
  recognize: (...a) => distributionImpl().recognize(...a),
  createSdkKey: (...a) => distributionImpl().createSdkKey(...a),
  listSdkKeys: (...a) => distributionImpl().listSdkKeys(...a),
  revokeSdkKey: (...a) => distributionImpl().revokeSdkKey(...a),
  authenticateSdkKey: (...a) => distributionImpl().authenticateSdkKey(...a),
  recordEvent: (...a) => distributionImpl().recordEvent(...a),
};


function privacyImpl(){ return store.backendKind()==='postgres' ? postgresPrivacy : statePrivacy; }
const privacy = {
  getUser: (u)=>privacyImpl().getUser(u), setUser:(u,b)=>privacyImpl().setUser(u,b), setDevice:(h,b)=>privacyImpl().setDevice(h,b),
  createRequest:(u,b)=>privacyImpl().createRequest(u,b), listRequests:(u)=>privacyImpl().listRequests(u),
  getRequest:(id)=>privacyImpl().getRequest(id), listAllRequests:()=>privacyImpl().listAllRequests(),
  exportUser:(u)=>privacyImpl().exportUser(u), anonymizeUser:(u)=>privacyImpl().anonymizeUser(u),
  runRetention:(orgId,at)=>privacyImpl().runRetention(orgId,at), complianceReport:(orgId)=>privacyImpl().complianceReport(orgId),
  completeRequest:(id,patch)=>privacyImpl().completeRequest(id,patch),
  getRetention:(orgId)=>privacyImpl().getRetention(orgId), setRetention:(orgId,b,actor)=>privacyImpl().setRetention(orgId,b,actor),
};
module.exports = { identity, content, organizations, commerce, payments, ai, playback, distribution, privacy, StateIdentityRepository, PostgresIdentityRepository, PostgresContentRepository, PostgresPlaybackRepository, StateOrganizationRepository, PostgresOrganizationRepository, StateDistributionRepository, PostgresDistributionRepository };
