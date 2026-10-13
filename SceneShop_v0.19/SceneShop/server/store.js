/**
 * Fachada de estado compatível com os módulos v0.8.
 * A partir da v0.9 o I/O é delegado ao Data Plane (file/PostgreSQL) para permitir
 * migração incremental para repositories sem reescrever o produto de uma vez.
 */
const crypto = require("crypto");
const catalog = require("./catalog");
const config = require("./config");
const { createStateRepository } = require("./data");
const { hashPassword } = require("./passwords");

const VERSION = 18;

const DAY = 24 * 60 * 60 * 1000;
let state;

const roundMoney = (v) => Math.round(Number(v || 0) * 100) / 100;
function freezeSnapshotSale(sale, tracksById) {
  if (sale.financials) return sale.financials;
  const track = (tracksById || {})[sale.trackId];
  const type = track ? track.type : "community";
  const commissionRate = Number(sale.commissionRate ?? config.STORE_COMMISSION[sale.store] ?? config.DEFAULT_OFFICIAL_COMMISSION);
  const splitOwnerRate = Number((config.SPLIT[type] || config.SPLIT.community).owner);
  const partnerShareRate = sale.partnerId ? Number(config.PARTNER_SHARE) : 0;
  const policy = { policyId: "cp-baseline", policyVersion: 1 };
  const commission = roundMoney(Number(sale.value || 0) * commissionRate);
  const partnerPart = sale.partnerId ? roundMoney(commission * partnerShareRate) : 0;
  const ownerShare = roundMoney((commission - partnerPart) * splitOwnerRate);
  sale.financials = {
    currency: "BRL", policyId: policy.policyId, policyVersion: policy.policyVersion, commissionRate, splitOwnerRate, partnerShareRate, commission, partnerPart, ownerShare,
    sceneshopShare: roundMoney(commission - partnerPart - ownerShare),
    releaseAt: Number(sale.at || 0) + config.HOLD_DAYS * DAY, frozenAt: Number(sale.at || 0),
  };
  return sale.financials;
}

// Relógio com deslocamento, para a demo poder "avançar 30 dias"
function now() {
  return Date.now() + (state ? state.clockOffsetDays : 0) * DAY;
}

function seed() {
  return config.DEMO ? demoSeed() : productionSeed();
}

// Base de produção: só configuração (chaves, política comercial); nenhum dado de exemplo.
// test/v019-analysis-regressions.test.js garante a mesma estrutura de demoSeed().
function productionSeed() {
  const t0 = Date.now();
  const k = crypto.generateKeyPairSync("ed25519");
  const empty = {};
  for (const key of PRODUCTION_ARRAYS) empty[key] = [];
  for (const key of PRODUCTION_MAPS) empty[key] = {};
  return {
    ...empty,
    version: VERSION,
    secret: crypto.randomBytes(32).toString("hex"),
    clockOffsetDays: 0,
    commercialPolicies: baselineCommercialPolicies(t0),
    offerKeys: { private: k.privateKey.export({ type: "pkcs8", format: "pem" }), public: k.publicKey.export({ type: "spki", format: "pem" }) },
  };
}
const PRODUCTION_ARRAYS = ["distributionEvents", "events", "mktOrders", "orders", "reports", "clicks", "sales", "alerts", "audit"];
const PRODUCTION_MAPS = ["commerceSponsors", "commerceCampaigns", "commerceConnections", "commerceOffers", "commerceRoutingPolicies", "commerceResolutions", "commerceActivations",
  "aiCommercialAssets", "aiAssetReferences", "aiAnalysisJobs", "aiJobAssets", "aiDetectionCandidates", "aiRedundantVerifications", "aiOperatorFlags", "aiPlacements",
  "distributionBindings", "distributionSdkKeys", "syncFingerprints", "syncIndexBuilds", "timelinePolicies", "platformConnections",
  "authors", "accounts", "organizations", "organizationMembers", "organizationInvites", "privacyPreferences", "privacyRequests", "retentionPolicies",
  "tracks", "partners", "workPartners", "sellers", "codePools", "userWorks", "issuedOffers", "officialOffers", "deviceVotes", "deviceRep", "userProducts"];

function baselineCommercialPolicies(t0) {
  return [{
    id: "cp-baseline", version: 1, status: "active", effectiveFrom: 0, effectiveTo: null,
    createdAt: t0 - 90 * DAY, createdBy: "system", reason: "baseline",
    terms: {
      defaultCommissionRate: Number(config.DEFAULT_OFFICIAL_COMMISSION),
      partnerShareRate: Number(config.PARTNER_SHARE),
      splits: JSON.parse(JSON.stringify(config.SPLIT)),
      storeCommission: { ...config.STORE_COMMISSION },
    },
  }];
}

function demoSeed() {
  const work = catalog.getWork("demo-01");
  const t0 = Date.now();
  const item = (id, match = "exato") => ({ id, match, box: catalog.getProduct(id).box });

  const official = {
    id: "t-oficial-demo01", workId: work.id, type: "official", authorId: "produtora-demo", organizationId: "org-demo-produtora",
    title: "Trilha oficial", offset: 0, status: "ativa", votesBase: { up: 212, down: 4 }, createdAt: t0 - 60 * DAY,
    scenes: work.scenes.map((s) => ({ id: s.id, title: s.title, start: s.start, end: s.end, products: s.products.map((p) => item(p)) })),
  };

  const ana = {
    id: "t-ana-demo01", workId: work.id, type: "community", authorId: "ana", organizationId: "org-demo-ana",
    title: "Inventário completo", offset: 0, status: "ativa", votesBase: { up: 131, down: 9 }, createdAt: t0 - 45 * DAY,
    scenes: [
      { id: "c1", title: "Rua ao entardecer", start: 0, end: 12, products: [item("jaqueta-couro"), item("oculos-aviador"), item("tenis-branco", "parecido")] },
      { id: "c2", title: "Cozinha", start: 12, end: 24, products: [item("cafeteira-espresso"), item("caneca-ceramica")] },
      { id: "c3", title: "Sala de estar", start: 24, end: 36, products: [item("sofa-3-lugares"), item("luminaria-piso"), item("caixa-som-bt")] },
      { id: "c4", title: "Parque", start: 36, end: 48, products: [item("smartwatch"), item("fone-sem-fio"), item("garrafa-termica")] },
      { id: "c5", title: "Jantar", start: 48, end: 60, products: [item("vestido-vermelho", "parecido"), item("relogio-classico")] },
    ],
  };

  // Exemplo de fraude: produtos que não aparecem na cena, repetidos em todas elas
  const spam = {
    id: "t-promo-demo01", workId: work.id, type: "community", authorId: "promo_x", organizationId: "org-demo-promo",
    title: "Tudo da novela!!!", offset: 0, status: "em_revisao", votesBase: { up: 3, down: 22 }, createdAt: t0 - 12 * DAY,
    scenes: work.scenes.map((s, i) => ({
      id: "p" + (i + 1), title: s.title, start: s.start, end: s.end,
      products: [item(s.products[0]), item("perfume"), item("smartwatch"), item("notebook-14")],
    })),
  };

  const authors = {
    "produtora-demo": { id: "produtora-demo", name: "Produtora Demo", type: "producer", partnerId: "aurora", managedBy: "Equipe SceneShop", kyc: "aprovado", document: "12.345.678/0001-90" },
    ana: { id: "ana", name: "Ana Legendas", type: "community", kyc: "aprovado", document: "***.456.789-**" },
    promo_x: { id: "promo_x", name: "promo_x", type: "community", kyc: "pendente", document: null },
  };

  const reports = ["t-promo-demo01", "t-promo-demo01", "t-promo-demo01", "t-promo-demo01"].map((trackId, i) => ({
    id: "r" + i, trackId, sceneId: "p" + (i + 1), productId: "perfume", reason: "Produto não aparece na cena", at: t0 - (5 - i) * DAY,
    deviceId: "seed-dev-" + i, weight: 1,
  }));

  // Vendas antigas (cada uma com o clique que a originou) para o painel já ter conteúdo
  const seedTracks = { [official.id]: official, [ana.id]: ana, [spam.id]: spam };
  const sales = [], clicks = [];
  const sale = (trackId, authorId, productId, store, value, daysAgo, deviceId) => {
    const at = t0 - daysAgo * DAY;
    const click = { id: "k" + clicks.length, trackId, authorId, productId, store, deviceId: deviceId || "seed-viewer-" + clicks.length, session: null, at: at - 3600e3 };
    clicks.push(click);
    const seededSale = { id: "v" + sales.length, trackId, authorId, productId, store, value, at, reversed: false, clickId: click.id };
    freezeSnapshotSale(seededSale, seedTracks);
    sales.push(seededSale);
  };
  sale("t-ana-demo01", "ana", "jaqueta-couro", "mercadolivre", 495.55, 41);
  sale("t-ana-demo01", "ana", "sofa-3-lugares", "amazon", 3150.0, 35);
  sale("t-ana-demo01", "ana", "fone-sem-fio", "magalu", 879.0, 12);
  sale("t-ana-demo01", "ana", "cafeteira-espresso", "amazon", 1799.0, 3);
  sale("t-oficial-demo01", "produtora-demo", "vestido-vermelho", "mercadolivre", 689.0, 33);
  sale("t-oficial-demo01", "produtora-demo", "notebook-14", "amazon", 4199.0, 8);
  // promo_x: várias "vendas" vindas do mesmo aparelho -> padrão de autocompra (alerta AML)
  sale("t-promo-demo01", "promo_x", "perfume", "amazon", 389.0, 6, "dev-promo-1");
  sale("t-promo-demo01", "promo_x", "smartwatch", "mercadolivre", 1150.0, 4, "dev-promo-1");
  sale("t-promo-demo01", "promo_x", "notebook-14", "amazon", 4199.0, 2, "dev-promo-1");

  function seller(id, name, cnpj, color, extra = {}) {
    return { id, name, cnpj, color, verified: true, kind: "marca", integration: "assinatura", storeUrl: `/loja/${id}`,
      secret: crypto.randomBytes(24).toString("hex"), normalMarkup: 1.15,
      agreement: { since: t0 - 60 * DAY, until: t0 + 300 * DAY, notes: "Loja da própria marca, indicada pela produção; plugin confere o código assinado." },
      ...extra };
  }

  const commercialPolicies = baselineCommercialPolicies(t0);

  // Contas de demonstração (senha de todas: demo1234)
  const acc = (username, role, authorId) => ({ username, pass: hashPassword("demo1234"), role, authorId, tokenVersion: 1, demo: true, createdAt: t0 - 90 * DAY });

  return {
    version: VERSION,
    secret: crypto.randomBytes(32).toString("hex"), // assina os tokens de login (use SESSION_SECRET em produção)
    clockOffsetDays: 0,
    commercialPolicies,
    commerceSponsors: {}, commerceCampaigns: {}, commerceConnections: {}, commerceOffers: {}, commerceRoutingPolicies: {}, commerceResolutions: {}, commerceActivations: {},
    aiCommercialAssets: {}, aiAssetReferences: {}, aiAnalysisJobs: {}, aiJobAssets: {}, aiDetectionCandidates: {}, aiRedundantVerifications: {}, aiOperatorFlags: {}, aiPlacements: {},
    distributionBindings: {}, distributionSdkKeys: {}, syncFingerprints: {}, syncIndexBuilds: {}, timelinePolicies: {}, distributionEvents: [], platformConnections: {},
    authors,
    accounts: {
      produtora: acc("produtora", "producer", "produtora-demo"),
      ana: acc("ana", "author", "ana"),
      promo_x: acc("promo_x", "author", "promo_x"),
      moderador: acc("moderador", "moderator", null),
    },
    organizations: {
      "org-demo-produtora": { id: "org-demo-produtora", slug: "produtora-demo", name: "Produtora Demo", kind: "PRODUCER", status: "ACTIVE", settings: {}, createdBy: "produtora", createdAt: t0 - 90 * DAY, updatedAt: t0 - 90 * DAY },
      "org-demo-ana": { id: "org-demo-ana", slug: "ana-legendas", name: "Ana Legendas · Workspace", kind: "OTHER", status: "ACTIVE", settings: {}, createdBy: "ana", createdAt: t0 - 90 * DAY, updatedAt: t0 - 90 * DAY },
      "org-demo-promo": { id: "org-demo-promo", slug: "promo-x", name: "promo_x · Workspace", kind: "OTHER", status: "ACTIVE", settings: {}, createdBy: "promo_x", createdAt: t0 - 90 * DAY, updatedAt: t0 - 90 * DAY },
    },
    organizationMembers: {
      "org-demo-produtora:produtora": { organizationId: "org-demo-produtora", username: "produtora", role: "OWNER", status: "ACTIVE", joinedAt: t0 - 90 * DAY, createdAt: t0 - 90 * DAY, updatedAt: t0 - 90 * DAY },
      "org-demo-ana:ana": { organizationId: "org-demo-ana", username: "ana", role: "OWNER", status: "ACTIVE", joinedAt: t0 - 90 * DAY, createdAt: t0 - 90 * DAY, updatedAt: t0 - 90 * DAY },
      "org-demo-promo:promo_x": { organizationId: "org-demo-promo", username: "promo_x", role: "OWNER", status: "ACTIVE", joinedAt: t0 - 90 * DAY, createdAt: t0 - 90 * DAY, updatedAt: t0 - 90 * DAY },
    },
    organizationInvites: {},
    privacyPreferences: {}, privacyRequests: {}, retentionPolicies: {},
    tracks: seedTracks,

    // Parceiros corporativos (emissoras, streamings, agências) que embutem o player nos próprios canais
    partners: {
      aurora: {
        id: "aurora", name: "Aurora Play", kind: "emissora", publicKey: "pk_aurora_demo",
        domains: ["localhost", "127.0.0.1"], brand: { color: "#ff5a36", label: "Aurora Play · Compras" },
      },
      prisma: {
        id: "prisma", name: "Agência Prisma", kind: "agência", publicKey: "pk_prisma_demo",
        domains: ["prisma.example"], brand: { color: "#00b3a4", label: "Prisma · Compre o look" },
      },
    },
    workPartners: { "demo-01": ["aurora", "prisma"] },

    // Lojas com acordo comercial com a produtora: lojas das marcas e grandes varejistas.
    // secret = chave com que a loja assina os avisos de pedido e relatórios
    sellers: {
      "urbano-oficial": seller("urbano-oficial", "Urbano&Co · Loja oficial", "12.345.678/0001-95", "#8a4b22"),
      "lar-design-oficial": seller("lar-design-oficial", "Lar Design · Loja oficial", "23.456.789/0001-10", "#2f6f7a"),
      "atelier-rosa-oficial": seller("atelier-rosa-oficial", "Atelier Rosa · Loja oficial", "34.567.890/0001-20", "#a61e4d"),
      // varejistas fictícios de grande porte (no mundo real: Amazon, Magalu, Mercado Livre etc., com acordo direto)
      megaloja: seller("megaloja", "MegaLoja", "45.678.901/0001-30", "#1e5bd8", {
        kind: "varejista", integration: "codigos_unicos",
        agreement: { since: t0 - 30 * DAY, until: t0 + 335 * DAY, notes: "Acordo direto com a produtora: lote de cupons de uso único com preço negociado; relatório diário de vendas." },
      }),
      "loja-piloto": seller("loja-piloto", "Marketplace Piloto", "00.000.000/0001-00", "#0B5FFF", {
        kind: "marketplace", storeUrl: "/marketplace/oferta",
        agreement: { since: t0, until: t0 + 365 * DAY, notes: "Marketplace de demonstração do piloto: vitrine, carrinho e checkout simulados; confere o código assinado." },
      }),
      shopcenter: seller("shopcenter", "ShopCenter", "56.789.012/0001-40", "#6b3fd4", {
        kind: "varejista", integration: "link_campanha", campaigns: { "sofa-3-lugares": "CMP-SOFA-2609", "caixa-som-bt": "CMP-SOM-2609" },
        agreement: { since: t0 - 20 * DAY, until: t0 + 160 * DAY, notes: "Acordo direto: campanha com preço negociado por produto; aviso de pedido na hora." },
      }),
    },
    // Cupons de uso único entregues pelos varejistas (lote)
    codePools: {
      megaloja: Array.from({ length: 25 }, (_, i) => ({ code: `MEGA-OCU-${String(1000 + i * 37).padStart(4, "0")}`, productId: "oculos-aviador", status: "livre" }))
        .concat(Array.from({ length: 12 }, (_, i) => ({ code: `MEGA-FON-${String(2000 + i * 53)}`, productId: "fone-sem-fio", status: "livre" }))),
    },
    userWorks: {},   // obras enviadas no estúdio (piloto)
    events: [],      // eventos de audiência (visualização, painel, QR) para o painel do piloto
    mktOrders: [],   // pedidos do Marketplace Piloto
    issuedOffers: {}, // ofertas emitidas (cupom/campanha apontam para elas na conciliação)
    // Ofertas oficiais por produto: vendedor, preço garantido e comissão definidos pela produtora
    officialOffers: {
      "jaqueta-couro": { sellerId: "urbano-oficial", price: 479.9, commission: 0.12, validUntil: t0 + 120 * DAY, setBy: "produtora" },
      "oculos-aviador": { sellerId: "megaloja", price: 269.0, commission: 0.07, validUntil: t0 + 120 * DAY, setBy: "produtora" },
      "fone-sem-fio": { sellerId: "megaloja", price: 849.0, commission: 0.06, validUntil: t0 + 120 * DAY, setBy: "produtora" },
      "sofa-3-lugares": { sellerId: "shopcenter", price: 3090.0, commission: 0.06, validUntil: t0 + 120 * DAY, setBy: "produtora" },
      "luminaria-piso": { sellerId: "lar-design-oficial", price: 439.0, commission: 0.1, validUntil: t0 + 120 * DAY, setBy: "produtora" },
      "vestido-vermelho": { sellerId: "atelier-rosa-oficial", price: 649.0, commission: 0.15, validUntil: t0 + 120 * DAY, setBy: "produtora" },
    },
    orders: [],        // pedidos confirmados pelos vendedores (idempotência por vendedor + pedido)
    // Chave Ed25519: o SceneShop assina as ofertas; vendedores conferem com a chave pública
    offerKeys: (() => {
      const k = crypto.generateKeyPairSync("ed25519");
      return { private: k.privateKey.export({ type: "pkcs8", format: "pem" }), public: k.publicKey.export({ type: "spki", format: "pem" }) };
    })(),
    deviceVotes: {},   // trackId -> { deviceId: 1 (útil) | 0 (não) }
    deviceRep: {},     // deviceId -> { ok, bad } denúncias confirmadas / rejeitadas
    reports,
    clicks,
    sales,
    alerts: [],
    audit: [],
    userProducts: {},
  };
}

function hydrateCatalog() {
  Object.values(state.userProducts || {}).forEach((p) => catalog.addProduct(p));
  Object.values(state.userWorks || {}).forEach((w) => catalog.addWork(w));
}

let repository = null;
let initialized = false;
let saveT = null;
let pendingSave = Promise.resolve();
let lastPersistError = null;
let domainQueue = Promise.resolve();

async function init({ stateRepository } = {}) {
  if (initialized) return state;
  if (process.env.SCENESHOP_MEMORY) {
    initialized = true;
    return state;
  }

  repository = stateRepository || createStateRepository({
    backend: config.DATA_BACKEND,
    databaseUrl: config.DATABASE_URL,
  });
  await repository.init();

  const loaded = await repository.load();
  if (loaded) {
    state = loaded;
    if (state.version < 5) throw new Error("Persistência SceneShop em formato incompatível (< v5).");
    migrate(state);
  } else {
    state = seed();
    await repository.save(state);
  }
  hydrateCatalog();
  initialized = true;
  return state;
}

function persistSnapshot(snapshot) {
  if (!repository) return Promise.resolve();
  pendingSave = pendingSave
    .catch(() => {})
    .then(() => repository.save(snapshot))
    .then(() => { lastPersistError = null; })
    .catch((err) => {
      lastPersistError = err;
      console.error("SceneShop persistence error:", err);
    });
  return pendingSave;
}

function save() {
  if (save.disabled || !repository) return;
  clearTimeout(saveT);
  saveT = setTimeout(() => {
    saveT = null;
    // Snapshot imutável no momento do flush: mudanças posteriores não alteram o payload em trânsito.
    const snapshot = JSON.parse(JSON.stringify(state));
    persistSnapshot(snapshot);
  }, 200);
}

async function flush() {
  if (save.disabled || !repository) return;
  if (saveT) {
    clearTimeout(saveT);
    saveT = null;
    await persistSnapshot(JSON.parse(JSON.stringify(state)));
  }
  await pendingSave;
  if (lastPersistError) throw lastPersistError;
}


// Copia `source` para dentro de `target` preservando a identidade dos objetos e arrays existentes.
function syncInto(target, source) {
  const isObj = (v) => v !== null && typeof v === "object";
  if (!isObj(target) || !isObj(source) || Array.isArray(target) !== Array.isArray(source)) return source;
  if (Array.isArray(source)) {
    for (let i = 0; i < source.length; i++) {
      if (i < target.length && isObj(target[i]) && isObj(source[i]) && Array.isArray(target[i]) === Array.isArray(source[i])) syncInto(target[i], source[i]);
      else target[i] = source[i];
    }
    target.length = source.length;
    return target;
  }
  for (const k of Object.keys(target)) if (!(k in source)) delete target[k];
  for (const [k, v] of Object.entries(source)) {
    const cur = target[k];
    if (isObj(cur) && isObj(v) && Array.isArray(cur) === Array.isArray(v)) syncInto(cur, v);
    else target[k] = v;
  }
  return target;
}

async function atomicDomain(prepare) {
  if (!repository || repository.kind !== "postgres" || typeof repository.commitDomainSnapshot !== "function") {
    throw new Error("Commit atômico de domínio exige DATA_BACKEND=postgres.");
  }
  const run = domainQueue
    .catch(() => {})
    .then(async () => {
      // Consolida qualquer escrita legada anterior antes de congelar a base da transação.
      await flush();
      const draft = JSON.parse(JSON.stringify(state));
      const prepared = await prepare(draft);
      if (!prepared || !prepared.snapshot) throw new Error("Preparação de domínio não retornou snapshot.");
      const committed = await repository.commitDomainSnapshot(prepared.snapshot, prepared);
      // Sincroniza em vez de substituir: módulos que guardaram referências (ex.: um pedido)
      // continuam apontando para o estado vivo; substituir o objeto perdia essas escritas.
      if (!(committed.writeResult && committed.writeResult.skipSnapshot)) state = syncInto(state, prepared.snapshot);
      return { ...committed, result: prepared.result };
    });
  domainQueue = run;
  return run;
}

async function readDomain(work) {
  if (!repository || repository.kind !== "postgres" || typeof repository.readDomain !== "function") {
    throw new Error("Leitura autoritativa de domínio exige DATA_BACKEND=postgres.");
  }
  return repository.readDomain(work);
}

async function writeDomain(work) {
  if (!repository || repository.kind !== "postgres" || typeof repository.writeDomain !== "function") {
    throw new Error("Escrita autoritativa de domínio exige DATA_BACKEND=postgres.");
  }
  return repository.writeDomain(work);
}

function backendKind() {
  if (process.env.SCENESHOP_MEMORY) return "memory";
  return repository ? repository.kind : config.DATA_BACKEND;
}

async function health() {
  if (process.env.SCENESHOP_MEMORY) return { ok: true, backend: "memory" };
  if (!repository) return { ok: false, backend: config.DATA_BACKEND, error: "store_not_initialized" };
  const h = await repository.health();
  return { ...h, initialized, stateVersion: state && state.version };
}

async function close() {
  await flush();
  if (repository) await repository.close();
}

function migrate(st) {
  const fresh = seed();
  // runtimes criados antes da flag `demo` também não podem reativar credenciais conhecidas em produção.
  ["produtora", "ana", "promo_x", "moderador"].forEach((u) => {
    if (st.accounts && st.accounts[u]) st.accounts[u].demo = true;
  });
  ["userWorks", "events", "mktOrders", "issuedOffers", "codePools", "orders", "alerts", "audit", "commercialPolicies", "organizations", "organizationMembers", "organizationInvites", "privacyPreferences", "privacyRequests", "retentionPolicies", "commerceSponsors", "commerceCampaigns", "commerceConnections", "commerceOffers", "commerceRoutingPolicies", "commerceResolutions", "commerceActivations", "distributionBindings", "distributionSdkKeys", "syncFingerprints", "syncIndexBuilds", "timelinePolicies", "distributionEvents", "platformConnections", "aiCommercialAssets", "aiAssetReferences", "aiAnalysisJobs", "aiJobAssets", "aiDetectionCandidates", "aiRedundantVerifications", "aiOperatorFlags", "aiPlacements"].forEach((k) => {
    if (st[k] == null) st[k] = fresh[k];
  });
  if (!st.sellers["loja-piloto"] && fresh.sellers["loja-piloto"]) st.sellers["loja-piloto"] = fresh.sellers["loja-piloto"];
  for (const k of Object.keys(st.sellers || {})) if (!st.sellers[k]) delete st.sellers[k]; // limpa entradas vazias de versões anteriores
  // v7: cristaliza a economia das vendas antigas uma única vez.
  (st.sales || []).forEach((sale) => {
    freezeSnapshotSale(sale, st.tracks || {});
    if (sale.financials && !sale.financials.policyId) {
      sale.financials.policyId = (st.commercialPolicies[0] || {}).id || "cp-baseline";
      sale.financials.policyVersion = Number((st.commercialPolicies[0] || {}).version || 1);
    }
  });
  // v12: tenant ownership. Legacy content is attached only when an author belongs
  // to exactly one active organization; otherwise it remains explicitly unassigned.
  const orgsByAuthor = {};
  Object.values(st.accounts || {}).forEach((a) => {
    if (!a.authorId) return;
    const memberships = Object.values(st.organizationMembers || {}).filter((m) => m.username === a.username && m.status === "ACTIVE");
    if (memberships.length === 1) orgsByAuthor[a.authorId] = memberships[0].organizationId;
  });
  Object.values(st.userWorks || {}).forEach((w) => { if (!w.organizationId && orgsByAuthor[w.ownerId]) w.organizationId = orgsByAuthor[w.ownerId]; });
  Object.values(st.userProducts || {}).forEach((p) => { if (!p.organizationId && orgsByAuthor[p.createdBy]) p.organizationId = orgsByAuthor[p.createdBy]; });
  Object.values(st.tracks || {}).forEach((t) => { if (!t.organizationId && orgsByAuthor[t.authorId]) t.organizationId = orgsByAuthor[t.authorId]; });
  st.version = VERSION;
}

function reset({ keepPilot = true } = {}) {
  const secret = state && state.secret; // mantém a chave: quem está logado continua logado
  const old = state;
  state = seed();
  if (secret) state.secret = secret;
  // o material do piloto (obras, produtos, trilhas e ofertas) sobrevive a "restaurar demo"
  if (old && !keepPilot) catalog.forget({ works: Object.keys(old.userWorks || {}), products: Object.keys(old.userProducts || {}) });
  if (old && keepPilot) {
    state.userWorks = old.userWorks || {};
    state.userProducts = old.userProducts || {};
    Object.values(old.tracks || {}).filter((t) => state.userWorks[t.workId]).forEach((t) => (state.tracks[t.id] = t));
    Object.entries(old.officialOffers || {}).filter(([pid]) => state.userProducts[pid]).forEach(([pid, o]) => (state.officialOffers[pid] = o));
    // só as contas donas de material do piloto são mantidas
    const owners = new Set([
      ...Object.values(state.userWorks).map((w) => w.ownerId),
      ...Object.values(state.userProducts).map((p) => p.createdBy),
      ...Object.values(state.tracks).map((t) => t.authorId),
    ]);
    Object.values(old.accounts || {}).forEach((a) => { if (!state.accounts[a.username] && owners.has(a.authorId)) state.accounts[a.username] = a; });
    Object.values(old.authors || {}).forEach((a) => { if (!state.authors[a.id] && owners.has(a.id)) state.authors[a.id] = a; });
  }
  save();
  resetHooks.forEach((fn) => fn());
}
const resetHooks = [];
const onReset = (fn) => resetHooks.push(fn);

// Para os testes: estado em memória, sem gravar em disco.
function useMemory(fresh = true) {
  clearTimeout(saveT);
  saveT = null;
  save.disabled = true;
  repository = null;
  initialized = true;
  if (fresh) state = seed();
}

if (process.env.SCENESHOP_MEMORY) {
  save.disabled = true;
  state = seed();
  initialized = true;
} else {
  // Estado provisório até init(); o servidor não começa a escutar antes do bootstrap assíncrono.
  state = seed();
}
module.exports = { syncInto, demoSeed, productionSeed, get state() { return state; }, init, save, flush, atomicDomain, readDomain, writeDomain, backendKind, health, close, reset, onReset, useMemory, now, DAY };
