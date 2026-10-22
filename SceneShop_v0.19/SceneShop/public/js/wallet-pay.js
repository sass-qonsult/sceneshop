/**
 * Carteiras digitais no navegador e no app (rcprep.16) — Google Pay, Apple Pay e Samsung Pay pelo padrão
 * Payment Request. O cartão nunca passa pelo SceneShop: a carteira devolve um token criptografado para o
 * gateway de pagamento, e a página só repassa esse token ao servidor.
 *
 * Android (APK): o WebView precisa do Payment Request ligado (MainActivity, androidx.webkit 1.14+, WebView 137+).
 * iOS (app): Apple Pay funciona no WKWebView porque o app não injeta scripts na página.
 *
 *   const w = await SceneShopWallet.available();          // [{ method: "GOOGLE_PAY", label: "Google Pay" }, …]
 *   const r = await SceneShopWallet.pay("GOOGLE_PAY", { total: 129.9, label: "Pedido MP123" });
 *   // r = { method, token, card: { network, last4 } }  → POST para o servidor
 */
(function (root) {
  "use strict";
  let cfgPromise = null;
  const config = () => (cfgPromise = cfgPromise || fetch("/api/wallets/config").then((r) => (r.ok ? r.json() : {})).catch(() => ({})));

  function googleMethod(g) {
    return {
      supportedMethods: "https://google.com/pay",
      data: {
        environment: g.environment, apiVersion: 2, apiVersionMinor: 0,
        merchantInfo: { merchantName: g.merchantName, ...(g.merchantId ? { merchantId: g.merchantId } : {}) },
        allowedPaymentMethods: [{
          type: "CARD",
          parameters: { allowedAuthMethods: ["PAN_ONLY", "CRYPTOGRAM_3DS"], allowedCardNetworks: g.networks },
          tokenizationSpecification: { type: "PAYMENT_GATEWAY", parameters: { gateway: g.gateway, gatewayMerchantId: g.gatewayMerchantId } },
        }],
      },
    };
  }
  function appleMethod(a) {
    return { supportedMethods: "https://apple.com/apple-pay", data: { version: 3, merchantIdentifier: a.merchantIdentifier, merchantCapabilities: ["supports3DS"], supportedNetworks: a.networks, countryCode: a.countryCode || "BR" } };
  }
  const details = (total, label) => ({ total: { label: label || "SceneShop", amount: { currency: "BRL", value: Number(total).toFixed(2) } } });

  async function methodsFor(kind) {
    const c = await config();
    if (kind === "GOOGLE_PAY" && c.googlePay) return [googleMethod(c.googlePay)];
    if (kind === "APPLE_PAY" && c.applePay) return [appleMethod(c.applePay)];
    return null;
  }

  async function canUse(kind) {
    if (typeof root.PaymentRequest !== "function") return false;
    const methods = await methodsFor(kind);
    if (!methods) return false;
    try { const pr = new root.PaymentRequest(methods, details(1, "SceneShop")); return Boolean(await pr.canMakePayment()); } catch (e) { return false; }
  }

  async function available() {
    const out = [];
    if (await canUse("GOOGLE_PAY")) out.push({ method: "GOOGLE_PAY", label: "Google Pay" });
    if (await canUse("APPLE_PAY")) out.push({ method: "APPLE_PAY", label: "Apple Pay" });
    return out;
  }

  async function pay(kind, { total, label } = {}) {
    const methods = await methodsFor(kind);
    if (!methods || typeof root.PaymentRequest !== "function") throw new Error("Carteira indisponível neste aparelho.");
    const pr = new root.PaymentRequest(methods, details(total, label));
    if (kind === "APPLE_PAY") {
      pr.onmerchantvalidation = (ev) => {
        ev.complete(fetch("/api/wallets/apple/session", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ validationURL: ev.validationURL }) }).then((r) => r.json()));
      };
    }
    const resp = await pr.show();
    try {
      const d = resp.details || {};
      let token = null, card = {};
      if (kind === "GOOGLE_PAY") {
        const pm = d.paymentMethodData || {};
        token = pm.tokenizationData && pm.tokenizationData.token;
        card = { network: pm.info && pm.info.cardNetwork, last4: pm.info && pm.info.cardDetails };
      } else {
        token = d.token && d.token.paymentData ? JSON.stringify(d.token.paymentData) : null;
        card = { network: d.token && d.token.paymentMethod && d.token.paymentMethod.network, last4: null };
      }
      if (!token) throw new Error("A carteira não devolveu o pagamento.");
      return { method: kind, token: typeof token === "string" ? token : JSON.stringify(token), card, complete: (ok) => resp.complete(ok ? "success" : "fail") };
    } catch (e) { await resp.complete("fail"); throw e; }
  }

  root.SceneShopWallet = { config, available, canUse, pay };
})(typeof window !== "undefined" ? window : globalThis);
