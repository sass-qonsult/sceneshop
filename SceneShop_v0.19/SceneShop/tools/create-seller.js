#!/usr/bin/env node
/**
 * Cadastra uma LOJA com acordo comercial (produção ou piloto) e mostra, uma única vez,
 * o segredo com que a loja assina os avisos de pedido (webhook).
 *
 *   node tools/create-seller.js --id=urbano --name="Urbano&Co · Loja oficial" --cnpj=12.345.678/0001-95 \
 *        --store-url=https://loja.urbano.com.br/sceneshop --integration=assinatura --days=365
 *
 * --integration: assinatura (padrão: a loja confere o código assinado), codigos_unicos (cupons)
 *                ou link_campanha (links de campanha).
 * O comprador chega em <store-url>?produto=<id>&ss_offer=<código>. A loja confere o código com a
 * chave pública em <PUBLIC_URL>/api/offers/public-key e avisa as vendas em
 * POST <PUBLIC_URL>/api/sellers/<id>/orders, assinando com o segredo (docs no README).
 *
 * Pare o servidor antes de rodar e inicie de novo depois: o cadastro é lido na inicialização.
 * Use as mesmas variáveis de ambiente do servidor (DATA_BACKEND, DATABASE_URL...).
 */
"use strict";
const crypto = require("crypto");
const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
  return m ? [m[1], m[2] === undefined ? true : m[2]] : [a, true];
}));
function fail(msg, code = 2) { console.error(`Erro: ${msg}`); process.exit(code); }

async function main() {
  if (args.help) { console.log(require("fs").readFileSync(__filename, "utf8").split("*/")[0]); return; }
  const id = String(args.id || "").trim().toLowerCase();
  if (!/^[a-z0-9-]{3,40}$/.test(id)) fail("--id: 3 a 40 letras minúsculas, números ou hífen.");
  const name = String(args.name || "").trim();
  if (name.length < 2) fail("--name é obrigatório.");
  const { validCnpj } = require("../server/money");
  const cnpjDigits = String(args.cnpj || "").replace(/\D/g, "");
  if (!validCnpj(cnpjDigits)) fail("--cnpj inválido.");
  const integration = String(args.integration || "assinatura");
  if (!["assinatura", "codigos_unicos", "link_campanha"].includes(integration)) fail("--integration deve ser assinatura, codigos_unicos ou link_campanha.");
  let storeUrl;
  try { storeUrl = new URL(String(args["store-url"] || "")); } catch (e) { fail("--store-url deve ser uma URL completa."); }
  if (storeUrl.protocol !== "https:" && process.env.NODE_ENV === "production") fail("--store-url deve usar https em produção.");
  const days = Math.max(1, Math.min(1825, Number(args.days || 365)));

  const store = require("../server/store");
  await store.init();
  if (store.state.sellers[id]) fail(`a loja "${id}" já existe.`, 3);
  const now = Date.now();
  const secret = crypto.randomBytes(24).toString("hex");
  const cnpj = cnpjDigits.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
  store.state.sellers[id] = {
    id, name, cnpj, color: /^#[0-9a-f]{6}$/i.test(String(args.color || "")) ? args.color : "#1e5bd8",
    verified: true, kind: String(args.kind || (integration === "assinatura" ? "marca" : "varejista")), integration,
    storeUrl: storeUrl.toString(), secret, normalMarkup: 1.15,
    agreement: { since: now, until: now + days * 86400000, notes: String(args.notes || "Acordo comercial cadastrado pelo administrador.") },
  };
  require("../server/audit").log("admin-cli", "loja_cadastrada", { sellerId: id, integration, cnpj });
  store.save();
  await store.flush();
  console.log(JSON.stringify({ ok: true, id, name, integration, storeUrl: storeUrl.toString(), validUntil: new Date(now + days * 86400000).toISOString() }, null, 2));
  console.log(`\nSegredo do webhook (guarde agora; não será mostrado de novo):\n${secret}\n`);
  if (typeof store.close === "function") await store.close();
}
main().catch((e) => { console.error(e.stack || e.message); process.exit(1); });
