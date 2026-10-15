/* SceneShop i18n: português (original), English, español.
 *
 * As telas são escritas em português; este arquivo traduz o que aparece na página para o idioma
 * escolhido, usando o dicionário de /js/i18n-dict.js ({ "texto em português": ["english", "español"] }).
 * - Idioma: ?lang=pt|en|es > escolha salva > idioma do aparelho > inglês (outros idiomas).
 * - Traduz textos, placeholder/title/aria-label/alt e botões; acompanha o que as telas criam depois
 *   (MutationObserver). Chaves com {0}, {1}… valem para textos com partes variáveis.
 * - Conteúdo do usuário (nome de obra, produto) não está no dicionário e fica como foi escrito;
 *   marque um bloco com data-no-i18n para nunca traduzi-lo.
 * - window.t("texto {0}", valor) traduz textos que não vão para a página (confirm, prompt...).
 */
(function (root) {
  "use strict";
  const LANGS = ["pt", "en", "es"];
  const NAMES = { pt: "Português", en: "English", es: "Español" };
  const LOCALES = { pt: "pt-BR", en: "en-US", es: "es-419" };
  const KEY = "ss-lang";
  const dict = root.SceneShopI18nDict || {};

  function store(lang) { try { localStorage.setItem(KEY, lang); } catch (e) {} }
  function detect() {
    try { const q = new URLSearchParams(location.search).get("lang"); if (LANGS.includes(q)) { store(q); return q; } } catch (e) {}
    try { const s = localStorage.getItem(KEY); if (LANGS.includes(s)) return s; } catch (e) {}
    const navs = (navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || "pt"]);
    for (const l of navs) { const b = String(l || "").slice(0, 2).toLowerCase(); if (LANGS.includes(b)) return b; }
    return "en";
  }
  const shadow = /^(en|es)$/.test(root.SceneShopI18nShadow || "") ? root.SceneShopI18nShadow : null; // só desenvolvimento
  const lang = shadow ? "pt" : detect();
  let debug = !!shadow;
  try { debug = debug || /[?&]i18nDebug=1/.test(location.search) || localStorage.getItem("ss-i18n-debug") === "1"; } catch (e) {}
  const misses = new Set();
  const PT_HINT = /[ãõçáéíóúâêôà]|\b(não|você|para|com|uma|obra|obras|cena|cenas|produto|produtos|trilha|loja|conta|entrar|salvar|enviar|celular|pedido|preço|comissão|ganhos|moderação|aguarde|carregando|nenhum|nenhuma|ainda|agora|cadastr\w*)\b/i;
  const col = (shadow || lang) === "en" ? 0 : (shadow || lang) === "es" ? 1 : -1;
  const apply = !shadow;
  let pending = null;
  function report(core) {
    misses.add(core);
    if (!shadow) return;
    (pending = pending || []).push(core);
    if (pending.length === 1) setTimeout(() => { const list = pending; pending = null; try { fetch("/api/dev/i18n-misses", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(list), keepalive: true }); } catch (e) {} }, 400);
  }

  // ------------------------------------------------------------------ dicionário
  const norm = (s) => String(s).replace(/\s+/g, " ").trim();
  const exact = new Map();
  const patterns = [];
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (col >= 0) {
    for (const [k, v] of Object.entries(dict)) {
      if (!Array.isArray(v) || typeof v[col] !== "string") continue;
      const key = norm(k);
      if (!/\{\d+#?\}/.test(key)) { exact.set(key, v[col]); continue; }
      const literal = key.replace(/\{\d+#?\}/g, "");
      if (!/[A-Za-zÀ-ÿ]{3}/.test(literal)) continue;            // "{0} · {1}" casaria com tudo
      if (/\}\s*\{/.test(key)) continue;                         // "{0}{1}" não tem como separar as partes
      const holes = key.match(/\{\d+#?\}/g) || [];              // {0} = qualquer texto, {0#} = só número
      const order = holes.map((x) => Number(x.replace(/[{}#]/g, "")));
      const parts = key.split(/\{\d+#?\}/).map(esc);
      const re = new RegExp("^" + parts.map((p, i) => p + (i < holes.length ? (holes[i].includes("#") ? "(\\d+(?:[.,]\\d+)?)" : "([\\s\\S]+?)") : "")).join("") + "$");
      patterns.push({ re, order, out: v[col], weight: literal.length });
    }
    patterns.sort((a, b) => b.weight - a.weight);               // o mais específico primeiro
  }
  const cache = new Map();
  function translateCore(core, depth) {
    if (exact.has(core)) return exact.get(core);
    if (depth > 3) return null;
    for (const p of patterns) {
      const m = p.re.exec(core);
      if (!m) continue;
      return p.out.replace(/\{(\d+)#?\}/g, (_, n) => {
        const i = p.order.indexOf(Number(n));
        const part = i >= 0 ? m[i + 1] : "";
        return translate(part, depth + 1);
      });
    }
    return null;
  }
  function translate(text, depth = 0) {
    if (col < 0 || text == null) return text;
    const s = String(text);
    const core = norm(s);
    if (!core || !/[A-Za-zÀ-ÿ]/.test(core)) return s;
    let out = cache.get(core);
    if (out === undefined) { out = translateCore(core, depth); if (cache.size < 5000) cache.set(core, out); }
    if (out == null) { if (debug && depth === 0 && PT_HINT.test(core)) report(core); return s; }
    return s.match(/^\s*/)[0] + out + s.match(/\s*$/)[0];
  }
  function t(text, ...args) {
    const direct = col >= 0 && Object.prototype.hasOwnProperty.call(dict, text) && Array.isArray(dict[text]) ? dict[text][col] : null;
    let out = typeof direct === "string" ? direct : translate(text);
    if (!apply) out = String(text);                            // modo sombra: só mede, não troca
    return args.length ? out.replace(/\{(\d+)#?\}/g, (_, n) => (args[n] != null ? args[n] : "")) : out;
  }

  // ------------------------------------------------------------------ página
  const SKIP = new Set(["SCRIPT", "STYLE", "TEXTAREA", "CODE", "PRE", "NOSCRIPT"]);
  const ATTRS = ["placeholder", "title", "aria-label", "alt"];
  const blocked = (el) => !el || SKIP.has(el.nodeName) || (el.closest && el.closest("[data-no-i18n],[translate=no]"));
  function doText(n) {
    if (blocked(n.parentNode)) return;
    const v = n.nodeValue, out = translate(v);
    if (apply && out !== v) n.nodeValue = out;
  }
  function doAttrs(el) {
    if (blocked(el)) return;
    for (const a of ATTRS) {
      const v = el.getAttribute(a);
      if (v) { const out = translate(v); if (apply && out !== v) el.setAttribute(a, out); }
    }
    if (el.nodeName === "INPUT" && /^(button|submit|reset)$/i.test(el.type) && el.value) {
      const out = translate(el.value); if (apply && out !== el.value) el.value = out;
    }
  }
  function walk(node) {
    if (node.nodeType === 3) return doText(node);
    if (node.nodeType !== 1 && node.nodeType !== 9 && node.nodeType !== 11) return;
    if (node.nodeType === 1) { if (blocked(node)) return; doAttrs(node); }
    const tw = document.createTreeWalker(node, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
    let n = tw.nextNode();
    while (n) { if (n.nodeType === 3) doText(n); else doAttrs(n); n = tw.nextNode(); }
  }

  // ------------------------------------------------------------------ seletor de idioma
  function setLang(next) {
    if (!LANGS.includes(next) || next === lang) return;
    store(next);
    const u = new URL(location.href);
    if (u.searchParams.has("lang")) u.searchParams.set("lang", next);
    location.replace(u.toString());
  }
  function selector() {
    const sel = document.createElement("select");
    sel.className = "ss-lang"; sel.setAttribute("aria-label", "Idioma / Language / Idioma");
    sel.setAttribute("data-no-i18n", "");
    for (const l of LANGS) { const o = document.createElement("option"); o.value = l; o.textContent = NAMES[l]; if (l === lang) o.selected = true; sel.appendChild(o); }
    sel.onchange = () => setLang(sel.value);
    return sel;
  }
  function mountSelector() {
    if (document.querySelector(".ss-lang") || document.documentElement.hasAttribute("data-no-lang-selector")) return;
    const style = document.createElement("style");
    style.textContent = ".ss-lang{font:inherit;font-size:13px;padding:4px 6px;border-radius:8px;border:1px solid rgba(127,127,127,.45);background:transparent;color:inherit;cursor:pointer}.ss-lang option{color:#111;background:#fff}.ss-lang-float{position:fixed;left:12px;top:12px;z-index:2147483000;background:rgba(20,20,26,.72);color:#f4f2ec;border-color:rgba(255,255,255,.25)}";
    document.head.appendChild(style);
    const slots = document.querySelectorAll("[data-lang-slot]");
    if (slots.length) slots.forEach((slot) => slot.appendChild(selector()));
    else { const sel = selector(); sel.classList.add("ss-lang-float"); document.body.appendChild(sel); }
  }

  function start() {
    document.documentElement.lang = LOCALES[lang];
    if (!shadow) mountSelector();
    if (col < 0) return;
    walk(document.documentElement);
    new MutationObserver((muts) => {
      for (const m of muts) {
        if (m.type === "characterData") doText(m.target);
        else if (m.type === "attributes") { if (m.target.nodeType === 1) doAttrs(m.target); }
        else m.addedNodes.forEach(walk);
      }
    }).observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS.concat(["value"]) });
  }

  root.SceneShopI18n = { misses, lang, locale: LOCALES[lang], languages: LANGS.slice(), names: NAMES, t, translate, setLang, selector };
  root.t = t;
  if (typeof document !== "undefined") {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
    else start();
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
