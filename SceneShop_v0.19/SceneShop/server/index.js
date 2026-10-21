/**
 * SceneShop — servidor do MVP.
 *
 *  Páginas:  /  (player TV/computador)   /s/:codigo  (celular)   /studio.html  (estúdio, ganhos, moderação)
 *  REST:     obras e trilhas (público) · votos/denúncias (espectador na sessão) · estúdio e ganhos (login)
 *            moderação, AML e auditoria (moderador)
 *  Tempo real: Socket.IO (uma sala por sessão TV <-> celulares)
 */
const http = require("http");
const os = require("os");
const path = require("path");
const express = require("express");
const QRCode = require("qrcode");
const { Server } = require("socket.io");

const config = require("./config");
const fs = require("fs");
const { assertProductionRuntime } = require("./runtime-config");
const releaseContract = require("../docs/release/V0_19_RELEASE_CONTRACT_R0_1.json");
const packageVersion = require("../package.json").version;
const releaseRuntime = Object.freeze({ channel: "rc", contractSchemaVersion: releaseContract.schemaVersion, latestMigration: releaseContract.database.latestMigration, migrationSetSha256: releaseContract.database.migrationSetSha256, nativeBridgeVersion: releaseContract.nativeBridge.messageVersion, rollbackCompatibleFrom: releaseContract.rollback.applicationRollbackCompatibleFrom });
const catalog = require("./catalog");
const store = require("./store");
const observability = require("./observability");
const { createOperationsRuntime } = require("./operations");
const { createCacheCoordinator } = require("./operations/cache-coordinator");
const tracks = require("./tracks");
const money = require("./money");
const offers = require("./offers");
const sessions = require("./sessions");
const auth = require("./auth");
const audit = require("./audit");
const aml = require("./aml");
const antifraud = require("./antifraud");
const partners = require("./partners");
const official = require("./official");
const commercialPolicy = require("./commercial-policy");
const { identity, content, organizations, playback } = require("./repositories");
const orgAccess = require("./organizations");
const { configureSocketRedis } = require("./realtime/socket-redis");
let socketRealtime = { kind: "memory", close: async () => {}, health: async () => ({ ok: true, backend: "memory" }) };
const operations = createOperationsRuntime({ store });
const cacheRuntime = createCacheCoordinator({ backend: config.CACHE_BACKEND, url: config.REDIS_URL, prefix: config.CACHE_PREFIX });
offers.configureCache(cacheRuntime);

const PORT = Number(process.env.PORT || 3000);
const app = express();
const securityHttp = require("./security/http");
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });
app.set("trust proxy", config.TRUST_PROXY ? 1 : false);
const { requireRole } = auth;
const WRITERS = ["author", "producer"];
const MODS = ["moderator"];

app.disable("x-powered-by");
app.use(securityHttp.middleware);
app.use(observability.httpMiddleware);
// guarda o corpo cru: a assinatura dos avisos de pedido é calculada sobre ele
app.use(express.json({ limit: "1mb", verify: (req, res, buf) => { req.rawBody = buf.toString("utf8"); } }));
app.get("/.well-known/apple-app-site-association", (req, res) => res.type("application/json").sendFile(path.join(__dirname, "..", "public", ".well-known", "apple-app-site-association")));
app.get("/.well-known/assetlinks.json", (req, res) => res.type("application/json").sendFile(path.join(__dirname, "..", "public", ".well-known", "assetlinks.json")));
// Ferramenta de tradução (só desenvolvimento): SCENESHOP_I18N_SHADOW=en|es faz as telas calcularem a
// tradução sem aplicá-la e registrarem em data/i18n-misses.txt o que ainda está sem tradução.
if (/^(en|es)$/.test(process.env.SCENESHOP_I18N_SHADOW || "") && !config.IS_PRODUCTION) {
  app.get("/js/i18n-dict.js", (req, res) => {
    res.type("application/javascript").send(`globalThis.SceneShopI18nShadow=${JSON.stringify(process.env.SCENESHOP_I18N_SHADOW)};\n` + fs.readFileSync(path.join(__dirname, "..", "public", "js", "i18n-dict.js"), "utf8"));
  });
  app.post("/api/dev/i18n-misses", (req, res) => {
    const list = Array.isArray(req.body) ? req.body.filter((x) => typeof x === "string").slice(0, 200) : [];
    if (list.length) fs.appendFileSync(path.join(__dirname, "..", "data", "i18n-misses.txt"), list.map((x) => x.replace(/\n/g, " ") + "\n").join(""));
    res.status(204).end();
  });
}
app.use(express.static(path.join(__dirname, "..", "public")));
// arquivos enviados no piloto (vídeos com suporte a "range": o player pode pular para qualquer ponto)
app.use("/uploads", express.static(require("./uploads").ROOT, { maxAge: "1h" }));
app.use(auth.attach);
app.use(orgAccess.attach);
app.use(require("./pilot")({ requireRole, reply: (...a) => reply(...a), actor: (req) => actor(req) }));
app.use(require("./ai").routes({ requireRole, actor: (req) => actor(req), content }));
app.use(require("./acr").routes({ requireRole, content }));
app.use(require("./audio-id").routes({ requireRole, content }));
// cópia da obra com o selo "SceneShop compatible" nos primeiros segundos
app.use(require("./branding").routes({ requireRole, content, actor: (req) => (req.user ? req.user.username : "anônimo") }));
app.use(require("./commerce").routes({ requireRole, orgAccess }));
app.use(require("./payments").routes({ requireRole, orgAccess }));
app.use(require("./distribution").routes({ requireRole, orgAccess, antifraud, io }));
app.use(require("./privacy").routes({ requireRole, orgAccess }));

const wrap = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((e) => {
  console.error(e);
  res.status(500).json({ error: "Erro interno" });
});
const actor = (req) => (req.user ? req.user.username : "anônimo");
function audioProvider() {
  const want = String(process.env.SCENESHOP_AUDIO_ID || "sceneshop").toLowerCase();
  return want === "acrcloud" && require("./acr").identifyConfigured() ? "acrcloud" : "sceneshop";
}
const reply = (res, r, okStatus = 200) => {
  const { code, ...body } = r;
  res.status(r.error || r.errors ? code || 400 : okStatus).json(body);
};
const identityMfaStatus = async (username) => {
  const record = await Promise.resolve(identity.getMfaAuthoritative(username));
  return { enabled: !!(record && record.enabled), configured: !!record, verifiedAt: record && record.verifiedAt || null };
};

function publicBaseUrl(req) {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/$/, "");
  const host = (req.get && req.get("host")) || req.headers.host || `localhost:${PORT}`;
  const proto = req.protocol || "http";
  if (/^(localhost|127\.)/.test(host)) {
    const lan = Object.values(os.networkInterfaces()).flat().find((i) => i && i.family === "IPv4" && !i.internal);
    if (lan) return `${proto}://${lan.address}:${PORT}`;
  }
  return `${proto}://${host}`;
}

// ================================================================== contas
app.get("/api/config", (req, res) => res.json({
  demo: config.DEMO,
  demoAccounts: config.DEMO ? [
    { username: "ana", role: "author", label: "Ana Legendas (comunidade)" },
    { username: "produtora", role: "producer", label: "Produtora Demo (oficial)" },
    { username: "promo_x", role: "author", label: "promo_x (fraudador)" },
    { username: "moderador", role: "moderator", label: "Moderador / compliance" },
  ] : [],
  demoPassword: config.DEMO ? "demo1234" : null,
  // SceneShop ID (próprio) é o padrão; SCENESHOP_AUDIO_ID=acrcloud volta a usar a ACRCloud primeiro
  audioRecognition: audioProvider(),
  audioRecognitionFallback: require("./acr").identifyConfigured() && audioProvider() !== "acrcloud" ? "acrcloud" : null,
  audioRecognitionRegistry: require("./acr").registryConfigured(),
}));

app.post("/api/auth/login", antifraud.rateLimit("login"), wrap(async (req, res) => {
  const r = await Promise.resolve(auth.login((req.body || {}).username, (req.body || {}).password, antifraud.ipOf(req)));
  res.status(r.error ? 401 : 200).json(r);
}));

app.post("/api/auth/mfa", antifraud.rateLimit("login"), wrap(async (req, res) => {
  const r = await Promise.resolve(auth.completeMfaLogin((req.body || {}).challenge, (req.body || {}).code, antifraud.ipOf(req)));
  res.status(r.error ? 401 : 200).json(r);
}));

app.post("/api/auth/signup", antifraud.rateLimit("signup"), wrap(async (req, res) => {
  const r = await Promise.resolve(auth.signup(req.body || {}, antifraud.ipOf(req)));
  if (r.token && r.user) {
    const existing = await Promise.resolve(organizations.listForUser(r.user.username));
    if (!existing.length) {
      const org = await Promise.resolve(organizations.create({
        name: `${r.user.name || r.user.username} · Workspace`,
        slug: `workspace-${r.user.username}`,
        kind: 'OTHER',
      }, r.user.username));
      if (org.organization) r.organization = org.organization;
    }
  }
  reply(res, r, 201);
}));

app.get("/api/me", requireRole(), wrap(async (req, res) =>
  res.json(await Promise.resolve(auth.publicUserAuthoritative(req.user)))));

app.get("/api/me/mfa", requireRole(), wrap(async (req, res) => {
  const r = await Promise.resolve(identityMfaStatus(req.user.username));
  res.json(r);
}));

app.post("/api/me/mfa/setup", requireRole(), wrap(async (req, res) => {
  const r = await Promise.resolve(auth.setupMfa(req.user.username));
  audit.log(actor(req), "mfa_setup_iniciado", {});
  reply(res, r, 201);
}));

app.post("/api/me/mfa/enable", requireRole(), wrap(async (req, res) => {
  const r = await Promise.resolve(auth.enableMfa(req.user.username, (req.body || {}).code));
  reply(res, r);
}));

app.post("/api/me/mfa/disable", requireRole(), wrap(async (req, res) => {
  const r = await Promise.resolve(auth.disableMfa(req.user.username, (req.body || {}).code));
  reply(res, r);
}));

app.get("/api/me/sessions", requireRole(), wrap(async (req,res)=>{
  res.json(await Promise.resolve(identity.listSessionsAuthoritative(req.user.username)));
}));

app.delete("/api/me/sessions/:id", requireRole(), wrap(async (req,res)=>{
  const ok=await Promise.resolve(identity.revokeSessionAuthoritative(req.user.username,req.params.id,'user_revoked'));
  if(!ok)return res.status(404).json({error:'Sessão não encontrada.'});
  audit.log(actor(req),'sessao_revogada',{sessionId:req.params.id});res.json({ok:true});
}));

// "Sair de todos os aparelhos": invalida todos os tokens emitidos
app.post("/api/auth/logout-all", requireRole(), wrap(async (req, res) => {
  await Promise.resolve(auth.logoutAll(req.user.username));
  audit.log(actor(req), "logout_todos", {});
  res.json({ ok: true });
}));

// ================================================================== organizações / multi-tenant (v0.10)
app.get("/api/me/organizations", requireRole(), wrap(async (req, res) => {
  res.json(await Promise.resolve(organizations.listForUser(req.user.username)));
}));

app.get("/api/me/context", requireRole(), wrap(async (req, res) => {
  res.json({
    user: await Promise.resolve(auth.publicUserAuthoritative(req.user)),
    organization: req.organization || null,
    membership: req.orgMembership ? { role: req.orgMembership.role, status: req.orgMembership.status } : null,
  });
}));

app.post("/api/organizations", requireRole(), wrap(async (req, res) => {
  const r = await Promise.resolve(organizations.create(req.body || {}, req.user.username));
  if (r.organization) audit.log(actor(req), "organizacao_criada", { organizationId: r.organization.id, slug: r.organization.slug, kind: r.organization.kind });
  reply(res, r, 201);
}));

app.get("/api/organizations/:id", requireRole(), wrap(async (req, res) => {
  const membership = await Promise.resolve(organizations.getMembership(req.params.id, req.user.username));
  if (!membership || membership.status !== "ACTIVE") return res.status(404).json({ error: "Organização não encontrada." });
  const org = await Promise.resolve(organizations.get(req.params.id));
  if (!org) return res.status(404).json({ error: "Organização não encontrada." });
  res.json({ ...org, membership: { role: membership.role, status: membership.status } });
}));

app.patch("/api/organizations/:id/settings", requireRole(), orgAccess.requireCapability("ORG_SETTINGS", { strong:true }), wrap(async (req, res) => {
  if (req.organization.id !== req.params.id) return res.status(404).json({ error:"Organização não encontrada." });
  const security = (req.body || {}).security || {};
  const patch = { security: { requireMfaForWrites: !!security.requireMfaForWrites } };
  const r = await Promise.resolve(organizations.updateSettings(req.params.id, patch));
  if (r.organization) audit.log(actor(req), "organizacao_seguranca_atualizada", { organizationId:req.params.id, requireMfaForWrites:patch.security.requireMfaForWrites });
  reply(res, r);
}));

app.get("/api/organizations/:id/invites", requireRole(), orgAccess.requireCapability("MEMBERS_MANAGE"), wrap(async (req, res) => {
  if (req.organization.id !== req.params.id) return res.status(404).json({ error:"Organização não encontrada." });
  res.json(await Promise.resolve(organizations.listInvites(req.params.id)));
}));

app.post("/api/organizations/:id/invites", requireRole(), orgAccess.requireCapability("MEMBERS_MANAGE"), wrap(async (req, res) => {
  if (req.organization.id !== req.params.id) return res.status(404).json({ error:"Organização não encontrada." });
  const requestedRole=String((req.body||{}).role||'').toUpperCase();
  if (!orgAccess.canManageRole(req.orgMembership.role, requestedRole)) return res.status(403).json({error:'Sem permissão para conceder essa função.'});
  const r=await Promise.resolve(organizations.createInvite(req.params.id, req.body||{}, req.user.username));
  if(r.invite)audit.log(actor(req),'organizacao_convite_criado',{organizationId:req.params.id,username:r.invite.username,role:r.invite.role,inviteId:r.invite.id});
  reply(res,r,201);
}));

app.delete("/api/organizations/:id/invites/:inviteId", requireRole(), orgAccess.requireCapability("MEMBERS_MANAGE"), wrap(async (req,res)=>{
  if (req.organization.id !== req.params.id) return res.status(404).json({ error:"Organização não encontrada." });
  const r=await Promise.resolve(organizations.revokeInvite(req.params.id,req.params.inviteId));
  if(r.invite)audit.log(actor(req),'organizacao_convite_revogado',{organizationId:req.params.id,inviteId:req.params.inviteId});
  reply(res,r);
}));

app.post("/api/organization-invites/accept", requireRole(), wrap(async (req,res)=>{
  const r=await Promise.resolve(organizations.acceptInvite((req.body||{}).token,req.user.username));
  if(r.member)audit.log(actor(req),'organizacao_convite_aceito',{organizationId:r.member.organizationId,role:r.member.role});
  reply(res,r);
}));

app.get("/api/organizations/:id/members", requireRole(), wrap(async (req, res) => {
  const membership = await Promise.resolve(organizations.getMembership(req.params.id, req.user.username));
  if (!membership || membership.status !== "ACTIVE") return res.status(404).json({ error: "Organização não encontrada." });
  res.json(await Promise.resolve(organizations.listMembers(req.params.id)));
}));

app.post("/api/organizations/:id/members", requireRole(), wrap(async (req, res) => {
  const membership = await Promise.resolve(organizations.getMembership(req.params.id, req.user.username));
  if (!orgAccess.canAdmin(membership)) return res.status(403).json({ error: "Sem permissão para administrar membros." });
  const requestedRole = String((req.body || {}).role || "").toUpperCase();
  if (!orgAccess.canManageRole(membership.role, requestedRole)) return res.status(403).json({ error: "Sem permissão para conceder essa função." });
  const r = await Promise.resolve(organizations.addMember(req.params.id, (req.body || {}).username, requestedRole, req.user.username));
  if (r.member) audit.log(actor(req), "organizacao_membro_adicionado", { organizationId: req.params.id, username: r.member.username, role: r.member.role });
  reply(res, r, 201);
}));

app.patch("/api/organizations/:id/members/:username", requireRole(), wrap(async (req, res) => {
  const membership = await Promise.resolve(organizations.getMembership(req.params.id, req.user.username));
  if (!orgAccess.canAdmin(membership)) return res.status(403).json({ error: "Sem permissão para administrar membros." });
  const requestedRole = String((req.body || {}).role || "").toUpperCase();
  if (!orgAccess.canManageRole(membership.role, requestedRole)) return res.status(403).json({ error: "Sem permissão para conceder essa função." });
  const r = await Promise.resolve(organizations.setMemberRole(req.params.id, req.params.username, requestedRole));
  if (r.member) audit.log(actor(req), "organizacao_membro_funcao", { organizationId: req.params.id, username: r.member.username, role: r.member.role });
  reply(res, r);
}));

app.delete("/api/organizations/:id/members/:username", requireRole(), wrap(async (req, res) => {
  const membership = await Promise.resolve(organizations.getMembership(req.params.id, req.user.username));
  if (!orgAccess.canAdmin(membership)) return res.status(403).json({ error: "Sem permissão para administrar membros." });
  const target = await Promise.resolve(organizations.getMembership(req.params.id, req.params.username));
  if (target && !orgAccess.canManageRole(membership.role, target.role)) return res.status(403).json({ error: "Sem permissão para remover esse membro." });
  const r = await Promise.resolve(organizations.removeMember(req.params.id, req.params.username));
  if (r.ok) audit.log(actor(req), "organizacao_membro_removido", { organizationId: req.params.id, username: req.params.username });
  reply(res, r);
}));

// ================================================================== obras e trilhas (público)
app.get("/api/works", wrap(async (req, res) => res.json(await Promise.resolve(content.listWorksAuthoritative()))));

app.get("/api/works/:id", wrap(async (req, res) => {
  const work = await Promise.resolve(content.getWorkAuthoritative(req.params.id));
  if (!work) return res.status(404).json({ error: "obra não encontrada" });
  const access = partners.resolve(req, work.id); // chave do parceiro + domínio autorizado
  if (access.error) return reply(res, access);
  const track = await tracks.pickAuthoritative(work.id, req.query.track);
  if (!track) return res.status(404).json({ error: "nenhuma trilha para esta obra" });
  res.json({ ...(await tracks.view(work, track)), partner: partners.publicView(access.partner) });
}));

app.get("/api/works/:id/tracks", wrap(async (req, res) => res.json(await tracks.rankedAuthoritative(req.params.id))));

app.get("/api/works/:id/commerce-timeline", wrap(async (req, res) => {
  const timeline = await Promise.resolve(content.getPublishedTimeline(req.params.id));
  if (!timeline) return res.status(404).json({ error: "Commerce Track ainda não publicada para esta obra." });
  res.json(timeline);
}));

app.get("/api/tracks/:id.vtt", wrap(async (req, res) => {
  const t = await tracks.getAuthoritative(req.params.id);
  if (!t || t.status === "removida") return res.status(404).end();
  res.type("text/vtt").send(tracks.vtt(t));
}));

// ================================================================== espectador: voto e denúncia
app.post("/api/tracks/:id/vote", antifraud.rateLimit("vote"), wrap(async (req, res) => {
  const b = req.body || {};
  const v = await Promise.resolve(antifraud.checkViewer({ trackId: req.params.id, session: b.session, deviceId: b.deviceId }));
  if (v.error) return reply(res, v);
  res.json(tracks.vote(req.params.id, !!b.up, b.deviceId));
}));

app.post("/api/tracks/:id/report", antifraud.rateLimit("report"), wrap(async (req, res) => {
  const b = req.body || {};
  const v = await Promise.resolve(antifraud.checkViewer({ trackId: req.params.id, session: b.session, deviceId: b.deviceId }));
  if (v.error) return reply(res, v);
  const r = await tracks.report(req.params.id, b, b.deviceId);
  if (r.track && r.track.status === "em_revisao") audit.log("sistema", "trilha_em_revisao", { trackId: req.params.id, peso: r.track.reportWeight });
  reply(res, r);
}));

// ================================================================== clique rastreado -> loja
app.get("/r", antifraud.rateLimit("click"), wrap(async (req, res) => {
  const { t, p, s, sess, d, w, pa } = req.query;
  const product = await Promise.resolve(content.getProductAuthoritative(p));
  if (!product) return res.status(404).send("Produto não encontrado");
  const partnerId = pa && store.state.partners[pa] ? pa : null;
  const { click } = await Promise.resolve(antifraud.registerClick({ trackId: t, productId: p, storeId: s, session: sess, deviceId: d, partnerId }));

  // loja com acordo: gera a oferta garantida e monta o link conforme o acordo
  // (código assinado, cupom de uso único ou link de campanha)
  const off = official.offerFor(p);
  if (off && off.seller.id === s) {
    // loja conectada: cupom SS-XXXXXX criado na loja + página que mostra o cupom antes de seguir
    const link = await official.buildRedirectAsync({ productId: p, click, workId: w, partnerId });
    if (link.interstitial) return res.set("X-SceneShop-Click", click.id).redirect(302, `/cupom/${encodeURIComponent(link.offerId)}`);
    return res.set("X-SceneShop-Click", click.id).redirect(302, link.url);
  }

  const list = await offers.offersFor(product);
  const o = list.find((x) => x.store === s) || list[0];
  if (!o || !o.url) return res.status(404).send("Oferta indisponível para este produto.");
  res.set("X-SceneShop-Click", click.id).redirect(302, o.url);
}));

// Página intermediária: mostra o cupom SceneShop, copia e segue para a loja
const escHtml = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
app.get("/cupom/:offerId", (req, res) => {
  const d = official.landing(req.params.offerId);
  if (!d) return res.status(404).send("Oferta não encontrada ou vencida.");
  const brlv = (v) => Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  res.set("Cache-Control", "no-store").type("html").send(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="refresh" content="6;url=${escHtml(d.url)}"><title>Seu cupom SceneShop</title><link rel="stylesheet" href="/css/cupom.css">
<script src="/js/i18n-dict.js"></script><script src="/js/i18n.js"></script></head><body><main class="card">
<img class="badge" src="/media/brand/sceneshop-lockup-color.svg" alt="SceneShop">
<p class="lead">Seu cupom para <b>${escHtml(d.product)}</b> na <b>${escHtml(d.store)}</b></p>
<button id="code" class="code" data-code="${escHtml(d.coupon)}" title="Copiar">${escHtml(d.coupon)}</button>
<p class="help">${d.discountPct ? `${escHtml(String(d.discountPct).replace(".", ","))}% de desconto. ` : ""}Use este código no carrinho da loja. Ele vale para uma compra e só por 48 horas.</p>
<a id="go" class="go" href="${escHtml(d.url)}" rel="noopener">Continuar para a loja</a>
<p class="small">Você será levado à loja em alguns segundos. Preço garantido em cena: ${escHtml(brlv(d.price))}.</p>
</main><script src="/js/cupom.js"></script></body></html>`);
});

// ================================================================== oferta oficial: chave pública, conferência e aviso de pedido
app.get("/api/offers/public-key", (req, res) => res.type("text/plain").send(store.state.offerKeys.public));

// Para lojas sem biblioteca de criptografia: o SceneShop confere o código por elas
app.get("/api/offers/verify", antifraud.rateLimit("verify"), (req, res) => {
  const v = official.verifyToken(req.query.token);
  if (!v.valid) return res.status(422).json({ valid: false, reason: v.reason });
  const p = v.payload;
  res.json({ valid: true, offer: { id: p.oid, productId: p.pid, sellerId: p.sid, price: p.prc / 100, currency: p.cur, commission: p.com, expiresAt: p.exp } });
});

// A loja oficial avisa: pedido pago ou devolvido (assinado com o segredo do vendedor)
app.post("/api/sellers/:id/orders", antifraud.rateLimit("webhook"), wrap(async (req, res) => {
  const r = await Promise.resolve(official.receiveOrder(
    req.params.id, req.body || {}, req.headers, req.rawBody || "", { money, aml }
  ));
  reply(res, r);
}));

// Relatório de vendas em lote (ex.: relatório diário de um grande varejista)
app.post("/api/sellers/:id/report", antifraud.rateLimit("webhook"), wrap(async (req, res) => {
  const r = await Promise.resolve(official.receiveReport(
    req.params.id, req.body || {}, req.headers, req.rawBody || "", { money, aml }
  ));
  reply(res, r);
}));

app.get("/api/sellers", (req, res) => res.json(official.sellersView(false)));
app.get("/api/me/sellers", requireRole(), orgAccess.requireCapability("COMMERCE_READ"), (req, res) => res.json(official.sellersView(true, req.organization.id)));
// Lojas da organização: cadastro, edição, chave de integração, cliques enviados e vendas informadas
app.post("/api/me/sellers", requireRole(), orgAccess.requireCapability("COMMERCE_WRITE"), (req, res) =>
  reply(res, official.createSeller(req.organization.id, req.body || {}, actor(req)), 201));
app.put("/api/me/sellers/:id", requireRole(), orgAccess.requireCapability("COMMERCE_WRITE"), (req, res) =>
  reply(res, official.updateSeller(req.organization.id, req.params.id, req.body || {}, actor(req))));
app.put("/api/me/sellers/:id/enabled", requireRole(), orgAccess.requireCapability("COMMERCE_WRITE"), (req, res) =>
  reply(res, official.setSellerEnabled(req.organization.id, req.params.id, !!(req.body || {}).enabled, actor(req))));
app.post("/api/me/sellers/:id/secret", requireRole(), orgAccess.requireCapability("COMMERCE_WRITE"), (req, res) =>
  reply(res, official.rotateSellerSecret(req.organization.id, req.params.id, actor(req))));
app.post("/api/me/sellers/:id/test", requireRole(), orgAccess.requireCapability("COMMERCE_WRITE"), wrap(async (req, res) => {
  const sl = official.ownSeller(req.organization.id, req.params.id);
  if (!sl) return res.status(404).json({ error: "Loja não encontrada nesta organização." });
  const st = require("./store-connectors").credentialStatus(sl);
  if (!st.ready) return res.status(400).json({ error: st.missing.length ? `Faltam no servidor: ${st.missing.join(", ")}` : "Escolha a plataforma e informe a conta da loja." });
  try { await require("./store-connectors").connectorFor(sl).test(); res.json({ ok: true }); }
  catch (e) { res.status(502).json({ error: `A loja respondeu: ${String(e.message).slice(0, 160)}` }); }
}));
app.post("/api/me/sellers/:id/sync", requireRole(), orgAccess.requireCapability("COMMERCE_WRITE"), wrap(async (req, res) => {
  const sl = official.ownSeller(req.organization.id, req.params.id);
  if (!sl) return res.status(404).json({ error: "Loja não encontrada nesta organização." });
  reply(res, await require("./store-sync").syncSeller(sl, { money, aml }));
}));
app.post("/api/me/sellers/:id/import-report", requireRole(), orgAccess.requireCapability("COMMERCE_WRITE"), wrap(async (req, res) =>
  reply(res, await require("./store-sync").importReport(req.organization.id, req.params.id, (req.body || {}).csv, actor(req), { money, aml }))));
app.get("/api/me/stores-performance", requireRole(), orgAccess.requireCapability("ANALYTICS_READ"), (req, res) =>
  res.json(require("./store-sync").performance(req.organization.id)));
app.get("/api/me/sellers/:id/referrals", requireRole(), orgAccess.requireCapability("COMMERCE_READ"), (req, res) =>
  reply(res, official.referrals(req.organization.id, req.params.id)));
app.post("/api/me/sellers/:id/orders", requireRole(), orgAccess.requireCapability("COMMERCE_WRITE"), wrap(async (req, res) =>
  reply(res, await Promise.resolve(official.registerManualOrder(req.organization.id, req.params.id, req.body || {}, actor(req), { money, aml })))));
app.get("/api/commercial-policy", requireRole("producer", "moderator"), (req, res) => {
  const current = commercialPolicy.current() || commercialPolicy.ensureDefault();
  res.json({ current, history: (req.user.role === "moderator" || req.user.platformAdmin) ? commercialPolicy.history() : undefined });
});

// v0.9: moderator representa temporariamente o operador interno SceneShop.
// A v0.10 terá uma permissão comercial/financeira própria.
app.put("/api/commercial-policy", requireRole("moderator"), (req, res) => {
  const r = commercialPolicy.createVersion(req.body || {}, actor(req));
  if (!r.error) audit.log(actor(req), "politica_comercial_versionada", {
    policyId: r.policy.id, version: r.policy.version, effectiveFrom: r.policy.effectiveFrom, terms: r.policy.terms,
  });
  reply(res, r);
});


// a loja precisa ser da organização ativa (lojas de demonstração sem dono valem para todos no modo demo)
function sellerOfOrg(req, res, next) {
  const sl = store.state.sellers[req.params.id];
  if (!sl || (sl.organizationId ? sl.organizationId !== req.organization.id : !config.DEMO)) return res.status(404).json({ error: "Loja não encontrada nesta organização." });
  next();
}
// Produtora carrega o lote de cupons recebido do varejista
app.post("/api/sellers/:id/codes", requireRole(), orgAccess.requireCapability("COMMERCE_WRITE"), sellerOfOrg, (req, res) =>
  reply(res, official.addCodes(req.params.id, (req.body || {}).productId || null, (req.body || {}).codes, actor(req))));

// Produtora registra o ID da campanha criada pelo varejista para um produto
app.put("/api/sellers/:id/campaigns/:productId", requireRole(), orgAccess.requireCapability("COMMERCE_WRITE"), sellerOfOrg, (req, res) =>
  reply(res, official.setCampaign(req.params.id, req.params.productId, (req.body || {}).campaignId, actor(req))));

// Produtora: produtos das suas trilhas oficiais e a oferta oficial de cada um
app.get("/api/me/official-offers", requireRole(), orgAccess.requireCapability("COMMERCE_READ"), wrap(async (req, res) => {
  const ids = await Promise.resolve(content.listOfficialProductIdsByOrganizationAuthoritative(req.organization.id));
  const rows = await Promise.all(ids.map(async (id) => {
    const p = await Promise.resolve(content.getProductAuthoritative(id));
    if (!p) return null;
    const o = store.state.officialOffers[id];
    return { productId: id, name: p.name, brand: p.brand, image: p.image, referencePrice: p.referencePrice, offer: o || null };
  }));
  res.json(rows.filter(Boolean));
}));

app.put("/api/official-offers/:productId", requireRole(), orgAccess.requireCapability("COMMERCE_WRITE"), wrap(async (req, res) => {
  const owns = await Promise.resolve(content.organizationOwnsOfficialProductAuthoritative(req.organization.id, req.params.productId));
  if (!owns) return res.status(403).json({ errors: ["Esse produto não pertence a uma trilha oficial desta organização."] });
  const product = await Promise.resolve(content.getProductAuthoritative(req.params.productId));
  if (!product) return res.status(404).json({ errors: ["Produto não encontrado."] });
  reply(res, official.setOffer(req.params.productId, req.body || {}, actor(req), { product, organizationId: req.organization.id }));
}));

// ================================================================== estúdio (autor / produtora)
app.get("/api/products", wrap(async (req, res) => {
  const rows = req.organization
    ? await Promise.resolve(content.searchProductsForOrganizationAuthoritative(req.query.q, req.organization.id))
    : await Promise.resolve(content.searchPublicProductsAuthoritative(req.query.q));
  res.json(rows);
}));
app.get("/api/products/:id", wrap(async (req, res) => {
  const p = req.organization
    ? await Promise.resolve(content.getProductForOrganizationAuthoritative(req.params.id, req.organization.id, { allowGlobal:true }))
    : await Promise.resolve(content.getPublicProductAuthoritative(req.params.id));
  p ? res.json(p) : res.status(404).end();
}));

// Criação e edição de produtos (com fotos): server/pilot.js

// Trilha crua para edição: só o autor (ou moderador)
app.get("/api/tracks/:id", requireRole(), wrap(async (req, res) => {
  const t = await tracks.getAuthoritative(req.params.id);
  if (!t) return res.status(404).json({ error: "trilha não encontrada" });
  if (req.user.role !== "moderator" && !req.user.platformAdmin) {
    if (t.organizationId) {
      if (!req.organization || req.organization.id !== t.organizationId || !orgAccess.hasCapability(req.orgMembership,"CONTENT_READ")) return res.status(403).json({ error: "Trilha de outra organização ou sem permissão." });
    } else if (t.authorId !== req.user.authorId) return res.status(403).json({ error: "Trilha de outro autor." });
  }
  res.json(t);
}));

app.get("/api/me/tracks", requireRole(), orgAccess.requireCapability("CONTENT_READ"), wrap(async (req, res) => {
  const rows = (await Promise.resolve(content.listTracksByOrganizationAuthoritative(req.organization.id, req.query.work || null))).map(tracks.summary);
  // marca a trilha que está publicada no app (a que o Editor abre por padrão)
  const live = new Map();
  for (const w of new Set(rows.map((r) => r.workId))) live.set(w, await tracks.liveTrackId(w));
  res.json(rows.map((r) => ({ ...r, live: live.get(r.workId) === r.id && r.status === "ativa" })));
}));

app.post("/api/tracks", requireRole(), orgAccess.requireCapability("CONTENT_WRITE"), wrap(async (req, res) => {
  const r = await tracks.saveAuthoritative({ ...req.body, authorId: req.user.authorId, organizationId: req.organization.id });
  if (r.track) audit.log(actor(req), "trilha_publicada", { trackId: r.track.id, cenas: r.track.scenes, produtos: r.track.products });
  reply(res, r, 201);
}));

app.put("/api/tracks/:id", requireRole(), wrap(async (req, res) => {
  const t = await tracks.getAuthoritative(req.params.id);
  if (!t) return res.status(404).json({ error: "trilha não encontrada" });
  if (t.organizationId) {
    if (!req.organization || req.organization.id !== t.organizationId || !orgAccess.hasCapability(req.orgMembership,"CONTENT_WRITE")) return res.status(403).json({ errors:["Sem permissão para editar esta trilha."] });
    if (orgAccess.organizationRequiresMfa(req.organization) && !(req.user._auth && req.user._auth.mfa)) return res.status(403).json({error:'MFA_REQUIRED',message:'Esta ação exige autenticação multifator.'});
  } else if (t.authorId !== req.user.authorId) return res.status(403).json({ errors: ["Só o autor pode editar a trilha legada."] });
  if (t.status !== "ativa") return res.status(409).json({ errors: ["Trilha em revisão ou removida não pode ser editada."] });
  const body = { ...(req.body || {}) };
  body.scenes = Array.isArray(body.scenes) ? JSON.parse(JSON.stringify(body.scenes)) : body.scenes;
  // produtos aprovados na IA depois que o Editor abriu a trilha entram junto (não se perdem ao salvar)
  const merge = Array.isArray(body.scenes) ? tracks.mergeAiEdits(t, body) : { merged: 0 };
  const r = await tracks.saveAuthoritative({ ...body, authorId:t.authorId, organizationId:t.organizationId || req.organization?.id || null }, t);
  if (r.track) audit.log(actor(req), "trilha_editada", { trackId: t.id, organizationId:t.organizationId || null, iaMesclados: merge.merged || 0 });
  if (r.track) r.aiMerged = merge.merged || 0;
  reply(res, r);
}));

// Excluir trilha (fica como "removida": some do Editor, do player e do app; vendas antigas continuam rastreáveis)
app.delete("/api/tracks/:id", requireRole(), wrap(async (req, res) => {
  const t = await tracks.getAuthoritative(req.params.id);
  if (!t || t.status === "removida") return res.status(404).json({ error: "Trilha não encontrada." });
  if (t.organizationId) {
    if (!req.organization || req.organization.id !== t.organizationId || !orgAccess.hasCapability(req.orgMembership,"CONTENT_WRITE")) return res.status(403).json({ error:"Sem permissão para excluir esta trilha." });
    if (orgAccess.organizationRequiresMfa(req.organization) && !(req.user._auth && req.user._auth.mfa)) return res.status(403).json({error:'MFA_REQUIRED',message:'Esta ação exige autenticação multifator.'});
  } else if (t.authorId !== req.user.authorId && req.user.role !== "moderator") return res.status(403).json({ error: "Só o autor pode excluir a trilha." });
  const out = await tracks.removeAuthoritative(t, actor(req));
  audit.log(actor(req), "trilha_excluida", { trackId: t.id, workId: t.workId, organizationId: t.organizationId || null, republicada: out.republished, publicacaoEncerrada: out.retired });
  res.json({ ok: true, ...out });
}));

// ================================================================== ganhos (do próprio usuário)
app.get("/api/me/ledger", requireRole(...WRITERS), wrap(async (req, res) => res.json(await Promise.resolve(money.ledger(req.user.authorId)))));
app.post("/api/me/kyc", requireRole(...WRITERS), wrap(async (req, res) =>
  reply(res, await Promise.resolve(money.submitKyc(req.user.authorId, req.body || {}, actor(req))))));
app.post("/api/me/withdraw", requireRole(...WRITERS), wrap(async (req, res) =>
  reply(res, await Promise.resolve(money.withdraw(req.user.authorId, actor(req))))));

// ================================================================== moderação, AML e auditoria
app.get("/api/moderation", requireRole(...MODS), (req, res) => res.json(tracks.forModeration()));
app.post("/api/moderation/tracks/:id", requireRole(...MODS), wrap(async (req, res) => {
  const v = (req.body || {}).verdict;
  if (!["ok", "fraude"].includes(v)) return res.status(400).json({ error: "verdict deve ser ok ou fraude" });
  const r = await tracks.review(req.params.id, v);
  if (!r) return res.status(404).end();
  audit.log(actor(req), "moderacao_trilha", { trackId: req.params.id, verdict: v });
  res.json(r);
}));
app.get("/api/moderation/ledger/:authorId", requireRole(...MODS), wrap(async (req, res) => {
  const l = await Promise.resolve(money.ledger(req.params.authorId));
  l ? res.json(l) : res.status(404).end();
}));
app.get("/api/aml/alerts", requireRole(...MODS), (req, res) => res.json(aml.list()));
app.post("/api/aml/alerts/:id", requireRole(...MODS), (req, res) =>
  reply(res, aml.decide(req.params.id, (req.body || {}).decision, (req.body || {}).note, actor(req))));
app.get("/api/aml/kyc", requireRole(...MODS), wrap(async (req, res) =>
  res.json(await Promise.resolve(require("./repositories").identity.listPendingKycAuthoritative()))));
app.post("/api/aml/kyc/:id", requireRole(...MODS), wrap(async (req, res) => {
  const st = (req.body || {}).status;
  if (!["aprovado", "reprovado"].includes(st)) return res.status(400).json({ error: "status inválido" });
  const r = await Promise.resolve(money.setKyc(req.params.id, st, actor(req)));
  r ? res.json(r) : res.status(404).end();
}));
app.get("/api/audit", requireRole(...MODS), (req, res) => res.json({ integrity: audit.verifyChain(), entries: audit.recent(Number(req.query.n) || 60) }));

// ================================================================== só no modo demonstração
if (config.DEMO) {
  // Loja oficial de demonstração (simula o site e o servidor de um vendedor)
  app.use(require("./demo-store")({ port: () => PORT }));
  // Marketplace do piloto (vitrine, carrinho e checkout simulados)
  app.use(require("./marketplace")({ port: () => PORT }));
  app.post("/api/dev/sale", requireRole(...WRITERS), wrap(async (req, res) =>
    reply(res, await money.simulateSale({ authorId: req.user.authorId, selfPurchase: !!(req.body || {}).selfPurchase }))));
  app.post("/api/dev/advance", (req, res) => {
    store.state.clockOffsetDays += Number((req.body || {}).days) || 30;
    store.save();
    aml.evaluateAll();
    res.json({ clockOffsetDays: store.state.clockOffsetDays });
  });
  app.post("/api/dev/kyc", requireRole(...WRITERS), wrap(async (req, res) =>
    res.json(await Promise.resolve(money.setKyc(req.user.authorId, "aprovado", "simulacao-parceiro")))));
  app.post("/api/dev/reset", (req, res) => { store.reset({ keepPilot: req.query.all !== "1" }); aml.evaluateAll(); res.json({ ok: true }); });
}

// ================================================================== sessões TV <-> celular
app.post("/api/sessions", wrap(async (req, res) => {
  const { workId, trackId, time = 0 } = req.body || {};
  const mode = String((req.body || {}).mode || "PARTNER_NATIVE").toUpperCase();
  if (!["PARTNER_NATIVE", "COMPANION", "EMBEDDED"].includes(mode)) return res.status(400).json({ error: "mode inválido" });
  const work = await Promise.resolve(content.getWorkAuthoritative(workId));
  if (!work) return res.status(400).json({ error: "workId inválido" });
  const access = partners.resolve(req, work.id);
  if (access.error) return reply(res, access);
  const track = await tracks.pickAuthoritative(workId, trackId);
  const s = await Promise.resolve(sessions.create(workId, Number(time) || 0, track && track.id, {
    mode,
    bindingId: (req.body || {}).bindingId || null,
    partnerId: access.partner ? access.partner.id : null,
  }));
  await Promise.resolve(sessions.setPartner(s.code, access.partner ? access.partner.id : null));
  const current = await Promise.resolve(sessions.get(s.code));
  await playback.createSession(current);
  const url = `${publicBaseUrl(req)}/s/${s.code}?t=${Math.floor(current.time)}`;
  const qr = await QRCode.toDataURL(url, { margin: 1, width: 360, color: { dark: "#0b0b12", light: "#ffffff" } });
  res.status(201).json({ ...sessions.publicView(current), controllerToken: current.controllerToken, url, qr });
}));

app.get("/api/sessions/:code", wrap(async (req, res) => {
  const s = await Promise.resolve(sessions.get(req.params.code));
  if (!s) return res.status(404).json({ error: "sessão expirada ou inexistente" });
  const deviceId = String(req.query.deviceId || "");
  const viewer = antifraud.validDevice(deviceId) ? await Promise.resolve(sessions.getViewer(s.code, deviceId)) : null;
  res.json({ ...sessions.publicView(s), viewer });
}));

app.get("/assistir/:workId", (req, res) => res.sendFile(path.join(__dirname, "..", "public", "assistir.html")));

app.get("/app", (req, res) => res.sendFile(path.join(__dirname, "..", "public", "app.html")));
app.get("/desktop", (req, res) => res.sendFile(path.join(__dirname, "..", "public", "desktop.html")));
app.get("/mobile", (req, res) => res.sendFile(path.join(__dirname, "..", "public", "mobile.html")));
app.get("/s/:code", (req, res) => res.sendFile(path.join(__dirname, "..", "public", "mobile.html")));

function sceneIdAt(track, t) {
  const s = track.scenes.find((x) => t >= x.start + track.offset && t < x.end + track.offset);
  return s ? s.id : null;
}

process.on("unhandledRejection", (e) => console.error("[unhandledRejection]", e && e.stack ? e.stack : e));

io.on("connection", (socket) => {
  // Um erro num evento (ex.: banco recusando um dado enviado pelo celular) responde com erro
  // àquele cliente; nunca derruba o servidor para todos.
  const rawOn = socket.on.bind(socket);
  socket.on = (event, handler) => rawOn(event, (...args) => {
    const ack = typeof args[args.length - 1] === "function" ? args[args.length - 1] : null;
    Promise.resolve().then(() => handler(...args)).catch((e) => {
      console.error(`[socket:${event}]`, e && e.message ? e.message : e);
      if (ack) { try { ack({ error: "Erro interno" }); } catch (_) {} }
    });
  });
  let sessionCode = null;
  let role = null;
  let deviceId = null;
  const ip = socket.handshake.address;

  socket.on("tv:attach", async ({ code, controllerToken } = {}, ack) => {
    const session = await Promise.resolve(sessions.get(code));
    if (!session || !sessions.canControl(session, controllerToken)) {
      sessionCode = null;
      return ack && ack({ error: "sessão ou credencial de controle inválida" });
    }
    sessionCode = session.code;
    role = "tv";
    socket.join(session.code);
    ack && ack({ ok: true, ...sessions.publicView(session) });
  });

  socket.on("session:join", async ({ code, deviceId: incomingDevice } = {}, ack) => {
    if (!antifraud.allow("join", ip, 30)) return ack && ack({ error: "Muitas tentativas. Aguarde um minuto." });
    const session = await Promise.resolve(sessions.get(code));
    if (!session) return ack && ack({ error: "Sessão expirada. Gere um novo QR code na TV." });
    role = "phone";
    sessionCode = session.code;
    deviceId = antifraud.validDevice(incomingDevice) ? incomingDevice : null;
    if (deviceId) {
      const joined = await Promise.resolve(sessions.addDevice(session.code, deviceId));
      if (joined.isNew) {
        store.state.events.push({ type: "phone_join", workId: session.workId, trackId: session.trackId, deviceId, partnerId: session.partnerId || null, at: store.now() });
        store.save();
      }
    }
    socket.join(session.code);
    const connected = await Promise.resolve(sessions.phoneConnected(session.code, socket.id));
    io.to(session.code).emit("session:phones", { phones: connected ? connected.phones : 0 });
    const viewer = deviceId ? await Promise.resolve(sessions.getViewer(session.code, deviceId)) : null;
    ack && ack({ ok: true, ...sessions.publicView(connected || session), viewer });
  });

  // O player primário atualiza somente o Playback Head compartilhado.
  socket.on("player:tick", async ({ time, playing } = {}) => {
    if (!sessionCode || role !== "tv") return;
    const session = await Promise.resolve(sessions.get(sessionCode));
    if (!session) return;
    const work = await Promise.resolve(content.getWorkAuthoritative(session.workId));
    const max = work && Number(work.duration) > 0 ? Number(work.duration) : Number.MAX_SAFE_INTEGER;
    const position = Math.min(max, Math.max(0, Number(time) || 0));
    const track = session.trackId ? await tracks.getAuthoritative(session.trackId) : null;
    const sid = track && sceneIdAt(track, position);
    const updated = await Promise.resolve(sessions.updatePlayback(session.code, { time: position, playing: !!playing, sceneId: sid }));
    socket.to(session.code).emit("player:tick", { time: updated.playbackPosition, playing: updated.playing });
    if (sid && sid !== session.sceneId) io.to(session.code).emit("scene:change", { sceneId: sid });
  });

  socket.on("tv:track", async ({ trackId } = {}) => {
    if (!sessionCode || role !== "tv") return;
    const session = await Promise.resolve(sessions.get(sessionCode));
    const t = await tracks.getAuthoritative(trackId);
    if (!session || !t || t.workId !== session.workId || t.status === "removida") return;
    await Promise.resolve(sessions.setTrack(session.code, trackId));
    socket.to(session.code).emit("track:change", { trackId });
  });

  // Browse Head é individual por aparelho; não altera o vídeo nem os demais celulares.
  socket.on("commerce:browse", async ({ position, sceneId } = {}, ack) => {
    if (!sessionCode || role !== "phone" || !deviceId) return ack && ack({ error: "viewer_not_attached" });
    const viewer = await Promise.resolve(sessions.setBrowse(sessionCode, deviceId, { position, sceneId }));
    if (!viewer) return ack && ack({ error: "session_expired" });
    const session = await Promise.resolve(sessions.get(sessionCode));
    if (session) await playback.recordViewerState(session, viewer);
    ack && ack({ ok: true, viewer });
  });

  socket.on("commerce:live", async (_payload = {}, ack) => {
    if (!sessionCode || role !== "phone" || !deviceId) return ack && ack({ error: "viewer_not_attached" });
    const viewer = await Promise.resolve(sessions.goLive(sessionCode, deviceId));
    if (!viewer) return ack && ack({ error: "session_expired" });
    const session = await Promise.resolve(sessions.get(sessionCode));
    if (session) await playback.recordViewerState(session, viewer);
    ack && ack({ ok: true, viewer });
  });

  // Re-sync físico é próprio do COMPANION. Ele corrige o Playback Head; Go Live não faz nova identificação.
  socket.on("sync:resync", async ({ position, confidence, source = "AUDIO_FINGERPRINT", recognizedSyncId, fingerprintId } = {}, ack) => {
    if (!sessionCode || role !== "phone" || !deviceId) return ack && ack({ error: "viewer_not_attached" });
    const before = await Promise.resolve(sessions.get(sessionCode));
    if (!before || before.mode !== "COMPANION") return ack && ack({ error: "resync_only_for_companion" });
    const work = await Promise.resolve(content.getWorkAuthoritative(before.workId));
    const max = work && Number(work.duration) > 0 ? Number(work.duration) : Number.MAX_SAFE_INTEGER;
    const safePosition = Math.min(max, Math.max(0, Number(position) || 0));
    const track = before.trackId ? await tracks.getAuthoritative(before.trackId) : null;
    const sceneId = track && sceneIdAt(track, safePosition);
    const safeConfidence = Number.isFinite(Number(confidence)) ? Math.max(0, Math.min(1, Number(confidence))) : null;
    const updated = await Promise.resolve(sessions.resync(sessionCode, { position: safePosition, confidence: safeConfidence, sceneId }));
    await playback.recordSync(updated, { source: String(source || "AUDIO_FINGERPRINT").slice(0, 40), recognizedSyncId, fingerprintId: null, metadata: { deviceId, ...(fingerprintId ? { clientFingerprintId: String(fingerprintId).slice(0, 80) } : {}) } });
    // sincronizado pelo som de outra tela: o filme está passando (não há player do SceneShop para pausar)
    io.to(sessionCode).emit("player:tick", { time: updated.playbackPosition, playing: updated.mode === "COMPANION" ? true : updated.playing, resynced: true });
    ack && ack({ ok: true, ...sessions.publicView(updated) });
  });

  socket.on("disconnect", async () => {
    if (!sessionCode) return;
    if (role === "phone") {
      const current = await Promise.resolve(sessions.phoneDisconnected(sessionCode, socket.id));
      io.to(sessionCode).emit("session:phones", { phones: current ? current.phones : 0 });
    }
    if (role === "tv") io.to(sessionCode).emit("session:tv", { online: false });
  });
});

app.get("/api/live", (req, res) => {
  res.json({ ok: true, service: "sceneshop", version: packageVersion, release: releaseRuntime });
});

app.get("/api/ops/status", requireRole(MODS), wrap(async (req, res) => {
  const [state, cache] = await Promise.all([operations.health(), cacheRuntime.health()]);
  const ok = !!(state.ok && cache.ok);
  res.status(ok ? 200 : 503).json({
    ok,
    version: packageVersion,
    release: releaseRuntime,
    operations: state,
    cache,
    observability: observability.metrics.snapshot(),
  });
}));

app.get("/api/ready", wrap(async (req, res) => {
  const [data, sessionState, socketState, operationsState, cacheState] = await Promise.all([store.health(), sessions.health(), socketRealtime.health(), operations.health(), cacheRuntime.health()]);
  const ok = !!(data.ok && sessionState.ok && socketState.ok && operationsState.ok && cacheState.ok);
  res.status(ok ? 200 : 503).json({
    ok,
    version: packageVersion,
    release: releaseRuntime,
    data,
    realtime: { sessions: sessionState, socket: socketState },
    cache: { ok: cacheState.ok, backend: cacheState.backend, activeInstances: cacheState.activeInstances || 0 },
    operations: { ok: operationsState.ok, backend: operationsState.backend, degraded: !!(operationsState.queue && operationsState.queue.degraded) },
  });
}));

app.get("/api/health", wrap(async (req, res) => {
  const [data, sessionState, socketState, operationsState, cacheState] = await Promise.all([store.health(), sessions.health(), socketRealtime.health(), operations.health(), cacheRuntime.health()]);
  const ok = !!(data.ok && sessionState.ok && socketState.ok && operationsState.ok && cacheState.ok);
  res.status(ok ? 200 : 503).json({
    ok,
    version: packageVersion,
    release: releaseRuntime,
    demo: config.DEMO,
    data,
    realtime: { sessions: sessionState, socket: socketState },
    cache: { ok: cacheState.ok, backend: cacheState.backend, activeInstances: cacheState.activeInstances || 0 },
    operations: { ok: operationsState.ok, backend: operationsState.backend, degraded: !!(operationsState.queue && operationsState.queue.degraded) },
  });
}));

// Erros inesperados nas rotas da API voltam em JSON (o estúdio mostra a mensagem) e ficam no log
// com o caminho, em vez da página HTML padrão do Express, que a interface não consegue ler.
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  console.error(`[api] ${req.method} ${req.originalUrl}:`, err && err.stack ? err.stack : err);
  if (!String(req.originalUrl || "").startsWith("/api/")) return next(err);
  res.status(err && err.status && err.status < 600 ? err.status : 500).json({ error: "Erro interno do servidor. Tente novamente; se persistir, avise o suporte.", code: "INTERNAL_ERROR" });
});

function validateRuntimeConfig() { return assertProductionRuntime(config, process.env); }

async function bootstrap() {
  validateRuntimeConfig();
  await store.init();
  await operations.init();
  await cacheRuntime.init();
  await sessions.init();
  socketRealtime = await configureSocketRedis(io, { url: config.REDIS_URL, enabled: config.SESSION_BACKEND === "redis" });
  aml.evaluateAll();
  return { data: await store.health(), realtime: await sessions.health(), cache: await cacheRuntime.health(), operations: await operations.health() };
}

async function shutdown(signal) {
  try {
    await new Promise((resolve) => server.close(resolve));
    await Promise.allSettled([operations.close(), cacheRuntime.close(), socketRealtime.close(), sessions.close(), store.close()]);
  } catch (err) {
    console.error("Erro no shutdown:", err);
  } finally {
    if (signal) process.exit(0);
  }
}

if (require.main === module) {
  bootstrap()
    .then(({ data, cache, operations: operationsState }) => {
      server.listen(PORT, () => {
        require("./store-sync").start({ money, aml }); // lê os pedidos das lojas conectadas a cada 10 min
        require("./audio-id").indexMissing(() => content.listWorksAuthoritative()); // obras ainda sem índice de som
        // Quadro da janela preta no idioma escolhido pelo lançador (SCENESHOP_LANG=pt|en|es).
        const L = { pt: ["SceneShop rodando", " (modo demonstração)", "Player (TV/computador):", "Estúdio / ganhos:      ", "Rede local (celular):  ", "Contas de demonstração: ana, produtora, promo_x, moderador — senha demo1234"],
          en: ["SceneShop running", " (demo mode)", "Player (TV/computer):  ", "Studio / earnings:     ", "Local network (phone): ", "Demo accounts: ana, produtora, promo_x, moderador — password demo1234"],
          es: ["SceneShop en marcha", " (modo demostración)", "Reproductor (TV/PC):   ", "Estudio / ganancias:   ", "Red local (celular):   ", "Cuentas de demostración: ana, produtora, promo_x, moderador — contraseña demo1234"] }[["en", "es"].includes(process.env.SCENESHOP_LANG) ? process.env.SCENESHOP_LANG : "pt"];
        console.log(`\n${L[0]}${config.DEMO ? L[1] : ""}:`);
        console.log(`  Data Plane:              ${data.backend}`);
        console.log(`  Realtime sessions:       ${sessions.backendKind()}`);
        console.log(`  Operations:              ${operationsState.backend}${operationsState.queue && operationsState.queue.degraded ? " (degraded)" : ""}`);
        console.log(`  Cache/coordination:      ${cache.backend}${cache.activeInstances ? ` (${cache.activeInstances} instance(s))` : ""}`);
        console.log(`  ${L[2]}  http://localhost:${PORT}`);
        console.log(`  ${L[3]}  http://localhost:${PORT}/studio.html`);
        console.log(`  ${L[4]}  ${publicBaseUrl({ headers: {} })}\n`);
        if (config.DEMO) console.log(`  ${L[5]}\n`);
      });
      process.once("SIGTERM", () => shutdown("SIGTERM"));
      process.once("SIGINT", () => shutdown("SIGINT"));
    })
    .catch((err) => {
      console.error("SceneShop não iniciou:", err);
      process.exitCode = 1;
    });
}

module.exports = { app, server, io, bootstrap, shutdown };
