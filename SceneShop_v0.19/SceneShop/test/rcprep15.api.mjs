// rcprep.15: excluir obra (título), produtos por projeto (puxar de outro projeto), classe do operador
// na criação da conta (produtor por padrão) e na organização, e mensagem clara quando o Gemini recusa
// por créditos. Servidor real (memória ou PostgreSQL com RC15_BACKEND=postgres).
import assert from "node:assert/strict";
import http from "node:http";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const mock = await import("./gemini-mock.mjs");
const MOCK_PORT = 39000 + Math.floor(Math.random() * 900);
const mockServer = await mock.start(MOCK_PORT);
const PG = process.env.RC15_BACKEND === "postgres";
if (!PG) process.env.SCENESHOP_MEMORY = "1";
Object.assign(process.env, {
  DEMO: "1", DATA_BACKEND: PG ? "postgres" : "memory", SESSION_BACKEND: "memory",
  SESSION_SECRET: "sceneshop-rcprep15-secret-0123456789abcdef",
  GEMINI_BASE: `http://127.0.0.1:${MOCK_PORT}`, GEMINI_API_KEY: mock.KEY, GEMINI_POLL_MS: "50", SCENESHOP_AI_AUTOSYNC_MS: "150",
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
const names = (rows) => (rows || []).map((p) => p.name).sort().join(" | ");

let failed = false;
try {
  await bootstrap();
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  server.keepAliveTimeout = 65000;
  base = `http://127.0.0.1:${server.address().port}`;
  await req("/api/dev/reset", { method: "POST", body: {} });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rc15-"));
  const vid = path.join(dir, "v.webm");
  const ff = spawnSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "color=c=0x334455:s=160x90:d=20", "-f", "lavfi", "-i", "sine=frequency=440:duration=20", "-c:v", "libvpx-vp9", "-b:v", "30k", "-c:a", "libopus", "-shortest", vid]);
  assert.equal(ff.status, 0, String(ff.stderr));

  // ---------------------------------------------------------------- classe do operador na criação da conta
  const s1 = await req("/api/auth/signup", { method: "POST", body: { username: "miguel_rc15", password: "senha-forte-123" } });
  assert.equal(s1.status, 201, JSON.stringify(s1.data));
  ok(s1.data.organization.kind === "PRODUCER" && s1.data.user.role === "producer", "conta nova sem escolher: classe Produtor (organização PRODUCER, conta de produtora)");
  const s2 = await req("/api/auth/signup", { method: "POST", body: { username: "marca_rc15", password: "senha-forte-123", kind: "BRAND" } });
  ok(s2.data.organization.kind === "BRAND" && s2.data.user.role === "author", "conta nova escolhendo Marca: organização BRAND");

  token = s2.data.token; org = s2.data.organization.id;
  const k = await req(`/api/organizations/${org}/kind`, { method: "PATCH", body: { kind: "PRODUCER" } });
  ok(k.status === 200 && k.data.organization.kind === "PRODUCER", "a dona da organização troca a classe para Produtor");
  ok((await req(`/api/organizations/${org}/kind`, { method: "PATCH", body: { kind: "XYZ" } })).status === 400, "classe inválida é recusada");

  // ---------------------------------------------------------------- dois projetos, produtos de cada um
  token = s1.data.token; org = s1.data.organization.id;
  const up = async () => (await req("/api/uploads/video?filename=v.webm", { method: "POST", raw: fs.readFileSync(vid), type: "video/webm" })).data.url;
  const A = (await req("/api/works", { method: "POST", body: { title: "Projeto A", video: await up(), duration: 20 } })).data;
  const B = (await req("/api/works", { method: "POST", body: { title: "Projeto B", video: await up(), duration: 20 } })).data;
  const mk = async (name, workId) => (await req("/api/products", { method: "POST", body: { name, brand: "X", referencePrice: "100,00", ...(workId ? { workId } : {}) } })).data;
  const jaqueta = await mk("Jaqueta Oakley", A.id);
  const oculos = await mk("Óculos Oakley", A.id);
  const tenis = await mk("Tênis Lillard", B.id);
  const solto = await mk("Boné sem projeto");
  ok(A.id && B.id && jaqueta.workIds.join() === A.id && tenis.workIds.join() === B.id && !solto.workIds.length, "produtos cadastrados no projeto escolhido");
  ok((await req("/api/products", { method: "POST", body: { name: "Intruso", referencePrice: "1,00", workId: "demo-01" } })).status === 400, "não dá para cadastrar em projeto de outra organização");

  const ofA = (await req(`/api/me/products?work=${A.id}`)).data;
  const ofB = (await req(`/api/me/products?work=${B.id}`)).data;
  const none = (await req("/api/me/products?work=none")).data;
  ok(names(ofA) === "Jaqueta Oakley | Óculos Oakley" && names(ofB) === "Tênis Lillard" && names(none) === "Boné sem projeto", "cada projeto mostra só os seus produtos (sem misturar)");
  const searchA = (await req(`/api/products?q=&work=${A.id}`)).data.filter((p) => p.organizationId); // (o catálogo público da demonstração também aparece)
  const othersA = (await req(`/api/products?q=&work=${A.id}&others=1`)).data;
  ok(names(searchA) === "Jaqueta Oakley | Óculos Oakley" && othersA.some((p) => p.name === "Tênis Lillard") && !othersA.some((p) => p.name === "Jaqueta Oakley"), "busca do Editor: produtos do projeto; os de outros projetos separados");

  // puxar de outro projeto
  ok((await req(`/api/products/${tenis.id}/projects`, { method: "POST", body: { workId: A.id } })).status === 200, "puxar o tênis do Projeto B para o Projeto A");
  ok(names((await req(`/api/me/products?work=${A.id}`)).data).includes("Tênis Lillard") && names((await req(`/api/me/products?work=${B.id}`)).data) === "Tênis Lillard", "o tênis aparece nos dois projetos");
  ok((await req(`/api/products/${tenis.id}/projects`, { method: "POST", body: { workId: A.id, linked: false } })).status === 200 && !names((await req(`/api/me/products?work=${A.id}`)).data).includes("Tênis"), "tirar do projeto A");

  // produto usado numa trilha do projeto passa a ser dele; não dá para tirar enquanto está na trilha
  const T = await req("/api/tracks", { method: "POST", body: { workId: A.id, title: "Trilha A", offset: 0, scenes: [{ id: "c1", title: "Cena 1", start: 0, end: 10, products: [{ id: jaqueta.id }] }, { id: "c2", title: "Cena 2", start: 10, end: 20, products: [{ id: solto.id }] }] } });
  ok(T.status === 201 && T.data.track.type === "official", "trilha do Projeto A publicada (oficial)");
  ok(names((await req(`/api/me/products?work=${A.id}`)).data).includes("Boné sem projeto"), "o boné usado na trilha passou a ser do Projeto A");
  const busy = await req(`/api/products/${jaqueta.id}/projects`, { method: "POST", body: { workId: A.id, linked: false } });
  ok(busy.status === 409 && /Trilha A/.test(busy.data.error), "produto em uso na trilha não sai do projeto (aviso com o nome da trilha)");

  // ---------------------------------------------------------------- excluir obra (título)
  const TB = await req("/api/tracks", { method: "POST", body: { workId: B.id, title: "Trilha B", offset: 0, scenes: [{ id: "c1", title: "Tudo", start: 0, end: 20, products: [{ id: tenis.id }] }] } });
  ok((await req(`/api/works/${B.id}/commerce-timeline`)).status === 200, "Projeto B no app antes de excluir");
  const del = await req(`/api/works/${B.id}`, { method: "DELETE" });
  ok(del.status === 200 && del.data.tracksRemoved === 1, "obra excluída na aba Títulos/Obras (com a trilha dela)");
  const mine = (await req("/api/me/works")).data;
  const pub = (await req("/api/works")).data;
  ok(!mine.some((w) => w.id === B.id) && !pub.some((w) => w.id === B.id) && mine.some((w) => w.id === A.id), "a obra excluída some das listas; a outra continua");
  ok((await req(`/api/works/${B.id}`)).status === 404 && (await req(`/api/works/${B.id}/commerce-timeline`)).status === 404, "e some do player e do app");
  ok((await req(`/api/tracks/${TB.data.track.id}`)).data.status === "removida", "a trilha dela foi excluída");
  const tenisNow = (await req("/api/me/products")).data.find((p) => p.id === tenis.id);
  ok(tenisNow && !tenisNow.projects.includes(B.id), "o produto continua na aba Produtos, sem o projeto excluído");
  ok((await req(`/api/works/${B.id}`, { method: "DELETE" })).status === 404, "excluir de novo responde 404");
  token = s2.data.token; org = s2.data.organization.id;
  ok((await req(`/api/works/${A.id}`, { method: "DELETE" })).status === 404, "outra organização não exclui a obra");
  token = s1.data.token; org = s1.data.organization.id;

  // ---------------------------------------------------------------- a IA procura só os produtos do projeto (e os sem projeto)
  const C = (await req("/api/works", { method: "POST", body: { title: "Projeto C", video: await up(), duration: 20 } })).data;
  const kimonoC = await mk("Kimono floral Maria Filó", C.id);
  const runAI = async () => {
    let j = (await req(`/api/works/${A.id}/ai`, { method: "POST", body: { analysisMode: "DISCOVERY", sceneSource: "SINGLE" } })).data;
    for (let i = 0; i < 100 && j.status === "rodando"; i++) { await sleep(100); j = (await req(`/api/works/${A.id}/ai`)).data; }
    return j;
  };
  let jA = await runAI();
  const usesKimono = (j) => (j.scenes || []).some((s) => s.items.some((it) => it.productId === kimonoC.id));
  ok(jA.status === "pronto" && !usesKimono(jA), "a IA do Projeto A não sugere o kimono que é do Projeto C");
  await req(`/api/products/${kimonoC.id}/projects`, { method: "POST", body: { workId: A.id } });
  await sleep(300);
  jA = await runAI();
  ok(jA.status === "pronto" && usesKimono(jA), "depois de puxar o kimono para o Projeto A, a IA passa a reconhecê-lo");

  // ---------------------------------------------------------------- Gemini recusando por créditos: mensagem clara
  const g = http.createServer((rq, rs) => { rs.writeHead(429, { "content-type": "application/json" }); rs.end(JSON.stringify({ error: { code: 429, status: "RESOURCE_EXHAUSTED", message: "Your prepayment credits are depleted. Please go to AI Studio at https://ai.studio/projects to manage your project and billing." } })); });
  await new Promise((r) => g.listen(0, "127.0.0.1", r));
  process.env.GEMINI_BASE = `http://127.0.0.1:${g.address().port}`;
  delete process.env.GEMINI_MODEL;
  const run = await req(`/api/works/${A.id}/ai`, { method: "POST", body: { analysisMode: "DISCOVERY", sceneSource: "SINGLE" } });
  let job = run.data;
  for (let i = 0; i < 100 && job.status === "rodando"; i++) { await sleep(100); job = (await req(`/api/works/${A.id}/ai`)).data; }
  ok(job.status === "erro" && /créditos ou cota/.test(job.error) && /MESMO projeto da chave/.test(job.error) && /prepayment credits are depleted/.test(job.error),
    "Gemini sem créditos: o Studio explica o que conferir (créditos no mesmo projeto da chave) e mostra a mensagem do Google");
  g.close();
  process.env.GEMINI_BASE = `http://127.0.0.1:${MOCK_PORT}`;
} catch (e) {
  failed = true;
  console.error("✗ FALHOU:", e.stack || e.message);
} finally {
  await new Promise((r) => server.close(r));
  await (shutdown ? shutdown().catch(() => {}) : null);
  mockServer.close();
  console.log(failed ? "\nrcprep.15: FALHOU" : "\nrcprep.15: tudo certo");
  process.exit(failed ? 1 : 0);
}
