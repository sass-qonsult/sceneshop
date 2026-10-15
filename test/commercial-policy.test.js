const test = require('node:test');
const assert = require('node:assert/strict');

process.env.SCENESHOP_MEMORY = '1';
const store = require('../server/store');
const policy = require('../server/commercial-policy');
const money = require('../server/money');

test.beforeEach(() => store.useMemory(true));

test('percentuais comerciais são editáveis por versão e não reescrevem vendas antigas', () => {
  const before = policy.current();
  assert.equal(before.version, 1);

  const sale1 = {
    id: 'sale-before', trackId: 't-oficial-demo01', value: 1000, store: 'amazon',
    at: store.now(), partnerId: 'aurora', commissionRate: 0.12,
  };
  const f1 = money.financialsForSale(sale1);
  assert.equal(f1.commissionRate, 0.12);
  assert.equal(f1.policyVersion, 1);

  const r = policy.createVersion({
    reason: 'novo acordo comercial',
    terms: {
      defaultCommissionRate: 0.09,
      partnerShareRate: 0.15,
      splits: { official: { owner: 0.6 }, community: { owner: 0.45 } },
    },
  }, 'operador');
  assert.ok(r.policy);
  assert.equal(r.policy.version, 2);

  const sale2 = {
    id: 'sale-after', trackId: 't-oficial-demo01', value: 1000, store: 'seller-sem-regra',
    at: store.now() + 10, partnerId: 'aurora',
  };
  const f2 = money.financialsForSale(sale2);
  assert.equal(f2.policyVersion, 2);
  assert.equal(f2.commissionRate, 0.09);
  assert.equal(f2.partnerShareRate, 0.15);
  assert.equal(f2.splitOwnerRate, 0.6);

  // A venda anterior continua com os termos originais.
  assert.equal(f1.commissionRate, 0.12);
  assert.equal(f1.partnerShareRate, 0.2);
  assert.equal(f1.splitOwnerRate, 0.5);
});

test('comissão explícita da oferta prevalece sobre política global', () => {
  policy.createVersion({ terms: { defaultCommissionRate: 0.07 } }, 'operador');
  const sale = {
    id: 'specific-offer', trackId: 't-oficial-demo01', value: 1000, store: 'urbano-oficial',
    at: store.now() + 10, commissionRate: 0.18,
  };
  const f = money.financialsForSale(sale);
  assert.equal(f.commissionRate, 0.18);
  assert.equal(f.commission, 180);
});

test('política comercial rejeita percentuais fora de 0% a 100%', () => {
  const r = policy.createVersion({ terms: { partnerShareRate: 1.2 } }, 'operador');
  assert.match(r.error, /0% e 100%/);
});
