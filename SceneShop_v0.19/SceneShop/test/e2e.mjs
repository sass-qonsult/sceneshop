// Teste ponta a ponta (Playwright): TV + celular + estúdio + ganhos + moderação
// Uso: npm start  (em outro terminal)  e  node test/e2e.mjs
import { chromium } from "playwright";
const BASE = process.env.BASE || "http://localhost:3000";
const OUT = process.env.OUT || ".";
const log = (...a) => console.log("•", ...a);
const check = (cond, msg) => { if (!cond) { console.log("✗ FALHOU:", msg); process.exitCode = 1; } else console.log("  ✓", msg); };

await fetch(`${BASE}/api/dev/reset?all=1`, { method: "POST" });
const browser = await chromium.launch();
const errs = [];
const page = async (vp, mobile, name = mobile ? "celular" : vp.width) => {
  const p = await (await browser.newContext({ locale: "pt-BR", viewport: vp, ...(mobile ? { deviceScaleFactor: 2, isMobile: true, hasTouch: true } : {}) })).newPage();
  p.on("pageerror", (e) => errs.push(name + ": " + e.stack.split("\n").slice(0, 3).join(" ")));
  return p;
};

// ---------------------------------------------------------------- TV
const tv = await page({ width: 1280, height: 720 });
await tv.goto(BASE);
await tv.waitForSelector(".ss-controls");
await tv.evaluate(async () => { const v = document.querySelector("video"); v.muted = true; v.currentTime = 3; try { await v.play(); } catch (e) {} });
await tv.waitForTimeout(1200);
await tv.keyboard.press("p");
await tv.waitForTimeout(600);
check((await tv.textContent(".ss-trackbar")).includes("Oficial"), "TV abre com a trilha Oficial por padrão");
await tv.click(".ss-track-switch");
await tv.waitForTimeout(300);
const opts = await tv.locator(".ss-track-opt").allTextContents();
log("ordem das trilhas:", opts.map((o) => o.replace(/\s+/g, " ").trim().slice(0, 60)));
check(opts.length === 3 && opts[1].includes("Ana") && opts[2].includes("revisão"), "Ranking: Oficial > Ana > promo_x (em revisão)");
await tv.screenshot({ path: `${OUT}/10-tv-trilhas.png` });
await tv.locator(".ss-track-opt").nth(1).click();
await tv.waitForTimeout(700);
check((await tv.textContent(".ss-trackbar")).includes("Comunidade"), "Troca para a trilha da comunidade");
check((await tv.textContent(".ss-list")).includes("parecido"), "Selo 'parecido' aparece");
await tv.keyboard.press("]");
await tv.waitForTimeout(300);
check((await tv.textContent(".ss-toast")).includes("+0,5"), "Ajuste de sincronia com ]");
await tv.keyboard.press("[");
await tv.waitForTimeout(300);
await tv.screenshot({ path: `${OUT}/11-tv-comunidade.png` });

// ---------------------------------------------------------------- celular
await tv.keyboard.press("q");
await tv.waitForSelector(".ss-qr:not([hidden]) .ss-qr-img[src^='data:']");
const url = (await tv.getAttribute(".ss-qr-link", "href")).replace(/^https?:\/\/[^/]+/, BASE);
const phone = await page({ width: 390, height: 844 }, true);
await phone.goto(url);
await phone.waitForSelector(".card");
check((await phone.textContent("#trackbar")).includes("Ana Legendas"), "Celular recebe a mesma trilha da TV");
await phone.click("[data-vote='1']");
await phone.waitForTimeout(300);
check((await phone.textContent("#trackbar")).includes("Obrigado"), "Voto registrado");
await phone.locator("[data-report]").first().click();
await phone.waitForTimeout(300);
check((await phone.locator("[data-report]").first().textContent()).includes("enviada"), "Denúncia de produto enviada");
await phone.screenshot({ path: `${OUT}/12-celular-comunidade.png` });
const href = await phone.locator(".offer.best").first().getAttribute("href");
const r = await fetch(BASE + href, { redirect: "manual" });
check(r.status === 302 && !!r.headers.get("x-sceneshop-click"), "Clique em 'Comprar' é rastreado e redireciona à loja");
// TV volta para a oficial (T duas vezes: Ana -> promo -> Oficial) e o celular acompanha
await tv.keyboard.press("t"); await tv.waitForTimeout(500); await tv.keyboard.press("t");
await phone.waitForTimeout(1500);
check((await phone.textContent("#trackbar")).includes("Oficial"), "Celular acompanha a troca de trilha na TV");

// ---------------------------------------------------------------- estúdio: novo autor cria trilha
const st = await page({ width: 1440, height: 900 });
await st.goto(`${BASE}/studio.html`);
await st.waitForSelector("#login:not([hidden])");
check(!(await st.isVisible("#sceneList li")), "Estúdio exige login");
await st.fill("#loginUser", "joao_figurino");
await st.fill("#loginPass", "curta");
await st.click("#loginForm [data-mode=signup]");
await st.waitForTimeout(300);
check((await st.textContent("#loginMsg")).includes("8 caracteres"), "Cadastro recusa senha curta");
await st.fill("#loginPass", "senhaforte123");
await st.selectOption("#loginKind", "OTHER"); // autor da comunidade (a classe padrão é Produtor)
await st.click("#loginForm [data-mode=signup]");
await st.waitForSelector("#sceneList li");
await st.waitForTimeout(400);
check(!(await st.isVisible(".tabs button[data-tab=moderacao]")), "Autor não vê a aba Moderação");
check((await st.textContent("#sealLine")).includes("Comunidade"), "Novo autor publica com selo Comunidade");
await st.fill("#trackTitle", "Figurino e casa");
for (const t of [12, 24]) {
  await st.evaluate((t) => (document.getElementById("video").currentTime = t), t);
  await st.waitForTimeout(250);
  await st.click("#splitBtn");
}
check((await st.locator("#sceneList li").count()) === 3, "Três cenas criadas com 'Nova cena a partir daqui'");
await st.locator("#sceneList li").nth(0).click();
await st.fill("#sceneTitle", "Na rua");
await st.fill("#prodSearch", "jaqueta");
await st.waitForSelector("#results li[data-id]");
await st.click("#results li[data-id]");
await st.waitForTimeout(250);
const box = await st.locator("#boxes").boundingBox();
await st.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.35);
await st.mouse.down();
await st.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.76, { steps: 5 });
await st.mouse.up();
check((await st.locator("#boxes .bx").count()) === 1, "Posição do produto marcada na imagem");
await st.locator("#sceneList li").nth(1).click();
await st.click(".newprod summary");
await st.fill("#newProd [name=name]", "Toalha de mesa linho");
await st.fill("#newProd [name=brand]", "Casa Fina");
await st.fill("#newProd [name=referencePrice]", "149,90");
await st.click("#newProd button");
await st.waitForTimeout(300);
await st.keyboard.press("Escape");
await st.locator("#sceneList li").nth(0).click();
await st.waitForTimeout(300);
await st.screenshot({ path: `${OUT}/13-estudio.png` });
await st.click("#saveBtn");
await st.waitForTimeout(500);
check((await st.textContent("#msg")).includes("publicada"), "Trilha publicada: " + (await st.textContent("#msg")));

// ---------------------------------------------------------------- ganhos: KYC, custódia, saque
await st.click(".tabs button[data-tab=ganhos]");
await st.waitForSelector("#simSale");
await st.click("#simSale"); await st.waitForTimeout(350);
await st.click("#simSale"); await st.waitForTimeout(450);
const tiles = async () => (await st.locator(".tile").allInnerTexts()).map((s) => s.split("\n").slice(0, 2).join(": "));
log("após 2 vendas:", await tiles());
await st.click("#advance"); await st.waitForTimeout(450);
log("após 30 dias, sem KYC:", await tiles());
check((await st.locator("#ledgerBody .pill.kyc").count()) === 2, "Prazo cumprido sem KYC fica 'Aguardando verificação'");
await st.fill("#kycForm [name=name]", "João Silva");
await st.fill("#kycForm [name=document]", "123.456.789-09");
await st.fill("#kycForm [name=birth]", "1990-04-12");
await st.fill("#kycForm [name=bank]", "joao@pix.com");
await st.locator("#kycForm .chk input").nth(1).check();
await st.click("#kycForm button");
await st.waitForSelector("#approveKyc");
await st.click("#approveKyc"); await st.waitForTimeout(450);
log("após KYC aprovado:", await tiles());
check((await st.locator("#ledgerBody .pill.free").count()) === 2, "Com KYC aprovado, as comissões ficam 'Liberado'");
// autocompra -> alerta AML grave -> saque bloqueado, sem revelar o motivo ao autor
await st.click("#simSelf"); await st.waitForTimeout(500);
check(await st.isVisible("#payoutHold"), "Autocompra bloqueia o saque: " + (await st.textContent("#payoutHold")));
check(!(await st.textContent("#payoutHold")).toLowerCase().includes("autocompra"), "O autor não vê o motivo do alerta");
check(await st.isDisabled("#withdrawBtn"), "Botão de saque desativado");
await st.screenshot({ path: `${OUT}/14-ganhos.png`, fullPage: true });

// ---------------------------------------------------------------- moderação (login do moderador)
await st.click("#logoutBtn");
await st.waitForSelector("#login:not([hidden])");
await st.locator("#demoAccounts button", { hasText: "Moderador" }).click();
await st.waitForSelector(".mod");
check(await st.isVisible(".tabs button[data-tab=moderacao]") && !(await st.isVisible(".tabs button[data-tab=editor]")), "Moderador só vê a aba Moderação");
const alertsTxt = await st.textContent("#amlList");
check(alertsTxt.includes("joao_figurino") && alertsTxt.includes("promo_x"), "Alertas de autocompra de promo_x e do João aparecem para o moderador");
check((await st.textContent("#auditIntegrity")).includes("íntegra"), "Auditoria: " + (await st.textContent("#auditIntegrity")));
const joaoAlert = st.locator(".alert.aberto", { hasText: "joao_figurino" }).first();
await joaoAlert.locator("[data-alert=comunicado]").click();
await st.waitForTimeout(300);
check((await st.textContent("#toast")).includes("fundamento"), "Registrar comunicação exige parecer");
await joaoAlert.locator("input").fill("Três compras do mesmo aparelho logo após o cadastro.");
await joaoAlert.locator("[data-alert=comunicado]").click();
await st.waitForTimeout(400);
await st.locator(".mod.em_revisao button[data-v=fraude]").first().click();
await st.waitForTimeout(500);
await st.screenshot({ path: `${OUT}/15-moderacao.png`, fullPage: true });
const modTok = await st.evaluate(() => localStorage.getItem("ss-studio-token"));
const promo = await (await fetch(`${BASE}/api/moderation/ledger/promo_x`, { headers: { Authorization: "Bearer " + modTok } })).json();
check(promo.totals.estornado > 0 && promo.totals.congelado === 0, `Trilha condenada: comissões estornadas (R$ ${promo.totals.estornado})`);
const ranked = await (await fetch(`${BASE}/api/works/demo-01/tracks`)).json();
check(!ranked.some((t) => t.id === "t-promo-demo01"), "Trilha condenada sai da lista do espectador");
check(ranked.some((t) => t.title === "Figurino e casa"), "Trilha nova do João aparece para o espectador");

// ---------------------------------------------------------------- v4: canal do parceiro + loja oficial com preço garantido
const aur = await page({ width: 1366, height: 900 });
await aur.goto(`${BASE}/parceiro/aurora.html`);
await aur.waitForSelector(".ss-controls");
await aur.evaluate(async () => { const v = document.querySelector("video"); v.muted = true; v.currentTime = 2; });
await aur.waitForTimeout(500);
await aur.keyboard.press("p");
await aur.waitForTimeout(600);
check((await aur.textContent(".ss-eyebrow")).includes("Aurora Play"), "Player assume a marca do parceiro");
check((await aur.locator(".ss-card").first().textContent()).includes("preço garantido"), "Vendedor oficial aparece primeiro com preço garantido");
await aur.screenshot({ path: `${OUT}/20-parceiro-aurora.png` });
const [shop] = await Promise.all([aur.context().waitForEvent("page"), aur.locator(".ss-card").first().click()]);
shop.on("pageerror", (e) => errs.push("loja: " + e.message));
await shop.waitForSelector("#seal:not([hidden])");
check((await shop.textContent("#seal")).includes("Preço garantido"), "Loja oficial confere o código e mostra o preço garantido");
check((await shop.textContent("#price")).includes("479,90"), "Preço cobrado = preço garantido (" + (await shop.textContent("#price")) + ")");
await shop.click("#buy");
await shop.waitForSelector(".done");
check((await shop.textContent(".done")).includes("confirmado"), "Pedido confirmado e comissão registrada: " + (await shop.textContent(".done")).replace(/\s+/g, " ").slice(0, 110));
await shop.screenshot({ path: `${OUT}/21-loja-oficial.png` });
await shop.click("details summary");
await shop.click("#overcharge");
await shop.waitForSelector(".done.bad");
check((await shop.textContent(".done.bad")).includes("recusou"), "Loja que cobra acima do garantido é recusada");
// adulterar o preço no link invalida o código
const url2 = new URL(shop.url());
const tk = url2.searchParams.get("ss_offer").split(".");
const pl = JSON.parse(Buffer.from(tk[1], "base64url").toString()); pl.prc = 100;
url2.searchParams.set("ss_offer", [tk[0], Buffer.from(JSON.stringify(pl)).toString("base64url"), tk[2]].join("."));
await shop.goto(url2.toString());
await shop.waitForSelector("#seal:not([hidden])");
check((await shop.textContent("#seal")).includes("não aplicada"), "Link com preço adulterado perde a garantia");

// grande varejista com acordo: cupom de uso único + relatório diário
check((await aur.locator(".ss-card").nth(1).textContent()).includes("negociado pela produção"), "Varejista com acordo aparece com preço negociado");
const [mega] = await Promise.all([aur.context().waitForEvent("page"), aur.locator(".ss-card").nth(1).click()]);
mega.on("pageerror", (e) => errs.push("varejista: " + e.message));
await mega.waitForSelector("#seal:not([hidden])");
check((await mega.textContent("#seal")).includes("Cupom de uso único"), "Varejista aplica o cupom de uso único: " + (await mega.textContent("#price")));
await mega.click("#buy");
await mega.waitForSelector("#sendReport");
await mega.click("#sendReport");
await mega.waitForSelector(".report-sum");
check((await mega.textContent(".report-sum")).includes("1 venda(s) registrada(s)"), "Relatório diário do varejista conciliado");
await mega.screenshot({ path: `${OUT}/23-varejista-cupom.png` });

// produtora ajusta a oferta oficial no estúdio
await st.click("#logoutBtn");
await st.waitForSelector("#login:not([hidden])");
await st.locator("#demoAccounts button", { hasText: "Produtora" }).click();
await st.waitForSelector(".tabs button[data-tab=ofertas]:not([hidden])");
await st.click(".tabs button[data-tab=ofertas]");
await st.waitForSelector("#offersBody tr[data-id=jaqueta-couro]");
await st.fill("#offersBody tr[data-id=jaqueta-couro] [data-f=price]", "459.90");
await st.click("#offersBody tr[data-id=jaqueta-couro] [data-save]");
await st.waitForTimeout(500);
await st.screenshot({ path: `${OUT}/22-ofertas-oficiais.png`, fullPage: true });
check((await st.textContent("#sellersList")).includes("usados"), "Produtora vê o estoque de cupons do varejista");
const w2 = await (await fetch(`${BASE}/api/works/demo-01`)).json();
check(w2.scenes[0].products[0].offers[0].price === 459.9, "Novo preço garantido vale para os próximos cliques");
await st.click(".tabs button[data-tab=ganhos]");
// a tabela carrega de forma assíncrona: espera o conteúdo, não só a linha provisória
await st.waitForFunction(() => /via canal aurora/.test(document.getElementById("ledgerBody").textContent), null, { timeout: 10000 }).catch(() => {});
check((await st.textContent("#ledgerBody")).includes("via canal aurora"), "Ganhos da produtora mostram a venda oficial e a parte do canal parceiro");

check(errs.length === 0, "Sem erros de JavaScript nas páginas" + (errs.length ? ": " + errs.join(" | ") : ""));
await browser.close();
