// rcprep.10 no navegador: produtos por cena no Editor, descoberta por cena (cortes do Editor, em
// paralelo), seleção e exclusão na fila de revisão, análises marcadas para o app, publicação por cena,
// exclusão de produto e loja padrão habilitada/desabilitada.
// Servidor de demonstração apontando para o simulador do Gemini:
//   GEMINI_BASE=http://127.0.0.1:3999 GEMINI_API_KEY=AIzaSyTESTE-simulador-0000000000000 GEMINI_POLL_MS=200 DEMO=1 npm start
//   node test/rcprep10.e2e.mjs
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { start, calls } from "./gemini-mock.mjs";

const BASE = process.env.BASE || "http://localhost:3000";
const OUT = process.env.OUT || null;
const FIX = path.join(path.dirname(new URL(import.meta.url).pathname), "fixtures", "ai");
const check = (cond, msg) => { if (!cond) { console.log("✗ FALHOU:", msg); process.exitCode = 1; } else console.log("  ✓", msg); };
const shot = async (p, name) => { if (OUT) await p.screenshot({ path: path.join(OUT, `rc10-${name}.png`), fullPage: false }); };

const mock = await start(3999);
await fetch(`${BASE}/api/dev/reset?all=1`, { method: "POST" });
let token = (await (await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: "produtora", password: "demo1234" }) })).json()).token;
const call = async (p, { method = "GET", body, raw, type } = {}) => {
  const r = await fetch(BASE + p, { method, headers: { Authorization: `Bearer ${token}`, ...(raw ? { "Content-Type": type || "application/octet-stream" } : body ? { "Content-Type": "application/json" } : {}) }, body: raw || (body ? JSON.stringify(body) : undefined) });
  return { status: r.status, data: await r.json().catch(() => ({})) };
};

// ---------------------------------------------------------------- obra e catálogo pela API
const vid = await call("/api/uploads/video?filename=kimono.webm", { method: "POST", raw: fs.readFileSync(path.join(FIX, "kimono.webm")) });
const work = (await call("/api/works", { method: "POST", body: { title: "Kimono por cena", video: vid.data.url, duration: 74.2 } })).data;
const CAT = [
  ["Kimono-Maria-Filo-1.jpg", "Kimono Maria Filó floral", "Maria Filó", "189,90"],
  ["Top-Pietie-Vermelho-1.jpg", "Top Pietie vermelho", "Pietie", "69,90"],
  ["Saia-NV-Pink-1.jpg", "Saia NV pink", "NV", "289,90"],
];
const prods = {};
for (const [file, name, brand, price] of CAT) {
  const img = await call(`/api/uploads/image?filename=${file}`, { method: "POST", raw: fs.readFileSync(path.join(FIX, file)) });
  prods[brand] = (await call("/api/products", { method: "POST", body: { name, brand, category: "Moda", referencePrice: price, images: [img.data.url] } })).data.id;
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

// ---------------------------------------------------------------- cortes (Nova cena a partir daqui) em 0:19 e 0:37
for (const t of [19, 37]) {
  await p.evaluate((t) => { const v = document.getElementById("video"); v.currentTime = t; }, t);
  await p.waitForFunction((t) => Math.abs(document.getElementById("video").currentTime - t) < 0.2, t);
  await p.click("#splitBtn");
}
check((await p.locator("#sceneList li").count()) === 3, "editor com 3 cenas (cortes em 0:19 e 0:37)");

// ---------------------------------------------------------------- produtos por cena, sem percorrer o vídeo
await p.click("#boardBtn");
await p.waitForSelector("#boardModal:not([hidden]) .board-scene");
check((await p.locator("#boardBody .board-scene").count()) === 3, "painel Produtos por cena mostra as 3 cenas numa só tela");
await p.fill('[data-bq="1"]', "kimono");
await p.waitForSelector('[data-bres="1"]:not([hidden]) li[data-id]');
await p.click('[data-bres="1"] li[data-id]');
check(/Kimono/.test(await p.locator('.board-scene[data-bi="1"] .board-chips').innerText()), "produto buscado e colocado só na cena 2");
check(!/Kimono/.test(await p.locator('.board-scene[data-bi="0"] .board-chips').innerText()), "cena 1 continua sem o produto");
await p.check('[data-bsel="0"]'); await p.check('[data-bsel="2"]');
await p.selectOption("#boardProduct", prods["Pietie"]);
await p.click("#boardAdd");
const chips = async (i) => p.locator(`.board-scene[data-bi="${i}"] .board-chips .chip`).count();
check((await chips(0)) === 1 && (await chips(2)) === 1 && (await chips(1)) === 1, "top adicionado de uma vez às cenas 1 e 3 marcadas");
await p.waitForFunction(() => [...document.querySelectorAll("#boardBody canvas[data-bthumb]")].some((c) => { const d = c.getContext("2d").getImageData(96, 54, 1, 1).data; return d[0] + d[1] + d[2] > 0; }), null, { timeout: 15000 }).catch(() => {});
await shot(p, "board");
await p.click('.board-scene[data-bi="2"] [data-brm="2:0"]');
check((await chips(2)) === 0, "produto retirado da cena 3 pelo ×");
check((await p.locator("#sceneList li").nth(1).innerText()).includes("1 prod."), "lista de cenas do editor acompanha o painel");
await p.click("#boardPublish");
await p.waitForFunction(() => /Trilha publicada/.test(document.getElementById("msg").textContent), null, { timeout: 15000 });
check(true, "trilha publicada direto do painel");

// ---------------------------------------------------------------- IA: descoberta nas cenas do Editor, em paralelo
const before = calls.generate;
await p.click(".tabs button[data-tab=aiops]");
await p.waitForSelector("#aiOpsSceneList label");
check((await p.inputValue("#aiOpsSceneSource")) === "TRACK", "análise usa por padrão os cortes do Editor");
check((await p.locator("#aiOpsSceneList input:checked").count()) === 3, "as 3 cenas do Editor marcadas para analisar");
await p.selectOption("#aiOpsMode", "DISCOVERY");
await p.click("#aiOpsRun");
await p.waitForFunction(() => /3 cena\(s\) analisadas ao mesmo tempo/.test(document.getElementById("aiOpsRunMsg").textContent), null, { timeout: 10000 });
await p.waitForFunction(() => document.querySelector("#aiOpsJobs .status-pill") && /COMPLETED/.test(document.querySelector("#aiOpsJobs .status-pill").textContent), null, { timeout: 60000 });
check(calls.generate - before === 3 && calls.clips.slice(-3).every((c) => c.end > c.start), "o Gemini recebeu um pedido por cena, cada um só com o trecho da cena");
check((await p.locator("#aiOpsReview .review-scene").count()) === 3, "fila de revisão dividida pelas 3 cenas");
check(/3 cenas do Editor/.test(await p.locator("#aiOpsJobs .job-row").first().innerText()), "job mostra que usou as cenas do Editor");
check(await p.locator("#aiOpsJobs [data-sync-job]").first().isChecked(), "a análise mais recente vem marcada para o app");
await shot(p, "review");

// aprovar em lote os itens com produto sugerido; excluir os demais
await p.check("#aiOpsSelAll");
const n = await p.locator("#aiOpsReview [data-pick]:checked").count();
await p.click("#aiOpsApproveSel");
await p.waitForFunction(() => document.querySelectorAll("#aiOpsReview .status-pill.approved").length > 0, null, { timeout: 20000 });
const approved = await p.locator("#aiOpsReview .status-pill.approved").count();
check(approved >= 5 && approved < n, `aprovação em lote: ${approved} de ${n} itens (os que têm produto do catálogo)`);
await p.selectOption("#aiOpsFilter", "DETECTED");
const left = await p.locator("#aiOpsReview .review-card").count();
await p.check("#aiOpsSelAll");
await p.click("#aiOpsDeleteSel");
await p.waitForFunction(() => document.querySelectorAll("#aiOpsReview .review-card").length === 0, null, { timeout: 10000 });
check(left > 0, `${left} itens descobertos sem produto excluídos de uma vez`);
await p.selectOption("#aiOpsFilter", "");

// publicar no app
await p.click("#aiOpsPublish");
await p.waitForFunction(() => /Publicado no app/.test(document.getElementById("aiOpsSyncMsg").textContent), null, { timeout: 15000 });
const pubMsg = await p.locator("#aiOpsSyncMsg").innerText();
check(/em 3 de 3 cenas/.test(pubMsg), `publicado por cena: ${pubMsg}`);
const tl = await (await fetch(`${BASE}/api/works/${work.id}/commerce-timeline`)).json();
check(tl.scenes.length === 3 && tl.scenes.every((s) => s.products.length), "app recebe as 3 cenas, cada uma com os seus produtos");

// segunda análise e exclusão dela
await p.selectOption("#aiOpsSceneSource", "SINGLE");
await p.click("#aiOpsRun");
await p.waitForFunction(() => document.querySelectorAll("#aiOpsJobs .job-row").length === 2 && !/RUNNING|QUEUED/.test(document.getElementById("aiOpsJobs").textContent), null, { timeout: 60000 });
await p.locator("#aiOpsJobs [data-del-job]").first().click();
await p.waitForFunction(() => document.querySelectorAll("#aiOpsJobs .job-row").length === 1, null, { timeout: 10000 });
check(true, "análise excluída pelo botão Excluir do job");

// ---------------------------------------------------------------- excluir produto na aba Produtos
await p.click(".tabs button[data-tab=produtos]");
await p.waitForSelector("#myProducts form");
const before2 = await p.locator("#myProducts form").count();
await p.evaluate(() => [...document.querySelectorAll("#myProducts form")].find((f) => f.querySelector("input[name=name]").value === "Saia NV pink").querySelector("[data-delete]").click());
await p.waitForFunction((n) => document.querySelectorAll("#myProducts form").length === n - 1, before2, { timeout: 10000 });
check(true, "produto excluído na aba Produtos");
const tl2 = await (await fetch(`${BASE}/api/works/${work.id}/commerce-timeline`)).json();
check(!tl2.scenes.some((s) => s.products.some((x) => x.productId === prods["NV"])), "produto excluído saiu do app");

// ---------------------------------------------------------------- loja padrão: desabilitar e habilitar
await p.click(".tabs button[data-tab=ofertas]");
await p.waitForSelector("#sellersList .agreement");
const def = p.locator("#sellersList .agreement", { has: p.locator("label.switch") }).first();
check(await def.count() === 1, "loja padrão tem a chave de habilitar/desabilitar");
await def.locator("[data-toggle]").click();
await p.waitForFunction(() => /Desabilitada nesta organização/.test(document.getElementById("sellersList").textContent), null, { timeout: 10000 });
check(true, "loja padrão desabilitada nesta organização");
await shot(p, "sellers");
await p.locator("#sellersList .agreement", { has: p.locator("label.switch") }).first().locator("[data-toggle]").click();
await p.waitForFunction(() => !/Desabilitada nesta organização/.test(document.getElementById("sellersList").textContent), null, { timeout: 10000 });
check(true, "e habilitada de novo");

check(!errs.length, "sem erros de JavaScript" + (errs.length ? ": " + errs.join(" | ") : ""));
await browser.close();
mock.close();
console.log(process.exitCode ? "\nrcprep.10 (navegador): FALHOU" : "\nrcprep.10 (navegador): tudo certo");
