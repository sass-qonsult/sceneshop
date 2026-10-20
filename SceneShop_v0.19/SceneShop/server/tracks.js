/**
 * Trilhas de produtos (o "arquivo de legenda" do SceneShop).
 *
 *  - official : feita com a produtora (figurino, cenografia). Selo "Oficial".
 *  - community: feita por terceiros, como legendas da comunidade. Selo "Comunidade".
 *
 * Ranking: a oficial vem primeiro; entre as da comunidade, a mais confiável
 * (votos + denúncias) aparece antes — quem faz o melhor trabalho recebe mais uso.
 */
const catalog = require("./catalog");
const store = require("./store");
const offers = require("./offers");
const { REPORT_THRESHOLD } = require("./config");
const { content, identity, organizations } = require("./repositories");

const S = () => store.state;

// Limite inferior de Wilson (95%): nota justa mesmo com poucos votos
function wilson(up, down) {
  const n = up + down;
  if (!n) return 0;
  const z = 1.96, p = up / n;
  return (p + (z * z) / (2 * n) - z * Math.sqrt((p * (1 - p) + (z * z) / (4 * n)) / n)) / (1 + (z * z) / n);
}

function reportsOf(trackId) {
  return S().reports.filter((r) => r.trackId === trackId && !r.resolved);
}

// Votos = base (histórico) + um voto por aparelho
function votesOf(t) {
  const base = t.votesBase || { up: 0, down: 0 };
  const dv = Object.values(S().deviceVotes[t.id] || {});
  return { up: base.up + dv.filter((v) => v === 1).length, down: base.down + dv.filter((v) => v === 0).length };
}

// Peso das denúncias abertas (quem acerta denúncias pesa mais; quem erra muito, menos)
const reportWeight = (trackId) => Math.round(reportsOf(trackId).reduce((n, r) => n + (r.weight || 1), 0) * 100) / 100;

function summary(t) {
  const author = S().authors[t.authorId] || { name: t.authorId };
  const reports = reportsOf(t.id).length;
  const votes = votesOf(t);
  const n = votes.up + votes.down;
  return {
    id: t.id, workId: t.workId, type: t.type, title: t.title, status: t.status, offset: t.offset,
    author: { id: author.id, name: author.name },
    votes, reports, reportWeight: reportWeight(t.id),
    approval: n ? Math.round((votes.up / n) * 100) : null,
    score: Math.round((wilson(votes.up, votes.down) - reportWeight(t.id) * 0.05) * 1000) / 1000,
    products: new Set(t.scenes.flatMap((s) => s.products.map((p) => p.id))).size,
    scenes: t.scenes.length,
  };
}

// Trilhas visíveis de uma obra, na ordem em que o espectador deve vê-las
function ranked(workId) {
  return Object.values(S().tracks)
    .filter((t) => t.workId === workId && t.status !== "removida")
    .map(summary)
    .sort((a, b) =>
      (b.type === "official") - (a.type === "official") ||
      (a.status === "em_revisao") - (b.status === "em_revisao") ||
      b.score - a.score);
}

const get = (id) => S().tracks[id] || null;

function pick(workId, trackId) {
  const t = trackId && get(trackId);
  if (t && t.workId === workId && t.status !== "removida") return t;
  const best = ranked(workId)[0];
  return best ? get(best.id) : null;
}

// Monta a obra como o player/celular precisam: cenas + produtos + ofertas com link rastreado
async function view(work, track) {
  const scenes = await Promise.all(track.scenes.map(async (s) => {
    const products = await Promise.all(s.products.map(async (it) => {
      const p = await Promise.resolve(content.getProductAuthoritative(it.id));
      if (!p || p.archivedAt) return null; // produto excluído pela produtora não aparece no app
      // vendedor oficial indicado pela produção vem sempre primeiro, com preço garantido
      const official = require("./official").asListedOffer(p.id);
      const list = await offers.offersFor(p);
      const all = official ? [official, ...list] : list;
      return {
        ...p, box: it.box || p.box, match: it.match || "exato",
        offers: all.map((o) => ({ ...o, url: `/r?t=${track.id}&p=${p.id}&s=${o.store}&w=${work.id}` })),
      };
    }));
    return { ...s, thumb: s.thumb || catalog.thumbAt(work, (s.start + s.end) / 2), products: products.filter(Boolean) };
  }));
  return {
    id: work.id, title: work.title, duration: work.duration, video: work.video, poster: work.poster || null,
    trackVtt: `/api/tracks/${track.id}.vtt`,
    track: summary(track),
    tracks: await rankedAuthoritative(work.id),
    scenes,
  };
}

function ts(sec) {
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${(sec % 60).toFixed(3).padStart(6, "0")}`;
}

// A "legenda invisível" em WebVTT kind="metadata"
function vtt(track) {
  const out = ["WEBVTT", "", `NOTE SceneShop ${track.type === "official" ? "Oficial" : "Comunidade"} · ${track.id} · autor ${track.authorId}`, ""];
  track.scenes.forEach((s) => {
    out.push(`${ts(s.start + track.offset)} --> ${ts(s.end + track.offset)}`,
      JSON.stringify({ scene: s.id, products: s.products.map((p) => p.id) }), "");
  });
  return out.join("\n");
}

// Um voto por aparelho; votar de novo troca o voto (quem prova que assiste: ver antifraud.js)
function vote(trackId, up, deviceId) {
  const t = get(trackId);
  if (!t) return null;
  (S().deviceVotes[trackId] = S().deviceVotes[trackId] || {})[deviceId] = up ? 1 : 0;
  store.save();
  return summary(t);
}

function deviceWeight(deviceId) {
  const r = S().deviceRep[deviceId] || { ok: 0, bad: 0 };
  return Math.min(2, Math.max(0.25, 1 + 0.25 * r.ok - 0.5 * r.bad));
}

async function report(trackId, { sceneId, productId, reason }, deviceId) {
  const t = get(trackId);
  if (!t) return { error: "Trilha não encontrada." };
  const scene = t.scenes.find((s) => s.id === sceneId);
  if (!scene || !scene.products.some((p) => p.id === productId)) return { error: "Produto não pertence a essa cena." };
  const dup = S().reports.some((r) => r.trackId === trackId && r.sceneId === sceneId && r.productId === productId && r.deviceId === deviceId);
  if (dup) return { error: "Você já denunciou esse produto.", code: 409 };
  S().reports.push({
    id: "r" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), trackId, sceneId, productId,
    reason: String(reason || "Produto errado").slice(0, 120), at: store.now(), deviceId, weight: deviceWeight(deviceId),
  });
  let statusChanged = false;
  if (t.type === "community" && t.status === "ativa" && reportWeight(trackId) >= REPORT_THRESHOLD) { t.status = "em_revisao"; statusChanged = true; }
  store.save();
  // No PostgreSQL a trilha é autoritativa no banco: a mudança de status precisa ir para lá.
  if (statusChanged) await persistTrack(t, "content.track.under_review");
  return { track: summary(t) };
}

// Validação de uma trilha enviada pelo estúdio
function validate(body, work) {
  const errors = [];
  if (!Array.isArray(body.scenes) || !body.scenes.length) errors.push("A trilha precisa de ao menos uma cena.");
  (body.scenes || []).forEach((s, i) => {
    if (!(s.end > s.start)) errors.push(`Cena ${i + 1}: o fim precisa ser depois do início.`);
    if (s.start < 0 || s.end > work.duration + 1) errors.push(`Cena ${i + 1}: fora da duração da obra.`);
    (s.products || []).forEach((p) => { if (!catalog.getProduct(p.id)) errors.push(`Cena ${i + 1}: produto desconhecido ${p.id}.`); });
  });
  return errors;
}

function save(body, existing) {
  const work = catalog.getWork(body.workId);
  if (!work) return { errors: ["Obra inválida."] };
  const author = S().authors[body.authorId];
  if (!author) return { errors: ["Autor inválido."] };
  const errors = validate(body, work);
  if (errors.length) return { errors };
  const t = existing || {
    id: `t-${author.id}-${Date.now().toString(36)}`, workId: work.id, authorId: author.id, organizationId: body.organizationId || null,
    type: author.type === "producer" ? "official" : "community",
    status: "ativa", votesBase: { up: 0, down: 0 }, createdAt: store.now(),
  };
  if (body.organizationId) t.organizationId = body.organizationId;
  t.title = String(body.title || "Minha trilha").slice(0, 60);
  t.offset = Number(body.offset) || 0;
  t.scenes = body.scenes.map((s, i) => ({
    id: s.id || `c${i + 1}`, title: String(s.title || `Cena ${i + 1}`).slice(0, 60),
    start: Number(s.start), end: Number(s.end),
    products: (s.products || []).map((p) => ({ id: p.id, match: p.match === "parecido" ? "parecido" : "exato", box: p.box || null,
      ...(typeof p.source === "string" && /^ai:[A-Za-z0-9_-]{1,80}$/.test(p.source) ? { source: p.source } : {}) })),
    // miniatura capturada no estúdio (piloto)
    thumb: require("./uploads").isUploadUrl(s.thumb) ? s.thumb : undefined,
  }));
  t.updatedAt = store.now();
  S().tracks[t.id] = t;
  store.save();
  return { track: summary(t) };
}

// Moderação: "ok" devolve a trilha ao ar; "fraude" remove e estorna o que estiver retido
async function review(trackId, verdict) {
  const t = get(trackId);
  if (!t) return null;
  // a decisão atualiza a reputação de quem denunciou
  reportsOf(trackId).forEach((r) => {
    r.resolved = verdict;
    const rep = (S().deviceRep[r.deviceId] = S().deviceRep[r.deviceId] || { ok: 0, bad: 0 });
    rep[verdict === "fraude" ? "ok" : "bad"] += 1;
  });
  if (verdict === "fraude") {
    t.status = "removida";
    S().sales.forEach((s) => { if (s.trackId === trackId && !s.paidAt) s.reversed = true; });
  } else {
    t.status = "ativa";
  }
  t.updatedAt = store.now();
  store.save();
  await persistTrack(t, verdict === "fraude" ? "content.track.removed" : "content.track.reinstated");
  return summary(t);
}

async function persistTrack(t, topic) {
  if (store.backendKind && store.backendKind() === "postgres") await content.saveTrackAuthoritative(JSON.parse(JSON.stringify(t)), topic);
}

function forModeration() {
  return Object.values(S().tracks).map((t) => ({
    ...summary(t),
    reportList: S().reports.filter((r) => r.trackId === t.id).slice(-20).map((r) => ({ ...r, product: (catalog.getProduct(r.productId) || {}).name })),
  })).sort((a, b) => (b.status === "em_revisao") - (a.status === "em_revisao") || b.reports - a.reports);
}



// ---------------------------------------------------------------------------
// v0.9 alpha.6: authoritative content path. Legacy synchronous functions above
// remain for file/memory mode and for modules not yet migrated.
async function getAuthoritative(id) {
  return await Promise.resolve(content.getTrackAuthoritative(id));
}

async function rankedAuthoritative(workId) {
  const rows = await Promise.resolve(content.listTracksByWorkAuthoritative(workId));
  return (rows || [])
    .filter((t) => t && t.status !== "removida")
    .map(summary)
    .sort((a, b) =>
      (b.type === "official") - (a.type === "official") ||
      (a.status === "em_revisao") - (b.status === "em_revisao") ||
      b.score - a.score);
}

async function pickAuthoritative(workId, trackId) {
  if (trackId) {
    const requested = await getAuthoritative(trackId);
    if (requested && requested.workId === workId && requested.status !== "removida") return requested;
  }
  const rankedRows = await rankedAuthoritative(workId);
  return rankedRows.length ? await getAuthoritative(rankedRows[0].id) : null;
}

async function validateAuthoritative(body, work) {
  const errors = [];
  if (!Array.isArray(body.scenes) || !body.scenes.length) errors.push("A trilha precisa de ao menos uma cena.");
  for (let i=0;i<(body.scenes || []).length;i++) {
    const s = body.scenes[i];
    if (!(s.end > s.start)) errors.push(`Cena ${i + 1}: o fim precisa ser depois do início.`);
    if (s.start < 0 || s.end > work.duration + 1) errors.push(`Cena ${i + 1}: fora da duração da obra.`);
    for (const p of (s.products || [])) {
      const product = body.organizationId
        ? await Promise.resolve(content.getProductForOrganizationAuthoritative(p.id, body.organizationId, { allowGlobal:true }))
        : await Promise.resolve(content.getProductAuthoritative(p.id));
      if (!product) errors.push(`Cena ${i + 1}: produto desconhecido ou de outra organização ${p.id}.`);
      else if (product.archivedAt) errors.push(`Cena ${i + 1}: o produto "${product.name}" foi excluído. Remova-o da cena.`);
    }
  }
  return errors;
}

async function saveAuthoritative(body, existing) {
  const officialOrgKinds = new Set(["CONTENT_OWNER","PRODUCER","CHANNEL","PLATFORM"]);
  const org = body.organizationId ? await Promise.resolve(organizations.get(body.organizationId)) : null;
  let work = body.organizationId
    ? await Promise.resolve(content.getWorkForOrganizationAuthoritative(body.workId, body.organizationId))
    : await Promise.resolve(content.getWorkAuthoritative(body.workId));
  // Linha da comunidade: autores e workspaces que não são donos de conteúdo podem publicar
  // uma trilha "Comunidade" sobre qualquer obra existente (como legendas). Organizações oficiais
  // continuam isoladas nas próprias obras.
  if (!work && org && !officialOrgKinds.has(org.kind)) work = await Promise.resolve(content.getWorkAuthoritative(body.workId));
  if (!work) return { errors: ["Obra inválida."] };
  const author = await Promise.resolve(identity.findAuthorAuthoritative(body.authorId));
  if (!author) return { errors: ["Autor inválido."] };
  const errors = await validateAuthoritative(body, work);
  if (errors.length) return { errors };
  const trackType = org ? (officialOrgKinds.has(org.kind) ? "official" : "community") : (author.type === "producer" ? "official" : "community");
  const t = existing ? JSON.parse(JSON.stringify(existing)) : {
    id: `t-${author.id}-${Date.now().toString(36)}`, workId: work.id, authorId: author.id, organizationId: body.organizationId || null,
    type: trackType,
    status: "ativa", votesBase: { up: 0, down: 0 }, createdAt: store.now(),
  };
  if (body.organizationId) t.organizationId = body.organizationId;
  t.title = String(body.title || "Minha trilha").slice(0, 60);
  t.offset = Number(body.offset) || 0;
  t.scenes = body.scenes.map((s, i) => ({
    id: s.id || `c${i + 1}`, title: String(s.title || `Cena ${i + 1}`).slice(0, 60),
    start: Number(s.start), end: Number(s.end),
    products: (s.products || []).map((p) => ({ id: p.id, match: p.match === "parecido" ? "parecido" : "exato", box: p.box || null,
      ...(typeof p.source === "string" && /^ai:[A-Za-z0-9_-]{1,80}$/.test(p.source) ? { source: p.source } : {}) })),
    thumb: require("./uploads").isUploadUrl(s.thumb) ? s.thumb : undefined,
  }));
  t.updatedAt = store.now();
  const saved = await content.saveTrackAuthoritative(t, existing ? "content.track.updated" : "content.track.created");
  let publication = null;
  if (saved.type === "official" && saved.status === "ativa") {
    publication = await Promise.resolve(content.publishTrackAsCommerceTrack(saved.id, saved.authorId || "system", saved.organizationId || null));
  }
  return { track: summary(saved), publication };
}

async function listByAuthorAuthoritative(authorId, workId) {
  const rows = await Promise.resolve(content.listTracksByAuthorAuthoritative(authorId, workId || null));
  return (rows || []).map(summary);
}

module.exports = { review, forModeration, ranked, get, pick, view, vtt, vote, report, save, summary, reportsOf, getAuthoritative, rankedAuthoritative, pickAuthoritative, saveAuthoritative, listByAuthorAuthoritative };
