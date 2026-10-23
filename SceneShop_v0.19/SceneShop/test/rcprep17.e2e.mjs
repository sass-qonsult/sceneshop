// rcprep.17 no navegador:
//  celular — as cenas SEM produtos também aparecem (o celular segue o vídeo sem saltos) com o aviso
//  "Nenhum produto nesta cena";
//  estúdio — conciliação em cascata: cliente/canal › título › produto › pedidos (console Clientes e Relatório da conta).
//   DEMO=1 npm start  ·  node test/rcprep17.e2e.mjs
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.BASE || "http://localhost:3000";
const OUT = process.env.OUT || null;
const FIX = path.join(path.dirname(new URL(import.meta.url).pathname), "fixtures", "ai");
const check = (cond, msg) => { if (!cond) { console.log("✗ FALHOU:", msg); process.exitCode = 1; } else console.log("  ✓", msg); };
const shot = async (p, name) => { if (OUT) await p.screenshot({ path: path.join(OUT, `rc17-${name}.png`) }); };

await fetch(`${BASE}/api/dev/reset?all=1`, { method: "POST" });
const login = async (u) => (await (await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: u, password: "demo1234" }) })).json()).token;
const token = await login("produtora");
const ORG = "org-demo-produtora";
const call = async (u, { method = "GET", body, raw } = {}) => {
  const r = await fetch(BASE + u, { method, headers: { authorization: `Bearer ${token}`, "x-sceneshop-organization": ORG, ...(raw ? { "content-type": "video/webm" } : body ? { "content-type": "application/json" } : {}) }, body: raw || (body ? JSON.stringify(body) : undefined) });
  return { status: r.status, data: await r.json().catch(() => ({})) };
};

// título com 3 cenas: só a do meio tem produto
const up = await call("/api/uploads/video?filename=kimono.webm", { method: "POST", raw: fs.readFileSync(path.join(FIX, "kimono.webm")) });
const work = (await call("/api/works", { method: "POST", body: { title: "Cenas sem produto", video: up.data.url, duration: 74 } })).data;
const prod = (await call("/api/products", { method: "POST", body: { name: "Relógio Aurora", brand: "Aurora", referencePrice: "990,00", workId: work.id } })).data;
const tr = await call("/api/tracks", { method: "POST", body: { workId: work.id, title: "Oficial", offset: 0, scenes: [
  { id: "c1", title: "Abertura", start: 0, end: 20, products: [] },
  { id: "c2", title: "Relógio na mesa", start: 20, end: 40, products: [{ id: prod.id }] },
  { id: "c3", title: "Final", start: 40, end: 74, products: [] },
] } });
check(tr.status === 201 && tr.data.track.type === "official", "trilha oficial com 3 cenas, só a do meio com produto");
const tl = await call(`/api/works/${work.id}/commerce-timeline`);
check(tl.status === 200 && tl.data.scenes.filter((x) => x.products.length).length === 1, `Commerce Timeline publicada (${tl.data.scenes.length} cena(s); no PostgreSQL só as com produto)`);

const session = await (await fetch(`${BASE}/api/sessions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ workId: work.id, time: 50 }) })).json();
const browser = await chromium.launch();
const errs = [];
const m = await (await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: "pt-BR" })).newPage();
m.on("pageerror", (e) => errs.push(e.message));
await m.goto(`${BASE}/s/${session.code}`);
await m.waitForSelector("#scenes .scene");
await m.waitForTimeout(800);
const strip = await m.evaluate(() => [...document.querySelectorAll("#scenes .scene .label")].map((x) => x.textContent.trim()));
check(strip.length === 3 && /Abertura/.test(strip[0]) && /Relógio/.test(strip[1]) && /Final/.test(strip[2]), `celular mostra as 3 cenas em sequência, com e sem produtos: ${strip.join(" | ")}`);
check(/Nenhum produto nesta cena/.test(await m.locator("#list").innerText()) && /Final/.test(await m.locator("#list .list-head").innerText()), "na cena ao vivo sem produto: \"Nenhum produto nesta cena\"");
await shot(m, "cena-sem-produto");
await m.locator("#scenes .scene").nth(1).click();
await m.waitForSelector("#list .card");
check(/Relógio Aurora/.test(await m.locator("#list").innerText()), "a cena com produto continua mostrando o produto");
await m.locator("#scenes .scene").nth(0).click();
await m.waitForTimeout(300);
check(/Nenhum produto nesta cena/.test(await m.locator("#list").innerText()), "explorar uma cena anterior sem produto também funciona");

// ---------------------------------------------------------------- estúdio: cascata
const s = await (await browser.newContext({ viewport: { width: 1440, height: 950 }, locale: "pt-BR" })).newPage();
s.on("pageerror", (e) => errs.push(e.message));
await s.goto(`${BASE}/studio.html`);
await s.waitForSelector("#login:not([hidden])");
await s.fill("#loginUser", "moderador"); await s.fill("#loginPass", "demo1234");
await s.click("#loginForm [data-mode=login]");
await s.waitForSelector(".tabs button[data-tab=clientes]:not([hidden])");
await s.click(".tabs button[data-tab=clientes]");
await s.waitForSelector(`#cliList [data-tree="c:${ORG}"]`);
await s.selectOption("#cliPeriod", "");
await s.waitForSelector(`#cliList [data-tree="c:${ORG}"]`);
await s.click(`#cliList [data-tree="c:${ORG}"]`);
await s.waitForSelector(`#cliList [data-tree="c:${ORG}/w:demo-01"]`);
check(/Cidade em Cenas/.test(await s.locator("#cliList").innerText()), "Clientes: abrir o cliente mostra os títulos dele");
await s.click(`#cliList [data-tree="c:${ORG}/w:demo-01"]`);
await s.waitForSelector(`#cliList tr.tree-l2 [data-tree^="c:${ORG}/w:demo-01/p:"]`);
const nProducts = await s.locator("#cliList tr.tree-l2").count();
check(nProducts >= 2, `abrir o título mostra os produtos dele (${nProducts})`);
await s.locator(`#cliList tr.tree-l2 [data-tree]`).first().click();
await s.waitForSelector("#cliList tr.tree-l3 .orders-sub tbody tr");
check(await s.locator("#cliList .orders-sub tbody tr").count() >= 1, "abrir o produto mostra os pedidos (data, loja, pedido, valor, comissão, situação)");
check(!/object Object|NaN|undefined/.test(await s.locator("#cliList").innerText()), "números da cascata sem valores quebrados");
await shot(s, "cascata");

// cliente: a própria conta em cascata
const pr = await (await browser.newContext({ viewport: { width: 1440, height: 950 }, locale: "pt-BR" })).newPage();
pr.on("pageerror", (e) => errs.push(e.message));
await pr.goto(`${BASE}/studio.html`);
await pr.waitForSelector("#login:not([hidden])");
await pr.fill("#loginUser", "produtora"); await pr.fill("#loginPass", "demo1234");
await pr.click("#loginForm [data-mode=login]");
await pr.waitForSelector(".tabs button[data-tab=moderacao][hidden]", { state: "attached" });
await pr.click(".tabs button[data-tab=piloto]");
await pr.selectOption("#acctPeriod", "");
await pr.waitForSelector('#acctWorks [data-tree="me/w:demo-01"]');
await pr.click('#acctWorks [data-tree="me/w:demo-01"]');
await pr.waitForSelector("#acctWorks tr.tree-l2");
await pr.locator("#acctWorks tr.tree-l2 [data-tree]").first().click();
await pr.waitForSelector("#acctWorks .orders-sub");
check(true, "Relatório da conta do cliente: título › produto › pedidos");

check(!errs.length, "sem erros de JavaScript" + (errs.length ? ": " + errs.join(" | ") : ""));
await browser.close();
console.log(process.exitCode ? "\nrcprep.17 (navegador): FALHOU" : "\nrcprep.17 (navegador): tudo certo");
