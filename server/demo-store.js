/**
 * LOJAS DE DEMONSTRAÇÃO (lado do vendedor)
 *
 * Simula as três formas de uma loja com acordo honrar o preço garantido:
 *
 *   assinatura      loja da marca: confere o código ss_offer com a chave pública do SceneShop
 *                   e avisa cada pedido na hora (POST /api/sellers/:id/orders).
 *   codigos_unicos  grande varejista: aplica o cupom de uso único (do lote que ele mesmo gerou)
 *                   e manda o RELATÓRIO de vendas depois (POST /api/sellers/:id/report).
 *   link_campanha   grande varejista: a campanha já tem o preço negociado; avisa o pedido
 *                   com a referência ss_ref.
 *
 * Tudo passa por HTTP de verdade, assinado com o segredo de cada loja.
 */
const path = require("path");
const crypto = require("crypto");
const express = require("express");
const store = require("./store");
const catalog = require("./catalog");
const official = require("./official");

module.exports = function demoStore({ port }) {
  const r = express.Router();
  const base = () => `http://127.0.0.1:${port()}`;
  const S = () => store.state;
  const round = (v) => Math.round(v * 100) / 100;
  // pedidos que o varejista ainda vai mandar no relatório do dia
  const pendingReport = {};

  async function publicKey() {
    return (await fetch(`${base()}/api/offers/public-key`)).text();
  }

  async function signedPost(seller, pathName, body) {
    const raw = JSON.stringify(body);
    const ts = String(Date.now());
    const resp = await fetch(`${base()}${pathName}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-SceneShop-Timestamp": ts, "X-SceneShop-Signature": official.sellerSignature(seller.secret, ts, raw) },
      body: raw,
    });
    return { status: resp.status, data: await resp.json().catch(() => ({})) };
  }

  /**
   * O que a loja entende do link, do jeito dela:
   *  - marca: confere a assinatura do código;
   *  - varejista com cupom: procura o cupom no próprio lote (o preço negociado está no cupom);
   *  - varejista com campanha: confere se a campanha existe para o produto.
   */
  async function understand(seller, product, q) {
    const normalPrice = round(product.referencePrice * seller.normalMarkup);
    if (seller.integration === "assinatura") {
      if (!q.ss_offer) return { normalPrice };
      const v = official.verifyToken(q.ss_offer, { publicKeyPem: await publicKey() });
      const ok = v.valid && v.payload.sid === seller.id && v.payload.pid === product.id;
      return { normalPrice, offer: ok ? { valid: true, mode: "assinatura", price: v.payload.prc / 100, expiresAt: v.payload.exp, work: v.payload.wid }
        : { valid: false, reason: !v.valid ? v.reason : "código de outro produto/loja" } };
    }
    // Para os varejistas, o preço negociado vem do acordo (aqui, da oferta emitida que o SceneShop referenciou)
    const issued = q.ss_ref && S().issuedOffers[q.ss_ref];
    if (seller.integration === "codigos_unicos") {
      if (!q.cupom) return { normalPrice, offer: q.ss_ref ? { valid: false, reason: "sem cupom disponível" } : undefined };
      const c = (S().codePools[seller.id] || []).find((x) => x.code === q.cupom);
      const ok = c && c.status === "reservado" && issued && c.offerId === issued.oid && issued.pid === product.id && issued.exp > store.now();
      return { normalPrice, offer: ok ? { valid: true, mode: "cupom", code: c.code, price: issued.prc / 100, expiresAt: issued.exp, work: issued.wid }
        : { valid: false, reason: c && c.status === "usado" ? "cupom já utilizado" : "cupom inválido" } };
    }
    if (seller.integration === "link_campanha") {
      const ok = q.campanha && (seller.campaigns || {})[product.id] === q.campanha && issued && issued.pid === product.id && issued.exp > store.now();
      return { normalPrice, offer: ok ? { valid: true, mode: "campanha", campaign: q.campanha, price: issued.prc / 100, expiresAt: issued.exp, work: issued.wid }
        : { valid: false, reason: "campanha inválida ou encerrada" } };
    }
    return { normalPrice };
  }

  r.get("/loja/:seller", (req, res) => res.sendFile(path.join(__dirname, "..", "public", "loja.html")));

  r.get("/loja-demo/:seller/oferta", async (req, res) => {
    const seller = S().sellers[req.params.seller];
    if (!seller) return res.status(404).json({ error: "Loja não encontrada" });
    const product = catalog.getProduct(req.query.produto);
    if (!product) return res.status(404).json({ error: "Produto não encontrado" });
    const u = await understand(seller, product, req.query);
    if (u.offer && u.offer.work) u.offer.work = (catalog.getWork(u.offer.work) || {}).title;
    res.json({
      seller: { id: seller.id, name: seller.name, color: seller.color, kind: seller.kind, integration: seller.integration },
      product: { id: product.id, name: product.name, brand: product.brand, image: product.image },
      ...u, pendingReport: (pendingReport[seller.id] || []).length,
    });
  });

  r.post("/loja-demo/:seller/checkout", async (req, res) => {
    const seller = S().sellers[req.params.seller];
    const b = req.body || {};
    const product = seller && catalog.getProduct(b.produto);
    if (!product) return res.status(404).json({ error: "Loja ou produto não encontrado" });
    const qty = Math.max(1, Math.min(5, Number(b.quantity) || 1));
    const u = await understand(seller, product, b);
    const orderId = (seller.kind === "varejista" ? "VJ-" : "PED-") + crypto.randomBytes(4).toString("hex").toUpperCase();
    if (!u.offer || !u.offer.valid) {
      return res.json({ orderId, unitPrice: u.normalPrice, total: round(u.normalPrice * qty), sceneshop: null, note: "Venda sem oferta garantida: preço normal, sem comissão ao SceneShop." });
    }
    // "cobrarAcima" simula uma loja descumprindo o acordo
    const unitPrice = b.cobrarAcima ? round(u.offer.price * 1.1) : u.offer.price;
    const order = { orderId, quantity: qty, unitPrice, status: "pago", orderedAt: store.now() };

    if (seller.integration === "codigos_unicos") {
      // o varejista NÃO avisa na hora: o pedido entra no relatório do dia
      (pendingReport[seller.id] = pendingReport[seller.id] || []).push({ ...order, coupon: u.offer.code });
      return res.json({ orderId, unitPrice, total: round(unitPrice * qty), queued: true, pendingReport: pendingReport[seller.id].length });
    }
    if (seller.integration === "link_campanha") order.ref = b.ss_ref;
    else order.offer = b.ss_offer;
    const n = await signedPost(seller, `/api/sellers/${seller.id}/orders`, order);
    res.status(n.status < 300 ? 200 : n.status).json({ orderId, unitPrice, total: round(unitPrice * qty), sceneshop: n.data });
  });

  // Varejista envia o relatório de vendas acumulado
  r.post("/loja-demo/:seller/relatorio", async (req, res) => {
    const seller = S().sellers[req.params.seller];
    if (!seller) return res.status(404).end();
    const orders = pendingReport[seller.id] || [];
    pendingReport[seller.id] = [];
    const n = await signedPost(seller, `/api/sellers/${seller.id}/report`, { date: new Date(store.now()).toISOString().slice(0, 10), orders });
    res.status(n.status).json(n.data);
  });

  r.post("/loja-demo/:seller/devolucao", async (req, res) => {
    const seller = S().sellers[req.params.seller];
    if (!seller) return res.status(404).end();
    const n = await signedPost(seller, `/api/sellers/${seller.id}/orders`, { orderId: (req.body || {}).orderId, status: "devolvido" });
    res.status(n.status).json(n.data);
  });

  return r;
};
