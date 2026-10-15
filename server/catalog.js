/**
 * Catálogo: obras e produtos.  No MVP vem de data/catalog.json;
 * na fase 2 troca-se por PostgreSQL sem mudar quem usa estas funções.
 *
 * As CENAS de cada obra ficam nas trilhas (server/tracks.js), porque cada
 * trilha — oficial ou da comunidade — pode dividir a obra do seu jeito.
 * A divisão em work.scenes é a da produção, usada para miniaturas.
 */
const fs = require("fs");
const path = require("path");

const FILE = path.join(__dirname, "..", "data", "catalog.json");
// data/catalog.json contém só o material de demonstração (obra demo-01 e produtos de exemplo).
// Em produção (DEMO=0) o catálogo começa vazio; obras e produtos vêm das produtoras.
const { DEMO } = require("./config");
const db = DEMO ? JSON.parse(fs.readFileSync(FILE, "utf8")) : { works: {}, products: {} };

const getWork = (id) => db.works[id] || null;
const listWorks = () => Object.values(db.works).map(({ id, title, duration, video, poster, ownerId, pilot }) => ({ id, title, duration, video, poster, ownerId, pilot: !!pilot }));

// Obras enviadas pelas produtoras no estúdio (modo piloto)
function addWork(w) {
  db.works[w.id] = { scenes: [], ...w };
  return db.works[w.id];
}
const getProduct = (id) => db.products[id] || null;
const listProducts = () => Object.values(db.products);
const snapshot = () => JSON.parse(JSON.stringify(db));

function addProduct(p) {
  db.products[p.id] = p;
  return p;
}

// "restaurar tudo": tira do catálogo as obras e os produtos criados no piloto
function forget({ works = [], products = [] }) {
  works.forEach((id) => delete db.works[id]);
  products.forEach((id) => delete db.products[id]);
}

function searchProducts(q, ownerId) {
  const norm = (s) => String(s).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const words = norm(q || "").split(/\s+/).filter(Boolean);
  // todas as palavras precisam aparecer; os produtos do próprio autor vêm primeiro
  return Object.values(db.products)
    .filter((p) => { const h = norm(`${p.name} ${p.brand} ${p.category} ${p.sku || ""}`); return words.every((w) => h.includes(w)); })
    .sort((a, b) => (b.createdBy === ownerId && !!ownerId) - (a.createdBy === ownerId && !!ownerId))
    .slice(0, 30);
}

// Miniatura para um instante da obra (usa a divisão de cenas da produção)
function thumbAt(work, t) {
  if (!work.scenes || !work.scenes.length) return work.poster || "/media/products/placeholder.svg";
  const s = work.scenes.find((x) => t >= x.start && t < x.end) || work.scenes[work.scenes.length - 1];
  return s.thumb;
}

module.exports = { getWork, listWorks, addWork, getProduct, listProducts, snapshot, addProduct, searchProducts, thumbAt, forget };
