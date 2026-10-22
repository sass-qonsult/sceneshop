/**
 * Carteiras digitais (rcprep.16): Google Pay (inclui os cartões da Carteira do Google), Apple Pay e, pelo
 * navegador Samsung Internet, Samsung Pay — sempre pelo padrão Payment Request do navegador/app.
 *
 * Segurança: o SceneShop NUNCA vê o número do cartão. A carteira entrega um TOKEN criptografado para o
 * gateway de pagamento (PSP) configurado; o servidor só repassa esse token ao PSP e guarda o resultado
 * (aprovado/recusado, bandeira e final do cartão quando o PSP informar). Nada do token fica salvo.
 *
 * Onde vale:
 *  - compras finalizadas pelo SceneShop (hoje o Marketplace Piloto; amanhã um checkout próprio);
 *  - compras nas lojas parceiras: o app abre a loja no navegador do sistema (Chrome, Samsung Internet,
 *    Safari), onde a carteira e os cartões salvos já funcionam pelo checkout da própria loja.
 *
 * Configuração (variáveis de ambiente):
 *   GOOGLE_PAY_ENV=TEST|PRODUCTION            (padrão TEST)
 *   GOOGLE_PAY_MERCHANT_ID                    (Google Pay & Wallet Console; obrigatório em PRODUCTION)
 *   GOOGLE_PAY_MERCHANT_NAME                  (padrão SceneShop)
 *   GOOGLE_PAY_GATEWAY / GOOGLE_PAY_GATEWAY_MERCHANT_ID   (ex.: pagarme / mercadopago / stripe / adyen / cielo…)
 *   GOOGLE_PAY_NETWORKS=VISA,MASTERCARD,ELO,AMEX
 *   APPLE_PAY_MERCHANT_ID, APPLE_PAY_CERT_FILE, APPLE_PAY_KEY_FILE   (certificado "Merchant Identity" da Apple)
 *   APPLE_PAY_DOMAIN_ASSOCIATION_FILE         (arquivo de verificação de domínio fornecido pela Apple)
 *   WALLET_PSP_URL, WALLET_PSP_SECRET         (endpoint do adaptador do PSP que recebe o token e cobra)
 * Em DEMO sem PSP, o Google Pay roda no ambiente de TESTE do Google (cartões de teste, nada é cobrado).
 */
const fs = require("fs");
const https = require("https");
const crypto = require("crypto");
const config = require("./config");

const env = (k, d = "") => String(process.env[k] || d).trim();

function googleConfig() {
  const environment = env("GOOGLE_PAY_ENV", "TEST").toUpperCase() === "PRODUCTION" ? "PRODUCTION" : "TEST";
  const gateway = env("GOOGLE_PAY_GATEWAY") || (config.DEMO ? "example" : "");
  const gatewayMerchantId = env("GOOGLE_PAY_GATEWAY_MERCHANT_ID") || (config.DEMO ? "exampleGatewayMerchantId" : "");
  const merchantId = env("GOOGLE_PAY_MERCHANT_ID");
  const enabled = Boolean(gateway && gatewayMerchantId && (environment === "TEST" || merchantId));
  return {
    enabled, environment, gateway, gatewayMerchantId, merchantId: merchantId || null, merchantName: env("GOOGLE_PAY_MERCHANT_NAME", "SceneShop"),
    networks: env("GOOGLE_PAY_NETWORKS", "VISA,MASTERCARD,ELO,AMEX").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean),
  };
}

function appleConfig() {
  const merchantIdentifier = env("APPLE_PAY_MERCHANT_ID");
  const ready = Boolean(merchantIdentifier && env("APPLE_PAY_CERT_FILE") && env("APPLE_PAY_KEY_FILE"));
  return { enabled: ready, merchantIdentifier: merchantIdentifier || null, displayName: env("APPLE_PAY_DISPLAY_NAME", "SceneShop"), networks: ["visa", "masterCard", "amex", "elo"] };
}

function pspConfigured() { return Boolean(env("WALLET_PSP_URL") && env("WALLET_PSP_SECRET")); }

/** O que o navegador/app precisa para montar o pedido de pagamento (sem nenhum segredo). */
function publicConfig() {
  const g = googleConfig(), a = appleConfig();
  return {
    simulated: !pspConfigured(),
    googlePay: g.enabled ? { environment: g.environment, merchantId: g.merchantId, merchantName: g.merchantName, gateway: g.gateway, gatewayMerchantId: g.gatewayMerchantId, networks: g.networks } : null,
    applePay: a.enabled ? { merchantIdentifier: a.merchantIdentifier, displayName: a.displayName, networks: a.networks, countryCode: "BR" } : null,
  };
}

// ------------------------------------------------------------------ Apple Pay: validação do comerciante
function appleMerchantSession({ validationURL, domain }) {
  const a = appleConfig();
  if (!a.enabled) return Promise.resolve({ error: "Apple Pay não configurado.", code: 501 });
  let u;
  try { u = new URL(validationURL); } catch (e) { return Promise.resolve({ error: "validationURL inválida.", code: 400 }); }
  // só os servidores da Apple (evita usar o certificado contra outro destino)
  if (u.protocol !== "https:" || !/(^|\.)apple\.com$/.test(u.hostname)) return Promise.resolve({ error: "validationURL fora da Apple.", code: 400 });
  const body = JSON.stringify({ merchantIdentifier: a.merchantIdentifier, displayName: a.displayName, initiative: "web", initiativeContext: domain });
  return new Promise((resolve) => {
    const r = https.request(u, { method: "POST", cert: fs.readFileSync(env("APPLE_PAY_CERT_FILE")), key: fs.readFileSync(env("APPLE_PAY_KEY_FILE")), headers: { "content-type": "application/json", "content-length": Buffer.byteLength(body) }, timeout: 15000 }, (res) => {
      let data = ""; res.on("data", (c) => (data += c));
      res.on("end", () => { try { res.statusCode === 200 ? resolve({ session: JSON.parse(data) }) : resolve({ error: "A Apple recusou a validação do comerciante.", code: 502 }); } catch (e) { resolve({ error: "Resposta inválida da Apple.", code: 502 }); } });
    });
    r.on("timeout", () => r.destroy(new Error("timeout")));
    r.on("error", () => resolve({ error: "Falha ao validar com a Apple.", code: 502 }));
    r.end(body);
  });
}

// ------------------------------------------------------------------ cobrança: repassa o token ao PSP
const METHODS = { GOOGLE_PAY: "googlePay", APPLE_PAY: "applePay", SAMSUNG_PAY: "samsungPay" };

/**
 * charge({ orderId, amount, currency, method, token, description })
 *  → { ok, status: 'APPROVED'|'DECLINED', simulated, card: { network, last4 }, pspReference }
 */
async function charge({ orderId, amount, currency = "BRL", method, token, cardHint = {} }) {
  if (!METHODS[method]) return { error: "Carteira não suportada.", code: 400 };
  if (!token || typeof token !== "string" || token.length > 64 * 1024) return { error: "Token da carteira ausente.", code: 400 };
  const value = Math.round(Number(amount) * 100);
  if (!(value > 0)) return { error: "Valor inválido.", code: 400 };
  const card = { network: String(cardHint.network || "").slice(0, 20) || null, last4: /^\d{4}$/.test(String(cardHint.last4 || "")) ? String(cardHint.last4) : null };
  if (!pspConfigured()) {
    // sem PSP: só aceita o ambiente de TESTE do Google Pay (em DEMO) — nada é cobrado
    const g = googleConfig();
    if (config.DEMO && method === "GOOGLE_PAY" && g.environment === "TEST") return { ok: true, status: "APPROVED", simulated: true, card, pspReference: "sim_" + crypto.randomBytes(6).toString("hex") };
    return { error: "Pagamento por carteira ainda não está ligado a um gateway (WALLET_PSP_URL).", code: 501 };
  }
  const body = JSON.stringify({ orderId, amount: value, currency, method, token, at: Date.now() });
  const ts = String(Date.now());
  const sig = crypto.createHmac("sha256", env("WALLET_PSP_SECRET")).update(`${ts}.${body}`).digest("hex");
  try {
    const r = await fetch(env("WALLET_PSP_URL"), { method: "POST", headers: { "content-type": "application/json", "x-sceneshop-timestamp": ts, "x-sceneshop-signature": sig }, body, signal: AbortSignal.timeout(20000) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) return { error: d.error || "O gateway recusou o pagamento.", code: 402 };
    const approved = String(d.status || "").toUpperCase() === "APPROVED";
    return { ok: approved, status: approved ? "APPROVED" : "DECLINED", simulated: false, card: { network: d.network || card.network, last4: d.last4 || card.last4 }, pspReference: String(d.reference || d.id || "").slice(0, 80) || null };
  } catch (e) {
    return { error: "Gateway de pagamento indisponível.", code: 502 };
  }
}

function domainAssociation() {
  const f = env("APPLE_PAY_DOMAIN_ASSOCIATION_FILE");
  try { return f ? fs.readFileSync(f, "utf8") : null; } catch (e) { return null; }
}

function routes() {
  const express = require("express");
  const r = express.Router();
  r.get("/api/wallets/config", (req, res) => res.json(publicConfig()));
  r.post("/api/wallets/apple/session", async (req, res) => {
    const out = await appleMerchantSession({ validationURL: (req.body || {}).validationURL, domain: req.hostname });
    out.error ? res.status(out.code || 400).json({ error: out.error }) : res.json(out.session);
  });
  r.get("/.well-known/apple-developer-merchantid-domain-association", (req, res) => {
    const txt = domainAssociation();
    txt ? res.type("text/plain").send(txt) : res.status(404).end();
  });
  return r;
}

module.exports = { publicConfig, googleConfig, appleConfig, charge, appleMerchantSession, routes, METHODS };
