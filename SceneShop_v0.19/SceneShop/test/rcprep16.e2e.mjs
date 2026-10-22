// rcprep.16 no navegador:
//  celular — início com a marca SceneShop em preto e botão grande; Código / QR code (câmera) / Link; menu com o
//  que ficava no topo; histórico; sincronização que continua ao reabrir o app até tocar em Parar; cenas que
//  passaram enquanto o app estava em segundo plano;
//  estúdio — console de Clientes (equipe SceneShop) com contrato e relatório; Relatório da conta para o cliente.
//   DEMO=1 npm start  ·  node test/rcprep16.e2e.mjs
import { chromium } from "playwright";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const QRCode = require("qrcode");
const BASE = process.env.BASE || "http://localhost:3000";
const OUT = process.env.OUT || null;
const check = (cond, msg) => { if (!cond) { console.log("✗ FALHOU:", msg); process.exitCode = 1; } else console.log("  ✓", msg); };
const shot = async (p, name) => { if (OUT) await p.screenshot({ path: path.join(OUT, `rc16-${name}.png`) }); };
const newSession = async (time = 40) => (await (await fetch(`${BASE}/api/sessions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ workId: "demo-01", time }) })).json());

await fetch(`${BASE}/api/dev/reset?all=1`, { method: "POST" });

// câmera falsa mostrando o QR code de uma sessão (como o da TV)
const qrSession = await newSession(30);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rc16-"));
const png = path.join(dir, "qr.png"), y4m = path.join(dir, "qr.y4m");
await QRCode.toFile(png, `${BASE}/s/${qrSession.code}?t=30`, { width: 480, margin: 4 });
const ff = spawnSync("ffmpeg", ["-v", "error", "-y", "-loop", "1", "-i", png, "-t", "3", "-vf", "scale=640:480:force_original_aspect_ratio=decrease,pad=640:480:(ow-iw)/2:(oh-ih)/2:white,format=yuv420p", "-r", "10", y4m]);
if (ff.status !== 0) throw new Error(String(ff.stderr));

const browser = await chromium.launch({ args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-video-capture=${y4m}`] });
const errs = [];
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: "pt-BR" });
await ctx.grantPermissions(["camera", "microphone"], { origin: BASE });
const m = await ctx.newPage();
m.on("pageerror", (e) => errs.push(e.message));
m.on("dialog", (d) => d.accept());

// ---------------------------------------------------------------- início
await m.goto(`${BASE}/mobile`);
await m.waitForSelector("#join:not([hidden])");
check(await m.evaluate(() => /sceneshop-lockup-black\.svg$/.test(document.querySelector(".home-logo").getAttribute("src"))), "início mostra a marca SceneShop em preto");
const big = await m.locator("#syncNow").boundingBox();
check(big && big.width >= 200 && big.height >= 200, `botão grande de sincronizar no centro (${Math.round(big.width)}px)`);
check(await m.locator(".home-options .opt").count() === 3 && /Código/.test(await m.locator("#optCode").innerText()) && /QR code/.test(await m.locator("#optQr").innerText()) && /Link/.test(await m.locator("#optLink").innerText()),
  "abaixo do botão: Código, QR code e Link");
check(await m.locator(".app-rail").isHidden(), "os botões que ficavam soltos no topo (Web/Desktop/Mobile, instalar, compartilhar…) não aparecem mais na tela");
await shot(m, "home");
await m.click("#optCode");
check(await m.locator("#joinForm").isVisible(), "Código abre o campo para digitar o código da TV");

// ---------------------------------------------------------------- QR code pela câmera
await m.click("#optQr");
await m.waitForURL(new RegExp(`/s/${qrSession.code}`), { timeout: 20000 });
check(true, `QR code lido pela câmera: conectou na sessão ${qrSession.code}`);
await m.waitForFunction(() => document.querySelector("#workTitle").textContent.trim().length > 2);
check(await m.locator("#stopSync").isVisible(), "sincronizado: botão Parar ao lado do título");
const active = await m.evaluate(() => JSON.parse(localStorage.getItem("ss-active") || "null"));
check(active && active.code === qrSession.code, "a sincronização fica marcada como ativa no aparelho");

// ---------------------------------------------------------------- menu
await m.click("#menuBtn");
await m.waitForSelector("#menu:not([hidden])");
const menuText = await m.locator("#menu").innerText();
check(/Início e histórico/.test(menuText) && /Idioma/.test(menuText) && /Parar sincronização/.test(menuText), "menu (⋯) reúne início/histórico, idioma, compartilhar, notificações e Parar");
await shot(m, "menu");
await m.click("#menuClose");

// ---------------------------------------------------------------- segundo plano: cenas que passaram
// simula 25 s fora do app: o vídeo andou na TV; ao voltar, o celular mostra as cenas com produtos que passaram
await m.evaluate(() => window.dispatchEvent(new CustomEvent("sceneshop:app-lifecycle", { detail: { state: "BACKGROUND" } })));
// a TV (outra aba) avança a reprodução de 30 s para 55 s
const tvPage = await (await browser.newContext()).newPage();
await tvPage.goto(`${BASE}/api/health`);
await tvPage.addScriptTag({ url: `${BASE}/socket.io/socket.io.js` });
const tvOk = await tvPage.evaluate(({ code, token }) => new Promise((resolve) => {
  const sock = io(); window.tvSock = sock;
  sock.on("connect", () => sock.emit("tv:attach", { code, controllerToken: token }, (ack) => { sock.emit("player:tick", { time: 55, playing: true }); setTimeout(() => resolve(ack && ack.ok), 400); }));
}), { code: qrSession.code, token: qrSession.controllerToken });
check(tvOk, "TV conectada à sessão e avançou o vídeo enquanto o celular estava em segundo plano");
await new Promise((r) => setTimeout(r, 600));
await m.evaluate(() => window.dispatchEvent(new CustomEvent("sceneshop:app-lifecycle", { detail: { state: "FOREGROUND" } })));
await m.waitForTimeout(1500);
const missed = await m.evaluate(() => ({ hidden: document.getElementById("missed").hidden, title: document.getElementById("missedTitle").textContent, n: document.querySelectorAll("#missedScenes [data-missed-scene]").length, status: document.getElementById("statusText").textContent }));
check(!missed.hidden && /estava fora/.test(missed.title) && missed.n >= 1, `ao voltar: "${missed.title}" com ${missed.n} cena(s) que passaram (${missed.status})`);
await shot(m, "away");
await tvPage.close();

// ---------------------------------------------------------------- reabrir o app: volta para a mesma sincronização
await m.goto(`${BASE}/mobile`);
await m.waitForURL(new RegExp(`/s/${qrSession.code}`), { timeout: 10000 });
check(true, "reabrir o app (o sistema fechou em segundo plano) volta direto para a sincronização ativa");

// início sem sair da sincronização
await m.click("#homeBtn");
await m.waitForSelector("#join:not([hidden])");
check(await m.locator("#activeCard").isVisible() && /Cidade em Cenas/.test(await m.locator("#activeTitle").innerText()), "o início mostra \"Sincronizado agora\" com o título");
check(await m.locator("[data-history]").count() >= 1, "histórico mostra o título sincronizado");
await shot(m, "home-active");
await m.click("#activeCard");
check(await m.locator("#join").isHidden(), "Voltar retorna para a trilha sem sincronizar de novo");

// ---------------------------------------------------------------- outro vídeo: o anterior fica no histórico
await m.click("#stopSync");
await m.waitForURL(/home=1/);
await m.waitForSelector("#join:not([hidden])");
check(!(await m.evaluate(() => localStorage.getItem("ss-active"))), "Parar encerra a sincronização");
check(await m.locator("#activeCard").isHidden(), "depois de Parar, o início não mostra sincronização ativa");
await m.goto(`${BASE}/mobile`);
await m.waitForSelector("#join:not([hidden])");
check(/\/mobile$/.test(m.url()), "depois de Parar, abrir o app não reconecta sozinho");

// ---------------------------------------------------------------- histórico: comprar depois sem sincronizar
await m.click("[data-history]");
await m.waitForURL(/\?h=demo-01/);
await m.waitForSelector("#list .card");
const hist = await m.evaluate(() => ({ status: document.getElementById("statusText").textContent, cards: document.querySelectorAll("#list .card").length, offers: document.querySelectorAll("#list .offer").length, scenes: document.querySelectorAll("#scenes .scene").length }));
check(/Histórico/.test(hist.status) && hist.cards >= 1 && hist.offers >= 1 && hist.scenes >= 2, `histórico abre as cenas e produtos já vistos (${hist.scenes} cenas, ${hist.cards} produtos) sem sincronizar`);
await shot(m, "history");

// sessão expirada: o código antigo leva ao histórico
await m.evaluate((code) => { const h = JSON.parse(localStorage.getItem("ss-history")); h[0].code = "ZZZZZZ"; localStorage.setItem("ss-history", JSON.stringify(h)); }, qrSession.code);
await m.goto(`${BASE}/s/ZZZZZZ`);
await m.waitForURL(/\?h=demo-01&expired=1/);
check(true, "link de sessão expirada que está no histórico abre o histórico do título");

// ---------------------------------------------------------------- estúdio: console de clientes
const s = await (await browser.newContext({ viewport: { width: 1440, height: 950 }, locale: "pt-BR" })).newPage();
s.on("pageerror", (e) => errs.push(e.message));
s.on("dialog", (d) => d.accept());
await s.goto(`${BASE}/studio.html`);
await s.waitForSelector("#login:not([hidden])");
await s.fill("#loginUser", "moderador"); await s.fill("#loginPass", "demo1234");
await s.click("#loginForm [data-mode=login]");
await s.waitForSelector(".tabs button[data-tab=clientes]:not([hidden])");
await s.click(".tabs button[data-tab=clientes]");
await s.waitForSelector("#cliList [data-client]");
await s.selectOption("#cliPeriod", "");
await s.waitForTimeout(400);
check(await s.locator("#cliList [data-client]").count() >= 3, "Clientes: todas as contas listadas com os números de cada uma");
await s.click("#cliList [data-client='org-demo-produtora']");
await s.waitForSelector("#cliDetail:not([hidden]) #cliWorks tr");
check(/Cidade em Cenas/.test(await s.locator("#cliWorks").innerText()), "detalhe do cliente: números por título");
await s.fill("#cliContract [name=contractRef]", "NETFLIX-BR-01");
await s.fill("#cliContract [name=def_commissionRate]", "12");
await s.fill("#cliContract [name=def_ownerShareRate]", "60");
await s.fill("#cliWorkTerms [data-wterm=demo-01] [name=commissionRate]", "8");
await s.selectOption("#cliAddProduct", { index: 1 });
await s.fill("#cliProductTerms tr:first-child [name=commissionRate]", "20");
await s.click("#cliContract button[type=submit]");
await s.waitForFunction(() => /Versão 1/.test(document.getElementById("cliMsg").textContent), null, { timeout: 8000 });
check(/NETFLIX-BR-01/.test(await s.locator("#cliList").innerText()), "contrato salvo e mostrado na lista de clientes");
await shot(s, "clients");
const t = await s.evaluate(() => localStorage.getItem("ss-studio-token"));
const c = await (await fetch(`${BASE}/api/admin/clients/org-demo-produtora`, { headers: { authorization: `Bearer ${t}` } })).json();
check(c.contract.terms.commissionRate === 0.12 && c.contract.terms.ownerShareRate === 0.6 && c.contract.works["demo-01"].commissionRate === 0.08 && Object.values(c.contract.products)[0].commissionRate === 0.2,
  "contrato gravado: 12% / 60% padrão, 8% no título, 20% no produto");

// cliente vê o próprio relatório
const pr = await (await browser.newContext({ viewport: { width: 1440, height: 950 }, locale: "pt-BR" })).newPage();
pr.on("pageerror", (e) => errs.push(e.message));
await pr.goto(`${BASE}/studio.html`);
await pr.waitForSelector("#login:not([hidden])");
await pr.fill("#loginUser", "produtora"); await pr.fill("#loginPass", "demo1234");
await pr.click("#loginForm [data-mode=login]");
await pr.waitForSelector(".tabs button[data-tab=piloto]:not([hidden])");
await pr.waitForSelector(".tabs button[data-tab=moderacao][hidden]", { state: "attached" });
await pr.click(".tabs button[data-tab=piloto]");
await pr.waitForSelector("#acctWorks tr");
check(await pr.locator(".tabs button[data-tab=clientes]").isHidden(), "o cliente não vê a aba Clientes");
await pr.selectOption("#acctPeriod", "");
await pr.waitForTimeout(500);
check(/NETFLIX-BR-01/.test(await pr.locator("#acctContract").innerText()) && /Cidade em Cenas/.test(await pr.locator("#acctWorks").innerText()), "Desempenho → Relatório da conta: contrato e números por título");
await shot(pr, "account");

// ---------------------------------------------------------------- carteira do celular no checkout (Google Pay simulado)
const wctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: "pt-BR" });
await wctx.addInitScript(() => {
  // Payment Request do Google Pay como num Android com cartão na Carteira do Google (ambiente de teste)
  window.PaymentRequest = class {
    constructor(methods, details) { this.methods = methods; this.details = details; }
    async canMakePayment() { return this.methods.some((m) => m.supportedMethods === "https://google.com/pay"); }
    async show() { window.__walletShown = { method: this.methods[0].supportedMethods, total: this.details.total.amount.value, gateway: this.methods[0].data.allowedPaymentMethods[0].tokenizationSpecification.parameters.gateway };
      return { details: { paymentMethodData: { tokenizationData: { type: "PAYMENT_GATEWAY", token: JSON.stringify({ protocolVersion: "ECv2", signature: "TEST", signedMessage: "{}" }) }, info: { cardNetwork: "VISA", cardDetails: "1111" } } }, complete: async () => {} }; }
  };
  localStorage.setItem("mkt-cart", JSON.stringify([{ produto: "jaqueta-couro", qty: 1 }]));
});
const mp = await wctx.newPage();
mp.on("pageerror", (e) => errs.push(e.message));
await mp.goto(`${BASE}/marketplace/checkout`);
await mp.waitForSelector("#co");
await mp.fill("#co [name=name]", "Maria Silva"); await mp.fill("#co [name=email]", "maria@example.com");
await mp.fill("#co [name=cep]", "01310-100"); await mp.fill("#co [name=address]", "Av. Paulista, 1000");
await mp.click("#co button");
await mp.waitForSelector("#walletBox:not([hidden]) [data-wallet=GOOGLE_PAY]");
check(true, "checkout mostra \"Pagar com Google Pay\" quando o aparelho tem a carteira");
await shot(mp, "wallet");
await mp.click("[data-wallet=GOOGLE_PAY]");
await mp.waitForSelector("#paidWith");
const shown = await mp.evaluate(() => window.__walletShown);
check(/Google Pay · VISA •••• 1111 \(teste\)/.test(await mp.locator("#paidWith").innerText()) && shown.gateway && Number(shown.total) > 0, `pedido pago com Google Pay (cartão da carteira, token para o gateway "${shown.gateway}")`);

check(!errs.length, "sem erros de JavaScript" + (errs.length ? ": " + errs.join(" | ") : ""));
await browser.close();
console.log(process.exitCode ? "\nrcprep.16 (navegador): FALHOU" : "\nrcprep.16 (navegador): tudo certo");
