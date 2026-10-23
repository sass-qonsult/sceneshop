// rcprep.18 no navegador: no APK Android o botão QR code usa o leitor nativo do Google (pela ponte SCAN_QR);
// se o leitor nativo não existir (APK antigo), cai para a câmera pela página.
//   DEMO=1 npm start  ·  node test/rcprep18.e2e.mjs
import { chromium } from "playwright";

const BASE = process.env.BASE || "http://localhost:3000";
const check = (cond, msg) => { if (!cond) { console.log("✗ FALHOU:", msg); process.exitCode = 1; } else console.log("  ✓", msg); };

await fetch(`${BASE}/api/dev/reset?all=1`, { method: "POST" });
const s = await (await fetch(`${BASE}/api/sessions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ workId: "demo-01", time: 20 }) })).json();
const browser = await chromium.launch();
const errs = [];

// simula a ponte do APK Android: responde SCAN_QR com o link da TV (ou com erro, como num APK antigo)
async function phone(mode) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: "pt-BR" });
  await ctx.addInitScript(({ mode, url }) => {
    window.__bridgeCalls = [];
    window.SceneShopNative = { postMessage(raw) {
      const m = JSON.parse(raw); window.__bridgeCalls.push(m.type); if (m.type === "SCAN_QR") sessionStorage.setItem("scanQrCalled", "1");
      if (m.type !== "SCAN_QR" || !m.requestId) return;
      setTimeout(() => window.SceneShopNativeResolve(mode === "ok"
        ? { version: 1, requestId: m.requestId, ok: true, value: { text: url }, error: null }
        : mode === "cancel" ? { version: 1, requestId: m.requestId, ok: false, value: null, error: "QR_CANCELLED" }
        : { version: 1, requestId: m.requestId, ok: false, value: null, error: "UNSUPPORTED_TYPE" }), 200);
    } };
  }, { mode, url: `${BASE}/s/${s.code}?t=20` });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => errs.push(e.message));
  await p.goto(`${BASE}/mobile`);
  await p.waitForSelector("#join:not([hidden])");
  return p;
}

const a = await phone("ok");
await a.click("#optQr");
await a.waitForURL(new RegExp(`/s/${s.code}`), { timeout: 10000 });
check((await a.evaluate(() => sessionStorage.getItem("scanQrCalled"))) === "1", "APK: o botão QR code abre o leitor nativo (SCAN_QR) e conecta na sessão lida");

const b = await phone("cancel");
await b.click("#optQr");
await b.waitForTimeout(800);
check(/\/mobile$/.test(b.url()) && await b.locator("#qrView").isHidden(), "APK: cancelar o leitor volta para o início sem erro");

const c = await phone("old");
await c.click("#optQr");
await c.waitForTimeout(1500);
const fell = await c.evaluate(() => !document.getElementById("qrView").hidden || /câmera|camera/i.test(document.getElementById("syncState").textContent));
check(fell, "APK antigo sem leitor nativo: cai para a câmera pela página");

check(!errs.length, "sem erros de JavaScript" + (errs.length ? ": " + errs.join(" | ") : ""));
await browser.close();
console.log(process.exitCode ? "\nrcprep.18 (navegador): FALHOU" : "\nrcprep.18 (navegador): tudo certo");
