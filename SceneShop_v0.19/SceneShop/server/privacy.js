const express=require('express');const crypto=require('crypto');const audit=require('./audit');const {privacy}=require('./repositories');
const hashDevice=v=>crypto.createHash('sha256').update(String(v||'')).digest('hex');
function routes({requireRole,orgAccess}){const r=express.Router();
 const strongModerator=(req,res,next)=>{if(!req.user||req.user.role!=='moderator')return res.status(403).json({error:'Sem permissão para esta ação.'});if(!(req.user._auth&&req.user._auth.mfa))return res.status(403).json({error:'MFA_REQUIRED',code:'MFA_REQUIRED'});next();};
 r.get('/api/me/privacy',requireRole(),async(req,res,next)=>{try{res.json(await Promise.resolve(privacy.getUser(req.user.username)));}catch(e){next(e);}});
 r.put('/api/me/privacy',requireRole(),async(req,res,next)=>{try{const out=await Promise.resolve(privacy.setUser(req.user.username,req.body||{}));audit.log(req.user.username,'privacy_preferences_updated',{analytics:out.analytics,personalization:out.personalization,marketing:out.marketing,requestId:req.requestId});res.json(out);}catch(e){next(e);}});
 r.get('/api/me/privacy/export',requireRole(),async(req,res,next)=>{try{const out=await Promise.resolve(privacy.exportUser(req.user.username));audit.log(req.user.username,'privacy_export_generated',{requestId:req.requestId});res.json(out);}catch(e){next(e);}});
 r.post('/api/me/privacy/requests',requireRole(),async(req,res,next)=>{try{const out=await Promise.resolve(privacy.createRequest(req.user.username,req.body||{}));if(out.errors)return res.status(400).json(out);audit.log(req.user.username,'privacy_request_created',{type:out.request.type,requestId:out.request.id});res.status(201).json(out);}catch(e){next(e);}});
 r.get('/api/me/privacy/requests',requireRole(),async(req,res,next)=>{try{res.json(await Promise.resolve(privacy.listRequests(req.user.username)));}catch(e){next(e);}});
 r.get('/api/privacy/requests',requireRole('moderator'),async(req,res,next)=>{try{res.json(await Promise.resolve(privacy.listAllRequests()));}catch(e){next(e);}});
 r.post('/api/privacy/requests/:id/process',requireRole('moderator'),strongModerator,async(req,res,next)=>{try{
   const request=await Promise.resolve(privacy.getRequest(req.params.id));
   if(!request)return res.status(404).json({error:'Solicitação não encontrada.'});
   if(!['REQUESTED','PROCESSING'].includes(request.status))return res.status(409).json({error:'Solicitação já processada.',request});
   if(request.type==='EXPORT'){
     const data=await Promise.resolve(privacy.exportUser(request.username));
     const fingerprint=crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex');
     const done=await Promise.resolve(privacy.completeRequest(request.id,{status:'COMPLETED',resultRef:`sha256:${fingerprint}`,processedBy:req.user.username}));
     audit.log(req.user.username,'privacy_export_request_completed',{requestId:request.id,subject:request.username,resultRef:`sha256:${fingerprint}`});
     return res.json({...done,export:data});
   }
   if(request.type==='DELETE'){
     const result=await Promise.resolve(privacy.anonymizeUser(request.username));
     if(result&&result.error)return res.status(result.code||400).json(result);
     const done=await Promise.resolve(privacy.completeRequest(request.id,{status:'COMPLETED',resultRef:`anonymized:${request.username}`,processedBy:req.user.username}));
     audit.log(req.user.username,'privacy_delete_request_completed',{requestId:request.id,subject:request.username,preserved:result.preserved||[]});
     return res.json({...done,result});
   }
   res.status(400).json({error:'Tipo de solicitação inválido.'});
 }catch(e){next(e);}});
 r.post('/api/privacy/device-consent',async(req,res,next)=>{try{const id=String((req.body||{}).deviceId||req.headers['x-sceneshop-device']||'');if(!/^[A-Za-z0-9_-]{8,128}$/.test(id))return res.status(400).json({error:'deviceId inválido.'});const out=await Promise.resolve(privacy.setDevice(hashDevice(id),req.body||{}));res.json({ok:true,analytics:out.analytics,personalization:out.personalization,marketing:out.marketing,policyVersion:out.policyVersion});}catch(e){next(e);}});
 r.get('/api/organizations/:id/retention-policy',requireRole(),orgAccess.requireCapability('ORG_SETTINGS'),async(req,res,next)=>{try{if(!req.organization||req.organization.id!==req.params.id)return res.status(404).json({error:'Organização não encontrada.'});res.json(await Promise.resolve(privacy.getRetention(req.organization.id)));}catch(e){next(e);}});
 r.put('/api/organizations/:id/retention-policy',requireRole(),orgAccess.requireCapability('ORG_SETTINGS',{strong:true}),async(req,res,next)=>{try{if(!req.organization||req.organization.id!==req.params.id)return res.status(404).json({error:'Organização não encontrada.'});const out=await Promise.resolve(privacy.setRetention(req.organization.id,req.body||{},req.user.username));audit.log(req.user.username,'retention_policy_updated',{organizationId:req.organization.id,requestId:req.requestId});res.json(out);}catch(e){next(e);}});
 r.post('/api/organizations/:id/retention/run',requireRole(),orgAccess.requireCapability('ORG_SETTINGS',{strong:true}),async(req,res,next)=>{try{if(!req.organization||req.organization.id!==req.params.id)return res.status(404).json({error:'Organização não encontrada.'});const out=await Promise.resolve(privacy.runRetention(req.organization.id,Date.now()));audit.log(req.user.username,'retention_policy_executed',{organizationId:req.organization.id,deleted:out.deleted,requestId:req.requestId});res.json(out);}catch(e){next(e);}});
 r.get('/api/organizations/:id/compliance',requireRole(),orgAccess.requireCapability('ORG_SETTINGS'),async(req,res,next)=>{try{if(!req.organization||req.organization.id!==req.params.id)return res.status(404).json({error:'Organização não encontrada.'});res.json(await Promise.resolve(privacy.complianceReport(req.organization.id)));}catch(e){next(e);}});
 return r;}
module.exports={routes,hashDevice};
