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
const PREFERRED = [
  "gemini-3.1-pro",
  "gemini-3.8-flash",
  "gemini-3.7-flash",
  "gemini-3.5-flash",
  "gemini-3-flash",
  "gemini-3-pro",
  "gemini-2.5-pro",
  "gemini-2.5-flash",
  "gemini-flash-latest",
  "gemini-pro-latest",
];
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
async function pickModel(forceDiscover = false) {
  if (process.env.GEMINI_MODEL && !forceDiscover) return process.env.GEMINI_MODEL;
  if (modelCache && !forceDiscover) return modelCache;
  const { data } = await api("/v1beta/models?pageSize=200");
  const names = (data.models || [])
    .filter((m) => (m.supportedGenerationMethods || []).includes("generateContent"))
    .map((m) => m.name.replace(/^models\//, ""));
  // o primeiro da lista de preferência que existir (aceita sufixos como "-preview-06-05")
  for (const p of PREFERRED) {
    const hit = names.filter((n) => n === p || n.startsWith(p + "-") || n.startsWith(p)).sort((a, b) => (a === p ? -1 : b === p ? 1 : b.localeCompare(a)))[0];
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

function buildPrompt({ work, products = [], assets = [], mode = "DISCOVERY", categories = [], oneScene }) {
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
    oneScene
      ? "Considere o vídeo inteiro como UMA cena só (start 00:00 e end no fim do vídeo)."
      : "Divida o vídeo em cenas pelos cortes de câmera ou mudanças claras de ambiente. As cenas devem ser contínuas, sem sobreposição, cobrindo o vídeo do início ao fim.",
    "Para cada item: dê nome comercial, categoria, descrição curta, marca/modelo somente quando sustentados visualmente, instante de melhor visibilidade e box_2d nesse instante. Se houver marca, preço ou tamanho escritos na tela, copie em visibleText.",
    "Não repita o mesmo item várias vezes na mesma cena. Ignore pessoas, rostos e textos que não descrevam um item.",
    products.length
      ? `Após identificar visualmente o item, você pode associá-lo ao catálogo interno abaixo usando productId e matchConfidence. Essa associação é parte da identificação primária e não é verificação redundante. Se nenhum corresponder, deixe productId vazio.\nCatálogo interno:\n${cat}`
      : "Não há catálogo interno para associação: deixe productId vazio e matchConfidence 0.",
  ].join("\n\n");
}

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
    items: s.items.slice(0, 20).map((it, ii) => {
      const b = Array.isArray(it.box_2d) && it.box_2d.length === 4 ? it.box_2d.map((n) => clamp(Number(n) || 0, 0, 1000)) : null;
      const box = b && b[2] > b[0] && b[3] > b[1]
        ? { x: +(b[1] / 10).toFixed(1), y: +(b[0] / 10).toFixed(1), w: +((b[3] - b[1]) / 10).toFixed(1), h: +((b[2] - b[0]) / 10).toFixed(1) } : null;
      const pid = ids.has(it.productId) ? it.productId : null;
      const aid = assetIds.has(it.assetId) ? it.assetId : null;
      return {
        key: `${si}-${ii}`, name: String(it.name || "Item").slice(0, 80), assetId: aid, brand: String(it.brand || "").slice(0, 120) || null, model: String(it.model || "").slice(0, 120) || null, category: String(it.category || "Outros").slice(0, 30),
        description: String(it.description || "").slice(0, 300), visibleText: String(it.visibleText || "").slice(0, 120),
        t: clamp(toSec(it.bestTime), s.start, s.end), box, productId: pid,
        confidence: pid ? clamp(Number(it.matchConfidence) || 0, 0, 1) : 0,
      };
    }),
  }));
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

async function analyze({ work, products, assets = [], mode = "DISCOVERY", categories = [], oneScene, actor, organizationId, durableJobId }) {
  const job = jobs[work.id] = { workId: work.id, durableJobId: durableJobId || null, mode, status: "rodando", step: "preparando", oneScene: !!oneScene, startedAt: store.now() };
  if (durableJobId && organizationId) await Promise.resolve(aiPipeline.startJob(organizationId, durableJobId));
  const step = (s) => { job.step = s; };
  try {
    const file = path.join(uploads.ROOT, work.video.replace(/^\/uploads\//, ""));
    if (!fs.existsSync(file)) throw new Error("Arquivo de vídeo da obra não encontrado.");
    job.model = await pickModel();
    const video = await uploadVideo(file, step);
    step("o Gemini está assistindo ao vídeo e identificando os itens");
    let genData;
    try {
      const resp = await api(`/v1beta/models/${encodeURIComponent(job.model)}:generateContent`, {
        method: "POST",
        body: {
          contents: [{ role: "user", parts: [{ file_data: { file_uri: video.uri, mime_type: video.mimeType } }, { text: buildPrompt({ work, products, assets, mode, categories, oneScene }) }] }],
          generationConfig: { responseMimeType: "application/json", responseSchema: SCHEMA, temperature: 0.2 },
        },
      });
      genData = resp.data;
    } catch (err) {
      if (/not found|not supported/i.test(err.message)) {
        console.warn(`[ai] Modelo ${job.model} não encontrado. Selecionando automaticamente o melhor modelo disponível...`);
        job.model = await pickModel(true);
        const resp = await api(`/v1beta/models/${encodeURIComponent(job.model)}:generateContent`, {
          method: "POST",
          body: {
            contents: [{ role: "user", parts: [{ file_data: { file_uri: video.uri, mime_type: video.mimeType } }, { text: buildPrompt({ work, products, assets, mode, categories, oneScene }) }] }],
            generationConfig: { responseMimeType: "application/json", responseSchema: SCHEMA, temperature: 0.2 },
          },
        });
        genData = resp.data;
      } else {
        throw err;
      }
    }
    const data = genData;
    const text = (((data.candidates || [])[0] || {}).content || { parts: [] }).parts.map((p) => p.text || "").join("");
    let raw;
    try { raw = JSON.parse(text); } catch (e) { throw new Error("O Gemini respondeu em um formato inesperado. Tente de novo."); }
    job.scenes = normalize(raw, { work, products, assets });
    job.usage = data.usageMetadata || null;
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
    res.json(out);
  }));
  r.get("/api/ai/operator-flags", requireRole(), orgAccess.requireCapability("CONTENT_READ"), asyncRoute(async (req,res) => {
    res.json(await Promise.resolve(aiPipeline.listOperatorFlags(req.organization.id, req.query.status||'OPEN')));
  }));
  r.post("/api/ai/operator-flags/:id/resolve", requireRole(), orgAccess.requireCapability("AI_RUN"), asyncRoute(async (req,res) => {
    const out=await Promise.resolve(aiPipeline.resolveOperatorFlag(req.organization.id, req.params.id, req.body||{}, actor(req)));
    if(out.error||out.errors)return res.status(out.code||400).json(out);
    res.json(out);
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
    const created=await Promise.resolve(aiPipeline.createJob(req.organization.id,w,{mode,assetIds,categories,scanDepth:body.scanDepth||"STANDARD",minimumConfidence:body.minimumConfidence,includeBackground:body.includeBackground,minimumScreenSeconds:body.minimumScreenSeconds,primaryProvider:"SCENESHOP_GEMINI"},actor(req)));
    if(created.error||created.errors)return res.status(created.code||400).json(created);
    const assets=(await Promise.resolve(aiPipeline.listAssets(req.organization.id))).filter(a=>assetIds.includes(a.id));
    const products = content
      ? await Promise.resolve(content.listProductsByOrganizationAuthoritative(req.organization.id))
      : Object.values(store.state.userProducts || {}).filter((p) => p.organizationId === req.organization.id);
    analyze({ work: w, products, assets, mode, categories, oneScene: !!body.oneScene, actor: actor(req), organizationId:req.organization.id, durableJobId:created.job.id });
    res.status(202).json({...jobs[w.id], analysisJob:created.job});
  }));

  r.get("/api/works/:id/ai", requireRole(), orgAccess.requireCapability("CONTENT_READ"), asyncRoute(async (req, res) => {
    const w = await ownWork(req, res);
    if (!w) return;
    res.json(getJob(w.id) || { status: "nenhum" });
  }));

  return r;
}

module.exports = { routes, normalize, buildPrompt, pickModel, SCHEMA, _reset: () => { modelCache = null; for (const k in jobs) delete jobs[k]; } };
