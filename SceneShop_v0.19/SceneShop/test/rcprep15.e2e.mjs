// rcprep.15 no navegador: criar conta escolhendo a classe do operador (Produtor por padrão),
// produtos por projeto na aba Produtos (puxar de outro projeto), busca do Editor separada por projeto,
// trocar a classe da organização e excluir obra na aba Obras.
//   DEMO=1 npm start  ·  node test/rcprep15.e2e.mjs
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.BASE || "http://localhost:3000";
const OUT = process.env.OUT || null;
const FIX = path.join(path.dirname(new URL(import.meta.url).pathname), "fixtures", "ai");
const check = (cond, msg) => { if (!cond) { console.log("✗ FALHOU:", msg); process.exitCode = 1; } else console.log("  ✓", msg); };
const prodNames = (pg) => pg.evaluate(() => [...document.querySelectorAll("#myProducts input[name=name]")].map((i) => i.value).join(" | "));
const shot = async (p, name) => { if (OUT) await p.screenshot({ path: path.join(OUT, `rc15-${name}.png`), fullPage: false }); };

await fetch(`${BASE}/api/dev/reset?all=1`, { method: "POST" });
const browser = await chromium.launch();
const p = await (await browser.newContext({ viewport: { width: 1440, height: 950 }, locale: "pt-BR" })).newPage();
const errs = [];
p.on("pageerror", (e) => errs.push(e.message));
p.on("dialog", (d) => d.accept());
await p.goto(`${BASE}/studio.html`);
await p.waitForSelector("#login:not([hidden])");
check((await p.inputValue("#loginKind")) === "PRODUCER", "tela de entrada: classe do operador com Produtor como padrão");
await shot(p, "login");
const user = "miguel_e2e" + Date.now().toString(36).slice(-4);
await p.fill("#loginUser", user); await p.fill("#loginPass", "senha-forte-123");
await p.click("#loginForm [data-mode=signup]");
await p.waitForFunction(() => !!localStorage.getItem("ss-studio-org"), null, { timeout: 15000 });
await p.waitForSelector(".tabs button[data-tab=obras]:not([hidden])");
const orgs = await p.evaluate(async () => (await fetch("/api/me/organizations", { headers: { authorization: "Bearer " + localStorage.getItem("ss-studio-token") } })).json());
const ctx = { organization: orgs[0] };
check(ctx.organization && ctx.organization.kind === "PRODUCER", `conta criada como Produtor (organização ${ctx.organization && ctx.organization.kind})`);
const token = await p.evaluate(() => localStorage.getItem("ss-studio-token"));
const call = async (u, { method = "GET", body, raw, type } = {}) => {
  const r = await fetch(BASE + u, { method, headers: { Authorization: `Bearer ${token}`, "x-sceneshop-organization": ctx.organization.id, ...(raw ? { "Content-Type": type || "application/octet-stream" } : body ? { "Content-Type": "application/json" } : {}) }, body: raw || (body ? JSON.stringify(body) : undefined) });
  return { status: r.status, data: await r.json().catch(() => ({})) };
};

// dois projetos com produtos próprios
const v1 = await call("/api/uploads/video?filename=kimono.webm", { method: "POST", raw: fs.readFileSync(path.join(FIX, "kimono.webm")) });
const A = (await call("/api/works", { method: "POST", body: { title: "Bond A", video: v1.data.url, duration: 74.2 } })).data;
const v2 = await call("/api/uploads/video?filename=kimono.webm", { method: "POST", raw: fs.readFileSync(path.join(FIX, "kimono.webm")) });
const B = (await call("/api/works", { method: "POST", body: { title: "Medina B", video: v2.data.url, duration: 74.2 } })).data;
await call("/api/products", { method: "POST", body: { name: "Relógio Omega", brand: "Omega", referencePrice: "1000,00", workId: A.id } });
await call("/api/products", { method: "POST", body: { name: "Jaqueta Oakley", brand: "Oakley", referencePrice: "800,00", workId: B.id } });
await p.reload();
await p.waitForSelector(".tabs button[data-tab=produtos]:not([hidden])");

// ---------------------------------------------------------------- aba Produtos por projeto
await p.click(".tabs button[data-tab=produtos]");
await p.waitForFunction(() => document.querySelectorAll("#prodProject option").length >= 2);
await p.selectOption("#prodProject", A.id);
await p.waitForFunction(() => [...document.querySelectorAll("#myProducts input[name=name]")].some((i) => /Relógio Omega/.test(i.value)));
check(!/Jaqueta Oakley/.test(await prodNames(p)), "Projeto Bond A mostra só os produtos dele");
check(/Jaqueta Oakley/.test(await p.locator("#prodPull").innerText()), "a jaqueta do outro projeto aparece em Puxar de outro projeto");
const jid = await p.evaluate(() => [...document.querySelectorAll("#prodPull option")].find((o) => /Jaqueta/.test(o.textContent)).value);
await p.selectOption("#prodPull", jid);
await p.click("#prodPullBtn");
await p.waitForFunction(() => [...document.querySelectorAll("#myProducts input[name=name]")].some((i) => /Jaqueta Oakley/.test(i.value)), null, { timeout: 10000 });
check(true, "jaqueta puxada para o Bond A");
await shot(p, "produtos");
await p.selectOption("#prodProject", B.id);
await p.waitForFunction(() => { const v = [...document.querySelectorAll("#myProducts input[name=name]")].map((i) => i.value).join("|"); return /Jaqueta Oakley/.test(v) && !/Relógio Omega/.test(v); });
check(true, "Medina B continua só com a jaqueta (o relógio do Bond A não entra)");

// ---------------------------------------------------------------- Editor: busca separada por projeto
await p.click(".tabs button[data-tab=editor]");
await p.selectOption("#work", B.id);
await p.waitForTimeout(800);
await p.fill("#prodSearch", "o");
await p.waitForSelector("#results:not([hidden]) li[data-id]");
const res = await p.locator("#results").innerText();
check(/Jaqueta Oakley/.test(res) && /Relógio Omega[\s\S]*outro projeto/.test(res), "Editor do Medina B: jaqueta do projeto; o relógio aparece marcado como de outro projeto");

// ---------------------------------------------------------------- Equipe & Segurança: classe da organização
await p.click(".tabs button[data-tab=equipe]");
await p.waitForSelector("#orgSecurityCard:not([hidden])");
check((await p.inputValue("#orgKindSel")) === "PRODUCER", "Equipe & Segurança mostra a classe da organização");
await p.selectOption("#orgKindSel", "CHANNEL");
await p.click("#saveOrgKind");
await p.waitForFunction(() => /Classe salva/.test(document.getElementById("orgKindMsg").textContent));
const ctx2 = await call("/api/me/context");
check(ctx2.data.organization.kind === "CHANNEL", "classe trocada para Canal / emissora");

// ---------------------------------------------------------------- excluir obra
await p.click(".tabs button[data-tab=obras]");
await p.waitForSelector(`[data-del-work="${B.id}"]`);
await shot(p, "obras");
await p.click(`[data-del-work="${B.id}"]`);
await p.waitForFunction((id) => !document.querySelector(`[data-del-work="${id}"]`), B.id, { timeout: 10000 });
const works = await call("/api/me/works");
check(!works.data.some((w) => w.id === B.id) && works.data.some((w) => w.id === A.id), "obra Medina B excluída pelo botão Excluir obra; Bond A continua");
check(!(await p.locator("#work option").allInnerTexts()).some((t) => /Medina B/.test(t)), "a obra excluída some também do Editor");

check(!errs.length, "sem erros de JavaScript" + (errs.length ? ": " + errs.join(" | ") : ""));
await browser.close();
console.log(process.exitCode ? "\nrcprep.15 (navegador): FALHOU" : "\nrcprep.15 (navegador): tudo certo");
