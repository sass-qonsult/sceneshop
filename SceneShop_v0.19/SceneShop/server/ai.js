/**
 * MARCAÇÃO ASSISTIDA POR IA (Gemini)
 *
 * O Gemini assiste ao vídeo da obra e devolve:
 *   - as cenas (início e fim);
 *   - os itens compráveis visíveis em cada cena (roupa, joia, acessório, objeto de cenário),
 *     com a posição na imagem e o instante em que aparecem melhor;
 *   - para cada item, o produto mais provável do catálogo da produtora, com um grau de confiança.
 *
 * Nada vai ao ar sem uma pessoa confirmar: o estúdio mostra as sugestões e a produtora aceita,
 * troca ou ignora cada uma (humano no circuito).
 *
 * Chave: somente via GEMINI_API_KEY (ou secret manager injetado no ambiente).
 * Segredos nunca são persistidos pelo SceneShop nem devolvidos ao navegador.
 * Modelo: GEMINI_MODEL, ou o mais recente disponível na conta entre os da lista PREFERRED.
 * GEMINI_BASE troca o endereço da API (usado pelos testes com um simulador).
 */
const fs = require("fs");
const path = require("path");
const express = require("express");
const store = require("./store");
const catalog = require("./catalog");
const audit = require("./audit");
const uploads = require("./uploads");
const orgAccess = require("./organizations");
const { ai: aiPipeline } = require("./repositories");

const DATA = path.join(__dirname, "..", "data");
const JOBS_DIR = path.join(DATA, "ai");
const BASE = () => (process.env.GEMINI_BASE || "https://generativelanguage.googleapis.com").replace(/\/$/, "");
const PREFERRED = ["gemini-3-pro", "gemini-3-flash", "gemini-2.5-pro", "gemini-2.5-flash"];
const MIME = { mp4: "video/mp4", m4v: "video/mp4", webm: "video/webm", mov: "video/quicktime" };

// ------------------------------------------------------------------ chave e modelo
function getKey() { return process.env.GEMINI_API_KEY || null; }

async function api(pathname, { method = "GET", body, headers = {}, raw } = {}) {
  const key = getKey();
  if (!key) throw new Error("Configure a chave do Gemini (Google AI Studio) para usar a IA.");
  const res = await fetch(`${BASE()}${pathname}`, {
    method, headers: { "x-goog-api-key": key, ...(body && !raw ? { "Content-Type": "application/json" } : {}), ...headers },
    body: raw ? body : body ? JSON.stringify(body) : undefined, duplex: raw ? "half" : undefined,
  });
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch (e) { data = { raw: text }; }
  if (!res.ok) {
    const msg = (data.error && data.error.message) || text.slice(0, 200) || res.statusText;
    const err = new Error(res.status === 400 && /API key/i.test(msg) ? "Chave do Gemini inválida." : `Gemini: ${msg}`);
    err.status = res.status;
    throw err;
  }
  return { data, headers: res.headers };
}

let modelCache = null;
async function pickModel() {
  if (process.env.GEMINI_MODEL) return process.env.GEMINI_MODEL;
  if (modelCache) return modelCache;
  const { data } = await api("/v1beta/models?pageSize=200");
  const names = (data.models || [])
    .filter((m) => (m.supportedGenerationMethods || []).includes("generateContent"))
    .map((m) => m.name.replace(/^models\//, ""));
  // o primeiro da lista de preferência que existir (aceita sufixos como "-preview-06-05")
  for (const p of PREFERRED) {
    const hit = names.filter((n) => n === p || n.startsWith(p + "-")).sort((a, b) => (a === p ? -1 : b === p ? 1 : b.localeCompare(a)))[0];
    if (hit) return (modelCache = hit);
  }
  const any = names.find((n) => /^gemini-/.test(n) && !/embedding|tts|image|audio/.test(n));
  if (!any) throw new Error("Nenhum modelo Gemini disponível para esta chave.");
  return (modelCache = any);
}

// ------------------------------------------------------------------ envio do vídeo (Files API)
async function uploadVideo(file, onProgress) {
  const ext = path.extname(file).slice(1).toLowerCase();
  const mime = MIME[ext] || "video/mp4";
  const size = fs.statSync(file).size;
  const start = await api("/upload/v1beta/files", {
    method: "POST",
    headers: {
      "X-Goog-Upload-Protocol": "resumable", "X-Goog-Upload-Command": "start",
      "X-Goog-Upload-Header-Content-Length": String(size), "X-Goog-Upload-Header-Content-Type": mime,
    },
    body: { file: { display_name: path.basename(file) } },
  });
  const uploadUrl = start.headers.get("x-goog-upload-url");
  if (!uploadUrl) throw new Error("Gemini não devolveu o endereço de envio.");
  onProgress && onProgress("enviando o vídeo ao Gemini");
  const res = await fetch(uploadUrl, {
    method: "POST",
    headers: { "Content-Length": String(size), "X-Goog-Upload-Offset": "0", "X-Goog-Upload-Command": "upload, finalize" },
    body: fs.createReadStream(file), duplex: "half",
  });
  const up = await res.json().catch(() => ({}));
  if (!res.ok || !up.file) throw new Error("Falha ao enviar o vídeo ao Gemini.");
  let f = up.file;
  // o Gemini processa o vídeo antes de poder analisá-lo
  for (let i = 0; f.state === "PROCESSING" && i < 180; i++) {
    onProgress && onProgress("o Gemini está processando o vídeo");
    await new Promise((r) => setTimeout(r, Number(process.env.GEMINI_POLL_MS || 2000)));
    f = (await api(`/v1beta/${f.name}`)).data;
  }
  if (f.state !== "ACTIVE") throw new Error(`O Gemini não conseguiu processar o vídeo (${f.state || "sem estado"}).`);
  return { uri: f.uri, mimeType: f.mimeType || mime, name: f.name };
}

// ------------------------------------------------------------------ pedido ao modelo
const SCHEMA = {
  type: "OBJECT",
  properties: {
    scenes: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          start: { type: "STRING", description: "início da cena, MM:SS" },
          end: { type: "STRING", description: "fim da cena, MM:SS" },
          title: { type: "STRING", description: "nome curto e descritivo da cena, em português" },
          items: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                name: { type: "STRING", description: "nome comercial do item, em português (ex.: 'Kimono floral azul e branco')" },
                assetId: { type: "STRING", description: "id exato do CommercialAsset alvo, quando houver correspondência; vazio em descoberta aberta" },
                brand: { type: "STRING", description: "marca provável, se visualmente sustentada" },
                model: { type: "STRING", description: "modelo provável, se visualmente sustentado" },
                category: { type: "STRING", description: "Moda, Joias, Acessórios, Calçados, Beleza, Casa, Eletrônicos ou Outros" },
                description: { type: "STRING", description: "cor, material, modelagem e detalhes visíveis, em uma frase" },
                visibleText: { type: "STRING", description: "marca, preço ou tamanho escritos na tela sobre este item, se houver" },
                bestTime: { type: "STRING", description: "instante em que o item aparece melhor, MM:SS" },
                box_2d: { type: "ARRAY", items: { type: "INTEGER" }, description: "[ymin, xmin, ymax, xmax] de 0 a 1000 no quadro de bestTime" },
                productId: { type: "STRING", description: "id do produto do catálogo que corresponde ao item, ou vazio" },
                matchConfidence: { type: "NUMBER", description: "0 a 1: certeza de que é o mesmo produto do catálogo" },
              },
              required: ["name", "category", "bestTime", "box_2d", "matchConfidence"],
            },
          },
        },
        required: ["start", "end", "title", "items"],
      },
    },
  },
  required: ["scenes"],
};

function buildPrompt({ work, products = [], assets = [], mode = "DISCOVERY", categories = [], oneScene, scene }) {
  const cat = products.map((p) => `- id: ${p.id} | ${p.name} | marca: ${p.brand || "-"} | categoria: ${p.category || "-"} | ${String(p.description || "").slice(0, 160)}`).join("\n");
  const target = assets.map((a) => `- assetId: ${a.id} | ${a.name} | marca: ${a.brand || "-"} | modelo: ${a.model || "-"} | categoria: ${a.category || "-"} | ${String(a.description || "").slice(0, 180)}`).join("\n");
  const selected = categories.length ? categories.join(", ") : "todas as categorias comerciais relevantes";
  const modeInstruction = mode === "TARGETED"
    ? `MODO TARGETED: procure SOMENTE os CommercialAssets autorizados abaixo. Não invente outros itens. Quando encontrar um alvo, use o assetId exato.\nAtivos alvo:\n${target}`
    : mode === "HYBRID"
      ? `MODO HYBRID: procure obrigatoriamente os CommercialAssets abaixo e, em paralelo, descubra outros itens nas categorias ${selected}. Para os alvos, use o assetId exato.\nAtivos alvo:\n${target}`
      : `MODO DISCOVERY: faça descoberta aberta apenas nas categorias ${selected}. Não dependa de inventário previamente enviado; assetId deve ficar vazio para itens descobertos.`;
  return [
    `Você é o motor PRIMÁRIO de identificação do SceneShop. Assista ao vídeo "${work.title}" (${Math.round(work.duration)} s). Sua saída será congelada antes de qualquer verificação externa; portanto responda somente com evidência visual própria, sem assumir confirmação por Google, catálogo externo ou outro motor.`,
    modeInstruction,
    scene
      ? `ANALISE SOMENTE O TRECHO de ${mmss(scene.start)} a ${mmss(scene.end)} (cena "${scene.title}"), recortado dos cortes de cena definidos pela produção. Responda com exatamente UMA cena com start ${mmss(scene.start)} e end ${mmss(scene.end)}, com os itens visíveis nesse trecho. Use tempos absolutos do vídeo (MM:SS).`
      : oneScene
      ? "Considere o vídeo inteiro como UMA cena só (start 00:00 e end no fim do vídeo)."
      : "Divida o vídeo em cenas pelos cortes de câmera ou mudanças claras de ambiente. As cenas devem ser contínuas, sem sobreposição, cobrindo o vídeo do início ao fim.",
    "Para cada item: dê nome comercial, categoria, descrição curta, marca/modelo somente quando sustentados visualmente, instante de melhor visibilidade e box_2d nesse instante. Se houver marca, preço ou tamanho escritos na tela, copie em visibleText.",
    "Não repita o mesmo item várias vezes na mesma cena. Ignore pessoas, rostos e textos que não descrevam um item.",
    products.length
      ? `Após identificar visualmente o item, você pode associá-lo ao catálogo interno abaixo usando productId e matchConfidence. Essa associação é parte da identificação primária e não é verificação redundante. Se nenhum corresponder, deixe productId vazio.\nCatálogo interno:\n${cat}`
      : "Não há catálogo interno para associação: deixe productId vazio e matchConfidence 0.",
  ].join("\n\n");
}

const mmss = (t) => `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(Math.floor(t % 60)).padStart(2, "0")}`;
const toSec = (s) => {
  const parts = String(s || "0").trim().split(":").map(Number);
  if (parts.some((n) => !Number.isFinite(n))) return 0;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
};
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// normaliza a resposta do modelo (que pode vir imperfeita) para o formato do estúdio
function normalize(raw, { work, products = [], assets = [] }) {
  const ids = new Set(products.map((p) => p.id));
  const assetIds = new Set(assets.map((a) => a.id));
  const dur = work.duration;
  let scenes = (raw.scenes || []).map((s) => ({
    start: clamp(toSec(s.start), 0, dur), end: clamp(toSec(s.end), 0, dur), title: String(s.title || "").slice(0, 60), items: s.items || [],
  })).filter((s) => s.end > s.start).sort((a, b) => a.start - b.start);
  if (!scenes.length) scenes = [{ start: 0, end: dur, title: work.title, items: [] }];
  // cenas contínuas: fecha buracos e sobreposições
  scenes[0].start = 0;
  for (let i = 1; i < scenes.length; i++) scenes[i].start = scenes[i - 1].end;
  scenes[scenes.length - 1].end = dur;
  scenes = scenes.filter((s) => s.end - s.start >= 0.5);
  return scenes.map((s, si) => ({
    id: `c${si + 1}`, title: s.title || `Cena ${si + 1}`, start: Math.round(s.start * 10) / 10, end: Math.round(s.end * 10) / 10,
    items: s.items.slice(0, 20).map((it, ii) => normItem(it, `${si}-${ii}`, s, ids, assetIds)),
  }));
}

function normItem(it, key, s, ids, assetIds, relativeOk = false) {
  const b = Array.isArray(it.box_2d) && it.box_2d.length === 4 ? it.box_2d.map((n) => clamp(Number(n) || 0, 0, 1000)) : null;
  const box = b && b[2] > b[0] && b[3] > b[1]
    ? { x: +(b[1] / 10).toFixed(1), y: +(b[0] / 10).toFixed(1), w: +((b[3] - b[1]) / 10).toFixed(1), h: +((b[2] - b[0]) / 10).toFixed(1) } : null;
  const pid = ids.has(it.productId) ? it.productId : null;
  const aid = assetIds.has(it.assetId) ? it.assetId : null;
  let t = toSec(it.bestTime);
  // análise de um trecho: o modelo pode responder com o tempo contado do início do trecho
  if (relativeOk && t < s.start - 0.5 && t <= s.end - s.start + 0.5) t += s.start;
  return {
    key, name: String(it.name || "Item").slice(0, 80), assetId: aid, brand: String(it.brand || "").slice(0, 120) || null, model: String(it.model || "").slice(0, 120) || null, category: String(it.category || "Outros").slice(0, 30),
    description: String(it.description || "").slice(0, 300), visibleText: String(it.visibleText || "").slice(0, 120),
    t: clamp(t, s.start, s.end), box, productId: pid,
    confidence: pid ? clamp(Number(it.matchConfidence) || 0, 0, 1) : 0,
  };
}

// Uma cena (dos cortes do Editor de trilha): só os itens daquele trecho, na própria cena.
function normalizeScene(raw, scene, si, { products = [], assets = [] }) {
  const ids = new Set(products.map((p) => p.id));
  const assetIds = new Set(assets.map((a) => a.id));
  const seen = new Set();
  const items = (raw.scenes || []).flatMap((x) => x.items || [])
    .filter((it) => { const k = `${String(it.name || "").toLowerCase()}|${it.productId || ""}|${it.assetId || ""}`; if (seen.has(k)) return false; seen.add(k); return true; })
    .slice(0, 20).map((it, ii) => normItem(it, `${si}-${ii}`, scene, ids, assetIds, true));
  return { id: scene.id, title: scene.title, start: scene.start, end: scene.end, items };
}

// ------------------------------------------------------------------ trabalhos (um por obra)
const jobs = {};
const jobFile = (workId) => path.join(JOBS_DIR, `${workId.replace(/[^a-z0-9-]/g, "")}.json`);
function saveJob(job) {
  fs.mkdirSync(JOBS_DIR, { recursive: true });
  fs.writeFileSync(jobFile(job.workId), JSON.stringify(job, null, 2));
}
function getJob(workId) {
  if (jobs[workId]) return jobs[workId];
  try { return (jobs[workId] = JSON.parse(fs.readFileSync(jobFile(workId), "utf8"))); } catch (e) { return null; }
}

// Gera o conteúdo com o vídeo inteiro ou só um trecho dele (videoMetadata), sempre em JSON.
async function generate(model, video, prompt, clip) {
  const filePart = { file_data: { file_uri: video.uri, mime_type: video.mimeType } };
  if (clip) filePart.video_metadata = { start_offset: `${clip.start}s`, end_offset: `${clip.end}s` };
  const { data } = await api(`/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: "POST",
    body: {
      contents: [{ role: "user", parts: [filePart, { text: prompt }] }],
      generationConfig: { responseMimeType: "application/json", responseSchema: SCHEMA, temperature: 0.2 },
    },
  });
  const text = (((data.candidates || [])[0] || {}).content || { parts: [] }).parts.map((p) => p.text || "").join("");
  try { return { raw: JSON.parse(text), usage: data.usageMetadata || null }; }
  catch (e) { throw new Error("O Gemini respondeu em um formato inesperado. Tente de novo."); }
}

// Cortes do Editor: todas as cenas escolhidas são analisadas ao mesmo tempo (em paralelo,
// limitado por GEMINI_SCENE_CONCURRENCY), cada uma como uma cena separada.
async function analyzeScenes({ work, products, assets, mode, categories, scenes, model, video, step }) {
  const limit = Math.max(1, Math.min(12, Number(process.env.GEMINI_SCENE_CONCURRENCY || 4)));
  const out = new Array(scenes.length);
  const usage = { promptTokenCount: 0, candidatesTokenCount: 0, totalTokenCount: 0 };
  let next = 0, done = 0, failed = 0;
  step(`analisando ${scenes.length} cena(s) em paralelo: 0/${scenes.length}`);
  const worker = async () => {
    while (next < scenes.length) {
      const i = next++, sc = scenes[i];
      const prompt = buildPrompt({ work, products, assets, mode, categories, scene: sc });
      let res = null, error = null;
      for (let attempt = 0; attempt < 2 && !res; attempt++) {
        try { res = await generate(model, video, prompt, sc); } catch (e) { error = e; }
      }
      if (res) {
        out[i] = normalizeScene(res.raw, sc, i, { products, assets });
        for (const k of Object.keys(usage)) usage[k] += Number((res.usage || {})[k] || 0);
      } else {
        failed++;
        out[i] = { id: sc.id, title: sc.title, start: sc.start, end: sc.end, items: [], error: String(error && error.message || "falha").slice(0, 200) };
      }
      done++;
      step(`analisando ${scenes.length} cena(s) em paralelo: ${done}/${scenes.length}`);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, scenes.length) }, worker));
  if (failed === scenes.length) throw new Error(`Nenhuma cena pôde ser analisada: ${out[0].error}`);
  return { scenes: out, usage, failed };
}

async function analyze({ work, products, assets = [], mode = "DISCOVERY", categories = [], oneScene, scenes: trackScenes = null, actor, organizationId, durableJobId }) {
  const job = jobs[work.id] = { workId: work.id, durableJobId: durableJobId || null, mode, status: "rodando", step: "preparando", oneScene: !!oneScene, sceneSource: trackScenes ? "TRACK" : oneScene ? "SINGLE" : "AI", startedAt: store.now() };
  if (durableJobId && organizationId) await Promise.resolve(aiPipeline.startJob(organizationId, durableJobId));
  const step = (s) => { job.step = s; };
  try {
    const file = path.join(uploads.ROOT, work.video.replace(/^\/uploads\//, ""));
    if (!fs.existsSync(file)) throw new Error("Arquivo de vídeo da obra não encontrado.");
    job.model = await pickModel();
    const video = await uploadVideo(file, step);
    if (trackScenes && trackScenes.length) {
      const r = await analyzeScenes({ work, products, assets, mode, categories, scenes: trackScenes, model: job.model, video, step });
      job.scenes = r.scenes;
      job.usage = r.usage;
      job.failedScenes = r.failed;
    } else {
      step("o Gemini está assistindo ao vídeo e identificando os itens");
      const r = await generate(job.model, video, buildPrompt({ work, products, assets, mode, categories, oneScene }));
      job.scenes = normalize(r.raw, { work, products, assets });
      job.usage = r.usage;
    }
    if (durableJobId && organizationId) {
      const candidateItems = job.scenes.flatMap((scene) => (scene.items || []).map((it) => ({
        assetId: it.assetId || null,
        category: it.category,
        name: it.name,
        description: it.description,
        brand: it.brand,
        model: it.model,
        startSeconds: scene.start,
        endSeconds: scene.end,
        bestSeconds: it.t,
        box2d: it.box,
        confidence: it.assetId ? Math.max(it.confidence || 0, 0.5) : (it.confidence || 0),
        primaryPayload: { productId: it.productId || null, visibleText: it.visibleText || "", sourceSceneId: scene.id, sourceSceneTitle: scene.title },
      })));
      const saved = await Promise.resolve(aiPipeline.recordPrimaryBatch(organizationId, durableJobId, candidateItems));
      if (saved && (saved.error || saved.errors)) throw new Error((saved.errors || [saved.error]).join(" "));
      job.candidateIds = (saved.candidates || []).map((x) => x.id);
      await Promise.resolve(aiPipeline.completeJob(organizationId, durableJobId));
    }
    job.status = "pronto";
    job.step = "pronto";
    job.finishedAt = store.now();
    // apaga o vídeo do Gemini (o arquivo original continua só no seu computador)
    api(`/v1beta/${video.name}`, { method: "DELETE" }).catch(() => {});
    const n = job.scenes.reduce((a, s) => a + s.items.length, 0);
    audit.log(actor, "ia_marcacao", { workId: work.id, modelo: job.model, cenas: job.scenes.length, itens: n });
  } catch (e) {
    job.status = "erro";
    job.error = e.message;
    if (durableJobId && organizationId) await Promise.resolve(aiPipeline.failJob(organizationId, durableJobId, e.message)).catch(() => {});
  }
  saveJob(job);
  return job;
}

// ------------------------------------------------------------------ cenas, seleção para o app e publicação
function cleanScenes(list, duration) {
  const dur = Number(duration) || Infinity;
  return (Array.isArray(list) ? list : []).slice(0, 400).map((x, i) => ({
    id: String(x.id || `c${i + 1}`).slice(0, 40), title: String(x.title || `Cena ${i + 1}`).slice(0, 60),
    start: Math.round(clamp(Number(x.start), 0, dur) * 10) / 10, end: Math.round(clamp(Number(x.end), 0, dur) * 10) / 10,
  })).filter((x) => Number.isFinite(x.start) && Number.isFinite(x.end) && x.end - x.start >= 0.3).sort((a, b) => a.start - b.start);
}
const syncKey = (orgId, workId) => `${orgId}:${workId}`;
function syncSelection(orgId, workId, jobs) {
  const sel = (store.state.aiSyncSelection || {})[syncKey(orgId, workId)];
  const valid = new Set(jobs.map((j) => j.id));
  if (sel) return { jobIds: sel.jobIds.filter((id) => valid.has(id)), explicit: true, updatedAt: sel.updatedAt || null };
  const latest = jobs.filter((j) => j.status === "COMPLETED").sort((a, b) => Number(b.createdAt) - Number(a.createdAt))[0];
  return { jobIds: latest ? [latest.id] : [], explicit: false, updatedAt: null };
}

// Trilha que recebe os produtos da IA: a primeira das preferidas que ainda está ativa; senão a da
// publicação comercial em vigor (a que o app mostra); senão a oficial ativa mais recente.
async function liveTrackFor(orgId, workId, content, preferIds = []) {
  const list = ((await Promise.resolve(content.listTracksByOrganizationAuthoritative(orgId, workId))) || [])
    .filter((x) => x.type === "official" && x.status === "ativa");
  for (const id of preferIds) { const hit = list.find((x) => x.id === id); if (hit) return hit; }
  const tl = content.getPublishedTimeline ? await Promise.resolve(content.getPublishedTimeline(workId)).catch(() => null) : null;
  const liveId = tl && tl.manifest && tl.manifest.sourceTrackId;
  return list.find((x) => x.id === liveId) || list.sort((a, b) => Number(b.updatedAt || b.createdAt || 0) - Number(a.updatedAt || a.createdAt || 0))[0] || null;
}
const sigOf = (scenes) => JSON.stringify((scenes || []).map((s) => [s.id, s.start, s.end, (s.products || []).map((p) => [p.id, p.source || ""])]));
function recordSync(orgId, workId, out) {
  (store.state.aiLastSync ||= {})[syncKey(orgId, workId)] = { at: store.now(), ok: !out.error, error: out.error || null, trackId: out.track ? out.track.id : null,
    trackTitle: out.track ? out.track.title : null, products: out.products || 0, scenes: out.scenes || 0, scenesWithProducts: out.scenesWithProducts || 0,
    skipped: out.skipped || 0, auto: !!out.auto };
  store.save();
}

async function publishToApp({ orgId, work, jobIds, user, content, auto = false }) {
  const tracks = require("./tracks");
  const allJobs = await Promise.resolve(aiPipeline.listJobs(orgId, work.id)) || [];
  const chosen = Array.isArray(jobIds) ? jobIds.map(String) : syncSelection(orgId, work.id, allJobs).jobIds;
  const jobs = allJobs.filter((j) => chosen.includes(j.id));
  if (!jobs.length && !auto) return { error: "Marque ao menos uma análise para sincronizar com o app." };
  const jobSet = new Set(jobs.map((j) => j.id));
  const [cands, placements, assets] = await Promise.all([
    Promise.resolve(aiPipeline.listCandidates(orgId, null)), Promise.resolve(aiPipeline.listPlacements(orgId, work.id)), Promise.resolve(aiPipeline.listAssets(orgId)),
  ]);
  const plByCand = new Map((placements || []).map((p) => [p.sourceCandidateId, p]));
  const productOf = new Map((assets || []).map((a) => [a.id, a.productId || null]));
  let skipped = 0;
  const items = [];
  for (const c of cands || []) {
    if (!jobSet.has(c.analysisJobId) || c.reviewStatus !== "APPROVED") continue;
    const pl = plByCand.get(c.id);
    const productId = productOf.get((pl && pl.assetId) || c.resolvedAssetId || c.assetId) || null;
    const product = productId ? await Promise.resolve(content.getProductForOrganizationAuthoritative(productId, orgId, { allowGlobal: true })) : null;
    if (!product || product.archivedAt) { skipped++; continue; }
    const start = pl ? Number(pl.displayStartSeconds) : Number(c.startSeconds), end = pl ? Number(pl.displayEndSeconds) : Number(c.endSeconds);
    items.push({ productId, jobId: c.analysisJobId, sceneId: (c.primaryPayload || {}).sourceSceneId || null, start, end,
      t: Number.isFinite(Number(c.bestSeconds)) ? Number(c.bestSeconds) : (start + end) / 2, box: c.box2d || null });
  }
  // trilha que o app mostra (a mesma que o Editor abre): mantém os cortes e os produtos colocados à mão
  // a trilha do app (a mesma que o Editor abre; salvar no Editor a publica). Sem trilha do app, a do Editor em que a análise foi pedida.
  const tl = content.getPublishedTimeline ? await Promise.resolve(content.getPublishedTimeline(work.id)).catch(() => null) : null;
  const preferIds = [tl && tl.manifest && tl.manifest.sourceTrackId, ...[...jobs].sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0)).map((j) => (j.config || {}).trackId)].filter(Boolean);
  const base = await liveTrackFor(orgId, work.id, content, preferIds);
  if (!items.length && (!auto || !base)) {
    if (auto) return { ok: true, auto, unchanged: true, products: 0, scenes: base ? base.scenes.length : 0, scenesWithProducts: 0, skipped };
    return { error: skipped ? "Os itens aprovados não estão ligados a produtos cadastrados. Aprove-os escolhendo um produto da aba Produtos." : "Nenhum item aprovado nas análises marcadas. Aprove os itens na Fila de revisão." };
  }
  // produtos da IA que a produtora tirou no Editor não voltam sozinhos
  const suppressed = new Set(base ? ((store.state.aiSuppressed || {})[base.id] || []) : []);
  let scenes;
  if (base) scenes = base.scenes.map((sc) => ({ ...sc, products: (sc.products || []).filter((p) => !String(p.source || "").startsWith("ai:")) }));
  else {
    const cfg = jobs.map((j) => (j.config || {}).scenes).find((x) => Array.isArray(x) && x.length);
    const windows = cfg || [...new Map(items.map((i) => [`${i.start}:${i.end}`, { start: i.start, end: i.end }])).values()].sort((a, b) => a.start - b.start);
    scenes = windows.map((x, i) => ({ id: x.id || `c${i + 1}`, title: x.title || `Cena ${i + 1}`, start: x.start, end: x.end, products: [] }));
    if (scenes[0].start > 0.3) scenes.unshift({ id: "c0", title: "Abertura", start: 0, end: scenes[0].start, products: [] });
  }
  let added = 0;
  for (const it of items) {
    const target = scenes.find((s) => s.id === it.sceneId && it.t >= s.start - 0.5 && it.t <= s.end + 0.5)
      || scenes.find((s) => it.t >= s.start && it.t < s.end) || scenes.find((s) => it.start < s.end && it.end > s.start) || scenes[scenes.length - 1];
    if (suppressed.has(`${target.id}|${it.productId}|ai:${it.jobId}`)) continue; // a produtora tirou no Editor
    if (target.products.some((p) => p.id === it.productId)) continue;
    target.products.push({ id: it.productId, match: "exato", box: it.box, source: `ai:${it.jobId}` });
    added++;
  }
  const summary = { jobIds: jobs.map((j) => j.id), products: added, scenes: scenes.length,
    scenesWithProducts: scenes.filter((s) => s.products.length).length, skipped, auto };
  if (base && sigOf(base.scenes) === sigOf(scenes)) return { ok: true, unchanged: true, track: tracks.summary(base), publication: null, ...summary };
  const r = await tracks.saveAuthoritative({ workId: work.id, title: base ? base.title : "Trilha oficial", offset: base ? base.offset : 0, scenes,
    authorId: base ? base.authorId : user.authorId, organizationId: base ? (base.organizationId || orgId) : orgId }, base || undefined);
  if (r.errors) return { error: r.errors.join(" ") };
  return { ok: true, track: r.track, publication: r.publication || null, ...summary };
}

// ------------------------------------------------------------------ sincronização automática
// Toda aprovação, rejeição ou exclusão na Fila de revisão atualiza a trilha do Editor e o app.
// Várias ações seguidas (aprovar em lote) viram uma só publicação.
const autoTimers = new Map();
const autoRuns = new Map(); // uma sincronização por obra de cada vez (a próxima espera a anterior)
const AUTO_MS = () => Math.max(0, Number(process.env.SCENESHOP_AI_AUTOSYNC_MS ?? 800));
const syncPending = (key) => autoTimers.has(key) || autoRuns.has(key);
function scheduleAutoSync(orgId, workId, user, content) {
  if (!orgId || !workId || !content) return;
  const key = syncKey(orgId, workId);
  clearTimeout(autoTimers.get(key));
  autoTimers.set(key, setTimeout(() => {
    autoTimers.delete(key);
    const prev = autoRuns.get(key) || Promise.resolve();
    const run = prev.then(() => runAutoSync(orgId, workId, user, content))
      .catch((e) => recordSync(orgId, workId, { error: e.message, auto: true }))
      .finally(() => { if (autoRuns.get(key) === run) autoRuns.delete(key); });
    autoRuns.set(key, run);
  }, AUTO_MS()));
}
async function runAutoSync(orgId, workId, user, content) {
  const work = await Promise.resolve(content.getWorkForOrganizationAuthoritative(workId, orgId));
  if (!work) return null;
  const out = await publishToApp({ orgId, work, user, content, auto: true });
  recordSync(orgId, workId, out);
  if (!out.error && !out.unchanged) audit.log(user && user.username ? `${user.username} (auto)` : "ia-auto", "ia_sincronizada_auto", { organizationId: orgId, workId, produtos: out.products, cenas: out.scenes });
  return out;
}
// Aprovação automática pedida no Editor: itens que a IA ligou a um produto do catálogo, com confiança
// mínima e sem alerta para o operador, são aprovados com esse produto. O resto fica para revisão.
async function autoApproveJob(orgId, jobId, minConfidence, actorName) {
  const [cands, assets, flags] = await Promise.all([
    Promise.resolve(aiPipeline.listCandidates(orgId, null)), Promise.resolve(aiPipeline.listAssets(orgId)), Promise.resolve(aiPipeline.listOperatorFlags(orgId, "OPEN")),
  ]);
  const flagged = new Set((flags || []).map((f) => f.candidateId));
  let approved = 0, pending = 0;
  for (const c of cands || []) {
    if (c.analysisJobId !== jobId || c.reviewStatus !== "DETECTED") continue;
    const pid = (c.primaryPayload || {}).productId;
    const assetId = c.assetId || ((assets || []).find((a) => a.productId && a.productId === pid) || {}).id;
    if (!assetId || flagged.has(c.id) || Number(c.primaryConfidence || 0) < minConfidence) { pending++; continue; }
    const out = await Promise.resolve(aiPipeline.reviewCandidate(orgId, c.id, { decision: "APPROVE", assetId, note: "Aprovado automaticamente (produto do catálogo)" }, actorName));
    if (out && !out.error && !out.errors) approved++; else pending++;
  }
  return { approved, pending };
}
// Análise nova entra na seleção do app (se a produtora marcou análises à mão, a nova é somada).
function includeInSync(orgId, workId, jobId) {
  const sel = (store.state.aiSyncSelection || {})[syncKey(orgId, workId)];
  if (sel && !sel.jobIds.includes(jobId)) { sel.jobIds.push(jobId); sel.updatedAt = store.now(); store.save(); }
}

async function workOfCandidates(orgId, candidates) {
  const works = new Set();
  for (const c of candidates || []) {
    const j = c && c.analysisJobId ? await Promise.resolve(aiPipeline.getJob(orgId, c.analysisJobId)) : null;
    if (j && j.workId) works.add(j.workId);
  }
  return [...works];
}

// ------------------------------------------------------------------ rotas
function routes({ requireRole, actor, content }) {
  const r = express.Router();
  const asyncRoute = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

  r.get("/api/ai/assets", requireRole(), orgAccess.requireCapability("CONTENT_READ"), asyncRoute(async (req,res) => {
    res.json(await Promise.resolve(aiPipeline.listAssets(req.organization.id)));
  }));
  r.post("/api/ai/assets", requireRole(), orgAccess.requireCapability("CONTENT_WRITE"), asyncRoute(async (req,res) => {
    const out=await Promise.resolve(aiPipeline.createAsset(req.organization.id, req.body||{}, actor(req)));
    if(out.error||out.errors)return res.status(out.code||400).json(out);
    res.status(201).json(out.asset);
  }));
  // Os produtos cadastrados na aba Produtos viram o inventário da IA (um ativo comercial por produto, com as fotos).
  r.post("/api/ai/assets/sync-products", requireRole(), orgAccess.requireCapability("CONTENT_WRITE"), asyncRoute(async (req,res) => {
    const orgId = req.organization.id;
    const wanted = Array.isArray((req.body||{}).productIds) ? new Set(req.body.productIds.map(String)) : null;
    const products = content
      ? await Promise.resolve(content.listProductsByOrganizationAuthoritative(orgId))
      : Object.values(store.state.userProducts || {}).filter((p) => p.organizationId === orgId);
    const existing = await Promise.resolve(aiPipeline.listAssets(orgId));
    const byProduct = new Map((existing||[]).filter(a=>a.productId).map(a=>[a.productId,a]));
    const map = {};
    for (const p of products || []) {
      if (wanted && !wanted.has(p.id)) continue;
      let a = byProduct.get(p.id);
      if (!a) {
        const out = await Promise.resolve(aiPipeline.createAsset(orgId, { productId:p.id, name:p.name, brand:p.brand && p.brand !== "Sem marca" ? p.brand : "", category:"OTHER", description:p.description||"", sku:p.sku||"", metadata:{ source:"product", productCategory:p.category||null } }, actor(req)));
        if (out.error || out.errors) return res.status(out.code||400).json(out);
        a = out.asset;
        const imgs = (p.images && p.images.length ? p.images : [p.image]).filter(Boolean).slice(0, 6);
        for (const uri of imgs) await Promise.resolve(aiPipeline.addReference(orgId, a.id, { uri, mediaType:"IMAGE" }));
      }
      map[p.id] = a.id;
    }
    res.json({ assets: map });
  }));
  r.post("/api/ai/assets/:id/references", requireRole(), orgAccess.requireCapability("CONTENT_WRITE"), asyncRoute(async (req,res) => {
    const out=await Promise.resolve(aiPipeline.addReference(req.organization.id, req.params.id, req.body||{}));
    if(out.error||out.errors)return res.status(out.code||400).json(out);
    res.status(201).json(out.reference);
  }));
  r.get("/api/ai/jobs", requireRole(), orgAccess.requireCapability("CONTENT_READ"), asyncRoute(async (req,res) => {
    res.json(await Promise.resolve(aiPipeline.listJobs(req.organization.id, req.query.workId||null)));
  }));
  r.get("/api/ai/jobs/:id", requireRole(), orgAccess.requireCapability("CONTENT_READ"), asyncRoute(async (req,res) => {
    const j=await Promise.resolve(aiPipeline.getJob(req.organization.id, req.params.id));
    if(!j)return res.status(404).json({error:"Job não encontrado."});res.json(j);
  }));
  r.get("/api/ai/jobs/:id/candidates", requireRole(), orgAccess.requireCapability("CONTENT_READ"), asyncRoute(async (req,res) => {
    const j=await Promise.resolve(aiPipeline.getJob(req.organization.id, req.params.id));
    if(!j)return res.status(404).json({error:"Job não encontrado."});
    res.json(await Promise.resolve(aiPipeline.listCandidates(req.organization.id, req.params.id)));
  }));

  r.get("/api/ai/candidates/:id/verifications", requireRole(), orgAccess.requireCapability("CONTENT_READ"), asyncRoute(async (req,res) => {
    const c=await Promise.resolve(aiPipeline.getCandidate(req.organization.id, req.params.id));
    if(!c)return res.status(404).json({error:"Candidato não encontrado."});
    res.json(await Promise.resolve(aiPipeline.listVerifications(req.organization.id, req.params.id)));
  }));
  r.post("/api/ai/candidates/:id/verifications", requireRole(), orgAccess.requireCapability("AI_RUN"), asyncRoute(async (req,res) => {
    const out=await Promise.resolve(aiPipeline.recordRedundantVerification(req.organization.id, req.params.id, req.body||{}, actor(req)));
    if(out.error||out.errors)return res.status(out.code||400).json(out);
    res.status(201).json(out);
  }));
  r.post("/api/ai/candidates/:id/review", requireRole(), orgAccess.requireCapability("AI_RUN"), asyncRoute(async (req,res) => {
    const out=await Promise.resolve(aiPipeline.reviewCandidate(req.organization.id, req.params.id, req.body||{}, actor(req)));
    if(out.error||out.errors)return res.status(out.code||400).json(out);
    for (const wid of await workOfCandidates(req.organization.id, [out.candidate])) scheduleAutoSync(req.organization.id, wid, req.user, content);
    res.json({ ...out, autoSync: true });
  }));
  r.get("/api/ai/operator-flags", requireRole(), orgAccess.requireCapability("CONTENT_READ"), asyncRoute(async (req,res) => {
    res.json(await Promise.resolve(aiPipeline.listOperatorFlags(req.organization.id, req.query.status||'OPEN')));
  }));
  r.post("/api/ai/operator-flags/:id/resolve", requireRole(), orgAccess.requireCapability("AI_RUN"), asyncRoute(async (req,res) => {
    const out=await Promise.resolve(aiPipeline.resolveOperatorFlag(req.organization.id, req.params.id, req.body||{}, actor(req)));
    if(out.error||out.errors)return res.status(out.code||400).json(out);
    for (const wid of await workOfCandidates(req.organization.id, [out.candidate])) scheduleAutoSync(req.organization.id, wid, req.user, content);
    res.json({ ...out, autoSync: true });
  }));
  r.get("/api/ai/placements", requireRole(), orgAccess.requireCapability("CONTENT_READ"), asyncRoute(async (req,res) => {
    res.json(await Promise.resolve(aiPipeline.listPlacements(req.organization.id, req.query.workId||null)));
  }));

  // v0.15: visão operacional agregada para o Studio. Mantém os objetos
  // canônicos separados no domínio, mas reduz round-trips e garante que a
  // interface de revisão veja um snapshot coerente do tenant ativo.
  r.get("/api/ai/workspace", requireRole(), orgAccess.requireCapability("CONTENT_READ"), asyncRoute(async (req,res) => {
    const workId = req.query.workId || null;
    const [assets, jobs, candidates, flags, placements] = await Promise.all([
      Promise.resolve(aiPipeline.listAssets(req.organization.id)),
      Promise.resolve(aiPipeline.listJobs(req.organization.id, workId)),
      Promise.resolve(aiPipeline.listCandidates(req.organization.id, null)),
      Promise.resolve(aiPipeline.listOperatorFlags(req.organization.id, null)),
      Promise.resolve(aiPipeline.listPlacements(req.organization.id, workId)),
    ]);
    const jobIds = new Set((jobs || []).map((j) => j.id));
    const scopedCandidates = (candidates || []).filter((c) => !workId || jobIds.has(c.analysisJobId));
    const candidateIds = new Set(scopedCandidates.map((c) => c.id));
    const scopedFlags = (flags || []).filter((f) => candidateIds.has(f.candidateId));
    const verifications = [];
    for (const c of scopedCandidates) {
      const rows = await Promise.resolve(aiPipeline.listVerifications(req.organization.id, c.id));
      verifications.push(...(rows || []));
    }
    let timeline = null;
    if (workId && content && content.getPublishedTimeline) {
      timeline = await Promise.resolve(content.getPublishedTimeline(workId));
    }
    res.json({
      workId,
      sync: workId ? { ...syncSelection(req.organization.id, workId, jobs || []), last: (store.state.aiLastSync || {})[syncKey(req.organization.id, workId)] || null, pending: syncPending(syncKey(req.organization.id, workId)) } : null,
      assets: assets || [],
      jobs: jobs || [],
      candidates: scopedCandidates,
      verifications,
      flags: scopedFlags,
      placements: placements || [],
      timeline,
      generatedAt: Date.now(),
    });
  }));
  // ---- exclusões pedidas pela produtora (análises e itens da fila de revisão)
  r.delete("/api/ai/jobs/:id", requireRole(), orgAccess.requireCapability("AI_RUN"), asyncRoute(async (req,res) => {
    const job=await Promise.resolve(aiPipeline.getJob(req.organization.id, req.params.id));
    if(!job)return res.status(404).json({error:"Análise não encontrada."});
    const out=await Promise.resolve(aiPipeline.deleteJob(req.organization.id, req.params.id));
    if(out.error||out.errors)return res.status(out.code||400).json(out);
    const key=syncKey(req.organization.id, job.workId), sel=(store.state.aiSyncSelection||{})[key];
    if(sel){ sel.jobIds=sel.jobIds.filter((x)=>x!==job.id); store.save(); }
    audit.log(actor(req), "ia_analise_excluida", { jobId: job.id, workId: job.workId, candidatos: out.candidates });
    scheduleAutoSync(req.organization.id, job.workId, req.user, content);
    res.json(out);
  }));
  r.post("/api/ai/candidates/delete", requireRole(), orgAccess.requireCapability("AI_RUN"), asyncRoute(async (req,res) => {
    const ids=Array.isArray((req.body||{}).ids)?req.body.ids.map(String).slice(0,2000):[];
    if(!ids.length)return res.status(400).json({error:"Marque ao menos um item."});
    const idSet=new Set(ids);
    const before=((await Promise.resolve(aiPipeline.listCandidates(req.organization.id, null)))||[]).filter((c)=>idSet.has(c.id));
    const works=await workOfCandidates(req.organization.id, before);
    const out=await Promise.resolve(aiPipeline.deleteCandidates(req.organization.id, ids));
    audit.log(actor(req), "ia_itens_excluidos", { pedidos: ids.length, excluidos: out.deleted });
    for (const wid of works) scheduleAutoSync(req.organization.id, wid, req.user, content);
    res.json(out);
  }));

  // ---- quais análises vão para o app: marcadas pela produtora (ou, sem marcação, a mais recente)
  r.put("/api/ai/works/:id/sync", requireRole(), orgAccess.requireCapability("AI_RUN"), asyncRoute(async (req,res) => {
    const w=await Promise.resolve(content.getWorkForOrganizationAuthoritative(req.params.id, req.organization.id));
    if(!w)return res.status(404).json({error:"Obra não encontrada nesta organização."});
    const jobs=await Promise.resolve(aiPipeline.listJobs(req.organization.id, w.id));
    const valid=new Set((jobs||[]).map((j)=>j.id));
    const jobIds=[...new Set(((req.body||{}).jobIds||[]).map(String))].filter((id)=>valid.has(id));
    (store.state.aiSyncSelection ||= {})[syncKey(req.organization.id,w.id)]={ jobIds, updatedAt: store.now(), by: actor(req) };
    store.save();
    scheduleAutoSync(req.organization.id, w.id, req.user, content);
    res.json(syncSelection(req.organization.id, w.id, jobs||[]));
  }));

  // ---- publicar no app: itens APROVADOS das análises marcadas, cada um na sua cena
  r.post("/api/ai/works/:id/publish", requireRole(), orgAccess.requireCapability("AI_RUN"), orgAccess.requireCapability("CONTENT_WRITE"), asyncRoute(async (req,res) => {
    const orgId=req.organization.id;
    const w=await Promise.resolve(content.getWorkForOrganizationAuthoritative(req.params.id, orgId));
    if(!w)return res.status(404).json({error:"Obra não encontrada nesta organização."});
    const out=await publishToApp({ orgId, work:w, jobIds:(req.body||{}).jobIds, user:req.user, content });
    recordSync(orgId, w.id, out);
    if(out.error)return res.status(out.code||400).json(out);
    audit.log(actor(req), "ia_publicada_no_app", { workId:w.id, jobs:out.jobIds, produtos:out.products, cenas:out.scenes });
    res.json(out);
  }));

  const ownWork = async (req, res) => {
    const w = content && req.organization
      ? await Promise.resolve(content.getWorkForOrganizationAuthoritative(req.params.id, req.organization.id))
      : (content ? await Promise.resolve(content.getWorkAuthoritative(req.params.id)) : catalog.getWork(req.params.id));
    if (!w) { res.status(404).json({ error: "Obra não encontrada nesta organização." }); return null; }
    if (!w.video || !String(w.video).startsWith("/uploads/")) { res.status(400).json({ error: "A IA analisa obras enviadas pelo estúdio (aba Obras)." }); return null; }
    return w;
  };

  r.get("/api/ai/status", requireRole("producer"), (req, res) => {
    res.json({ configured: !!getKey(), fromEnv: !!process.env.GEMINI_API_KEY, model: process.env.GEMINI_MODEL || modelCache || null });
  });

  r.post("/api/ai/key", requireRole("producer"), (req, res) => {
    res.status(410).json({
      error: "Chaves de IA não são armazenadas pelo SceneShop. Configure GEMINI_API_KEY no ambiente ou em um secret manager autorizado.",
      code: "SECRET_STORAGE_DISABLED",
    });
  });

  r.post("/api/works/:id/ai", requireRole(), orgAccess.requireCapability("AI_RUN"), asyncRoute(async (req, res) => {
    const w = await ownWork(req, res);
    if (!w) return;
    if (!getKey()) return res.status(400).json({ error: "Configure a chave do Gemini primeiro." });
    const cur = jobs[w.id];
    if (cur && cur.status === "rodando") return res.status(409).json({ error: "A análise desta obra já está em andamento." });
    const body=req.body||{};
    const mode=String(body.analysisMode||body.pipelineMode||"DISCOVERY").toUpperCase();
    const assetIds=Array.isArray(body.assetIds)?body.assetIds:[];
    const categories=Array.isArray(body.categories)?body.categories:[];
    const sceneSource=String(body.sceneSource||(body.oneScene?"SINGLE":"AI")).toUpperCase();
    let scenes=null;
    if(sceneSource==="TRACK"){
      scenes=cleanScenes(body.scenes,w.duration);
      if(!scenes.length)return res.status(400).json({error:"Escolha ao menos uma cena dos cortes do Editor de trilha (use Detectar cortes no Editor)."});
    }
    const created=await Promise.resolve(aiPipeline.createJob(req.organization.id,w,{mode,assetIds,categories,scanDepth:body.scanDepth||"STANDARD",minimumConfidence:body.minimumConfidence,includeBackground:body.includeBackground,minimumScreenSeconds:body.minimumScreenSeconds,primaryProvider:"SCENESHOP_GEMINI",sceneSource,scenes,trackId:body.trackId||null},actor(req)));
    if(created.error||created.errors)return res.status(created.code||400).json(created);
    const assets=(await Promise.resolve(aiPipeline.listAssets(req.organization.id))).filter(a=>assetIds.includes(a.id));
    const products = content
      ? await Promise.resolve(content.listProductsByOrganizationAuthoritative(req.organization.id))
      : Object.values(store.state.userProducts || {}).filter((p) => p.organizationId === req.organization.id);
    const orgId=req.organization.id, who=actor(req), user=req.user;
    const autoApprove=!!body.autoApprove, minAuto=Math.max(0.3,Math.min(1,Number(body.autoApproveMin)||0.7));
    analyze({ work: w, products, assets, mode, categories, oneScene: sceneSource==="SINGLE", scenes, actor: who, organizationId:orgId, durableJobId:created.job.id })
      .then(async (job) => {
        if (!job || job.status !== "pronto") return;
        includeInSync(orgId, w.id, created.job.id);
        if (autoApprove) { job.autoApproved = await autoApproveJob(orgId, created.job.id, minAuto, `${who} (auto)`); saveJob(job); }
        scheduleAutoSync(orgId, w.id, user, content);
      }).catch((e) => console.error("[ai] pós-análise:", e.message));
    res.status(202).json({...jobs[w.id], analysisJob:created.job});
  }));

  r.get("/api/works/:id/ai", requireRole(), orgAccess.requireCapability("CONTENT_READ"), asyncRoute(async (req, res) => {
    const w = await ownWork(req, res);
    if (!w) return;
    res.json(getJob(w.id) || { status: "nenhum" });
  }));

  return r;
}

module.exports = { scheduleAutoSync, routes, normalize, normalizeScene, buildPrompt, pickModel, SCHEMA, cleanScenes, _reset: () => { modelCache = null; for (const k in jobs) delete jobs[k]; } };
