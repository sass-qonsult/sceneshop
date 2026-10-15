/**
 * Transitional relational projection for SceneShop v0.9.
 *
 * The v0.8 application still mutates one synchronous state object.  When
 * PostgreSQL is selected, every durable flush projects that state into domain
 * tables in the same database transaction as the compatibility snapshot.
 * This gives us a real relational database now, while modules are moved one by
 * one to dedicated repositories in later v0.9 increments.
 */
const crypto = require("crypto");
const catalog = require("../catalog");
const { STORE_COMMISSION, SPLIT, HOLD_DAYS, PARTNER_SHARE } = require("../config");

const round = (v) => Math.round(Number(v || 0) * 100) / 100;
const syncIdFor = (w) => w.syncId || `SYNC-${crypto.createHash("sha256").update(String(w.id)).digest("hex").slice(0,16).toUpperCase()}`;

const asDate = (value) => {
  if (value == null || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return new Date(n);
};

function rowsFromState(state) {
  const cat = catalog.snapshot();
  const authors = Object.values(state.authors || {});
  const accounts = Object.values(state.accounts || {});
  const partners = Object.values(state.partners || {});
  const works = Object.values(cat.works || {});
  const products = Object.values(cat.products || {});
  const tracks = Object.values(state.tracks || {});
  const sellers = Object.values(state.sellers || {});
  const officialOffers = Object.entries(state.officialOffers || {}).map(([productId, offer]) => ({ productId, ...offer }));
  const issuedOffers = Object.values(state.issuedOffers || {});
  const clicks = state.clicks || [];
  const sales = state.sales || [];
  const trackById = Object.fromEntries(tracks.map((t) => [t.id, t]));
  const commissions = sales.map((sale) => {
    const track = trackById[sale.trackId];
    const type = track ? track.type : "community";
    const frozen = sale.financials || (() => {
      const commissionRate = Number(sale.commissionRate ?? STORE_COMMISSION[sale.store] ?? 0.10);
      const splitOwnerRate = Number((SPLIT[type] || SPLIT.community).owner);
      const partnerShareRate = sale.partnerId ? Number(PARTNER_SHARE) : 0;
      const policy = { policyId: "cp-baseline", policyVersion: 1 };
      const commission = round(Number(sale.value || 0) * commissionRate);
      const partnerPart = sale.partnerId ? round(commission * partnerShareRate) : 0;
      const ownerShare = round((commission - partnerPart) * splitOwnerRate);
      return {
        currency: "BRL", policyId: policy.policyId, policyVersion: policy.policyVersion, commissionRate, splitOwnerRate, partnerShareRate, commission,
        partnerPart, ownerShare, sceneshopShare: round(commission - partnerPart - ownerShare),
        releaseAt: Number(sale.at || 0) + HOLD_DAYS * 86400000, frozenAt: sale.at,
      };
    })();
    let status = "custodia";
    if (sale.reversed) status = "estornado";
    else if (sale.paidAt) status = "pago";
    return { id: `c_${sale.id}`, sale, frozen, status };
  });
  const orders = state.orders || [];
  const reports = state.reports || [];
  const alerts = state.alerts || [];
  const audit = state.audit || [];
  const events = state.events || [];
  const commercialPolicies = state.commercialPolicies || [];

  const workPartners = [];
  for (const [workId, ids] of Object.entries(state.workPartners || {})) {
    for (const partnerId of ids || []) workPartners.push({ workId, partnerId });
  }

  const scenes = [];
  const sceneProducts = [];
  for (const track of tracks) {
    (track.scenes || []).forEach((scene, scenePos) => {
      scenes.push({ trackId: track.id, position: scenePos, ...scene });
      (scene.products || []).forEach((product, productPos) => {
        sceneProducts.push({ trackId: track.id, sceneId: scene.id, position: productPos, ...product });
      });
    });
  }

  const codePool = [];
  for (const [sellerId, codes] of Object.entries(state.codePools || {})) {
    for (const code of codes || []) codePool.push({ sellerId, ...code });
  }

  return {
    authors, accounts, partners, works, products, tracks, sellers, officialOffers,
    issuedOffers, clicks, sales, commissions, orders, reports, alerts, audit, events, commercialPolicies,
    workPartners, scenes, sceneProducts, codePool,
  };
}

async function projectState(client, state) {
  const rows = rowsFromState(state);

  // Transitional domains are still mirrored by child-first replacement.
  // Identity/KYC and content are now PostgreSQL-authoritative, so their tables
  // are intentionally excluded from this destructive compatibility projection.
  for (const table of [
    "sceneshop_commissions",
    "sceneshop_orders",
    "sceneshop_sales",
    "sceneshop_clicks",
    "sceneshop_code_pool",
    "sceneshop_official_offers",
    "sceneshop_issued_offers",
    "sceneshop_reports",
    "sceneshop_alerts",
    "sceneshop_audit_log",
    "sceneshop_events",
    "sceneshop_commercial_policies",
    "sceneshop_partners",
    "sceneshop_sellers",
  ]) {
    await client.query(`DELETE FROM ${table}`);
  }

  // PostgreSQL is authoritative for both accounts and author/KYC state from
  // alpha.5.1 onward. The compatibility projector may bootstrap missing rows,
  // but it must never overwrite an existing identity with a stale snapshot.
  for (const a of rows.authors) {
    await client.query(
      `INSERT INTO sceneshop_authors(id,name,type,partner_id,managed_by,kyc_status,document,payload,updated_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,now())
       ON CONFLICT(id) DO NOTHING`,
      [a.id, a.name || a.id, a.type || "author", a.partnerId || null, a.managedBy || null,
       a.kyc || "pendente", a.document || null, JSON.stringify(a)]
    );
    if (a.id) {
      const kd = a.kycData || {};
      await client.query(
        `INSERT INTO sceneshop_author_kyc(
           author_id,status,document_hash,document_masked,legal_name,subject_type,pep,submitted_at,metadata,updated_at)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,now())
         ON CONFLICT(author_id) DO NOTHING`,
        [a.id, a.kyc || "pendente", a.kycDocHash || null, a.document || null, kd.name || null,
         kd.type || null, !!kd.pep, kd.submittedAt ? asDate(kd.submittedAt) : null, JSON.stringify({})]
      );
    }
  }

  for (const a of rows.accounts) {
    await client.query(
      `INSERT INTO sceneshop_accounts(username,password_hash,role,author_id,token_version,demo,created_at,payload,updated_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,now())
       ON CONFLICT(username) DO NOTHING`,
      [String(a.username || "").toLowerCase(), a.pass || "", a.role || "author", a.authorId || null,
       Number(a.tokenVersion || 0), !!a.demo, asDate(a.createdAt), JSON.stringify(a)]
    );
  }

  // Organizations and memberships are created by the tenant repository in normal
  // operation, but the seed/compatibility snapshot already references them
  // (tracks/works/products carry organization_id). Bootstrap them here, without
  // overwriting rows the authoritative repository already owns.
  const accountNames = new Set(rows.accounts.map((a) => String(a.username || "").toLowerCase()));
  for (const o of Object.values(state.organizations || {})) {
    if (!o || !o.id) continue;
    const createdBy = o.createdBy && accountNames.has(String(o.createdBy).toLowerCase()) ? String(o.createdBy).toLowerCase() : null;
    await client.query(
      `INSERT INTO sceneshop_organizations(id,slug,name,kind,status,created_by,settings,created_at,updated_at)
       VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,COALESCE($8,now()),COALESCE($9,now()))
       ON CONFLICT(id) DO NOTHING`,
      [o.id, o.slug || o.id, o.name || o.id, o.kind || "OTHER", o.status || "ACTIVE", createdBy,
       JSON.stringify(o.settings || {}), asDate(o.createdAt), asDate(o.updatedAt)]
    );
  }
  for (const m of Object.values(state.organizationMembers || {})) {
    if (!m || !m.organizationId || !m.username) continue;
    const username = String(m.username).toLowerCase();
    if (!accountNames.has(username) || !(state.organizations || {})[m.organizationId]) continue;
    await client.query(
      `INSERT INTO sceneshop_organization_members(organization_id,username,role,status,joined_at,created_at,updated_at)
       VALUES($1,$2,$3,$4,$5,COALESCE($6,now()),now())
       ON CONFLICT DO NOTHING`,
      [m.organizationId, username, m.role || "VIEWER", m.status || "ACTIVE", asDate(m.joinedAt), asDate(m.createdAt)]
    );
  }

  for (const p of rows.partners) {
    await client.query(
      `INSERT INTO sceneshop_partners(id,name,kind,public_key,domains,brand,payload,updated_at)
       VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb,now())`,
      [p.id, p.name || p.id, p.kind || null, p.publicKey || null, JSON.stringify(p.domains || []),
       JSON.stringify(p.brand || {}), JSON.stringify(p)]
    );
  }

  for (const p of rows.commercialPolicies || []) {
    const t = p.terms || {};
    await client.query(
      `INSERT INTO sceneshop_commercial_policies(
         id,version,status,effective_from,effective_to,created_at,created_by,reason,
         default_commission_rate,partner_share_rate,official_owner_rate,community_owner_rate,store_commission,payload)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14::jsonb)
       ON CONFLICT (id) DO UPDATE SET status=EXCLUDED.status,effective_to=EXCLUDED.effective_to,payload=EXCLUDED.payload`,
      [p.id, Number(p.version || 1), p.status || "active", asDate(p.effectiveFrom) || new Date(0), asDate(p.effectiveTo),
       asDate(p.createdAt) || new Date(), p.createdBy || "system", p.reason || null,
       Number(t.defaultCommissionRate || 0), Number(t.partnerShareRate || 0),
       Number(t.splits?.official?.owner || 0), Number(t.splits?.community?.owner || 0),
       JSON.stringify(t.storeCommission || {}), JSON.stringify(p)]
    );
  }

  for (const w of rows.works) {
    await client.query(
      `INSERT INTO sceneshop_works(id,title,duration_seconds,video_url,poster_url,owner_id,organization_id,pilot,sync_id,payload,updated_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,now())
       ON CONFLICT(id) DO NOTHING`,
      [w.id, w.title || w.id, Number(w.duration || 0), w.video || null, w.poster || null,
       w.ownerId || null, w.organizationId || null, !!w.pilot, syncIdFor(w), JSON.stringify({ ...w, syncId: syncIdFor(w) })]
    );
  }

  for (const wp of rows.workPartners) {
    // Ignore stale partner/work links in old runtimes instead of aborting the
    // whole migration; the audit tool will report them separately later.
    const existsWork = rows.works.some((w) => w.id === wp.workId);
    const existsPartner = rows.partners.some((p) => p.id === wp.partnerId);
    if (!existsWork || !existsPartner) continue;
    await client.query(
      `INSERT INTO sceneshop_work_partners(work_id,partner_id) VALUES($1,$2) ON CONFLICT DO NOTHING`,
      [wp.workId, wp.partnerId]
    );
  }

  for (const p of rows.products) {
    await client.query(
      `INSERT INTO sceneshop_products(id,name,brand,category,sku,image_url,reference_price,created_by,organization_id,payload,updated_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,now())
       ON CONFLICT(id) DO NOTHING`,
      [p.id, p.name || p.id, p.brand || null, p.category || null, p.sku || null, p.image || null,
       p.referencePrice == null ? null : Number(p.referencePrice), p.createdBy || null, p.organizationId || null, JSON.stringify(p)]
    );
  }

  for (const t of rows.tracks) {
    await client.query(
      `INSERT INTO sceneshop_tracks(id,work_id,type,author_id,organization_id,title,offset_seconds,status,created_at,payload,updated_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,now())
       ON CONFLICT(id) DO NOTHING`,
      [t.id, t.workId, t.type || "community", t.authorId || null, t.organizationId || null, t.title || t.id,
       Number(t.offset || 0), t.status || "ativa", asDate(t.createdAt), JSON.stringify(t)]
    );
  }

  for (const s of rows.scenes) {
    await client.query(
      `INSERT INTO sceneshop_track_scenes(track_id,scene_id,title,start_seconds,end_seconds,position,payload)
       VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)
       ON CONFLICT(track_id,scene_id) DO NOTHING`,
      [s.trackId, s.id, s.title || null, Number(s.start || 0), Number(s.end || 0), s.position, JSON.stringify(s)]
    );
  }

  for (const p of rows.sceneProducts) {
    await client.query(
      `INSERT INTO sceneshop_scene_products(track_id,scene_id,product_id,match_type,position,box,payload)
       VALUES($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb)
       ON CONFLICT(track_id,scene_id,product_id,position) DO NOTHING`,
      [p.trackId, p.sceneId, p.id, p.match || null, p.position, p.box ? JSON.stringify(p.box) : null, JSON.stringify(p)]
    );
  }

  for (const s of rows.sellers) {
    await client.query(
      `INSERT INTO sceneshop_sellers(id,name,cnpj,verified,kind,integration,store_url,secret,agreement,payload,updated_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,now())`,
      [s.id, s.name || s.id, s.cnpj || null, !!s.verified, s.kind || null, s.integration || null,
       s.storeUrl || null, s.secret || null, JSON.stringify(s.agreement || {}), JSON.stringify(s)]
    );
  }

  for (const o of rows.officialOffers) {
    if (!rows.sellers.some((s) => s.id === o.sellerId)) continue;
    await client.query(
      `INSERT INTO sceneshop_official_offers(product_id,seller_id,price,commission,valid_until,set_by,payload,updated_at)
       VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,now())`,
      [o.productId, o.sellerId, Number(o.price || 0), Number(o.commission || 0), asDate(o.validUntil),
       o.setBy || null, JSON.stringify(o)]
    );
  }

  for (const o of rows.issuedOffers) {
    await client.query(
      `INSERT INTO sceneshop_issued_offers(id,product_id,seller_id,price_cents,currency,commission,work_id,track_id,click_id,partner_id,issued_at,expires_at,payload)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb)`,
      [o.oid || o.id, o.pid || o.productId, o.sid || o.sellerId, Number(o.prc || 0), o.cur || "BRL",
       Number(o.com || 0), o.wid || null, o.tid || null, o.cid || null, o.par || null,
       asDate(o.iat), asDate(o.exp), JSON.stringify(o)]
    );
  }

  for (const c of rows.clicks) {
    await client.query(
      `INSERT INTO sceneshop_clicks(id,track_id,author_id,product_id,store_id,device_id,session_id,partner_id,anonymous,occurred_at,payload)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)`,
      [c.id, c.trackId || null, c.authorId || null, c.productId || null, c.store || null,
       c.deviceId || null, c.session || null, c.partnerId || null, !!c.anonymous, asDate(c.at), JSON.stringify(c)]
    );
  }

  for (const s of rows.sales) {
    await client.query(
      `INSERT INTO sceneshop_sales(id,click_id,track_id,author_id,product_id,store_id,seller_id,partner_id,offer_id,order_id,value,commission_rate,attribution,official,reversed,occurred_at,paid_at,payload)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18::jsonb)`,
      [s.id, s.clickId || null, s.trackId || null, s.authorId || null, s.productId || null, s.store || null,
       s.sellerId || null, s.partnerId || null, s.offerId || null, s.orderId || null, Number(s.value || 0),
       s.commissionRate == null ? null : Number(s.commissionRate), s.attribution || null, !!s.official,
       !!s.reversed, asDate(s.at), asDate(s.paidAt), JSON.stringify(s)]
    );
  }

  for (const c of rows.commissions) {
    const sale = c.sale;
    const f = c.frozen;
    await client.query(
      `INSERT INTO sceneshop_commissions(
         id,sale_id,seller_id,order_id,author_id,track_id,partner_id,currency,
         gross_sale,gross_commission,partner_share,owner_share,sceneshop_share,
         commission_rate,split_owner_rate,partner_share_rate,commercial_policy_id,commercial_policy_version,status,release_at,created_at,paid_at,reversed_at,payload)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24::jsonb)`,
      [c.id, sale.id, sale.sellerId || null, sale.orderId || null, sale.authorId || null,
       sale.trackId || null, sale.partnerId || null, f.currency || "BRL", Number(sale.value || 0),
       Number(f.commission || 0), Number(f.partnerPart || 0), Number(f.ownerShare || 0),
       Number(f.sceneshopShare || 0), Number(f.commissionRate || 0), Number(f.splitOwnerRate || 0),
       Number(f.partnerShareRate || 0), f.policyId || null, f.policyVersion == null ? null : Number(f.policyVersion), c.status, asDate(f.releaseAt), asDate(f.frozenAt || sale.at),
       asDate(sale.paidAt), sale.reversed ? asDate(sale.reversedAt || sale.at) : null, JSON.stringify({ sale, financials: f })]
    );
  }

  for (const o of rows.orders) {
    await client.query(
      `INSERT INTO sceneshop_orders(seller_id,order_id,offer_id,sale_id,amount,status,via,received_at,ordered_at,payload)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)`,
      [o.sellerId, o.orderId, o.offerId || null, o.saleId || null, Number(o.amount || 0), o.status || "pago",
       o.via || null, asDate(o.at) || new Date(), asDate(o.orderedAt), JSON.stringify(o)]
    );
  }

  for (const c of rows.codePool) {
    await client.query(
      `INSERT INTO sceneshop_code_pool(seller_id,code,product_id,status,offer_id,reserved_at,payload)
       VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)`,
      [c.sellerId, c.code, c.productId || null, c.status || "livre", c.offerId || null, asDate(c.reservedAt), JSON.stringify(c)]
    );
  }

  for (const r of rows.reports) {
    await client.query(
      `INSERT INTO sceneshop_reports(id,track_id,scene_id,product_id,reason,device_id,weight,occurred_at,payload)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)`,
      [r.id, r.trackId || null, r.sceneId || null, r.productId || null, r.reason || null,
       r.deviceId || null, r.weight == null ? null : Number(r.weight), asDate(r.at), JSON.stringify(r)]
    );
  }

  for (const a of rows.alerts) {
    await client.query(
      `INSERT INTO sceneshop_alerts(id,alert_key,author_id,rule,severity,detail,status,occurred_at,payload)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)`,
      [a.id, a.key || null, a.authorId || null, a.rule || null, a.severity || null, a.detail || null,
       a.status || null, asDate(a.at), JSON.stringify(a)]
    );
  }

  for (const a of rows.audit) {
    await client.query(
      `INSERT INTO sceneshop_audit_log(seq,occurred_at,actor,action,data,prev_hash,entry_hash,payload)
       VALUES($1,$2,$3,$4,$5::jsonb,$6,$7,$8::jsonb)`,
      [Number(a.seq), asDate(a.at), a.actor || null, a.action || "unknown", JSON.stringify(a.data || {}),
       a.prev || null, a.hash, JSON.stringify(a)]
    );
  }

  for (const e of rows.events) {
    await client.query(
      `INSERT INTO sceneshop_events(event_type,work_id,track_id,device_id,partner_id,occurred_at,payload)
       VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)`,
      [e.type || null, e.workId || null, e.trackId || null, e.deviceId || null, e.partnerId || null,
       asDate(e.at), JSON.stringify(e)]
    );
  }

  return Object.fromEntries(Object.entries(rows).map(([k, v]) => [k, v.length]));
}

module.exports = { rowsFromState, projectState, asDate };
