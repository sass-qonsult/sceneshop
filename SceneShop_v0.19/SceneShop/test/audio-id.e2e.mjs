// Teste ponta a ponta do SceneShop ID (reconhecimento próprio pelo som, sem ACRCloud):
//   produtora envia a obra -> o servidor indexa o som sozinho -> estúdio mostra "pronto"
//   -> o microfone do celular (Chromium com arquivo de áudio) "ouve" a obra a partir de 30 s, com eco e ruído
//   -> o SceneShop reconhece a obra e a posição -> o celular entra na obra no segundo certo.
// Uso: servidor com ffmpeg instalado; node test/audio-id.e2e.mjs (DEMO=1), ou E2E_USER/E2E_PASS contra um servidor de produção
import { chromium } from "playwright";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { synth, roomRecording, writeWav } from "./audio-id-synth.mjs";
const BASE = process.env.BASE || "http://localhost:3000";
const check = (cond, msg) => { if (!cond) { console.log("✗ FALHOU:", msg); process.exitCode = 1; } else console.log("  ✓", msg); };

const cfg = await (await fetch(`${BASE}/api/config`)).json();
check(cfg.audioRecognition === "sceneshop", `servidor anuncia o SceneShop ID (${cfg.audioRecognition})`);

// obra: 60 s de música sintética + imagem, em WebM (o Chromium do teste não toca H.264)
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ssid-e2e-"));
const seed = Date.now() % 100000;
const music = synth(60, seed);
writeWav(path.join(dir, "obra.wav"), music, 16000);
const video = path.join(dir, "obra-som.webm");
const ff = spawnSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "color=c=0x1E4D8F:s=640x360:d=60", "-i", path.join(dir, "obra.wav"), "-c:v", "libvpx-vp9", "-b:v", "200k", "-c:a", "libopus", "-shortest", video]);
check(ff.status === 0, "vídeo de teste gerado");
// o "microfone": 25 s da obra a partir de 30 s, com eco de sala e ruído (SNR 8 dB)
const mic = path.join(dir, "microfone.wav");
writeWav(mic, roomRecording(music, 30, 25, { snr: 8 }), 16000);

const browser = await chromium.launch({ args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", `--use-file-for-fake-audio-capture=${mic}`] });
const errs = [];
const newPage = async (opts, name) => { const ctx = await browser.newContext({ locale: "pt-BR", ...opts }); const p = await ctx.newPage(); p.on("pageerror", (e) => errs.push(`${name}: ${e.message}`)); return { ctx, p }; };

// ---------------------------------------------------------------- 1. estúdio: envio e indexação
const { p: st } = await newPage({ viewport: { width: 1440, height: 900 } }, "estúdio");
await st.goto(`${BASE}/studio.html`);
await st.waitForSelector("#login:not([hidden])");
await st.fill("#loginUser", process.env.E2E_USER || "produtora");
await st.fill("#loginPass", process.env.E2E_PASS || "demo1234");
await st.click("#loginForm [data-mode=login]");
await st.waitForSelector(".tabs button[data-tab=obras]:not([hidden])");
await st.click(".tabs button[data-tab=obras]");
await st.setInputFiles("#workFile", video);
await st.waitForSelector("#workProbe img", { timeout: 15000 });
const title = `Obra pelo som ${seed}`;
await st.fill("#workTitle", title);
await st.click("#workSend");
await st.waitForFunction((t) => [...document.querySelectorAll("#myWorks .work")].some((w) => w.textContent.includes(t)), title, { timeout: 30000 });
const card = st.locator("#myWorks .work", { hasText: title });
await card.locator(".aid-state").waitFor();
await st.waitForFunction((t) => { const w = [...document.querySelectorAll("#myWorks .work")].find((x) => x.textContent.includes(t)); return w && /pronto/.test(w.querySelector(".aid-state").textContent); }, title, { timeout: 60000 });
check(true, "estúdio mostra: " + (await card.locator(".aid-state").textContent()).replace(/\s+/g, " ").trim());

// ---------------------------------------------------------------- 2. celular: ouvir e entrar na obra
const { ctx: phoneCtx, p: ph } = await newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }, "celular");
await phoneCtx.grantPermissions(["microphone"], { origin: BASE });
await ph.goto(`${BASE}/mobile`);
await ph.waitForSelector("#join:not([hidden])");
await ph.waitForFunction(() => /10 segundos/.test(document.getElementById("syncState").textContent), null, { timeout: 5000 });
await ph.click("#syncNow");
await ph.waitForURL(/\/s\/[A-Z0-9]{6}\?t=\d+/, { timeout: 45000 });
const url = new URL(ph.url());
const t = Number(url.searchParams.get("t"));
check(t >= 38 && t <= 54, `entrou na obra no segundo certo (t=${t}; o microfone começou em 30 s e ouviu 10 a 20 s)`);
const code = url.pathname.split("/").pop();
const session = await (await fetch(`${BASE}/api/sessions/${code}`)).json().catch(() => ({}));
check(/obra-pelo-som/.test(session.workId || ""), `sessão aberta na obra certa (${session.workId || "?"})`);

check(!errs.length, "sem erros de JavaScript" + (errs.length ? ": " + errs.join(" | ") : ""));
await browser.close();
fs.rmSync(dir, { recursive: true, force: true });
console.log(process.exitCode ? "\nSceneShop ID: FALHOU" : "\nSceneShop ID: tudo certo");
