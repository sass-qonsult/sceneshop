/**
 * App do celular (segunda tela).
 * Abre pelo QR code: /s/<CODIGO>?t=<segundo em que o espectador parou>
 */
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const brl = (v, currency="BRL") => Number(v).toLocaleString("pt-BR", { style: "currency", currency: currency || "BRL" });
  const territory = (() => { const m=String(navigator.language||'').match(/[-_]([A-Za-z]{2})$/); return m ? m[1].toUpperCase() : 'GLOBAL'; })();
  const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const state = {
    code: window.SceneShopAppCore ? window.SceneShopAppCore.resolveSessionCode(location) : ((location.pathname.match(/^\/s\/([^/]+)/)||[])[1]||""),
    time: Number(new URLSearchParams(location.search).get("t") || 0),
    playing: false,
    work: null,
    timeline: null,
    core: null,
    liveSceneId: null,   // cena que está passando na TV
    viewSceneId: null,   // cena que o usuário está olhando (null = seguindo ao vivo)
    tab: "scene",
    saved: loadSaved(),
    deviceId: deviceId(),
    votes: loadSet("ss-votes"),       // trilhas em que já votou
    reported: loadSet("ss-reported"), // produtos que já denunciou (trilha:cena:produto)
    resolvedOffers: new Map(),
    resolvingOffers: new Set(),
    foreground: document.visibilityState !== "hidden",
    networkOnline: navigator.onLine !== false,
    resumeInFlight: false,
  };

  function loadSaved() {
    try { return new Set(JSON.parse(localStorage.getItem("ss-saved") || "[]")); } catch (e) { return new Set(); }
  }
  // Identificador anônimo do aparelho (um voto por aparelho; atribuição de cliques)
  function deviceId() {
    let id = null;
    try { id = localStorage.getItem("ss-device"); } catch (e) {}
    if (!/^[A-Za-z0-9_-]{8,64}$/.test(id || "")) {
      const r = new Uint8Array(12);
      (window.crypto || {}).getRandomValues ? crypto.getRandomValues(r) : r.forEach((_, i) => (r[i] = Math.random() * 256));
      id = "m" + Array.from(r, (b) => b.toString(16).padStart(2, "0")).join("");
      try { localStorage.setItem("ss-device", id); } catch (e) {}
    }
    return id;
  }

  async function post(url, body) {
    const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, session: state.code, deviceId: state.deviceId }) });
    return { ok: r.ok, status: r.status, data: await r.json().catch(() => ({})) };
  }

  function notice(msg) {
    let n = $("notice");
    if (!n) { n = document.createElement("div"); n.id = "notice"; n.className = "notice"; document.body.appendChild(n); }
    n.textContent = msg;
    n.hidden = false;
    clearTimeout(notice._t);
    notice._t = setTimeout(() => (n.hidden = true), 3500);
  }

  function loadSet(key) {
    try { return new Set(JSON.parse(localStorage.getItem(key) || "[]")); } catch (e) { return new Set(); }
  }
  function persistSet(key, set) {
    try { localStorage.setItem(key, JSON.stringify([...set])); } catch (e) {}
  }
  function persistSaved() {
    try { localStorage.setItem("ss-saved", JSON.stringify([...state.saved])); } catch (e) {}
  }

  // Commerce Timeline é independente dos cortes cinematográficos. Ela contém apenas
  // cenas com placements publicados e respeita a política de spoilers do produtor.
  function hydrateTimeline(raw) {
    const sourceScenes = state.work.scenes || [];
    const productMap = new Map();
    sourceScenes.forEach((s) => (s.products || []).forEach((p) => productMap.set(p.id, p)));
    if (!raw || !Array.isArray(raw.scenes) || !raw.scenes.length) {
      return { workId: state.work.id, policy: { visibility: 'PAST_AND_CURRENT', thumbnailsEnabled: true, missedItemsEnabled: true, allowSceneSeek: false }, scenes: sourceScenes.map((s) => ({ ...s, sceneId: s.id, thumbnail: s.thumb })) };
    }
    return { ...raw, scenes: raw.scenes.map((sc, i) => {
      const legacy = sourceScenes.find((s) => s.id === sc.sceneId) || sourceScenes.find((s) => Number(sc.start) >= Number(s.start) && Number(sc.start) < Number(s.end)) || null;
      return {
        ...sc, id: sc.sceneId || `commerce-${i+1}`, sceneId: sc.sceneId || `commerce-${i+1}`,
        title: legacy && legacy.title || `Cena comercial ${i+1}`, thumb: sc.thumbnail || legacy && legacy.thumb || null,
        products: (sc.products || []).map((cp) => {
          const rich = productMap.get(cp.productId);
          return rich ? { ...rich, productId: cp.productId || rich.id || null, placementId: cp.placementId, assetId: cp.assetId || null, policy: cp.policy || {} } : { id: cp.productId || cp.assetId, productId: cp.productId || null, name: cp.name || 'Produto', brand: cp.brand || '', category: cp.category || '', image: '/media/products/placeholder.svg', offers: [], placementId: cp.placementId, assetId: cp.assetId || null, policy: cp.policy || {} };
        }),
      };
    }) };
  }
  const timelineScenes = () => state.timeline && state.timeline.scenes || state.work && state.work.scenes || [];
  const activeSceneAt = (t) => timelineScenes().find((s) => t >= Number(s.start||0) && t < Number(s.end||0)) || null;
  const browseSceneAt = (t) => {
    const sc = timelineScenes(); if (!sc.length) return null;
    const hit = activeSceneAt(t);
    if (hit) return hit;
    return t < Number(sc[0].start||0) ? sc[0] : [...sc].reverse().find((s) => t >= Number(s.end||0)) || sc[sc.length - 1];
  };
  const shownScene = () => {
    if (state.viewSceneId) return timelineScenes().find((s) => (s.sceneId||s.id) === state.viewSceneId) || null;
    if (state.liveSceneId) return timelineScenes().find((s) => (s.sceneId||s.id) === state.liveSceneId) || null;
    return null;
  };
  const allProducts = () => {
    const m = new Map();
    timelineScenes().forEach((s) => (s.products||[]).forEach((p) => m.set(p.id, { ...p, sceneTitle: s.title })));
    return m;
  };
  const coreKey = () => state.workId ? `ss-companion-core:${state.workId}` : null;
  function loadCoreSnapshot(){try{const k=coreKey();return k?JSON.parse(localStorage.getItem(k)||'{}'):{};}catch(e){return {};}}
  function persistCore(){try{const k=coreKey();if(k&&state.core)localStorage.setItem(k,JSON.stringify(state.core.snapshot()));}catch(e){}}

  // ------------------------------------------------------------ render
  function renderScenes() {
    const nav = $("scenes");
    nav.innerHTML = "";
    const visible = state.core ? state.core.visibleScenes(state.timeline, state.timeline && state.timeline.policy) : timelineScenes();
    visible.forEach((s, i) => {
      const b = document.createElement("button");
      const sid=s.sceneId||s.id;
      const isLive = sid === state.liveSceneId;
      const currentShown=shownScene();
      const isSel = currentShown && sid === (currentShown.sceneId||currentShown.id);
      b.className = "scene" + (isLive ? " is-live" : "") + (isSel ? " is-sel" : "");
      b.innerHTML = `<div class="thumb">${s.thumb?`<img src="${s.thumb}" alt=""/>`:'<span class="thumb-fallback">SHOP</span>'}${isLive ? '<span class="live">AO VIVO</span>' : ""}</div>
                     <div class="label">${i + 1}. ${esc(s.title)}</div>
                     <div class="count">${(s.products||[]).length} produtos · ${fmt(Number(s.start||0))}</div>`;
      b.onclick = () => {
        state.viewSceneId = sid === state.liveSceneId ? null : sid;
        state.tab = "scene";
        if(state.core){ state.viewSceneId ? state.core.browse(s) : state.core.goLive(state.timeline); persistCore(); }
        if (state.socket && state.connected) {
          if (state.viewSceneId) state.socket.emit("commerce:browse", { position: Number(s.start||0), sceneId: sid });
          else state.socket.emit("commerce:live", {});
        }
        render();
      };
      nav.appendChild(b);
    });
    const sel = nav.querySelector(".is-sel");
    if (sel) sel.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
  }

  const ICON_UP = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 11v9H4v-9h3zm0 0l4-8a2 2 0 0 1 3 2l-1 4h5a2 2 0 0 1 2 2.3l-1.2 7A2 2 0 0 1 16.8 20H7"/></svg>';
  const ICON_DOWN = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="transform:rotate(180deg)"><path d="M7 11v9H4v-9h3zm0 0l4-8a2 2 0 0 1 3 2l-1 4h5a2 2 0 0 1 2 2.3l-1.2 7A2 2 0 0 1 16.8 20H7"/></svg>';

  // Selo da trilha + voto (a reputação decide qual trilha da comunidade aparece primeiro)
  function renderTrack() {
    const t = state.work.track;
    const official = t.type === "official";
    const voted = state.votes.has(t.id);
    $("trackbar").innerHTML = `
      <div class="track-line">
        <span class="seal ${official ? "is-official" : "is-community"}">${official ? "Oficial" : "Comunidade"}</span>
        <span class="track-author">${official ? "Produção" : "Inventário de"} <b>${esc(t.author.name)}</b></span>
        ${t.approval != null ? `<span class="track-rate">${t.approval}% aprovam</span>` : ""}
      </div>
      ${official ? "" : `<div class="vote">
        ${voted ? '<span class="thanks">Obrigado pelo voto</span>' : `<span>Os produtos batem com as cenas?</span>
        <button data-vote="1" aria-label="Sim">${ICON_UP}</button><button data-vote="0" aria-label="Não">${ICON_DOWN}</button>`}
      </div>`}`;
    $("trackbar").querySelectorAll("[data-vote]").forEach((b) => (b.onclick = async () => {
      const r = await post(`/api/tracks/${t.id}/vote`, { up: b.dataset.vote === "1" });
      if (!r.ok) return notice(r.data.error || "Não foi possível votar agora.");
      state.votes.add(t.id);
      persistSet("ss-votes", state.votes);
      Object.assign(state.work.track, r.data);
      renderTrack();
    }));
  }

  async function reportProduct(sceneId, productId, btn) {
    const key = `${state.work.track.id}:${sceneId}:${productId}`;
    if (state.reported.has(key)) return;
    btn.disabled = true;
    const r = await post(`/api/tracks/${state.work.track.id}/report`, { sceneId, productId, reason: "Produto não aparece na cena" });
    if (!r.ok && r.status !== 409) { btn.disabled = false; return notice(r.data.error || "Não foi possível enviar agora."); }
    state.reported.add(key);
    persistSet("ss-reported", state.reported);
    btn.textContent = "Denúncia enviada";
  }

  const resolutionKey = (p) => `${p.placementId||'none'}:${p.productId||p.id||p.assetId||'asset'}`;
  async function resolveOffers(p) {
    if(!p || !p.placementId || (!p.id && !p.assetId)) return;
    const key=resolutionKey(p); if(state.resolvedOffers.has(key)||state.resolvingOffers.has(key)) return;
    state.resolvingOffers.add(key);
    try {
      const r=await fetch('/api/commerce/resolve',{method:'POST',headers:{'Content-Type':'application/json','X-SceneShop-Device':state.deviceId},body:JSON.stringify({workId:state.workId,productId:p.productId || (p.assetId ? null : p.id) || null,assetId:p.assetId||null,placementId:p.placementId,campaignId:p.policy&&p.policy.campaignId||null,territory,deviceId:state.deviceId})});
      const data=await r.json().catch(()=>({}));
      state.resolvedOffers.set(key,r.ok?(data.offers||[]):[]);
    } catch(e) { state.resolvedOffers.set(key,[]); }
    finally { state.resolvingOffers.delete(key); if(state.work) renderList(); }
  }
  function dynamicOfferView(o){
    const provider=o.provider||{};
    return { store:provider.providerCode||provider.id||'provider', storeName:provider.name||'Parceiro autorizado', shipping:o.cta||'EXPLORE', price:o.price, currency:o.currency||'BRL', inStock:['AVAILABLE','IN_STOCK','UNKNOWN'].includes(o.availability), official:provider.kind==='BRAND_DIRECT', color:'var(--accent-2)', url:o.activationUrl, cta:o.cta||'EXPLORE' };
  }
  const ctaLabel=(cta)=>({BUY:'Comprar',EXPLORE:'Explorar',RESERVE:'Reservar',CONFIGURE:'Configurar',BOOK_TEST_DRIVE:'Test drive',FIND_DEALER:'Ver dealer',BOOK:'Reservar',LEAD:'Saiba mais'}[String(cta||'').toUpperCase()]||'Abrir');

  function productCard(p, extra, sceneId) {
    const key=resolutionKey(p);
    const dynamic=state.resolvedOffers.get(key);
    const legacy = Array.isArray(p.offers) ? p.offers : [];
    // Commerce Core first; when it has no eligible offer, keep the track's official/partner offers (preço garantido).
    const offerList = p.placementId && Array.isArray(dynamic) && dynamic.length ? dynamic.map(dynamicOfferView) : (p.placementId && dynamic === undefined && !legacy.length ? [] : legacy);
    if(p.placementId && dynamic===undefined) resolveOffers(p);
    const inStock = offerList.filter((o) => o.inStock);
    const best = inStock[0] || offerList[0] || null;
    const saved = state.saved.has(p.id);
    const offers = offerList.map((o) => { const sep=String(o.url||'').includes('?')?'&':'?'; return `
      <a class="offer${o === best ? " best" : ""}${o.official ? " official" : ""}${o.inStock ? "" : " out"}" href="${o.inStock ? o.url + sep + "sess=" + state.code + "&d=" + state.deviceId + (state.work.partner ? "&pa=" + state.work.partner.id : "") : "#"}" target="_blank" rel="noopener sponsored" data-store="${o.store}">
        <span class="store" style="--c:${o.color}">${esc(o.storeName)}</span>
        <span class="ship">${o.official ? `<b class="gtd">Preço garantido</b> · ${o.shipping === "Preço negociado pela produção" ? "negociado pela produção" : "loja oficial"}` : o.inStock ? esc(o.shipping) : "Indisponível"}</span>
        <span class="price">${o.price==null?'—':brl(o.price,o.currency||'BRL')}</span>
        <span class="go">${o.inStock ? ctaLabel(o.cta||'BUY') : ""}</span>
      </a>`; }).join("");
    return `
      <article class="card" data-id="${p.id}">
        <div class="card-top">
          <img src="${p.image}" alt=""/>
          <div class="info">
            <div class="brand-name">${esc(p.brand)} · ${esc(p.category)}</div>
            <h3>${esc(p.name)}${p.match === "parecido" ? ' <span class="similar">parecido</span>' : ""}</h3>
            <div class="from">${best ? `a partir de <b>${brl(best.price,best.currency||'BRL')}</b>` : p.placementId && dynamic===undefined ? '<b>Buscando oferta autorizada…</b>' : '<b>Explore este produto</b>'}</div>
            ${extra || ""}
          </div>
          <button class="save${saved ? " is-on" : ""}" data-save="${p.id}" aria-label="${saved ? "Remover dos salvos" : "Salvar"}">
            <svg viewBox="0 0 24 24" width="22" height="22"><path d="M12 21s-7.5-4.6-9.5-9.2C1 8.3 3.4 5 6.8 5c2 0 3.5 1 5.2 3 1.7-2 3.2-3 5.2-3C20.6 5 23 8.3 21.5 11.8 19.5 16.4 12 21 12 21z"/></svg>
          </button>
        </div>
        <div class="offers">${offers || `<div class="offer-empty">${p.placementId && dynamic===undefined ? 'Resolvendo oferta para sua região…' : 'Nenhuma oferta ativa para este contexto.'}</div>`}</div>
        ${sceneId && state.work.track.type !== "official" ? (() => {
          const done = state.reported.has(`${state.work.track.id}:${sceneId}:${p.id}`);
          return `<button class="report" data-report="${p.id}" data-scene="${sceneId}" ${done ? "disabled" : ""}>${done ? "Denúncia enviada" : "Esse produto não está na cena?"}</button>`;
        })() : ""}
      </article>`;
  }

  function renderList() {
    const list = $("list");
    list.classList.remove("fade");
    void list.offsetWidth;
    list.classList.add("fade");
    if (state.tab === "saved") {
      const all = allProducts();
      const items = [...state.saved].map((id) => all.get(id)).filter(Boolean);
      list.innerHTML = items.length
        ? items.map((p) => productCard(p, `<div class="from-scene">Visto em: ${esc(p.sceneTitle)}</div>`)).join("")
        : `<div class="empty">Toque no coração de um produto para guardar e comprar depois.</div>`;
    } else {
      const s = shownScene();
      if (!s) {
        list.innerHTML = `<div class="empty"><b>Nenhum produto comercial ativo neste momento.</b><br/>A Commerce Timeline continua disponível acima para explorar cenas anteriores.</div>`;
      } else {
        const sid=s.sceneId||s.id;
        list.innerHTML = `<div class="list-head">${esc(s.title)} ${sid === state.liveSceneId ? '<span class="live">AO VIVO</span>' : ""}</div>` +
          (s.products||[]).map((p) => productCard(p, "", sid)).join("");
      }
    }
    list.querySelectorAll("[data-save]").forEach((b) => (b.onclick = () => toggleSave(b.dataset.save)));
    list.querySelectorAll("[data-report]").forEach((b) => (b.onclick = () => reportProduct(b.dataset.scene, b.dataset.report, b)));
  }

  function renderMissed() {
    const box=$("missed"), host=$("missedScenes");
    if(!state.core||!state.timeline||!(state.timeline.policy||{}).missedItemsEnabled){box.hidden=true;return;}
    const rows=state.core.missedScenes(state.timeline);
    box.hidden=!rows.length;
    host.innerHTML=rows.map((s)=>{const sid=s.sceneId||s.id;return `<button type="button" data-missed-scene="${esc(sid)}"><span>${s.thumb?`<img src="${s.thumb}" alt=""/>`:'<i>SHOP</i>'}</span><b>${esc(s.title||'Cena comercial')}</b><small>${fmt(Number(s.start||0))} · ${(s.products||[]).length} produtos</small></button>`;}).join('');
    host.querySelectorAll('[data-missed-scene]').forEach((b)=>b.onclick=()=>{const sc=timelineScenes().find((s)=>(s.sceneId||s.id)===b.dataset.missedScene);if(!sc)return;state.viewSceneId=b.dataset.missedScene;state.tab='scene';state.core.browse(sc);persistCore();if(state.socket&&state.connected)state.socket.emit('commerce:browse',{position:Number(sc.start||0),sceneId:state.viewSceneId});render();});
  }

  function renderStatus() {
    if (!state.work) return; // a obra ainda está carregando
    const playback=state.core?state.core.playbackPosition:state.time;
    $("progress").style.width = `${Math.min(100,(playback / state.work.duration) * 100)}%`;
    const browsing=state.core&&state.core.mode==='BROWSING';
    const txt = state.connected
      ? browsing ? `Explorando ${fmt(state.core.browsePosition)} · vídeo ${fmt(playback)}` : `${state.playing ? "Ao vivo" : "Pausado"} · ${fmt(playback)}`
      : "Reconectando…";
    $("statusText").textContent = txt;
    $("status").className = "status" + (state.connected ? (state.playing ? " is-live" : " is-paused") : "");
    $("pinned").hidden = !(state.core&&state.core.mode==='BROWSING') || state.tab !== "scene";
    if($("browseStatus")&&state.core&&state.core.mode==='BROWSING') $("browseStatus").textContent=`Explorando ${fmt(state.core.browsePosition)} · vídeo em ${fmt(state.core.playbackPosition)}`;
    $("tabScene").classList.toggle("is-on", state.tab === "scene");
    $("tabSaved").classList.toggle("is-on", state.tab === "saved");
    $("savedCount").textContent = state.saved.size;
  }

  function render() {
    renderTrack();
    renderScenes();
    renderList();
    renderStatus();
    renderMissed();
  }

  function toggleSave(id) {
    state.saved.has(id) ? state.saved.delete(id) : state.saved.add(id);
    persistSaved();
    if (state.saved.has(id) && state.socket) state.socket.emit("product:save", { productId: id });
    renderList();
    renderStatus();
  }

  // ------------------------------------------------------------ dados + tempo real
  async function refreshAfterResume() {
    if (!state.code || state.resumeInFlight || !state.networkOnline) return;
    state.resumeInFlight = true;
    try {
      const response = await fetch(`/api/sessions/${state.code}?deviceId=${encodeURIComponent(state.deviceId)}`, { cache: "no-store" });
      if (!response.ok) return;
      const session = await response.json();
      state.time = session.mode === "COMPANION" ? Math.min(Number(state.work && state.work.duration) || Infinity, companionNow(session)) : Number(session.time || state.time || 0);
      if (session.mode === "COMPANION") state.playing = true;
      state.anchor = { time: state.time, at: performance.now() };
      if (state.core) {
        state.core.tick(state.time, state.timeline);
        persistCore();
      }
      if (state.socket && !state.socket.connected) state.socket.connect();
      renderStatus();
    } catch (e) {
      state.connected = false;
      renderStatus();
    } finally { state.resumeInFlight = false; }
  }

  function handleLifecycle(detail = {}) {
    const next = String(detail.state || "").toUpperCase();
    if (next === "BACKGROUND") { state.foreground = false; persistCore(); return; }
    if (next === "OFFLINE") { state.networkOnline = false; state.connected = false; renderStatus(); return; }
    if (next === "ONLINE") { state.networkOnline = true; refreshAfterResume(); return; }
    if (next === "FOREGROUND") { state.foreground = true; state.networkOnline = navigator.onLine !== false; refreshAfterResume(); }
  }

  function handleNativeEvent(detail = {}) {
    const type = String(detail.type || "").toUpperCase();
    const payload = detail.payload || {};
    if (type === "SHARE_RECEIVED") {
      const candidate = String(payload.url || payload.text || "").trim();
      if (candidate) {
        try { localStorage.setItem("ss-native-share", JSON.stringify({ value: candidate, at: Date.now() })); } catch (e) {}
        if ($("syncSourceUrl")) $("syncSourceUrl").value = candidate;
        if (!state.code) showJoin("Conteúdo recebido. Sincronize para identificar a cena comercial.");
        else notice("Conteúdo recebido pelo aplicativo.");
      }
    } else if (type === "NOTIFICATION_REGISTRATION") {
      const btn = $("enableNotifications");
      if (btn && payload.granted) btn.hidden = true;
      if (payload.registration === "PERMISSION_DENIED") notice("Notificações não foram autorizadas.");
    }
  }

  async function prepareNativeNotifications() {
    const btn = $("enableNotifications");
    if (!btn || !window.SceneShopAppBridge) return;
    try {
      const current = await window.SceneShopAppBridge.request("NOTIFICATION_PERMISSION", {}, 4000);
      btn.hidden = !current || current.supported === false || current.granted === true;
      btn.onclick = async () => {
        btn.disabled = true;
        try {
          const out = await window.SceneShopAppBridge.request("NOTIFICATION_REGISTER", {}, 15000);
          btn.hidden = Boolean(out && out.granted);
          if (!out || !out.granted) notice("Notificações não foram autorizadas.");
        } catch (e) { notice("Não foi possível configurar notificações."); }
        finally { btn.disabled = false; }
      };
    } catch (e) { btn.hidden = true; }
  }

  window.addEventListener("sceneshop:app-lifecycle", (event) => handleLifecycle(event.detail || {}));
  window.addEventListener("sceneshop:native-event", (event) => handleNativeEvent(event.detail || {}));

  async function start() {
    if (!state.code) return showJoin();
    const sRes = await fetch(`/api/sessions/${state.code}?deviceId=${encodeURIComponent(state.deviceId)}`);
    if (!sRes.ok) return showJoin("Esse código expirou. Gere um novo QR code na TV.");
    const session = await sRes.json();
    // sincronizado pelo som: a posição do servidor (+ o tempo que passou) vale mais que o ?t= arredondado da URL
    if (session.mode === "COMPANION") state.time = companionNow(session);
    else if (!new URLSearchParams(location.search).has("t")) state.time = session.time;

    state.workId = session.workId;
    state.mode = session.mode || "PARTNER_NATIVE";
    const reSyncBtn=$("reSync"); if(reSyncBtn) reSyncBtn.hidden = state.mode !== "COMPANION";
    await loadWork(session.trackId);
    $("workTitle").textContent = state.work.title;
    if (state.mode === "COMPANION") {
      // sincronizado pelo som de outra tela (TV aberta, streaming, YouTube): o filme continua andando
      // a partir do ponto reconhecido, então as cenas seguintes aparecem sozinhas.
      state.time = Math.min(Number(state.work.duration) || Infinity, state.time);
      state.playing = true;
      state.anchor = { time: state.time, at: performance.now() };
    }
    const stored=loadCoreSnapshot();
    state.core=new SceneShopMobileCore.CompanionState({ ...stored, mode:session.viewer&&session.viewer.state||stored.mode||'LIVE', playbackPosition:state.time, browsePosition:session.viewer&&session.viewer.browsePosition||stored.browsePosition||state.time, browseSceneId:session.viewer&&session.viewer.browseSceneId||stored.browseSceneId||null, syncConfidence:session.syncConfidence||stored.syncConfidence||0 });
    state.core.tick(state.time,state.timeline);
    const liveScene=activeSceneAt(state.time); state.liveSceneId=liveScene&&(liveScene.sceneId||liveScene.id);
    if (state.core.mode === "BROWSING") { const browsed=browseSceneAt(state.core.browsePosition); state.viewSceneId = state.core.browseSceneId || (browsed&&((browsed.sceneId)||browsed.id)) || null; }
    persistCore(); render();

    const socket = (state.socket = io());
    socket.on("connect", () => {
      socket.emit("session:join", { code: state.code, deviceId: state.deviceId }, (res) => {
        if (res && res.error) return showJoin(res.error);
        state.connected = true;
        renderStatus();
      });
    });
    socket.on("disconnect", () => { state.connected = false; renderStatus(); });

    // A TV manda o tempo 1x por segundo; entre um aviso e outro o celular estima o tempo
    // pelo relógio local, então a troca de cena aparece sem esperar o próximo aviso.
    socket.on("player:tick", ({ time, playing }) => {
      state.anchor = { time, at: performance.now() };
      state.playing = state.mode === "COMPANION" ? true : playing;
      tick();
    });
    socket.on("scene:change", ({ sceneId }) => {
      if (sceneId !== state.liveSceneId) onSceneChange(sceneId);
    });
    socket.on("track:change", async ({ trackId }) => {
      await loadWork(trackId);
      state.viewSceneId = null;
      if(state.core) state.core.goLive(state.timeline);
      const live=activeSceneAt(state.time);state.liveSceneId=live&&(live.sceneId||live.id);
      persistCore(); render();
    });
    socket.on("session:tv", ({ online }) => {
      if (!online) $("statusText").textContent = "TV desconectada";
    });
  }

  // posição atual no modo COMPANION: a última posição conhecida + o tempo que passou desde ela
  function companionNow(session) {
    return Math.max(0, Number(session.playbackPosition ?? session.time ?? 0) + Math.min(6 * 3600, Number(session.observedAgoSeconds) || 0));
  }

  function estimatedTime() {
    if (!state.anchor) return state.time;
    // com o player do SceneShop, a TV avisa o tempo 1x por segundo (o celular só estima entre avisos);
    // sincronizado pelo som de outra tela, não há avisos: o relógio do celular conduz até a próxima sincronização
    const cap = state.mode === "COMPANION" ? Infinity : 2.5;
    const drift = state.playing ? Math.min(cap, (performance.now() - state.anchor.at) / 1000) : 0;
    return Math.min(state.work.duration, state.anchor.time + drift);
  }

  function tick() {
    if (!state.work) return;
    state.time = estimatedTime();
    if(state.core){state.core.tick(state.time,state.timeline);persistCore();}
    const liveScene=activeSceneAt(state.time), live=liveScene&&(liveScene.sceneId||liveScene.id);
    if (live !== state.liveSceneId) onSceneChange(live);
    renderStatus();
    renderMissed();
  }
  setInterval(() => { if (state.foreground && state.playing && (state.connected || state.mode === "COMPANION")) tick(); }, 250);

  async function loadWork(trackId) {
    // a sessão da TV autoriza o celular (inclusive em canais de parceiros)
    const q = new URLSearchParams({ session: state.code });
    if (trackId) q.set("track", trackId);
    state.work = await (await fetch(`/api/works/${state.workId}?${q}`)).json();
    // A Commerce Timeline é a publicação OFICIAL; trilhas da comunidade usam as próprias cenas.
    let rawTimeline=null;
    if(!state.work.track||state.work.track.type==='official'){try{const tr=await fetch(`/api/works/${state.workId}/commerce-timeline`);if(tr.ok)rawTimeline=await tr.json();}catch(e){}}
    state.timeline=hydrateTimeline(rawTimeline);
    if (state.work.partner) {
      document.documentElement.style.setProperty("--accent", state.work.partner.brand.color);
      document.documentElement.style.setProperty("--accent-2", state.work.partner.brand.color);
      $("brandName").textContent = state.work.partner.brand.label;
    }
  }

  function onSceneChange(id) {
    state.liveSceneId = id;
    if (navigator.vibrate && !state.viewSceneId) navigator.vibrate(30);
    if (state.viewSceneId) { renderScenes(); return; } // usuário está olhando outra cena: não atrapalha
    render();
  }

  function showJoin(msg) {
    $("join").hidden = false;
    if (msg) $("joinMsg").textContent = msg;
    const source = window.SceneShopAppCore ? window.SceneShopAppCore.resolveSharedSource(location) : new URLSearchParams(location.search).get("source");
    if (source && $("syncSourceUrl")) $("syncSourceUrl").value = source;
    const syncProvider = window.SceneShopCompanionSync && SceneShopCompanionSync.provider ? SceneShopCompanionSync.provider() : Promise.resolve("fingerprint");
    syncProvider.then((p) => { if ((p === "acrcloud" || p === "sceneshop") && $("syncState") && !$("syncState").textContent) $("syncState").textContent = `Toque e deixe o celular ouvir ${SceneShopCompanionSync.ACR_SECONDS} segundos do que está passando. O áudio só serve para identificar o conteúdo e não fica guardado.`; });
    if ($("syncNow")) $("syncNow").onclick = async () => {
      const btn=$("syncNow"),status=$("syncState"); btn.disabled=true;
      status.textContent=["acrcloud","sceneshop"].includes(await syncProvider)?`Ouvindo por ${SceneShopCompanionSync.ACR_SECONDS} segundos…`:"Ouvindo e reconhecendo o conteúdo…";
      try {
        const out=await SceneShopCompanionSync.synchronize({externalUrl:$("syncSourceUrl").value.trim()||null,seconds:5,onRetry:()=>{status.textContent=`Ainda não reconheci. Ouvindo mais ${SceneShopCompanionSync.ACR_SECONDS} segundos…`;}});
        status.textContent=`${out.work.title} reconhecido · ${Math.round(out.confidence*100)}%`;
        location.href=`/s/${out.session.code}?t=${Math.floor(out.position)}`;
      } catch(e) { status.textContent=e.message; btn.disabled=false; }
    };
    $("joinForm").onsubmit = (e) => {
      e.preventDefault();
      const c = $("joinCode").value.trim().toUpperCase();
      if (c.length === 6) location.href = `/s/${c}`;
    };
  }

  document.querySelectorAll(".tabs button").forEach((b) => (b.onclick = () => { state.tab = b.dataset.tab; renderList(); renderStatus(); }));
  $("backLive").onclick = () => {
    state.viewSceneId = null;
    if(state.core) state.core.goLive(state.timeline);
    persistCore();
    if (state.socket && state.connected) state.socket.emit("commerce:live", {});
    render();
  };
  if($("clearMissed")) $("clearMissed").onclick=()=>{if(state.core){state.core.clearMissed();persistCore();renderMissed();}};
  if ($("reSync")) $("reSync").onclick = async () => {
    if (state.mode !== "COMPANION" || !state.socket || !state.connected) return;
    const btn=$("reSync"); btn.disabled=true; const before=btn.textContent; btn.textContent="Sincronizando…";
    try {
      const out=await SceneShopCompanionSync.recognize({workId:state.workId,seconds:5});
      if(state.core){state.core.applySync({position:out.position,confidence:out.confidence});persistCore();renderStatus();}
      state.anchor={time:Number(out.position)||0,at:performance.now()}; state.playing=true; tick();
      state.socket.emit("sync:resync",{position:out.position,confidence:out.confidence,recognizedSyncId:out.work.syncId},(ack)=>{
        btn.disabled=false;btn.textContent=before; if(ack&&ack.error) notice(ack.error);
      });
    } catch(e){btn.disabled=false;btn.textContent=before;notice(e.message);}
  };

  if (!window.SceneShopAppBridge && "serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(()=>{});
  prepareNativeNotifications();
  start().catch((e) => showJoin("Não foi possível conectar. " + e.message));
})();
