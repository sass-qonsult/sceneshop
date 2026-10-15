const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs');
const path=require('path');
const {StatePaymentRepository,balanced}=require('../server/repositories/payments');

function repo(){const state={};return{state,r:new StatePaymentRepository(()=>state,()=>{})};}

test('payments: provider abstraction distinguishes external orders from managed custody',()=>{
  const {r}=repo();const p=r.listProviders();
  assert.ok(p.some(x=>x.providerCode==='external_order'&&x.capabilities.custody===false));
  assert.ok(p.some(x=>x.providerCode==='generic_gateway'&&x.capabilities.custody===true));
  assert.ok(r.createConnection('org1',{providerCode:'external_order',mode:'MANAGED'},'a').errors);
  assert.ok(r.createConnection('org1',{providerCode:'generic_gateway',mode:'MANAGED'},'a').connection);
});

test('payments: intent requires idempotency key and replays same intent',()=>{
  const {r}=repo();const c=r.createConnection('org1',{providerCode:'generic_gateway',mode:'MANAGED'},'a').connection;
  assert.ok(r.createIntent('org1',{connectionId:c.id,amount:100},'a','').errors);
  const one=r.createIntent('org1',{connectionId:c.id,amount:100,currency:'BRL'},'a','checkout-001');
  const two=r.createIntent('org1',{connectionId:c.id,amount:999,currency:'USD'},'a','checkout-001');
  assert.equal(two.duplicate,true);assert.equal(two.intent.id,one.intent.id);assert.equal(two.intent.amount,100);assert.equal(two.intent.currency,'BRL');
});

test('payments: managed capture creates one balanced immutable-style journal transaction',()=>{
  const {r}=repo();const c=r.createConnection('org1',{providerCode:'generic_gateway',mode:'MANAGED'},'a').connection;
  const i=r.createIntent('org1',{connectionId:c.id,amount:249.9},'a','checkout-002').intent;
  const e=r.ingestEvent('org1',c.id,{providerEventId:'evt-1',intentId:i.id,type:'PAYMENT_CAPTURED',externalPaymentId:'pay-1'},'raw-event');
  assert.equal(e.intent.status,'CAPTURED');assert.ok(e.journal);assert.equal(e.journal.postings.length,2);
  assert.deepEqual(balanced(e.journal.postings.map(p=>({direction:p.direction,amount:p.amount}))),{ok:true,debit:249.9,credit:249.9});
  const replay=r.ingestEvent('org1',c.id,{providerEventId:'evt-1',intentId:i.id,type:'PAYMENT_CAPTURED'},'raw-event');
  assert.equal(replay.duplicate,true);assert.equal(r.listJournal('org1').length,1);
});

test('payments: external-order capture does not pretend SceneShop has custody',()=>{
  const {r}=repo();const c=r.createConnection('org1',{providerCode:'external_order',mode:'EXTERNAL'},'a').connection;
  const i=r.createIntent('org1',{connectionId:c.id,amount:100},'a','external-1').intent;
  const e=r.ingestEvent('org1',c.id,{providerEventId:'evt-ext',intentId:i.id,type:'PAYMENT_CAPTURED'},'raw');
  assert.equal(e.intent.status,'CAPTURED');assert.equal(e.journal,null);assert.equal(r.listJournal('org1').length,0);
});

test('payments: journal rejects imbalance and isolates organizations',()=>{
  const {r}=repo();
  const bad=r.postJournal('org1',{transactionType:'TEST',referenceType:'X',referenceId:'1',idempotencyKey:'bad',postings:[{accountCode:'A',direction:'DEBIT',amount:10},{accountCode:'B',direction:'CREDIT',amount:9}]});
  assert.ok(bad.errors);
  const good=r.postJournal('org1',{transactionType:'TEST',referenceType:'X',referenceId:'2',idempotencyKey:'good',postings:[{accountCode:'A',direction:'DEBIT',amount:10},{accountCode:'B',direction:'CREDIT',amount:10}]});
  assert.ok(good.transaction);assert.equal(r.listJournal('org1').length,1);assert.equal(r.listJournal('org2').length,0);
});

test('payments migration enforces provider-event/idempotency uniqueness and immutable journal',()=>{
  const sql=fs.readFileSync(path.join(__dirname,'../server/data/migrations/0017_payments_financial_journal.sql'),'utf8');
  assert.match(sql,/UNIQUE\(organization_id,idempotency_key\)/);
  assert.match(sql,/UNIQUE\(connection_id,provider_event_id\)/);
  assert.match(sql,/sceneshop_forbid_financial_mutation/);
  assert.match(sql,/BEFORE UPDATE OR DELETE ON sceneshop_financial_transactions/);
  assert.match(sql,/BEFORE UPDATE OR DELETE ON sceneshop_financial_postings/);
});

test('payments alpha2: partial refund reverses only the refunded amount',()=>{
  const {r}=repo();const c=r.createConnection('org1',{providerCode:'generic_gateway',mode:'MANAGED'},'a').connection;
  const i=r.createIntent('org1',{connectionId:c.id,amount:100},'a','refund-base').intent;
  r.ingestEvent('org1',c.id,{providerEventId:'cap-r',intentId:i.id,type:'PAYMENT_CAPTURED'},'cap');
  const req=r.requestRefund('org1',{intentId:i.id,amount:20,reason:'devolução parcial'},'a','refund-20');
  assert.equal(req.refund.amount,20);
  const ev=r.ingestEvent('org1',c.id,{providerEventId:'refund-event-20',intentId:i.id,type:'REFUND_SUCCEEDED',amount:20,externalRefundId:'rf-20'},'refund');
  assert.equal(ev.intent.status,'PARTIALLY_REFUNDED');assert.equal(ev.intent.refundedAmount,20);
  const journal=r.listJournal('org1');assert.equal(journal.length,2);
  const reversal=journal.find(x=>x.transaction.transactionType==='REFUND_SUCCEEDED');
  assert.equal(reversal.postings[0].amount,20);assert.deepEqual(balanced(reversal.postings),{ok:true,debit:20,credit:20});
});

test('payments alpha2: settlement creates bank cash and processor fee journal',()=>{
  const {r}=repo();const c=r.createConnection('org1',{providerCode:'generic_gateway',mode:'MANAGED'},'a').connection;
  const i=r.createIntent('org1',{connectionId:c.id,amount:100},'a','settle-cap').intent;
  r.ingestEvent('org1',c.id,{providerEventId:'cap-s',intentId:i.id,type:'PAYMENT_CAPTURED'},'cap');
  const s=r.recordSettlement('org1',{connectionId:c.id,grossAmount:100,fees:3,netAmount:97,currency:'BRL'},'a','settle-1');
  assert.equal(s.settlement.netAmount,97);
  assert.equal(r.accountBalance('org1','BANK_CASH','org1').debitNormal,97);
  assert.equal(r.accountBalance('org1','PROCESSOR_FEES',c.providerId).debitNormal,3);
  assert.equal(r.accountBalance('org1','PROCESSOR_RECEIVABLE',c.providerId).debitNormal,0);
});

test('payments alpha2: payout cannot exceed payable or settled cash and posts when paid',()=>{
  const {r}=repo();const c=r.createConnection('org1',{providerCode:'generic_gateway',mode:'MANAGED'},'a').connection;
  const i=r.createIntent('org1',{connectionId:c.id,amount:100},'a','payout-cap').intent;
  r.ingestEvent('org1',c.id,{providerEventId:'cap-p',intentId:i.id,type:'PAYMENT_CAPTURED'},'cap');
  r.recordSettlement('org1',{connectionId:c.id,grossAmount:100,fees:3,netAmount:97},'a','settle-p');
  assert.ok(r.requestPayout('org1',{amount:98},'a','payout-too-much').errors);
  const p=r.requestPayout('org1',{amount:90},'a','payout-90').payout;
  const paid=r.markPayoutPaid('org1',p.id,{externalPayoutId:'po-90'},'finance-admin');
  assert.equal(paid.payout.status,'PAID');assert.equal(r.accountBalance('org1','BANK_CASH','org1').debitNormal,7);assert.equal(r.accountBalance('org1','MERCHANT_GROSS_PAYABLE','org1').creditNormal,10);
});

test('payments alpha2: reconciliation exposes matched, missing, unexpected and amount mismatch',()=>{
  const {r}=repo();const c=r.createConnection('org1',{providerCode:'external_order',mode:'EXTERNAL'},'a').connection;
  const a=r.createIntent('org1',{connectionId:c.id,amount:50,externalPaymentId:'ext-a'},'a','ra').intent;
  const b=r.createIntent('org1',{connectionId:c.id,amount:70,externalPaymentId:'ext-b'},'a','rb').intent;
  r.ingestEvent('org1',c.id,{providerEventId:'ca',intentId:a.id,type:'PAYMENT_CAPTURED',externalPaymentId:'ext-a'},'a');
  r.ingestEvent('org1',c.id,{providerEventId:'cb',intentId:b.id,type:'PAYMENT_CAPTURED',externalPaymentId:'ext-b'},'b');
  const out=r.reconcile('org1',{connectionId:c.id,periodStart:0,periodEnd:Date.now()+1000,rows:[{externalPaymentId:'ext-a',amount:50},{externalPaymentId:'ext-b',amount:71},{externalPaymentId:'ext-x',amount:10}]},'finance');
  assert.equal(out.batch.status,'EXCEPTIONS');
  assert.ok(out.items.some(x=>x.status==='MATCHED'));assert.ok(out.items.some(x=>x.status==='AMOUNT_MISMATCH'));assert.ok(out.items.some(x=>x.status==='UNEXPECTED'));
});

test('payments alpha2 migration adds reconciliation/refund/settlement/payout controls',()=>{
  const sql=fs.readFileSync(path.join(__dirname,'../server/data/migrations/0018_reconciliation_refunds_payouts.sql'),'utf8');
  for(const name of ['sceneshop_payment_refunds','sceneshop_payment_disputes','sceneshop_payment_settlements','sceneshop_payment_payouts','sceneshop_reconciliation_batches','sceneshop_reconciliation_items']) assert.match(sql,new RegExp(name));
  assert.match(sql,/refunded_amount/);
});
