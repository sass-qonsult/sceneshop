const express = require('express');
const crypto = require('crypto');
const { commerce, content } = require('./repositories');
const audit = require('./audit');

const cleanTerritory = (v) => String(v || 'GLOBAL').trim().toUpperCase().slice(0,16) || 'GLOBAL';
const reply = (res,r,ok=200) => { const { code, ...body } = r || {}; res.status((r && (r.error||r.errors)) ? (code||400) : ok).json(body); };
const actor = (req) => req.user ? req.user.username : 'anônimo';

function publicViewerId(req) {
  return String((req.body||{}).deviceId || req.headers['x-sceneshop-device'] || req.ip || '').slice(0,256) || null;
}

function routes({ requireRole, orgAccess }) {
  const r=express.Router();

  r.get('/api/commerce/providers', requireRole(), orgAccess.requireCapability('COMMERCE_READ'), async (req,res,next)=>{
    try { res.json(await Promise.resolve(commerce.listProviders())); } catch(e){ next(e); }
  });

  r.get('/api/commerce/sponsors', requireRole(), orgAccess.requireCapability('COMMERCE_READ'), async (req,res,next)=>{
    try { res.json(await Promise.resolve(commerce.listSponsors(req.organization.id))); } catch(e){ next(e); }
  });
  r.post('/api/commerce/sponsors', requireRole(), orgAccess.requireCapability('COMMERCE_WRITE'), async (req,res,next)=>{
    try { const out=await Promise.resolve(commerce.createSponsor(req.organization.id,req.body||{},actor(req))); if(out.sponsor)audit.log(actor(req),'commerce_sponsor_created',{organizationId:req.organization.id,sponsorId:out.sponsor.id}); reply(res,out,201); } catch(e){ next(e); }
  });

  r.get('/api/commerce/campaigns', requireRole(), orgAccess.requireCapability('COMMERCE_READ'), async (req,res,next)=>{
    try { res.json(await Promise.resolve(commerce.listCampaigns(req.organization.id))); } catch(e){ next(e); }
  });
  r.post('/api/commerce/campaigns', requireRole(), orgAccess.requireCapability('COMMERCE_WRITE'), async (req,res,next)=>{
    try { const out=await Promise.resolve(commerce.createCampaign(req.organization.id,req.body||{},actor(req))); if(out.campaign)audit.log(actor(req),'commerce_campaign_created',{organizationId:req.organization.id,campaignId:out.campaign.id}); reply(res,out,201); } catch(e){ next(e); }
  });

  r.get('/api/commerce/connections', requireRole(), orgAccess.requireCapability('COMMERCE_READ'), async (req,res,next)=>{
    try { res.json(await Promise.resolve(commerce.listConnections(req.organization.id))); } catch(e){ next(e); }
  });
  r.post('/api/commerce/connections', requireRole(), orgAccess.requireCapability('COMMERCE_WRITE'), async (req,res,next)=>{
    try { const out=await Promise.resolve(commerce.createConnection(req.organization.id,req.body||{},actor(req))); if(out.connection)audit.log(actor(req),'commerce_connection_created',{organizationId:req.organization.id,connectionId:out.connection.id,providerCode:out.connection.providerCode}); reply(res,out,201); } catch(e){ next(e); }
  });

  r.get('/api/commerce/offers', requireRole(), orgAccess.requireCapability('COMMERCE_READ'), async (req,res,next)=>{
    try { res.json(await Promise.resolve(commerce.listOffers(req.organization.id))); } catch(e){ next(e); }
  });
  r.post('/api/commerce/offers', requireRole(), orgAccess.requireCapability('COMMERCE_WRITE'), async (req,res,next)=>{
    try {
      const b=req.body||{};
      if(b.productId){ const p=await Promise.resolve(content.getProductForOrganizationAuthoritative(b.productId,req.organization.id,{allowGlobal:true})); if(!p)return res.status(404).json({error:'Produto não encontrado para esta organização.'}); }
      const out=await Promise.resolve(commerce.createOffer(req.organization.id,b,actor(req))); if(out.offer)audit.log(actor(req),'commerce_offer_created',{organizationId:req.organization.id,offerId:out.offer.id,productId:out.offer.productId,providerId:out.offer.providerId}); reply(res,out,201);
    } catch(e){ next(e); }
  });

  r.get('/api/commerce/routing-policies', requireRole(), orgAccess.requireCapability('COMMERCE_READ'), async (req,res,next)=>{
    try { res.json(await Promise.resolve(commerce.listRoutingPolicies(req.organization.id))); } catch(e){ next(e); }
  });
  r.post('/api/commerce/routing-policies', requireRole(), orgAccess.requireCapability('COMMERCE_WRITE'), async (req,res,next)=>{
    try { const out=await Promise.resolve(commerce.createRoutingPolicy(req.organization.id,req.body||{},actor(req))); if(out.policy)audit.log(actor(req),'commerce_routing_created',{organizationId:req.organization.id,policyId:out.policy.id,strategy:out.policy.strategy}); reply(res,out,201); } catch(e){ next(e); }
  });

  // Studio-only dry preview. It resolves the effective order but creates no attribution row.
  r.post('/api/commerce/resolve-preview', requireRole(), orgAccess.requireCapability('COMMERCE_READ'), async (req,res,next)=>{
    try {
      const b=req.body||{}; if(!b.productId&&!b.assetId)return res.status(400).json({error:'Informe productId ou assetId.'});
      const out=await Promise.resolve(commerce.preview(req.organization.id,{productId:b.productId||null,assetId:b.assetId||null,workId:b.workId||null,placementId:b.placementId||null,campaignId:b.campaignId||null,territory:cleanTerritory(b.territory)}));
      reply(res,out);
    } catch(e){ next(e); }
  });

  // Public consumer resolution. Organization comes from the currently published Commerce Track.
  r.post('/api/commerce/resolve', async (req,res,next)=>{
    try {
      const b=req.body||{}; if(!b.workId||(!b.productId&&!b.assetId))return res.status(400).json({error:'workId e productId/assetId são obrigatórios.'});
      const timeline=await Promise.resolve(content.getPublishedTimeline(b.workId));
      if(!timeline||!timeline.organizationId)return res.status(404).json({error:'Commerce Track publicada não encontrada.'});
      const candidates=(timeline.scenes||[]).flatMap(sc=>(sc.products||[]).map(p=>({...p,sceneId:sc.sceneId,start:sc.start,end:sc.end})));
      const allowed=candidates.find(p=>(b.placementId ? p.placementId===b.placementId : true) && (b.productId ? p.productId===b.productId : true) && (b.assetId ? p.assetId===b.assetId : true));
      if(!allowed)return res.status(404).json({error:'Produto/placement não está publicado nesta Commerce Track.'});
      const out=await Promise.resolve(commerce.resolve(timeline.organizationId,{productId:b.productId||allowed.productId||null,assetId:b.assetId||allowed.assetId||null,workId:b.workId,placementId:b.placementId||allowed.placementId||null,campaignId:b.campaignId||null,territory:cleanTerritory(b.territory)},{viewerDevice:publicViewerId(req)}));
      if(out.error)return reply(res,out);
      // Never expose marketplace destination URLs in the public resolver payload.
      res.json({resolution:out.resolution,offers:(out.offers||[]).map(o=>({id:o.id,productId:o.productId,assetId:o.assetId,price:o.price,currency:o.currency,cta:o.cta,availability:o.availability,territory:o.territory,commissionRate:o.commissionRate,provider:o.provider,activationUrl:o.activationUrl}))});
    } catch(e){ next(e); }
  });

  r.get('/api/commerce/activations/:resolutionId/:offerId', async (req,res,next)=>{
    try {
      const meta={ua:String(req.headers['user-agent']||'').slice(0,300),referrer:String(req.headers.referer||'').slice(0,500),ipHash:crypto.createHash('sha256').update(String(req.ip||'')).digest('hex')};
      const out=await Promise.resolve(commerce.activate(req.params.resolutionId,req.params.offerId,meta));
      if(out.error)return res.status(out.code||400).json({error:out.error});
      res.redirect(302,out.destinationUrl);
    } catch(e){ next(e); }
  });

  return r;
}

module.exports={routes};
