// Testes das regras de negócio (sem servidor, estado em memória).  Rodar: npm test
process.env.SCENESHOP_MEMORY = "1";
const test = require("node:test");
const assert = require("node:assert/strict");

const store = require("../server/store");
const tracks = require("../server/tracks");
const money = require("../server/money");
const aml = require("../server/aml");
const audit = require("../server/audit");
const auth = require("../server/auth");
const sessions = require("../server/sessions");
const antifraud = require("../server/antifraud");
const { HOLD_DAYS, ATTRIBUTION_HOURS } = require("../server/config");

const S = () => store.state;
const fresh = () => { store.reset(); aml.evaluateAll(); };
const viewerSession = (deviceId) => { const s = sessions.create("demo-01", 0, "t-ana-demo01"); s.devices.add(deviceId); return s; };

test("CPF e CNPJ: dígitos verificadores", () => {
  assert.equal(money.validCpf("12345678909"), true);
  assert.equal(money.validCpf("12345678900"), false);
  assert.equal(money.validCpf("11111111111"), false);
  assert.equal(money.validCnpj("11222333000181"), true);
  assert.equal(money.validCnpj("11222333000182"), false);
});

test("auditoria: cadeia de hash detecta adulteração", () => {
  fresh();
  audit.log("ana", "teste", { a: 1 });
  audit.log("ana", "teste", { a: 2 });
  assert.equal(audit.verifyChain().ok, true);
  S().audit[0].data = { a: 999 }; // alguém "edita" um registro antigo
  const v = audit.verifyChain();
  assert.equal(v.ok, false);
  assert.equal(v.brokenAt, 1);
});

test("login: senha certa, errada e token adulterado", () => {
  fresh();
  const ok = auth.login("ana", "demo1234");
  assert.ok(ok.token);
  assert.ok(auth.login("ana", "errada").error);
  assert.ok(auth.login("naoexiste", "demo1234").error);
  assert.equal(auth.verify(ok.token).username, "ana");
  const [body, mac] = ok.token.split(".");
  const forged = Buffer.from(JSON.stringify({ sub: "moderador", v: 1, exp: Date.now() + 1e9 })).toString("base64url");
  assert.equal(auth.verify(`${forged}.${mac}`), null, "trocar o usuário invalida a assinatura");
  S().accounts.ana.tokenVersion += 1; // "sair de todos os aparelhos"
  assert.equal(auth.verify(ok.token), null);
});

test("sessão: QR público não entrega a credencial de controle da TV", () => {
  const s = sessions.create("demo-01", 12, "t-oficial-demo01");
  assert.ok(s.controllerToken && s.controllerToken.length >= 32);
  assert.equal(sessions.publicView(s).controllerToken, undefined);
  assert.equal(sessions.canControl(s, s.controllerToken), true);
  assert.equal(sessions.canControl(s, "token-inventado"), false);
});

test("cadastro: senha curta e usuário duplicado são recusados", () => {
  fresh();
  assert.ok(auth.signup({ username: "novo", password: "123" }).errors);
  assert.ok(auth.signup({ username: "ana", password: "12345678" }).errors);
  const r = auth.signup({ username: "novo_autor", password: "12345678" });
  assert.equal(r.user.role, "author");
});

test("voto: um por aparelho, e só para quem está na sessão", () => {
  fresh();
  const before = tracks.summary(tracks.get("t-ana-demo01")).votes.up;
  assert.equal(antifraud.checkViewer({ trackId: "t-ana-demo01", session: "NAOEXISTE", deviceId: "device-aaaa" }).code, 403);
  const s = viewerSession("device-aaaa");
  assert.ok(!antifraud.checkViewer({ trackId: "t-ana-demo01", session: s.code, deviceId: "device-aaaa" }).error);
  assert.equal(antifraud.checkViewer({ trackId: "t-ana-demo01", session: s.code, deviceId: "device-bbbb" }).code, 403, "aparelho que não entrou pelo QR");
  tracks.vote("t-ana-demo01", true, "device-aaaa");
  tracks.vote("t-ana-demo01", true, "device-aaaa");
  assert.equal(tracks.summary(tracks.get("t-ana-demo01")).votes.up, before + 1);
  tracks.vote("t-ana-demo01", false, "device-aaaa"); // troca o voto
  const v = tracks.summary(tracks.get("t-ana-demo01")).votes;
  assert.equal(v.up, before);
});

test("denúncia: duplicada é recusada; peso 3 põe a trilha em revisão", async () => {
  fresh();
  const scene = { sceneId: "c1", productId: "jaqueta-couro" };
  assert.ok((await tracks.report("t-ana-demo01", scene, "dev-1")).track);
  assert.equal((await tracks.report("t-ana-demo01", scene, "dev-1")).code, 409);
  assert.ok((await tracks.report("t-ana-demo01", { sceneId: "c1", productId: "perfume" }, "dev-1")).error, "produto fora da cena");
  await tracks.report("t-ana-demo01", scene, "dev-2");
  assert.equal(tracks.get("t-ana-demo01").status, "ativa");
  await tracks.report("t-ana-demo01", scene, "dev-3");
  assert.equal(tracks.get("t-ana-demo01").status, "em_revisao");
});

test("reputação: quem denuncia errado passa a pesar menos", async () => {
  fresh();
  const scene = { sceneId: "c1", productId: "jaqueta-couro" };
  for (const d of ["x1", "x2", "x3"]) await tracks.report("t-ana-demo01", scene, d);
  await tracks.review("t-ana-demo01", "ok"); // denúncias improcedentes
  await tracks.review("t-ana-demo01", "ok");
  S().deviceRep.x1 = { ok: 0, bad: 2 };
  S().deviceRep.x2 = { ok: 0, bad: 2 };
  S().deviceRep.x3 = { ok: 0, bad: 2 };
  const s2 = { sceneId: "c2", productId: "caneca-ceramica" };
  for (const d of ["x1", "x2", "x3"]) await tracks.report("t-ana-demo01", s2, d);
  assert.equal(tracks.get("t-ana-demo01").status, "ativa", "3 denúncias de peso 0,25 não bastam");
});

test("atribuição: venda só conta com clique válido nas últimas 24 h", () => {
  fresh();
  const { click } = antifraud.registerClick({ trackId: "t-ana-demo01", productId: "jaqueta-couro", storeId: "amazon", deviceId: "viewer-12345678" });
  const ok = money.registerSale({ clickId: click.id, value: 500, storeId: "amazon" });
  assert.equal(ok.authorId, "ana");
  const late = money.registerSale({ clickId: click.id, value: 500, storeId: "amazon", at: click.at + (ATTRIBUTION_HOURS + 1) * 3600e3 });
  assert.equal(late.authorId, null);
  assert.equal(late.attribution, "sem_atribuicao");
  const anon = antifraud.registerClick({ trackId: "t-ana-demo01", productId: "sofa-3-lugares", storeId: "amazon" }).click;
  assert.equal(anon.anonymous, true);
  assert.equal(money.registerSale({ clickId: anon.id, value: 3000, storeId: "amazon" }).authorId, null);
});

test("clique repetido do mesmo aparelho em 10 min conta uma vez", () => {
  fresh();
  const a = antifraud.registerClick({ trackId: "t-ana-demo01", productId: "caneca-ceramica", storeId: "amazon", deviceId: "viewer-abcdefgh" });
  const b = antifraud.registerClick({ trackId: "t-ana-demo01", productId: "caneca-ceramica", storeId: "amazon", deviceId: "viewer-abcdefgh" });
  assert.equal(b.duplicate, true);
  assert.equal(a.click.id, b.click.id);
});

test("custódia: 30 dias, depois KYC, depois liberado", () => {
  fresh();
  const u = auth.signup({ username: "joao", password: "12345678" }).user;
  S().tracks["t-joao"] = { ...JSON.parse(JSON.stringify(tracks.get("t-ana-demo01"))), id: "t-joao", authorId: u.authorId };
  const { click } = antifraud.registerClick({ trackId: "t-joao", productId: "jaqueta-couro", storeId: "amazon", deviceId: "viewer-joao0001" });
  money.registerSale({ clickId: click.id, value: 1000, storeId: "amazon" });
  const status = () => money.ledger("joao").entries[0].status;
  assert.equal(status(), "custodia");
  assert.equal(money.ledger("joao").entries[0].share, 24); // 1000 × 6% × 40%
  S().clockOffsetDays += HOLD_DAYS;
  assert.equal(status(), "aguardando_kyc");
  assert.ok(money.withdraw("joao", "joao").error);
  const k = money.submitKyc("joao", { name: "João Silva", document: "123.456.789-09", birth: "1990-01-01", bank: "joao@pix" }, "joao");
  assert.equal(k.author.kyc, "em_analise");
  money.setKyc("joao", "aprovado", "moderador");
  assert.equal(status(), "liberado");
});

test("KYC: menor de idade e documento repetido são recusados", () => {
  fresh();
  auth.signup({ username: "teen", password: "12345678" });
  auth.signup({ username: "clone", password: "12345678" });
  const minor = money.submitKyc("teen", { name: "Ana Jovem", document: "12345678909", birth: "2015-01-01", bank: "pix-teen" }, "teen");
  assert.ok(minor.errors.some((e) => e.includes("18 anos")));
  assert.ok(!money.submitKyc("teen", { name: "Ana Adulta", document: "12345678909", birth: "1990-01-01", bank: "pix-teen" }, "teen").errors);
  const dup = money.submitKyc("clone", { name: "Outra Pessoa", document: "12345678909", birth: "1990-01-01", bank: "pix-clone" }, "clone");
  assert.ok(dup.errors.some((e) => e.includes("outra conta")));
});

test("AML: autocompra gera alerta grave e bloqueia saque até a decisão", () => {
  fresh();
  const alert = S().alerts.find((a) => a.authorId === "promo_x" && a.rule === "autocompra");
  assert.ok(alert, "seed de promo_x dispara autocompra");
  assert.equal(aml.blocksPayout("promo_x"), true);
  assert.ok(money.ledger("promo_x").payoutHold);
  assert.ok(aml.decide(alert.id, "comunicado", "curto", "moderador").error, "comunicação exige fundamento");
  aml.decide(alert.id, "sem_irregularidade", "Compras de familiares, verificado", "moderador");
  assert.equal(aml.blocksPayout("promo_x"), false);
});

test("AML: autocompra simulada de um autor limpo também é detectada", async () => {
  fresh();
  assert.equal(aml.blocksPayout("ana"), false);
  await money.simulateSale({ authorId: "ana", selfPurchase: true });
  assert.ok(S().alerts.some((a) => a.authorId === "ana" && a.rule === "autocompra"));
  assert.equal(aml.blocksPayout("ana"), true);
});

test("moderação: condenar estorna o retido e tira a trilha do ranking", () => {
  fresh();
  tracks.review("t-promo-demo01", "fraude");
  const L = money.ledger("promo_x");
  assert.ok(L.totals.estornado > 0);
  assert.equal(L.totals.custodia + L.totals.congelado, 0);
  assert.ok(!tracks.ranked("demo-01").some((t) => t.id === "t-promo-demo01"));
  // quem denunciou certo ganha reputação
  assert.equal(S().deviceRep["seed-dev-0"].ok, 1);
});

test("ranking: oficial primeiro, depois a comunidade pela nota", () => {
  fresh();
  const r = tracks.ranked("demo-01").map((t) => t.id);
  assert.deepEqual(r, ["t-oficial-demo01", "t-ana-demo01", "t-promo-demo01"]);
});

// ======================================================================= v4: oferta oficial e parceiros
const official = require("../server/official");
const partners = require("../server/partners");
const signOrder = (seller, body) => {
  const raw = JSON.stringify(body), ts = String(Date.now());
  return { raw, headers: { "x-sceneshop-timestamp": ts, "x-sceneshop-signature": official.sellerSignature(seller.secret, ts, raw) } };
};
const deps = () => ({ money, aml });
const clickAndToken = (partnerId = "aurora") => {
  const { click } = antifraud.registerClick({ trackId: "t-oficial-demo01", productId: "jaqueta-couro", storeId: "urbano-oficial", deviceId: "viewer-oficial01", partnerId });
  return { click, ...official.issueToken({ productId: "jaqueta-couro", click, workId: "demo-01", partnerId }) };
};

test("código de oferta: assinatura confere; preço alterado invalida", () => {
  fresh();
  const { token, payload } = clickAndToken();
  assert.equal(official.verifyToken(token).valid, true);
  assert.equal(payload.prc, 47990);
  const [v, body, sig] = token.split(".");
  const p = JSON.parse(Buffer.from(body, "base64url").toString());
  p.prc = 100; // alguém tenta baixar o preço (ou a comissão) no link
  const forged = `${v}.${Buffer.from(JSON.stringify(p)).toString("base64url")}.${sig}`;
  assert.equal(official.verifyToken(forged).reason, "assinatura");
  assert.equal(official.verifyToken(token, { at: payload.exp + 1 }).reason, "expirado");
});

test("loja confere o código só com a chave pública", () => {
  fresh();
  const { token } = clickAndToken();
  const pub = S().offerKeys.public; // a loja só tem isto: não consegue criar códigos, só conferir
  assert.equal(official.verifyToken(token, { publicKeyPem: pub }).valid, true);
});

test("aviso de pedido: assinatura do vendedor obrigatória", () => {
  fresh();
  const { token } = clickAndToken();
  const body = { offer: token, orderId: "P1", quantity: 1, unitPrice: 479.9, status: "pago" };
  const r = official.receiveOrder("urbano-oficial", body, { "x-sceneshop-timestamp": String(Date.now()), "x-sceneshop-signature": "00" }, JSON.stringify(body), deps());
  assert.equal(r.code, 401);
  const other = S().sellers["lar-design-oficial"]; // outra loja tentando se passar pela Urbano
  const s2 = signOrder(other, body);
  assert.equal(official.receiveOrder("urbano-oficial", body, s2.headers, s2.raw, deps()).code, 401);
});

test("pedido no preço garantido gera comissão (com parte do canal parceiro); repetido conta uma vez", () => {
  fresh();
  const seller = S().sellers["urbano-oficial"];
  const { token } = clickAndToken();
  const body = { offer: token, orderId: "P2", quantity: 2, unitPrice: 479.9, status: "pago" };
  const s1 = signOrder(seller, body);
  const r = official.receiveOrder("urbano-oficial", body, s1.headers, s1.raw, deps());
  assert.equal(r.ok, true);
  assert.equal(r.commission, 115.18); // 959,80 × 12%
  const again = official.receiveOrder("urbano-oficial", body, signOrder(seller, body).headers, s1.raw, deps());
  assert.equal(again.duplicate, true);
  assert.equal(S().sales.filter((x) => x.orderId === "P2").length, 1);
  const e = money.ledger("produtora-demo").entries.find((x) => x.official);
  assert.equal(e.partnerPart, 23.04);  // 20% para a Aurora Play
  assert.equal(e.share, 46.07);        // 50% do restante para a produtora
  assert.equal(e.status, "custodia");
});

test("pedido acima do preço garantido é recusado e abre alerta contra o vendedor", () => {
  fresh();
  const seller = S().sellers["urbano-oficial"];
  const { token } = clickAndToken();
  const body = { offer: token, orderId: "P3", quantity: 1, unitPrice: 520, status: "pago" };
  const s1 = signOrder(seller, body);
  assert.equal(official.receiveOrder("urbano-oficial", body, s1.headers, s1.raw, deps()).code, 409);
  assert.ok(S().alerts.some((a) => a.sellerId === "urbano-oficial" && a.rule === "preco_divergente"));
  assert.equal(S().sales.filter((x) => x.orderId === "P3").length, 0);
});

test("código de uma loja não serve em outra", () => {
  fresh();
  const { token } = clickAndToken();
  const other = S().sellers["lar-design-oficial"];
  const body = { offer: token, orderId: "P4", quantity: 1, unitPrice: 479.9, status: "pago" };
  const s1 = signOrder(other, body);
  assert.equal(official.receiveOrder("lar-design-oficial", body, s1.headers, s1.raw, deps()).code, 422);
});

test("devolução estorna a comissão", () => {
  fresh();
  const seller = S().sellers["urbano-oficial"];
  const { token } = clickAndToken();
  const pay = { offer: token, orderId: "P5", quantity: 1, unitPrice: 479.9, status: "pago" };
  const a = signOrder(seller, pay);
  official.receiveOrder("urbano-oficial", pay, a.headers, a.raw, deps());
  const ref = { orderId: "P5", status: "devolvido" };
  const b = signOrder(seller, ref);
  assert.equal(official.receiveOrder("urbano-oficial", ref, b.headers, b.raw, deps()).status, "estornado");
  assert.equal(money.ledger("produtora-demo").entries.find((x) => x.official).status, "estornado");
});

test("produtora define oferta oficial com limites de comissão", () => {
  fresh();
  assert.ok(official.setOffer("caneca-ceramica", { sellerId: "urbano-oficial", price: 55, commission: 1.2 }, "produtora").errors);
  assert.ok(official.setOffer("caneca-ceramica", { sellerId: "urbano-oficial", price: 55, commission: 0.1, validDays: 30 }, "produtora").offer);
  assert.equal(official.asListedOffer("caneca-ceramica").price, 55);
  official.setOffer("caneca-ceramica", {}, "produtora");
  assert.equal(official.asListedOffer("caneca-ceramica"), null);
});

test("parceiro: chave só funciona no domínio autorizado e nas obras liberadas", () => {
  fresh();
  const req = (key, origin) => ({ headers: { "x-sceneshop-key": key, origin }, query: {} });
  assert.equal(partners.resolve(req("pk_aurora_demo", "http://localhost:3000"), "demo-01").partner.id, "aurora");
  assert.equal(partners.resolve(req("pk_aurora_demo", "https://site-pirata.com"), "demo-01").code, 403);
  assert.equal(partners.resolve(req("pk_invalida", "http://localhost:3000"), "demo-01").code, 401);
  S().workPartners["demo-01"] = ["prisma"];
  assert.equal(partners.resolve(req("pk_aurora_demo", "http://localhost:3000"), "demo-01").code, 403);
});

// ======================================================================= v5: acordos com grandes varejistas
const retailClick = (productId, seller) => antifraud.registerClick({ trackId: "t-oficial-demo01", productId, storeId: seller, deviceId: "viewer-varejo01" }).click;

test("varejista com cupons: cada clique recebe um cupom diferente do lote", () => {
  fresh();
  const a = official.buildRedirect({ productId: "oculos-aviador", click: retailClick("oculos-aviador", "megaloja"), workId: "demo-01" });
  const b = official.buildRedirect({ productId: "oculos-aviador", click: retailClick("oculos-aviador", "megaloja"), workId: "demo-01" });
  const ca = new URL(a.url, "http://x").searchParams.get("cupom"), cb = new URL(b.url, "http://x").searchParams.get("cupom");
  assert.ok(ca && cb && ca !== cb);
  assert.equal(official.poolStatus("megaloja").reservado, 2);
});

test("relatório diário: cupom vira venda; cupom repetido é recusado e gera alerta", () => {
  fresh();
  const seller = S().sellers.megaloja;
  const link = official.buildRedirect({ productId: "oculos-aviador", click: retailClick("oculos-aviador", "megaloja"), workId: "demo-01", partnerId: "aurora" });
  const coupon = new URL(link.url, "http://x").searchParams.get("cupom");
  const report = { orders: [
    { orderId: "V1", coupon, quantity: 1, unitPrice: 269 },
    { orderId: "V2", coupon, quantity: 1, unitPrice: 269 }, // mesmo cupom em outro pedido
  ] };
  const sg = signOrder(seller, report);
  const r = official.receiveReport("megaloja", report, sg.headers, sg.raw, deps());
  assert.equal(r.summary.registrados, 1);
  assert.equal(r.summary.recusados, 1);
  assert.equal(official.poolStatus("megaloja").usado, 1);
  assert.ok(S().alerts.some((a) => a.sellerId === "megaloja" && a.rule === "cupom_reutilizado"));
});

test("relatório atrasado vale se o pedido foi feito dentro da validade da oferta", () => {
  fresh();
  const seller = S().sellers.megaloja;
  const link = official.buildRedirect({ productId: "fone-sem-fio", click: retailClick("fone-sem-fio", "megaloja"), workId: "demo-01" });
  const coupon = new URL(link.url, "http://x").searchParams.get("cupom");
  const orderedAt = store.now() + 3600e3;       // comprou 1 h depois do clique
  S().clockOffsetDays += 5;                      // o relatório chega 5 dias depois
  const rep = { orders: [{ orderId: "V9", coupon, quantity: 1, unitPrice: 849, orderedAt }] };
  const sg = signOrder(seller, rep);
  assert.equal(official.receiveReport("megaloja", rep, sg.headers, sg.raw, deps()).summary.registrados, 1);
  const late = { orders: [{ orderId: "V10", ref: link.offerId, quantity: 1, unitPrice: 849, orderedAt: store.now() }] }; // pedido depois de vencer
  const sg2 = signOrder(seller, late);
  assert.equal(official.receiveReport("megaloja", late, sg2.headers, sg2.raw, deps()).summary.recusados, 1);
});

test("cupons esgotados: espectador vai à loja sem preço garantido", () => {
  fresh();
  S().codePools.megaloja.forEach((c) => (c.status = "usado"));
  const link = official.buildRedirect({ productId: "oculos-aviador", click: retailClick("oculos-aviador", "megaloja"), workId: "demo-01" });
  assert.equal(link.guaranteed, false);
  assert.equal(new URL(link.url, "http://x").searchParams.get("cupom"), null);
  assert.equal(official.poolStatus("megaloja").low, true);
});

test("lote de cupons: ignora repetidos e inválidos", () => {
  fresh();
  const r = official.addCodes("megaloja", "oculos-aviador", "NOVO-0001\nnovo-0001\nMEGA-OCU-1000\n??\nNOVO-0002", "produtora");
  assert.equal(r.added, 2);
  assert.deepEqual(r.invalid, ["??"]);
  assert.ok(official.addCodes("shopcenter", null, "X-1234", "produtora").error);
});

test("varejista com campanha: pedido pela referência; campanha obrigatória para ofertar", () => {
  fresh();
  const seller = S().sellers.shopcenter;
  const link = official.buildRedirect({ productId: "sofa-3-lugares", click: retailClick("sofa-3-lugares", "shopcenter"), workId: "demo-01" });
  const u = new URL(link.url, "http://x");
  assert.equal(u.searchParams.get("campanha"), "CMP-SOFA-2609");
  const order = { orderId: "S1", ref: u.searchParams.get("ss_ref"), quantity: 1, unitPrice: 3090, status: "pago" };
  const sg = signOrder(seller, order);
  assert.equal(official.receiveOrder("shopcenter", order, sg.headers, sg.raw, deps()).ok, true);
  assert.ok(official.setOffer("vestido-vermelho", { sellerId: "shopcenter", price: 600, commission: 0.1 }, "produtora").errors[0].includes("campanha"));
  official.setCampaign("shopcenter", "vestido-vermelho", "CMP-VEST-01", "produtora");
  assert.ok(official.setOffer("vestido-vermelho", { sellerId: "shopcenter", price: 600, commission: 0.1 }, "produtora").offer);
});

test("acordo vencido tira a oferta garantida do ar", () => {
  fresh();
  assert.ok(official.asListedOffer("sofa-3-lugares"));
  S().sellers.shopcenter.agreement.until = store.now() - 1;
  assert.equal(official.asListedOffer("sofa-3-lugares"), null);
});

// ------------------------------------------------------------------ piloto
const catalog = require("../server/catalog");
const uploads = require("../server/uploads");

test("piloto: caminhos de upload só aceitam arquivos gerados pelo servidor", () => {
  assert.equal(uploads.isUploadUrl("/uploads/images/abc123.jpg"), true);
  assert.equal(uploads.isUploadUrl("/uploads/videos/abc123.webm"), true);
  assert.equal(uploads.isUploadUrl("/uploads/images/../runtime.json"), false);
  assert.equal(uploads.isUploadUrl("https://evil.example/x.jpg"), false);
  assert.equal(uploads.isUploadUrl("/uploads/images/abc.html"), false);
  assert.throws(() => uploads.saveDataUrl("data:image/png;base64," + Buffer.from("<script>").toString("base64")), /inválida/);
  assert.throws(() => uploads.saveDataUrl("data:text/html;base64,AAAA"), /inválida/);
});

test("piloto: busca exige todas as palavras e mostra primeiro os produtos do autor", () => {
  fresh();
  const p = { id: "u-relogio-teste", name: "Relógio Aurora Classic", brand: "Aurora", category: "Acessórios", referencePrice: 1299.9, image: "/x.jpg", images: ["/x.jpg"], createdBy: "produtora-demo", storeIds: {} };
  S().userProducts[p.id] = p; catalog.addProduct(p);
  const r = catalog.searchProducts("relogio", "produtora-demo");
  assert.equal(r[0].id, p.id);
  assert.ok(r.length > 1, "o catálogo da demo também tem relógios");
  assert.deepEqual(catalog.searchProducts("relogio aurora").map((x) => x.id), [p.id]);
});

test("piloto: 'restaurar demo' mantém o piloto; 'restaurar tudo' apaga", () => {
  fresh();
  const w = { id: "obra-teste", title: "Obra teste", duration: 24, video: "/uploads/videos/a1.webm", ownerId: "produtora-demo", pilot: true, scenes: [] };
  S().userWorks[w.id] = w; catalog.addWork(w);
  store.reset();
  assert.ok(S().userWorks["obra-teste"] && catalog.getWork("obra-teste"));
  store.reset({ keepPilot: false });
  assert.ok(!S().userWorks["obra-teste"] && !catalog.getWork("obra-teste"));
});

// ------------------------------------------------------------------ IA (Gemini): tratamento da resposta
const ai = require("../server/ai");

test("IA: resposta do Gemini vira cenas contínuas, caixas em % e só ids do catálogo", () => {
  const work = { id: "w", title: "Obra", duration: 60 };
  const products = [{ id: "kimono-1", name: "Kimono" }];
  const out = ai.normalize({ scenes: [
    { start: "00:20", end: "00:45", title: "B", items: [{ name: "Kimono floral", category: "Moda", bestTime: "00:30", box_2d: [100, 200, 600, 500], productId: "kimono-1", matchConfidence: 1.7 }] },
    { start: "00:02", end: "00:18", title: "A", items: [{ name: "Inventado", category: "Moda", bestTime: "00:90", box_2d: [5, 5, 2, 2], productId: "nao-existe", matchConfidence: 0.9 }] },
    { start: "00:50", end: "00:40", title: "invertida", items: [] },
  ] }, { work, products });
  assert.deepEqual(out.map((s) => [s.start, s.end, s.title]), [[0, 18, "A"], [18, 60, "B"]]);
  const k = out[1].items[0];
  assert.deepEqual(k.box, { x: 20, y: 10, w: 30, h: 50 });
  assert.equal(k.productId, "kimono-1");
  assert.equal(k.confidence, 1);
  assert.equal(k.t, 30);
  const bad = out[0].items[0];
  assert.equal(bad.productId, null, "id fora do catálogo é descartado");
  assert.equal(bad.confidence, 0);
  assert.equal(bad.box, null, "caixa invertida é descartada");
  assert.equal(bad.t, 18, "instante fora da cena é trazido para dentro dela");
});

test("IA: resposta vazia vira uma cena com a obra inteira; prompt leva o catálogo e o modo", () => {
  const work = { id: "w", title: "Obra", duration: 12 };
  assert.deepEqual(ai.normalize({}, { work, products: [] }).map((s) => [s.start, s.end]), [[0, 12]]);
  const p = ai.buildPrompt({ work, products: [{ id: "a1", name: "Anel", brand: "X", category: "Joias" }], oneScene: true });
  assert.match(p, /UMA cena só/);
  assert.match(p, /id: a1 \| Anel/);
});
