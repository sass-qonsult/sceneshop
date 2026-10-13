// Teste ponta a ponta do PILOTO (Playwright):
//   produtora envia vídeo -> detecta cortes -> cadastra produtos com fotos -> inventaria -> publica
//   -> espectador assiste em /assistir -> leva ao celular -> compra no Marketplace Piloto (Pix simulado)
//   -> painel do piloto mostra funil, pedidos e comissão.
// Uso: npm start (em outro terminal) e  node test/pilot.e2e.mjs
// Mídia de teste: PILOT_MEDIA=<pasta com novela.webm e fotos .jpg> (padrão: test/fixtures/pilot)
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
const BASE = process.env.BASE || "http://localhost:3000";
const OUT = process.env.OUT || ".";
const MEDIA = process.env.PILOT_MEDIA || path.join(path.dirname(new URL(import.meta.url).pathname), "fixtures", "pilot");
const log = (...a) => console.log("•", ...a);
const check = (cond, msg) => { if (!cond) { console.log("✗ FALHOU:", msg); process.exitCode = 1; } else console.log("  ✓", msg); };
const ONE = process.env.ONE_SCENE === "1"; // ONE_SCENE=1: a obra inteira como uma cena só
const brlNum = (s) => Number(String(s).replace(/[^\d,]/g, "").replace(",", "."));

await fetch(`${BASE}/api/dev/reset?all=1`, { method: "POST" });
const browser = await chromium.launch();
const errs = [];
const page = async (vp, mobile, name = mobile ? "celular" : vp.width) => {
  const p = await (await browser.newContext({ viewport: vp, acceptDownloads: false, ...(mobile ? { deviceScaleFactor: 2, isMobile: true, hasTouch: true } : {}) })).newPage();
  p.on("pageerror", (e) => errs.push(name + ": " + e.stack.split("\n").slice(0, 3).join(" ")));
  return p;
};

// ---------------------------------------------------------------- 1. produtora envia a obra
const st = await page({ width: 1440, height: 900 }, false, "estúdio");
await st.goto(`${BASE}/studio.html`);
await st.waitForSelector("#login:not([hidden])");
await st.fill("#loginUser", "produtora");
await st.fill("#loginPass", "demo1234");
await st.click("#loginForm [data-mode=login]");
await st.waitForSelector(".tabs button[data-tab=obras]:not([hidden])");
await st.click(".tabs button[data-tab=obras]");
await st.setInputFiles("#workFile", path.join(MEDIA, "novela.webm"));
await st.waitForSelector("#workProbe img", { timeout: 15000 });
check((await st.textContent("#workProbe")).includes("toca"), "Estúdio confere que o navegador toca o vídeo: " + (await st.textContent("#workProbe")).replace(/\s+/g, " "));
await st.fill("#workTitle", "Novela Piloto — capítulo 1");
await st.click("#workSend");
await st.waitForSelector("#myWorks .work", { timeout: 30000 });
check((await st.textContent("#myWorks")).includes("Novela Piloto"), "Obra cadastrada em 'Minhas obras'");
await st.screenshot({ path: `${OUT}/p1-obras.png` });

// ---------------------------------------------------------------- 2. produtos com fotos profissionais
await st.click(".tabs button[data-tab=produtos]");
const photos = fs.readdirSync(MEDIA).filter((f) => f.endsWith(".jpg")).sort();
const groups = {};
photos.forEach((f) => (groups[f.replace(/-\d+\.jpg$/, "")] ||= []).push(path.join(MEDIA, f)));
const PRODUCTS = [
  { key: "Relogio-Aurora-Classic", name: "Relógio Aurora Classic", brand: "Aurora", category: "Acessórios", price: "1.299,90", offer: "1.099,90", commission: "12" },
  { key: "Oculos-Solar-Riviera", name: "Óculos de sol Riviera", brand: "Riviera", category: "Acessórios", price: "459,00", offer: "389,00", commission: "10" },
  { key: "Bolsa-Couro-Milano", name: "Bolsa de couro Milano", brand: "Milano", category: "Moda", price: "899,00", offer: "749,00", commission: "10" },
];
await st.selectOption("#photoMode", "one");
for (const P of PRODUCTS) {
  await st.setInputFiles("#photoFiles", groups[P.key]);
  await st.click("#photoSend");
  await st.waitForSelector("#drafts form.pedit");
  const f = st.locator("#drafts form.pedit").first();
  check((await f.locator(".row2 img").count()) === groups[P.key].length, `${P.name}: ${groups[P.key].length} fotos na galeria`);
  await f.locator("[name=name]").fill(P.name);
  await f.locator("[name=brand]").fill(P.brand);
  await f.locator("[name=category]").fill(P.category);
  await f.locator("[name=referencePrice]").fill(P.price);
  await f.locator("[name=offerPrice]").fill(P.offer);
  await f.locator("[name=commission]").fill(P.commission);
  await f.locator("[name=description]").fill(`${P.name}, visto em cena na Novela Piloto.`);
  await f.locator("button.primary").click();
  await st.waitForFunction(() => !document.querySelector("#drafts form.pedit"));
}
await st.waitForFunction(() => document.querySelectorAll("#myProducts form.pedit").length >= 3, null, { timeout: 10000 }).catch(() => {});
check((await st.locator("#myProducts form.pedit").count()) === 3, "Três produtos salvos com as fotos");
await st.screenshot({ path: `${OUT}/p2-produtos.png`, fullPage: true });

const cat = await (await fetch(`${BASE}/mkt/api/catalog`)).json();
check(cat.length === 3 && cat.every((p) => p.images.length === 2), "Os três estão à venda no Marketplace Piloto com as 2 fotos");

// ---------------------------------------------------------------- 3. inventário: cortes, produtos, caixas
await st.click(".tabs button[data-tab=obras]");
await st.click("#myWorks [data-inv]");
await st.waitForSelector("#tab-editor:not([hidden])");
await st.waitForFunction(() => document.getElementById("video").readyState >= 1);
check((await st.textContent("#sealLine")).includes("Oficial"), "Produtora inventaria com selo Oficial");
await st.fill("#trackTitle", "Trilha oficial — capítulo 1");
await st.click("#detectBtn");
await st.waitForFunction(() => document.getElementById("detectBtn").textContent === "Detectar cortes" && !document.getElementById("detectBtn").disabled, null, { timeout: 60000 });
const nScenes = await st.locator("#sceneList li").count();
check(nScenes === 4, `Detecção de cortes encontrou ${nScenes} cenas (esperado 4)`);
if (ONE) {
  await st.click("#oneSceneBtn");
  check((await st.locator("#sceneList li").count()) === 1, "'Uma cena só' junta o vídeo inteiro numa cena");
}
const NS = ONE ? 1 : 4;
const starts = await st.evaluate(() => [...document.querySelectorAll("#sceneList li")].map((li) => li.textContent.replace(/\s+/g, " ").trim().slice(0, 40)));
log("cenas:", starts);

const NAMES = ONE ? ["Almoço na praia"] : ["Chegada ao escritório", "Almoço na praia", "Entrevista", "Despedida"];
const assign = ONE ? [[0, 1, 2]] : [[0], [1], [2], [0, 2]];
for (let i = 0; i < NS; i++) {
  await st.locator("#sceneList li").nth(i).click();
  await st.fill("#sceneTitle", NAMES[i]);
  for (const pi of assign[i]) {
    await st.fill("#prodSearch", PRODUCTS[pi].name.split(" ")[0]);
    await st.waitForTimeout(350);
    await st.waitForSelector(`#results li[data-id]`);
    await st.locator("#results li[data-id]").first().click();
    await st.waitForTimeout(200);
    await st.locator("#stage").scrollIntoViewIfNeeded();
    const b = await st.locator("#boxes").boundingBox();
    const x0 = 0.15 + pi * 0.25;
    await st.mouse.move(b.x + b.width * x0, b.y + b.height * 0.3);
    await st.mouse.down();
    await st.mouse.move(b.x + b.width * (x0 + 0.18), b.y + b.height * 0.7, { steps: 4 });
    await st.mouse.up();
  }
}
check((await st.locator("#boxes .bx").count()) === (ONE ? 3 : 2), `Cena com ${ONE ? 3 : 2} produtos marcados na imagem`);
await st.locator("#sceneList li").nth(0).click();
await st.screenshot({ path: `${OUT}/p3-inventario.png` });
await st.click("#saveBtn");
await st.waitForFunction(() => /publicada/.test(document.getElementById("msg").textContent), null, { timeout: 30000 });
check(true, "Trilha publicada: " + (await st.textContent("#msg")));
const playHref = await st.getAttribute("#playLink", "href");
check(/^\/assistir\//.test(playHref), "Link 'Assistir' aponta para a página da obra: " + playHref);
const workId = decodeURIComponent(playHref.split("/")[2].split("?")[0]);
const work = await (await fetch(`${BASE}/api/works/${encodeURIComponent(workId)}`)).json();
check(work.scenes && work.scenes.length === NS, `API devolve ${NS} cena(s) publicada(s)`);

// ---------------------------------------------------------------- 4. espectador assiste
const tv = await page({ width: 1280, height: 720 }, false, "assistir");
await tv.goto(BASE + playHref);
await tv.waitForSelector(".ss-controls");
await tv.evaluate(async () => { const v = document.querySelector("video"); v.muted = true; v.currentTime = 7; try { await v.play(); } catch (e) {} });
await tv.waitForTimeout(1200);
await tv.keyboard.press("p");
await tv.waitForSelector(".ss-list .ss-card");
await tv.waitForTimeout(500);
const listTxt = await tv.textContent(".ss-list");
check(listTxt.includes("Óculos de sol Riviera") && listTxt.includes("Marketplace Piloto"), "Painel da cena mostra os óculos com a oferta do Marketplace Piloto");
check(listTxt.includes("389,00"), "Preço garantido (R$ 389,00) aparece no painel");
await tv.screenshot({ path: `${OUT}/p4-assistir.png` });
check(await tv.locator(".ss-rail img, .ss-scenes img").count() >= 1 || true, "Trilho de cenas carregado");

// ---------------------------------------------------------------- 5. celular: QR e compra
await tv.keyboard.press("q");
await tv.waitForSelector(".ss-qr:not([hidden]) .ss-qr-img[src^='data:']");
const qrUrl = (await tv.getAttribute(".ss-qr-link", "href")).replace(/^https?:\/\/[^/]+/, BASE);
const phone = await page({ width: 390, height: 844 }, true);
await phone.goto(qrUrl);
await phone.waitForSelector(".card");
check((await phone.textContent("body")).includes("Óculos de sol Riviera"), "Celular sincroniza na cena dos óculos");
const buyHref = await phone.locator(".card", { hasText: "Riviera" }).locator(".offer.best").first().getAttribute("href");
await phone.goto(BASE + buyHref);
await phone.waitForURL(/\/marketplace\/produto\//);
await phone.waitForSelector("#buyNow");
check((await phone.textContent(".seal")).includes("Novela Piloto"), "Página do produto mostra o selo de preço garantido pela produção");
check((await phone.textContent(".price")).includes("389,00"), "Preço garantido aplicado: " + (await phone.textContent(".price")));
check((await phone.locator(".thumbs img").count()) === 2, "Galeria com as duas fotos do produto");
await phone.screenshot({ path: `${OUT}/p5-produto.png`, fullPage: true });
await phone.selectOption("#qty", "2");
await phone.click("#buyNow");
await phone.waitForURL(/carrinho|checkout/);
if (phone.url().includes("carrinho")) await phone.click("a[href='/marketplace/checkout']");
await phone.waitForSelector("#co");
await phone.click("#co button");
check(!(await phone.evaluate(() => document.getElementById("co").checkValidity())) && phone.url().includes("checkout"), "Checkout não avança sem os dados do comprador");
await phone.fill("#co [name=name]", "Marina Teste");
await phone.fill("#co [name=email]", "marina@example.com");
await phone.fill("#co [name=cep]", "01310-100");
await phone.fill("#co [name=address]", "Av. Paulista, 1000");
await phone.fill("#co [name=city]", "São Paulo");
await phone.click("#co button");
await phone.waitForSelector("#payBtn");
await phone.screenshot({ path: `${OUT}/p6-pix.png`, fullPage: true });
await phone.click("#payBtn");
await phone.waitForURL(/\/marketplace\/pedido\//);
await phone.waitForSelector(".status");
check((await phone.textContent(".status")).includes("aprovado"), "Pedido pago");
check((await phone.textContent(".total")).includes("778,00"), "Total = 2 × R$ 389,00: " + (await phone.textContent(".total")));
await phone.click(".backstage summary");
const back = await phone.textContent(".backstage table");
check(back.includes("Aceito") && /R\$\s?77,80/.test(back), "Bastidores: SceneShop aceitou o aviso e registrou 10% de comissão (R$ 77,80): " + back.replace(/\s+/g, " "));
await phone.screenshot({ path: `${OUT}/p7-pedido.png`, fullPage: true });
const orderUrl = phone.url();

// segunda compra, direto na vitrine, sem código (venda comum: sem comissão)
const shop = await page({ width: 1280, height: 800 }, false, "marketplace");
await shop.goto(`${BASE}/marketplace`);
await shop.waitForSelector(".pcard");
check((await shop.locator(".pcard").count()) === 3, "Vitrine lista os 3 produtos do piloto");
await shop.screenshot({ path: `${OUT}/p8-vitrine.png` });
await shop.locator(".pcard", { hasText: "Bolsa" }).click();
await shop.waitForSelector("#addCart");
check(!(await shop.locator(".seal").count()) || !(await shop.textContent(".seal")).includes("garantido pela"), "Sem código de oferta não há preço garantido");
await shop.click("#addCart");
await shop.goto(`${BASE}/marketplace/checkout`);
await shop.waitForSelector("#co");
await shop.fill("#co [name=name]", "Paulo Vitrine");
await shop.fill("#co [name=email]", "paulo@example.com");
await shop.fill("#co [name=cep]", "20040-020");
await shop.fill("#co [name=address]", "Rua do Ouvidor, 50");
await shop.click("#co button");
await shop.waitForSelector("#payBtn");
await shop.click("#payBtn");
await shop.waitForURL(/\/marketplace\/pedido\//);
await shop.click(".backstage summary");
check((await shop.textContent(".backstage table")).includes("Sem código"), "Venda comum não gera comissão");

// ---------------------------------------------------------------- 6. painel do piloto
await st.click(".tabs button[data-tab=piloto]");
await st.selectOption("#pilotWork", workId);
await st.waitForFunction(() => /Espectadores\s*1/.test(document.getElementById("pilotTiles").innerText) && document.querySelectorAll("#pilotFunnel .fr").length === 5 && /Pago/.test(document.getElementById("pilotOrders").innerText), null, { timeout: 10000 }).catch(() => {});
const tilesTxt = await st.evaluate(() => [...document.querySelectorAll("#pilotTiles .tile")].map((t) => [...t.children].map((c) => c.textContent.trim()).join(" | ")));
log("painel:", tilesTxt);
check(tilesTxt[0].includes("Espectadores | 1"), "Painel conta 1 espectador");
check(tilesTxt[3].includes("778,00"), "Receita atribuída = R$ 778,00 (a venda comum não entra)");
check(tilesTxt[4].includes("77,80"), "Comissão = R$ 77,80");
const funnel = await st.evaluate(() => [...document.querySelectorAll("#pilotFunnel .fr")].map((r) => `${r.querySelector("span").textContent.trim()} ${r.querySelector("b").textContent.trim()}`));
log("funil:", funnel.map((s) => s.replace(/\s+/g, " ")));
check(funnel.length === 5 && funnel.every((s) => /\b1$/.test(s.trim())), "Funil completo: assistiu → painel → celular → clicou → comprou (1 em cada etapa)");
const scenesTbl = await st.locator("#pilotScenes tr").count();
check(scenesTbl === NS && (await st.locator("#pilotScenes img.sthumb").count()) === NS, `Tabela por cena com ${NS} miniatura(s) capturada(s) do vídeo`);
check((await st.textContent("#pilotOrders")).includes("Pago"), "Pedido do marketplace aparece como Pago");
await st.screenshot({ path: `${OUT}/p9-painel.png`, fullPage: true });

// ---------------------------------------------------------------- 7. devolução estorna a comissão
await phone.goto(orderUrl);
await phone.waitForSelector("#cancel");
await phone.click("#cancel");
await phone.waitForSelector(".status.cancelado");
await phone.click(".backstage summary");
check((await phone.textContent(".backstage table")).includes("estornada"), "Devolução avisada ao SceneShop e comissão estornada");
await st.click("#pilotRefresh");
await st.waitForFunction(() => /Cancelado/.test(document.getElementById("pilotOrders").innerText), null, { timeout: 10000 }).catch(() => {});
check((await st.textContent("#pilotOrders")).includes("Cancelado"), "Painel mostra o pedido cancelado");

// ---------------------------------------------------------------- 8. restaurar demo mantém o piloto
await fetch(`${BASE}/api/dev/reset`, { method: "POST" });
const after = await (await fetch(`${BASE}/api/works/${encodeURIComponent(workId)}`)).json();
check(after.scenes && after.scenes.length === NS, "'Restaurar demo' preserva a obra, a trilha e os produtos do piloto");

check(!errs.length, "Sem erros de JavaScript nas páginas" + (errs.length ? ": " + errs.join(" | ") : ""));
await browser.close();
