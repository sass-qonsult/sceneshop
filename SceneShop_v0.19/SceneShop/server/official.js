/**
 * Oferta oficial com preço garantido ("código implícito").
 *
 * A produtora (ou o estúdio) fecha um ACORDO COMERCIAL com cada loja: a loja da própria marca
 * ou um grande varejista/marketplace. O acordo define preço, comissão e validade. O SceneShop
 * garante que o espectador chegue à loja com esse preço e que a comissão seja registrada.
 *
 * Como a loja reconhece o preço (definido no acordo — campo `integration` do vendedor):
 *
 *   assinatura      A loja confere o código de oferta assinado (Ed25519) com a chave pública
 *                   do SceneShop. Típico de loja própria da marca (plugin Shopify/VTEX/Nuvemshop).
 *   codigos_unicos  O varejista entrega um LOTE de cupons de uso único com o preço negociado.
 *                   O SceneShop dá um cupom diferente a cada clique e sabe exatamente de qual
 *                   obra/trilha/canal veio a venda quando o cupom é usado.
 *   link_campanha   O varejista cria uma campanha (página ou ID) com o preço negociado.
 *                   O SceneShop leva o espectador até ela com a referência da oferta (ss_ref).
 *
 * Em todos os casos o link também leva o código assinado (ss_offer), para auditoria.
 *
 * Como a loja confirma as vendas:
 *   - aviso por pedido:  POST /api/sellers/:id/orders   (na hora do pagamento/devolução)
 *   - relatório diário:  POST /api/sellers/:id/report   (lote de pedidos, conciliado)
 * Ambos assinados com o segredo da loja (HMAC). A venda identifica a oferta por
 * `offer` (código), `coupon` (cupom) ou `ref` (referência da oferta).
 */
const crypto = require("crypto");
const store = require("./store");
const catalog = require("./catalog");
const audit = require("./audit");
const { writePaidOrder, writeReversal } = require("./repositories/commerce-postgres");
const { OFFER_TTL_HOURS, WEBHOOK_TOLERANCE_MIN, REPORT_MAX_DAYS, CODE_POOL_LOW } = require("./config");
const commercialPolicy = require("./commercial-policy");

const S = () => store.state;
const b64 = (x) => Buffer.from(x).toString("base64url");
const round = (v) => Math.round(v * 100) / 100;
const INTEGRATIONS = {
  assinatura: "Código assinado (loja confere)",
  codigos_unicos: "Cupons de uso único do varejista",
  link_campanha: "Link de campanha do varejista",
};

// ---------------------------------------------------------------- ofertas oficiais (definidas pela produtora)
function agreementValid(seller) {
  const a = seller.agreement;
  return !a || (a.until || Infinity) >= store.now();
}

function offerFor(productId) {
  const o = S().officialOffers[productId];
  if (!o) return null;
  const seller = S().sellers[o.sellerId];
  if (!seller || !seller.verified || !agreementValid(seller) || o.validUntil < store.now()) return null;
  return { ...o, seller };
}

// Formato de oferta usado no painel/celular (fica sempre no topo da lista)
function asListedOffer(productId) {
  const o = offerFor(productId);
  if (!o) return null;
  const retailer = o.seller.kind === "varejista";
  return {
    store: o.seller.id, storeName: o.seller.name, color: "#f5c542", official: true, guaranteed: true,
    price: o.price, currency: "BRL", inStock: true, integration: o.seller.integration,
    shipping: retailer ? "Preço negociado pela produção" : "Vendedor indicado pela produção",
    label: retailer ? "Preço negociado pela produção com a loja · garantido" : "Loja oficial indicada pela produção · preço garantido",
    url: o.seller.storeUrl,
  };
}

function setOffer(productId, { sellerId, price, commission, validDays }, actor, { product } = {}) {
  const p = product || catalog.getProduct(productId);
  if (!p) return { error: "Produto não encontrado." };
  if (!sellerId) {
    delete S().officialOffers[productId];
    audit.log(actor, "oferta_oficial_removida", { productId });
    store.save();
    return { ok: true };
  }
  const seller = S().sellers[sellerId];
  const pr = Number(price), cm = Number(commission);
  const errors = [];
  if (!seller || !seller.verified) errors.push("Loja não verificada.");
  else if (!agreementValid(seller)) errors.push("O acordo com essa loja está vencido.");
  if (!(pr > 0 && pr < 1e6)) errors.push("Preço garantido inválido.");
  if (!(cm >= 0 && cm <= 1)) errors.push("Comissão deve ficar entre 0% e 100%.");
  if (seller && seller.integration === "link_campanha" && !(seller.campaigns || {})[productId]) {
    errors.push("Essa loja ainda não criou a campanha deste produto. Informe o ID da campanha em Acordos.");
  }
  if (errors.length) return { errors };
  S().officialOffers[productId] = {
    sellerId, price: round(pr), commission: cm, setBy: actor,
    validUntil: store.now() + Math.min(365, Math.max(1, Number(validDays) || 90)) * store.DAY,
  };
  audit.log(actor, "oferta_oficial_definida", { productId, sellerId, preco: round(pr), comissao: cm });
  store.save();
  return { offer: S().officialOffers[productId] };
}

// ---------------------------------------------------------------- código de oferta (assinado)
function sign(payload) {
  const body = b64(JSON.stringify(payload));
  const key = crypto.createPrivateKey(S().offerKeys.private);
  const sig = crypto.sign(null, Buffer.from(body), key).toString("base64url");
  return `so1.${body}.${sig}`;
}

function issueToken({ productId, click, workId, partnerId }) {
  const o = offerFor(productId);
  if (!o) return null;
  const now = store.now();
  const payload = {
    v: 1, oid: "of_" + crypto.randomBytes(9).toString("base64url"),
    pid: productId, sid: o.seller.id, prc: Math.round(o.price * 100), cur: "BRL", com: o.commission ?? (commercialPolicy.current(now) || commercialPolicy.ensureDefault()).terms.defaultCommissionRate,
    wid: workId || null, tid: click ? click.trackId : null, cid: click ? click.id : null, par: partnerId || null,
    iat: now, exp: now + OFFER_TTL_HOURS * 3600e3,
  };
  // guardamos a oferta emitida: cupons e referências de campanha apontam para ela na conciliação
  S().issuedOffers[payload.oid] = payload;
  pruneIssued();
  store.save();
  return { token: sign(payload), payload };
}

function pruneIssued() {
  const limit = store.now() - (REPORT_MAX_DAYS + 3) * store.DAY;
  const all = S().issuedOffers;
  const keys = Object.keys(all);
  if (keys.length < 5000) return;
  keys.forEach((k) => { if (all[k].exp < limit) delete all[k]; });
}

function verifyToken(token, { at, publicKeyPem } = {}) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3 || parts[0] !== "so1") return { valid: false, reason: "formato" };
  const key = crypto.createPublicKey(publicKeyPem || S().offerKeys.public);
  let ok = false;
  try { ok = crypto.verify(null, Buffer.from(parts[1]), key, Buffer.from(parts[2], "base64url")); } catch (e) { ok = false; }
  if (!ok) return { valid: false, reason: "assinatura" };
  const p = JSON.parse(Buffer.from(parts[1], "base64url").toString());
  if ((at || store.now()) > p.exp) return { valid: false, reason: "expirado", payload: p };
  return { valid: true, payload: p };
}

// ---------------------------------------------------------------- cupons de uso único (lote do varejista)
const pool = (sellerId) => (S().codePools[sellerId] = S().codePools[sellerId] || []);

function addCodes(sellerId, productId, codes, actor) {
  const seller = S().sellers[sellerId];
  if (!seller || seller.integration !== "codigos_unicos") return { error: "Essa loja não trabalha com cupons de uso único." };
  const list = pool(sellerId);
  const known = new Set(list.map((c) => c.code));
  const clean = [...new Set(String(codes || "").split(/[\s,;]+/).map((c) => c.trim().toUpperCase()).filter(Boolean))];
  const invalid = clean.filter((c) => !/^[A-Z0-9-]{4,32}$/.test(c));
  const added = clean.filter((c) => !invalid.includes(c) && !known.has(c));
  added.forEach((code) => list.push({ code, productId: productId || null, status: "livre" }));
  audit.log(actor, "cupons_recebidos", { sellerId, productId: productId || "qualquer", quantidade: added.length });
  store.save();
  return { added: added.length, duplicated: clean.length - added.length - invalid.length, invalid };
}

// cupons reservados cuja oferta venceu sem compra voltam para o lote
function recycle(sellerId) {
  const now = store.now();
  pool(sellerId).forEach((c) => {
    if (c.status === "reservado") {
      const off = S().issuedOffers[c.offerId];
      if (!off || off.exp < now) Object.assign(c, { status: "livre", offerId: null, reservedAt: null });
    }
  });
}

function assignCode(sellerId, productId, offerId) {
  recycle(sellerId);
  const c = pool(sellerId).find((x) => x.status === "livre" && x.productId === productId) ||
    pool(sellerId).find((x) => x.status === "livre" && !x.productId);
  if (!c) return null;
  Object.assign(c, { status: "reservado", offerId, reservedAt: store.now() });
  store.save();
  return c.code;
}

function poolStatus(sellerId) {
  recycle(sellerId);
  const l = pool(sellerId);
  const count = (st) => l.filter((c) => c.status === st).length;
  const byProduct = {};
  l.filter((c) => c.status === "livre").forEach((c) => { const k = c.productId || "*"; byProduct[k] = (byProduct[k] || 0) + 1; });
  return { livre: count("livre"), reservado: count("reservado"), usado: count("usado"), total: l.length, byProduct, low: count("livre") < CODE_POOL_LOW };
}

// ---------------------------------------------------------------- link de compra conforme o acordo com a loja
function buildRedirect({ productId, click, workId, partnerId }) {
  const o = offerFor(productId);
  if (!o) return null;
  const issued = issueToken({ productId, click, workId, partnerId });
  const seller = o.seller;
  const q = new URLSearchParams({ produto: productId });
  let guaranteed = true;
  if (seller.integration === "codigos_unicos") {
    const code = assignCode(seller.id, productId, issued.payload.oid);
    if (code) q.set("cupom", code);
    else {
      guaranteed = false; // acabaram os cupons: o espectador vai à loja sem preço garantido
      audit.log("sistema", "cupons_esgotados", { sellerId: seller.id, productId });
    }
    q.set("ss_ref", issued.payload.oid);
  } else if (seller.integration === "link_campanha") {
    q.set("campanha", seller.campaigns[productId]);
    q.set("ss_ref", issued.payload.oid);
  }
  q.set("ss_offer", issued.token);
  const sep = seller.storeUrl.includes("?") ? "&" : "?";
  return { url: `${seller.storeUrl}${sep}${q}`, guaranteed, offerId: issued.payload.oid };
}

// ---------------------------------------------------------------- confirmação de vendas pela loja
function sellerSignature(secret, ts, rawBody) {
  return crypto.createHmac("sha256", secret).update(`${ts}.${rawBody}`).digest("hex");
}

function checkSellerSignature(seller, { ts, sig, rawBody }) {
  if (!ts || !sig) return false;
  if (Math.abs(Date.now() - Number(ts)) > WEBHOOK_TOLERANCE_MIN * 60e3) return false; // evita reenvio de avisos antigos
  const expect = sellerSignature(seller.secret, ts, rawBody);
  return sig.length === expect.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expect));
}

function parseTime(v) {
  if (v == null || v === "") return store.now();
  const n = typeof v === "number" ? v : Date.parse(v);
  return isNaN(n) ? null : n;
}

// Descobre a oferta de uma venda: pelo código assinado, pelo cupom ou pela referência
function resolveOffer(seller, order, orderedAt) {
  if (order.offer) {
    const v = verifyToken(order.offer, { at: orderedAt });
    if (!v.valid) return { error: `Código de oferta inválido (${v.reason}).`, code: 422 };
    return { payload: v.payload };
  }
  if (order.coupon) {
    const c = pool(seller.id).find((x) => x.code === String(order.coupon).toUpperCase());
    if (!c) return { error: "Cupom desconhecido.", code: 422 };
    if (c.status === "usado") return { error: "Cupom já utilizado em outro pedido.", code: 409, couponReuse: true };
    const payload = S().issuedOffers[c.offerId];
    if (!payload) return { error: "Cupom não foi entregue a nenhum espectador.", code: 422 };
    return { payload, coupon: c };
  }
  if (order.ref) {
    const payload = S().issuedOffers[order.ref];
    if (!payload) return { error: "Referência de oferta desconhecida.", code: 422 };
    return { payload };
  }
  return { error: "Informe offer, coupon ou ref.", code: 400 };
}

function mapPostgresCommerceError(err) {
  if (err && err.code === "SCENESHOP_CONCURRENT_WRITE") {
    return { error: "Conflito de concorrência; reenvie o aviso do pedido.", code: 409 };
  }
  if (err && err.code === "SCENESHOP_COUPON_CONFLICT") {
    return { error: "Cupom já utilizado em outro pedido.", code: 409 };
  }
  if (err && err.code === "SCENESHOP_ORDER_NOT_FOUND") {
    return { error: "Pedido não encontrado.", code: 404 };
  }
  throw err;
}

async function confirmPaidOrderPostgres(seller, order, deps, { orderId, orderedAt, resolved, qty, unit }) {
  try {
    const committed = await store.atomicDomain((draft) => {
      const duplicate = (draft.orders || []).find((o) => o.sellerId === seller.id && o.orderId === orderId);
      if (duplicate) {
        return {
          snapshot: draft,
          write: async () => ({ skipSnapshot: true, duplicate: true, saleId: duplicate.saleId, status: duplicate.status }),
          result: { duplicate: true, saleId: duplicate.saleId },
        };
      }

      const p = resolved.payload;
      let coupon = null;
      if (resolved.coupon) {
        coupon = ((draft.codePools || {})[seller.id] || []).find((x) => x.code === resolved.coupon.code);
        if (!coupon || coupon.status === "usado") {
          return {
            snapshot: draft,
            write: async () => ({ skipSnapshot: true, couponConflict: true }),
            result: { error: "Cupom já utilizado em outro pedido.", code: 409 },
          };
        }
      }

      const sale = deps.money.buildSale({
        clickId: p.cid, value: round(unit * qty), storeId: seller.id, at: orderedAt,
        official: { sellerId: seller.id, commission: p.com, offerId: p.oid, partnerId: p.par, orderId, trackId: p.tid },
      });
      const via = order.offer ? "codigo" : order.coupon ? "cupom" : "referencia";
      const orderRecord = {
        sellerId: seller.id, orderId, offerId: p.oid, saleId: sale.id,
        amount: round(unit * qty), status: "pago", via, at: store.now(), orderedAt,
      };
      draft.sales.push(sale);
      draft.orders.push(orderRecord);
      if (coupon) Object.assign(coupon, { status: "usado", orderId });

      const auditEntry = audit.prepareEntry(
        draft.audit,
        seller.id,
        "pedido_confirmado",
        { orderId, offerId: p.oid, via, valor: orderRecord.amount, comissao: p.com }
      );
      draft.audit.push(auditEntry);

      const response = {
        ok: true,
        saleId: sale.id,
        commission: sale.financials.commission,
        attributedTo: sale.authorId,
      };
      return {
        snapshot: draft,
        topic: "commerce.order.confirmed",
        aggregateType: "order",
        aggregateId: `${seller.id}:${orderId}`,
        outboxPayload: {
          sellerId: seller.id, orderId, saleId: sale.id, offerId: p.oid,
          authorId: sale.authorId, amount: orderRecord.amount,
          commission: sale.financials.commission,
          ownerShare: sale.financials.ownerShare,
          partnerShare: sale.financials.partnerPart,
          sceneshopShare: sale.financials.sceneshopShare,
        },
        write: (client) => writePaidOrder(client, { order: orderRecord, sale, auditEntry, coupon }),
        result: { response, authorId: sale.authorId },
      };
    });

    if (committed.writeResult && committed.writeResult.couponConflict) {
      return { error: "Cupom já utilizado em outro pedido.", code: 409 };
    }
    if (committed.writeResult && committed.writeResult.duplicate) {
      return { ok: true, duplicate: true, saleId: committed.writeResult.saleId };
    }
    if (committed.result && committed.result.error) return committed.result;
    const response = committed.result.response;
    if (committed.result.authorId) deps.aml.evaluate(committed.result.authorId);
    return response;
  } catch (err) {
    return mapPostgresCommerceError(err);
  }
}

async function reverseOrderPostgres(seller, orderId) {
  try {
    const committed = await store.atomicDomain((draft) => {
      const existing = (draft.orders || []).find((o) => o.sellerId === seller.id && o.orderId === orderId);
      if (!existing) {
        return {
          snapshot: draft,
          write: async () => ({ skipSnapshot: true, notFound: true }),
          result: { error: "Pedido não encontrado.", code: 404 },
        };
      }
      if (existing.status === "devolvido") {
        return {
          snapshot: draft,
          write: async () => ({ skipSnapshot: true, duplicate: true, status: "estornado", saleId: existing.saleId }),
          result: { ok: true, duplicate: true, status: "estornado" },
        };
      }

      const sale = draft.sales.find((x) => x.id === existing.saleId);
      const now = store.now();
      let reversedSale = null;
      if (sale && !sale.paidAt) {
        sale.reversed = true;
        sale.reversedAt = now;
        reversedSale = sale;
      }
      existing.status = "devolvido";
      existing.returnedAt = now;
      const auditEntry = audit.prepareEntry(
        draft.audit, seller.id, "pedido_devolvido", { orderId, saleId: existing.saleId }, now
      );
      draft.audit.push(auditEntry);

      return {
        snapshot: draft,
        topic: "commerce.order.reversed",
        aggregateType: "order",
        aggregateId: `${seller.id}:${orderId}`,
        outboxPayload: { sellerId: seller.id, orderId, saleId: existing.saleId, reversed: !!reversedSale },
        write: (client) => writeReversal(client, { order: existing, sale: reversedSale, auditEntry }),
        result: { ok: true, status: "estornado" },
      };
    });
    if (committed.writeResult && committed.writeResult.notFound) return { error: "Pedido não encontrado.", code: 404 };
    if (committed.writeResult && committed.writeResult.duplicate) return { ok: true, duplicate: true, status: "estornado" };
    return committed.result;
  } catch (err) {
    return mapPostgresCommerceError(err);
  }
}

function processOrder(seller, order, deps) {
  const orderId = String(order.orderId || "").slice(0, 64);
  if (!orderId) return { error: "orderId obrigatório." };
  const existing = S().orders.find((o) => o.sellerId === seller.id && o.orderId === orderId);

  if (order.status === "devolvido") {
    if (store.backendKind() === "postgres") return reverseOrderPostgres(seller, orderId);
    if (!existing) return { error: "Pedido não encontrado.", code: 404 };
    if (existing.status === "devolvido") return { ok: true, duplicate: true, status: "estornado" };
    const sale = S().sales.find((s) => s.id === existing.saleId);
    if (sale && !sale.paidAt) {
      sale.reversed = true;
      sale.reversedAt = store.now();
    }
    existing.status = "devolvido";
    audit.log(seller.id, "pedido_devolvido", { orderId, saleId: existing.saleId });
    store.save();
    return { ok: true, status: "estornado" };
  }
  if (existing) return { ok: true, duplicate: true, saleId: existing.saleId }; // o mesmo pedido nunca conta duas vezes

  // pedidos de relatório podem chegar dias depois: vale a data do pedido, dentro da validade da oferta
  const orderedAt = parseTime(order.orderedAt);
  if (orderedAt == null) return { error: "orderedAt inválido." };
  if (orderedAt > store.now() + 5 * 60e3) return { error: "Pedido com data no futuro." };
  if (store.now() - orderedAt > REPORT_MAX_DAYS * store.DAY) return { error: `Pedido com mais de ${REPORT_MAX_DAYS} dias: fora do prazo de conciliação.`, code: 422 };

  const r = resolveOffer(seller, order, orderedAt);
  if (r.error) {
    if (r.couponReuse) {
      audit.log("sistema", "cupom_reutilizado", { sellerId: seller.id, coupon: order.coupon, orderId });
      deps.aml.raiseSeller(seller.id, `Cupom ${order.coupon} informado de novo no pedido ${orderId}.`, `cupom:${seller.id}:${order.coupon}:${orderId}`, "cupom_reutilizado");
    }
    return r;
  }
  const p = r.payload;
  if (p.sid !== seller.id) return { error: "Oferta de outra loja.", code: 422 };
  if (orderedAt < p.iat - 60e3 || orderedAt > p.exp) return { error: "Pedido fora da validade da oferta.", code: 422 };

  const qty = Math.max(1, Math.min(20, Number(order.quantity) || 1));
  const unit = round(Number(order.unitPrice));
  const guaranteed = p.prc / 100;
  if (!(unit > 0)) return { error: "unitPrice inválido." };
  if (unit > guaranteed + 0.001) {
    audit.log("sistema", "preco_divergente", { sellerId: seller.id, orderId, garantido: guaranteed, cobrado: unit });
    deps.aml.raiseSeller(seller.id, `Pedido ${orderId} cobrado a R$ ${unit.toFixed(2)}; preço garantido R$ ${guaranteed.toFixed(2)}.`, `preco:${seller.id}:${orderId}`);
    return { error: "Valor cobrado acima do preço garantido.", code: 409 };
  }

  if (store.backendKind() === "postgres") {
    return confirmPaidOrderPostgres(seller, order, deps, { orderId, orderedAt, resolved: r, qty, unit });
  }

  const sale = deps.money.registerSale({
    clickId: p.cid, value: round(unit * qty), storeId: seller.id, at: orderedAt,
    official: { sellerId: seller.id, commission: p.com, offerId: p.oid, partnerId: p.par, orderId, trackId: p.tid },
  });
  if (r.coupon) Object.assign(r.coupon, { status: "usado", orderId });
  const via = order.offer ? "codigo" : order.coupon ? "cupom" : "referencia";
  S().orders.push({ sellerId: seller.id, orderId, offerId: p.oid, saleId: sale.id, amount: round(unit * qty), status: "pago", via, at: store.now(), orderedAt });
  audit.log(seller.id, "pedido_confirmado", { orderId, offerId: p.oid, via, valor: round(unit * qty), comissao: p.com });
  store.save();
  return { ok: true, saleId: sale.id, commission: sale.financials.commission, attributedTo: sale.authorId };
}

function authSeller(sellerId, headers, rawBody) {
  const seller = S().sellers[sellerId];
  if (!seller) return { error: "Loja desconhecida.", code: 404 };
  if (!checkSellerSignature(seller, { ts: headers["x-sceneshop-timestamp"], sig: headers["x-sceneshop-signature"], rawBody })) {
    audit.log("sistema", "aviso_pedido_recusado", { sellerId, motivo: "assinatura da loja" });
    return { error: "Assinatura da loja inválida.", code: 401 };
  }
  return { seller };
}

/** Aviso de um pedido (na hora do pagamento ou da devolução). */
function receiveOrder(sellerId, body, headers, rawBody, deps) {
  const a = authSeller(sellerId, headers, rawBody);
  return a.error ? a : processOrder(a.seller, body || {}, deps);
}

function reportResult(sellerId, results) {
  const summary = {
    recebidos: results.length,
    registrados: results.filter((r) => r.ok && !r.duplicate && r.saleId).length,
    devolvidos: results.filter((r) => r.status === "estornado" && !r.duplicate).length,
    repetidos: results.filter((r) => r.duplicate).length,
    recusados: results.filter((r) => r.error).length,
  };
  audit.log(sellerId, "relatorio_conciliado", summary);
  return { ok: true, summary, results: results.map(({ code, ...r }) => r) };
}

async function receiveReportPostgres(sellerId, seller, orders, deps) {
  const results = [];
  // Sequencial por desenho: preserva idempotência/cupom e a ordem da trilha de auditoria.
  for (const o of orders) {
    const r = await Promise.resolve(processOrder(seller, o, deps));
    results.push({ orderId: o.orderId, ...r });
  }
  return reportResult(sellerId, results);
}

/** Relatório com vários pedidos (ex.: relatório diário de um grande varejista). */
function receiveReport(sellerId, body, headers, rawBody, deps) {
  const a = authSeller(sellerId, headers, rawBody);
  if (a.error) return a;
  const orders = Array.isArray((body || {}).orders) ? body.orders.slice(0, 5000) : null;
  if (!orders) return { error: "Envie { orders: [...] }." };
  if (store.backendKind() === "postgres") return receiveReportPostgres(sellerId, a.seller, orders, deps);
  const results = orders.map((o) => ({ orderId: o.orderId, ...processOrder(a.seller, o, deps) }));
  return reportResult(sellerId, results);
}

function sellersView(forProducer) {
  return Object.values(S().sellers).map((s) => ({
    id: s.id, name: s.name, kind: s.kind, cnpj: s.cnpj, verified: s.verified, color: s.color,
    integration: s.integration, integrationLabel: INTEGRATIONS[s.integration],
    agreement: s.agreement ? { since: s.agreement.since, until: s.agreement.until, notes: s.agreement.notes, valid: agreementValid(s) } : null,
    campaigns: forProducer ? s.campaigns || null : undefined,
    pool: forProducer && s.integration === "codigos_unicos" ? poolStatus(s.id) : undefined,
    orders: forProducer ? S().orders.filter((o) => o.sellerId === s.id && o.status === "pago").length : undefined,
  }));
}

function setCampaign(sellerId, productId, campaignId, actor) {
  const s = S().sellers[sellerId];
  if (!s || s.integration !== "link_campanha") return { error: "Essa loja não trabalha com link de campanha." };
  if (!/^[A-Za-z0-9_-]{3,40}$/.test(String(campaignId || ""))) return { error: "ID de campanha inválido." };
  (s.campaigns = s.campaigns || {})[productId] = campaignId;
  audit.log(actor, "campanha_registrada", { sellerId, productId, campaignId });
  store.save();
  return { ok: true };
}

module.exports = {
  INTEGRATIONS, offerFor, asListedOffer, setOffer, issueToken, verifyToken, sign, buildRedirect,
  addCodes, assignCode, poolStatus, receiveOrder, receiveReport, processOrder, sellerSignature, sellersView, setCampaign,
};
