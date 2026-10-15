// Idiomas (português, inglês, espanhol): dicionário completo e coerente, e toda página carrega o tradutor.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ROOT = path.join(__dirname, "..");

function load(langs) {
  const g = { location: { search: "" }, localStorage: { getItem() {}, setItem() {} }, navigator: { languages: langs } };
  const ctx = { ...g, globalThis: null };
  const vm = require("node:vm");
  const sandbox = vm.createContext(Object.assign(Object.create(null), g, { console, URLSearchParams, Object, Array, String, Number, Map, Set, RegExp, JSON, Math }));
  sandbox.globalThis = sandbox;
  for (const f of ["public/js/i18n-dict.js", "public/js/i18n.js"]) vm.runInContext(fs.readFileSync(path.join(ROOT, f), "utf8"), sandbox);
  return sandbox;
}

test("dicionário: toda entrada tem inglês e espanhol, com os mesmos marcadores {n}", () => {
  const dict = load(["pt-BR"]).SceneShopI18nDict;
  const keys = Object.keys(dict);
  assert.ok(keys.length > 1200, `dicionário pequeno demais: ${keys.length}`);
  for (const k of keys) {
    const v = dict[k];
    assert.ok(Array.isArray(v) && v.length === 2 && v.every((x) => typeof x === "string" && x.length), `entrada incompleta: ${k}`);
    const ph = (s) => (s.match(/\{\d+#?\}/g) || []).sort().join();
    assert.equal(ph(v[0]), ph(k), `marcadores diferentes no inglês: ${k}`);
    assert.equal(ph(v[1]), ph(k), `marcadores diferentes no espanhol: ${k}`);
  }
});

test("tradução: idioma pelo aparelho, textos com partes variáveis, conteúdo do usuário intacto", () => {
  const en = load(["en-US"]).SceneShopI18n, es = load(["es-MX"]).SceneShopI18n, pt = load(["pt-BR"]).SceneShopI18n, fr = load(["fr-FR"]).SceneShopI18n;
  assert.deepEqual([pt.lang, en.lang, es.lang, fr.lang], ["pt", "en", "es", "en"]);
  assert.equal(en.translate("Ganhos"), "Earnings");
  assert.equal(es.translate("Ganhos"), "Ganancias");
  assert.equal(pt.translate("Ganhos"), "Ganhos");
  assert.equal(en.translate("  Salvos  "), "  Saved  ", "mantém os espaços em volta");
  assert.equal(en.translate("0:24 · 2 trilha(s) · 3 cenas · 5 produtos"), "0:24 · 2 track(s) · 3 scenes · 5 products");
  assert.equal(en.translate("Cena 3"), "Scene 3");
  assert.equal(en.translate("Cena da praia"), "Cena da praia", "nome digitado pelo usuário não é traduzido");
  assert.equal(es.t("Cena {0#}", 4), "Escena 4");
  assert.equal(en.translate("Kimono floral azul"), "Kimono floral azul");
});

test("toda página HTML carrega o dicionário e o tradutor antes dos scripts da tela", () => {
  const pages = [];
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (p.endsWith(".html")) pages.push(p); });
  walk(path.join(ROOT, "public"));
  for (const p of pages) {
    const html = fs.readFileSync(p, "utf8");
    const a = html.indexOf("/js/i18n-dict.js"), b = html.indexOf("/js/i18n.js"), head = html.indexOf("</head>");
    assert.ok(a > 0 && b > a && b < head, `${path.relative(ROOT, p)} não carrega o tradutor no <head>`);
  }
});

test("lançadores e assistentes falam pt, en e es; guias nos três idiomas", () => {
  const bat = fs.readFileSync(path.join(ROOT, "Iniciar SceneShop.bat"), "utf8");
  assert.match(bat, /Get-UICulture/);
  for (const l of ["pt", "es"]) assert.match(bat, new RegExp(`if /i "%SSL%"=="${l}" set "M_START=`));
  for (const f of ["tools/configurar-ia.ps1", "tools/configurar-acrcloud.ps1"]) assert.match(fs.readFileSync(path.join(ROOT, f), "utf8"), /function L\(\[string\]\$pt, \[string\]\$en, \[string\]\$es\)/);
  for (const f of ["HOW_TO_RUN.md", "COMO_RODAR.md", "COMO_EJECUTAR.md"]) assert.ok(fs.statSync(path.join(ROOT, f)).size > 10000, `${f} ausente`);
});
