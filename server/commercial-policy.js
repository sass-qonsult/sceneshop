/**
 * Termos comerciais versionados.
 *
 * Percentuais são editáveis para transações futuras. Uma alteração nunca
 * reescreve vendas já confirmadas: financialsForSale() congela policyId,
 * policyVersion e todas as taxas aplicadas no instante da venda.
 */
const crypto = require("crypto");
const store = require("./store");
const config = require("./config");

const S = () => store.state;
const clampRate = (name, value, fallback) => {
  const n = value == null || value === "" ? Number(fallback) : Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 1) throw new Error(`${name} deve ficar entre 0% e 100%.`);
  return n;
};

function baseTerms() {
  return {
    defaultCommissionRate: Number(config.DEFAULT_OFFICIAL_COMMISSION),
    partnerShareRate: Number(config.PARTNER_SHARE),
    splits: {
      official: { owner: Number(config.SPLIT.official.owner), sceneshop: Number(config.SPLIT.official.sceneshop) },
      community: { owner: Number(config.SPLIT.community.owner), sceneshop: Number(config.SPLIT.community.sceneshop) },
    },
    storeCommission: { ...config.STORE_COMMISSION },
  };
}

function normalizeTerms(input = {}, previous = baseTerms()) {
  const prev = previous || baseTerms();
  const officialOwner = clampRate("split oficial do produtor", input.splits?.official?.owner, prev.splits.official.owner);
  const communityOwner = clampRate("split da comunidade", input.splits?.community?.owner, prev.splits.community.owner);
  const terms = {
    defaultCommissionRate: clampRate("comissão padrão", input.defaultCommissionRate, prev.defaultCommissionRate),
    partnerShareRate: clampRate("participação do parceiro", input.partnerShareRate, prev.partnerShareRate),
    splits: {
      official: { owner: officialOwner, sceneshop: 1 - officialOwner },
      community: { owner: communityOwner, sceneshop: 1 - communityOwner },
    },
    storeCommission: { ...prev.storeCommission },
  };
  if (input.storeCommission && typeof input.storeCommission === "object") {
    for (const [k, v] of Object.entries(input.storeCommission)) {
      terms.storeCommission[k] = clampRate(`comissão ${k}`, v, prev.storeCommission[k] ?? terms.defaultCommissionRate);
    }
  }
  return terms;
}

function policies() {
  if (!Array.isArray(S().commercialPolicies)) S().commercialPolicies = [];
  return S().commercialPolicies;
}

function current(at = store.now()) {
  const list = policies()
    .filter((p) => p.status === "active" && Number(p.effectiveFrom || 0) <= at && (!p.effectiveTo || Number(p.effectiveTo) > at))
    .sort((a, b) => Number(b.version || 0) - Number(a.version || 0));
  return list[0] || null;
}

function ensureDefault() {
  if (policies().length) return current() || policies().slice().sort((a, b) => b.version - a.version)[0];
  const p = {
    id: "cp-" + crypto.randomBytes(6).toString("hex"),
    version: 1,
    status: "active",
    effectiveFrom: 0,
    effectiveTo: null,
    createdAt: Date.now(),
    createdBy: "system",
    reason: "baseline",
    terms: baseTerms(),
  };
  policies().push(p);
  return p;
}

function resolve({ sale = {}, trackType = "community", at } = {}) {
  const p = current(at == null ? sale.at : at) || ensureDefault();
  const terms = normalizeTerms({}, p.terms || baseTerms());
  const seller = sale.sellerId && S().sellers ? S().sellers[sale.sellerId] : null;
  const agreementTerms = seller?.agreement?.commercialTerms || {};

  // Prioridade: oferta/venda explícita > contrato do seller > política vigente > fallback da loja.
  const commissionRate = clampRate(
    "comissão",
    sale.commissionRate,
    agreementTerms.commissionRate ?? terms.storeCommission[sale.store] ?? terms.defaultCommissionRate
  );
  const partnerShareRate = sale.partnerId
    ? clampRate("participação do parceiro", agreementTerms.partnerShareRate, terms.partnerShareRate)
    : 0;
  const ownerFallback = (terms.splits[trackType] || terms.splits.community).owner;
  const splitOwnerRate = clampRate("participação do proprietário", agreementTerms.splitOwnerRate, ownerFallback);
  return {
    policyId: p.id,
    policyVersion: Number(p.version || 1),
    commissionRate,
    partnerShareRate,
    splitOwnerRate,
  };
}

function createVersion(input = {}, actor = "system") {
  const now = store.now();
  const active = current(now) || ensureDefault();
  const nextVersion = Math.max(0, ...policies().map((p) => Number(p.version || 0))) + 1;
  const effectiveFrom = input.effectiveFrom == null ? now : Number(input.effectiveFrom);
  if (!Number.isFinite(effectiveFrom) || effectiveFrom < now - 60_000) {
    return { error: "A nova política deve vigorar agora ou no futuro." };
  }
  let terms;
  try { terms = normalizeTerms(input.terms || input, active.terms || baseTerms()); }
  catch (err) { return { error: err.message }; }

  // Se entra em vigor imediatamente, encerra a vigente. Política futura não altera a atual até a data chegar.
  if (effectiveFrom <= now + 1000) {
    policies().forEach((p) => {
      if (p.status === "active" && (!p.effectiveTo || p.effectiveTo > effectiveFrom) && p.effectiveFrom <= effectiveFrom) {
        p.effectiveTo = effectiveFrom;
        p.status = "superseded";
      }
    });
  }
  const p = {
    id: "cp-" + crypto.randomBytes(6).toString("hex"),
    version: nextVersion,
    status: "active",
    effectiveFrom,
    effectiveTo: null,
    createdAt: now,
    createdBy: actor,
    reason: String(input.reason || "commercial terms update").slice(0, 240),
    terms,
  };
  policies().push(p);
  store.save();
  return { policy: p };
}

function history() {
  return policies().slice().sort((a, b) => Number(b.version || 0) - Number(a.version || 0));
}

module.exports = { baseTerms, normalizeTerms, current, ensureDefault, resolve, createVersion, history };
