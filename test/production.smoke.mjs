// Smoke de PRODUÇÃO (DEMO=0): o fluxo de um cliente real pela API, sem dados de demonstração.
// Pré-requisito: servidor em DEMO=0 com uma produtora criada por tools/create-account.js.
//   BASE=http://localhost:3000 PROD_USER=o2filmes PROD_PASS=... node test/production.smoke.mjs
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
const BASE = process.env.BASE || "http://localhost:3000";
const FIX = path.join(path.dirname(new URL(import.meta.url).pathname), "fixtures", "pilot");
let failed = 0;
const check = (c, m) => { if (!c) { failed++; console.log("✗ FALHOU:", m); } else console.log("  ✓", m); };
const req = async (p, { method = "GET", body, raw, token, headers = {} } = {}) => {
  const r = await fetch(BASE + p, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(raw ? { "Content-Type": "application/octet-stream" } : body ? { "Content-Type": "application/json" } : {}), ...headers }, body: raw || (body ? JSON.stringify(body) : undefined), redirect: "manual" });
  let data = null; try { data = await r.json(); } catch (_) {}
  return { status: r.status, data, headers: r.headers };
};

const health = await req("/api/health");
check(health.status === 200 && health.data.demo === false, `servidor em produção (demo=${health.data && health.data.demo}, backend=${health.data && health.data.data && health.data.data.backend})`);
const cfg = await req("/api/config");
check(!JSON.stringify(cfg.data || {}).includes("demo1234"), "nenhuma conta ou senha de demonstração exposta");
const demoLogin = await req("/api/auth/login", { method: "POST", body: { username: "produtora", password: "demo1234" } });
check(demoLogin.status >= 400, "conta de demonstração não existe em produção");
check((await req("/api/dev/reset", { method: "POST" })).status === 404, "rota de reset de demonstração desligada");

const login = await req("/api/auth/login", { method: "POST", body: { username: process.env.PROD_USER, password: process.env.PROD_PASS } });
check(login.status === 200 && login.data.token, "produtora entra com a conta criada pelo administrador");
const token = login.data.token;
const orgs = (await req("/api/me/organizations", { token })).data || [];
check(orgs.length === 1 && orgs[0].kind === "PRODUCER", "produtora pertence à própria organização (PRODUCER)");

const vid = await req("/api/uploads/video?filename=novela.webm", { method: "POST", raw: fs.readFileSync(path.join(FIX, "novela.webm")), token });
check(vid.status === 201, "envio do vídeo");
const work = await req("/api/works", { method: "POST", token, body: { title: "Capítulo de estreia", video: vid.data.url, duration: 24 } });
check(work.status === 201, "obra cadastrada");
const img = await req("/api/uploads/image?filename=Relogio-Aurora-Classic-1.jpg", { method: "POST", raw: fs.readFileSync(path.join(FIX, "Relogio-Aurora-Classic-1.jpg")), token });
const prod = await req("/api/products", { method: "POST", token, body: { name: "Relógio Aurora Classic", brand: "Aurora", category: "Acessórios", referencePrice: "1.299,90", images: [img.data.url] } });
check(prod.status === 201, "produto cadastrado com foto");
const offer = await req(`/api/official-offers/${prod.data.id}`, { method: "PUT", token, body: { sellerId: process.env.PROD_SELLER || "urbano-oficial", price: 1099.9, commission: 0.1, validDays: 90 } });
check(offer.status < 300, `oferta oficial com preço garantido (${offer.status}${offer.data && offer.data.errors ? " " + offer.data.errors.join(" ") : ""})`);
const track = await req("/api/tracks", { method: "POST", token, body: { workId: work.data.id, title: "Trilha oficial", offset: 0, scenes: [{ id: "c1", title: "Abertura", start: 0, end: 24, products: [{ id: prod.data.id, match: "exato", box: { x: 30, y: 30, w: 20, h: 30 } }] }] } });
check(track.status < 300 && track.data.track && track.data.track.type === "official", `trilha publicada como Oficial (${track.status} ${JSON.stringify(track.data && (track.data.errors || track.data.error) || "")})`);

const FP = { Referer: `${BASE}/assistir/${work.data.id}` }; // como o navegador no próprio site
check((await req(`/api/works/${work.data.id}`)).status === 401, "sem origem, a obra exige chave de parceiro");
check((await req(`/api/works/${work.data.id}`, { headers: { Referer: "https://site-estranho.example/x" } })).status === 401, "outro site sem chave é recusado");
const pub = await req(`/api/works/${work.data.id}`, { headers: FP });
const p0 = pub.data && pub.data.scenes && pub.data.scenes[0] && pub.data.scenes[0].products[0];
check(p0 && p0.name === "Relógio Aurora Classic", "espectador vê o produto na cena");
const best = p0 && (p0.offers || [])[0];
check(best && best.price === 1099.9, `oferta oficial com preço garantido para o espectador (${best && best.price})`);
// clique em "Comprar" -> loja com acordo, levando o código assinado
const go = await req(best.url.replace(/^https?:\/\/[^/]+/, "") + "&d=viewer-smoke-0001", { headers: FP }); // o player sempre manda o aparelho do espectador
const loc = go.headers.get("location") || "";
check(go.status === 302 && loc.startsWith("https://") && /ss_offer=/.test(loc), `Comprar leva à loja com o código assinado (${loc.slice(0, 60)}…)`);
const ssOffer = new URL(loc).searchParams.get("ss_offer");
const verify = await req(`/api/offers/verify?token=${encodeURIComponent(ssOffer)}`);
check(verify.status === 200 && verify.data.offer.price === 1099.9, "loja confere o código: preço garantido R$ 1.099,90");
// a loja avisa a venda paga, assinando com o segredo recebido no cadastro
if (process.env.SELLER_SECRET) {
  const raw = JSON.stringify({ offer: ssOffer, orderId: `PED-${Date.now()}`, quantity: 1, unitPrice: 1099.9, status: "pago" });
  const ts = String(Date.now());
  const sig = crypto.createHmac("sha256", process.env.SELLER_SECRET).update(`${ts}.${raw}`).digest("hex");
  const wh = await fetch(`${BASE}/api/sellers/${process.env.PROD_SELLER || "urbano-oficial"}/orders`, { method: "POST", headers: { "Content-Type": "application/json", "X-SceneShop-Timestamp": ts, "X-SceneShop-Signature": sig }, body: raw });
  const whd = await wh.json().catch(() => ({}));
  check(wh.status < 300 && whd.ok, `loja avisa a venda e o SceneShop registra a comissão (${JSON.stringify(whd).slice(0, 80)})`);
  const bad = await fetch(`${BASE}/api/sellers/${process.env.PROD_SELLER || "urbano-oficial"}/orders`, { method: "POST", headers: { "Content-Type": "application/json", "X-SceneShop-Timestamp": ts, "X-SceneShop-Signature": "0".repeat(64) }, body: raw });
  check(bad.status >= 400, "aviso com assinatura errada é recusado");
  const ledger = await req("/api/me/ledger", { token });
  check(ledger.status === 200 && ledger.data.entries.some((e) => e.official && e.value === 1099.9), "venda oficial aparece nos Ganhos da produtora");
}
const sess = await req("/api/sessions", { method: "POST", headers: FP, body: { workId: work.data.id, time: 3 } });
check(sess.status < 300 && sess.data.code, "sessão TV → celular criada (QR code)");

const tl = await req(`/api/works/${work.data.id}/commerce-timeline`);
check(tl.status === 200 && tl.data.scenes && tl.data.scenes.length === 1, "Commerce Timeline oficial publicada");

const mod = await req("/api/auth/login", { method: "POST", body: { username: process.env.MOD_USER || "compliance", password: process.env.MOD_PASS } });
check(mod.status === 200 && mod.data.user.role === "moderator", "moderador entra");
check((await req("/api/moderation", { token: mod.data.token })).status === 200, "moderador acessa a fila de moderação");

console.log(failed ? `\n${failed} falha(s)` : "\nProdução: tudo certo");
process.exitCode = failed ? 1 : 0;
