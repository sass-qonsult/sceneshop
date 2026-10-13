const crypto = require('crypto');

const PROVIDERS = Object.freeze([
  { id:'payment-external', providerCode:'external_order', name:'External Order / Marketplace', kind:'EXTERNAL_ORDER', capabilities:{webhook:true,custody:false}, enabled:true },
  { id:'payment-generic', providerCode:'generic_gateway', name:'Generic Payment Gateway', kind:'PAYMENT_GATEWAY', capabilities:{intent:true,webhook:true,refund:true,custody:true}, enabled:true },
  { id:'payment-manual', providerCode:'manual_settlement', name:'Manual Settlement', kind:'MANUAL', capabilities:{manual:true,custody:false}, enabled:true },
]);
const INTENT_STATES = new Set(['REQUIRES_ACTION','PENDING','AUTHORIZED','CAPTURED','FAILED','CANCELED','PARTIALLY_REFUNDED','REFUNDED','DISPUTED']);
const clean=(v,n=160)=>String(v||'').trim().slice(0,n);
const uuid=(p)=>`${p}-${crypto.randomUUID()}`;
const round=(n)=>Math.round(Number(n)*100)/100;
const now=()=>Date.now();
function ensureState(s){
  s.paymentConnections ||= {};
  s.paymentIntents ||= {};
  s.paymentEvents ||= {};
  s.financialTransactions ||= {};
  s.financialPostings ||= {};
  s.paymentRefunds ||= {};
  s.paymentDisputes ||= {};
  s.paymentSettlements ||= {};
  s.paymentPayouts ||= {};
  s.paymentReconciliationBatches ||= {};
  s.paymentReconciliationItems ||= {};
  return s;
}
function providerPublic(p){return p?{id:p.id,providerCode:p.providerCode,name:p.name,kind:p.kind,capabilities:p.capabilities,enabled:p.enabled!==false}:null;}
function balanced(postings){
  const debit=round(postings.filter(p=>p.direction==='DEBIT').reduce((a,p)=>a+Number(p.amount||0),0));
  const credit=round(postings.filter(p=>p.direction==='CREDIT').reduce((a,p)=>a+Number(p.amount||0),0));
  return debit>0 && debit===credit ? {ok:true,debit,credit} : {ok:false,debit,credit};
}
function transition(current,eventType,amount,refundedAmount=0){
  const t=String(eventType||'').toUpperCase();
  if(t==='PAYMENT_AUTHORIZED') return 'AUTHORIZED';
  if(t==='PAYMENT_CAPTURED') return 'CAPTURED';
  if(t==='PAYMENT_FAILED') return 'FAILED';
  if(t==='PAYMENT_CANCELED') return 'CANCELED';
  if(t==='CHARGEBACK_OPENED') return 'DISPUTED';
  if(t==='CHARGEBACK_WON') return refundedAmount>0 ? (refundedAmount>=amount ? 'REFUNDED' : 'PARTIALLY_REFUNDED') : 'CAPTURED';
  if(t==='CHARGEBACK_LOST') return 'REFUNDED';
  if(t==='REFUND_SUCCEEDED') return refundedAmount>=amount ? 'REFUNDED' : 'PARTIALLY_REFUNDED';
  return current;
}
class StatePaymentRepository {
  constructor(getState,save=()=>{}){this.getState=getState;this.save=save;}
  state(){return ensureState(this.getState());}
  listProviders(){return PROVIDERS.map(providerPublic);}
  createConnection(orgId,body,actor){
    const p=PROVIDERS.find(x=>x.providerCode===body.providerCode||x.id===body.providerId);
    if(!p)return{errors:['Payment Provider inválido.']};
    const mode=String(body.mode||'EXTERNAL').toUpperCase();
    if(!['EXTERNAL','MANAGED'].includes(mode))return{errors:['Modo de pagamento inválido.']};
    if(mode==='MANAGED'&&!p.capabilities.custody)return{errors:['Provider não suporta fluxo gerenciado/custódia.']};
    const r={id:uuid('payconn'),organizationId:orgId,providerId:p.id,label:clean(body.label)||p.name,mode,credentialsRef:clean(body.credentialsRef,500)||null,config:body.config||{},status:'ACTIVE',createdBy:actor,createdAt:now(),updatedAt:now()};
    this.state().paymentConnections[r.id]=r;this.save();return{connection:{...r,provider:providerPublic(p)}};
  }
  listConnections(orgId){const s=this.state();return Object.values(s.paymentConnections).filter(x=>x.organizationId===orgId).map(x=>({...x,provider:providerPublic(PROVIDERS.find(p=>p.id===x.providerId))}));}
  createIntent(orgId,body,actor,idempotencyKey){
    const s=this.state();const key=clean(idempotencyKey,200);if(!key)return{errors:['Idempotency-Key obrigatório.']};
    const dup=Object.values(s.paymentIntents).find(x=>x.organizationId===orgId&&x.idempotencyKey===key);if(dup)return{intent:dup,duplicate:true};
    const c=s.paymentConnections[body.connectionId];if(!c||c.organizationId!==orgId||c.status!=='ACTIVE')return{errors:['Conexão de pagamento inválida.']};
    const amount=round(body.amount);if(!(amount>0))return{errors:['Valor do pagamento deve ser maior que zero.']};
    const currency=clean(body.currency||'BRL',3).toUpperCase();
    const r={id:uuid('pi'),organizationId:orgId,connectionId:c.id,idempotencyKey:key,amount,currency,status:'PENDING',resolutionId:body.resolutionId||null,activationId:body.activationId||null,orderId:body.orderId||null,saleId:body.saleId||null,externalPaymentId:body.externalPaymentId||null,checkoutData:body.checkoutData||{},metadata:body.metadata||{},createdBy:actor,createdAt:now(),updatedAt:now(),refundedAmount:0};
    s.paymentIntents[r.id]=r;this.save();return{intent:r};
  }
  getIntent(orgId,id){const r=this.state().paymentIntents[id];return r&&r.organizationId===orgId?r:null;}
  listIntents(orgId){return Object.values(this.state().paymentIntents).filter(x=>x.organizationId===orgId).sort((a,b)=>b.createdAt-a.createdAt);}
  postJournal(orgId,{transactionType,referenceType,referenceId,currency='BRL',idempotencyKey,occurredAt=now(),postings,metadata={}}){
    const s=this.state();const existing=Object.values(s.financialTransactions).find(x=>x.organizationId===orgId&&x.idempotencyKey===idempotencyKey);if(existing)return{transaction:existing,postings:Object.values(s.financialPostings).filter(p=>p.transactionId===existing.id),duplicate:true};
    const b=balanced(postings||[]);if(!b.ok)return{errors:[`Journal desequilibrado: débito ${b.debit.toFixed(2)} / crédito ${b.credit.toFixed(2)}.`]};
    const tx={id:uuid('ftx'),organizationId:orgId,transactionType,referenceType,referenceId,currency,idempotencyKey,occurredAt,postedAt:now(),metadata};
    s.financialTransactions[tx.id]=Object.freeze({...tx});const rows=(postings||[]).map(p=>Object.freeze({id:uuid('fp'),transactionId:tx.id,accountCode:clean(p.accountCode,80),direction:p.direction,amount:round(p.amount),partyType:p.partyType||null,partyId:p.partyId||null,metadata:p.metadata||{},createdAt:now()}));rows.forEach(p=>s.financialPostings[p.id]=p);this.save();return{transaction:tx,postings:rows};
  }
  ingestEvent(orgId,connectionId,event,rawBody=''){
    const s=this.state();const conn=s.paymentConnections[connectionId];if(!conn||conn.organizationId!==orgId)return{errors:['Conexão de pagamento inválida.']};
    const providerEventId=clean(event.providerEventId,200);if(!providerEventId)return{errors:['providerEventId obrigatório.']};
    const eventKey=`${connectionId}:${providerEventId}`;if(s.paymentEvents[eventKey])return{event:s.paymentEvents[eventKey],duplicate:true,intent:event.intentId?s.paymentIntents[event.intentId]:null};
    const intent=s.paymentIntents[event.intentId];if(!intent||intent.organizationId!==orgId||intent.connectionId!==connectionId)return{errors:['Payment Intent não encontrado para o evento.']};
    const eventType=String(event.type||'').toUpperCase();const rawSha256=crypto.createHash('sha256').update(String(rawBody||JSON.stringify(event))).digest('hex');
    const eventAmount=round(event.amount||0);let cumulativeRefund=Number(intent.refundedAmount||0);
    if(eventType==='REFUND_SUCCEEDED') cumulativeRefund=round(Math.min(intent.amount,cumulativeRefund+(eventAmount>0?eventAmount:Math.max(0,intent.amount-cumulativeRefund))));
    const next=transition(intent.status,eventType,intent.amount,cumulativeRefund);
    if(!INTENT_STATES.has(next))return{errors:['Estado de pagamento inválido.']};
    if(event.externalPaymentId)intent.externalPaymentId=String(event.externalPaymentId).slice(0,200);
    if(eventType==='PAYMENT_AUTHORIZED')intent.authorizedAt=now();
    if(eventType==='PAYMENT_CAPTURED'&&!intent.capturedAt)intent.capturedAt=now();
    if(eventType==='PAYMENT_CANCELED')intent.canceledAt=now();
    if(eventType==='REFUND_SUCCEEDED')intent.refundedAmount=cumulativeRefund;
    intent.status=next;intent.updatedAt=now();
    const ev={id:uuid('pevt'),organizationId:orgId,connectionId,providerEventId,paymentIntentId:intent.id,eventType,rawSha256,eventPayload:event.payload||{},processingStatus:'PROCESSED',receivedAt:now(),processedAt:now()};s.paymentEvents[eventKey]=ev;
    let journal=null;
    if(conn.mode==='MANAGED'&&eventType==='PAYMENT_CAPTURED'){
      journal=this.postJournal(orgId,{transactionType:'PAYMENT_CAPTURED',referenceType:'PAYMENT_INTENT',referenceId:intent.id,currency:intent.currency,idempotencyKey:`capture:${intent.id}`,occurredAt:intent.capturedAt,postings:[{accountCode:'PROCESSOR_RECEIVABLE',direction:'DEBIT',amount:intent.amount,partyType:'PAYMENT_PROVIDER',partyId:conn.providerId},{accountCode:'MERCHANT_GROSS_PAYABLE',direction:'CREDIT',amount:intent.amount,partyType:'ORGANIZATION',partyId:orgId}],metadata:{connectionId,intentId:intent.id}});
    } else if(conn.mode==='MANAGED'&&eventType==='REFUND_SUCCEEDED'){
      const amount=eventAmount>0?eventAmount:round(intent.amount-Number(intent.refundedAmount||0));
      const effective=amount>0?amount:round(intent.amount);
      journal=this.postJournal(orgId,{transactionType:'REFUND_SUCCEEDED',referenceType:'PAYMENT_INTENT',referenceId:intent.id,currency:intent.currency,idempotencyKey:`refund:${providerEventId}`,postings:[{accountCode:'MERCHANT_GROSS_PAYABLE',direction:'DEBIT',amount:effective,partyType:'ORGANIZATION',partyId:orgId},{accountCode:'PROCESSOR_RECEIVABLE',direction:'CREDIT',amount:effective,partyType:'PAYMENT_PROVIDER',partyId:conn.providerId}],metadata:{connectionId,intentId:intent.id,providerEventId}});
    } else if(conn.mode==='MANAGED'&&eventType==='CHARGEBACK_OPENED'){
      const amount=eventAmount>0?eventAmount:intent.amount;
      journal=this.postJournal(orgId,{transactionType:'CHARGEBACK_OPENED',referenceType:'PAYMENT_INTENT',referenceId:intent.id,currency:intent.currency,idempotencyKey:`chargeback-open:${providerEventId}`,postings:[{accountCode:'MERCHANT_GROSS_PAYABLE',direction:'DEBIT',amount,partyType:'ORGANIZATION',partyId:orgId},{accountCode:'PROCESSOR_RECEIVABLE',direction:'CREDIT',amount,partyType:'PAYMENT_PROVIDER',partyId:conn.providerId}],metadata:{connectionId,intentId:intent.id,providerEventId}});
      s.paymentDisputes[providerEventId]={id:uuid('dispute'),organizationId:orgId,paymentIntentId:intent.id,connectionId,status:'OPEN',amount,currency:intent.currency,externalDisputeId:event.externalDisputeId||null,openedAt:now(),updatedAt:now()};
    } else if(conn.mode==='MANAGED'&&eventType==='CHARGEBACK_WON'){
      const amount=eventAmount>0?eventAmount:intent.amount;
      journal=this.postJournal(orgId,{transactionType:'CHARGEBACK_WON',referenceType:'PAYMENT_INTENT',referenceId:intent.id,currency:intent.currency,idempotencyKey:`chargeback-won:${providerEventId}`,postings:[{accountCode:'PROCESSOR_RECEIVABLE',direction:'DEBIT',amount,partyType:'PAYMENT_PROVIDER',partyId:conn.providerId},{accountCode:'MERCHANT_GROSS_PAYABLE',direction:'CREDIT',amount,partyType:'ORGANIZATION',partyId:orgId}],metadata:{connectionId,intentId:intent.id,providerEventId}});
    }
    this.save();return{event:ev,intent:{...intent},journal};
  }
  listJournal(orgId){const s=this.state();return Object.values(s.financialTransactions).filter(x=>x.organizationId===orgId).sort((a,b)=>b.occurredAt-a.occurredAt).map(tx=>({transaction:tx,postings:Object.values(s.financialPostings).filter(p=>p.transactionId===tx.id)}));}

  accountBalance(orgId,accountCode,partyId=null){
    const s=this.state();let debit=0,credit=0;
    for(const p of Object.values(s.financialPostings)){const tx=s.financialTransactions[p.transactionId];if(!tx||tx.organizationId!==orgId||p.accountCode!==accountCode)continue;if(partyId&&p.partyId!==partyId)continue;if(p.direction==='DEBIT')debit+=Number(p.amount||0);else credit+=Number(p.amount||0);}
    return {debit:round(debit),credit:round(credit),debitNormal:round(debit-credit),creditNormal:round(credit-debit)};
  }
  requestRefund(orgId,body,actor,idempotencyKey){
    const s=this.state();const key=clean(idempotencyKey,200);if(!key)return{errors:['Idempotency-Key obrigatório.']};const old=Object.values(s.paymentRefunds).find(x=>x.organizationId===orgId&&x.idempotencyKey===key);if(old)return{refund:old,duplicate:true};const intent=s.paymentIntents[body.intentId];if(!intent||intent.organizationId!==orgId)return{errors:['Payment Intent inválido.']};if(!['CAPTURED','PARTIALLY_REFUNDED','DISPUTED'].includes(intent.status))return{errors:['Pagamento não está elegível para refund.']};const remaining=round(intent.amount-Number(intent.refundedAmount||0));const amount=round(body.amount||remaining);if(!(amount>0)||amount>remaining)return{errors:['Valor de refund inválido.']};const r={id:uuid('refund'),organizationId:orgId,paymentIntentId:intent.id,amount,currency:intent.currency,status:'REQUESTED',idempotencyKey:key,reason:clean(body.reason,500)||null,externalRefundId:null,requestedBy:actor,createdAt:now(),updatedAt:now()};s.paymentRefunds[r.id]=r;this.save();return{refund:r};
  }
  recordSettlement(orgId,body,actor,idempotencyKey){
    const s=this.state();const key=clean(idempotencyKey,200);if(!key)return{errors:['Idempotency-Key obrigatório.']};const old=Object.values(s.paymentSettlements).find(x=>x.organizationId===orgId&&x.idempotencyKey===key);if(old)return{settlement:old,duplicate:true};const c=s.paymentConnections[body.connectionId];if(!c||c.organizationId!==orgId||c.mode!=='MANAGED')return{errors:['Settlement exige conexão MANAGED da organização.']};const gross=round(body.grossAmount),fees=round(body.fees||0),net=round(body.netAmount==null?gross-fees:body.netAmount);if(!(gross>0)||fees<0||net<0||round(net+fees)!==gross)return{errors:['Settlement inconsistente: net + fees deve igualar gross.']};const r={id:uuid('settlement'),organizationId:orgId,connectionId:c.id,idempotencyKey:key,externalSettlementId:clean(body.externalSettlementId,200)||null,grossAmount:gross,fees,netAmount:net,currency:clean(body.currency||'BRL',3).toUpperCase(),status:'POSTED',periodStart:body.periodStart||null,periodEnd:body.periodEnd||null,createdBy:actor,createdAt:now()};const postings=[{accountCode:'BANK_CASH',direction:'DEBIT',amount:net,partyType:'ORGANIZATION',partyId:orgId}];if(fees>0)postings.push({accountCode:'PROCESSOR_FEES',direction:'DEBIT',amount:fees,partyType:'PAYMENT_PROVIDER',partyId:c.providerId});postings.push({accountCode:'PROCESSOR_RECEIVABLE',direction:'CREDIT',amount:gross,partyType:'PAYMENT_PROVIDER',partyId:c.providerId});const journal=this.postJournal(orgId,{transactionType:'PAYMENT_SETTLEMENT',referenceType:'SETTLEMENT',referenceId:r.id,currency:r.currency,idempotencyKey:`settlement:${key}`,postings,metadata:{connectionId:c.id,externalSettlementId:r.externalSettlementId}});if(journal.errors)return journal;s.paymentSettlements[r.id]=r;this.save();return{settlement:r,journal};
  }
  requestPayout(orgId,body,actor,idempotencyKey){
    const s=this.state();const key=clean(idempotencyKey,200);if(!key)return{errors:['Idempotency-Key obrigatório.']};const old=Object.values(s.paymentPayouts).find(x=>x.organizationId===orgId&&x.idempotencyKey===key);if(old)return{payout:old,duplicate:true};const amount=round(body.amount);if(!(amount>0))return{errors:['Valor do payout deve ser maior que zero.']};const payable=this.accountBalance(orgId,'MERCHANT_GROSS_PAYABLE',orgId).creditNormal;const cash=this.accountBalance(orgId,'BANK_CASH',orgId).debitNormal;if(amount>payable)return{errors:['Payout excede saldo a pagar da organização.'],available:payable};if(amount>cash)return{errors:['Payout excede caixa liquidado disponível.'],available:cash};const r={id:uuid('payout'),organizationId:orgId,beneficiaryType:'ORGANIZATION',beneficiaryId:orgId,amount,currency:clean(body.currency||'BRL',3).toUpperCase(),status:'PENDING',idempotencyKey:key,externalPayoutId:null,requestedBy:actor,approvedBy:null,createdAt:now(),updatedAt:now(),paidAt:null};s.paymentPayouts[r.id]=r;this.save();return{payout:r};
  }
  markPayoutPaid(orgId,payoutId,body,actor){
    const s=this.state();const p=s.paymentPayouts[payoutId];if(!p||p.organizationId!==orgId)return{errors:['Payout não encontrado.']};if(p.status==='PAID')return{payout:p,duplicate:true};if(p.status!=='PENDING'&&p.status!=='APPROVED')return{errors:['Payout não está pagável.']};const cash=this.accountBalance(orgId,'BANK_CASH',orgId).debitNormal;if(p.amount>cash)return{errors:['Caixa liquidado insuficiente para payout.'],available:cash};const journal=this.postJournal(orgId,{transactionType:'PAYOUT_PAID',referenceType:'PAYOUT',referenceId:p.id,currency:p.currency,idempotencyKey:`payout:${p.id}`,postings:[{accountCode:'MERCHANT_GROSS_PAYABLE',direction:'DEBIT',amount:p.amount,partyType:'ORGANIZATION',partyId:orgId},{accountCode:'BANK_CASH',direction:'CREDIT',amount:p.amount,partyType:'ORGANIZATION',partyId:orgId}],metadata:{externalPayoutId:body.externalPayoutId||null}});if(journal.errors)return journal;Object.assign(p,{status:'PAID',externalPayoutId:clean(body.externalPayoutId,200)||null,approvedBy:actor,updatedAt:now(),paidAt:now()});this.save();return{payout:{...p},journal};
  }
  reconcile(orgId,body,actor){
    const s=this.state();const c=s.paymentConnections[body.connectionId];if(!c||c.organizationId!==orgId)return{errors:['Conexão de pagamento inválida.']};const rows=Array.isArray(body.rows)?body.rows:[];const start=Number(body.periodStart||0),end=Number(body.periodEnd||now());const expected=Object.values(s.paymentIntents).filter(i=>i.organizationId===orgId&&i.connectionId===c.id&&i.status==='CAPTURED'&&Number(i.capturedAt||i.updatedAt||i.createdAt)>=start&&Number(i.capturedAt||i.updatedAt||i.createdAt)<=end);const byExt=new Map(expected.filter(i=>i.externalPaymentId).map(i=>[i.externalPaymentId,i]));const byId=new Map(expected.map(i=>[i.id,i]));const seen=new Set(),items=[];let providerTotal=0,sceneTotal=0;for(const row of rows){const amount=round(row.amount);providerTotal=round(providerTotal+amount);const i=(row.intentId&&byId.get(row.intentId))||(row.externalPaymentId&&byExt.get(row.externalPaymentId));if(!i){items.push({status:'UNEXPECTED',intentId:null,externalPaymentId:row.externalPaymentId||null,expectedAmount:null,reportedAmount:amount});continue;}seen.add(i.id);sceneTotal=round(sceneTotal+i.amount);items.push({status:amount===i.amount?'MATCHED':'AMOUNT_MISMATCH',intentId:i.id,externalPaymentId:row.externalPaymentId||i.externalPaymentId||null,expectedAmount:i.amount,reportedAmount:amount});}for(const i of expected){if(!seen.has(i.id)){sceneTotal=round(sceneTotal+i.amount);items.push({status:'MISSING',intentId:i.id,externalPaymentId:i.externalPaymentId||null,expectedAmount:i.amount,reportedAmount:null});}}const exceptions=items.filter(x=>x.status!=='MATCHED').length;const batch={id:uuid('recon'),organizationId:orgId,connectionId:c.id,periodStart:start,periodEnd:end,status:exceptions?'EXCEPTIONS':'RECONCILED',currency:clean(body.currency||'BRL',3).toUpperCase(),providerTotal,sceneshopTotal:sceneTotal,difference:round(providerTotal-sceneTotal),sourceSha256:crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex'),itemCount:items.length,exceptionCount:exceptions,createdBy:actor,createdAt:now()};s.paymentReconciliationBatches[batch.id]=batch;items.forEach((x,idx)=>s.paymentReconciliationItems[`${batch.id}:${idx}`]={id:`${batch.id}:${idx}`,batchId:batch.id,...x});this.save();return{batch,items};
  }
  listReconciliation(orgId){const s=this.state();return Object.values(s.paymentReconciliationBatches).filter(x=>x.organizationId===orgId).sort((a,b)=>b.createdAt-a.createdAt).map(b=>({...b,items:Object.values(s.paymentReconciliationItems).filter(i=>i.batchId===b.id)}));}
  listPayouts(orgId){return Object.values(this.state().paymentPayouts).filter(x=>x.organizationId===orgId).sort((a,b)=>b.createdAt-a.createdAt);}
  listSettlements(orgId){return Object.values(this.state().paymentSettlements).filter(x=>x.organizationId===orgId).sort((a,b)=>b.createdAt-a.createdAt);}
}

module.exports={StatePaymentRepository,PROVIDERS,providerPublic,balanced,transition};
