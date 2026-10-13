const test = require("node:test");
const assert = require("node:assert/strict");

process.env.SCENESHOP_MEMORY = "1";
const store = require("../server/store");
const money = require("../server/money");
const antifraud = require("../server/antifraud");
const config = require("../server/config");
const { writePaidOrder } = require("../server/repositories/commerce-postgres");
const { PostgresStateRepository } = require("../server/data/postgres-state");

test("financial core: economia da venda fica congelada no instante da venda", () => {
  store.useMemory(true);
  const { click } = antifraud.registerClick({
    trackId: "t-ana-demo01", productId: "jaqueta-couro", storeId: "amazon", deviceId: "freeze-financial-01",
  });
  const sale = money.buildSale({ clickId: click.id, value: 1000, storeId: "amazon" });
  const before = money.entry(sale);
  const old = config.STORE_COMMISSION.amazon;
  config.STORE_COMMISSION.amazon = 0.49;
  try {
    const after = money.entry(sale);
    assert.equal(after.commission, before.commission);
    assert.equal(after.share, before.share);
    assert.equal(after.sceneshop, before.sceneshop);
  } finally {
    config.STORE_COMMISSION.amazon = old;
  }
});

test("financial core: writer PostgreSQL grava pedido, venda, comissão e auditoria", async () => {
  const queries = [];
  const client = {
    async query(sql, params) {
      queries.push({ sql: String(sql), params });
      if (/INSERT INTO sceneshop_orders/.test(sql)) return { rowCount: 1, rows: [{ sale_id: "v1", status: "pago" }] };
      return { rowCount: 1, rows: [] };
    },
  };
  const sale = {
    id: "v1", clickId: "c1", trackId: "t1", authorId: "a1", productId: "p1", store: "seller1",
    sellerId: "seller1", partnerId: "partner1", offerId: "of1", orderId: "ord1", value: 100,
    commissionRate: 0.1, attribution: "clique", official: true, reversed: false, at: Date.now(),
    financials: {
      currency: "BRL", commissionRate: 0.1, splitOwnerRate: 0.5, partnerShareRate: 0.2,
      commission: 10, partnerPart: 2, ownerShare: 4, sceneshopShare: 4,
      releaseAt: Date.now() + 1000, frozenAt: Date.now(),
    },
  };
  const order = { sellerId: "seller1", orderId: "ord1", offerId: "of1", saleId: "v1", amount: 100, status: "pago", via: "codigo", at: Date.now(), orderedAt: Date.now() };
  const auditEntry = { seq: 1, at: Date.now(), actor: "seller1", action: "pedido_confirmado", data: {}, prev: "GENESIS", hash: "abc" };
  const r = await writePaidOrder(client, { order, sale, auditEntry, coupon: null });
  assert.equal(r.saleId, "v1");
  assert.ok(queries.some((q) => /INSERT INTO sceneshop_orders/.test(q.sql)));
  assert.ok(queries.some((q) => /INSERT INTO sceneshop_sales/.test(q.sql)));
  assert.ok(queries.some((q) => /INSERT INTO sceneshop_commissions/.test(q.sql)));
  assert.ok(queries.some((q) => /INSERT INTO sceneshop_audit_log/.test(q.sql)));
});

test("financial core: idempotência PostgreSQL não grava venda duas vezes", async () => {
  const queries = [];
  const client = {
    async query(sql) {
      queries.push(String(sql));
      if (/INSERT INTO sceneshop_orders/.test(sql)) return { rowCount: 0, rows: [] };
      if (/SELECT sale_id,status FROM sceneshop_orders/.test(sql)) return { rowCount: 1, rows: [{ sale_id: "existing-sale", status: "pago" }] };
      throw new Error(`SQL inesperado após conflito: ${sql}`);
    },
  };
  const r = await writePaidOrder(client, {
    order: { sellerId: "s", orderId: "o", amount: 1, at: Date.now(), orderedAt: Date.now() },
    sale: { id: "new-sale", value: 1, financials: {} },
    auditEntry: {},
  });
  assert.equal(r.skipSnapshot, true);
  assert.equal(r.duplicate, true);
  assert.equal(r.saleId, "existing-sale");
  assert.equal(queries.filter((sql) => /INSERT INTO sceneshop_sales/.test(sql)).length, 0);
});

test("data plane: commit de domínio inclui write + snapshot + outbox na mesma transação", async () => {
  const repo = new PostgresStateRepository({ connectionString: "postgres://unused", projector: async () => ({}) });
  repo.revision = 3;
  const sequence = [];
  const query = async (sql, params) => {
    const text = String(sql).trim();
    sequence.push(text.split(/\s+/).slice(0, 4).join(" "));
    if (text === "BEGIN" || text === "COMMIT" || text === "ROLLBACK") return { rowCount: 0, rows: [] };
    if (/pg_advisory_xact_lock/.test(text)) return { rowCount: 1, rows: [{}] };
    if (/SELECT revision FROM sceneshop_state_snapshots/.test(text)) return { rowCount: 1, rows: [{ revision: 3 }] };
    if (/INSERT INTO domain_test/.test(text)) return { rowCount: 1, rows: [] };
    if (/UPDATE sceneshop_state_snapshots/.test(text)) {
      assert.equal(params[2], 3);
      return { rowCount: 1, rows: [{ revision: 4 }] };
    }
    if (/INSERT INTO sceneshop_outbox/.test(text)) return { rowCount: 1, rows: [] };
    throw new Error(`SQL inesperado: ${text}`);
  };
  repo.pool = { connect: async () => ({ query, release() {} }) };
  const r = await repo.commitDomainSnapshot(
    { version: 6, orders: [{ id: 1 }] },
    {
      topic: "commerce.order.confirmed", aggregateType: "order", aggregateId: "s:o", outboxPayload: { ok: true },
      write: (client) => client.query("INSERT INTO domain_test(value) VALUES(1)"),
    }
  );
  assert.equal(r.revision, 4);
  assert.equal(repo.revision, 4);
  assert.ok(sequence.some((x) => x.startsWith("INSERT INTO domain_test")));
  assert.ok(sequence.some((x) => x.startsWith("UPDATE sceneshop_state_snapshots")));
  assert.ok(sequence.some((x) => x.startsWith("INSERT INTO sceneshop_outbox")));
  assert.equal(sequence.at(-1), "COMMIT");
});
