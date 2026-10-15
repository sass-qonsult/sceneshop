/**
 * Escritas financeiras nativas do PostgreSQL.
 *
 * Este módulo não decide regras comerciais; recebe fatos já validados e
 * congelados pelo domínio e os grava em uma única transação fornecida pelo
 * PostgresStateRepository.
 */
const asDate = (value) => value == null ? null : new Date(Number(value));

function commissionRow(sale) {
  const f = sale.financials || {};
  return {
    id: `c_${sale.id}`,
    saleId: sale.id,
    sellerId: sale.sellerId || null,
    orderId: sale.orderId || null,
    authorId: sale.authorId || null,
    trackId: sale.trackId || null,
    partnerId: sale.partnerId || null,
    currency: f.currency || "BRL",
    grossSale: Number(sale.value || 0),
    grossCommission: Number(f.commission || 0),
    partnerShare: Number(f.partnerPart || 0),
    ownerShare: Number(f.ownerShare || 0),
    sceneshopShare: Number(f.sceneshopShare || 0),
    commissionRate: Number(f.commissionRate || 0),
    splitOwnerRate: Number(f.splitOwnerRate || 0),
    partnerShareRate: Number(f.partnerShareRate || 0),
    policyId: f.policyId || null,
    policyVersion: f.policyVersion == null ? null : Number(f.policyVersion),
    status: sale.reversed ? "estornado" : sale.paidAt ? "pago" : "custodia",
    releaseAt: f.releaseAt,
    createdAt: f.frozenAt || sale.at,
  };
}

async function insertAudit(client, entry) {
  await client.query(
    `INSERT INTO sceneshop_audit_log(seq,occurred_at,actor,action,data,prev_hash,entry_hash,payload)
     VALUES($1,$2,$3,$4,$5::jsonb,$6,$7,$8::jsonb)`,
    [entry.seq, asDate(entry.at), entry.actor || "sistema", entry.action,
     JSON.stringify(entry.data || {}), entry.prev, entry.hash, JSON.stringify(entry)]
  );
}

async function writePaidOrder(client, { order, sale, auditEntry, coupon }) {
  // A PK (seller_id,order_id) é a barreira de idempotência entre processos.
  const insertedOrder = await client.query(
    `INSERT INTO sceneshop_orders(seller_id,order_id,offer_id,sale_id,amount,status,via,received_at,ordered_at,payload)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)
     ON CONFLICT(seller_id,order_id) DO NOTHING
     RETURNING sale_id,status`,
    [order.sellerId, order.orderId, order.offerId || null, order.saleId || null,
     Number(order.amount || 0), order.status || "pago", order.via || null,
     asDate(order.at), asDate(order.orderedAt), JSON.stringify(order)]
  );
  if (!insertedOrder.rowCount) {
    const existing = await client.query(
      `SELECT sale_id,status FROM sceneshop_orders WHERE seller_id=$1 AND order_id=$2`,
      [order.sellerId, order.orderId]
    );
    return {
      skipSnapshot: true,
      duplicate: true,
      saleId: existing.rows[0] && existing.rows[0].sale_id,
      status: existing.rows[0] && existing.rows[0].status,
    };
  }

  await client.query(
    `INSERT INTO sceneshop_sales(id,click_id,track_id,author_id,product_id,store_id,seller_id,partner_id,offer_id,order_id,value,commission_rate,attribution,official,reversed,occurred_at,paid_at,payload)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18::jsonb)`,
    [sale.id, sale.clickId || null, sale.trackId || null, sale.authorId || null,
     sale.productId || null, sale.store || null, sale.sellerId || null, sale.partnerId || null,
     sale.offerId || null, sale.orderId || null, Number(sale.value || 0),
     sale.commissionRate == null ? null : Number(sale.commissionRate), sale.attribution || null,
     !!sale.official, !!sale.reversed, asDate(sale.at), asDate(sale.paidAt), JSON.stringify(sale)]
  );

  const c = commissionRow(sale);
  await client.query(
    `INSERT INTO sceneshop_commissions(
       id,sale_id,seller_id,order_id,author_id,track_id,partner_id,currency,
       gross_sale,gross_commission,partner_share,owner_share,sceneshop_share,
       commission_rate,split_owner_rate,partner_share_rate,commercial_policy_id,commercial_policy_version,status,release_at,created_at,payload)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22::jsonb)`,
    [c.id,c.saleId,c.sellerId,c.orderId,c.authorId,c.trackId,c.partnerId,c.currency,
     c.grossSale,c.grossCommission,c.partnerShare,c.ownerShare,c.sceneshopShare,
     c.commissionRate,c.splitOwnerRate,c.partnerShareRate,c.policyId || null,c.policyVersion == null ? null : Number(c.policyVersion),c.status,asDate(c.releaseAt),asDate(c.createdAt),
     JSON.stringify({ saleId: sale.id, financials: sale.financials })]
  );

  if (coupon) {
    const updated = await client.query(
      `UPDATE sceneshop_code_pool
       SET status='usado', offer_id=COALESCE(offer_id,$3), payload=$4::jsonb
       WHERE seller_id=$1 AND code=$2 AND status <> 'usado'`,
      [order.sellerId, coupon.code, sale.offerId || null, JSON.stringify(coupon)]
    );
    if (!updated.rowCount) {
      const err = new Error("Cupom já utilizado durante a transação financeira.");
      err.code = "SCENESHOP_COUPON_CONFLICT";
      throw err;
    }
  }

  await insertAudit(client, auditEntry);
  return { saleId: sale.id, commissionId: c.id };
}

async function writeReversal(client, { order, sale, auditEntry }) {
  const existing = await client.query(
    `SELECT sale_id,status FROM sceneshop_orders WHERE seller_id=$1 AND order_id=$2 FOR UPDATE`,
    [order.sellerId, order.orderId]
  );
  if (!existing.rowCount) {
    const err = new Error("Pedido não encontrado no PostgreSQL.");
    err.code = "SCENESHOP_ORDER_NOT_FOUND";
    throw err;
  }
  if (existing.rows[0].status === "devolvido") {
    return { skipSnapshot: true, duplicate: true, status: "estornado", saleId: existing.rows[0].sale_id };
  }

  await client.query(
    `UPDATE sceneshop_orders SET status='devolvido', payload=$3::jsonb WHERE seller_id=$1 AND order_id=$2`,
    [order.sellerId, order.orderId, JSON.stringify(order)]
  );
  if (sale) {
    await client.query(
      `UPDATE sceneshop_sales SET reversed=true,payload=$2::jsonb WHERE id=$1`,
      [sale.id, JSON.stringify(sale)]
    );
    await client.query(
      `UPDATE sceneshop_commissions SET status='estornado',reversed_at=$2,payload=$3::jsonb WHERE sale_id=$1`,
      [sale.id, asDate(sale.reversedAt || Date.now()), JSON.stringify({ saleId: sale.id, reversed: true })]
    );
  }
  await insertAudit(client, auditEntry);
  return { saleId: sale && sale.id, status: "estornado" };
}

module.exports = { commissionRow, writePaidOrder, writeReversal };
