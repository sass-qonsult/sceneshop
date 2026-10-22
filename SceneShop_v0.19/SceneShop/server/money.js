/**
 * Atribuição e repasse de comissões.
 *
 *  clique rastreado  ->  venda confirmada pela loja (até 24 h depois)  ->  30 dias em custódia
 *  ->  liberado (se KYC aprovado e sem alerta de AML grave)  ->  saque
 *
 * Situação de cada comissão:
 *   custodia       dentro dos 30 dias (pode ser estornada por devolução ou fraude)
 *   congelado      trilha em revisão por excesso de denúncias
 *   aguardando_kyc prazo cumprido, mas o autor ainda não passou pelo onboarding
 *   liberado       disponível para saque
 *   pago           já transferido
 *   estornado      devolução na loja ou trilha condenada por fraude
 *
 * Venda sem clique válido na janela de atribuição fica com o SceneShop (sem autor).
 */
const store = require("./store");
const tracks = require("./tracks");
const catalog = require("./catalog");
const audit = require("./audit");
const aml = require("./aml");
const antifraud = require("./antifraud");
const { STORE_COMMISSION, HOLD_DAYS, MIN_PAYOUT, ATTRIBUTION_HOURS, OFFER_TTL_HOURS } = require("./config");
const commercialPolicy = require("./commercial-policy");
const { identity } = require("./repositories");

const S = () => store.state;
const round = (v) => Math.round(v * 100) / 100;
const isPromise = (v) => !!v && typeof v.then === "function";

/**
 * Monta a venda sem produzir efeitos colaterais.  A separação é usada pelo
 * fluxo PostgreSQL transacional: primeiro congelamos a economia da venda,
 * depois persistimos pedido + venda + comissão + auditoria de uma vez.
 */
function buildSale({ clickId, value, storeId, at, official }) {
  at = at || store.now();
  const click = S().clicks.find((c) => c.id === clickId);
  // oferta oficial: a atribuição vale enquanto o código de oferta for válido
  const windowH = official ? OFFER_TTL_HOURS : ATTRIBUTION_HOURS;
  const valid = click && !click.anonymous && at - click.at >= 0 && at - click.at <= windowH * 3600e3;
  const sale = {
    id: "v" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
    trackId: valid ? click.trackId : null, authorId: valid ? click.authorId : null,
    productId: click ? click.productId : null, store: storeId || (click && click.store),
    value: round(value), at, reversed: false, clickId: click ? click.id : null,
    attribution: valid ? "clique" : "sem_atribuicao",
    partnerId: (official && official.partnerId) || (click && click.partnerId) || null,
  };
  if (official) Object.assign(sale, {
    official: true, sellerId: official.sellerId, commissionRate: official.commission,
    offerId: official.offerId, orderId: official.orderId,
  });
  sale.financials = financialsForSale(sale);
  return sale;
}

/**
 * Congela a divisão econômica no instante da venda. Alterações posteriores em
 * A política comercial vigente não reescreve o passado: taxas e policy/version são congeladas na venda.
 */
function financialsForSale(sale) {
  const t = tracks.get(sale.trackId);
  const type = t ? t.type : "community";
  const policy = commercialPolicy.resolve({ sale, trackType: type, at: sale.at });
  const { commissionRate, splitOwnerRate, partnerShareRate } = policy;
  const commission = round(Number(sale.value || 0) * commissionRate);
  const partnerPart = sale.partnerId ? round(commission * partnerShareRate) : 0;
  const ownerShare = round((commission - partnerPart) * splitOwnerRate);
  const sceneshopShare = round(commission - partnerPart - ownerShare);
  return {
    currency: "BRL",
    policyId: policy.policyId,
    policyVersion: policy.policyVersion,
    clientOrganizationId: policy.clientOrganizationId || null,
    clientContractVersion: policy.clientContractVersion || null,
    commissionRate,
    splitOwnerRate,
    partnerShareRate,
    commission,
    partnerPart,
    ownerShare,
    sceneshopShare,
    releaseAt: sale.at + HOLD_DAYS * store.DAY,
    frozenAt: sale.at,
  };
}

/**
 * Registra uma venda informada pela loja no caminho legado síncrono.  O fluxo
 * oficial PostgreSQL usa buildSale() e faz o commit atômico antes de publicar
 * a alteração no estado em memória.
 */
function registerSale(args) {
  const sale = buildSale(args);
  S().sales.push(sale);
  store.save();
  if (sale.authorId) aml.evaluate(sale.authorId);
  return sale;
}

// Demonstração: gera clique(s) e venda(s) como se um espectador tivesse comprado
async function simulateSale({ authorId, selfPurchase }) {
  const own = Object.values(S().tracks).filter((t) => t.authorId === authorId && t.status !== "removida");
  if (!own.length) return { error: "Você ainda não tem trilha publicada." };
  const stores = Object.keys(STORE_COMMISSION);
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  const n = selfPurchase ? 3 : 1;
  const device = selfPurchase ? `dev-self-${authorId}` : null; // autocompra: sempre o mesmo aparelho
  const out = [];
  for (let i = 0; i < n; i++) {
    const t = pick(own);
    const items = t.scenes.flatMap((s) => s.products.map((p) => p.id));
    if (!items.length) return { error: "Sua trilha ainda não tem produtos." };
    const productId = selfPurchase ? items[i % items.length] : pick(items);
    const { click } = antifraud.registerClick({
      trackId: t.id, productId, storeId: pick(stores),
      deviceId: device || "viewer-" + Math.random().toString(36).slice(2, 12),
    });
    const sale = registerSale({ clickId: click.id, value: catalog.getProduct(productId).referencePrice, storeId: click.store });
    out.push(entry(sale));
  }
  return { sales: out, sale: out[0] };
}

function entry(sale, authorOverride = null) {
  const t = tracks.get(sale.trackId);
  const author = authorOverride || S().authors[sale.authorId] || {};
  const frozen = sale.financials || financialsForSale(sale);
  const commission = frozen.commission;
  const partnerPart = frozen.partnerPart;
  const share = frozen.ownerShare;
  const releaseAt = frozen.releaseAt;
  const now = store.now();
  let status;
  if (sale.reversed || (t && t.status === "removida")) status = "estornado";
  else if (sale.paidAt) status = "pago";
  else if (t && t.status === "em_revisao") status = "congelado";
  else if (now < releaseAt) status = "custodia";
  else if (author.kyc !== "aprovado") status = "aguardando_kyc";
  else status = "liberado";
  const p = catalog.getProduct(sale.productId);
  return {
    id: sale.id, at: sale.at, releaseAt, daysLeft: Math.max(0, Math.ceil((releaseAt - now) / store.DAY)),
    track: t ? { id: t.id, title: t.title, type: t.type } : null,
    product: p ? p.name : sale.productId, store: sale.store,
    storeName: sale.official && S().sellers[sale.sellerId] ? S().sellers[sale.sellerId].name : sale.store,
    official: !!sale.official, partnerId: sale.partnerId || null,
    value: sale.value, commission, partnerPart, share, sceneshop: frozen.sceneshopShare, status,
  };
}

function ledgerWithAuthor(authorId, author) {
  if (!author) return null;
  const entries = S().sales.filter((s) => s.authorId === authorId).map((sale) => entry(sale, author)).sort((a, b) => b.at - a.at);
  const totals = { custodia: 0, congelado: 0, aguardando_kyc: 0, liberado: 0, pago: 0, estornado: 0 };
  entries.forEach((e) => (totals[e.status] = round(totals[e.status] + e.share)));
  const blocked = aml.blocksPayout(authorId);
  const { kycData, kycDocHash, ...safeAuthor } = author;
  return {
    author: safeAuthor, entries, totals,
    tracks: Object.values(S().tracks).filter((t) => t.authorId === authorId).map(tracks.summary),
    clicks: S().clicks.filter((c) => c.authorId === authorId && !c.anonymous).length,
    // Não revelamos o motivo ao autor (evita alertar quem está sob análise de AML)
    payoutHold: blocked ? "Saques temporariamente indisponíveis: verificação de conformidade em andamento." : null,
    canWithdraw: author.kyc === "aprovado" && !blocked && totals.liberado >= MIN_PAYOUT,
    rules: { HOLD_DAYS, MIN_PAYOUT, ATTRIBUTION_HOURS, OFFER_TTL_HOURS, commercialPolicy: commercialPolicy.current() || commercialPolicy.ensureDefault() },
    now: store.now(),
  };
}

function ledger(authorId) {
  const found = identity.findAuthorAuthoritative(authorId);
  const finish = (author) => ledgerWithAuthor(authorId, author);
  return isPromise(found) ? found.then(finish) : finish(found);
}

function withdraw(authorId, actor) {
  const found = ledger(authorId);
  const finish = (l) => {
    if (!l) return { error: "Autor inválido." };
    if (l.author.kyc !== "aprovado") return { error: "Conclua a verificação de identidade (KYC) para sacar." };
    if (l.payoutHold) return { error: l.payoutHold };
    if (l.totals.liberado < MIN_PAYOUT) return { error: `Saque mínimo de R$ ${MIN_PAYOUT}.` };
    const ids = new Set(l.entries.filter((e) => e.status === "liberado").map((e) => e.id));
    S().sales.forEach((s) => ids.has(s.id) && (s.paidAt = store.now()));
    audit.log(actor, "saque", { authorId, valor: l.totals.liberado, comissoes: ids.size });
    store.save();
    aml.evaluate(authorId);
    return { paid: l.totals.liberado };
  };
  return isPromise(found) ? found.then(finish) : finish(found);
}

// CPF: dígitos verificadores
function validCpf(d) {
  if (!/^\d{11}$/.test(d) || /^(\d)\1+$/.test(d)) return false;
  const calc = (n) => { let s = 0; for (let i = 0; i < n; i++) s += +d[i] * (n + 1 - i); const r = (s * 10) % 11; return r === 10 ? 0 : r; };
  return calc(9) === +d[9] && calc(10) === +d[10];
}
// CNPJ: dígitos verificadores
function validCnpj(d) {
  if (!/^\d{14}$/.test(d) || /^(\d)\1+$/.test(d)) return false;
  const calc = (n) => { const w = n === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]; let s = 0; for (let i = 0; i < n; i++) s += +d[i] * w[i]; const r = s % 11; return r < 2 ? 0 : 11 - r; };
  return calc(12) === +d[12] && calc(13) === +d[13];
}

function age(birth) {
  const b = new Date(birth);
  if (isNaN(b)) return -1;
  const n = new Date(store.now());
  return n.getFullYear() - b.getFullYear() - (n < new Date(n.getFullYear(), b.getMonth(), b.getDate()) ? 1 : 0);
}

// Onboarding (KYC). No MVP valida formato e dígitos; na fase 2 o parceiro de pagamentos
// confere identidade (documento + selfie), listas restritivas e titularidade da conta.
function submitKyc(authorId, { name, document, birth, bank, pep }, actor) {
  const a = S().authors[authorId];
  if (!a) return { error: "Autor inválido." };
  const digits = String(document || "").replace(/\D/g, "");
  const errors = [];
  if (!name || name.trim().split(/\s+/).length < 2) errors.push("Informe o nome completo.");
  if (digits.length === 11) {
    if (!validCpf(digits)) errors.push("CPF inválido.");
    if (age(birth) < 18) errors.push("É preciso ter 18 anos ou mais (ou cadastrar uma empresa).");
  } else if (digits.length === 14) {
    if (!validCnpj(digits)) errors.push("CNPJ inválido.");
  } else errors.push("Informe um CPF (11 dígitos) ou CNPJ (14 dígitos).");
  if (!bank || String(bank).trim().length < 5) errors.push("Informe a chave Pix ou conta, no mesmo titular.");
  // um documento só pode estar ligado a uma conta. A checagem local melhora
  // UX; no PostgreSQL a constraint UNIQUE(document_hash) é a barreira final.
  const documentHash = hashDoc(digits);
  const used = Object.values(S().authors).find((x) => x.id !== authorId && x.kycDocHash === documentHash);
  if (used) errors.push("Esse documento já está vinculado a outra conta.");
  if (errors.length) return { errors };
  const submittedAt = store.now();
  const subjectType = digits.length === 11 ? "PF" : "PJ";
  const documentMasked = subjectType === "PF"
    ? `***.${digits.slice(3, 6)}.${digits.slice(6, 9)}-**`
    : digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
  const submitted = identity.submitAuthorKycAuthoritative({
    authorId, documentHash, documentMasked, legalName: name.trim(), subjectType, pep: !!pep, submittedAt, actor,
  });
  const finish = (author) => {
    if (!author) return { error: "Autor inválido." };
    if (store.backendKind() !== "postgres") {
      audit.log(actor, "kyc_enviado", { authorId, tipo: subjectType, pep: !!pep });
      store.save();
    }
    aml.evaluate(authorId);
    return { author: { id: author.id, name: author.name, kyc: author.kyc, document: author.document } };
  };
  const failed = (err) => {
    if (err && err.code === "KYC_DOCUMENT_EXISTS") return { errors: ["Esse documento já está vinculado a outra conta."] };
    throw err;
  };
  return isPromise(submitted) ? submitted.then(finish, failed) : finish(submitted);
}

const hashDoc = (d) => require("crypto").createHmac("sha256", store.state.secret).update(d).digest("hex");

function setKyc(authorId, status, actor) {
  const decided = identity.decideAuthorKycAuthoritative(authorId, status, { actor, at: store.now() });
  const finish = (author) => {
    if (!author) return null;
    if (store.backendKind() !== "postgres") {
      audit.log(actor, "kyc_decisao", { authorId, status });
      store.save();
    }
    return { id: author.id, kyc: author.kyc };
  };
  return isPromise(decided) ? decided.then(finish) : finish(decided);
}

module.exports = { buildSale, financialsForSale, registerSale, simulateSale, ledger, withdraw, submitKyc, setKyc, entry, validCpf, validCnpj };
