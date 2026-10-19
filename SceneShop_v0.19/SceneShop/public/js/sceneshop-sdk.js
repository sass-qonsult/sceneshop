/**
 * SceneShop SDK — vai "dentro" do player de vídeo.
 *
 *   SceneShop.attach(document.querySelector("video"), { workId: "demo-01" });
 *
 * - Lê a trilha invisível (WebVTT kind="metadata") para saber a cena atual.
 * - Tecla P / botão vermelho do controle: abre a lista de produtos da cena.
 * - Tecla Q / botão verde do controle: gera o QR code para o celular.
 * - Tecla T / botão amarelo: troca a trilha (oficial ou da comunidade).
 * - Teclas [ e ]: ajuste de sincronia de ±0,5 s, como em legendas.
 * - Envia o tempo do vídeo ao servidor para os celulares acompanharem.
 *
 * Parceiros (emissoras, agências) embutem com a própria chave e o player assume a marca deles:
 *   SceneShop.attach(video, { workId: "demo-01", partnerKey: "pk_aurora_demo" });
 *
 * Não depende de framework: roda em navegador, Tizen (Samsung) e webOS (LG).
 */
(function (global) {
  "use strict";

  const KEYS = {
    products: ["p", "P", 403 /* vermelho */],
    phone: ["q", "Q", 404 /* verde */],
    track: ["t", "T", 405 /* amarelo */],
    syncMinus: ["["],
    syncPlus: ["]"],
    close: ["Escape", "Backspace", 10009 /* voltar Tizen */, 461 /* voltar webOS */],
    play: [" ", "MediaPlayPause", 415, 19],
  };
  const matches = (list, e) => list.includes(e.key) || list.includes(e.keyCode);

  const brl = (v) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  const fmt = (s) => {
    s = Math.max(0, Math.floor(s));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  };
  const el = (tag, cls, html) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  };
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const ICON = {
    bag: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 7h12l1 13H5L6 7z"/><path d="M9 7a3 3 0 0 1 6 0"/></svg>',
    phone: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="7" y="2" width="10" height="20" rx="2"/><path d="M11 18h2"/></svg>',
    play: '<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>',
    pause: '<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M7 5h4v14H7zM13 5h4v14h-4z"/></svg>',
    close: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    check: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5 9-10"/></svg>',
  };

  class SceneShopPlayer {
    constructor(video, opts) {
      this.video = video;
      this.opts = Object.assign({ apiBase: "", tickMs: 1000 }, opts);
      this.work = null;
      this.scene = null;
      this.viewSceneId = null; // cena escolhida manualmente na aba "Todas as cenas"
      this.session = null;
      this.socket = null;
      this.panelOpen = false;
      this.tab = "now";
      this.userOffset = 0; // ajuste de sincronia do espectador (s)
      this.deviceId = SceneShopPlayer.deviceId();
    }

    static deviceId() {
      let id = null;
      try { id = localStorage.getItem("ss-device"); } catch (e) {}
      if (!/^[A-Za-z0-9_-]{8,64}$/.test(id || "")) {
        id = "t" + Array.from({ length: 24 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
        try { localStorage.setItem("ss-device", id); } catch (e) {}
      }
      return id;
    }

    // Link rastreado: identifica aparelho e sessão para atribuir a comissão
    trackedUrl(url) {
      return `${this.opts.apiBase}${url}&d=${this.deviceId}${this.session ? "&sess=" + this.session.code : ""}${this.partner ? "&pa=" + this.partner.id : ""}`;
    }

    // Eventos de audiência para o painel do piloto (não bloqueiam nada se falharem)
    emit(type) {
      if (!this.work) return;
      try {
        fetch(`${this.opts.apiBase}/api/events`, {
          method: "POST", headers: { "Content-Type": "application/json" }, keepalive: true,
          body: JSON.stringify({ type, workId: this.work.id, trackId: this.work.track.id, sceneId: this.scene && this.scene.id, deviceId: this.deviceId, partnerId: this.partner && this.partner.id }),
        }).catch(() => {});
      } catch (e) {}
    }

    headers(extra) {
      return Object.assign(this.opts.partnerKey ? { "X-SceneShop-Key": this.opts.partnerKey } : {}, extra || {});
    }

    // Marca do parceiro: cor e nome no painel
    applyBrand() {
      if (!this.partner || !this.ui) return;
      const c = this.partner.brand.color;
      this.ui.root.style.setProperty("--ss-accent", c);
      this.ui.root.style.setProperty("--ss-accent-2", c);
      this.ui.root.classList.add("is-branded");
      this.ui.root.querySelector(".ss-eyebrow").textContent = this.partner.brand.label;
    }

    async init() {
      await this.loadWork(this.opts.trackId);
      this.buildUI();
      this.applyBrand();
      this.buildMarkers();
      this.attachTrack();
      this.bindKeys();
      this.video.addEventListener("timeupdate", () => { this.onTime(); this.compatBadge(); });
      this.video.addEventListener("play", () => { this.syncPlayState(); if (!this._viewed) { this._viewed = true; this.emit("view_start"); } });
      this.video.addEventListener("pause", () => this.syncPlayState());
      this.video.addEventListener("seeked", () => this.sendTick()); // celular acompanha o pulo na hora
      this.video.addEventListener("loadedmetadata", () => this.layoutHotspots());
      window.addEventListener("resize", () => this.layoutHotspots());
      this.onTime();
      return this;
    }

    async loadWork(trackId) {
      const q = trackId ? `?track=${encodeURIComponent(trackId)}` : "";
      const r = await fetch(`${this.opts.apiBase}/api/works/${this.opts.workId}${q}`, { headers: this.headers() });
      this.work = await r.json();
      if (!r.ok) throw new Error(this.work.error || "Não foi possível carregar a obra");
      this.partner = this.work.partner || null;
    }

    // Troca de trilha (oficial / comunidade), como escolher outra legenda
    async switchTrack(trackId) {
      await this.loadWork(trackId);
      this.scene = null;
      this.viewSceneId = null;
      this.attachTrack();
      this.buildMarkers();
      this.onTime();
      if (this.panelOpen) this.renderPanel();
      if (this.socket) this.socket.emit("tv:track", { trackId: this.work.track.id });
      const t = this.work.track;
      this.toast(`${ICON.bag}<span>Trilha: ${t.type === "official" ? "Oficial" : "Comunidade · " + esc(t.author.name)}</span>`);
    }

    // ---------------------------------------------------------- trilha invisível
    attachTrack() {
      if (this._trackEl) this._trackEl.remove();
      const track = document.createElement("track");
      this._trackEl = track;
      track.kind = "metadata";
      track.src = `${this.opts.apiBase}${this.work.trackVtt}`;
      track.default = true;
      this.video.appendChild(track);
      track.track.mode = "hidden"; // carregada, mas nunca exibida
      track.addEventListener("cuechange", () => {
        const cue = track.track.activeCues && track.track.activeCues[0];
        if (!cue || this.userOffset) return; // com ajuste de sincronia, vale o cálculo abaixo
        try {
          const data = JSON.parse(cue.text);
          if (this.work.scenes.some((s) => s.id === data.scene)) this.setScene(data.scene);
        } catch (e) { /* cue inválido: ignora */ }
      });
    }

    // Plano B (e fonte para o scrubber): calcula a cena pelo tempo
    // t = tempo do vídeo; aplica o deslocamento da trilha e o ajuste do espectador
    sceneAt(t) {
      const sc = this.work.scenes, off = this.work.track.offset + this.userOffset;
      const hit = sc.find((s) => t >= s.start + off && t < s.end + off);
      if (hit) return hit;
      return t < sc[0].start + off ? sc[0] : [...sc].reverse().find((s) => t >= s.end + off) || sc[sc.length - 1];
    }

    onTime() {
      const t = this.video.currentTime || 0;
      this.setScene(this.sceneAt(t).id);
      const d = this.video.duration || this.work.duration;
      this.ui.progress.style.width = `${(t / d) * 100}%`;
      this.ui.time.textContent = `${fmt(t)} / ${fmt(d)}`;
    }

    setScene(id) {
      if (this.scene && this.scene.id === id) return;
      this.scene = this.work.scenes.find((s) => s.id === id);
      this.ui.sceneName.textContent = this.scene.title;
      this.ui.root.querySelectorAll(".ss-marker").forEach((m) => m.classList.toggle("is-now", m.dataset.id === id));
      if (this.panelOpen) this.renderPanel();
      this.flashHint();
    }

    // Selo "SceneShop compatible" nos primeiros segundos (como Dolby Atmos / CC): avisa que a obra tem compras na cena.
    compatBadge() {
      const img = this.ui && this.ui.root && this.ui.root.querySelector(".ss-compat");
      if (!img || this.opts.compatBadge === false) return;
      const t = this.video.currentTime || 0;
      img.classList.toggle("is-on", !this.video.paused && t >= 0.3 && t < 4.5);
    }

    // ---------------------------------------------------------- interface
    buildUI() {
      const wrap = this.video.parentElement;
      wrap.classList.add("ss-stage");
      const root = el("div", "ss-root");
      root.innerHTML = `
        <div class="ss-hint" aria-hidden="true">${ICON.bag}<span>Produtos nesta cena</span><kbd>P</kbd></div>
        <div class="ss-hotspots"></div>
        <aside class="ss-panel" role="dialog" aria-label="Produtos da cena" aria-hidden="true">
          <header class="ss-panel-head">
            <div>
              <div class="ss-eyebrow">Nesta cena</div>
              <div class="ss-scene-name"></div>
            </div>
            <button class="ss-icon-btn ss-close" aria-label="Fechar">${ICON.close}</button>
          </header>
          <div class="ss-trackbar"></div>
          <div class="ss-tracklist" hidden></div>
          <div class="ss-tabs" role="tablist">
            <button role="tab" data-tab="now" class="is-on">Cena atual</button>
            <button role="tab" data-tab="all">Todas as cenas</button>
          </div>
          <div class="ss-strip" hidden></div>
          <div class="ss-list"></div>
          <button class="ss-phone-cta">${ICON.phone}<span>Ver no celular e liberar a tela</span><kbd>Q</kbd></button>
        </aside>
        <div class="ss-qr" hidden>
          <div class="ss-qr-card">
            <button class="ss-icon-btn ss-qr-close" aria-label="Fechar">${ICON.close}</button>
            <div class="ss-qr-body">
              <img class="ss-qr-img" alt="QR code da sessão"/>
              <div class="ss-qr-text">
                <h2>Continue no celular</h2>
                <p>Aponte a câmera para o código. A lista abre exatamente na cena <b class="ss-qr-scene"></b> e acompanha o programa em tempo real.</p>
                <div class="ss-code-label">Ou digite o código</div>
                <div class="ss-code"></div>
                <a class="ss-qr-link" target="_blank" rel="noopener">abrir link</a>
              </div>
            </div>
            <div class="ss-qr-done" hidden>${ICON.check}<span>Celular conectado</span></div>
          </div>
        </div>
        <div class="ss-toast" hidden></div>
        <img class="ss-compat" alt="SceneShop compatible" src="${this.opts.apiBase}/media/brand/sceneshop-compatible.png" draggable="false"/>
        <div class="ss-controls">
          <button class="ss-icon-btn ss-play" aria-label="Reproduzir">${ICON.play}</button>
          <div class="ss-scrub"><div class="ss-scrub-bar"><div class="ss-progress"></div></div><div class="ss-markers"></div></div>
          <span class="ss-time">0:00</span>
          <span class="ss-linked" hidden>${ICON.phone}<b>0</b></span>
          <button class="ss-btn ss-open-products">${ICON.bag}<span>Produtos</span></button>
          <button class="ss-btn ss-open-qr">${ICON.phone}<span>Celular</span></button>
        </div>`;
      wrap.appendChild(root);

      const $ = (s) => root.querySelector(s);
      this.ui = {
        root, hint: $(".ss-hint"), panel: $(".ss-panel"), list: $(".ss-list"), strip: $(".ss-strip"),
        sceneName: $(".ss-scene-name"), hotspots: $(".ss-hotspots"), qr: $(".ss-qr"), toast: $(".ss-toast"),
        progress: $(".ss-progress"), time: $(".ss-time"), play: $(".ss-play"), linked: $(".ss-linked"),
        trackbar: $(".ss-trackbar"), tracklist: $(".ss-tracklist"),
      };

      $(".ss-scrub-bar").onclick = (e) => {
        const r = e.currentTarget.getBoundingClientRect();
        this.video.currentTime = ((e.clientX - r.left) / r.width) * (this.video.duration || this.work.duration);
      };
      this.ui.play.onclick = () => (this.video.paused ? this.video.play() : this.video.pause());
      this.video.onclick = () => (this.video.paused ? this.video.play() : this.video.pause());
      $(".ss-open-products").onclick = () => this.togglePanel();
      $(".ss-close").onclick = () => this.togglePanel(false);
      $(".ss-open-qr").onclick = () => this.openQR();
      $(".ss-phone-cta").onclick = () => this.openQR();
      $(".ss-qr-close").onclick = () => this.closeQR();
      root.querySelectorAll(".ss-tabs button").forEach((b) => (b.onclick = () => this.setTab(b.dataset.tab)));
    }

    // marcadores de cena no scrubber (dependem da trilha escolhida)
    buildMarkers() {
      const markers = this.ui.root.querySelector(".ss-markers");
      markers.innerHTML = "";
      const off = this.work.track.offset + this.userOffset;
      this.work.scenes.forEach((s) => {
        const m = el("button", "ss-marker");
        m.dataset.id = s.id;
        m.style.left = `${(Math.max(0, s.start + off) / this.work.duration) * 100}%`;
        m.style.width = `${((s.end - s.start) / this.work.duration) * 100}%`;
        m.title = s.title;
        m.onclick = () => { this.video.currentTime = Math.max(0, s.start + off) + 0.05; };
        markers.appendChild(m);
      });
    }

    trackBadge(t) {
      const official = t.type === "official";
      return `<span class="ss-seal ${official ? "is-official" : "is-community"}">${official ? "Oficial" : "Comunidade"}</span>
        <span class="ss-track-author">${esc(t.author.name)}</span>
        ${t.approval != null ? `<span class="ss-track-rate">${t.approval}% aprovam</span>` : ""}
        ${t.status === "em_revisao" ? '<span class="ss-track-warn">em revisão</span>' : ""}`;
    }

    renderTrackBar() {
      const t = this.work.track, n = this.work.tracks.length;
      this.ui.trackbar.innerHTML = `<div class="ss-track-info">${this.trackBadge(t)}</div>
        ${n > 1 ? `<button class="ss-track-switch" aria-expanded="${!this.ui.tracklist.hidden}">Trilhas (${n}) <kbd>T</kbd></button>` : ""}`;
      const b = this.ui.trackbar.querySelector(".ss-track-switch");
      if (b) b.onclick = () => { this.ui.tracklist.hidden = !this.ui.tracklist.hidden; this.renderTrackBar(); };
      this.ui.tracklist.innerHTML = this.work.tracks.map((x) => `
        <button class="ss-track-opt${x.id === t.id ? " is-sel" : ""}" data-id="${x.id}">
          <div class="ss-track-info">${this.trackBadge(x)}</div>
          <div class="ss-track-meta">${x.scenes} cenas · ${x.products} produtos${x.reports ? ` · ${x.reports} denúncias` : ""}</div>
        </button>`).join("");
      this.ui.tracklist.querySelectorAll(".ss-track-opt").forEach((o) => (o.onclick = () => {
        this.ui.tracklist.hidden = true;
        if (o.dataset.id !== t.id) this.switchTrack(o.dataset.id); else this.renderTrackBar();
      }));
    }

    cycleTrack() {
      const list = this.work.tracks, i = list.findIndex((x) => x.id === this.work.track.id);
      if (list.length > 1) this.switchTrack(list[(i + 1) % list.length].id);
    }

    nudgeSync(delta) {
      this.userOffset = Math.round((this.userOffset + delta) * 10) / 10;
      this.buildMarkers();
      this.scene = null;
      this.onTime();
      const v = this.userOffset.toFixed(1).replace(".", ",");
      this.toast(`<span>Sincronia da trilha: ${this.userOffset > 0 ? "+" : ""}${v} s</span>`);
      this.sendTick();
    }

    setTab(tab) {
      this.tab = tab;
      if (tab === "now") this.viewSceneId = null;
      this.ui.root.querySelectorAll(".ss-tabs button").forEach((b) => b.classList.toggle("is-on", b.dataset.tab === tab));
      this.ui.strip.hidden = tab !== "all";
      this.renderPanel();
    }

    togglePanel(force) {
      this.panelOpen = force != null ? force : !this.panelOpen;
      this.ui.panel.classList.toggle("is-open", this.panelOpen);
      this.ui.panel.setAttribute("aria-hidden", String(!this.panelOpen));
      this.ui.root.classList.toggle("has-panel", this.panelOpen);
      if (this.panelOpen) {
        this.emit("panel_open");
        this.renderPanel();
        setTimeout(() => { const f = this.ui.list.querySelector(".ss-card"); f && f.focus(); }, 50);
      } else {
        this.ui.hotspots.innerHTML = "";
      }
    }

    renderPanel() {
      this.renderTrackBar();
      const shown = (this.viewSceneId && this.work.scenes.find((s) => s.id === this.viewSceneId)) || this.scene;
      const live = shown.id === this.scene.id;
      this.ui.sceneName.innerHTML = `${esc(shown.title)} ${live ? '<span class="ss-live">AO VIVO</span>' : ""}`;

      if (this.tab === "all") {
        this.ui.strip.innerHTML = "";
        this.work.scenes.forEach((s, i) => {
          const b = el("button", "ss-thumb" + (s.id === shown.id ? " is-sel" : "") + (s.id === this.scene.id ? " is-now" : ""));
          b.innerHTML = `<img src="${this.opts.apiBase}${s.thumb}" alt=""/><span>${i + 1}. ${esc(s.title)}</span>`;
          b.onclick = () => { this.viewSceneId = s.id; this.renderPanel(); };
          this.ui.strip.appendChild(b);
        });
      }

      this.ui.list.innerHTML = "";
      shown.products.forEach((p) => {
        const best = p.offers.find((o) => o.inStock) || p.offers[0];
        const card = el("button", "ss-card");
        card.dataset.id = p.id;
        card.innerHTML = `
          <img src="${this.opts.apiBase}${p.image}" alt=""/>
          <div class="ss-card-info">
            <div class="ss-card-brand">${esc(p.brand)}</div>
            <div class="ss-card-name">${esc(p.name)}${p.match === "parecido" ? ' <span class="ss-similar">parecido</span>' : ""}</div>
            <div class="ss-card-price">${brl(best.price)} <span class="ss-store" style="--c:${best.color}">${esc(best.storeName)}</span></div>
            ${best.official ? `<div class="ss-guaranteed">${esc(best.label)}</div>` : ""}
            <div class="ss-card-more">+${p.offers.length - 1} lojas</div>
          </div>`;
        card.onmouseenter = card.onfocus = () => this.highlight(p.id);
        card.onmouseleave = card.onblur = () => this.highlight(null);
        card.onclick = () => window.open(this.trackedUrl(best.url), "_blank", "noopener");
        this.ui.list.appendChild(card);
      });
      this.renderHotspots(live ? shown : null);
    }

    // Caixas sobre a imagem mostrando onde cada produto aparece
    renderHotspots(scene) {
      this.ui.hotspots.innerHTML = "";
      if (!scene) return;
      scene.products.filter((p) => p.box).forEach((p) => {
        const h = el("div", "ss-hot");
        h.dataset.id = p.id;
        Object.assign(h.style, { left: `${p.box.x}%`, top: `${p.box.y}%`, width: `${p.box.w}%`, height: `${p.box.h}%` });
        this.ui.hotspots.appendChild(h);
      });
      this.layoutHotspots();
    }

    // Ajusta a camada de hotspots à área real da imagem (descontando tarjas pretas)
    layoutHotspots() {
      const v = this.video;
      const vw = v.videoWidth || 1280, vh = v.videoHeight || 720;
      const bw = v.clientWidth, bh = v.clientHeight;
      const scale = Math.min(bw / vw, bh / vh);
      const w = vw * scale, h = vh * scale;
      Object.assign(this.ui.hotspots.style, {
        width: `${w}px`, height: `${h}px`, left: `${(bw - w) / 2}px`, top: `${(bh - h) / 2}px`,
      });
    }

    highlight(id) {
      this.ui.hotspots.querySelectorAll(".ss-hot").forEach((h) => h.classList.toggle("is-on", h.dataset.id === id));
    }

    flashHint() {
      if (this.panelOpen) return;
      this.ui.hint.classList.add("is-on");
      clearTimeout(this._hintT);
      this._hintT = setTimeout(() => this.ui.hint.classList.remove("is-on"), 3500);
    }

    toast(msg) {
      this.ui.toast.innerHTML = msg;
      this.ui.toast.hidden = false;
      clearTimeout(this._toastT);
      this._toastT = setTimeout(() => (this.ui.toast.hidden = true), 3500);
    }

    syncPlayState() {
      this.ui.play.innerHTML = this.video.paused ? ICON.play : ICON.pause;
      this.ui.play.setAttribute("aria-label", this.video.paused ? "Reproduzir" : "Pausar");
      this.sendTick();
    }

    // ---------------------------------------------------------- segunda tela
    async openQR() {
      const res = await fetch(`${this.opts.apiBase}/api/sessions`, {
        method: "POST",
        headers: this.headers({ "Content-Type": "application/json" }),
        body: JSON.stringify({ workId: this.work.id, trackId: this.work.track.id, time: this.video.currentTime - this.userOffset }),
      });
      const s = await res.json();
      this.session = s;
      this.emit("qr_open");
      const q = this.ui.qr;
      q.querySelector(".ss-qr-img").src = s.qr;
      q.querySelector(".ss-code").textContent = s.code;
      q.querySelector(".ss-qr-scene").textContent = this.scene.title;
      const link = q.querySelector(".ss-qr-link");
      link.href = s.url;
      link.textContent = s.url.replace(/^https?:\/\//, "");
      q.querySelector(".ss-qr-body").hidden = false;
      q.querySelector(".ss-qr-done").hidden = true;
      q.hidden = false;
      this.connect(s.code, s.controllerToken);
    }

    closeQR() { this.ui.qr.hidden = true; }

    connect(code, controllerToken) {
      if (!global.io) return console.warn("socket.io não carregado");
      if (this.socket) this.socket.disconnect();
      this.socket = global.io(this.opts.apiBase || undefined);
      this.socket.on("connect", () => {
        this.socket.emit("tv:attach", { code, controllerToken }, (r) => {
          if (r && r.ok) this.sendTick();
        });
      });
      this.socket.on("session:phones", ({ phones }) => {
        const was = Number(this.ui.linked.querySelector("b").textContent);
        this.ui.linked.hidden = phones === 0;
        this.ui.linked.querySelector("b").textContent = phones;
        if (phones > was) this.onPhoneJoined();
      });
      clearInterval(this._tick);
      this._tick = setInterval(() => this.sendTick(), this.opts.tickMs);
    }

    onPhoneJoined() {
      if (!this.ui.qr.hidden) {
        this.ui.qr.querySelector(".ss-qr-body").hidden = true;
        this.ui.qr.querySelector(".ss-qr-done").hidden = false;
        setTimeout(() => this.closeQR(), 1400);
      } else {
        this.toast(`${ICON.phone}<span>Celular conectado</span>`);
      }
      this.togglePanel(false); // tela livre: a lista agora está no celular
    }

    sendTick() {
      if (this.socket && this.socket.connected) {
        // envia o tempo "da trilha": o celular não precisa saber do ajuste de sincronia
        this.socket.emit("player:tick", { time: this.video.currentTime - this.userOffset, playing: !this.video.paused });
      }
    }

    // ---------------------------------------------------------- controle remoto / teclado
    bindKeys() {
      document.addEventListener("keydown", (e) => {
        if (matches(KEYS.products, e)) { e.preventDefault(); this.togglePanel(); }
        else if (matches(KEYS.phone, e)) { e.preventDefault(); this.openQR(); }
        else if (matches(KEYS.track, e)) { e.preventDefault(); this.cycleTrack(); }
        else if (matches(KEYS.syncMinus, e)) { e.preventDefault(); this.nudgeSync(-0.5); }
        else if (matches(KEYS.syncPlus, e)) { e.preventDefault(); this.nudgeSync(0.5); }
        else if (matches(KEYS.close, e)) {
          if (!this.ui.qr.hidden) { e.preventDefault(); this.closeQR(); }
          else if (this.panelOpen) { e.preventDefault(); this.togglePanel(false); }
        } else if (matches(KEYS.play, e) && !this.panelOpen) {
          e.preventDefault();
          this.video.paused ? this.video.play() : this.video.pause();
        } else if (this.panelOpen && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
          const items = [...this.ui.panel.querySelectorAll(".ss-card, .ss-phone-cta")];
          const i = items.indexOf(document.activeElement);
          const next = items[Math.max(0, Math.min(items.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)))];
          if (next) { e.preventDefault(); next.focus(); }
        }
      });
    }
  }

  global.SceneShop = {
    attach: (video, opts) => new SceneShopPlayer(video, opts).init(),
  };
})(window);
