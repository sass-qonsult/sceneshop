/**
 * MARKETPLACE PILOTO (simulação realista do lado da loja)
 *
 * Um marketplace de verdade em miniatura: vitrine, página de produto com galeria,
 * carrinho, checkout com Pix simulado e página do pedido. Ele se comporta como
 * uma loja integrada ao SceneShop:
 *
 *   1. recebe o espectador com ?ss_offer=<código assinado> e confere a assinatura
 *      com a CHAVE PÚBLICA do SceneShop (como faria o plugin de uma loja real);
 *   2. aplica o preço garantido pela produção aos itens que vieram com código válido;
 *   3. quando o Pix é "pago", avisa o SceneShop de cada item, assinando o aviso com o
 *      segredo da loja; cancelamento avisa a devolução.
 *
 * Nenhum pagamento real acontece.
 */
const path = require("path");
const crypto = require("crypto");
const express = require("express");
const wallets = require("./wallets");
const QRCode = require("qrcode");
const store = require("./store");
const catalog = require("./catalog");
const official = require("./official");

const SELLER = "loja-piloto";
const round = (v) => Math.round(v * 100) / 100;

module.exports = function marketplace({ port }) {
  const r = express.Router();
  const S = () => store.state;
  const base = () => `http://127.0.0.1:${port()}`;
  const page = (req, res) => res.sendFile(path.join(__dirname, "..", "public", "marketplace.html"));

  r.get(["/marketplace", "/marketplace/*"], page);

  // a loja busca a chave pública do SceneShop (como uma integração real faria)
  async function publicKey() {
    return (await fetch(`${base()}/api/offers/public-key`)).text();
  }

  const listed = () => Object.entries(S().officialOffers)
    .filter(([, o]) => o.sellerId === SELLER && o.validUntil > store.now())
    .map(([pid]) => catalog.getProduct(pid)).filter(Boolean);

  const view = (p) => ({
    id: p.id, name: p.name, brand: p.brand, category: p.category, description: p.description || "",
    sku: p.sku || "", images: (p.images && p.images.length ? p.images : [p.image]), listPrice: p.referencePrice,
  });

  async function checkOffer(token, productId) {
    if (!token) return null;
    const v = official.verifyToken(token, { publicKeyPem: await publicKey() });
    if (!v.valid) return { valid: false, reason: v.reason === "expirado" ? "oferta expirada" : "código inválido" };
    if (v.payload.sid !== SELLER || v.payload.pid !== productId) return { valid: false, reason: "código de outro produto" };
    return {
      valid: true, price: v.payload.prc / 100, expiresAt: v.payload.exp, workId: v.payload.wid,
      work: v.payload.wid ? (catalog.getWork(v.payload.wid) || {}).title : null, payload: v.payload,
    };
  }

  r.get("/mkt/api/catalog", (req, res) => {
    const q = String(req.query.q || "").toLowerCase();
    res.json(listed().map(view).filter((p) => !q || `${p.name} ${p.brand} ${p.category}`.toLowerCase().includes(q)));
  });

  r.get("/mkt/api/product/:id", async (req, res) => {
    const p = catalog.getProduct(req.params.id);
    if (!p) return res.status(404).json({ error: "Produto não encontrado." });
    const offer = await checkOffer(req.query.ss_offer, p.id);
    if (offer) delete offer.payload;
    const related = listed().filter((x) => x.id !== p.id && x.category === p.category).slice(0, 4).map(view);
    res.json({ product: view(p), offer, related, seller: { name: S().sellers[SELLER].name } });
  });

  // cria o pedido com Pix pendente
  r.post("/mkt/api/checkout", async (req, res) => {
    const b = req.body || {};
    const buyer = b.buyer || {};
    const errors = [];
    if (!buyer.name || String(buyer.name).trim().split(/\s+/).length < 2) errors.push("Informe o nome completo.");
    if (!/^\S+@\S+\.\S+$/.test(String(buyer.email || ""))) errors.push("Informe um e-mail válido.");
    if (!/^\d{5}-?\d{3}$/.test(String(buyer.cep || ""))) errors.push("Informe um CEP válido.");
    if (!buyer.address || String(buyer.address).trim().length < 5) errors.push("Informe o endereço.");
    const items = [];
    for (const it of (Array.isArray(b.items) ? b.items : []).slice(0, 20)) {
      const p = catalog.getProduct(it.produto);
      if (!p) continue;
      const qty = Math.max(1, Math.min(5, Number(it.qty) || 1));
      const offer = await checkOffer(it.ss_offer, p.id);
      const guaranteed = offer && offer.valid;
      items.push({
        productId: p.id, name: p.name, image: (p.images && p.images[0]) || p.image, qty,
        unitPrice: guaranteed ? offer.price : p.referencePrice, listPrice: p.referencePrice,
        guaranteed: !!guaranteed, ss_offer: guaranteed ? it.ss_offer : null, workId: guaranteed ? offer.workId : null,
      });
    }
    if (!items.length) errors.push("O carrinho está vazio.");
    if (errors.length) return res.status(400).json({ errors });
    const total = round(items.reduce((n, i) => n + i.unitPrice * i.qty, 0));
    const number = "MP" + (100000 + S().mktOrders.length * 7 + crypto.randomInt(0, 7)).toString();
    const order = {
      id: crypto.randomBytes(8).toString("hex"), number, status: "aguardando_pagamento", items, total,
      savings: round(items.reduce((n, i) => n + (i.listPrice - i.unitPrice) * i.qty, 0)),
      buyer: { name: String(buyer.name).trim().slice(0, 60), city: String(buyer.city || "").slice(0, 40), email: String(buyer.email).replace(/^(.).*(@.*)$/, "$1***$2") },
      pix: "00020126SIMULADO" + crypto.randomBytes(10).toString("hex").toUpperCase() + "5204000053039865802BR",
      at: store.now(),
    };
    order.pixQr = await QRCode.toDataURL(order.pix, { margin: 1, width: 280 });
    S().mktOrders.push(order);
    store.save();
    res.status(201).json(publicOrder(order));
  });

  function publicOrder(o) {
    const { pix, ...rest } = o;
    return { ...rest, items: o.items.map(({ ss_offer, ...i }) => i), pixCode: pix, payment: o.payment ? { method: o.payment.method, simulated: !!o.payment.simulated, card: o.payment.card || null } : null };
  }

  async function notify(body) {
    const seller = S().sellers[SELLER];
    const raw = JSON.stringify(body);
    const ts = String(Date.now());
    const resp = await fetch(`${base()}/api/sellers/${SELLER}/orders`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-SceneShop-Timestamp": ts, "X-SceneShop-Signature": official.sellerSignature(seller.secret, ts, raw) },
      body: raw,
    });
    return { status: resp.status, ...(await resp.json().catch(() => ({}))) };
  }

  // "pagamento" do Pix: confirma o pedido e avisa o SceneShop de cada item com preço garantido
  r.post("/mkt/api/order/:id/pay", async (req, res) => {
    const o = S().mktOrders.find((x) => x.id === req.params.id);
    if (!o) return res.status(404).json({ error: "Pedido não encontrado." });
    if (o.status !== "aguardando_pagamento") return res.json(publicOrder(o));
    await markPaid(o, { method: "PIX", simulated: true });
    res.json(publicOrder(o));
  });

  // rcprep.16: pagamento com carteira (Google Pay / Apple Pay / Samsung Pay). O token vai direto ao gateway;
  // o SceneShop não vê nem guarda o cartão — só a bandeira e o final, se o gateway informar.
  r.post("/mkt/api/order/:id/pay-wallet", async (req, res) => {
    const o = S().mktOrders.find((x) => x.id === req.params.id);
    if (!o) return res.status(404).json({ error: "Pedido não encontrado." });
    if (o.status !== "aguardando_pagamento") return res.json(publicOrder(o));
    const b = req.body || {};
    const out = await wallets.charge({ orderId: o.number, amount: o.total, method: String(b.method || "").toUpperCase(), token: b.token, cardHint: b.card || {} });
    if (out.error) return res.status(out.code || 400).json({ error: out.error });
    if (!out.ok) return res.status(402).json({ error: "Pagamento recusado pela carteira/banco. Tente outro cartão." });
    await markPaid(o, { method: String(b.method).toUpperCase(), simulated: out.simulated, card: out.card, pspReference: out.pspReference });
    res.json(publicOrder(o));
  });

  async function markPaid(o, payment) {
    o.status = "pago";
    o.paidAt = store.now();
    o.payment = payment;
    for (let i = 0; i < o.items.length; i++) {
      const it = o.items[i];
      if (!it.guaranteed) continue;
      it.sceneshop = await notify({ offer: it.ss_offer, orderId: `${o.number}-${i + 1}`, quantity: it.qty, unitPrice: it.unitPrice, status: "pago" });
    }
    store.save();
  }

  r.post("/mkt/api/order/:id/cancel", async (req, res) => {
    const o = S().mktOrders.find((x) => x.id === req.params.id);
    if (!o) return res.status(404).json({ error: "Pedido não encontrado." });
    if (o.status === "pago") {
      for (let i = 0; i < o.items.length; i++) {
        if (o.items[i].guaranteed) o.items[i].refund = await notify({ orderId: `${o.number}-${i + 1}`, status: "devolvido" });
      }
    }
    o.status = "cancelado";
    store.save();
    res.json(publicOrder(o));
  });

  r.get("/mkt/api/order/:id", (req, res) => {
    const o = S().mktOrders.find((x) => x.id === req.params.id);
    o ? res.json(publicOrder(o)) : res.status(404).json({ error: "Pedido não encontrado." });
  });

  return r;
};
