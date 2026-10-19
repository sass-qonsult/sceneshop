#!/usr/bin/env node
/**
 * Cria (ou atualiza) o administrador do SceneShop em produção.
 *
 * O administrador é uma conta de produtora, dona (OWNER) da organização principal, com acesso
 * também às telas de moderação/compliance. Use uma vez, depois de subir o servidor sem demonstração.
 *
 *   docker compose exec app node tools/criar-admin.js --usuario miguel --nome "Miguel" --empresa "SceneShop"
 *
 * A senha é pedida no terminal (não aparece na tela). Em automação, use a variável SCENESHOP_ADMIN_PASSWORD.
 * Se o usuário já existir, a senha é trocada, a conta vira administradora e as sessões abertas são encerradas
 * (serve também para "esqueci a senha").
 */
"use strict";
const path = require("path");
const readline = require("readline");

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
if (args.includes("--help") || args.includes("-h")) {
  console.log("Uso: node tools/criar-admin.js --usuario <login> [--nome \"Seu nome\"] [--empresa \"Nome da produtora\"]");
  process.exit(0);
}

function askHidden(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const write = rl._writeToOutput;
    rl._writeToOutput = (s) => { if (s.includes(question)) write.call(rl, s); else write.call(rl, "*"); };
    rl.question(question, (answer) => { rl.close(); process.stdout.write("\n"); resolve(answer); });
  });
}

async function main() {
  const username = String(opt("usuario") || "").trim().toLowerCase();
  if (!/^[a-z0-9_]{3,24}$/.test(username)) {
    console.error("Informe --usuario com 3 a 24 letras minúsculas, números ou _ (ex.: --usuario miguel).");
    process.exit(2);
  }
  const name = String(opt("nome") || username).slice(0, 40);
  const company = String(opt("empresa") || "Minha produtora").slice(0, 80);

  let password = process.env.SCENESHOP_ADMIN_PASSWORD || "";
  if (!password) {
    if (!process.stdin.isTTY) { console.error("Defina SCENESHOP_ADMIN_PASSWORD ou rode em um terminal interativo (docker compose exec ...)."); process.exit(2); }
    password = await askHidden("Senha do administrador (mín. 10 caracteres): ");
    const again = await askHidden("Repita a senha: ");
    if (password !== again) { console.error("As senhas não conferem."); process.exit(2); }
  }
  if (password.length < 10) { console.error("A senha precisa de ao menos 10 caracteres."); process.exit(2); }

  process.chdir(path.join(__dirname, ".."));
  const store = require("../server/store");
  await store.init();
  const { identity, organizations } = require("../server/repositories");
  const auth = require("../server/auth");
  const audit = require("../server/audit");

  const hash = auth.hashPassword(password);
  const existing = await Promise.resolve(identity.findAccountAuthoritative(username));
  if (existing) {
    await Promise.resolve(identity.adminUpdateAccountAuthoritative(username, { pass: hash, role: "producer", platformAdmin: true }));
    console.log(`Conta "${username}" atualizada: nova senha, administradora, sessões anteriores encerradas.`);
  } else {
    const now = Date.now();
    await Promise.resolve(identity.createIdentityAuthoritative({
      account: { username, pass: hash, role: "producer", authorId: username, tokenVersion: 1, platformAdmin: true, createdAt: now },
      author: { id: username, name, type: "producer", kyc: "aprovado", document: null, managedBy: "administrador" },
      session: null,
    }));
    console.log(`Conta "${username}" criada.`);
  }

  const mine = await Promise.resolve(organizations.listForUser(username));
  const owned = (mine || []).find((o) => (o.membership || {}).role === "OWNER" && ["PRODUCER", "CONTENT_OWNER"].includes(o.kind));
  if (owned) {
    console.log(`Organização: ${owned.name} (${owned.id}) — você é OWNER.`);
  } else {
    const r = await Promise.resolve(organizations.create({ name: company, kind: "PRODUCER" }, username));
    if (!r || !r.organization) { console.error("Não foi possível criar a organização:", JSON.stringify(r)); process.exit(1); }
    console.log(`Organização criada: ${r.organization.name} (${r.organization.id}) — você é OWNER.`);
  }
  audit.log("sistema", "administrador_definido", { username });
  if (store.flush) await store.flush();
  if (store.close) await store.close();
  console.log("Pronto. Entre no Studio com esse usuário e senha.");
  process.exit(0);
}

main().catch((e) => { console.error("Falhou:", e && e.message ? e.message : e); process.exit(1); });
