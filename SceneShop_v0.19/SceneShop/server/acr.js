/**
 * Reconhecimento automático de conteúdo (ACR) com a ACRCloud.
 *
 * - Cadastro: cada obra enviada pelo estúdio vai para um "bucket" de Áudio & Vídeo da ACRCloud,
 *   com o id da obra em user_defined (sceneshop_work_id). A ACRCloud gera a impressão digital.
 * - Identificação: o celular grava ~10 s do que está tocando e manda ao SceneShop; o servidor
 *   assina o pedido e consulta a ACRCloud, que devolve a obra e a posição (play_offset_ms).
 *   O áudio não é guardado em disco nem em banco.
 *
 * Configuração (variáveis de ambiente ou sceneshop.env):
 *   ACRCLOUD_HOST            host do projeto de reconhecimento (ex.: identify-eu-west-1.acrcloud.com)
 *   ACRCLOUD_ACCESS_KEY      access_key do projeto
 *   ACRCLOUD_ACCESS_SECRET   access_secret do projeto
 *   ACRCLOUD_BUCKET_ID       id do bucket de Áudio & Vídeo ligado ao projeto
 *   ACRCLOUD_CONSOLE_TOKEN   token da Console API (console.acrcloud.com → Account → Developer)
 *   ACRCLOUD_CONSOLE_URL     opcional; padrão: a região do host (identify-eu-west-1 -> api-eu-west-1.acrcloud.com)
 */
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");
const express = require("express");
const audit = require("./audit");
const uploads = require("./uploads");
const orgAccess = require("./organizations");

const env = (k) => String(process.env[k] || "").trim();
const cfg = () => ({
  host: env("ACRCLOUD_HOST"),
  accessKey: env("ACRCLOUD_ACCESS_KEY"),
  accessSecret: env("ACRCLOUD_ACCESS_SECRET"),
  bucketId: env("ACRCLOUD_BUCKET_ID"),
  token: env("ACRCLOUD_CONSOLE_TOKEN"),
  consoleUrl: (env("ACRCLOUD_CONSOLE_URL") || consoleFromHost(env("ACRCLOUD_HOST"))).replace(/\/$/, ""),
});
/** O bucket fica na mesma região do projeto: identify-eu-west-1.acrcloud.com -> api-eu-west-1.acrcloud.com. */
function consoleFromHost(host) {
  const m = /^(?:https?:\/\/)?identify-([a-z0-9-]+)\.acrcloud\.com\/?$/i.exec(host || "");
  return m ? `https://api-${m[1].toLowerCase()}.acrcloud.com` : "https://api-v2.acrcloud.com";
}
const identifyConfigured = () => { const c = cfg(); return !!(c.host && c.accessKey && c.accessSecret); };
const registryConfigured = () => { const c = cfg(); return !!(c.token && c.bucketId); };
const TITLE_PREFIX = "sceneshop:";

// ------------------------------------------------------------------ identificação
function identifyUrl(host) {
  const base = /^https?:\/\//i.test(host) ? host : `https://${host}`;
  return `${base.replace(/\/$/, "")}/v1/identify`;
}
/** String assinada: método, URI, access_key, data_type, signature_version e timestamp, separados por \n (HMAC-SHA1, base64). */
function sign({ accessKey, accessSecret, dataType = "audio", timestamp }) {
  const toSign = ["POST", "/v1/identify", accessKey, dataType, "1", String(timestamp)].join("\n");
  return crypto.createHmac("sha1", accessSecret).update(toSign, "utf8").digest("base64");
}

/** Lê a resposta da ACRCloud e devolve as obras do SceneShop reconhecidas, da maior para a menor nota. */
function parseIdentifyResponse(body) {
  const status = (body && body.status) || {};
  if (Number(status.code) === 1001) return { matches: [] };           // sem resultado
  if (Number(status.code) !== 0) {
    const err = new Error(`ACRCloud: ${status.msg || "falha na identificação"} (código ${status.code})`);
    err.acrCode = status.code; throw err;
  }
  const files = (body.metadata && body.metadata.custom_files) || [];
  const matches = [];
  for (const f of files) {
    const ud = typeof f.user_defined === "object" && f.user_defined ? f.user_defined : {};
    let workId = f.sceneshop_work_id || ud.sceneshop_work_id || null;
    if (!workId && typeof f.title === "string" && f.title.startsWith(TITLE_PREFIX)) workId = f.title.slice(TITLE_PREFIX.length).split(/\s/)[0];
    if (!workId) continue;
    const offsetMs = Number(f.play_offset_ms != null ? f.play_offset_ms : f.db_end_time_offset_ms);
    matches.push({
      workId: String(workId), acrid: f.acrid || null,
      offsetSeconds: Number.isFinite(offsetMs) ? offsetMs / 1000 : null,
      score: Number.isFinite(Number(f.score)) ? Number(f.score) : 100,
    });
  }
  matches.sort((a, b) => b.score - a.score);
  return { matches };
}

async function identify(sample, mime = "audio/wav") {
  const c = cfg();
  if (!identifyConfigured()) { const e = new Error("Reconhecimento por áudio (ACRCloud) não configurado."); e.code = 503; throw e; }
  const timestamp = Math.floor(Date.now() / 1000);
  const form = new FormData();
  form.append("sample", new Blob([sample], { type: mime }), mime === "audio/wav" ? "sample.wav" : "sample.bin");
  form.append("access_key", c.accessKey);
  form.append("sample_bytes", String(sample.length));
  form.append("timestamp", String(timestamp));
  form.append("signature", sign({ accessKey: c.accessKey, accessSecret: c.accessSecret, timestamp }));
  form.append("data_type", "audio");
  form.append("signature_version", "1");
  const started = Date.now();
  const res = await fetch(identifyUrl(c.host), { method: "POST", body: form, signal: AbortSignal.timeout(20000) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`ACRCloud respondeu ${res.status}.`);
  const out = parseIdentifyResponse(body);
  out.latencySeconds = (Date.now() - started) / 1000;
  return out;
}

// ------------------------------------------------------------------ cadastro das obras (Console API)
async function consoleApi(pathname, { method = "GET", body } = {}) {
  const c = cfg();
  const res = await fetch(`${c.consoleUrl}/api/buckets/${encodeURIComponent(c.bucketId)}${pathname}`, {
    method, body, headers: { Authorization: `Bearer ${c.token}`, Accept: "application/json" }, signal: AbortSignal.timeout(10 * 60 * 1000),
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (data && (data.message || data.error || (data.errors && JSON.stringify(data.errors)))) || res.statusText;
    throw new Error(`ACRCloud (console) ${res.status}: ${msg}`);
  }
  return data;
}
const STATE = { 0: "processing", 1: "ready", "-1": "error" };
const jobs = new Map(); // workId -> { state: 'uploading'|'error', error, at }

async function filesForWork(workId) {
  const data = await consoleApi(`/files?search=${encodeURIComponent(TITLE_PREFIX + workId)}&per_page=20`);
  const list = (data && data.data) || [];
  return list.filter((f) => {
    const ud = typeof f.user_defined === "string" ? safeJson(f.user_defined) : f.user_defined || {};
    return (ud && ud.sceneshop_work_id === workId) || String(f.title || "").startsWith(TITLE_PREFIX + workId + " ") || f.title === TITLE_PREFIX + workId;
  });
}
function safeJson(s) { try { return JSON.parse(s); } catch (e) { return {}; } }

async function status(workId) {
  if (!registryConfigured()) return { configured: false, state: "not_configured" };
  const job = jobs.get(workId);
  if (job && job.state === "uploading") return { configured: true, state: "uploading", since: job.at };
  const files = await filesForWork(workId);
  if (!files.length) return { configured: true, state: job && job.state === "error" ? "error" : "not_registered", error: job && job.error || null };
  const f = files[0];
  return { configured: true, state: STATE[String(f.state)] || "processing", acrid: f.acr_id || f.acrid || null, fileId: f.id, updatedAt: f.updated_at || null };
}

/** Extrai só o áudio (mono, 16 kHz) quando há ffmpeg; senão envia o vídeo original. */
function audioForUpload(videoPath) {
  const probe = spawnSync("ffmpeg", ["-version"], { stdio: "ignore" });
  if (probe.error || probe.status !== 0) return { file: videoPath, temp: false };
  const out = path.join(os.tmpdir(), `sceneshop-acr-${crypto.randomBytes(6).toString("hex")}.m4a`);
  const r = spawnSync("ffmpeg", ["-v", "error", "-y", "-i", videoPath, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "aac", "-b:a", "64k", out], { stdio: "ignore", timeout: 30 * 60 * 1000 });
  if (r.status === 0 && fs.existsSync(out) && fs.statSync(out).size > 1000) return { file: out, temp: true };
  try { fs.unlinkSync(out); } catch (e) {}
  return { file: videoPath, temp: false };
}

async function register(work, actorName = "sistema") {
  if (!registryConfigured()) throw Object.assign(new Error("Cadastro na ACRCloud não configurado (token e bucket)."), { code: 503 });
  if (!work || !work.video || !String(work.video).startsWith("/uploads/")) throw Object.assign(new Error("A obra precisa ter um vídeo enviado pelo estúdio."), { code: 400 });
  const videoPath = path.join(uploads.ROOT, String(work.video).replace(/^\/uploads\//, ""));
  if (!videoPath.startsWith(uploads.ROOT) || !fs.existsSync(videoPath)) throw Object.assign(new Error("Arquivo de vídeo da obra não encontrado."), { code: 404 });
  jobs.set(work.id, { state: "uploading", at: Date.now() });
  let src = null;
  try {
    for (const old of await filesForWork(work.id)) await consoleApi(`/files/${encodeURIComponent(old.id)}`, { method: "DELETE" });
    src = audioForUpload(videoPath);
    const blob = await fs.openAsBlob(src.file, { type: src.temp ? "audio/mp4" : "video/mp4" });
    const form = new FormData();
    form.append("file", blob, path.basename(src.file));
    form.append("data_type", "audio");
    form.append("title", `${TITLE_PREFIX}${work.id} ${String(work.title || "").slice(0, 80)}`.trim());
    form.append("user_defined", JSON.stringify({ sceneshop_work_id: work.id, sceneshop_sync_id: work.syncId || null }));
    const data = await consoleApi("/files", { method: "POST", body: form });
    jobs.delete(work.id);
    const f = (data && data.data) || {};
    audit.log(actorName, "acr_obra_cadastrada", { workId: work.id, fileId: f.id || null, acrid: f.acr_id || null, audioOnly: src.temp });
    return { state: STATE[String(f.state)] || "processing", fileId: f.id || null };
  } catch (e) {
    jobs.set(work.id, { state: "error", error: e.message, at: Date.now() });
    throw e;
  } finally {
    if (src && src.temp) fs.promises.unlink(src.file).catch(() => {});
  }
}
/** Cadastro em segundo plano, logo depois do envio da obra (não atrasa a resposta do estúdio). */
function autoRegister(work, actorName) {
  if (!registryConfigured() || !work) return;
  register(work, actorName).catch((e) => console.error(`[acr] cadastro da obra ${work.id} falhou: ${e.message}`));
}

// ------------------------------------------------------------------ rotas do estúdio
function routes({ requireRole, content }) {
  const r = express.Router();
  const ownWork = async (req, res) => {
    const w = await Promise.resolve(content.getWorkForOrganizationAuthoritative(req.params.id, req.organization.id));
    if (!w) res.status(404).json({ error: "Obra não encontrada nesta organização." });
    return w;
  };
  r.get("/api/acr/works/:id", requireRole(), orgAccess.requireCapability("CONTENT_READ"), async (req, res) => {
    try { const w = await ownWork(req, res); if (!w) return; res.json({ workId: w.id, identify: identifyConfigured(), ...(await status(w.id)) }); }
    catch (e) { res.status(502).json({ error: e.message }); }
  });
  r.post("/api/acr/works/:id/register", requireRole(), orgAccess.requireCapability("CONTENT_WRITE"), async (req, res) => {
    try {
      const w = await ownWork(req, res); if (!w) return;
      if (!registryConfigured()) return res.status(503).json({ error: "Configure a ACRCloud (token da Console API e bucket) para cadastrar as obras." });
      if ((jobs.get(w.id) || {}).state === "uploading") return res.status(202).json({ workId: w.id, state: "uploading" });
      register(w, req.user.username).catch(() => {});
      res.status(202).json({ workId: w.id, state: "uploading" });
    } catch (e) { res.status(e.code || 500).json({ error: e.message }); }
  });
  return r;
}

module.exports = { consoleFromHost, routes, identify, register, autoRegister, status, identifyConfigured, registryConfigured, sign, parseIdentifyResponse, identifyUrl, _jobs: jobs };
