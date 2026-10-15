const crypto=require('crypto');
const { payments }=require('./repositories');

function routes({requireRole,orgAccess}){
  const express=require('express');const r=express.Router();
  const wrap=(fn)=>(req,res,next)=>Promise.resolve(fn(req,res,next)).catch(next);
  const reply=(res,x,status=200)=>{const {code,...body}=x||{};res.status(x&&(x.error||x.errors)?code||400:status).json(body);};
  const actor=(req)=>req.user?req.user.username:'anonymous';
  r.get('/api/payments/providers', requireRole(), orgAccess.requireCapability('COMMERCE_READ'), wrap(async(req,res)=>res.json(await Promise.resolve(payments.listProviders()))));
  r.get('/api/payments/connections', requireRole(), orgAccess.requireCapability('COMMERCE_READ'), wrap(async(req,res)=>res.json(await Promise.resolve(payments.listConnections(req.organization.id)))));
  r.post('/api/payments/connections', requireRole(), orgAccess.requireCapability('COMMERCE_WRITE',{strong:true}), wrap(async(req,res)=>reply(res,await Promise.resolve(payments.createConnection(req.organization.id,req.body||{},actor(req))),201)));
  r.get('/api/payments/intents', requireRole(), orgAccess.requireCapability('COMMERCE_READ'), wrap(async(req,res)=>res.json(await Promise.resolve(payments.listIntents(req.organization.id)))));
  r.get('/api/payments/intents/:id', requireRole(), orgAccess.requireCapability('COMMERCE_READ'), wrap(async(req,res)=>{const x=await Promise.resolve(payments.getIntent(req.organization.id,req.params.id));x?res.json(x):res.status(404).json({error:'Payment Intent não encontrado.'});}));
  r.post('/api/payments/intents', requireRole(), orgAccess.requireCapability('COMMERCE_WRITE',{strong:true}), wrap(async(req,res)=>reply(res,await Promise.resolve(payments.createIntent(req.organization.id,req.body||{},actor(req),req.get('Idempotency-Key'))),201)));
  // Alpha.1: ingestion authenticated as an internal/partner operation. Provider-specific
  // public webhook adapters will call the same authoritative method in alpha.2.
  r.post('/api/payments/connections/:id/events', requireRole(), orgAccess.requireCapability('COMMERCE_WRITE',{strong:true}), wrap(async(req,res)=>{
    const raw=req.rawBody||JSON.stringify(req.body||{});reply(res,await Promise.resolve(payments.ingestEvent(req.organization.id,req.params.id,req.body||{},raw)),202);
  }));
  r.get('/api/payments/journal', requireRole(), orgAccess.requireCapability('COMMERCE_READ'), wrap(async(req,res)=>res.json(await Promise.resolve(payments.listJournal(req.organization.id)))));
  r.get('/api/payments/balances', requireRole(), orgAccess.requireCapability('COMMERCE_READ'), wrap(async(req,res)=>{
    const org=req.organization.id;const [processor,cash,payable,fees]=await Promise.all([
      Promise.resolve(payments.accountBalance(org,'PROCESSOR_RECEIVABLE',null)),
      Promise.resolve(payments.accountBalance(org,'BANK_CASH',org)),
      Promise.resolve(payments.accountBalance(org,'MERCHANT_GROSS_PAYABLE',org)),
      Promise.resolve(payments.accountBalance(org,'PROCESSOR_FEES',null)),
    ]);res.json({processorReceivable:processor.debitNormal,bankCash:cash.debitNormal,merchantPayable:payable.creditNormal,processorFees:fees.debitNormal});
  }));
  r.post('/api/payments/refunds', requireRole(), orgAccess.requireCapability('COMMERCE_WRITE',{strong:true}), wrap(async(req,res)=>reply(res,await Promise.resolve(payments.requestRefund(req.organization.id,req.body||{},actor(req),req.get('Idempotency-Key'))),201)));
  r.post('/api/payments/settlements', requireRole(), orgAccess.requireCapability('COMMERCE_WRITE',{strong:true}), wrap(async(req,res)=>reply(res,await Promise.resolve(payments.recordSettlement(req.organization.id,req.body||{},actor(req),req.get('Idempotency-Key'))),201)));
  r.get('/api/payments/settlements', requireRole(), orgAccess.requireCapability('COMMERCE_READ'), wrap(async(req,res)=>res.json(await Promise.resolve(payments.listSettlements(req.organization.id)))));
  r.post('/api/payments/payouts', requireRole(), orgAccess.requireCapability('COMMERCE_WRITE',{strong:true}), wrap(async(req,res)=>reply(res,await Promise.resolve(payments.requestPayout(req.organization.id,req.body||{},actor(req),req.get('Idempotency-Key'))),201)));
  r.get('/api/payments/payouts', requireRole(), orgAccess.requireCapability('COMMERCE_READ'), wrap(async(req,res)=>res.json(await Promise.resolve(payments.listPayouts(req.organization.id)))));
  r.post('/api/payments/payouts/:id/paid', requireRole(), orgAccess.requireCapability('COMMERCE_WRITE',{strong:true}), wrap(async(req,res)=>reply(res,await Promise.resolve(payments.markPayoutPaid(req.organization.id,req.params.id,req.body||{},actor(req))))));
  r.post('/api/payments/reconciliation', requireRole(), orgAccess.requireCapability('COMMERCE_WRITE',{strong:true}), wrap(async(req,res)=>reply(res,await Promise.resolve(payments.reconcile(req.organization.id,req.body||{},actor(req))),201)));
  r.get('/api/payments/reconciliation', requireRole(), orgAccess.requireCapability('COMMERCE_READ'), wrap(async(req,res)=>res.json(await Promise.resolve(payments.listReconciliation(req.organization.id)))));
  return r;
}
module.exports={routes};
