/**
 * Selo "SceneShop compatible" gravado no vídeo (como o Dolby Atmos ou o CC na abertura).
 *
 * O estúdio gera uma cópia da obra com o selo nos primeiros segundos, para publicar no YouTube,
 * TikTok, TV ou cinema. O áudio é copiado sem alteração sempre que possível: é pelo som que o
 * celular reconhece a obra (ACRCloud), então a cópia com selo continua sendo reconhecida.
 *
 *   POST /api/works/:id/branded   { style: "corner" | "intro", seconds: 3..8 }
 *   GET  /api/works/:id/branded   -> { state, url, progress, error }
 */
"use strict";
const fs = require("fs");
const path = require("path");
const { spawn, spawnSync } = require("child_process");
const express = require("express");
const uploads = require("./uploads");
const audit = require("./audit");
const orgAccess = require("./organizations");

const BADGE = path.join(__dirname, "..", "public", "media", "brand", "sceneshop-compatible.png");
const jobs = new Map(); // workId -> { state, url, progress, error, style, at }

const hasFfmpeg = () => { const r = spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }); return !r.error && r.status === 0; };

function probe(file) {
  const r = spawnSync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_type,codec_name,width,height:format=duration", "-of", "json", file], { encoding: "utf8", timeout: 60000 });
  if (r.status !== 0) return null;
  try {
    const j = JSON.parse(r.stdout);
    const v = (j.streams || []).find((s) => s.codec_type === "video") || {};
    const a = (j.streams || []).find((s) => s.codec_type === "audio") || null;
    return { width: Number(v.width) || 1280, height: Number(v.height) || 720, audio: a ? a.codec_name : null, duration: Number((j.format || {}).duration) || 0 };
  } catch (e) { return null; }
}

/** Monta o filtro: selo com fade de entrada e saída, no canto (superior direito) ou centralizado (abertura). */
function filterFor({ width, height }, { style, seconds }) {
  const intro = style === "intro";
  const bw = Math.round(width * (intro ? 0.46 : 0.26) / 2) * 2;
  const margin = Math.round(width * 0.03);
  const x = intro ? "(main_w-overlay_w)/2" : `main_w-overlay_w-${margin}`;
  const y = intro ? "(main_h-overlay_h)/2" : `${Math.round(height * 0.035)}`;
  const s = Number(seconds), fadeOut = Math.max(0.8, s - 0.3);
  return `[1:v]format=rgba,scale=${bw}:-1,fade=t=in:st=0.3:d=0.5:alpha=1,fade=t=out:st=${fadeOut.toFixed(2)}:d=0.5:alpha=1[b];` +
    `[0:v][b]overlay=x=${x}:y=${y}:enable='lte(t,${(s + 0.4).toFixed(2)})',format=yuv420p[v]`;
}

function outputName(work, style) {
  const base = path.basename(String(work.video)).replace(/\.[^.]+$/, "");
  return `${base}-sceneshop-${style}.mp4`;
}

function start(work, { style = "corner", seconds = 4 } = {}, actorName = "sistema") {
  if (!hasFfmpeg()) return { error: "O servidor não tem o ffmpeg instalado (a imagem Docker da rcprep.9 já inclui).", code: 503 };
  if (!work || !String(work.video || "").startsWith("/uploads/")) return { error: "A obra precisa ter um vídeo enviado pelo estúdio.", code: 400 };
  const cur = jobs.get(work.id);
  if (cur && cur.state === "running") return { ...cur };
  style = style === "intro" ? "intro" : "corner";
  seconds = Math.max(3, Math.min(8, Number(seconds) || 4));
  const src = path.join(uploads.ROOT, String(work.video).replace(/^\/uploads\//, ""));
  if (!src.startsWith(uploads.ROOT) || !fs.existsSync(src)) return { error: "Arquivo de vídeo da obra não encontrado.", code: 404 };
  const info = probe(src) || { width: 1280, height: 720, audio: null, duration: 0 };
  const name = outputName(work, style);
  const out = path.join(uploads.ROOT, "videos", name);
  const tmp = out + ".part.mp4";
  // AAC já pode ir direto para o MP4 (áudio idêntico ao original); outros formatos viram AAC de alta qualidade.
  const audioArgs = !info.audio ? ["-an"] : info.audio === "aac" ? ["-c:a", "copy"] : ["-c:a", "aac", "-b:a", "256k"];
  const args = ["-v", "error", "-y", "-i", src, "-loop", "1", "-t", String(seconds + 1), "-i", BADGE,
    "-filter_complex", filterFor(info, { style, seconds }), "-map", "[v]", "-map", "0:a?",
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", ...audioArgs, "-movflags", "+faststart",
    "-progress", "pipe:1", "-nostats", tmp];
  const job = { state: "running", progress: 0, style, seconds, url: null, error: null, at: Date.now(), audioCopied: info.audio === "aac" };
  jobs.set(work.id, job);
  const p = spawn("ffmpeg", args, { stdio: ["ignore", "pipe", "pipe"] });
  let err = "";
  p.stdout.on("data", (b) => {
    const m = /out_time_ms=(\d+)/.exec(String(b));
    if (m && info.duration) job.progress = Math.min(0.99, Number(m[1]) / 1e6 / info.duration);
  });
  p.stderr.on("data", (b) => { err = (err + String(b)).slice(-2000); });
  p.on("close", (code) => {
    if (code === 0 && fs.existsSync(tmp)) {
      fs.renameSync(tmp, out);
      Object.assign(job, { state: "ready", progress: 1, url: `/uploads/videos/${name}` });
      audit.log(actorName, "video_com_selo_gerado", { workId: work.id, style, seconds, audio: info.audio === "aac" ? "copiado" : info.audio ? "aac" : "sem áudio" });
    } else {
      try { fs.unlinkSync(tmp); } catch (e) {}
      Object.assign(job, { state: "error", error: (err.trim().split("\n").pop() || `ffmpeg terminou com código ${code}`).slice(0, 300) });
    }
  });
  return { ...job };
}

function status(work) {
  const job = jobs.get(work.id);
  if (job) return { ...job };
  // geradas antes (ex.: depois de reiniciar o servidor)
  for (const style of ["corner", "intro"]) {
    const name = outputName(work, style);
    if (fs.existsSync(path.join(uploads.ROOT, "videos", name))) return { state: "ready", style, progress: 1, url: `/uploads/videos/${name}` };
  }
  return { state: "none", available: hasFfmpeg() };
}

function routes({ requireRole, content, actor }) {
  const r = express.Router();
  const ownWork = async (req, res) => {
    const w = await Promise.resolve(content.getWorkForOrganizationAuthoritative(req.params.id, req.organization.id));
    if (!w) res.status(404).json({ error: "Obra não encontrada nesta organização." });
    return w;
  };
  r.get("/api/works/:id/branded", requireRole(), orgAccess.requireCapability("CONTENT_READ"), async (req, res, next) => {
    try { const w = await ownWork(req, res); if (w) res.json(status(w)); } catch (e) { next(e); }
  });
  r.post("/api/works/:id/branded", requireRole(), orgAccess.requireCapability("CONTENT_WRITE"), async (req, res, next) => {
    try {
      const w = await ownWork(req, res); if (!w) return;
      const out = start(w, req.body || {}, actor(req));
      if (out.error) return res.status(out.code || 400).json({ error: out.error });
      res.status(202).json(out);
    } catch (e) { next(e); }
  });
  return r;
}

module.exports = { routes, start, status, filterFor, _jobs: jobs };
