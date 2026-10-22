/**
 * Motor de ofertas: consulta lojas em paralelo e devolve as ofertas ordenadas.
 * v0.17 alpha.2: cache coordenado entre instâncias. Redis é cache efêmero;
 * PostgreSQL/Commerce Core continuam sendo as autoridades duráveis.
 */
const { adapters } = require('./adapters');

const DEFAULT_TTL_MS = 60 * 60 * 1000;
const localCache = new Map();
let coordinator = null;

function configureCache(next) { coordinator = next || null; return coordinator; }
function ttlMs() { return Math.max(1000, Number(process.env.OFFER_CACHE_TTL_MS || DEFAULT_TTL_MS)); }
function localGet(key) {
  const hit = localCache.get(key);
  if (!hit) return null;
  if (hit.expiresAt <= Date.now()) { localCache.delete(key); return null; }
  return hit.value;
}
function localSet(key, value) { localCache.set(key, { value, expiresAt: Date.now() + ttlMs() }); }

async function cacheGet(productId) {
  if (coordinator) return coordinator.get('offers', productId);
  return localGet(productId);
}
async function cacheSet(productId, value) {
  if (coordinator) return coordinator.set('offers', productId, value, { ttlMs: ttlMs() });
  localSet(productId, value); return true;
}
async function invalidateProduct(productId, metadata = {}) {
  // Namespace epochs intentionally invalidate the whole offer namespace. This
  // avoids O(N) Redis key scans and guarantees that every web instance moves
  // to the same generation after product/catalog changes.
  localCache.clear();
  if (!coordinator) return { namespace: 'offers', local: true, productId };
  return coordinator.invalidate('offers', { productId: productId || null, reason: 'product_changed', ...metadata });
}

// Preços simulados (Amazon/Mercado Livre/Magalu de exemplo) só valem para o catálogo da demonstração.
// Produto cadastrado por uma organização nunca mostra loja que ela não indicou: só a oferta oficial.
const simulatedAllowed = (product) => require('./config').DEMO && !product.organizationId && !product.createdBy;
const visible = (product, list) => list.filter((o) => !o.simulated || simulatedAllowed(product));

async function offersFor(product) {
  const hit = await cacheGet(product.id);
  if (Array.isArray(hit)) return visible(product, hit); // vale também para o que já estava em cache

  const results = await Promise.allSettled(adapters.map((a) => a.getOffer(product)));
  const offers = results
    .filter((r) => r.status === 'fulfilled' && r.value)
    .map((r) => r.value)
    // preços simulados (Amazon/Mercado Livre/Magalu de exemplo) só aparecem na demonstração
    .filter((o) => !o.simulated || simulatedAllowed(product))
    .sort((a, b) => (b.inStock - a.inStock) || (a.price - b.price));

  await cacheSet(product.id, offers);
  return offers;
}

async function enrich(products) {
  return Promise.all(products.map(async (p) => ({ ...p, offers: await offersFor(p) })));
}

module.exports = { offersFor, enrich, configureCache, invalidateProduct, _resetCache: () => { localCache.clear(); coordinator = null; } };
