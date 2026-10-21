// rcprep.12 no navegador: buscar produtos com IA direto do Editor (sem abrir a aba IA), aprovação
// automática do catálogo, revisar sugestões no Editor, excluir trilha na aba Obras, excluir loja e o
// celular sincronizado pelo som usando a posição do servidor.
// Servidor de demonstração apontando para o simulador do Gemini:
//   GEMINI_BASE=http://127.0.0.1:3999 GEMINI_API_KEY=AIzaSyTESTE-simulador-0000000000000 GEMINI_POLL_MS=200 DEMO=1 npm start
//   node test/rcprep12.e2e.mjs
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { start } from "./gemini-mock.mjs";

const BASE = process.env.BASE || "http://localhost:3000";
const OUT = process.env.OUT || null;
const FIX = path.join(path.dirname(new URL(import.meta.url).pathname), "fixtures", "ai");
const check = (cond, msg) => { if (!cond) { console.log("✗ FALHOU:", msg); process.exitCode = 1; } else console.log("  ✓", msg); };
const shot = async (p, name) => { if (OUT) await p.screenshot({ path: path.join(OUT, `rc12-${name}.png`), fullPage: false }); };

const mock = await start(3999);
await fetch(`${BASE}/api/dev/reset?all=1`, { method: "POST" });
const token = (await (await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: "produtora", password: "demo1234" }) })).json()).token;
const call = async (p, { method = "GET", body, raw, type } = {}) => {
  const r = await fetch(BASE + p, { method, headers: { Authorization: `Bearer ${token}`, ...(raw ? { "Content-Type": type || "application/octet-stream" } : body ? { "Content-Type": "application/json" } : {}) }, body: raw || (body ? JSON.stringify(body) : undefined) });
  return { status: r.status, data: await r.json().catch(() => ({})) };
};
const vid = await call("/api/uploads/video?filename=kimono.webm", { method: "POST", raw: fs.readFileSync(path.join(FIX, "kimono.webm")) });
const work = (await call("/api/works", { method: "POST", body: { title: "Kimono rc12", video: vid.data.url, duration: 74.2 } })).data;
for (const [file, name, brand, price] of [["Kimono-Maria-Filo-1.jpg", "Kimono Maria Filó floral", "Maria Filó", "189,90"], ["Top-Pietie-Vermelho-1.jpg", "Top Pietie vermelho", "Pietie", "69,90"], ["Saia-NV-Pink-1.jpg", "Saia NV pink", "NV", "289,90"]]) {
  const img = await call(`/api/uploads/image?filename=${file}`, { method: "POST", raw: fs.readFileSync(path.join(FIX, file)) });
  await call("/api/products", { method: "POST", body: { name, brand, category: "Moda", referencePrice: price, images: [img.data.url] } });
}

const browser = await chromium.launch();
const p = await (await browser.newContext({ viewport: { width: 1440, height: 950 }, locale: "pt-BR" })).newPage();
const errs = [];
p.on("pageerror", (e) => errs.push(e.message));
p.on("dialog", (d) => d.accept());
const apiCalls = [];
p.on("request", (r) => { if (/\/api\/ai\/works\/.*\/publish/.test(r.url())) apiCalls.push(r.url()); });
await p.goto(`${BASE}/studio.html`);
await p.waitForSelector("#login:not([hidden])");
await p.fill("#loginUser", "produtora"); await p.fill("#loginPass", "demo1234");
await p.click("#loginForm [data-mode=login]");
await p.waitForSelector(".tabs button[data-tab=editor]:not([hidden])");
await p.click(".tabs button[data-tab=editor]");
await p.selectOption("#work", work.id);
await p.waitForFunction(() => document.getElementById("video").readyState >= 1, null, { timeout: 15000 });
check(await p.locator("#trackDel").isVisible() && await p.locator("#trackDel").isDisabled(), "botão Excluir trilha sempre visível (desabilitado numa trilha nova)");

// ---------------------------------------------------------------- Editor: cortes e "Buscar produtos nas cenas" (salva a trilha sozinho)
for (const t of [19, 37]) {
  await p.evaluate((t) => { document.getElementById("video").currentTime = t; }, t);
  await p.waitForFunction((t) => Math.abs(document.getElementById("video").currentTime - t) < 0.2, t);
  await p.click("#splitBtn");
}
await p.fill("#trackTitle", "Trilha Kimono");
await p.waitForSelector("#aiCard:not([hidden]) #aiGo");
check(await p.isChecked("#aiAuto"), "aprovação automática do catálogo vem ligada");
await p.click("#aiGo");
await p.waitForFunction(() => /aprovado\(s\) sozinho\(s\)/.test(document.getElementById("aiStatus").textContent), null, { timeout: 60000 });
const status = await p.locator("#aiStatus").innerText();
check(/3 cena\(s\) analisadas/.test(status), `a IA analisou as 3 cenas da trilha (${status.replace(/\s+/g, " ")})`);
await p.waitForFunction(() => [...document.querySelectorAll("#sceneList li .c")].every((c) => !/^0 /.test(c.textContent)), null, { timeout: 20000 });
check((await p.locator("#sceneList li").count()) === 3, "as 3 cenas do Editor continuam as mesmas");
check(/●.*Trilha Kimono.*no app/.test(await p.locator("#trackSel option:checked").innerText()), "a trilha foi salva e é a do app");
await p.click("#boardBtn");
await p.waitForSelector("#boardModal:not([hidden]) .board-scene");
const aiChips = await p.locator("#boardBody .chip.is-ai").count();
check(aiChips >= 6 && (await p.locator('.board-scene[data-bi="0"] .chip.is-ai').count()) && (await p.locator('.board-scene[data-bi="1"] .chip.is-ai').count()) && (await p.locator('.board-scene[data-bi="2"] .chip.is-ai').count()),
  `os produtos do catálogo entraram sozinhos em cada cena (${aiChips}, marca IA)`);
await shot(p, "board");
await p.click("#boardClose");
let tl = await (await fetch(`${BASE}/api/works/${work.id}/commerce-timeline`)).json();
check(tl.scenes.length === 3 && tl.scenes.every((s) => s.products.length), "o app já tem as 3 cenas com produtos");
check(apiCalls.length === 0, "nada foi preciso na aba IA & Publicação (nenhum Publicar/Sincronizar)");

// revisar as sugestões pendentes no próprio Editor
await p.click("#aiOpen");
await p.waitForSelector("#aiModal:not([hidden])");
const pend = await p.locator(".ai-item").count();
check(pend >= 3, `Revisar sugestões mostra só o que ficou pendente (${pend})`);
await shot(p, "review");
const row = p.locator(".ai-item", { hasText: "Calça" }).first();
const kim = await row.locator("select option", { hasText: "Kimono" }).first().getAttribute("value");
await row.locator("select").selectOption(kim);
await p.check("#aiRejectRest");
await p.click("#aiApply");
await p.waitForFunction(() => /aprovado\(s\): entram na trilha/.test(document.getElementById("toast").textContent), null, { timeout: 10000 });
const ws = await call(`/api/ai/workspace?workId=${work.id}`);
check(!ws.data.candidates.some((c) => c.reviewStatus === "DETECTED"), "aprovar os marcados e rejeitar o resto esvazia a fila, sem sair do Editor");

// ---------------------------------------------------------------- celular: posição do servidor, não o ?t= da URL
const sess = await (await fetch(`${BASE}/api/sessions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workId: work.id, time: 30, mode: "COMPANION" }) })).json();
const phone = await (await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "pt-BR", isMobile: true })).newPage();
phone.on("pageerror", (e) => errs.push("celular: " + e.message));
await phone.goto(`${BASE}/s/${sess.code}?t=0`);
await phone.waitForSelector("#scenes .scene", { timeout: 15000 });
check((await phone.locator("#scenes .scene").count()) === 2 && /AO VIVO/.test(await phone.locator("#scenes .scene").nth(1).innerText()), "sincronizado em 0:30, o celular abre na cena 2 mesmo com ?t=0 na URL");

// ---------------------------------------------------------------- excluir loja na aba Ofertas oficiais
await p.click(".tabs button[data-tab=ofertas]");
await p.waitForSelector("#sellersList .agreement");
const nBefore = await p.locator("#sellersList .agreement").count();
await p.locator("#sellersList .agreement", { hasText: "Urbano" }).locator("[data-del-seller]").click();
await p.waitForFunction((n) => document.querySelectorAll("#sellersList .agreement").length === n - 1, nBefore, { timeout: 10000 });
check(!/Urbano/.test(await p.locator("#sellersList").innerText()), "loja excluída pelo botão Excluir loja");

// ---------------------------------------------------------------- excluir trilha na aba Obras
await call("/api/tracks", { method: "POST", body: { workId: work.id, title: "Rascunho", offset: 0, scenes: [{ id: "c1", title: "Tudo", start: 0, end: 74, products: [] }] } });
await p.click(".tabs button[data-tab=obras]");
await p.waitForSelector(".work-tracks li");
check((await p.locator(".work", { hasText: "Kimono rc12" }).locator(".work-tracks li").count()) === 2, "a aba Obras lista as trilhas da obra, com a do app marcada");
await shot(p, "obras");
await p.locator(".work-tracks li", { hasText: "Rascunho" }).locator("[data-del-track]").click();
await p.waitForFunction(() => document.querySelectorAll(".work-tracks li").length === 1, null, { timeout: 10000 });
tl = await (await fetch(`${BASE}/api/works/${work.id}/commerce-timeline`)).json();
check(/Trilha Kimono/.test(await p.locator(".work-tracks li").innerText()) && tl.scenes.length === 3, "trilha excluída na aba Obras; o app volta para a Trilha Kimono");

check(!errs.length, "sem erros de JavaScript" + (errs.length ? ": " + errs.join(" | ") : ""));
await browser.close();
mock.close();
console.log(process.exitCode ? "\nrcprep.12 (navegador): FALHOU" : "\nrcprep.12 (navegador): tudo certo");
