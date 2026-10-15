/**
 * Regras de negócio configuráveis.
 * ATENÇÃO: percentuais e limites são VALORES DE EXEMPLO — os reais ainda serão definidos
 * (e os limites de AML precisam ser validados com o jurídico/compliance).
 */
const fs = require("fs");
const path = require("path");

// Automatically load .env and sceneshop.env from root into process.env if present
for (const envFileName of [".env", "sceneshop.env"]) {
  const envPath = path.resolve(__dirname, "..", envFileName);
  try {
    if (fs.existsSync(envPath)) {
      const c = fs.readFileSync(envPath, "utf8");
      for (const line of c.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eqIdx = trimmed.indexOf("=");
        if (eqIdx > 0) {
          const k = trimmed.slice(0, eqIdx).trim();
          const v = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, "");
          if (k && process.env[k] === undefined) {
            process.env[k] = v;
          }
        }
      }
    }
  } catch (_) {}
}

const IS_PRODUCTION = process.env.NODE_ENV === "production";
const envBool = (name, fallback) => {
  const v = process.env[name];
  if (v == null || v === "") return fallback;
  return !["0", "false", "no", "off"].includes(String(v).toLowerCase());
};

const DATA_BACKEND = String(process.env.DATA_BACKEND || (IS_PRODUCTION ? "postgres" : "file")).toLowerCase();

module.exports = {
  IS_PRODUCTION,
  // Local continua simples para demonstração, mas produção nunca liga DEMO por acidente.
  DEMO: envBool("DEMO", !IS_PRODUCTION),
  // Só confie em X-Forwarded-* quando o deploy estiver realmente atrás de proxy conhecido.
  TRUST_PROXY: envBool("TRUST_PROXY", false),

  // Data Plane v0.9: desenvolvimento continua podendo usar arquivo; produção usa PostgreSQL por padrão.
  DATA_BACKEND,
  DATABASE_URL: process.env.DATABASE_URL || "",
  REDIS_URL: process.env.REDIS_URL || "",
  SESSION_BACKEND: String(process.env.SESSION_BACKEND || "memory").toLowerCase(),
  // v0.17 alpha.2: cache/coordenação compartilhados usam Redis em produção.
  CACHE_BACKEND: String(process.env.CACHE_BACKEND || (IS_PRODUCTION ? "redis" : "memory")).toLowerCase(),
  CACHE_PREFIX: process.env.CACHE_PREFIX || "sceneshop",

  // Comissão que cada loja paga ao SceneShop sobre o valor da venda (simulado)
  STORE_COMMISSION: { amazon: 0.06, mercadolivre: 0.07, magalu: 0.05 },

  // Como a comissão recebida é dividida
  SPLIT: {
    official: { owner: 0.5, sceneshop: 0.5 },  // owner = produtora
    community: { owner: 0.4, sceneshop: 0.6 }, // owner = autor do inventário
  },

  // Custódia: dias antes de liberar o valor (cobre devoluções e denúncias)
  HOLD_DAYS: 30,
  MIN_PAYOUT: 50,

  // Atribuição: a venda só conta se houver clique rastreado nesta janela
  ATTRIBUTION_HOURS: 24,
  // Cliques repetidos do mesmo aparelho no mesmo produto, dentro deste prazo, contam uma vez
  CLICK_DEDUPE_MINUTES: 10,

  // Denúncias (ponderadas pela reputação de quem denuncia) que colocam a trilha em revisão
  REPORT_THRESHOLD: 3,

  // Limites de requisição por IP (janela de 1 minuto)
  RATE: { login: 10, signup: 5, vote: 20, report: 10, click: 60, webhook: 120, verify: 120 },

  // Monitoramento AML (regras de alerta)
  AML: {
    SELF_PURCHASE_MIN: 3,      // vendas vindas do mesmo aparelho...
    SELF_PURCHASE_RATIO: 0.5,  // ...representando esta fração das vendas do autor em 30 dias
    SPIKE_MIN: 5,              // vendas em 7 dias...
    SPIKE_FACTOR: 5,           // ...acima de N vezes a média semanal das 4 semanas anteriores
    HIGH_VALUE_SHARE: 500,     // comissão única acima deste valor (R$)
    MONTHLY_LIMIT: 5000,       // soma de comissões em 30 dias acima deste valor (R$)
  },

  TOKEN_TTL_DAYS: 7,

  // Oferta oficial (vendedor indicado pela produção)
  OFFER_TTL_HOURS: 48,            // validade do código de oferta no link de compra (e da atribuição)
  DEFAULT_OFFICIAL_COMMISSION: 0.10, // comissão paga pelo vendedor oficial ao SceneShop, se a produtora não definir
  PARTNER_SHARE: 0.2,             // parte da comissão para o canal parceiro onde o espectador assistiu
  WEBHOOK_TOLERANCE_MIN: 10,      // diferença máxima de horário aceita na assinatura do vendedor
  REPORT_MAX_DAYS: 45,            // relatório de vendas aceita pedidos de até N dias atrás
  CODE_POOL_LOW: 10,              // avisa a produtora quando restarem menos cupons que isto
};
