// rcprep.11: o que a IA aprova vai sozinho para a trilha do Editor e para o app; salvar no Editor
// não apaga os produtos da IA; excluir trilha; celular sincronizado pelo som continua andando.
// Servidor real (memória ou PostgreSQL com RC11_BACKEND=postgres) + simulador do Gemini.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const mock = await import("./gemini-mock.mjs");
const MOCK_PORT = 39000 + Math.floor(Math.random() * 900);
const mockServer = await mock.start(MOCK_PORT);
const PG = process.env.RC11_BACKEND === "postgres";
if (!PG) process.env.SCENESHOP_MEMORY = "1";
Object.assign(process.env, {
  DEMO: "1", DATA_BACKEND: PG ? "postgres" : "memory", SESSION_BACKEND: "memory",
  SESSION_SECRET: "sceneshop-rcprep11-secret-0123456789abcdef",
  GEMINI_BASE: `http://127.0.0.1:${MOCK_PORT}`, GEMINI_API_KEY: mock.KEY, GEMINI_POLL_MS: "50", GEMINI_SCENE_CONCURRENCY: "3",
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
// espera a sincronização automática terminar (o workspace avisa enquanto está pendente)
const waitSync = async (workId) => {
  await sleep(250);
  for (let i = 0; i < 60; i++) {
    const ws = (await req(`/api/ai/workspace?workId=${workId}`)).data;
    if (!ws.sync.pending) return ws;
    await sleep(100);
  }
  throw new Error("sincronização automática não terminou");
};
const aiIn = (track, sceneId) => (track.scenes.find((s) => s.id === sceneId) || { products: [] }).products.filter((p) => String(p.source || "").startsWith("ai:"));
const idsIn = (track, sceneId) => (track.scenes.find((s) => s.id === sceneId) || { products: [] }).products.map((p) => p.id);

let failed = false;
try {
  await bootstrap();
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  server.keepAliveTimeout = 65000;
  base = `http://127.0.0.1:${server.address().port}`;
  await req("/api/dev/reset", { method: "POST", body: {} });

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rc11-"));
  const vid = path.join(dir, "kimono.webm");
  const ff = spawnSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "color=c=0x334455:s=160x90:d=74", "-f", "lavfi", "-i", "sine=frequency=440:duration=74", "-c:v", "libvpx-vp9", "-b:v", "30k", "-c:a", "libopus", "-shortest", vid]);
  assert.equal(ff.status, 0, String(ff.stderr));

  const login = await req("/api/auth/login", { method: "POST", body: { username: "produtora", password: "demo1234" } });
  token = login.data.token;
  org = ((await req("/api/me/context")).data.organization || {}).id;
  ok(token && org, `produtora logada (${org})`);

  const up = await req("/api/uploads/video?filename=kimono.webm", { method: "POST", raw: fs.readFileSync(vid), type: "video/webm" });
  assert.equal(up.status, 201, JSON.stringify(up.data));
  const work = (await req("/api/works", { method: "POST", body: { title: "Kimono rc11", video: up.data.url, duration: 74 } })).data;
  const mk = async (name, price) => (await req("/api/products", { method: "POST", body: { name, brand: "Casa Bossa", referencePrice: price } })).data;
  const kimono = await mk("Kimono floral Maria Filó", "189,90");
  const saia = await mk("Saia midi pink NV", "289,90");
  const top = await mk("Top cropped vermelho Pietie", "69,90");
  const cinto = await mk("Cinto de elos dourados", "99,90");
  ok(work.id && kimono.id && saia.id && top.id && cinto.id, "obra e 4 produtos cadastrados");

  // ---------------------------------------------------------------- Editor: cortes (Detectar cortes) + um produto à mão, publicado
  const cuts = [[0, 9, "Abertura"], [9, 19, "Look 1"], [19, 26, "Look 2"], [26, 33, "Look 3"], [33, 37, "Look 4"], [37, 58, "Cabide"], [58, 74, "Encerramento"]]
    .map(([start, end, title], i) => ({ id: `c${i + 1}`, title, start, end, products: [] }));
  cuts[6].products.push({ id: cinto.id, match: "exato", box: null });
  const created = await req("/api/tracks", { method: "POST", body: { workId: work.id, title: "Trilha do Editor", offset: 0, scenes: cuts } });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  const T = created.data.track.id;
  const opened = (await req(`/api/tracks/${T}`)).data; // o Editor abriu esta versão
  ok(opened.scenes.length === 7 && idsIn(opened, "c7").includes(cinto.id), "trilha do Editor publicada com 7 cenas e um produto à mão");
  let mine = (await req(`/api/me/tracks?work=${work.id}`)).data;
  ok(mine.find((t) => t.id === T).live, "a trilha do Editor é a que está no app");

  // ---------------------------------------------------------------- IA por cena nos cortes do Editor; aprovar sem clicar em publicar
  await req(`/api/works/${work.id}/ai`, { method: "POST", body: { analysisMode: "DISCOVERY", categories: ["APPAREL"], sceneSource: "TRACK", trackId: T, scenes: cuts.slice(0, 6).map(({ products, ...s }) => s) } });
  const job = await waitJob(work.id);
  ok(job.status === "pronto" && job.scenes.length === 6, "análise das 6 cenas do Editor concluída");
  await req("/api/ai/assets/sync-products", { method: "POST", body: {} });
  let ws = (await req(`/api/ai/workspace?workId=${work.id}`)).data;
  const assetOf = (pid) => ws.assets.find((a) => a.productId === pid).id;
  const cands = ws.candidates;
  const byName = (re) => cands.filter((c) => re.test(c.candidateName));
  const approve = async (c, pid) => (await req(`/api/ai/candidates/${c.id}/review`, { method: "POST", body: { decision: "APPROVE", assetId: assetOf(pid) } }));
  const kim = byName(/^Kimono/);
  for (const c of kim) { const r = await approve(c, kimono.id); assert.equal(r.status, 200, JSON.stringify(r.data)); }
  ws = await waitSync(work.id);
  let tr = (await req(`/api/tracks/${T}`)).data;
  const kimScenes = [...new Set(kim.map((c) => c.primaryPayload.sourceSceneId))];
  ok(kim.length >= 2 && kimScenes.every((sid) => aiIn(tr, sid).some((p) => p.id === kimono.id)),
    `aprovar já coloca o produto na trilha do Editor, em cada cena (${kimScenes.join(", ")}), sem clicar em publicar`);
  ok(idsIn(tr, "c7").includes(cinto.id), "o produto colocado à mão continua na trilha");
  ok(ws.sync.last && ws.sync.last.ok && ws.sync.last.auto && ws.sync.last.trackId === T, "o workspace mostra a sincronização automática com a trilha do Editor");
  let tl = (await req(`/api/works/${work.id}/commerce-timeline`)).data;
  ok(tl.manifest.sourceTrackId === T && kimScenes.every((sid) => (tl.scenes.find((s) => s.sceneId === sid) || { products: [] }).products.some((p) => p.productId === kimono.id)),
    "o app recebe os produtos aprovados, cada um na sua cena");
  const appView = (await req(`/api/works/${work.id}`)).data;
  ok(appView.track.id === T, "o player e o celular abrem a mesma trilha do Editor");

  // ---------------------------------------------------------------- Editor desatualizado salva: os produtos da IA não se perdem
  const stale = JSON.parse(JSON.stringify(opened.scenes));
  stale[1].title = "Look 1 (renomeada)";
  const save1 = await req(`/api/tracks/${T}`, { method: "PUT", body: { workId: work.id, title: "Trilha do Editor", offset: 0, scenes: stale, baseUpdatedAt: opened.updatedAt, aiRemoved: [] } });
  assert.equal(save1.status, 200, JSON.stringify(save1.data));
  tr = (await req(`/api/tracks/${T}`)).data;
  ok(save1.data.aiMerged === kim.length && kimScenes.every((sid) => aiIn(tr, sid).some((p) => p.id === kimono.id)),
    `salvar no Editor aberto antes da aprovação mantém os ${save1.data.aiMerged} produtos da IA`);
  ok(tr.scenes[1].title === "Look 1 (renomeada)" && idsIn(tr, "c7").includes(cinto.id), "e grava a edição feita no Editor");
  tl = (await req(`/api/works/${work.id}/commerce-timeline`)).data;
  ok(kimScenes.every((sid) => (tl.scenes.find((s) => s.sceneId === sid) || { products: [] }).products.some((p) => p.productId === kimono.id)), "o app continua com os produtos da IA depois de salvar");

  // ---------------------------------------------------------------- tirar um produto da IA no Editor: não volta sozinho
  const fresh = (await req(`/api/tracks/${T}`)).data;
  const sidOut = kimScenes[0];
  const out = fresh.scenes.find((s) => s.id === sidOut).products.find((p) => p.id === kimono.id);
  fresh.scenes.find((s) => s.id === sidOut).products = fresh.scenes.find((s) => s.id === sidOut).products.filter((p) => p !== out);
  const save2 = await req(`/api/tracks/${T}`, { method: "PUT", body: { workId: work.id, title: fresh.title, offset: 0, scenes: fresh.scenes, baseUpdatedAt: fresh.updatedAt, aiRemoved: [`${sidOut}|${out.id}|${out.source}`] } });
  assert.equal(save2.status, 200, JSON.stringify(save2.data));
  for (const c of byName(/^Saia/)) assert.equal((await approve(c, saia.id)).status, 200);
  await waitSync(work.id);
  tr = (await req(`/api/tracks/${T}`)).data;
  const saiaScenes = [...new Set(byName(/^Saia/).map((c) => c.primaryPayload.sourceSceneId))];
  ok(!aiIn(tr, sidOut).some((p) => p.id === kimono.id), "o produto da IA tirado no Editor não volta na próxima sincronização");
  ok(saiaScenes.every((sid) => aiIn(tr, sid).some((p) => p.id === saia.id)) && kimScenes.slice(1).every((sid) => aiIn(tr, sid).some((p) => p.id === kimono.id)),
    "as novas aprovações (saia) entram e os outros produtos da IA continuam");

  // ---------------------------------------------------------------- excluir na fila de revisão tira da trilha e do app
  const delSaia = await req("/api/ai/candidates/delete", { method: "POST", body: { ids: byName(/^Saia/).map((c) => c.id) } });
  assert.equal(delSaia.status, 200);
  await waitSync(work.id);
  tr = (await req(`/api/tracks/${T}`)).data;
  ok(!tr.scenes.some((s) => s.products.some((p) => p.id === saia.id)), "itens excluídos na revisão saem da trilha do Editor");
  tl = (await req(`/api/works/${work.id}/commerce-timeline`)).data;
  ok(!tl.scenes.some((s) => s.products.some((p) => p.productId === saia.id)), "e do app");

  // ---------------------------------------------------------------- excluir trilha
  const second = await req("/api/tracks", { method: "POST", body: { workId: work.id, title: "Rascunho", offset: 0, scenes: [{ id: "c1", title: "Tudo", start: 0, end: 74, products: [{ id: top.id }] }] } });
  const T2 = second.data.track.id;
  mine = (await req(`/api/me/tracks?work=${work.id}`)).data;
  ok(mine.find((t) => t.id === T2).live && !mine.find((t) => t.id === T).live, "uma trilha nova publicada passa a ser a do app");
  const d2 = await req(`/api/tracks/${T2}`, { method: "DELETE" });
  ok(d2.status === 200 && d2.data.republished === T, "excluir a trilha do app volta a publicar a anterior");
  mine = (await req(`/api/me/tracks?work=${work.id}`)).data;
  tl = (await req(`/api/works/${work.id}/commerce-timeline`)).data;
  ok(!mine.some((t) => t.id === T2 && t.status !== "removida") && mine.find((t) => t.id === T).live && tl.manifest.sourceTrackId === T, "a trilha excluída sai da lista e o app volta para a trilha do Editor");
  ok((await req(`/api/tracks/${T2}`, { method: "PUT", body: { workId: work.id, scenes: [{ id: "c1", start: 0, end: 74, products: [] }] } })).status === 409, "trilha excluída não pode ser editada");
  ok((await req(`/api/tracks/${T2}`, { method: "DELETE" })).status === 404, "excluir de novo responde 404");
  const dT = await req(`/api/tracks/${T}`, { method: "DELETE" });
  ok(dT.status === 200 && dT.data.retired !== undefined, "excluir a última trilha oficial");
  ok((await req(`/api/works/${work.id}/commerce-timeline`)).status === 404 && (await req(`/api/works/${work.id}`)).status === 404, "a obra fica sem trilha no app");
  const tokenSave = token; token = null;
  ok((await req(`/api/tracks/${T}`, { method: "DELETE" })).status === 401, "excluir exige login");
  token = tokenSave;

  // ---------------------------------------------------------------- celular sincronizado pelo som: o tempo continua andando
  const demo = (await req("/api/works")).data.find((w) => w.id === "demo-01") || (await req("/api/works")).data[0];
  const s = await req("/api/sessions", { method: "POST", body: { workId: demo.id, time: 40, mode: "COMPANION" } });
  assert.equal(s.status, 201, JSON.stringify(s.data));
  await sleep(1300);
  const sv = (await req(`/api/sessions/${s.data.code}`)).data;
  ok(sv.mode === "COMPANION" && sv.playbackPosition === 40 && sv.observedAgoSeconds >= 1.2 && sv.observedAgoSeconds < 5,
    `sessão sincronizada pelo som informa há quanto tempo foi a sincronização (${sv.observedAgoSeconds.toFixed(1)} s)`);
} catch (e) {
  failed = true;
  console.error("✗ FALHOU:", e.stack || e.message);
} finally {
  await new Promise((r) => server.close(r));
  await (shutdown ? shutdown().catch(() => {}) : null);
  mockServer.close();
  console.log(failed ? "\nrcprep.11: FALHOU" : "\nrcprep.11: tudo certo");
  process.exit(failed ? 1 : 0);
}
