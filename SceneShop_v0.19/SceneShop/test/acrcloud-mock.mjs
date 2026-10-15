// SIMULADOR da ACRCloud, só para testes automáticos (não é o serviço de verdade).
// Reproduz o que o SceneShop usa:
//   - Console API: POST/GET/DELETE /api/buckets/:id/files com "Authorization: Bearer <token>";
//   - Identificação: POST /v1/identify (multipart) com a assinatura HMAC-SHA1 conferida de verdade.
// "Reconhece" a última obra cadastrada quando a amostra tem som; amostra silenciosa = 1001 (sem resultado).
// Uso: node test/acrcloud-mock.mjs [porta]   (padrão 3997)
import http from "node:http";
import crypto from "node:crypto";

export const ACCESS_KEY = "mock-access-key";
export const ACCESS_SECRET = "mock-access-secret";
export const TOKEN = "mock-console-token";
export const BUCKET = "4242";
export const OFFSET_MS = 12000;
const PORT = Number(process.argv[2] || process.env.MOCK_PORT || 3997);

export const files = [];
export const identifyCalls = [];
let seq = 1;

function sign(timestamp) {
  const s = ["POST", "/v1/identify", ACCESS_KEY, "audio", "1", String(timestamp)].join("\n");
  return crypto.createHmac("sha1", ACCESS_SECRET).update(s).digest("base64");
}
function wavRms(buf) {
  // WAV PCM 16-bit: dados a partir do chunk "data"
  const i = buf.indexOf("data");
  if (buf.toString("ascii", 0, 4) !== "RIFF" || i < 0) return 1; // outros formatos: considera com som
  let sum = 0, n = 0;
  for (let o = i + 8; o + 1 < buf.length; o += 2) { const v = buf.readInt16LE(o) / 32768; sum += v * v; n++; }
  return n ? Math.sqrt(sum / n) : 0;
}
const json = (res, code, body) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
async function readForm(req) {
  const chunks = []; for await (const c of req) chunks.push(c);
  const body = Buffer.concat(chunks);
  return new Request("http://mock/", { method: "POST", headers: { "content-type": req.headers["content-type"] }, body }).formData();
}

async function handle(req, res) {
  const url = new URL(req.url, "http://mock");
  if (req.method === "POST" && url.pathname === "/v1/identify") {
    const f = await readForm(req);
    const ts = f.get("timestamp");
    const ok = f.get("access_key") === ACCESS_KEY && f.get("signature") === sign(ts) && f.get("signature_version") === "1" && f.get("data_type") === "audio";
    if (!ok) return json(res, 200, { status: { code: 3014, msg: "Invalid signature", version: "1.0" } });
    const sample = Buffer.from(await f.get("sample").arrayBuffer());
    identifyCalls.push({ bytes: sample.length, declared: Number(f.get("sample_bytes")) });
    const ready = files.filter((x) => x.state === 1);
    if (wavRms(sample) < 0.002 || !ready.length) return json(res, 200, { status: { code: 1001, msg: "No result", version: "1.0" } });
    const hit = ready[ready.length - 1];
    return json(res, 200, {
      status: { code: 0, msg: "Success", version: "1.0" }, result_type: 0,
      metadata: { timestamp_utc: new Date().toISOString(), custom_files: [{ bucket_id: BUCKET, title: hit.title, acrid: hit.acr_id, audio_id: "", play_offset_ms: OFFSET_MS, duration_ms: 120000, score: 92, ...hit.user_defined }] },
    });
  }
  const m = /^\/api\/buckets\/([^/]+)\/files(?:\/([^/]+))?$/.exec(url.pathname);
  if (m) {
    if (req.headers.authorization !== `Bearer ${TOKEN}`) return json(res, 401, { message: "Unauthenticated." });
    if (m[1] !== BUCKET) return json(res, 404, { message: "Bucket not found" });
    if (req.method === "GET" && !m[2]) {
      const q = url.searchParams.get("search") || "";
      return json(res, 200, { data: files.filter((x) => x.title.includes(q)).map((x) => ({ ...x, user_defined: JSON.stringify(x.user_defined) })) });
    }
    if (req.method === "POST" && !m[2]) {
      const f = await readForm(req);
      const file = f.get("file");
      if (!file || !file.size) return json(res, 422, { message: "The file field is required." });
      const rec = { id: seq++, acr_id: crypto.randomBytes(16).toString("hex"), bucket_id: BUCKET, title: f.get("title"), state: 0, size: file.size, name: file.name, user_defined: JSON.parse(f.get("user_defined") || "{}") };
      files.push(rec);
      setTimeout(() => { rec.state = 1; }, 300);
      return json(res, 201, { data: { ...rec, user_defined: JSON.stringify(rec.user_defined) } });
    }
    if (req.method === "DELETE" && m[2]) {
      for (const id of m[2].split(",")) { const i = files.findIndex((x) => String(x.id) === id || x.acr_id === id); if (i >= 0) files.splice(i, 1); }
      res.writeHead(204); return res.end();
    }
  }
  json(res, 404, { message: "not found" });
}

export function start(port = PORT) {
  const server = http.createServer((req, res) => handle(req, res).catch((e) => json(res, 500, { message: e.message })));
  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve(server)));
}
if (import.meta.url === `file://${process.argv[1]}`) start().then(() => console.log(`ACRCloud simulada em http://127.0.0.1:${PORT}`));
