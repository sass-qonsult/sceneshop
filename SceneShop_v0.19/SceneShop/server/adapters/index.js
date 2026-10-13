/**
 * Adaptadores de lojas parceiras.
 *
 * Todo adaptador segue a mesma interface:
 *   { id, name, color, getOffer(product) -> Promise<Offer|null> }
 *
 * Offer = { store, storeName, color, price, currency, url, inStock, shipping }
 *
 * No MVP os preços são SIMULADOS (determinísticos por produto), mas os links
 * já abrem uma busca real na loja. Para ligar a API real, implemente
 * `getOffer` usando as credenciais em variáveis de ambiente (ver README).
 */
const crypto = require("crypto");

// Variação de preço estável por (loja, produto): -12% a +10% do preço de referência.
function simulatedPrice(storeId, product) {
  const h = crypto.createHash("md5").update(storeId + product.id).digest();
  const factor = 0.88 + (h[0] / 255) * 0.22;
  return Math.round(product.referencePrice * factor * 100) / 100;
}

function simulatedStock(storeId, product) {
  const h = crypto.createHash("md5").update("stock" + storeId + product.id).digest();
  return h[1] > 25; // ~90% em estoque
}

const amazon = {
  id: "amazon",
  name: "Amazon",
  color: "#FF9900",
  async getOffer(product) {
    if (process.env.AMAZON_CREDENTIAL_ID) {
      // TODO fase 2: Creators API (OAuth 2.0) -> GetItems com product.storeIds.amazon
    }
    const tag = process.env.AMAZON_ASSOCIATE_TAG || "sceneshop-20";
    return {
      store: this.id, storeName: this.name, color: this.color,
      price: simulatedPrice(this.id, product), currency: "BRL",
      inStock: simulatedStock(this.id, product),
      shipping: "Frete grátis Prime",
      url: `https://www.amazon.com.br/s?k=${encodeURIComponent(product.name)}&tag=${tag}`,
      simulated: true,
    };
  },
};

const mercadolivre = {
  id: "mercadolivre",
  name: "Mercado Livre",
  color: "#FFE600",
  async getOffer(product) {
    return {
      store: this.id, storeName: this.name, color: this.color,
      price: simulatedPrice(this.id, product), currency: "BRL",
      inStock: simulatedStock(this.id, product),
      shipping: "Chega amanhã",
      url: `https://lista.mercadolivre.com.br/${encodeURIComponent(product.name.replace(/\s+/g, "-"))}`,
      simulated: true,
    };
  },
};

const magalu = {
  id: "magalu",
  name: "Magalu",
  color: "#0086FF",
  async getOffer(product) {
    return {
      store: this.id, storeName: this.name, color: this.color,
      price: simulatedPrice(this.id, product), currency: "BRL",
      inStock: simulatedStock(this.id, product),
      shipping: "Retire na loja",
      url: `https://www.magazineluiza.com.br/busca/${encodeURIComponent(product.name)}/`,
      simulated: true,
    };
  },
};

// Preços SIMULADOS só existem na demonstração. Em produção, as ofertas vêm apenas das lojas
// com acordo (ofertas oficiais, cupons, campanhas) e do Commerce Core; nunca preço inventado.
const { DEMO } = require("../config");
module.exports = { adapters: DEMO || process.env.SIMULATED_STORES === "1" ? [amazon, mercadolivre, magalu] : [] };
