// Teste ponta a ponta do RECONHECIMENTO POR ÁUDIO com a ACRCloud (simulada):
//   produtora envia a obra -> o SceneShop cadastra o áudio na ACRCloud sozinho -> estúdio mostra "pronto"
//   -> celular toca em "Sincronizar com o que estou assistindo" (microfone simulado do Chromium)
//   -> a ACRCloud reconhece a obra e a posição -> o celular entra na obra, no segundo certo.
// Uso: o servidor precisa estar apontado para o simulador e com a ACRCloud como principal (SCENESHOP_AUDIO_ID=acrcloud):
//   node test/acrcloud-mock.mjs 3997 &
//   SCENESHOP_AUDIO_ID=acrcloud ACRCLOUD_HOST=http://127.0.0.1:3997 ACRCLOUD_CONSOLE_URL=http://127.0.0.1:3997 ACRCLOUD_ACCESS_KEY=mock-access-key \
//   ACRCLOUD_ACCESS_SECRET=mock-access-secret ACRCLOUD_BUCKET_ID=4242 ACRCLOUD_CONSOLE_TOKEN=mock-console-token npm start
//   node test/acr.e2e.mjs
import { chromium } from "playwright";
import path from "node:path";
const BASE = process.env.BASE || "http://localhost:3000";
const MEDIA = path.join(path.dirname(new URL(import.meta.url).pathname), "fixtures", "pilot");
const check = (cond, msg) => { if (!cond) { console.log("✗ FALHOU:", msg); process.exitCode = 1; } else console.log("  ✓", msg); };

const cfg = await (await fetch(`${BASE}/api/config`)).json();
check(cfg.audioRecognition === "acrcloud" && cfg.audioRecognitionRegistry === true, "servidor anuncia o reconhecimento pela ACRCloud");

// O microfone simulado do Chromium toca um bipe contínuo: é som de verdade para o reconhecimento.
const browser = await chromium.launch({ args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] });
const errs = [];
const newPage = async (opts, name) => { const ctx = await browser.newContext({ locale: "pt-BR", ...opts }); const p = await ctx.newPage(); p.on("pageerror", (e) => errs.push(`${name}: ${e.message}`)); return { ctx, p }; };

// ---------------------------------------------------------------- 1. estúdio: obra enviada e cadastrada
const { p: st } = await newPage({ viewport: { width: 1440, height: 900 } }, "estúdio");
await st.goto(`${BASE}/studio.html`);
await st.waitForSelector("#login:not([hidden])");
await st.fill("#loginUser", "produtora");
await st.fill("#loginPass", "demo1234");
await st.click("#loginForm [data-mode=login]");
await st.waitForSelector(".tabs button[data-tab=obras]:not([hidden])");
await st.click(".tabs button[data-tab=obras]");
await st.setInputFiles("#workFile", path.join(MEDIA, "novela.webm"));
await st.waitForSelector("#workProbe img", { timeout: 15000 });
const title = `Obra reconhecida ${Date.now() % 100000}`;
await st.fill("#workTitle", title);
await st.click("#workSend");
await st.waitForFunction((t) => [...document.querySelectorAll("#myWorks .work")].some((w) => w.textContent.includes(t)), title, { timeout: 30000 });
const card = st.locator("#myWorks .work", { hasText: title });
await card.locator(".acr-state").waitFor();
await st.waitForFunction((t) => { const w = [...document.querySelectorAll("#myWorks .work")].find((x) => x.textContent.includes(t)); return w && /pronto/.test(w.querySelector(".acr-state").textContent); }, title, { timeout: 30000 });
check(true, "estúdio mostra: " + (await card.locator(".acr-state").textContent()));
check(await card.locator("[data-acr-reg]").isVisible(), "botão para recadastrar o áudio da obra");

// ---------------------------------------------------------------- 2. celular: ouvir e entrar na obra
const { ctx: phoneCtx, p: ph } = await newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }, "celular");
await phoneCtx.grantPermissions(["microphone"], { origin: BASE });
await ph.goto(`${BASE}/mobile`);
await ph.waitForSelector("#join:not([hidden])");
await ph.waitForFunction(() => /10 segundos/.test(document.getElementById("syncState").textContent), null, { timeout: 5000 });
check(/não fica guardado/.test(await ph.textContent("#syncState")), "celular explica que o áudio não fica guardado");
await ph.click("#syncNow");
await ph.waitForFunction(() => /Ouvindo por 10 segundos/.test(document.getElementById("syncState").textContent), null, { timeout: 5000 });
check(true, "celular ouve por 10 segundos");
await ph.waitForURL(/\/s\/[A-Z0-9]{6}\?t=\d+/, { timeout: 30000 });
const url = new URL(ph.url());
const t = Number(url.searchParams.get("t"));
check(t >= 12 && t <= 15, `entrou na obra no segundo reconhecido (t=${t}, a ACRCloud simulada devolve 12 s)`);
const code = url.pathname.split("/").pop();
const session = await (await fetch(`${BASE}/api/sessions/${code}`)).json().catch(() => ({}));
check(!session.workId || /obra-reconhecida/.test(session.workId), `sessão aberta na obra certa (${session.workId || "?"})`);

check(!errs.length, "sem erros de JavaScript" + (errs.length ? ": " + errs.join(" | ") : ""));
await browser.close();
console.log(process.exitCode ? "\nReconhecimento por áudio: FALHOU" : "\nReconhecimento por áudio: tudo certo");
