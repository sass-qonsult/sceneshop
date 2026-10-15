// Teste ponta a ponta dos IDIOMAS: português, inglês e espanhol.
//   - o idioma vem do aparelho (locale do navegador) e pode ser trocado no seletor da tela;
//   - estúdio, celular, marketplace e player mostram os textos no idioma escolhido;
//   - nada da interface fica em português no modo inglês (o tradutor registra o que não achou).
// Uso: npm start (em outro terminal) e  node test/i18n.e2e.mjs
import { chromium } from "playwright";
const BASE = process.env.BASE || "http://localhost:3000";
const check = (cond, msg) => { if (!cond) { console.log("✗ FALHOU:", msg); process.exitCode = 1; } else console.log("  ✓", msg); };

await fetch(`${BASE}/api/dev/reset?all=1`, { method: "POST" });
const browser = await chromium.launch();
const errs = [];
async function open(locale, path, opts = {}) {
  const ctx = await browser.newContext({ locale, viewport: opts.mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 }, ...(opts.mobile ? { isMobile: true, hasTouch: true } : {}) });
  await ctx.addInitScript(() => { try { localStorage.setItem("ss-i18n-debug", "1"); } catch (e) {} });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => errs.push(`${locale} ${path}: ${e.message}`));
  await p.goto(BASE + path);
  return p;
}
async function studioLogin(p) {
  await p.waitForSelector("#login:not([hidden])");
  await p.fill("#loginUser", "produtora");
  await p.fill("#loginPass", "demo1234");
  await p.click("#loginForm [data-mode=login]");
  await p.waitForSelector(".tabs button[data-tab=obras]:not([hidden])");
}
const tabText = (p, tab) => p.textContent(`.tabs button[data-tab=${tab}]`).then((s) => s.trim());
const misses = (p) => p.evaluate(() => [...window.SceneShopI18n.misses]);

// ---------------------------------------------------------------- estúdio nos três idiomas
const expected = {
  "pt-BR": { lang: "pt-BR", obras: "Obras", ganhos: "Ganhos", moderacao: "Moderação" },
  "en-US": { lang: "en-US", obras: "Titles", ganhos: "Earnings", moderacao: "Moderation" },
  "es-MX": { lang: "es-419", obras: "Obras", ganhos: "Ganancias", moderacao: "Moderación" },
};
for (const [locale, want] of Object.entries(expected)) {
  const st = await open(locale, "/studio.html");
  await studioLogin(st);
  check(await st.evaluate(() => document.documentElement.lang) === want.lang, `${locale}: página marcada como ${want.lang}`);
  const got = [await tabText(st, "obras"), await tabText(st, "ganhos"), await tabText(st, "moderacao")];
  check(got.join("|") === [want.obras, want.ganhos, want.moderacao].join("|"), `${locale}: abas do estúdio = ${got.join(" · ")}`);
  check(await st.locator(".ss-lang").count() >= 1, `${locale}: seletor de idioma no cabeçalho`);
  if (locale === "en-US") {
    for (const tab of ["obras", "produtos", "editor", "ganhos", "piloto"]) { await st.click(`.tabs button[data-tab=${tab}]`); await st.waitForTimeout(400); }
    const left = (await misses(st)).filter((s) => !/Óculos|Relógio|Kimono|Calça|Jaqueta|Tênis|Novela|Cidade em Cenas|Almoço|Café da manhã|Chegada|Look \d|Encerramento|Peças|Sofá|Luminária|Caneca|Garrafa|Fone|Cafeteira|Top |Maria Filó|Essência|Lumen|Lar Design|Urbano|Atelier|PassoLeve|Nimbus|Onda|Pulse|SolarMax/.test(s));
    check(left.length === 0, "en-US: nenhum texto da interface ficou em português no estúdio" + (left.length ? ": " + left.slice(0, 8).join(" | ") : ""));
    // troca pelo seletor: vira espanhol e a escolha fica salva
    await Promise.all([st.waitForEvent("load"), st.selectOption(".ss-lang", "es")]);
    await st.waitForSelector(".tabs button[data-tab=ganhos]");
    check(await tabText(st, "ganhos") === "Ganancias", "seletor troca para espanhol na hora");
    await st.reload();
    await st.waitForSelector(".tabs button[data-tab=ganhos]");
    check(await tabText(st, "ganhos") === "Ganancias", "a escolha de idioma fica salva");
  }
  await st.context().close();
}

// ---------------------------------------------------------------- celular, marketplace e player
for (const [locale, sync, search, saved] of [
  ["en-US", "Sync with what I'm watching", "Search products, brands and more…", "Saved"],
  ["es-MX", "Sincronizar con lo que estoy viendo", "Buscar productos, marcas y más…", "Guardados"],
  ["pt-BR", "Sincronizar com o que estou assistindo", "Buscar produtos, marcas e mais…", "Salvos"],
]) {
  const ph = await open(locale, "/mobile", { mobile: true });
  await ph.waitForSelector("#join:not([hidden])");
  check((await ph.textContent("#syncNow")).trim() === sync, `${locale}: celular — "${sync}"`);
  check((await ph.textContent("#tabSaved")).includes(saved), `${locale}: celular — aba "${saved}"`);
  check(await ph.locator("#join .ss-lang").isVisible(), `${locale}: celular — seletor de idioma visível na tela de conexão`);
  if (locale === "en-US") {
    const left = await misses(ph);
    check(left.length === 0, "en-US: tela de conexão do celular sem português" + (left.length ? ": " + left.join(" | ") : ""));
  }
  await ph.context().close();
  const mk = await open(locale, "/marketplace");
  await mk.waitForSelector("#q");
  check(await mk.getAttribute("#q", "placeholder") === search, `${locale}: marketplace — busca "${search}"`);
  await mk.context().close();
}
const tv = await open("es-MX", "/");
await tv.waitForSelector(".ss-controls");
await tv.waitForTimeout(500);
check(await tv.locator(".ss-lang").count() === 1, "es-MX: player da TV tem o seletor de idioma");
check(await tv.evaluate(() => document.title) === "SceneShop — Reproductor", "título da página também traduzido (SceneShop — Reproductor)");
await tv.context().close();

// idioma fora dos três: cai no inglês
const fr = await open("fr-FR", "/mobile", { mobile: true });
await fr.waitForSelector("#join:not([hidden])");
check((await fr.textContent("#syncNow")).trim() === "Sync with what I'm watching", "fr-FR: idioma não suportado abre em inglês");
await fr.context().close();

check(!errs.length, "sem erros de JavaScript" + (errs.length ? ": " + errs.join(" | ") : ""));
await browser.close();
console.log(process.exitCode ? "\nIdiomas: FALHOU" : "\nIdiomas: tudo certo");
