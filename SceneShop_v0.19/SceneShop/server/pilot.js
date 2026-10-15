/**
 * MODO PILOTO — rotas para rodar o SceneShop com material real da produtora:
 *
 *   obras      envio do vídeo, cadastro da obra, miniaturas das cenas
 *   produtos   cadastro com fotos profissionais (galeria), descrição, SKU e preço
 *   eventos    audiência: início de exibição, abertura do painel, QR code
 *   painel     funil do piloto por obra, cena e produto
 */
const express = require("express");
const store = require("./store");
const catalog = require("./catalog");
const tracks = require("./tracks");
const money = require("./money");
const audit = require("./audit");
const uploads = require("./uploads");
const antifraud = require("./antifraud");
const official = require("./official");
const offers = require("./offers");
const { content } = require("./repositories");
const orgAccess = require("./organizations");

const S = () => store.state;
const round = (v) => Math.round(v * 100) / 100;
// identificador legível: corta no limite de palavra (ex.: "kimono-4-jeitos-de-usar-casa")
const slugify = (s, max = 40) => {
  const full = String(s).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  if (full.length <= max) return full || "item";
  const cut = full.slice(0, max + 1);
  const at = cut.lastIndexOf("-");
  return (at > 8 ? cut.slice(0, at) : full.slice(0, max)).replace(/-$/, "") || "item";
};
const parsePrice = (v) => {
  const raw = String(v ?? "").trim();
  return Number(raw.includes(",") ? raw.replace(/\./g, "").replace(",", ".") : raw); // aceita 1.299,90 e 1299.90
};
const EVENT_TYPES = ["view_start", "panel_open", "qr_open", "phone_join"];

module.exports = function pilotRoutes({ requireRole, reply, actor }) {
  const r = express.Router();
  const safe = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

  // ------------------------------------------------------------------ envio de arquivos
  r.post("/api/uploads/:kind", requireRole(), async (req, res) => {
    const kind = req.params.kind;
    if (!["video", "image"].includes(kind)) return res.status(404).end();
    if (!req.organization || !req.orgMembership) return res.status(400).json({ error:"Selecione uma organização válida." });
    const permitted = kind === "video"
      ? orgAccess.hasCapability(req.orgMembership,"CONTENT_WRITE")
      : (orgAccess.hasCapability(req.orgMembership,"CONTENT_WRITE") || orgAccess.hasCapability(req.orgMembership,"COMMERCE_WRITE"));
    if (!permitted) return res.status(403).json({ error:"Sem permissão para enviar este arquivo." });
    if (orgAccess.organizationRequiresMfa(req.organization) && !(req.user._auth && req.user._auth.mfa)) return res.status(403).json({error:'MFA_REQUIRED',message:'Esta ação exige autenticação multifator.'});
    try {
      const out = await uploads.receive(req, kind, req.query.filename);
      audit.log(actor(req), "arquivo_enviado", { tipo: kind, url: out.url, bytes: out.bytes });
      res.status(201).json(out);
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  r.post("/api/uploads-thumb", requireRole(), orgAccess.requireAnyCapability("CONTENT_WRITE","COMMERCE_WRITE"), (req, res) => {
    try { res.status(201).json({ url: uploads.saveDataUrl((req.body || {}).dataUrl) }); }
    catch (e) { res.status(400).json({ error: e.message }); }
  });

  // ------------------------------------------------------------------ obras
  r.post("/api/works", requireRole(), orgAccess.requireCapability("CONTENT_WRITE"), safe(async (req, res) => {
    const { title, video, duration, poster } = req.body || {};
    const errors = [];
    if (!title || String(title).trim().length < 2) errors.push("Informe o título da obra.");
    if (!uploads.isUploadUrl(video) || !String(video).startsWith("/uploads/videos/")) errors.push("Envie o vídeo antes de cadastrar a obra.");
    const d = Number(duration);
    if (!(d > 1 && d < 6 * 3600)) errors.push("Duração do vídeo inválida.");
    if (errors.length) return res.status(400).json({ errors });
    let id = slugify(title, 30), n = 2;
    while (await Promise.resolve(content.getWorkAuthoritative(id))) id = `${slugify(title, 30)}-${n++}`;
    const author = S().authors[req.user.authorId] || {};
    const w = {
      id, title: String(title).trim().slice(0, 80), duration: Math.round(d * 10) / 10, video,
      poster: uploads.isUploadUrl(poster) ? poster : null, ownerId: req.user.authorId, organizationId: req.organization.id, pilot: true, createdAt: store.now(), scenes: [],
    };
    const created = await content.createWorkAuthoritative(w, author.partnerId ? [author.partnerId] : []);
    audit.log(actor(req), "obra_cadastrada", { workId: id, titulo: created.title, duracao: created.duration, syncId: created.syncId });
    require("./acr").autoRegister(created, actor(req));
    res.status(201).json(created);
  }));

  r.get("/api/me/works", requireRole(), orgAccess.requireCapability("CONTENT_READ"), safe(async (req, res) => {
    const works = await Promise.resolve(content.listWorksByOrganizationAuthoritative(req.organization.id));
    const enriched = [];
    for (const w of works) enriched.push({ ...w, tracks: (await tracks.rankedAuthoritative(w.id)).filter((t) => t.status !== "removida") });
    res.json(enriched.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)));
  }));

  // ------------------------------------------------------------------ produtos com galeria
  function productFields(body, current = {}) {
    const errors = [];
    const name = String(body.name ?? current.name ?? "").trim();
    const price = body.referencePrice != null ? parsePrice(body.referencePrice) : current.referencePrice;
    if (name.length < 2) errors.push("Informe o nome do produto.");
    if (!(price > 0 && price < 1e6)) errors.push("Informe um preço válido.");
    let images = Array.isArray(body.images) ? body.images.filter((u) => uploads.isUploadUrl(u) || String(u).startsWith("/media/")) : current.images || [];
    images = images.slice(0, 8);
    return {
      errors,
      fields: {
        name: name.slice(0, 80),
        brand: String(body.brand ?? current.brand ?? "Sem marca").trim().slice(0, 40) || "Sem marca",
        category: String(body.category ?? current.category ?? "Outros").trim().slice(0, 30) || "Outros",
        description: String(body.description ?? current.description ?? "").trim().slice(0, 1200),
        sku: String(body.sku ?? current.sku ?? "").trim().slice(0, 40),
        referencePrice: round(price),
        images,
        image: images[0] || current.image || "/media/products/placeholder.svg",
      },
    };
  }

  r.post("/api/products", requireRole(), orgAccess.requireAnyCapability("CONTENT_WRITE","COMMERCE_WRITE"), safe(async (req, res) => {
    const { errors, fields } = productFields(req.body || {});
    if (errors.length) return res.status(400).json({ errors });
    const base = slugify(fields.name);
    let id = base, n = 2;
    while (await Promise.resolve(content.getProductAuthoritative(id))) id = `${base}-${n++}`;
    const prod = { id, ...fields, box: null, storeIds: {}, createdBy: req.user.authorId, organizationId: req.organization.id, createdAt: store.now() };
    const created = await content.createProductAuthoritative(prod);
    await offers.invalidateProduct(created.id, { action: "create" });
    res.status(201).json(created);
  }));

  r.put("/api/products/:id", requireRole(), orgAccess.requireAnyCapability("CONTENT_WRITE","COMMERCE_WRITE"), safe(async (req, res) => {
    const cur = await Promise.resolve(content.getProductForOrganizationAuthoritative(req.params.id, req.organization.id, { allowGlobal:false }));
    if (!cur) return res.status(404).json({ errors: ["Produto não encontrado nesta organização."] });
    const { errors, fields } = productFields(req.body || {}, cur);
    if (errors.length) return res.status(400).json({ errors });
    Object.assign(cur, fields, { updatedAt: store.now() });
    const updated = await content.updateProductAuthoritative(cur);
    await offers.invalidateProduct(updated.id, { action: "update" });
    res.json(updated);
  }));

  r.get("/api/me/products", requireRole(), orgAccess.requireCapability("COMMERCE_READ"), safe(async (req, res) => {
    const products = await Promise.resolve(content.listProductsByOrganizationAuthoritative(req.organization.id));
    res.json(products.map((p) => ({ ...p, offer: S().officialOffers[p.id] || null }))
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)));
  }));

  // ------------------------------------------------------------------ eventos de audiência
  r.post("/api/events", antifraud.rateLimit("click"), (req, res) => {
    const b = req.body || {};
    if (!EVENT_TYPES.includes(b.type) || !catalog.getWork(b.workId)) return res.status(400).end();
    S().events.push({
      type: b.type, workId: b.workId, trackId: tracks.get(b.trackId) ? b.trackId : null,
      sceneId: String(b.sceneId || "").slice(0, 40) || null, deviceId: antifraud.validDevice(b.deviceId) ? b.deviceId : null,
      partnerId: S().partners[b.partnerId] ? b.partnerId : null, at: store.now(),
    });
    if (S().events.length > 100000) S().events.splice(0, 10000);
    store.save();
    res.status(204).end();
  });

  // ------------------------------------------------------------------ painel do piloto
  r.get("/api/me/pilot", requireRole(), orgAccess.requireCapability("ANALYTICS_READ"), safe(async (req, res) => {
    const work = await Promise.resolve(content.getWorkForOrganizationAuthoritative(req.query.work, req.organization.id));
    if (!work) return res.status(404).json({ error: "Obra não encontrada nesta organização." });
    res.json(pilotReport(work));
  }));

  return r;
};

function pilotReport(work) {
  const S2 = store.state;
  const trackIds = new Set(Object.values(S2.tracks).filter((t) => t.workId === work.id).map((t) => t.id));
  const ev = S2.events.filter((e) => e.workId === work.id);
  const uniq = (arr) => new Set(arr.map((e) => e.deviceId || e.at)).size;
  const clicks = S2.clicks.filter((c) => trackIds.has(c.trackId) && !c.anonymous);
  const sales = S2.sales.filter((s) => trackIds.has(s.trackId) && !s.reversed).map((s) => ({ s, e: money.entry(s) }));
  const revenue = round(sales.reduce((n, x) => n + x.s.value, 0));
  const commission = round(sales.reduce((n, x) => n + x.e.commission, 0));
  const viewers = uniq(ev.filter((e) => e.type === "view_start"));

  const funnel = [
    { step: "Espectadores", value: viewers },
    { step: "Abriram o painel", value: uniq(ev.filter((e) => e.type === "panel_open")) },
    { step: "Levaram ao celular", value: uniq(ev.filter((e) => e.type === "phone_join")) },
    { step: "Clicaram em comprar", value: new Set(clicks.map((c) => c.deviceId)).size },
    { step: "Compraram", value: sales.length },
  ];

  // por produto
  const byProduct = {};
  const P = (id) => (byProduct[id] = byProduct[id] || { productId: id, name: (catalog.getProduct(id) || {}).name || id, clicks: 0, orders: 0, revenue: 0, commission: 0 });
  clicks.forEach((c) => P(c.productId).clicks++);
  sales.forEach(({ s, e }) => { const p = P(s.productId); p.orders++; p.revenue = round(p.revenue + s.value); p.commission = round(p.commission + e.commission); });

  // por cena (da trilha oficial, se houver; senão a primeira)
  const main = Object.values(S2.tracks).filter((t) => trackIds.has(t.id) && t.status !== "removida").sort((a, b) => (b.type === "official") - (a.type === "official"))[0];
  const byScene = main ? main.scenes.map((sc) => {
    const ids = new Set(sc.products.map((x) => x.id));
    const scClicks = clicks.filter((c) => c.trackId === main.id && ids.has(c.productId)).length;
    return {
      sceneId: sc.id, title: sc.title, start: sc.start, end: sc.end, thumb: sc.thumb || null, products: sc.products.length,
      panelOpens: ev.filter((e) => e.type === "panel_open" && e.sceneId === sc.id).length, clicks: scClicks,
    };
  }) : [];

  const orders = S2.mktOrders.filter((o) => o.items.some((i) => i.workId === work.id)).slice(-20).reverse();
  return {
    work: { id: work.id, title: work.title, duration: work.duration, poster: work.poster },
    kpis: {
      viewers, revenue, commission, orders: sales.length,
      panelRate: viewers ? Math.round((funnel[1].value / viewers) * 1000) / 10 : 0,
      conversion: funnel[3].value ? Math.round((sales.length / funnel[3].value) * 1000) / 10 : 0,
      revenuePer1000: viewers ? round((revenue / viewers) * 1000) : 0,
    },
    funnel,
    byProduct: Object.values(byProduct).sort((a, b) => b.revenue - a.revenue || b.clicks - a.clicks),
    byScene,
    orders,
  };
}

module.exports.pilotReport = pilotReport;
