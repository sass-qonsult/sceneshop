// rcprep.10: descoberta por cena (cortes do Editor, em paralelo), exclusões na IA, seleção das
// análises que vão para o app, publicação dividida por cena, exclusão de produto e lojas padrão
// habilitadas/desabilitadas pela organização. Servidor real (memória) + simulador do Gemini.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const mock = await import("./gemini-mock.mjs");
const MOCK_PORT = 39000 + Math.floor(Math.random() * 900);
const mockServer = await mock.start(MOCK_PORT);
// RC10_BACKEND=postgres roda o mesmo roteiro no PostgreSQL de DATABASE_URL (banco vazio).
const PG = process.env.RC10_BACKEND === "postgres";
if (!PG) process.env.SCENESHOP_MEMORY = "1";
Object.assign(process.env, {
  DEMO: "1", DATA_BACKEND: PG ? "postgres" : "memory", SESSION_BACKEND: "memory",
  SESSION_SECRET: "sceneshop-rcprep10-secret-0123456789abcdef",
  GEMINI_BASE: `http://127.0.0.1:${MOCK_PORT}`, GEMINI_API_KEY: mock.KEY, GEMINI_POLL_MS: "50", GEMINI_SCENE_CONCURRENCY: "3",
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
const waitJob = async (workId) => {
  for (let i = 0; i < 200; i++) {
    const j = (await req(`/api/works/${workId}/ai`)).data;
    if (j.status && j.status !== "rodando") return j;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("análise não terminou");
};

let failed = false;
try {
  await bootstrap();
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
  await req("/api/dev/reset", { method: "POST", body: {} });
  const login = await req("/api/auth/login", { method: "POST", body: { username: "produtora", password: "demo1234" } });
  token = login.data.token;
  const ctx = await req("/api/me/context");
  org = ctx.data.organization && ctx.data.organization.id;
  ok(token && org, `produtora logada na organização ${org}`);

  // ---------------------------------------------------------------- obra com vídeo (74 s, como o roteiro do simulador)
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rc10-"));
  const vid = path.join(dir, "kimono.webm");
  const ff = spawnSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "color=c=0x334455:s=320x180:d=74", "-f", "lavfi", "-i", "sine=frequency=440:duration=74", "-c:v", "libvpx-vp9", "-b:v", "50k", "-c:a", "libopus", "-shortest", vid]);
  assert.equal(ff.status, 0, String(ff.stderr));
  const up = await req("/api/uploads/video?filename=kimono.webm", { method: "POST", raw: fs.readFileSync(vid), type: "video/webm" });
  assert.equal(up.status, 201, JSON.stringify(up.data));
  const work = (await req("/api/works", { method: "POST", body: { title: "Kimono rc10", video: up.data.url, duration: 74 } })).data;
  ok(work.id, `obra enviada (${work.id})`);

  // ---------------------------------------------------------------- produtos
  const mk = async (name, price) => (await req("/api/products", { method: "POST", body: { name, brand: "Casa Bossa", referencePrice: price } })).data;
  const kimono = await mk("Kimono floral Maria Filó", "189,90");
  const saia = await mk("Saia midi pink NV", "289,90");
  const top = await mk("Top cropped vermelho Pietie", "69,90");
  const cinto = await mk("Cinto de elos dourados", "99,90");
  ok(kimono.id && saia.id && top.id && cinto.id, "4 produtos cadastrados");

  // ---------------------------------------------------------------- cortes do Editor (Detectar cortes) e análise por cena, em paralelo
  const cuts = [[0, 9, "Abertura"], [9, 19, "Look 1"], [19, 26, "Look 2"], [26, 33, "Look 3"], [33, 37, "Look 4"], [37, 58, "Cabide"], [58, 74, "Encerramento"]]
    .map(([start, end, title], i) => ({ id: `c${i + 1}`, title, start, end, products: [] }));
  const before = mock.calls.generate;
  const run = await req(`/api/works/${work.id}/ai`, { method: "POST", body: { analysisMode: "DISCOVERY", categories: ["APPAREL"], sceneSource: "TRACK", scenes: cuts.slice(0, 6) } });
  assert.equal(run.status, 202, JSON.stringify(run.data));
  const job1 = await waitJob(work.id);
  ok(job1.status === "pronto", `análise por cena concluída (${job1.step})`);
  ok(mock.calls.generate - before === 6 && mock.calls.clips.length >= 6, "uma chamada ao Gemini por cena marcada (6 cenas, só o trecho de cada uma)");
  ok(job1.scenes.length === 6 && job1.scenes.every((s, i) => s.id === cuts[i].id && s.start === cuts[i].start && s.end === cuts[i].end), "resultado nas cenas do Editor, uma a uma (não uma cena só)");
  ok(job1.scenes[1].items.length === 3 && job1.scenes[5].items.length === 5 && job1.scenes[0].items.length === 1, "itens de cada trecho ficaram na própria cena");
  ok(job1.scenes.every((s) => s.items.every((it) => it.t >= s.start && it.t <= s.end)), "tempo de cada item dentro da sua cena");

  let ws = (await req(`/api/ai/workspace?workId=${work.id}`)).data;
  const jobA = ws.jobs[0];
  ok(jobA.config.sceneSource === "TRACK" && jobA.config.scenes.length === 6, "a análise guarda os cortes usados");
  ok(ws.sync && ws.sync.jobIds[0] === jobA.id && !ws.sync.explicit, "sem marcação, a análise mais recente é a que vai para o app");
  const candA = ws.candidates.filter((c) => c.analysisJobId === jobA.id);
  ok(candA.length === 15 && candA.every((c) => c.primaryPayload.sourceSceneId), `15 itens descobertos, cada um ligado à sua cena`);

  // ---------------------------------------------------------------- revisão: aprovar com produto, excluir rejeitados e descobertos
  await req("/api/ai/assets/sync-products", { method: "POST", body: {} });
  ws = (await req(`/api/ai/workspace?workId=${work.id}`)).data;
  const assetOf = (pid) => ws.assets.find((a) => a.productId === pid).id;
  const byName = (re) => candA.filter((c) => re.test(c.candidateName));
  const approve = async (c, pid) => (await req(`/api/ai/candidates/${c.id}/review`, { method: "POST", body: { decision: "APPROVE", assetId: assetOf(pid) } })).status;
  for (const c of byName(/^Kimono/)) assert.equal(await approve(c, kimono.id), 200);
  for (const c of byName(/^Saia/)) assert.equal(await approve(c, saia.id), 200);
  for (const c of byName(/^Top/)) assert.equal(await approve(c, top.id), 200);
  const rejected = byName(/^Camisa/)[0];
  assert.equal((await req(`/api/ai/candidates/${rejected.id}/review`, { method: "POST", body: { decision: "REJECT" } })).status, 200);
  const del = await req("/api/ai/candidates/delete", { method: "POST", body: { ids: [rejected.id, ...byName(/^Calça/).map((c) => c.id)] } });
  ok(del.status === 200 && del.data.deleted === 4, "itens rejeitado e descobertos excluídos pela seleção (4)");
  ws = (await req(`/api/ai/workspace?workId=${work.id}`)).data;
  ok(ws.candidates.length === 11 && !ws.candidates.some((c) => c.id === rejected.id), "fila de revisão sem os itens excluídos");

  // ---------------------------------------------------------------- segunda análise (uma cena só) e escolha do que vai para o app
  await req(`/api/works/${work.id}/ai`, { method: "POST", body: { analysisMode: "DISCOVERY", sceneSource: "SINGLE" } });
  await waitJob(work.id);
  ws = (await req(`/api/ai/workspace?workId=${work.id}`)).data;
  const jobB = ws.jobs[0];
  ok(jobB.id !== jobA.id && ws.sync.jobIds[0] === jobB.id, "nova análise concluída passa a ser a padrão do app");
  const pubNone = await req(`/api/ai/works/${work.id}/publish`, { method: "POST", body: {} });
  ok(pubNone.status === 400 && /aprovado/i.test(pubNone.data.error), "publicar a análise nova sem itens aprovados é recusado com explicação");
  const sel = await req(`/api/ai/works/${work.id}/sync`, { method: "PUT", body: { jobIds: [jobA.id] } });
  ok(sel.status === 200 && sel.data.explicit && sel.data.jobIds.join() === jobA.id, "produtora marca só a análise por cena para o app");

  // ---------------------------------------------------------------- publicar no app: dividido por cena
  const pub = await req(`/api/ai/works/${work.id}/publish`, { method: "POST", body: {} });
  assert.equal(pub.status, 200, JSON.stringify(pub.data));
  ok(pub.data.products === 10 && pub.data.scenes === 6, `publicado: ${pub.data.products} produtos em ${pub.data.scenesWithProducts} de ${pub.data.scenes} cenas`);
  const tl = (await req(`/api/works/${work.id}/commerce-timeline`)).data;
  const sceneOf = (id) => tl.scenes.find((s) => s.sceneId === id) || { products: [] };
  ok(tl.scenes.length >= 4, `app recebe ${tl.scenes.length} cenas separadas, não uma só`);
  ok(sceneOf("c2").products.length === 2 && sceneOf("c6").products.length === 3, "cada cena com os seus produtos (Look 1: kimono e top; cabide: saia, top, kimono)");
  ok(!sceneOf("c1").products.length, "a abertura (item rejeitado) não mostra produtos");

  // ---------------------------------------------------------------- excluir análise
  const delJob = await req(`/api/ai/jobs/${jobB.id}`, { method: "DELETE" });
  ok(delJob.status === 200 && delJob.data.deleted, "análise excluída");
  ws = (await req(`/api/ai/workspace?workId=${work.id}`)).data;
  ok(!ws.jobs.some((j) => j.id === jobB.id) && !ws.candidates.some((c) => c.analysisJobId === jobB.id), "a análise e os itens dela saíram do workspace");

  // ---------------------------------------------------------------- excluir produto: sai da trilha, do app e das listas
  const tracksList = (await req(`/api/me/tracks?work=${work.id}`)).data;
  const delProd = await req(`/api/products/${top.id}`, { method: "DELETE" });
  ok(delProd.status === 200 && delProd.data.tracksUpdated === tracksList.length, "produto excluído e trilha republicada sem ele");
  const mine = (await req("/api/me/products")).data;
  ok(!mine.some((p) => p.id === top.id), "produto excluído some da aba Produtos");
  const search = (await req(`/api/products?q=${encodeURIComponent("Top cropped")}`)).data;
  ok(!search.some((p) => p.id === top.id), "e da busca do editor");
  const tl2 = (await req(`/api/works/${work.id}/commerce-timeline`)).data;
  ok(!tl2.scenes.some((s) => s.products.some((p) => p.productId === top.id)), "e do app");
  ok((await req(`/api/products/${top.id}`, { method: "DELETE" })).status === 404, "excluir de novo responde 404");
  const t = (await req(`/api/tracks/${tracksList[0].id}`)).data;
  const keep = t.scenes.map((s) => ({ ...s, products: [...s.products, { id: top.id, match: "exato" }] }));
  const bad = await req(`/api/tracks/${t.id}`, { method: "PUT", body: { workId: work.id, title: t.title, offset: 0, scenes: keep } });
  ok(bad.status === 400 && /excluído/.test(JSON.stringify(bad.data)), "trilha não aceita produto excluído");

  // ---------------------------------------------------------------- lojas padrão: desabilitar e habilitar na organização
  const sellers = (await req("/api/me/sellers")).data;
  const def = sellers.find((s) => s.isDefault);
  ok(def && def.active, `loja padrão listada e habilitada (${def && def.name})`);
  const off = await req(`/api/me/sellers/${def.id}/enabled`, { method: "PUT", body: { enabled: false } });
  ok(off.status === 200 && off.data.seller.active === false, "loja padrão desabilitada nesta organização");
  const offer = await req(`/api/official-offers/${kimono.id}`, { method: "PUT", body: { sellerId: def.id, price: "189,90", commission: 0.1, url: "https://loja.example/kimono" } });
  ok(offer.status === 400 && /desativada/.test(JSON.stringify(offer.data)), "loja desabilitada não aceita oferta nova");
  const on = await req(`/api/me/sellers/${def.id}/enabled`, { method: "PUT", body: { enabled: true } });
  ok(on.status === 200 && on.data.seller.active === true, "loja padrão habilitada de novo");

  console.log("\nrcprep.10: tudo certo");
} catch (e) {
  failed = true;
  console.error("✗ FALHOU:", e.message);
  console.error(e.stack.split("\n").slice(1, 4).join("\n"));
} finally {
  await new Promise((r) => server.close(r));
  await (shutdown ? shutdown().catch(() => {}) : null);
  mockServer.close();
  process.exit(failed ? 1 : 0);
}
