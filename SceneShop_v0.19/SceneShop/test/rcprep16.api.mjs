// rcprep.16: contas de clientes — contrato por cliente (padrão, por título e por produto), relatório
// separado por cliente → título → produto, acesso só da equipe SceneShop ao console, visão do próprio cliente,
// CSV e a comissão/divisão do contrato congeladas nas vendas novas (sem reescrever as antigas).
//   node test/rcprep16.api.mjs            (memória)
//   RC16_BACKEND=postgres DATABASE_URL=... node test/rcprep16.api.mjs
import assert from "node:assert/strict";

const PG = process.env.RC16_BACKEND === "postgres";
if (!PG) process.env.SCENESHOP_MEMORY = "1";
Object.assign(process.env, {
  DEMO: "1", DATA_BACKEND: PG ? "postgres" : "memory", SESSION_BACKEND: "memory",
  SESSION_SECRET: "sceneshop-rcprep16-secret-0123456789abcdef",
});
const { bootstrap, server, shutdown } = await import("../server/index.js");
const store = (await import("../server/store.js")).default;

let base;
const tokens = {};
const req = async (p, { method = "GET", body, as, org } = {}) => {
  const headers = { ...(as ? { authorization: `Bearer ${tokens[as]}` } : {}), ...(org ? { "x-sceneshop-organization": org } : {}) };
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(base + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const t = res.headers.get("content-type") || "";
  return { status: res.status, type: t, data: t.includes("json") ? await res.json() : await res.text() };
};
const ok = (cond, msg) => { assert.ok(cond, msg); console.log("  ✓", msg); };
const near = (a, b) => Math.abs(Number(a) - Number(b)) < 0.011;

let failed = false;
try {
  await bootstrap();
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
  await req("/api/dev/reset?all=1", { method: "POST" });
  for (const u of ["moderador", "produtora", "ana"]) tokens[u] = (await req("/api/auth/login", { method: "POST", body: { username: u, password: "demo1234" } })).data.token;
  const ORG = "org-demo-produtora";

  // ---------------------------------------------------------------- acesso
  ok((await req("/api/admin/clients", { as: "produtora" })).status === 403, "cliente (produtora) não acessa o console de clientes");
  ok((await req("/api/admin/clients")).status === 401, "sem login: 401");
  const list = await req("/api/admin/clients?days=3650", { as: "moderador" });
  ok(list.status === 200 && list.data.clients.some((c) => c.id === ORG) && list.data.clients.length >= 3, `equipe SceneShop vê todos os clientes (${list.data.clients.length})`);
  const before = list.data.clients.find((c) => c.id === ORG).totals;
  ok(before.clicks > 0 && before.orders > 0 && before.gmv > 0, `vendas e cliques da demonstração atribuídos ao cliente dono do título (${before.orders} pedidos, R$ ${before.gmv})`);
  const ana = list.data.clients.find((c) => c.id === "org-demo-ana").totals;
  ok(ana.orders === 0, "a trilha de comunidade da Ana na obra da produtora conta para o dono do título, não para a Ana");

  // ---------------------------------------------------------------- contrato: validação e versões
  const bad = await req(`/api/admin/clients/${ORG}/contract`, { method: "PUT", as: "moderador", body: { terms: { commissionRate: 250 } } });
  ok(bad.status === 400 && /comissão|commissionRate/i.test(bad.data.error), "contrato com comissão acima de 100% é recusado");
  const badDates = await req(`/api/admin/clients/${ORG}/contract`, { method: "PUT", as: "moderador", body: { startsAt: "2026-10-10", endsAt: "2026-10-01" } });
  ok(badDates.status === 400, "fim da vigência antes do início é recusado");
  ok((await req(`/api/admin/clients/nao-existe/contract`, { method: "PUT", as: "moderador", body: {} })).status === 404, "cliente inexistente: 404");

  const tr = Object.values(store.state.tracks).find((t) => t.workId === "demo-01" && t.type === "official");
  const productIds = [...new Set(tr.scenes.flatMap((s) => s.products.map((p) => p.id)))];
  const special = productIds[0];
  const put = await req(`/api/admin/clients/${ORG}/contract`, { method: "PUT", as: "moderador", body: {
    contractRef: "SONY-2026-01", monthlyFee: "500,00",
    terms: { commissionRate: 0.10, ownerShareRate: 0.70, cpcFee: 0.05 },
    works: { "demo-01": { cpaFee: 2, notes: "Programa piloto" } },
    products: { [special]: { commissionRate: 15 } },
    notes: "interno",
  } });
  ok(put.status === 200 && put.data.contract.version === 1 && put.data.contract.terms.commissionRate === 0.1 && put.data.contract.products[special].commissionRate === 0.15,
    "contrato salvo (versão 1): 10% padrão, 70% para o cliente, 15% (digitado 15) para um produto");

  // vendas antigas: congeladas, não mudam; taxas não se aplicam antes do contrato
  const after = (await req("/api/admin/clients?days=3650", { as: "moderador" })).data.clients.find((c) => c.id === ORG).totals;
  ok(near(after.commission, before.commission) && near(after.clientShare, before.clientShare) && after.cpcFees === 0 && after.cpaFees === 0,
    "o contrato não reescreve as vendas e cliques anteriores a ele");

  // ---------------------------------------------------------------- venda nova com o contrato
  const antifraud = (await import("../server/antifraud.js")).default || (await import("../server/antifraud.js"));
  const money = (await import("../server/money.js")).default || (await import("../server/money.js"));
  const normal = productIds.find((id) => id !== special);
  const sell = async (productId, value) => {
    const { click } = await Promise.resolve(antifraud.registerClick({ trackId: tr.id, productId, storeId: "amazon", deviceId: "viewer-rc16-" + productId.slice(0, 20) + Math.random().toString(36).slice(2, 8) }));
    return money.registerSale({ clickId: click.id, value, storeId: "amazon" });
  };
  const s1 = await sell(normal, 1000);
  ok(near(s1.financials.commission, 100) && near(s1.financials.ownerShare, 70) && near(s1.financials.sceneshopShare, 30) && s1.financials.clientOrganizationId === ORG && s1.financials.clientContractVersion === 1,
    "venda nova de R$ 1.000: comissão 10% (R$ 100), cliente 70% (R$ 70), SceneShop R$ 30, contrato v1 registrado na venda");
  const s2 = await sell(special, 1000);
  ok(near(s2.financials.commission, 150) && near(s2.financials.ownerShare, 105), "produto com condição própria: comissão 15% (R$ 150), cliente R$ 105");

  // contrato v2 não muda as vendas feitas na v1
  await req(`/api/admin/clients/${ORG}/contract`, { method: "PUT", as: "moderador", body: { contractRef: "SONY-2026-01", terms: { commissionRate: 0.2, ownerShareRate: 0.5 } } });
  ok(near(store.state.sales.find((x) => x.id === s1.id).financials.commission, 100), "contrato v2 não reescreve a venda feita na v1");
  const s3 = await sell(normal, 100);
  ok(near(s3.financials.commission, 20) && near(s3.financials.ownerShare, 10) && s3.financials.clientContractVersion === 2, "venda depois da v2 usa 20% / 50%");

  // ---------------------------------------------------------------- relatório por título e por produto
  const det = await req(`/api/admin/clients/${ORG}?days=3650`, { as: "moderador" });
  ok(det.status === 200 && det.data.contract.version === 2 && det.data.contract.history.length === 1, "detalhe do cliente traz o contrato v2 e o histórico (v1)");
  const w = det.data.report.byWork.find((x) => x.workId === "demo-01");
  ok(w && w.orders === before.orders + 3 && near(w.gmv, before.gmv + 2100), `por título: Cidade em Cenas com ${w.orders} pedidos e R$ ${w.gmv}`);
  ok(w.cpaFees === 4 && near(w.cpcFees, 0.1), "taxas do contrato v1 nas vendas/cliques da v1 (2 pedidos × R$ 2, 2 cliques × R$ 0,05); a v2 não tem taxas");
  const p = det.data.report.byProduct.find((x) => x.productId === special);
  ok(p && p.orders >= 1 && p.name && p.name !== special, `por produto: ${p.name}`);
  ok(det.data.report.totals.monthlyFees === 0 || det.data.report.totals.monthlyFees >= 0, "mensalidade aparece nos totais");

  // ---------------------------------------------------------------- CSV
  const csv = await req(`/api/admin/clients/${ORG}/report.csv?days=3650`, { as: "moderador" });
  ok(csv.status === 200 && /text\/csv/.test(csv.type) && /^﻿?Nível;ID;Nome/.test(csv.data) && /titulo;demo-01;/.test(csv.data), "CSV do cliente com linhas por título e por produto");

  // ---------------------------------------------------------------- visão do próprio cliente
  const me = await req("/api/me/account-report?days=3650", { as: "produtora", org: ORG });
  ok(me.status === 200 && me.data.report.byWork.some((x) => x.workId === "demo-01") && me.data.contract.version === 2 && me.data.contract.notes === undefined && !me.data.contract.history,
    "o cliente vê o próprio relatório e as condições do contrato (sem notas internas nem histórico)");
  const anaMe = await req("/api/me/account-report?days=3650", { as: "ana", org: "org-demo-ana" });
  ok(anaMe.status === 200 && !anaMe.data.report.byWork.some((x) => x.workId === "demo-01") && anaMe.data.report.totals.orders === 0, "outro cliente não vê os títulos nem as vendas da produtora");
  const meCsv = await req("/api/me/account-report.csv", { as: "produtora", org: ORG });
  ok(meCsv.status === 200 && /text\/csv/.test(meCsv.type), "o cliente baixa o próprio CSV");

  // ---------------------------------------------------------------- clique pelo /r leva o título
  const r = await fetch(`${base}/r?t=${tr.id}&p=${normal}&s=amazon&w=demo-01&d=viewer-rc16-redirect01`, { redirect: "manual" });
  const last = store.state.clicks[store.state.clicks.length - 1];
  ok([302, 404].includes(r.status) && last.workId === "demo-01", "clique registrado pelo /r guarda o título (workId)");

  // ---------------------------------------------------------------- carteiras (Google Pay / Apple Pay)
  const wc = (await req("/api/wallets/config")).data;
  ok(wc.googlePay && wc.googlePay.environment === "TEST" && wc.googlePay.gateway && !JSON.stringify(wc).match(/secret|cert|key_file/i) && wc.applePay === null,
    "carteiras: Google Pay em ambiente de TESTE na demonstração; Apple Pay só com certificado; nenhum segredo exposto");
  const mk = async () => (await req("/mkt/api/checkout", { method: "POST", body: { buyer: { name: "Maria Silva", email: "maria@example.com", cep: "01310-100", address: "Av. Paulista, 1000" }, items: [{ produto: normal, qty: 1 }] } })).data;
  const o1 = await mk();
  const badWallet = await req(`/mkt/api/order/${o1.id}/pay-wallet`, { method: "POST", body: { method: "BITCOIN", token: "x" } });
  ok(badWallet.status === 400, "carteira desconhecida é recusada");
  const apple = await req(`/mkt/api/order/${o1.id}/pay-wallet`, { method: "POST", body: { method: "APPLE_PAY", token: "{}" } });
  ok(apple.status === 501, "Apple Pay sem gateway configurado: 501 (nada é cobrado)");
  const gp = await req(`/mkt/api/order/${o1.id}/pay-wallet`, { method: "POST", body: { method: "GOOGLE_PAY", token: JSON.stringify({ signature: "TEST", protocolVersion: "ECv2", signedMessage: "{}" }), card: { network: "VISA", last4: "1111" } } });
  ok(gp.status === 200 && gp.data.status === "pago" && gp.data.payment.method === "GOOGLE_PAY" && gp.data.payment.simulated && gp.data.payment.card.last4 === "1111" && !JSON.stringify(gp.data).includes("signedMessage"),
    "Google Pay (teste): pedido pago; guarda só bandeira e final do cartão, nunca o token");
  const stored = store.state.mktOrders.find((x) => x.id === o1.id);
  ok(!JSON.stringify(stored).includes("signedMessage"), "o token da carteira não fica salvo no pedido");
  ok((await req("/api/wallets/apple/session", { method: "POST", body: { validationURL: "https://evil.example.com/x" } })).status === 501, "validação Apple Pay indisponível sem certificado");
} catch (e) {
  failed = true;
  console.error("✗ FALHOU:", e.stack || e.message);
} finally {
  await new Promise((r) => server.close(r));
  await (shutdown ? shutdown().catch(() => {}) : null);
  console.log(failed ? "\nrcprep.16: FALHOU" : "\nrcprep.16: tudo certo");
  process.exit(failed ? 1 : 0);
}
