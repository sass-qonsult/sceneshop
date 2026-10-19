/**
 * SceneShop ID — reconhecimento próprio pelo som (substitui a ACRCloud).
 *
 * Como todo conteúdo reconhecível passa pelo Studio, o SceneShop indexa o áudio de cada obra
 * no envio e o celular só precisa mandar ~10 s gravados do ambiente.
 *
 * Método (impressão digital por "marcos" do espectrograma, o mesmo princípio do Shazam):
 *   1. Áudio mono a 8 kHz → espectrograma (janela 1024 = 128 ms, passo 256 = 32 ms).
 *   2. Picos: pontos que são o máximo da vizinhança em frequência e em tempo (resistem a ruído,
 *      volume, eco e alto-falante ruim, porque o pico continua sendo pico).
 *   3. Pares: cada pico "âncora" se liga aos próximos picos à frente; o hash é
 *      (frequência da âncora, frequência do alvo, distância no tempo), 22 bits.
 *   4. Busca: os hashes da gravação são procurados no índice de cada obra; quem acerta muitos
 *      hashes com a MESMA diferença de tempo é a obra, e essa diferença é a posição.
 *
 * Índice: um arquivo por obra em data/uploads/audioid/<obra>.ssid (hashes ordenados + tempos),
 * carregado sob demanda na memória (~9 MB por hora de áudio no disco; um pouco mais na memória). O áudio do espectador não é guardado.
 */
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { spawn, spawnSync } = require("child_process");
const express = require("express");
const uploads = require("./uploads");
const orgAccess = require("./organizations");

const RATE = 8000, N = 1024, HOP = 256, BINS = N / 2;
const FRAME_SECONDS = HOP / RATE;                 // 32 ms
const FREQ_RADIUS = 12, TIME_RADIUS = 7;          // vizinhança do pico: ±94 Hz × ±224 ms
const MIN_BIN = 5, MAX_BIN = 480;                // ~40 Hz a ~3,75 kHz
// faixas de frequência: cada uma contribui com os próprios picos (ruído forte numa faixa não "rouba" as outras)
const BANDS = [[5, 40], [40, 80], [80, 140], [140, 230], [230, 340], [340, 480]];
const envNum = (k, d) => (process.env[k] ? Number(process.env[k]) : d);
const INDEX = { perBand: envNum("SSID_INDEX_PER_BAND", 2), fanOut: envNum("SSID_INDEX_FAN", 10) };   // índice da obra: enxuto
const QUERY = { perBand: envNum("SSID_QUERY_PER_BAND", 5), fanOut: envNum("SSID_QUERY_FAN", 24) };  // gravação: mais densa, para achar os picos do índice mesmo com ruído
const MAX_DT = 63, MIN_DT = 1;
const VERSION = 2;
const DIR = path.join(uploads.ROOT, "audioid");

// ------------------------------------------------------------------ FFT (radix-2, in-place)
const HANN = Float64Array.from({ length: N }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1)));
const REV = (() => { const r = new Uint32Array(N); const bits = Math.log2(N); for (let i = 0; i < N; i++) { let x = i, y = 0; for (let b = 0; b < bits; b++) { y = (y << 1) | (x & 1); x >>= 1; } r[i] = y; } return r; })();
const COS = Float64Array.from({ length: N / 2 }, (_, i) => Math.cos((-2 * Math.PI * i) / N));
const SIN = Float64Array.from({ length: N / 2 }, (_, i) => Math.sin((-2 * Math.PI * i) / N));
function fft(re, im) {
  for (let i = 0; i < N; i++) { const j = REV[i]; if (j > i) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
  for (let size = 2; size <= N; size <<= 1) {
    const half = size >> 1, step = N / size;
    for (let start = 0; start < N; start += size) {
      for (let k = 0; k < half; k++) {
        const c = COS[k * step], s = SIN[k * step], a = start + k, b = a + half;
        const tr = re[b] * c - im[b] * s, ti = re[b] * s + im[b] * c;
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
      }
    }
  }
}

/** Espectrograma em log-magnitude: Float32Array[frames * BINS]. */
function spectrogram(pcm) {
  const frames = pcm.length >= N ? Math.floor((pcm.length - N) / HOP) + 1 : 0;
  const out = new Float32Array(frames * BINS);
  const re = new Float64Array(N), im = new Float64Array(N);
  for (let f = 0; f < frames; f++) {
    const o = f * HOP;
    for (let i = 0; i < N; i++) { re[i] = pcm[o + i] * HANN[i]; im[i] = 0; }
    fft(re, im);
    const row = f * BINS;
    for (let b = 0; b < BINS; b++) out[row + b] = Math.log1p(Math.hypot(re[b], im[b]) * 64);
  }
  return { spec: out, frames };
}

/** Picos do espectrograma: [{t, f}] ordenados por tempo. */
function peaks({ spec, frames }, perBand = INDEX.perBand) {
  const out = [];
  for (let t = 0; t < frames; t++) {
    const row = t * BINS;
    let mean = 0; for (let b = MIN_BIN; b < MAX_BIN; b++) mean += spec[row + b]; mean /= (MAX_BIN - MIN_BIN);
    if (mean < 0.02) continue; // silêncio
    for (const [lo, hi] of BANDS) {
      const local = [];
      for (let b = lo; b < hi; b++) {
        const v = spec[row + b];
        if (v < mean) continue;
        let isMax = true;
        for (let k = Math.max(MIN_BIN, b - FREQ_RADIUS); k <= Math.min(MAX_BIN - 1, b + FREQ_RADIUS) && isMax; k++) if (spec[row + k] > v || (spec[row + k] === v && k < b)) isMax = false;
        if (!isMax) continue;
        // também máximo no tempo (±224 ms), numa faixa estreita de frequência
        for (let dt = -TIME_RADIUS; dt <= TIME_RADIUS && isMax; dt++) {
          const tt = t + dt; if (dt === 0 || tt < 0 || tt >= frames) continue;
          const r2 = tt * BINS;
          for (let df = -2; df <= 2; df++) { const f = b + df; if (f >= 0 && f < BINS && spec[r2 + f] > v) { isMax = false; break; } }
        }
        if (isMax) local.push({ b, v });
      }
      local.sort((x, y) => y.v - x.v);
      for (const p of local.slice(0, perBand)) out.push({ t, f: p.b });
    }
  }
  return out;
}

/** Pares de picos → hashes. Retorna { hashes: Uint32Array, times: Uint32Array } na ordem do tempo. */
function landmarks(pcm, opts = INDEX) {
  const pk = peaks(spectrogram(pcm), opts.perBand);
  const H = [], T = [];
  for (let i = 0; i < pk.length; i++) {
    const a = pk[i]; let n = 0;
    for (let j = i + 1; j < pk.length && n < opts.fanOut; j++) {
      const b = pk[j], dt = b.t - a.t;
      if (dt < MIN_DT) continue;
      if (dt > MAX_DT) break;
      H.push((((a.f >> 1) & 0xff) << 14) | (((b.f >> 1) & 0xff) << 6) | (dt & 0x3f));
      T.push(a.t); n++;
    }
  }
  return { hashes: Uint32Array.from(H), times: Uint32Array.from(T), peaks: pk.length };
}

// ------------------------------------------------------------------ índice por obra
function sortIndex({ hashes, times }) {
  const order = Array.from(hashes.keys()).sort((x, y) => hashes[x] - hashes[y] || times[x] - times[y]);
  return { hashes: Uint32Array.from(order, (i) => hashes[i]), times: Uint32Array.from(order, (i) => times[i]) };
}
const fileFor = (workId) => path.join(DIR, `${String(workId).replace(/[^A-Za-z0-9_-]/g, "_")}.ssid`);
function writeIndex(workId, idx, meta) {
  fs.mkdirSync(DIR, { recursive: true });
  const head = Buffer.from(JSON.stringify({ v: VERSION, workId, count: idx.hashes.length, ...meta }));
  const len = Buffer.alloc(4); len.writeUInt32LE(head.length, 0);
  const tmp = fileFor(workId) + ".tmp";
  fs.writeFileSync(tmp, Buffer.concat([Buffer.from("SSID"), len, head, Buffer.from(idx.hashes.buffer), Buffer.from(idx.times.buffer)]));
  fs.renameSync(tmp, fileFor(workId));
}
function readIndex(file) {
  const buf = fs.readFileSync(file);
  if (buf.toString("latin1", 0, 4) !== "SSID") return null;
  const hl = buf.readUInt32LE(4), meta = JSON.parse(buf.toString("utf8", 8, 8 + hl));
  if (meta.v !== VERSION) return null;
  const off = 8 + hl, n = meta.count;
  const copy = Buffer.from(buf.subarray(off, off + n * 8)); // alinha os arrays
  return { meta, hashes: new Uint32Array(copy.buffer, copy.byteOffset, n), times: new Uint32Array(copy.buffer, copy.byteOffset + n * 4, n) };
}

const cache = new Map(); // workId -> { meta, hashes, times, mtime }
function loadAll() {
  if (!fs.existsSync(DIR)) return [];
  const out = [];
  for (const name of fs.readdirSync(DIR)) {
    if (!name.endsWith(".ssid")) continue;
    const file = path.join(DIR, name), mtime = fs.statSync(file).mtimeMs;
    const key = name.slice(0, -5);
    let c = cache.get(key);
    if (!c || c.mtime !== mtime) { const idx = readIndex(file); if (!idx) continue; c = { ...idx, mtime }; cache.set(key, c); }
    out.push(c);
  }
  return out;
}

function lowerBound(arr, x) { let lo = 0, hi = arr.length; while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m] < x) lo = m + 1; else hi = m; } return lo; }

/**
 * Reconhece um trecho (PCM 8 kHz). Retorna as obras por pontuação:
 * [{ workId, score, sidelobe, offsetSeconds (início do trecho na obra) }]
 * score = votos na melhor diferença de tempo; sidelobe = votos na segunda melhor, longe dela
 * (casamento verdadeiro concentra os votos num único ponto; coincidências se espalham).
 */
// Índice unificado (todas as obras num só vetor ordenado por hash): uma busca binária por hash,
// qualquer que seja o tamanho do catálogo.
let merged = null;
function mergeIndexes(list) {
  const total = list.reduce((n, i) => n + i.hashes.length, 0);
  // chave = hash × 2^31 + posição na concatenação (exata em float64): um sort nativo resolve tudo
  const keys = new Float64Array(total), srcW = new Uint16Array(total), srcT = new Uint32Array(total);
  let o = 0;
  list.forEach((idx, w) => { for (let p = 0; p < idx.hashes.length; p++, o++) { keys[o] = idx.hashes[p] * 2147483648 + o; srcW[o] = w; srcT[o] = idx.times[p]; } });
  keys.sort();
  const hashes = new Uint32Array(total), times = new Uint32Array(total), works = new Uint16Array(total);
  for (let i = 0; i < total; i++) { const k = keys[i], pos = k % 2147483648; hashes[i] = (k - pos) / 2147483648; times[i] = srcT[pos]; works[i] = srcW[pos]; }
  return { list, hashes, times, works };
}
function mergedFor(list) {
  if (merged && merged.list.length === list.length && merged.list.every((x, i) => x === list[i])) return merged;
  merged = mergeIndexes(list);
  return merged;
}

function match(pcm, { only = null, indexes = null } = {}) {
  const q = landmarks(pcm, QUERY);
  if (q.hashes.length < 20) return { matches: [], queryHashes: q.hashes.length };
  const list = indexes || loadAll();
  if (!list.length) return { matches: [], queryHashes: q.hashes.length };
  const m = mergedFor(list);
  const allowed = only ? new Set(list.map((x, i) => (only.includes(x.meta.workId) ? i : -1)).filter((i) => i >= 0)) : null;
  const votes = new Map(); // chave: obra * 2^24 + (diferença + 2^23)
  for (let i = 0; i < q.hashes.length; i++) {
    const h = q.hashes[i];
    for (let k = lowerBound(m.hashes, h); k < m.hashes.length && m.hashes[k] === h; k++) {
      const w = m.works[k]; if (allowed && !allowed.has(w)) continue;
      const key = w * 16777216 + (m.times[k] - q.times[i] + 8388608);
      votes.set(key, (votes.get(key) || 0) + 1);
    }
  }
  const perWork = new Map(); // obra -> [[diferença, votos]]
  for (const [key, n] of votes) {
    const s = n + (votes.get(key - 1) || 0) + (votes.get(key + 1) || 0);
    const w = Math.floor(key / 16777216), off = (key % 16777216) - 8388608;
    if (!perWork.has(w)) perWork.set(w, []);
    perWork.get(w).push([off, s]);
  }
  const results = [];
  for (const [w, arr] of perWork) {
    arr.sort((a, b) => b[1] - a[1]);
    const [bestOff, best] = arr[0];
    const side = (arr.find(([o]) => Math.abs(o - bestOff) > 3) || [0, 0])[1];
    results.push({ workId: list[w].meta.workId, score: best, sidelobe: side, offsetFrames: bestOff });
  }
  results.sort((a, b) => b.score - a.score);
  return {
    queryHashes: q.hashes.length,
    matches: results.map((r) => ({ workId: r.workId, score: r.score, sidelobe: r.sidelobe, offsetSeconds: Math.max(0, r.offsetFrames * FRAME_SECONDS) })),
  };
}

/** Decisão: votos suficientes, pico claro dentro da obra e folga sobre a segunda obra. */
const MIN_SCORE = Number(process.env.SCENESHOP_AUDIO_ID_MIN_SCORE || 12);
function decide(result) {
  const [a, b] = result.matches;
  if (!a || a.score < MIN_SCORE) return null;
  const rival = Math.max(a.sidelobe || 0, b ? b.score : 0);
  if (a.score < rival * 2.5 + 4) return null;
  return { ...a, confidence: Math.min(1, (a.score - rival) / (a.score + 10)) };
}

// ------------------------------------------------------------------ áudio
function decodeFile(file) {
  return new Promise((resolve, reject) => {
    const ff = spawn("ffmpeg", ["-v", "error", "-i", file, "-vn", "-ac", "1", "-ar", String(RATE), "-f", "f32le", "pipe:1"], { stdio: ["ignore", "pipe", "pipe"] });
    const chunks = []; let err = "";
    ff.stdout.on("data", (d) => chunks.push(d));
    ff.stderr.on("data", (d) => { err = (err + d).slice(-500); });
    ff.on("error", reject);
    ff.on("close", (code) => {
      if (code !== 0) return reject(new Error(err.trim() || `ffmpeg ${code}`));
      const buf = Buffer.concat(chunks);
      resolve(new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.length / 4)).slice());
    });
  });
}

/** WAV PCM 16-bit (o app manda mono 8 kHz); outras taxas são reamostradas. */
function decodeWav(buf) {
  if (buf.length < 44 || buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") throw Object.assign(new Error("Áudio deve ser WAV PCM."), { code: 400 });
  let p = 12, fmt = null, data = null;
  while (p + 8 <= buf.length) {
    const id = buf.toString("ascii", p, p + 4), size = buf.readUInt32LE(p + 4);
    if (id === "fmt ") fmt = { channels: buf.readUInt16LE(p + 10), rate: buf.readUInt32LE(p + 12), bits: buf.readUInt16LE(p + 22), format: buf.readUInt16LE(p + 8) };
    if (id === "data") { data = buf.subarray(p + 8, Math.min(buf.length, p + 8 + size)); break; }
    p += 8 + size + (size & 1);
  }
  if (!fmt || !data || fmt.format !== 1 || fmt.bits !== 16) throw Object.assign(new Error("Áudio deve ser WAV PCM 16-bit."), { code: 400 });
  const n = Math.floor(data.length / 2 / fmt.channels), mono = new Float32Array(n);
  for (let i = 0; i < n; i++) { let s = 0; for (let c = 0; c < fmt.channels; c++) s += data.readInt16LE((i * fmt.channels + c) * 2); mono[i] = s / fmt.channels / 32768; }
  if (fmt.rate === RATE) return mono;
  const ratio = fmt.rate / RATE, m = Math.floor(n / ratio), out = new Float32Array(m);
  for (let i = 0; i < m; i++) { const a = Math.floor(i * ratio), b = Math.min(n, Math.floor((i + 1) * ratio)); let s = 0; for (let j = a; j < b; j++) s += mono[j]; out[i] = b > a ? s / (b - a) : mono[a] || 0; }
  return out;
}

// ------------------------------------------------------------------ indexação das obras
const jobs = new Map(); // workId -> { state, error, at }
const hasFfmpeg = () => { const r = spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }); return !r.error && r.status === 0; };
function videoPath(work) {
  if (!work || !String(work.video || "").startsWith("/uploads/")) return null;
  const p = path.join(uploads.ROOT, String(work.video).replace(/^\/uploads\//, ""));
  return p.startsWith(uploads.ROOT) && fs.existsSync(p) ? p : null;
}

let queue = Promise.resolve();
function indexWork(work) {
  const src = videoPath(work);
  if (!src) return Promise.resolve({ error: "A obra precisa ter um vídeo enviado pelo estúdio.", code: 400 });
  if (!hasFfmpeg()) return Promise.resolve({ error: "O servidor precisa do ffmpeg para indexar o som.", code: 503 });
  jobs.set(work.id, { state: "indexing", at: Date.now() });
  const run = async () => {
    const started = Date.now();
    try {
      const pcm = await decodeFile(src);
      const lm = landmarks(pcm);
      const idx = sortIndex(lm);
      const sha = crypto.createHash("sha256").update(fs.readFileSync(src)).digest("hex");
      writeIndex(work.id, idx, { duration: pcm.length / RATE, peaks: lm.peaks, source: path.basename(src), sourceSha256: sha, builtAt: Date.now(), seconds: (Date.now() - started) / 1000 });
      jobs.delete(work.id);
      return { ok: true, hashes: idx.hashes.length };
    } catch (e) {
      jobs.set(work.id, { state: "error", error: String(e.message).slice(0, 200), at: Date.now() });
      return { error: e.message, code: 500 };
    }
  };
  const p = queue.then(run, run); queue = p.catch(() => {});
  return p;
}
function autoIndex(work) { if (work && videoPath(work) && hasFfmpeg()) indexWork(work).then((r) => { if (r && r.error) console.error(`[audio-id] ${work.id}: ${r.error}`); }); }

function status(work) {
  const j = jobs.get(work.id);
  if (j && j.state === "indexing") return { state: "indexing", since: j.at };
  const file = fileFor(work.id);
  if (fs.existsSync(file)) { const idx = readIndex(file); if (idx) return { state: "ready", hashes: idx.meta.count, duration: idx.meta.duration, builtAt: idx.meta.builtAt }; }
  if (j && j.state === "error") return { state: "error", error: j.error };
  return { state: "not_indexed" };
}

/** Na subida do servidor: indexa obras enviadas que ainda não têm índice. */
async function indexMissing(listWorks) {
  if (!hasFfmpeg()) return;
  try {
    for (const w of (await Promise.resolve(listWorks())) || []) if (videoPath(w) && !fs.existsSync(fileFor(w.id))) await indexWork(w);
  } catch (e) { console.error("[audio-id] indexação inicial:", e.message); }
}

/** Reconhece a gravação do celular (WAV). */
function recognizeWav(buf, opts) {
  const pcm = decodeWav(buf);
  if (pcm.length < RATE * 2) throw Object.assign(new Error("SYNC_SAMPLE_TOO_SHORT"), { code: 400 });
  const started = Date.now();
  const r = match(pcm, opts);
  const best = decide(r);
  return { best, result: r, sampleSeconds: pcm.length / RATE, latencySeconds: (Date.now() - started) / 1000 };
}

function routes({ requireRole, content }) {
  const r = express.Router();
  const ownWork = async (req, res) => {
    const w = await Promise.resolve(content.getWorkForOrganizationAuthoritative(req.params.id, req.organization.id));
    if (!w) res.status(404).json({ error: "Obra não encontrada nesta organização." });
    return w;
  };
  r.get("/api/audio-id/works/:id", requireRole(), orgAccess.requireCapability("CONTENT_READ"), async (req, res, next) => {
    try { const w = await ownWork(req, res); if (w) res.json({ workId: w.id, engine: "sceneshop", ...status(w) }); } catch (e) { next(e); }
  });
  r.post("/api/audio-id/works/:id/index", requireRole(), orgAccess.requireCapability("CONTENT_WRITE"), async (req, res, next) => {
    try { const w = await ownWork(req, res); if (!w) return; indexWork(w); res.status(202).json({ workId: w.id, state: "indexing" }); } catch (e) { next(e); }
  });
  return r;
}

module.exports = { INDEX, QUERY, RATE, FRAME_SECONDS, spectrogram, peaks, landmarks, sortIndex, match, decide, decodeWav, decodeFile, indexWork, autoIndex, indexMissing, status, recognizeWav, routes, writeIndex, readIndex, loadAll, _cache: cache, DIR };
