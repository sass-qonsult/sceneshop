// Teste ponta a ponta da MARCAÇÃO COM IA contra o SIMULADOR do Gemini (test/gemini-mock.mjs).
// Rodar o servidor apontando para o simulador:
//   GEMINI_BASE=http://127.0.0.1:3999 GEMINI_API_KEY=AIzaSyTESTE-simulador-0000000000000 GEMINI_POLL_MS=200 npm start
//   node test/ai.e2e.mjs
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { start, KEY } from "./gemini-mock.mjs";

const BASE = process.env.BASE || "http://localhost:3000";
const OUT = process.env.OUT || ".";
const FIX = path.join(path.dirname(new URL(import.meta.url).pathname), "fixtures", "ai");
const check = (cond, msg) => { if (!cond) { console.log("✗ FALHOU:", msg); process.exitCode = 1; } else console.log("  ✓", msg); };
const log = (...a) => console.log("•", ...a);

const mock = await start(3999);
await fetch(`${BASE}/api/dev/reset?all=1`, { method: "POST" });
const call = async (p, { method = "GET", body, raw, type } = {}) => {
  const r = await fetch(BASE + p, { method, headers: { Authorization: `Bearer ${token}`, ...(raw ? { "Content-Type": type || "application/octet-stream" } : body ? { "Content-Type": "application/json" } : {}) }, body: raw || (body ? JSON.stringify(body) : undefined) });
  return { status: r.status, data: await r.json().catch(() => ({})) };
};
let token = (await (await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: "produtora", password: "demo1234" }) })).json()).token;


// ---------------------------------------------------------------- obra e catálogo pela API
const vid = await call("/api/uploads/video?filename=kimono.webm", { method: "POST", raw: fs.readFileSync(path.join(FIX, "kimono.webm")) });
const work = (await call("/api/works", { method: "POST", body: { title: "Kimono: 4 jeitos de usar", video: vid.data.url, duration: 74.2 } })).data;
const CAT = [
  ["Kimono-Maria-Filo-1.jpg", "Kimono Maria Filó floral", "Maria Filó", "189,90"],
  ["Top-Pietie-Vermelho-1.jpg", "Top Pietie vermelho", "Pietie", "69,90"],
  ["Saia-NV-Pink-1.jpg", "Saia NV pink", "NV", "289,90"],
  ["Calca-Animale-Alfaiataria-1.jpg", "Calça Animale alfaiataria", "Animale", "289,90"],
  ["Calca-Iorane-Cargo-1.jpg", "Calça Iorane cargo", "Iorane", "219,90"],
];
const prods = {};
for (const [file, name, brand, price] of CAT) {
  const img = await call(`/api/uploads/image?filename=${file}`, { method: "POST", raw: fs.readFileSync(path.join(FIX, file)) });
  const p = (await call("/api/products", { method: "POST", body: { name, brand, category: "Moda", referencePrice: price, images: [img.data.url] } })).data;
  prods[brand] = p.id;
}
check(work.id && Object.keys(prods).length === 5, "Obra e 5 produtos cadastrados");

// ---------------------------------------------------------------- estúdio
const browser = await chromium.launch();
const errs = [];
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
page.on("pageerror", (e) => errs.push(e.message));
await page.addInitScript((t) => localStorage.setItem("ss-studio-token", t), token);
await page.addInitScript((w) => localStorage.setItem("ss-studio-work", w), work.id);
await page.goto(`${BASE}/studio.html`);
await page.waitForSelector(".tabs button[data-tab=obras]:not([hidden])");
await page.click(".tabs button[data-tab=editor]");
await page.waitForSelector("#aiCard:not([hidden])");
check(!(await page.isVisible("#aiKeyBox")), "Studio não pede nem armazena chave de IA no navegador");
await page.waitForSelector("#aiRun:not([hidden])");

// ---------------------------------------------------------------- análise com cortes
await page.selectOption("#aiMode", "cenas");
await page.click("#aiGo");
await page.waitForSelector("#aiStatus .spin");
check(true, "Análise em andamento: " + (await page.textContent("#aiStatus")));
await page.waitForSelector("#aiOpen", { timeout: 30000 });
log("status:", await page.textContent("#aiStatus"));
check(/7 cena\(s\) · 15 item\(ns\) · 13 com produto/.test(await page.textContent("#aiStatus")), "Gemini devolveu 7 cenas, 15 itens, 13 associados ao catálogo");
await page.click("#aiOpen");
await page.waitForSelector("#aiModal:not([hidden]) .ai-item");
await page.waitForTimeout(2500);
const rows = page.locator(".ai-item");
check((await rows.count()) === 15, "Revisão lista os 15 itens");
check((await page.locator(".ai-item input[type=checkbox]:checked").count()) === 13, "Itens com produto e confiança ≥ 50% vêm marcados; sem produto vêm desmarcados");
check(await page.locator(".ai-item", { hasText: "Kimono Maria Filó · Tam: G" }).count() === 1, "Texto da etiqueta na tela (marca, tamanho, preço) aparece na sugestão");
check(await page.locator(".conf.mid").count() === 1, "Associação incerta (calça marrom → Iorane, 58%) aparece em amarelo para revisão");
const drawn = await page.evaluate(() => [...document.querySelectorAll(".ai-item canvas")].filter((c) => { const d = c.getContext("2d").getImageData(132, 132, 1, 1).data; return d[0] + d[1] + d[2] > 0; }).length);
check(drawn >= 12, `Miniaturas recortadas do vídeo na posição do item (${drawn}/15)`);
await page.screenshot({ path: `${OUT}/ai-1-revisao.png` });

// a pessoa corrige: a calça marrom do look 1 não é a Iorane -> desmarca
const calca = page.locator(".ai-item", { hasText: "Calça pantalona marrom" });
await calca.locator("input[type=checkbox]").uncheck();
// o cinto não está no catálogo -> cria um rascunho de produto com a imagem do vídeo
await page.locator(".ai-item", { hasText: "Cinto de elos dourados" }).locator("[data-create]").click();
await page.waitForSelector("#tab-produtos:not([hidden]) #drafts form.pedit");
const draftName = await page.inputValue("#drafts form.pedit [name=name]");
const draftImg = await page.getAttribute("#drafts form.pedit img.main", "src");
check(draftName === "Cinto de elos dourados" && /^\/uploads\/images\//.test(draftImg), "Item sem produto vira rascunho com nome e imagem recortada do vídeo");
await page.fill("#drafts form.pedit [name=referencePrice]", "129,90");
await page.fill("#drafts form.pedit [name=brand]", "Casa Bossa");
await page.click("#drafts form.pedit button.primary");
await page.waitForFunction(() => !document.querySelector("#drafts form.pedit"));

// volta ao editor, reabre as sugestões e associa o cinto ao produto recém-criado
await page.click(".tabs button[data-tab=editor]");
await page.click("#aiOpen");
await page.waitForSelector("#aiModal:not([hidden]) .ai-item");
const cinto = page.locator(".ai-item").filter({ has: page.locator(".nm", { hasText: "Cinto de elos dourados" }) });
const cintoId = await cinto.locator("select option", { hasText: "Cinto de elos dourados" }).first().getAttribute("value");
await cinto.locator("select").selectOption(cintoId);
await page.locator(".ai-item", { hasText: "Calça pantalona marrom" }).locator("input[type=checkbox]").uncheck();
check(await cinto.locator("input[type=checkbox]").isChecked(), "Escolher o produto marca a sugestão");
await page.click("#aiApply");
await page.waitForTimeout(500);
check((await page.locator("#sceneList li").count()) === 7, "Cenas sugeridas aplicadas (7)");
const sc = await page.evaluate(() => [...document.querySelectorAll("#sceneList li")].map((li) => li.textContent.replace(/\s+/g, " ").trim()));
log("cenas:", sc);
await page.locator("#sceneList li").nth(1).click();
await page.waitForTimeout(300);
check((await page.locator("#boxes .bx").count()) === 2, "Look 1: kimono e top com a posição marcada pelo Gemini (calça desmarcada ficou de fora)");
await page.screenshot({ path: `${OUT}/ai-2-aplicado.png` });
await page.click("#saveBtn");
await page.waitForFunction(() => /publicada/.test(document.getElementById("msg").textContent));
const pub = await (await fetch(`${BASE}/api/works/${work.id}`)).json();
const total = pub.scenes.reduce((a, s) => a + s.products.length, 0);
check(pub.scenes.length === 7 && total === 13, `Trilha publicada com 7 cenas e 13 produtos (${total})`);
check(pub.scenes[1].products.every((p) => p.box && p.box.w > 0), "Produtos publicados com a posição na imagem");
check(pub.scenes[2].products.some((p) => p.name === "Cinto de elos dourados"), "Cinto criado a partir do vídeo publicado no look 2");

// ---------------------------------------------------------------- análise em cena única
await page.selectOption("#aiMode", "unica");
await page.click("#aiGo");
await page.waitForSelector("#aiStatus .spin");
await page.waitForSelector("#aiOpen", { timeout: 30000 });
check(/1 cena\(s\) · 7 item\(ns\)/.test(await page.textContent("#aiStatus")), "Modo cena única: 1 cena e itens sem repetição (" + (await page.textContent("#aiStatus")) + ")");

// o trabalho fica salvo e a chave nunca volta para o navegador
const st = await call("/api/ai/status");
check(st.data.configured && !JSON.stringify(st.data).includes(KEY), "Status não expõe a chave");
const other = await (await fetch(`${BASE}/api/works/${work.id}/ai`)).status;
check(other === 401, "Sugestões exigem login da produtora");

check(!errs.length, "Sem erros de JavaScript" + (errs.length ? ": " + errs.join(" | ") : ""));
await browser.close();
mock.close();
