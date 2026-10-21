// rcprep.11 no navegador: os itens aprovados na IA aparecem sozinhos na trilha do Editor (com a
// marca "IA") e no app; salvar no Editor mantém esses produtos; excluir trilha; e o celular
// sincronizado pelo som continua avançando de cena (miniaturas novas aparecem sozinhas).
// Servidor de demonstração apontando para o simulador do Gemini:
//   GEMINI_BASE=http://127.0.0.1:3999 GEMINI_API_KEY=AIzaSyTESTE-simulador-0000000000000 GEMINI_POLL_MS=200 DEMO=1 npm start
//   node test/rcprep11.e2e.mjs
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { start } from "./gemini-mock.mjs";

const BASE = process.env.BASE || "http://localhost:3000";
const OUT = process.env.OUT || null;
const FIX = path.join(path.dirname(new URL(import.meta.url).pathname), "fixtures", "ai");
const check = (cond, msg) => { if (!cond) { console.log("✗ FALHOU:", msg); process.exitCode = 1; } else console.log("  ✓", msg); };
const shot = async (p, name) => { if (OUT) await p.screenshot({ path: path.join(OUT, `rc11-${name}.png`), fullPage: false }); };

const mock = await start(3999);
await fetch(`${BASE}/api/dev/reset?all=1`, { method: "POST" });
const token = (await (await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: "produtora", password: "demo1234" }) })).json()).token;
const call = async (p, { method = "GET", body, raw, type } = {}) => {
  const r = await fetch(BASE + p, { method, headers: { Authorization: `Bearer ${token}`, ...(raw ? { "Content-Type": type || "application/octet-stream" } : body ? { "Content-Type": "application/json" } : {}) }, body: raw || (body ? JSON.stringify(body) : undefined) });
  return { status: r.status, data: await r.json().catch(() => ({})) };
};

const vid = await call("/api/uploads/video?filename=kimono.webm", { method: "POST", raw: fs.readFileSync(path.join(FIX, "kimono.webm")) });
const work = (await call("/api/works", { method: "POST", body: { title: "Kimono rc11", video: vid.data.url, duration: 74.2 } })).data;
for (const [file, name, brand, price] of [["Kimono-Maria-Filo-1.jpg", "Kimono Maria Filó floral", "Maria Filó", "189,90"], ["Top-Pietie-Vermelho-1.jpg", "Top Pietie vermelho", "Pietie", "69,90"], ["Saia-NV-Pink-1.jpg", "Saia NV pink", "NV", "289,90"]]) {
  const img = await call(`/api/uploads/image?filename=${file}`, { method: "POST", raw: fs.readFileSync(path.join(FIX, file)) });
  await call("/api/products", { method: "POST", body: { name, brand, category: "Moda", referencePrice: price, images: [img.data.url] } });
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 }, locale: "pt-BR" });
const p = await ctx.newPage();
const errs = [];
p.on("pageerror", (e) => errs.push(e.message));
p.on("dialog", (d) => d.accept());
await p.goto(`${BASE}/studio.html`);
await p.waitForSelector("#login:not([hidden])");
await p.fill("#loginUser", "produtora"); await p.fill("#loginPass", "demo1234");
await p.click("#loginForm [data-mode=login]");
await p.waitForSelector(".tabs button[data-tab=editor]:not([hidden])");
await p.click(".tabs button[data-tab=editor]");
await p.selectOption("#work", work.id);
await p.waitForFunction(() => document.getElementById("video").readyState >= 1, null, { timeout: 15000 });

// ---------------------------------------------------------------- Editor: cortes e publicação (sem produtos)
for (const t of [19, 37]) {
  await p.evaluate((t) => { document.getElementById("video").currentTime = t; }, t);
  await p.waitForFunction((t) => Math.abs(document.getElementById("video").currentTime - t) < 0.2, t);
  await p.click("#splitBtn");
}
await p.fill("#trackTitle", "Trilha Kimono");
await p.click("#saveBtn");
await p.waitForFunction(() => /Trilha publicada/.test(document.getElementById("msg").textContent), null, { timeout: 15000 });
check(/●.*Trilha Kimono.*no app/.test(await p.locator("#trackSel option:checked").innerText()), "a trilha publicada aparece marcada como a do app");
check(await p.locator("#trackDel").isVisible(), "botão Excluir trilha disponível");

// ---------------------------------------------------------------- IA: descobrir e aprovar (sem clicar em publicar)
await p.click(".tabs button[data-tab=aiops]");
await p.waitForSelector("#aiOpsSceneList label");
await p.selectOption("#aiOpsMode", "DISCOVERY");
await p.click("#aiOpsRun");
await p.waitForFunction(() => document.querySelector("#aiOpsJobs .status-pill") && /COMPLETED/.test(document.querySelector("#aiOpsJobs .status-pill").textContent), null, { timeout: 60000 });
await p.check("#aiOpsSelAll");
await p.click("#aiOpsApproveSel");
await p.waitForFunction(() => /sincronizados/.test(document.getElementById("aiOpsSyncMsg").textContent) && /produto\(s\) da IA em [1-9]/.test(document.getElementById("aiOpsSyncMsg").textContent), null, { timeout: 20000 });
const syncMsg = await p.locator("#aiOpsSyncMsg").innerText();
check(/Trilha Kimono/.test(syncMsg), `aprovar já sincroniza com a trilha do Editor: ${syncMsg}`);
await shot(p, "aiops-sync");
let tl = await (await fetch(`${BASE}/api/works/${work.id}/commerce-timeline`)).json();
const appProducts = tl.scenes.reduce((n, s) => n + s.products.length, 0);
check(tl.scenes.length === 3 && appProducts >= 3, `o app já tem os produtos aprovados, por cena (${appProducts} em ${tl.scenes.length} cenas)`);

// ---------------------------------------------------------------- volta ao Editor: os produtos da IA estão lá
await p.click(".tabs button[data-tab=editor]");
await p.waitForFunction(() => /produtos aprovados na IA/.test(document.getElementById("msg").textContent), null, { timeout: 10000 });
check(true, "o Editor recarrega a trilha com os produtos aprovados na IA");
await p.click("#boardBtn");
await p.waitForSelector("#boardModal:not([hidden]) .board-scene");
const aiChips = await p.locator("#boardBody .chip.is-ai").count();
check(aiChips === appProducts, `Produtos por cena mostra os ${aiChips} produtos da IA, com a marca IA`);
await shot(p, "board-ai");
await p.click("#boardClose");
let tagged = 0;
for (let i = 0; i < 3 && !tagged; i++) { await p.locator("#sceneList li").nth(i).click(); tagged = await p.locator("#prodList .ai-tag").count(); }
check(tagged > 0, "a lista de produtos da cena marca os itens colocados pela IA");

// salvar no Editor não apaga os produtos da IA
await p.click("#saveBtn");
await p.waitForFunction(() => /Trilha publicada/.test(document.getElementById("msg").textContent), null, { timeout: 15000 });
tl = await (await fetch(`${BASE}/api/works/${work.id}/commerce-timeline`)).json();
check(tl.scenes.reduce((n, s) => n + s.products.length, 0) === appProducts, "Salvar alterações mantém os produtos da IA no app");

// ---------------------------------------------------------------- celular sincronizado pelo som: avança de cena sozinho
const sess = await (await fetch(`${BASE}/api/sessions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workId: work.id, time: 17, mode: "COMPANION" }) })).json();
check(!!sess.code, `sessão sincronizada pelo som na cena 1 (0:17) · ${sess.code}`);
const phone = await (await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "pt-BR", isMobile: true })).newPage();
phone.on("pageerror", (e) => errs.push("celular: " + e.message));
await phone.goto(`${BASE}/s/${sess.code}`);
await phone.waitForSelector("#scenes .scene", { timeout: 15000 });
const first = await phone.locator("#scenes .scene").count();
await phone.waitForFunction((n) => document.querySelectorAll("#scenes .scene").length > n, first, { timeout: 8000 }).catch(() => {});
const later = await phone.locator("#scenes .scene").count();
check(first === 1 && later === 2, `o celular avança sozinho para a cena seguinte (${first} → ${later} miniaturas)`);
check(/AO VIVO/.test(await phone.locator("#scenes .scene").nth(1).innerText()), "a cena nova vira a cena ao vivo");
await shot(phone, "phone");

// ---------------------------------------------------------------- excluir trilha
await p.click("#trackDel");
await p.waitForFunction(() => document.getElementById("trackSel").options.length === 1, null, { timeout: 10000 });
check(true, "trilha excluída pelo botão do Editor");
check((await fetch(`${BASE}/api/works/${work.id}/commerce-timeline`)).status === 404, "a obra saiu do app");

check(!errs.length, "sem erros de JavaScript" + (errs.length ? ": " + errs.join(" | ") : ""));
await browser.close();
mock.close();
console.log(process.exitCode ? "\nrcprep.11 (navegador): FALHOU" : "\nrcprep.11 (navegador): tudo certo");
