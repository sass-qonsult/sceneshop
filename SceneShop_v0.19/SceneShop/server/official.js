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
const connectors = require("./store-connectors");

const S = () => store.state;
const b64 = (x) => Buffer.from(x).toString("base64url");
const round = (v) => Math.round(v * 100) / 100;
const INTEGRATIONS = {
  link_produto: "Link do produto na loja (venda confirmada por relatório)",
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
    url: o.url || o.seller.storeUrl,
  };
}

function setOffer(productId, { sellerId, price, commission, validDays, url }, actor, { product, organizationId } = {}) {
  const p = product || catalog.getProduct(productId);
  if (!p) return { error: "Produto não encontrado." };
  if (!sellerId) {
    delete S().officialOffers[productId];
    audit.log(actor, "oferta_oficial_removida", { productId });
    store.save();
    return { ok: true };
  }
  const seller = S().sellers[sellerId];
  const pr = require("./price").parsePrice(price), cm = Number(commission);
  const errors = [];
  if (!seller || !seller.verified) errors.push("Loja não verificada.");
  else if (organizationId && seller.organizationId && seller.organizationId !== organizationId) errors.push("Essa loja pertence a outra organização.");
  else if (seller.active === false) errors.push("Essa loja está desativada.");
  const link = String(url || "").trim();
  if (link && !validStoreUrl(link)) errors.push("Link do produto inválido: use o endereço completo, começando com https://");
  if (seller && seller.integration === "link_produto" && !link && !seller.storeUrl) errors.push("Informe o link do produto na loja.");
  else if (!agreementValid(seller)) errors.push("O acordo com essa loja está vencido.");
  if (!require("./price").validPrice(pr)) errors.push("Preço garantido inválido.");
  if (!(cm >= 0 && cm <= 1)) errors.push("Comissão deve ficar entre 0% e 100%.");
  if (seller && seller.integration === "link_campanha" && !(seller.campaigns || {})[productId]) {
    errors.push("Essa loja ainda não criou a campanha deste produto. Informe o ID da campanha em Acordos.");
  }
  if (errors.length) return { errors };
  S().officialOffers[productId] = {
    sellerId, price: round(pr), commission: cm, setBy: actor, url: link || null,
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
  } else if (seller.integration === "link_produto") {
    // loja sem integração: a referência viaja no link (e nas UTMs) para a loja informar no relatório de vendas
    q.delete("produto");
    q.set("ss_ref", issued.payload.oid);
    q.set("utm_source", "sceneshop"); q.set("utm_medium", "scene"); q.set("utm_campaign", workId || "sceneshop"); q.set("utm_content", issued.payload.oid);
  }
  if (seller.integration !== "link_produto") q.set("ss_offer", issued.token);
  const base = o.url || seller.storeUrl;
  const sep = base.includes("?") ? "&" : "?";
  return { url: `${base}${sep}${q}`, guaranteed, offerId: issued.payload.oid };
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
      const via = order.via || (order.offer ? "codigo" : order.coupon ? "cupom" : "referencia");
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
  const via = order.via || (order.offer ? "codigo" : order.coupon ? "cupom" : "referencia");
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

function sellersView(forProducer, organizationId) {
  const { DEMO } = require("./config");
  return Object.values(S().sellers)
    .filter((s) => organizationId === undefined || s.organizationId === organizationId || (!s.organizationId && DEMO))
    .map((s) => ({
    storeUrl: forProducer ? s.storeUrl || null : undefined, active: s.active !== false, organizationId: s.organizationId || null,
    connection: forProducer && s.connection ? { platform: s.connection.platform, platformLabel: connectors.PLATFORMS[s.connection.platform], account: s.connection.account, advertiserId: s.connection.advertiserId || null, couponDiscountPct: s.connection.couponDiscountPct || 0,
      credentials: connectors.credentialStatus(s), lastSync: s.connection.lastSync || null, lastResult: s.connection.lastResult || null, lastError: s.connection.lastError || null } : forProducer ? null : undefined,
    webhook: forProducer ? { orders: `/api/sellers/${s.id}/orders`, report: `/api/sellers/${s.id}/report` } : undefined,
    id: s.id, name: s.name, kind: s.kind, cnpj: s.cnpj, verified: s.verified, color: s.color,
    integration: s.integration,
    integrationLabel: s.connection && s.connection.platform === "afiliado" ? "Programa de afiliados (relatório importado)"
      : s.connection && s.connection.platform === "awin" ? "Awin: clickref por clique + leitura das transações"
      : s.connection && ["vtex", "shopify", "nuvemshop"].includes(s.connection.platform) ? "Cupom SceneShop por clique + leitura dos pedidos na loja" : INTEGRATIONS[s.integration],
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

// ---------------------------------------------------------------- lojas cadastradas pela produtora
function validStoreUrl(u) {
  try { const x = new URL(u); return x.protocol === "https:" || (x.protocol === "http:" && /^(localhost|127\.0\.0\.1)$/.test(x.hostname)); } catch (e) { return false; }
}
const SELLER_KINDS = { marca: "Loja da marca", varejista: "Grande varejista", marketplace: "Marketplace" };
const onlyDigits = (v) => String(v || "").replace(/\D/g, "");
function fmtCnpj(v) { const d = onlyDigits(v); return d.length === 14 ? d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5") : ""; }
function untilFrom(v, fallbackDays = 365) {
  if (v) { const t = Date.parse(String(v).length === 10 ? `${v}T23:59:59` : v); if (!isNaN(t)) return t; }
  return store.now() + fallbackDays * store.DAY;
}

function sellerFields(body, current = {}) {
  const errors = [];
  const name = String(body.name ?? current.name ?? "").trim().slice(0, 80);
  if (name.length < 2) errors.push("Informe o nome da loja.");
  const kind = String(body.kind ?? current.kind ?? "marca");
  if (!SELLER_KINDS[kind]) errors.push("Tipo de loja inválido.");
  const integration = String(body.integration ?? current.integration ?? "link_produto");
  if (!INTEGRATIONS[integration]) errors.push("Forma de integração inválida.");
  const storeUrl = String(body.storeUrl ?? current.storeUrl ?? "").trim();
  if (!validStoreUrl(storeUrl)) errors.push("Endereço da loja inválido: use o endereço completo, começando com https://");
  const cnpjRaw = body.cnpj ?? current.cnpj ?? "";
  const cnpj = cnpjRaw ? fmtCnpj(cnpjRaw) : "";
  if (cnpjRaw && !cnpj) errors.push("CNPJ deve ter 14 dígitos.");
  const until = body.until !== undefined ? untilFrom(body.until) : (current.agreement && current.agreement.until) || untilFrom(null);
  const notes = String(body.notes ?? (current.agreement && current.agreement.notes) ?? "").trim().slice(0, 300);
  // conexão direta com a loja: plataforma + conta (as chaves ficam só no ambiente do servidor)
  const cur = current.connection || {};
  const platform = String(body.platform ?? cur.platform ?? "").trim();
  if (platform && !connectors.PLATFORMS[platform]) errors.push("Plataforma da loja inválida.");
  const account = String(body.account ?? cur.account ?? "").trim().slice(0, 120);
  if (["vtex", "shopify", "nuvemshop", "awin"].includes(platform) && !account) errors.push(platform === "vtex" ? "Informe o nome da conta VTEX (ex.: jbl)." : platform === "shopify" ? "Informe o domínio da loja Shopify (ex.: marca.myshopify.com)." : platform === "awin" ? "Informe o ID do publisher SceneShop na Awin." : "Informe o número da loja na Nuvemshop.");
  const advertiserId = String(body.advertiserId ?? cur.advertiserId ?? "").trim().replace(/\D/g, "").slice(0, 12);
  if (platform === "awin" && !advertiserId) errors.push("Informe o ID do anunciante na Awin (awinmid).");
  const pct = body.couponDiscountPct !== undefined ? Number(String(body.couponDiscountPct).replace(",", ".")) : Number(cur.couponDiscountPct || 0);
  if (!(pct >= 0 && pct <= 90)) errors.push("Desconto do cupom deve ficar entre 0% e 90%.");
  const connection = platform ? { ...cur, platform, account, advertiserId: advertiserId || undefined, couponDiscountPct: Math.round(pct * 100) / 100 } : null;
  if (connection && cur.platform && (cur.platform !== platform || cur.account !== account)) delete connection.priceRuleId;
  return { errors, fields: { name, kind, integration, storeUrl, cnpj, until, notes, connection } };
}

function createSeller(organizationId, body, actor) {
  if (!organizationId) return { error: "Selecione uma organização." };
  const { errors, fields } = sellerFields(body || {});
  if (errors.length) return { errors };
  const base = fields.name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 32) || "loja";
  let id = base; while (S().sellers[id]) id = `${base}-${crypto.randomBytes(2).toString("hex")}`;
  const secret = crypto.randomBytes(24).toString("hex");
  S().sellers[id] = {
    id, name: fields.name, cnpj: fields.cnpj, kind: fields.kind, integration: fields.integration, storeUrl: fields.storeUrl,
    color: "#1E4D8F", verified: true, active: true, secret, organizationId, campaigns: {}, connection: fields.connection,
    agreement: { since: store.now(), until: fields.until, notes: fields.notes },
    createdBy: actor, createdAt: store.now(),
  };
  audit.log(actor, "loja_cadastrada", { sellerId: id, organizationId, integration: fields.integration });
  store.save();
  return { seller: sellersView(true, organizationId).find((x) => x.id === id), secret };
}

function ownSeller(organizationId, sellerId) {
  const s = S().sellers[sellerId];
  return s && s.organizationId && s.organizationId === organizationId ? s : null;
}

function updateSeller(organizationId, sellerId, body, actor) {
  const s = ownSeller(organizationId, sellerId);
  if (!s) return { error: "Loja não encontrada nesta organização.", code: 404 };
  const { errors, fields } = sellerFields(body || {}, s);
  if (errors.length) return { errors };
  Object.assign(s, { name: fields.name, kind: fields.kind, integration: fields.integration, storeUrl: fields.storeUrl, cnpj: fields.cnpj, connection: fields.connection });
  s.agreement = { ...(s.agreement || {}), until: fields.until, notes: fields.notes };
  if (body.active != null) s.active = !!body.active;
  audit.log(actor, "loja_atualizada", { sellerId, active: s.active !== false });
  store.save();
  return { seller: sellersView(true, organizationId).find((x) => x.id === sellerId) };
}

function rotateSellerSecret(organizationId, sellerId, actor) {
  const s = ownSeller(organizationId, sellerId);
  if (!s) return { error: "Loja não encontrada nesta organização.", code: 404 };
  s.secret = crypto.randomBytes(24).toString("hex");
  audit.log(actor, "loja_chave_trocada", { sellerId });
  store.save();
  return { secret: s.secret };
}

/** Cliques enviados à loja (ofertas emitidas) e se já viraram pedido. */
function referrals(organizationId, sellerId, { limit = 200 } = {}) {
  const s = ownSeller(organizationId, sellerId);
  if (!s) return { error: "Loja não encontrada nesta organização.", code: 404 };
  const orders = new Map(S().orders.filter((o) => o.sellerId === sellerId).map((o) => [o.offerId, o]));
  const coupons = new Map(pool(sellerId).filter((c) => c.offerId).map((c) => [c.offerId, c.code]));
  const rows = Object.values(S().issuedOffers).filter((p) => p.sid === sellerId).sort((a, b) => b.iat - a.iat).slice(0, limit).map((p) => {
    const o = orders.get(p.oid);
    const prod = catalog.getProduct(p.pid);
    return {
      ref: p.oid, productId: p.pid, product: prod ? prod.name : p.pid, price: p.prc / 100, commission: p.com,
      workId: p.wid, at: p.iat, expiresAt: p.exp, coupon: p.cpn || coupons.get(p.oid) || null,
      order: o ? { orderId: o.orderId, amount: o.amount, status: o.status, via: o.via || null, at: o.orderedAt || o.at } : null,
    };
  });
  return { referrals: rows };
}

/** A produtora registra uma venda informada pela loja (relatório, e-mail, painel da loja). */
function registerManualOrder(organizationId, sellerId, body, actor, deps) {
  const s = ownSeller(organizationId, sellerId);
  if (!s) return { error: "Loja não encontrada nesta organização.", code: 404 };
  const b = body || {};
  const order = {
    orderId: String(b.orderId || "").trim(), ref: b.ref ? String(b.ref).trim() : undefined, coupon: b.coupon ? String(b.coupon).trim() : undefined,
    unitPrice: require("./price").parsePrice(b.unitPrice), quantity: Number(b.quantity) || 1, orderedAt: b.orderedAt || undefined,
    status: b.status === "devolvido" ? "devolvido" : undefined, via: "manual",
  };
  if (!order.orderId) return { error: "Informe o número do pedido na loja." };
  if (!order.status && !order.ref && !order.coupon) return { error: "Informe a referência SceneShop (ss_ref) ou o cupom usado no pedido." };
  const finish = (r) => { if (r && r.ok && !r.duplicate) audit.log(actor, "venda_registrada_manual", { sellerId, orderId: order.orderId, ref: order.ref || null, coupon: order.coupon || null }); return r; };
  const r = processOrder(s, order, deps);
  return r && typeof r.then === "function" ? r.then(finish) : finish(r);
}

// ---------------------------------------------------------------- cupom SceneShop por clique (loja conectada)
const COUPON_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"; // sem 0/O/1/I: fácil de ler e digitar
function newCouponCode() {
  for (;;) {
    const b = crypto.randomBytes(6);
    const code = "SS-" + Array.from(b, (x) => COUPON_ALPHABET[x % 32]).join("");
    if (!S().issuedCoupons || !S().issuedCoupons[code]) return code;
  }
}

/**
 * Link de compra com cupom único criado na própria loja. Sem conexão (ou se a loja não responder),
 * cai no link com referência (buildRedirect). O comprador passa pela página /cupom/<oferta>,
 * que mostra o código e segue para a loja.
 */
async function buildRedirectAsync(args) {
  const o = offerFor(args.productId);
  if (!o) return null;
  const seller = o.seller;
  const status = connectors.credentialStatus(seller);
  if (!status.ready) return buildRedirect(args);
  const conn = connectors.connectorFor(seller, { save: () => store.save() });
  const issued = issueToken(args);
  const p = issued.payload;
  const ref = p.oid;
  const productUrl = o.url || seller.storeUrl;
  let code = null, applyUrl = null, error = null;
  try {
    const candidate = newCouponCode();
    const r = await conn.createCoupon({ code: candidate, discountPct: seller.connection.couponDiscountPct || 0, expiresAt: p.exp });
    if (r && r.ok) { code = candidate; applyUrl = r.applyUrl ? r.applyUrl(productUrl) : null; }
  } catch (e) {
    error = e.message;
    audit.log("sistema", "cupom_loja_falhou", { sellerId: seller.id, erro: String(e.message).slice(0, 120) });
  }
  if (conn.buildLink) {
    const link = conn.buildLink(productUrl, ref);
    Object.assign(S().issuedOffers[ref], { to: link, cpn: null, discountPct: 0 });
    store.save();
    return { url: link, guaranteed: true, offerId: ref, coupon: null, interstitial: false };
  }
  const params = conn.linkParams(ref);
  const base = applyUrl || productUrl;
  const url = new URL(base);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  if (applyUrl) {
    // Shopify: /discount/<código>?redirect=<produto>: as UTMs vão para dentro do redirect
    const red = new URL(url.searchParams.get("redirect") || "/", new URL(productUrl).origin);
    for (const [k, v] of Object.entries(params)) red.searchParams.set(k, v);
    url.search = ""; url.searchParams.set("redirect", red.pathname + red.search);
  }
  const rec = S().issuedOffers[ref];
  rec.cpn = code; rec.to = url.toString(); rec.discountPct = code ? seller.connection.couponDiscountPct || 0 : 0;
  if (code) (S().issuedCoupons = S().issuedCoupons || {})[code] = ref;
  store.save();
  return { url: url.toString(), guaranteed: true, offerId: ref, coupon: code, couponError: error, interstitial: !!code };
}

/** Dados da página /cupom/<oferta> (sem credenciais nem token). */
function landing(offerId) {
  const p = S().issuedOffers[offerId];
  if (!p || !p.to) return null;
  const seller = S().sellers[p.sid] || {};
  const prod = catalog.getProduct(p.pid) || {};
  return { coupon: p.cpn || null, url: p.to, store: seller.name || p.sid, product: prod.name || p.pid, price: p.prc / 100, discountPct: p.discountPct || 0, expiresAt: p.exp };
}

module.exports = {
  INTEGRATIONS, offerFor, asListedOffer, setOffer, issueToken, verifyToken, sign, buildRedirect,
  addCodes, assignCode, poolStatus, receiveOrder, receiveReport, processOrder, sellerSignature, sellersView, setCampaign,
  createSeller, updateSeller, rotateSellerSecret, referrals, registerManualOrder, validStoreUrl, SELLER_KINDS,
  buildRedirectAsync, landing, newCouponCode, ownSeller,
};
