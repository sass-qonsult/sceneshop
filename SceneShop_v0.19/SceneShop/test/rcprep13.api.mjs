// rcprep.13: organização dona da obra que não é "produtora" (marca, agência, outro) — a trilha dela é
// oficial, vai para o app pela Commerce Timeline e a IA atualiza sempre a MESMA trilha (antes criava
// uma trilha "Trilha oficial" nova de "comunidade" a cada sincronização).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const mock = await import("./gemini-mock.mjs");
const MOCK_PORT = 39000 + Math.floor(Math.random() * 900);
const mockServer = await mock.start(MOCK_PORT);
const PG = process.env.RC13_BACKEND === "postgres";
if (!PG) process.env.SCENESHOP_MEMORY = "1";
Object.assign(process.env, {
  DEMO: "1", DATA_BACKEND: PG ? "postgres" : "memory", SESSION_BACKEND: "memory",
  SESSION_SECRET: "sceneshop-rcprep13-secret-0123456789abcdef",
  GEMINI_BASE: `http://127.0.0.1:${MOCK_PORT}`, GEMINI_API_KEY: mock.KEY, GEMINI_POLL_MS: "50", GEMINI_SCENE_CONCURRENCY: "4",
  SCENESHOP_AI_AUTOSYNC_MS: "150",
});
const { bootstrap, server, shutdown } = await import("../server/index.js");

let base, token, org;
const req = async (p, { method = "GET", body, raw, type } = {}) => {
  const headers = { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(org ? { "x-sceneshop-organization": org } : {}) };
  if (body !== undefined) headers["content-type"] = "application/json";
  if (raw) headers["content-type"] = type;
  const res = await fetch(base + p, { method, headers, body: raw || (body === undefined ? undefined : JSON.stringify(body)) });
  const t = res.headers.get("content-type") || "";
  return { status: res.status, data: t.includes("json") ? await res.json() : await res.text() };
};
const ok = (cond, msg) => { assert.ok(cond, msg); console.log("  ✓", msg); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitJob = async (workId) => {
  for (let i = 0; i < 200; i++) {
    const j = (await req(`/api/works/${workId}/ai`)).data;
    if (j.status && j.status !== "rodando") return j;
    await sleep(100);
  }
  throw new Error("análise não terminou");
};
const waitSync = async (workId) => {
  await sleep(400);
  for (let i = 0; i < 80; i++) {
    const ws = (await req(`/api/ai/workspace?workId=${workId}`)).data;
    if (!ws.sync.pending) return ws;
    await sleep(100);
  }
  throw new Error("sincronização automática não terminou");
};
const tracksOf = async (workId) => (await req(`/api/me/tracks?work=${workId}`)).data.filter((t) => t.status !== "removida");

let failed = false;
try {
  await bootstrap();
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  server.keepAliveTimeout = 65000;
  base = `http://127.0.0.1:${server.address().port}`;
  await req("/api/dev/reset", { method: "POST", body: {} });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rc13-"));
  const vid = path.join(dir, "kimono.webm");
  const ff = spawnSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "color=c=0x334455:s=160x90:d=74", "-f", "lavfi", "-i", "sine=frequency=440:duration=74", "-c:v", "libvpx-vp9", "-b:v", "30k", "-c:a", "libopus", "-shortest", vid]);
  assert.equal(ff.status, 0, String(ff.stderr));

  // ana: organização do tipo "OTHER" (não é produtora), dona da obra que ela envia
  const login = await req("/api/auth/login", { method: "POST", body: { username: "ana", password: "demo1234" } });
  token = login.data.token;
  const ctx = (await req("/api/me/context")).data;
  org = ctx.organization.id;
  ok(token && org && ctx.organization.kind === "OTHER", `organização ${org} do tipo ${ctx.organization.kind}`);

  // na obra de outra organização, a trilha dela continua de comunidade
  const onDemo = await req("/api/tracks", { method: "POST", body: { workId: "demo-01", title: "Legenda da Ana", offset: 0, scenes: [{ id: "c1", title: "Tudo", start: 0, end: 60, products: [] }] } });
  ok(onDemo.status === 201 && onDemo.data.track.type === "community", "na obra de outra organização, a trilha continua de comunidade");

  const up = await req("/api/uploads/video?filename=kimono.webm", { method: "POST", raw: fs.readFileSync(vid), type: "video/webm" });
  assert.equal(up.status, 201, JSON.stringify(up.data));
  const work = (await req("/api/works", { method: "POST", body: { title: "Medina na Oakley", video: up.data.url, duration: 74 } })).data;
  const mk = async (name, price) => (await req("/api/products", { method: "POST", body: { name, brand: "Casa Bossa", referencePrice: price } })).data;
  const kimono = await mk("Kimono floral Maria Filó", "189,90");
  const saia = await mk("Saia midi pink NV", "289,90");
  const top = await mk("Top cropped vermelho Pietie", "69,90");
  ok(work.id && kimono.id && saia.id && top.id, "obra e catálogo da organização");

  const cuts = [[0, 9], [9, 19], [19, 26], [26, 33], [33, 37], [37, 58], [58, 74]].map(([start, end], i) => ({ id: `c${i + 1}`, title: `Cena ${i + 1}`, start, end, products: [] }));
  const created = await req("/api/tracks", { method: "POST", body: { workId: work.id, title: "Trilha Medina", offset: 0, scenes: cuts } });
  const T = created.data.track.id;
  ok(created.status === 201 && created.data.track.type === "official", "a trilha da dona da obra é oficial (mesmo sem ser produtora)");
  let tl = await req(`/api/works/${work.id}/commerce-timeline`);
  ok(tl.status === 200 && tl.data.manifest.sourceTrackId === T, "e vai para o app pela Commerce Timeline");
  let mine = await tracksOf(work.id);
  ok(mine.length === 1 && mine[0].live, "o Editor abre essa trilha (marcada como a do app)");

  // ---------------------------------------------------------------- IA três vezes: sempre a mesma trilha
  await req("/api/ai/assets/sync-products", { method: "POST", body: {} });
  const assets = (await req("/api/ai/assets")).data.filter((a) => a.productId);
  for (let round = 1; round <= 3; round++) {
    const run = await req(`/api/works/${work.id}/ai`, { method: "POST", body: { analysisMode: "HYBRID", assetIds: assets.map((a) => a.id), categories: ["APPAREL"], sceneSource: "TRACK", trackId: T, scenes: cuts.map(({ products, ...s }) => s), autoApprove: true } });
    assert.equal(run.status, 202, JSON.stringify(run.data));
    await waitJob(work.id);
    await waitSync(work.id);
  }
  mine = await tracksOf(work.id);
  const tr = (await req(`/api/tracks/${T}`)).data;
  ok(mine.length === 1 && mine[0].id === T, `três análises com aprovação automática: continua uma trilha só (${mine.length})`);
  ok(tr.scenes.length === 7 && tr.scenes.filter((s) => s.products.length).length === 5, "a trilha recebeu os produtos aprovados, cena a cena (5 cenas com produto)");
  tl = (await req(`/api/works/${work.id}/commerce-timeline`)).data;
  ok(tl.manifest.sourceTrackId === T && tl.scenes.filter((s) => s.products.length).length === 5, "o app recebe as 5 cenas com produto");
  const view = (await req(`/api/works/${work.id}`)).data;
  ok(view.track.id === T && view.track.type === "official" && view.scenes.length === 7, "player e celular abrem a mesma trilha, com as 7 cenas");
  const shown = view.scenes.flatMap((s) => s.products.flatMap((p) => p.offers || []));
  ok(!shown.some((o) => o.simulated || ["amazon", "mercadolivre", "magalu"].includes(o.store)),
    "no app, os produtos da organização não mostram lojas que ela não indicou (sem Amazon/Mercado Livre/Magalu simuladas)");
  const demoView = (await req("/api/works/demo-01")).data;
  ok(demoView.scenes.some((s) => s.products.some((p) => (p.offers || []).some((o) => o.simulated))), "o catálogo da demonstração continua com os preços simulados");

  // ---------------------------------------------------------------- dados antigos: trilhas de "comunidade" da dona da obra
  if (!PG) {
    const store = (await import("../server/store.js")).default;
    const old = { ...JSON.parse(JSON.stringify(store.state.tracks[T])), id: "t-ana-antiga", type: "community", title: "Trilha oficial", updatedAt: Date.now() - 60000, createdAt: Date.now() - 60000 };
    store.state.tracks[old.id] = old;
    const r = await req(`/api/tracks/${old.id}`, { method: "PUT", body: { workId: work.id, title: "Trilha antiga", offset: 0, scenes: old.scenes } });
    ok(r.status === 200 && r.data.track.type === "official", "trilha antiga de comunidade da dona da obra vira oficial ao salvar");
    await req(`/api/tracks/${old.id}`, { method: "DELETE" });
  }
} catch (e) {
  failed = true;
  console.error("✗ FALHOU:", e.stack || e.message);
} finally {
  await new Promise((r) => server.close(r));
  await (shutdown ? shutdown().catch(() => {}) : null);
  mockServer.close();
  console.log(failed ? "\nrcprep.13: FALHOU" : "\nrcprep.13: tudo certo");
  process.exit(failed ? 1 : 0);
}
