#!/usr/bin/env node
/**
 * Cria contas de PRODUTORA, MODERADOR ou AUTOR em qualquer backend (arquivo ou PostgreSQL).
 *
 * Em produção (DEMO=0) o cadastro público cria apenas autores da comunidade; produtoras e
 * moderadores são criados por um administrador com este comando, usando as mesmas variáveis
 * de ambiente do servidor (DATA_BACKEND, DATABASE_URL...).
 *
 *   node tools/create-account.js --role=producer --username=globo --name="Globo Filmes" --org="Globo Filmes"
 *   node tools/create-account.js --role=moderator --username=compliance
 *
 * A senha vem de SCENESHOP_NEW_PASSWORD (recomendado) ou --password=; mínimo de 12 caracteres.
 * Para produtoras, cria também a organização (tipo PRODUCER por padrão) com a conta como OWNER.
 */
"use strict";
const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
  return m ? [m[1], m[2] === undefined ? true : m[2]] : [a, true];
}));

function fail(msg, code = 2) { console.error(`Erro: ${msg}`); process.exit(code); }

async function main() {
  if (args.help || args.h) { console.log(require("fs").readFileSync(__filename, "utf8").split("*/")[0]); return; }
  const role = String(args.role || "").toLowerCase();
  if (!["producer", "moderator", "author"].includes(role)) fail("--role deve ser producer, moderator ou author.");
  const username = String(args.username || "").trim().toLowerCase();
  if (!/^[a-z0-9_]{3,24}$/.test(username)) fail("--username: 3 a 24 letras minúsculas, números ou _.");
  const password = String(process.env.SCENESHOP_NEW_PASSWORD || args.password || "");
  if (password.length < 12) fail("defina a senha em SCENESHOP_NEW_PASSWORD (mínimo 12 caracteres).");
  const name = String(args.name || username).slice(0, 40);

  const store = require("../server/store");
  await store.init();
  const { identity, organizations } = require("../server/repositories");
  const { hashPassword } = require("../server/passwords");

  const exists = await Promise.resolve(identity.existsUsernameAuthoritative(username));
  if (exists) fail(`o usuário "${username}" já existe.`, 3);

  const authorId = role === "producer" ? `${username}-org` : username;
  const account = { username, pass: hashPassword(password), role, authorId: role === "moderator" ? null : authorId, tokenVersion: 1, createdAt: store.now() };
  const author = {
    id: authorId, name, kyc: "pendente", document: null,
    type: role === "producer" ? "producer" : role === "moderator" ? "staff" : "community",
    ...(role === "producer" ? { managedBy: "Equipe SceneShop" } : {}),
  };
  await Promise.resolve(identity.createIdentityAuthoritative({ account, author, session: null }));

  let organization = null;
  if (role === "producer" || args.org) {
    const kind = String(args["org-kind"] || (role === "producer" ? "PRODUCER" : "OTHER")).toUpperCase();
    const r = await Promise.resolve(organizations.create({ name: String(args.org || name), slug: args["org-slug"] || undefined, kind }, username));
    if (r.errors) fail(`conta criada, mas a organização falhou: ${r.errors.join(" ")}`, 4);
    organization = r.organization;
  }
  await store.flush();
  console.log(JSON.stringify({ ok: true, username, role, authorId: account.authorId, organization: organization && { id: organization.id, slug: organization.slug, kind: organization.kind } }, null, 2));
  if (typeof store.close === "function") await store.close();
}

main().catch((e) => { console.error(e.stack || e.message); process.exit(1); });
