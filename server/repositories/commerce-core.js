const crypto = require('crypto');

const PROVIDERS = Object.freeze([
  { id:'provider-brand-direct', code:'brand_direct', name:'Brand Direct', kind:'BRAND_DIRECT', capabilities:{catalog:true,price:true,availability:true,checkout:'external'} },
  { id:'provider-custom-store', code:'custom_store', name:'Custom Store', kind:'CUSTOM_STORE', capabilities:{catalog:false,price:false,availability:false,checkout:'external'} },
  { id:'provider-private-marketplace', code:'private_marketplace', name:'Private Marketplace', kind:'MARKETPLACE', capabilities:{catalog:false,price:false,availability:false,checkout:'external'} },
  { id:'provider-amazon', code:'amazon', name:'Amazon', kind:'MARKETPLACE', capabilities:{catalog:true,price:true,availability:true,checkout:'external'} },
  { id:'provider-mercado-livre', code:'mercado_livre', name:'Mercado Livre', kind:'MARKETPLACE', capabilities:{catalog:true,price:true,availability:true,checkout:'external'} },
  { id:'provider-shopee', code:'shopee', name:'Shopee', kind:'MARKETPLACE', capabilities:{catalog:true,price:true,availability:true,checkout:'external'} },
  { id:'provider-lead', code:'lead_generation', name:'Lead Generation', kind:'LEAD_GENERATION', capabilities:{lead:true} },
  { id:'provider-dealer', code:'dealer_locator', name:'Dealer Locator', kind:'DEALER_LOCATOR', capabilities:{lead:true} },
  { id:'provider-reservation', code:'reservation', name:'Reservation', kind:'RESERVATION', capabilities:{reservation:true} },
]);

const STRATEGIES = new Set(['PRIORITY','FIRST_AVAILABLE','LOWEST_PRICE','BRAND_DIRECT_FIRST']);
const cleanText=(v,n=160)=>String(v||'').trim().slice(0,n);
const now=()=>Date.now();
const uuid=(prefix)=>`${prefix}-${crypto.randomUUID()}`;
const asArray=(v)=>Array.isArray(v)?v:[];
const territory=(v)=>cleanText(v||'GLOBAL',16).toUpperCase()||'GLOBAL';
const money=(v)=>v==null||v===''?null:Math.round(Number(v)*100)/100;
const ratio=(v)=>{const n=Number(v); return Number.isFinite(n)&&n>=0&&n<=1?n:null;};
const isHttpUrl=(v)=>{try{const u=new URL(String(v));return u.protocol==='http:'||u.protocol==='https:';}catch{return false;}};
const uniq=(a)=>[...new Set(a)];

function ensureState(s){
  s.commerceSponsors ||= {};
  s.commerceCampaigns ||= {};
  s.commerceConnections ||= {};
  s.commerceOffers ||= {};
  s.commerceRoutingPolicies ||= {};
  s.commerceResolutions ||= {};
  s.commerceActivations ||= {};
  return s;
}
function safeProvider(p){return p?{id:p.id,providerCode:p.code,name:p.name,kind:p.kind,capabilities:p.capabilities,enabled:p.enabled!==false}:null;}
function publicOffer(o,{destination=false}={}){if(!o)return null;const {destinationUrl,...rest}=o;return destination?{...rest,destinationUrl}:rest;}
function activeWindow(o,at=now()){return o.enabled!==false && (!o.activeFrom||Number(o.activeFrom)<=at) && (!o.activeUntil||Number(o.activeUntil)>=at);}
function activeCampaign(c,at=now()){return !!c && c.status==='ACTIVE' && (!c.activeFrom||Number(c.activeFrom)<=at) && (!c.activeUntil||Number(c.activeUntil)>=at);}
function territoryMatches(value,wanted){const t=territory(wanted);const v=territory(value);return v==='GLOBAL'||v===t;}
function policySpecificity(p,ctx){let n=0;if(p.placementId){if(p.placementId!==ctx.placementId)return -1;n+=32;}if(p.campaignId){if(p.campaignId!==ctx.campaignId)return -1;n+=16;}if(p.workId){if(p.workId!==ctx.workId)return -1;n+=8;}if(p.productId){if(p.productId!==ctx.productId)return -1;n+=4;}if(p.assetId){if(p.assetId!==ctx.assetId)return -1;n+=4;}if(p.territory&&territory(p.territory)!=='GLOBAL'){if(territory(p.territory)!==territory(ctx.territory))return -1;n+=2;}return n;}
function orderOffers(rows,policy,providersById){
  const strategy=policy?.strategy||'PRIORITY'; const priority=asArray(policy?.offerIds);
  const rank=new Map(priority.map((id,i)=>[id,i]));
  const arr=[...rows];
  if(strategy==='LOWEST_PRICE') return arr.sort((a,b)=>(a.price??Number.MAX_SAFE_INTEGER)-(b.price??Number.MAX_SAFE_INTEGER)||a.id.localeCompare(b.id));
  if(strategy==='BRAND_DIRECT_FIRST') return arr.sort((a,b)=>{const ak=providersById[a.providerId]?.kind==='BRAND_DIRECT'?0:1;const bk=providersById[b.providerId]?.kind==='BRAND_DIRECT'?0:1;return ak-bk||(rank.get(a.id)??9999)-(rank.get(b.id)??9999)||a.id.localeCompare(b.id);});
  if(strategy==='FIRST_AVAILABLE') return arr.sort((a,b)=>(rank.get(a.id)??9999)-(rank.get(b.id)??9999)||a.id.localeCompare(b.id));
  return arr.sort((a,b)=>(rank.get(a.id)??9999)-(rank.get(b.id)??9999)||Number(b.priority||0)-Number(a.priority||0)||a.id.localeCompare(b.id));
}

class StateCommerceCoreRepository {
  constructor(getState,save=()=>{}){this.getState=getState;this.save=save;}
  state(){return ensureState(this.getState());}
  listProviders(){return PROVIDERS.map(safeProvider);}
  createSponsor(orgId,body,actor){const s=this.state();const name=cleanText(body.name);if(name.length<2)return{errors:['Nome da marca/patrocinador é obrigatório.']};const row={id:uuid('sponsor'),organizationId:orgId,name,legalName:cleanText(body.legalName),website:cleanText(body.website,500)||null,status:'ACTIVE',createdBy:actor,createdAt:now(),updatedAt:now(),metadata:body.metadata||{}};s.commerceSponsors[row.id]=row;this.save();return{sponsor:row};}
  listSponsors(orgId){return Object.values(this.state().commerceSponsors).filter(x=>x.organizationId===orgId&&x.status!=='DELETED').sort((a,b)=>a.name.localeCompare(b.name));}
  createCampaign(orgId,body,actor){const s=this.state();const name=cleanText(body.name);if(name.length<2)return{errors:['Nome da campanha é obrigatório.']};const sponsorId=body.sponsorId||null;if(sponsorId&&(!s.commerceSponsors[sponsorId]||s.commerceSponsors[sponsorId].organizationId!==orgId))return{errors:['Patrocinador não pertence à organização.']};const assetIds=uniq(asArray(body.assetIds).map(String));if(assetIds.some(id=>!s.aiCommercialAssets[id]||s.aiCommercialAssets[id].organizationId!==orgId))return{errors:['A campanha contém CommercialAsset de outra organização ou inexistente.']};const row={id:uuid('campaign'),organizationId:orgId,sponsorId,name,status:String(body.status||'DRAFT').toUpperCase(),activeFrom:body.activeFrom?Number(body.activeFrom):null,activeUntil:body.activeUntil?Number(body.activeUntil):null,territories:uniq(asArray(body.territories).map(territory)),productIds:uniq(asArray(body.productIds).map(String)),assetIds,policy:body.policy||{},createdBy:actor,createdAt:now(),updatedAt:now()};if(!['DRAFT','ACTIVE','PAUSED','ENDED'].includes(row.status))return{errors:['Status de campanha inválido.']};s.commerceCampaigns[row.id]=row;this.save();return{campaign:row};}
  listCampaigns(orgId){return Object.values(this.state().commerceCampaigns).filter(x=>x.organizationId===orgId).sort((a,b)=>b.createdAt-a.createdAt);}
  createConnection(orgId,body,actor){const s=this.state();const provider=PROVIDERS.find(p=>p.code===body.providerCode||p.id===body.providerId);if(!provider)return{errors:['Commerce Provider inválido.']};const row={id:uuid('conn'),organizationId:orgId,providerId:provider.id,providerCode:provider.code,label:cleanText(body.label)||provider.name,status:String(body.status||'ACTIVE').toUpperCase(),credentialsRef:cleanText(body.credentialsRef,500)||null,config:body.config||{},createdBy:actor,createdAt:now(),updatedAt:now()};s.commerceConnections[row.id]=row;this.save();return{connection:row};}
  listConnections(orgId){return Object.values(this.state().commerceConnections).filter(x=>x.organizationId===orgId).map(x=>({...x,provider:safeProvider(PROVIDERS.find(p=>p.id===x.providerId))}));}
  createOffer(orgId,body,actor){const s=this.state();const c=s.commerceConnections[body.connectionId];if(!c||c.organizationId!==orgId)return{errors:['Conexão comercial não pertence à organização.']};if(!body.productId&&!body.assetId)return{errors:['Informe productId ou assetId.']};if(body.assetId&&(!s.aiCommercialAssets[body.assetId]||s.aiCommercialAssets[body.assetId].organizationId!==orgId))return{errors:['CommercialAsset não pertence à organização.']};if(!isHttpUrl(body.destinationUrl))return{errors:['Destino deve usar HTTP ou HTTPS.']};const commission=body.commissionRate==null?null:ratio(body.commissionRate);if(body.commissionRate!=null&&commission==null)return{errors:['Comissão deve estar entre 0 e 1.']};const row={id:uuid('offer'),organizationId:orgId,productId:body.productId||null,assetId:body.assetId||null,connectionId:c.id,providerId:c.providerId,externalProductId:cleanText(body.externalProductId,200)||null,destinationUrl:String(body.destinationUrl),cta:cleanText(body.cta,60)||'BUY',price:money(body.price),currency:cleanText(body.currency||'BRL',3).toUpperCase(),availability:String(body.availability||'AVAILABLE').toUpperCase(),territory:territory(body.territory),commissionRate:commission,activeFrom:body.activeFrom?Number(body.activeFrom):null,activeUntil:body.activeUntil?Number(body.activeUntil):null,priority:Number(body.priority)||0,enabled:body.enabled!==false,metadata:body.metadata||{},createdBy:actor,createdAt:now(),updatedAt:now()};s.commerceOffers[row.id]=row;this.save();return{offer:publicOffer(row,{destination:true})};}
  listOffers(orgId){return Object.values(this.state().commerceOffers).filter(x=>x.organizationId===orgId).map(x=>publicOffer(x,{destination:true}));}
  createRoutingPolicy(orgId,body,actor){const s=this.state();const strategy=String(body.strategy||'PRIORITY').toUpperCase();if(!STRATEGIES.has(strategy))return{errors:['Estratégia de roteamento inválida.']};const offerIds=uniq(asArray(body.offerIds).map(String));if(offerIds.some(id=>!s.commerceOffers[id]||s.commerceOffers[id].organizationId!==orgId))return{errors:['A política contém oferta de outra organização ou inexistente.']};if(body.assetId&&(!s.aiCommercialAssets[body.assetId]||s.aiCommercialAssets[body.assetId].organizationId!==orgId))return{errors:['CommercialAsset não pertence à organização.']};const row={id:uuid('route'),organizationId:orgId,workId:body.workId||null,campaignId:body.campaignId||null,placementId:body.placementId||null,productId:body.productId||null,assetId:body.assetId||null,territory:territory(body.territory),strategy,offerIds,enabled:body.enabled!==false,rules:body.rules||{},createdBy:actor,createdAt:now(),updatedAt:now()};s.commerceRoutingPolicies[row.id]=row;this.save();return{policy:row};}
  listRoutingPolicies(orgId){return Object.values(this.state().commerceRoutingPolicies).filter(x=>x.organizationId===orgId);}
  _resolve(orgId,ctx,{persist=true,viewerDevice=null}={}){const s=this.state();const at=now();const wantedTerr=territory(ctx.territory);const campaign=ctx.campaignId?s.commerceCampaigns[ctx.campaignId]:null;if(campaign&&campaign.organizationId!==orgId)return{error:'Campanha não pertence à organização.',code:404};if(campaign&&!activeCampaign(campaign,at))return{error:'Campanha não está ativa.',code:409};if(campaign){const constrained=(campaign.productIds||[]).length||(campaign.assetIds||[]).length;if(constrained&&!((ctx.productId&&(campaign.productIds||[]).includes(ctx.productId))||(ctx.assetId&&(campaign.assetIds||[]).includes(ctx.assetId))))return{error:'Produto/ativo não autorizado nesta campanha.',code:409};}let offers=Object.values(s.commerceOffers).filter(o=>o.organizationId===orgId&&(o.productId===ctx.productId||o.assetId===ctx.assetId)&&activeWindow(o,at)&&territoryMatches(o.territory,wantedTerr)&&['AVAILABLE','IN_STOCK','UNKNOWN'].includes(o.availability));offers=offers.filter(o=>{const c=s.commerceConnections[o.connectionId];return c&&c.status==='ACTIVE';});const policies=Object.values(s.commerceRoutingPolicies).filter(p=>p.organizationId===orgId&&p.enabled!==false).map(p=>({p,score:policySpecificity(p,{...ctx,territory:wantedTerr})})).filter(x=>x.score>=0).sort((a,b)=>b.score-a.score||b.p.updatedAt-a.p.updatedAt);const policy=policies[0]?.p||null;if(policy?.offerIds?.length)offers=offers.filter(o=>policy.offerIds.includes(o.id));const providersById=Object.fromEntries(PROVIDERS.map(p=>[p.id,p]));const ordered=orderOffers(offers,policy,providersById);if(!ordered.length)return{error:'Nenhuma oferta elegível para este contexto.',code:404};const resolution={id:uuid('resolution'),organizationId:orgId,productId:ctx.productId||null,assetId:ctx.assetId||null,workId:ctx.workId||null,placementId:ctx.placementId||null,campaignId:ctx.campaignId||null,territory:wantedTerr,policyId:policy?.id||null,strategy:policy?.strategy||'PRIORITY',viewerHash:viewerDevice?crypto.createHash('sha256').update(String(viewerDevice)).digest('hex'):null,createdAt:at,expiresAt:at+30*60*1000,offers:ordered.map((o,i)=>({position:i,offerId:o.id,providerId:o.providerId,connectionId:o.connectionId,price:o.price,currency:o.currency,cta:o.cta,commissionRate:o.commissionRate,territory:o.territory,availability:o.availability}))};if(persist){s.commerceResolutions[resolution.id]=resolution;this.save();}return{resolution,offers:ordered.map(o=>({...publicOffer(o),provider:safeProvider(providersById[o.providerId]),activationUrl:`/api/commerce/activations/${resolution.id}/${o.id}`}))};}
  resolve(orgId,ctx,opts={}){return this._resolve(orgId,ctx,{...opts,persist:true});}
  preview(orgId,ctx){return this._resolve(orgId,ctx,{persist:false});}
  activate(resolutionId,offerId,meta={}){const s=this.state();const r=s.commerceResolutions[resolutionId];if(!r||r.expiresAt<now())return{error:'Resolução expirada ou inexistente.',code:404};if(!r.offers.some(x=>x.offerId===offerId))return{error:'Oferta não pertence a esta resolução.',code:404};const o=s.commerceOffers[offerId];if(!o||!isHttpUrl(o.destinationUrl))return{error:'Destino comercial inválido.',code:409};const a={id:uuid('activation'),resolutionId,offerId,organizationId:r.organizationId,productId:r.productId,workId:r.workId,placementId:r.placementId,campaignId:r.campaignId,territory:r.territory,viewerHash:r.viewerHash||null,occurredAt:now(),metadata:meta||{}};s.commerceActivations[a.id]=a;this.save();return{activation:a,destinationUrl:o.destinationUrl};}
}

module.exports={PROVIDERS,STRATEGIES,StateCommerceCoreRepository,safeProvider,publicOffer,activeWindow,activeCampaign,territoryMatches,policySpecificity,orderOffers,isHttpUrl,ensureState};
