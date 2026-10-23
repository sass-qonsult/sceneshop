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
  const Home = window.SceneShopHome;
  const params = new URLSearchParams(location.search);
  const go = (url) => location.replace(url); // sem voltar para o início pelo botão "voltar" do aparelho

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
    historyMode: false,   // aberto pelo histórico: sem TV/sessão ao vivo, mostra o que já passou
    awayPosition: null,   // posição quando o app foi para segundo plano
    lastHistoryWrite: 0,
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
    const commerce = raw.scenes.map((sc, i) => {
      const legacy = sourceScenes.find((s) => s.id === sc.sceneId) || sourceScenes.find((s) => Number(sc.start) >= Number(s.start) && Number(sc.start) < Number(s.end)) || null;
      return {
        ...sc, id: sc.sceneId || `commerce-${i+1}`, sceneId: sc.sceneId || `commerce-${i+1}`,
        title: legacy && legacy.title || `Cena comercial ${i+1}`, thumb: sc.thumbnail || legacy && legacy.thumb || null,
        products: (sc.products || []).map((cp) => {
          const rich = productMap.get(cp.productId);
          return rich ? { ...rich, productId: cp.productId || rich.id || null, placementId: cp.placementId, assetId: cp.assetId || null, policy: cp.policy || {} } : { id: cp.productId || cp.assetId, productId: cp.productId || null, name: cp.name || 'Produto', brand: cp.brand || '', category: cp.category || '', image: '/media/products/placeholder.svg', offers: [], placementId: cp.placementId, assetId: cp.assetId || null, policy: cp.policy || {} };
        }),
      };
    });
    // rcprep.17: as cenas SEM produtos também aparecem, para o celular acompanhar o vídeo sem saltos;
    // a Commerce Timeline só publica as cenas com produtos, então as demais vêm da trilha.
    const covered = (s) => commerce.some((c) => c.sceneId === s.id || (Number(s.start) < Number(c.end) && Number(s.end) > Number(c.start)));
    const plain = sourceScenes.filter((s) => !covered(s)).map((s) => ({ ...s, sceneId: s.id, thumb: s.thumb || null, products: [] }));
    const scenes = [...commerce, ...plain].sort((x, y) => Number(x.start || 0) - Number(y.start || 0));
    return { ...raw, scenes };
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
      b.className = "scene" + (isLive ? " is-live" : "") + (isSel ? " is-sel" : "") + ((s.products||[]).length ? "" : " is-empty");
      b.innerHTML = `<div class="thumb">${s.thumb?`<img src="${s.thumb}" alt=""/>`:'<span class="thumb-fallback">SHOP</span>'}${isLive && !state.historyMode ? '<span class="live">AO VIVO</span>' : ""}</div>
                     <div class="label">${i + 1}. ${esc(s.title)}</div>
                     <div class="count">${(s.products||[]).length === 1 ? "1 produto" : `${(s.products||[]).length} produtos`} · ${fmt(Number(s.start||0))}</div>`;
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
          ((s.products||[]).length ? (s.products||[]).map((p) => productCard(p, "", sid)).join("")
            : `<div class="empty scene-empty">Nenhum produto nesta cena.<br/><span>O celular segue o vídeo e mostra os produtos assim que eles aparecerem.</span></div>`);
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
    const away=state.missedReason==='away';
    $("missedTitle").textContent=away?"Enquanto você estava fora":"Enquanto você explorava";
    $("missedSub").textContent=away?"O vídeo continuou sincronizado; estas cenas com produtos passaram.":"O vídeo continuou; estas oportunidades passaram na Commerce Timeline.";
    host.innerHTML=rows.map((s)=>{const sid=s.sceneId||s.id;return `<button type="button" data-missed-scene="${esc(sid)}"><span>${s.thumb?`<img src="${s.thumb}" alt=""/>`:'<i>SHOP</i>'}</span><b>${esc(s.title||'Cena comercial')}</b><small>${fmt(Number(s.start||0))} · ${(s.products||[]).length} produtos</small></button>`;}).join('');
    host.querySelectorAll('[data-missed-scene]').forEach((b)=>b.onclick=()=>{const sc=timelineScenes().find((s)=>(s.sceneId||s.id)===b.dataset.missedScene);if(!sc)return;state.viewSceneId=b.dataset.missedScene;state.tab='scene';state.core.browse(sc);persistCore();if(state.socket&&state.connected)state.socket.emit('commerce:browse',{position:Number(sc.start||0),sceneId:state.viewSceneId});render();});
  }

  function renderStatus() {
    if (!state.work) return; // a obra ainda está carregando
    const playback=state.core?state.core.playbackPosition:state.time;
    $("progress").style.width = `${Math.min(100,(playback / state.work.duration) * 100)}%`;
    const browsing=state.core&&state.core.mode==='BROWSING';
    const txt = state.historyMode
      ? `Histórico · visto até ${fmt(playback)}`
      : state.connected
      ? browsing ? `Explorando ${fmt(state.core.browsePosition)} · vídeo ${fmt(playback)}` : `${state.playing ? "Ao vivo" : "Pausado"} · ${fmt(playback)}`
      : "Reconectando…";
    $("statusText").textContent = txt;
    $("status").className = "status" + (state.historyMode ? " is-history" : state.connected ? (state.playing ? " is-live" : " is-paused") : "");
    $("pinned").hidden = state.historyMode || !(state.core&&state.core.mode==='BROWSING') || state.tab !== "scene";
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
    if (!state.code || state.historyMode || state.resumeInFlight || !state.networkOnline) return;
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
        // cenas com produto que passaram enquanto o app estava em segundo plano
        if (state.awayPosition != null) {
          const from = state.awayPosition;
          const passed = timelineScenes().filter((s) => (s.products || []).length && Number(s.start || 0) > from && Number(s.start || 0) <= state.time).map((s) => s.sceneId || s.id);
          if (passed.length) { state.core.addMissed(passed); state.missedReason = "away"; }
        }
        persistCore();
      }
      state.awayPosition = null;
      if (state.socket && !state.socket.connected) state.socket.connect();
      const live = activeSceneAt(state.time), liveId = live && (live.sceneId || live.id);
      if (state.work && liveId !== state.liveSceneId) onSceneChange(liveId);
      renderStatus();
      renderMissed();
    } catch (e) {
      state.connected = false;
      renderStatus();
    } finally { state.resumeInFlight = false; }
  }

  function handleLifecycle(detail = {}) {
    const next = String(detail.state || "").toUpperCase();
    if (next === "BACKGROUND") { state.foreground = false; if (!state.historyMode && state.work && state.awayPosition == null) state.awayPosition = state.time; persistCore(); if (Home && state.workId && !state.historyMode) Home.history.touch(state.workId, state.time); return; }
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
    } else if (type === "SYNC_STOP_REQUESTED") {
      stopSync(true);
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

  // ------------------------------------------------------------ início da tela
  async function start() {
    if (params.get("h")) return startHistory(params.get("h"));
    if (params.has("stopped") && Home) {
      // o espectador fechou o app (Android) durante a sincronização: ela termina; o título fica no histórico
      const act = Home.active.get(); Home.active.clear(); if (act) markHistoryInactive(act.workId);
    }
    if (!state.code) {
      // sincronização em andamento (o sistema pode ter fechado o app em segundo plano): volta direto para ela
      const act = Home && Home.active.get();
      if (act && !params.has("home")) {
        const alive = await fetch(`/api/sessions/${act.code}?deviceId=${encodeURIComponent(state.deviceId)}`, { cache: "no-store" }).then((r) => r.ok).catch(() => false);
        if (alive) return go(`/s/${act.code}`);
        Home.active.clear();
        markHistoryInactive(act.workId);
      }
      return showJoin();
    }
    const sRes = await fetch(`/api/sessions/${state.code}?deviceId=${encodeURIComponent(state.deviceId)}`);
    if (!sRes.ok) {
      // sessão expirada: se ela está no histórico, abre o que já passou (sem precisar sincronizar de novo)
      const act = Home && Home.active.get();
      if (act && act.code === state.code) Home.active.clear();
      const past = Home && Home.history.list().find((e) => e.code === state.code);
      if (past) { markHistoryInactive(past.workId); return go(`/mobile?h=${encodeURIComponent(past.workId)}&expired=1`); }
      return showJoin("Esse código expirou. Gere um novo QR code na TV.");
    }
    const session = await sRes.json();
    // sincronizado pelo som: a posição do servidor (+ o tempo que passou) vale mais que o ?t= arredondado da URL
    if (session.mode === "COMPANION") state.time = companionNow(session);
    else if (!params.has("t")) state.time = session.time;

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
    beginActiveSync();

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
      persistCore(); render(); rememberWork();
    });
    socket.on("session:tv", ({ online }) => {
      if (!online) $("statusText").textContent = "TV desconectada";
    });
  }

  // ------------------------------------------------------------ sincronização ativa + histórico
  function thumbOf() {
    const sc = timelineScenes().find((s) => s.thumb) || null;
    return state.work && (state.work.poster || (sc && sc.thumb)) || null;
  }
  function rememberWork() {
    if (!Home || !state.work) return;
    const productCount = new Set(timelineScenes().flatMap((s) => (s.products || []).map((p) => p.id))).size;
    Home.history.record({ workId: state.work.id, title: state.work.title, thumb: thumbOf(), trackId: state.work.track && state.work.track.id || null,
      code: state.code || null, mode: state.mode || null, duration: Number(state.work.duration) || 0, position: state.historyMode ? 0 : state.time, productCount, active: !state.historyMode });
    Home.history.cache(state.work.id, { work: state.work, timeline: state.rawTimeline || null });
  }
  function markHistoryInactive(workId) {
    if (!Home || !workId) return;
    const e = Home.history.get(workId); if (e && e.active) Home.history.record({ workId, active: false });
  }
  function beginActiveSync() {
    if (!Home) return;
    Home.active.set({ code: state.code, workId: state.workId, title: state.work.title, mode: state.mode });
    rememberWork();
    $("stopSync").hidden = false; $("menuStop").hidden = false;
    // Android: serviço em primeiro plano com aviso "Sincronizado" (mantém o app vivo e tem o botão Parar)
    if (window.SceneShopAppBridge) window.SceneShopAppBridge.notify("SYNC_STARTED", { title: String(state.work.title || "").slice(0, 120), code: state.code });
  }
  function stopSync(goHome = true) {
    if (Home) { Home.active.clear(); if (state.workId) Home.history.record({ workId: state.workId, active: false, position: state.time }); }
    if (state.socket) { try { state.socket.disconnect(); } catch (e) {} }
    state.connected = false; state.playing = false;
    if (window.SceneShopAppBridge) window.SceneShopAppBridge.notify("SYNC_STOPPED", {});
    if (goHome) go("/mobile?home=1");
  }
  function historyTick() {
    if (!Home || !state.workId || state.historyMode) return;
    const now = Date.now(); if (now - state.lastHistoryWrite < 5000) return;
    state.lastHistoryWrite = now;
    Home.history.touch(state.workId, state.time);
    Home.active.beat();
  }

  // Aberto pelo histórico: a trilha do que já foi visto, sem sessão ao vivo (comprar depois sem sincronizar de novo)
  async function startHistory(workId) {
    const entry = Home && Home.history.get(workId);
    if (!entry) return showJoin("Esse título não está mais no histórico deste aparelho.");
    state.historyMode = true; document.body.classList.add("history-mode");
    state.workId = workId; state.code = entry.code || ""; state.mode = entry.mode || null;
    const cached = Home.history.cached(workId);
    try {
      const q = new URLSearchParams(); if (entry.code) q.set("session", entry.code); if (entry.trackId) q.set("track", entry.trackId);
      let r = await fetch(`/api/works/${encodeURIComponent(workId)}?${q}`);
      if (!r.ok && entry.trackId) r = await fetch(`/api/works/${encodeURIComponent(workId)}?track=${encodeURIComponent(entry.trackId)}`);
      if (!r.ok) throw new Error("offline");
      state.work = await r.json();
      let raw = null;
      if (!state.work.track || state.work.track.type === "official") { try { const tr = await fetch(`/api/works/${encodeURIComponent(workId)}/commerce-timeline`); if (tr.ok) raw = await tr.json(); } catch (e) {} }
      state.rawTimeline = raw; state.timeline = hydrateTimeline(raw);
    } catch (e) {
      if (!cached || !cached.work) return showJoin("Sem conexão e sem cópia guardada deste título.");
      state.work = cached.work; state.rawTimeline = cached.timeline || null; state.timeline = hydrateTimeline(state.rawTimeline);
      notice("Sem conexão: mostrando a cópia guardada no aparelho.");
    }
    applyPartner();
    $("workTitle").textContent = state.work.title;
    // tudo o que passou até o ponto em que o espectador parou (ou a obra inteira, se ele viu até o fim)
    state.time = Math.min(Number(state.work.duration) || Infinity, Math.max(Number(entry.position) || 0, 0));
    state.playing = false;
    state.core = new SceneShopMobileCore.CompanionState({ mode: "LIVE", playbackPosition: state.time });
    state.core.tick(state.time, state.timeline);
    const visible = state.core.visibleScenes(state.timeline, state.timeline && state.timeline.policy).filter((s) => (s.products || []).length);
    const last = visible[visible.length - 1] || timelineScenes().find((s) => (s.products || []).length) || null;
    state.liveSceneId = null;
    state.viewSceneId = last ? (last.sceneId || last.id) : null;
    $("stopSync").hidden = false; $("stopSync").textContent = "Fechar";
    rememberWork();
    render();
    if (params.has("expired")) notice("A sessão terminou. Os produtos do que você assistiu continuam aqui.");
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
    historyTick();
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
    state.rawTimeline=rawTimeline;
    state.timeline=hydrateTimeline(rawTimeline);
    applyPartner();
  }
  function applyPartner() {
    if (!state.work || !state.work.partner) return;
    document.body.style.setProperty("--accent", state.work.partner.brand.color);
    document.body.style.setProperty("--accent-2", state.work.partner.brand.color);
    $("brandName").textContent = state.work.partner.brand.label;
    $("brandName").hidden = false;
  }

  function onSceneChange(id) {
    state.liveSceneId = id;
    const sc = timelineScenes().find((x) => (x.sceneId || x.id) === id);
    if (navigator.vibrate && !state.viewSceneId && sc && (sc.products || []).length) navigator.vibrate(30);
    if (state.viewSceneId) { renderScenes(); return; } // usuário está olhando outra cena: não atrapalha
    render();
  }

  // ------------------------------------------------------------ início: botão grande, código, QR code, link, histórico
  const tr = (k, ...a) => (window.t ? window.t(k, ...a) : k.replace(/\{(\d+)#?\}/g, (_, i) => a[i]));
  const ago = (t) => { const m = Math.round((Date.now() - Number(t || 0)) / 60000); if (m < 1) return tr("agora"); if (m < 60) return tr("há {0} min", m); const h = Math.round(m / 60); if (h < 24) return tr("há {0} h", h); const d = Math.round(h / 24); return d === 1 ? tr("ontem") : tr("há {0} dias", d); };
  function renderHistory() {
    const box = $("historyBox"), host = $("historyList"); if (!box || !Home) return;
    const list = Home.history.list();
    const act = Home.active.get();
    box.hidden = !list.length;
    host.innerHTML = list.map((e) => {
      const live = act && act.workId === e.workId;
      const seen = e.duration ? tr("visto até {0}", fmt(Math.min(e.position || 0, e.duration))) : "";
      return `<button type="button" class="history-item" data-history="${esc(e.workId)}">
        <span class="h-thumb">${e.thumb ? `<img src="${esc(e.thumb)}" alt=""/>` : '<img class="h-mark" src="/media/brand/sceneshop-mark-white.svg" alt=""/>'}</span>
        <span class="h-body"><b data-no-i18n>${esc(e.title || "Título")}</b><small data-no-i18n>${esc([e.productCount ? tr("{0} produtos", e.productCount) : "", seen, ago(e.lastAt)].filter(Boolean).join(" · "))}</small></span>
        ${live ? '<span class="h-live">AO VIVO</span>' : ""}
      </button>`;
    }).join("");
    host.querySelectorAll("[data-history]").forEach((b) => (b.onclick = () => {
      const id = b.dataset.history;
      const a = Home.active.get();
      if (a && a.workId === id) { if (state.code === a.code && !state.historyMode) return hideJoin(); return go(`/s/${a.code}`); }
      go(`/mobile?h=${encodeURIComponent(id)}`);
    }));
  }
  function renderActiveCard() {
    const card = $("activeCard"); if (!card || !Home) return;
    const a = Home.active.get();
    card.hidden = !a;
    if (!a) return;
    $("activeTitle").textContent = a.title || "";
    card.onclick = () => { if (state.code === a.code && !state.historyMode && state.work) hideJoin(); else go(`/s/${a.code}`); };
  }
  function hideJoin() { $("join").hidden = true; }
  function toggleOption(which) {
    const panels = { code: $("joinForm"), link: $("linkBox") };
    Object.entries(panels).forEach(([k, el]) => { el.hidden = k !== which || !el.hidden; });
    $("optCode").classList.toggle("is-on", !panels.code.hidden);
    $("optLink").classList.toggle("is-on", !panels.link.hidden);
    if (!panels.code.hidden) $("joinCode").focus();
    if (!panels.link.hidden) $("syncSourceUrl").focus();
  }
  function showJoin(msg) {
    $("join").hidden = false;
    if (msg) $("joinMsg").textContent = msg;
    renderActiveCard();
    renderHistory();
    const source = window.SceneShopAppCore ? window.SceneShopAppCore.resolveSharedSource(location) : params.get("source");
    if (source && $("syncSourceUrl")) { $("syncSourceUrl").value = source; $("linkBox").hidden = false; $("optLink").classList.add("is-on"); }
    const syncProvider = window.SceneShopCompanionSync && SceneShopCompanionSync.provider ? SceneShopCompanionSync.provider() : Promise.resolve("fingerprint");
    syncProvider.then((p) => { if ((p === "acrcloud" || p === "sceneshop") && $("syncState") && !$("syncState").textContent) $("syncState").textContent = `Toque e deixe o celular ouvir ${SceneShopCompanionSync.ACR_SECONDS} segundos do que está passando. O áudio só serve para identificar o conteúdo e não fica guardado.`; });
    if ($("syncNow")) $("syncNow").onclick = async () => {
      const btn=$("syncNow"),status=$("syncState"); btn.disabled=true; btn.classList.add("is-listening");
      status.textContent=["acrcloud","sceneshop"].includes(await syncProvider)?`Ouvindo por ${SceneShopCompanionSync.ACR_SECONDS} segundos…`:"Ouvindo e reconhecendo o conteúdo…";
      try {
        const out=await SceneShopCompanionSync.synchronize({externalUrl:$("syncSourceUrl").value.trim()||null,seconds:5,onRetry:()=>{status.textContent=`Ainda não reconheci. Ouvindo mais ${SceneShopCompanionSync.ACR_SECONDS} segundos…`;}});
        status.textContent=`${out.work.title} reconhecido · ${Math.round(out.confidence*100)}%`;
        // uma sincronização por vez: a anterior vai para o histórico
        if (state.socket && state.code && state.code !== out.session.code) stopSync(false);
        go(`/s/${out.session.code}?t=${Math.floor(out.position)}`);
      } catch(e) { status.textContent=e.message; btn.disabled=false; btn.classList.remove("is-listening"); }
    };
    $("optCode").onclick = () => toggleOption("code");
    $("optLink").onclick = () => toggleOption("link");
    $("optQr").onclick = async () => {
      // APK Android: leitor nativo do Google (não depende da câmera dentro do WebView); senão, a câmera pela página
      if (window.SceneShopNative && window.SceneShopAppBridge) {
        try {
          const r = await window.SceneShopAppBridge.request("SCAN_QR", {}, 180000);
          const code = Home.codeFrom(r && r.text);
          if (!code) { $("syncState").textContent = "Esse QR code não é de uma tela SceneShop."; return; }
          if (navigator.vibrate) navigator.vibrate(40);
          $("syncState").textContent = `Código ${code} lido. Conectando…`;
          return go(`/s/${code}`);
        } catch (e) {
          if (/QR_CANCELLED/.test(String(e && e.message))) return;
          // leitor nativo indisponível (app antigo ou sem Google Play services): usa a câmera pela página
        }
      }
      try {
        const out = await Home.scanQr({ view: $("qrView"), video: $("qrVideo"), message: $("qrMsg") });
        if (navigator.vibrate) navigator.vibrate(40);
        $("syncState").textContent = `Código ${out.code} lido. Conectando…`;
        go(`/s/${out.code}`);
      } catch (e) { if (!e.cancelled) $("syncState").textContent = e.message; }
    };
    $("joinForm").onsubmit = (e) => {
      e.preventDefault();
      const raw = $("joinCode").value.trim();
      const c = (Home && Home.codeFrom(raw)) || raw.toUpperCase();
      if (c.length >= 4) go(`/s/${c}`);
      else $("syncState").textContent = "Digite o código que aparece na TV.";
    };
    $("historyClear").onclick = () => { if (!confirm(window.t ? window.t("Limpar o histórico deste aparelho?") : "Limpar o histórico deste aparelho?")) return; const a = Home.active.get(); Home.history.clear(); if (a) rememberWork(); renderHistory(); };
  }

  // ------------------------------------------------------------ menu (o que ficava solto no topo)
  const menu = $("menu");
  const openMenu = () => { menu.hidden = false; $("menuStop").hidden = !(Home && Home.active.get()); };
  const closeMenu = () => { menu.hidden = true; };
  $("menuBtn").onclick = openMenu;
  $("homeMenuBtn").onclick = openMenu;
  $("menuClose").onclick = closeMenu;
  menu.addEventListener("click", (e) => { if (e.target === menu) closeMenu(); });
  $("menuHome").onclick = () => { closeMenu(); showJoin(); };
  $("menuStop").onclick = () => { closeMenu(); if (state.code && !state.historyMode) stopSync(true); else { const a = Home && Home.active.get(); if (Home) Home.active.clear(); if (a) markHistoryInactive(a.workId); if (window.SceneShopAppBridge) window.SceneShopAppBridge.notify("SYNC_STOPPED", {}); renderActiveCard(); renderHistory(); } };
  $("homeBtn").onclick = () => showJoin();
  $("stopSync").onclick = () => { if (state.historyMode) return go("/mobile?home=1"); stopSync(true); };
  $("qrClose").onclick = () => Home && Home.stopScan();
  if (window.SceneShopAppBridge && window.SceneShopAppBridge.notify && (window.SceneShopNative || (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.sceneshop))) document.body.classList.add("native-app");

  document.querySelectorAll(".tabs button").forEach((b) => (b.onclick = () => { state.tab = b.dataset.tab; renderList(); renderStatus(); }));
  $("backLive").onclick = () => {
    state.viewSceneId = null;
    if(state.core) state.core.goLive(state.timeline);
    persistCore();
    if (state.socket && state.connected) state.socket.emit("commerce:live", {});
    render();
  };
  if($("clearMissed")) $("clearMissed").onclick=()=>{if(state.core){state.core.clearMissed();state.missedReason=null;persistCore();renderMissed();}};
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
