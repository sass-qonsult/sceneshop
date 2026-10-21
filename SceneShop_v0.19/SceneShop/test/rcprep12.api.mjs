// rcprep.12: Editor de trilha integrado à IA (buscar produtos nas cenas da trilha, aprovação automática
// do catálogo), recortar/juntar cenas sem perder os produtos da IA, excluir lojas (e as lojas fictícias
// da demonstração saem dos dados em uso). Servidor real (memória ou PostgreSQL) + simulador do Gemini.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const mock = await import("./gemini-mock.mjs");
const MOCK_PORT = 39000 + Math.floor(Math.random() * 900);
const mockServer = await mock.start(MOCK_PORT);
const PG = process.env.RC12_BACKEND === "postgres";
if (!PG) process.env.SCENESHOP_MEMORY = "1";
Object.assign(process.env, {
  DEMO: "1", DATA_BACKEND: PG ? "postgres" : "memory", SESSION_BACKEND: "memory",
  SESSION_SECRET: "sceneshop-rcprep12-secret-0123456789abcdef",
  GEMINI_BASE: `http://127.0.0.1:${MOCK_PORT}`, GEMINI_API_KEY: mock.KEY, GEMINI_POLL_MS: "50", GEMINI_SCENE_CONCURRENCY: "4",
  SCENESHOP_AI_AUTOSYNC_MS: "150",
});
const { bootstrap, server, shutdown } = await import("../server/index.js");
const store = (await import("../server/store.js")).default;

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
const ids = (track, sceneId) => (track.scenes.find((s) => s.id === sceneId) || { products: [] }).products.map((p) => p.id).sort();
const aiCount = (track) => track.scenes.reduce((n, s) => n + s.products.filter((p) => String(p.source || "").startsWith("ai:")).length, 0);

let failed = false;
try {
  await bootstrap();
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  server.keepAliveTimeout = 65000;
  base = `http://127.0.0.1:${server.address().port}`;
  await req("/api/dev/reset", { method: "POST", body: {} });

  // ---------------------------------------------------------------- lojas fictícias saem dos dados em uso
  const persisted = JSON.parse(JSON.stringify(store.state));
  delete persisted.migrations;
  store._migrate(persisted);
  const demo = ["urbano-oficial", "lar-design-oficial", "atelier-rosa-oficial", "megaloja", "shopcenter"];
  ok(demo.every((id) => persisted.sellers[id].removedAt) && !persisted.sellers["loja-piloto"].removedAt,
    "dados já em uso: as 5 lojas fictícias são excluídas e fica só o Marketplace Piloto");
  ok(!Object.values(persisted.officialOffers).some((o) => demo.includes(o.sellerId)), "as ofertas nas lojas fictícias saem junto");
  const again = JSON.parse(JSON.stringify(persisted));
  store._migrate(again);
  ok(JSON.stringify(again.sellers) === JSON.stringify(persisted.sellers), "a limpeza roda uma vez só");

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rc12-"));
  const vid = path.join(dir, "kimono.webm");
  const ff = spawnSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "color=c=0x334455:s=160x90:d=74", "-f", "lavfi", "-i", "sine=frequency=440:duration=74", "-c:v", "libvpx-vp9", "-b:v", "30k", "-c:a", "libopus", "-shortest", vid]);
  assert.equal(ff.status, 0, String(ff.stderr));
  const login = await req("/api/auth/login", { method: "POST", body: { username: "produtora", password: "demo1234" } });
  token = login.data.token;
  org = ((await req("/api/me/context")).data.organization || {}).id;
  ok(token && org, `produtora logada (${org})`);

  // ---------------------------------------------------------------- excluir lojas na aba Ofertas oficiais
  let sellers = (await req("/api/me/sellers")).data;
  ok(sellers.some((s) => s.id === "urbano-oficial") && sellers.some((s) => s.id === "loja-piloto"), "demonstração nova: lojas padrão listadas");
  const delDefault = await req("/api/me/sellers/urbano-oficial", { method: "DELETE" });
  sellers = (await req("/api/me/sellers")).data;
  ok(delDefault.status === 200 && !sellers.some((s) => s.id === "urbano-oficial"), "loja padrão excluída some da lista desta organização");
  ok((await req("/api/me/sellers/urbano-oficial", { method: "DELETE" })).status === 404, "excluir de novo responde 404");
  const mine = await req("/api/me/sellers", { method: "POST", body: { name: "Loja Teste rc12", kind: "marca", integration: "link_produto", storeUrl: "https://loja-teste.example/" } });
  assert.equal(mine.status, 201, JSON.stringify(mine.data));
  const delMine = await req(`/api/me/sellers/${mine.data.seller.id}`, { method: "DELETE" });
  sellers = (await req("/api/me/sellers")).data;
  ok(delMine.status === 200 && !sellers.some((s) => s.id === mine.data.seller.id), "loja própria excluída some da lista");
  ok((await req(`/api/me/sellers/${mine.data.seller.id}`, { method: "PUT", body: { name: "Volta" } })).status === 404, "loja excluída não pode ser editada");

  // ---------------------------------------------------------------- obra, catálogo e trilha do Editor com 7 cortes
  const up = await req("/api/uploads/video?filename=kimono.webm", { method: "POST", raw: fs.readFileSync(vid), type: "video/webm" });
  const work = (await req("/api/works", { method: "POST", body: { title: "Kimono rc12", video: up.data.url, duration: 74 } })).data;
  const mk = async (name, price) => (await req("/api/products", { method: "POST", body: { name, brand: "Casa Bossa", referencePrice: price } })).data;
  const kimono = await mk("Kimono floral Maria Filó", "189,90");
  const saia = await mk("Saia midi pink NV", "289,90");
  const top = await mk("Top cropped vermelho Pietie", "69,90");
  const cinto = await mk("Cinto de elos dourados", "99,90");
  const cuts = [[0, 9], [9, 19], [19, 26], [26, 33], [33, 37], [37, 58], [58, 74]].map(([start, end], i) => ({ id: `c${i + 1}`, title: `Cena ${i + 1}`, start, end, products: [] }));
  cuts[6].products.push({ id: cinto.id, match: "exato", box: null });
  // a trilha "original" (uma cena só, um produto), criada antes da trilha editada
  const O = (await req("/api/tracks", { method: "POST", body: { workId: work.id, title: "Trilha original", offset: 0, scenes: [{ id: "c1", title: "Tudo", start: 0, end: 74, products: [{ id: cinto.id }] }] } })).data.track.id;
  await sleep(20);
  const T = (await req("/api/tracks", { method: "POST", body: { workId: work.id, title: "Trilha Kimono", offset: 0, scenes: cuts } })).data.track.id;
  ok(T, "trilha do Editor salva com 7 cenas e um produto à mão");

  // ---------------------------------------------------------------- "Buscar produtos nas cenas" a partir do Editor, com aprovação automática
  await req("/api/ai/assets/sync-products", { method: "POST", body: {} });
  const assets = (await req("/api/ai/assets")).data.filter((a) => a.productId);
  const run = await req(`/api/works/${work.id}/ai`, { method: "POST", body: {
    analysisMode: "HYBRID", assetIds: assets.map((a) => a.id), categories: ["APPAREL"], sceneSource: "TRACK", trackId: T,
    scenes: cuts.map(({ products, ...s }) => s), autoApprove: true, autoApproveMin: 0.7 } });
  assert.equal(run.status, 202, JSON.stringify(run.data));
  const job = await waitJob(work.id);
  let ws = await waitSync(work.id);
  const jobAfter = (await req(`/api/works/${work.id}/ai`)).data;
  ok(job.status === "pronto" && job.scenes.length === 7, "a IA analisou as 7 cenas da trilha do Editor");
  let tr = (await req(`/api/tracks/${T}`)).data;
  ok(ids(tr, "c2").includes(kimono.id) && ids(tr, "c2").includes(top.id) && ids(tr, "c4").includes(saia.id) && ids(tr, "c4").includes(kimono.id) && ids(tr, "c6").join() === [kimono.id, saia.id, top.id].sort().join(),
    "os produtos do catálogo entraram sozinhos na trilha, cada um na sua cena");
  ok(ids(tr, "c7").includes(cinto.id) && ids(tr, "c1").length === 0, "o produto à mão continua e a abertura (só item fora do catálogo) fica sem produto");
  const pending = ws.candidates.filter((c) => c.reviewStatus === "DETECTED");
  ok(jobAfter.autoApproved && jobAfter.autoApproved.approved === aiCount(tr) && pending.length === jobAfter.autoApproved.pending && pending.length >= 4,
    `aprovação automática: ${jobAfter.autoApproved.approved} aprovados, ${pending.length} ficam para revisar (fora do catálogo ou abaixo de 70%)`);
  let tl = (await req(`/api/works/${work.id}/commerce-timeline`)).data;
  ok(tl.manifest.sourceTrackId === T && tl.scenes.filter((s) => s.products.length).length === 6, "o app recebe os produtos em 6 cenas separadas, sem clicar em nada na aba IA");

  // a trilha original não passa por cima da editada: player, celular e sessões abrem a editada
  const view = (await req(`/api/works/${work.id}`)).data;
  const sess = (await req("/api/sessions", { method: "POST", body: { workId: work.id, time: 20, mode: "COMPANION" } })).data;
  ok(O && view.track.id === T && sess.trackId === T && view.scenes.length === 7, "com a trilha original ainda ativa, o player e o celular usam a trilha editada (7 cenas)");

  // aprovar uma sugestão pendente escolhendo o produto (como no Revisar sugestões do Editor)
  const pant = pending.find((c) => /pantalona/i.test(c.candidateName));
  const asset = (pid) => assets.find((a) => a.productId === pid).id;
  const cintoCand = pending.find((c) => /Cinto/.test(c.candidateName));
  assert.equal((await req(`/api/ai/candidates/${cintoCand.id}/review`, { method: "POST", body: { decision: "APPROVE", assetId: asset(cinto.id) } })).status, 200);
  if (pant) assert.equal((await req(`/api/ai/candidates/${pant.id}/review`, { method: "POST", body: { decision: "REJECT" } })).status, 200);
  await waitSync(work.id);
  tr = (await req(`/api/tracks/${T}`)).data;
  ok(ids(tr, "c3").includes(cinto.id), "a sugestão aprovada no Editor entra na cena dela (cinto na cena 3)");

  // ---------------------------------------------------------------- recortar as cenas no Editor não perde os produtos da IA
  const before = aiCount(tr);
  const recut = [[0, 9], [9, 26], [26, 37], [37, 58], [58, 74]].map(([start, end], i) => ({ id: `c${i + 1}`, title: `Corte ${i + 1}`, start, end, products: i === 4 ? [{ id: cinto.id, match: "exato" }] : [] }));
  let r = await req(`/api/tracks/${T}`, { method: "PUT", body: { workId: work.id, title: "Trilha Kimono", offset: 0, scenes: recut, baseUpdatedAt: tr.updatedAt, aiRemoved: [] } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  await waitSync(work.id);
  tr = (await req(`/api/tracks/${T}`)).data;
  ok(tr.scenes.length === 5 && tr.scenes[1].title === "Corte 2", "os cortes novos do Editor foram gravados (5 cenas)");
  ok(ids(tr, "c2").join() === [cinto.id, kimono.id, top.id].sort().join() && ids(tr, "c3").join() === [kimono.id, saia.id, top.id].sort().join(),
    "depois de recortar, a IA recolocou cada produto na cena nova pelo segundo do item");
  ok(aiCount(tr) >= before - 3 && aiCount(tr) > 0, `produtos da IA mantidos após o recorte (${aiCount(tr)})`);
  tl = (await req(`/api/works/${work.id}/commerce-timeline`)).data;
  ok(tl.scenes.length >= 4, `o app acompanha os cortes novos (${tl.scenes.length} cenas com produtos)`);

  // ---------------------------------------------------------------- "Uma cena só" e de volta aos cortes
  r = await req(`/api/tracks/${T}`, { method: "PUT", body: { workId: work.id, title: "Trilha Kimono", offset: 0, scenes: [{ id: "c1", title: "Cena única", start: 0, end: 74, products: [] }], baseUpdatedAt: tr.updatedAt, aiRemoved: [] } });
  assert.equal(r.status, 200);
  await waitSync(work.id);
  tr = (await req(`/api/tracks/${T}`)).data;
  ok(tr.scenes.length === 1 && [kimono.id, saia.id, top.id, cinto.id].every((id) => ids(tr, "c1").includes(id)), "com uma cena só, todos os produtos ficam nela (o app mostra uma cena)");
  r = await req(`/api/tracks/${T}`, { method: "PUT", body: { workId: work.id, title: "Trilha Kimono", offset: 0, scenes: cuts.map((s) => ({ ...s, products: [] })), baseUpdatedAt: tr.updatedAt, aiRemoved: [] } });
  await waitSync(work.id);
  tr = (await req(`/api/tracks/${T}`)).data;
  ok(tr.scenes.length === 7 && ids(tr, "c6").join() === [kimono.id, saia.id, top.id].sort().join() && ids(tr, "c3").includes(cinto.id),
    "voltando aos 7 cortes, cada produto volta para a sua cena");
  tl = (await req(`/api/works/${work.id}/commerce-timeline`)).data;
  ok(tl.scenes.filter((s) => s.products.length).length >= 5, "e o app volta a mostrar as cenas separadas");

  // ---------------------------------------------------------------- tirar de propósito (×) continua valendo
  const saiaC4 = tr.scenes.find((s) => s.id === "c4").products.find((p) => p.id === saia.id);
  const edited = JSON.parse(JSON.stringify(tr.scenes));
  edited.find((s) => s.id === "c4").products = edited.find((s) => s.id === "c4").products.filter((p) => p.id !== saia.id);
  r = await req(`/api/tracks/${T}`, { method: "PUT", body: { workId: work.id, title: tr.title, offset: 0, scenes: edited, baseUpdatedAt: tr.updatedAt, aiRemoved: [`c4|${saia.id}|${saiaC4.source}`] } });
  await waitSync(work.id);
  tr = (await req(`/api/tracks/${T}`)).data;
  ok(!ids(tr, "c4").includes(saia.id) && ids(tr, "c6").includes(saia.id), "o produto tirado pelo × não volta naquela cena (e continua nas outras)");
} catch (e) {
  failed = true;
  console.error("✗ FALHOU:", e.stack || e.message);
} finally {
  await new Promise((r) => server.close(r));
  await (shutdown ? shutdown().catch(() => {}) : null);
  mockServer.close();
  console.log(failed ? "\nrcprep.12: FALHOU" : "\nrcprep.12: tudo certo");
  process.exit(failed ? 1 : 0);
}
