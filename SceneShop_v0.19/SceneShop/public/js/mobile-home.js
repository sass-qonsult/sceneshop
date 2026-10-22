/**
 * App do celular — início, histórico, sincronização ativa, menu e leitor de QR code (rcprep.16).
 *
 * - Histórico (por aparelho, no armazenamento local): cada obra sincronizada fica guardada com a
 *   posição até onde foi vista, o código da sessão e uma cópia da trilha (cenas + produtos), para
 *   o espectador voltar e comprar depois sem sincronizar de novo — mesmo sem internet na hora.
 * - Sincronização ativa: o celular continua sincronizado até o espectador tocar em "Parar". Se o
 *   sistema fechar o app em segundo plano, ao abrir de novo ele volta direto para a mesma sessão.
 * - QR code: câmera traseira com BarcodeDetector (nativo do Android/Chrome) e jsQR como reserva.
 */
(function (root) {
  "use strict";
  const HKEY = "ss-history";
  const AKEY = "ss-active";
  const CKEY = (id) => `ss-hist-work:${id}`;
  const MAX_HISTORY = 30;
  const MAX_CACHED = 12;
  const ACTIVE_MAX_AGE_MS = 12 * 3600e3; // sessão da TV expira em até 4 h sem uso; 12 h é o teto local

  const read = (k, fallback) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fallback; } catch (e) { return fallback; } };
  const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } };
  const drop = (k) => { try { localStorage.removeItem(k); } catch (e) {} };

  // ------------------------------------------------------------------ histórico
  const history = {
    list() { const l = read(HKEY, []); return Array.isArray(l) ? l.filter((e) => e && e.workId) : []; },
    get(workId) { return history.list().find((e) => e.workId === workId) || null; },
    record(patch) {
      if (!patch || !patch.workId) return null;
      const list = history.list();
      const i = list.findIndex((e) => e.workId === patch.workId);
      const prev = i >= 0 ? list.splice(i, 1)[0] : { firstAt: Date.now() };
      const entry = { ...prev, ...patch, position: Math.max(Number(prev.position) || 0, Number(patch.position) || 0), lastAt: Date.now() };
      list.unshift(entry);
      write(HKEY, list.slice(0, MAX_HISTORY));
      history.prune();
      return entry;
    },
    // posição vista (só avança; o histórico mostra o que já passou)
    touch(workId, position) {
      const list = history.list(); const e = list.find((x) => x.workId === workId); if (!e) return;
      e.position = Math.max(Number(e.position) || 0, Number(position) || 0); e.lastAt = Date.now();
      write(HKEY, list);
    },
    remove(workId) { write(HKEY, history.list().filter((e) => e.workId !== workId)); drop(CKEY(workId)); },
    clear() { history.list().forEach((e) => drop(CKEY(e.workId))); drop(HKEY); },
    cache(workId, payload) { if (workId && payload) write(CKEY(workId), { ...payload, cachedAt: Date.now() }); },
    cached(workId) { return read(CKEY(workId), null); },
    prune() {
      const keep = new Set(history.list().slice(0, MAX_CACHED).map((e) => e.workId));
      try {
        for (let i = localStorage.length - 1; i >= 0; i--) {
          const k = localStorage.key(i);
          if (k && k.startsWith("ss-hist-work:") && !keep.has(k.slice(13))) localStorage.removeItem(k);
        }
      } catch (e) {}
    },
  };

  // ------------------------------------------------------------------ sincronização ativa
  const active = {
    get() { const a = read(AKEY, null); return a && a.code && Date.now() - Number(a.at || 0) < ACTIVE_MAX_AGE_MS ? a : null; },
    set(a) { write(AKEY, { ...a, at: Date.now() }); },
    beat() { const a = read(AKEY, null); if (a) write(AKEY, { ...a, at: Date.now() }); },
    clear() { drop(AKEY); },
  };

  // ------------------------------------------------------------------ código vindo de QR / link
  function codeFrom(text) {
    const raw = String(text || "").trim();
    if (!raw) return "";
    const native = raw.match(/^sceneshop:\/\/session\/([A-Za-z0-9_-]{3,64})/i);
    if (native) return native[1].toUpperCase();
    try {
      const u = new URL(raw);
      const m = u.pathname.match(/^\/s\/([A-Za-z0-9_-]{3,64})/);
      if (m) return m[1].toUpperCase();
      const q = u.searchParams.get("code") || u.searchParams.get("session");
      if (q && /^[A-Za-z0-9_-]{3,64}$/.test(q)) return q.toUpperCase();
      return "";
    } catch (e) {
      return /^[A-Za-z0-9]{4,12}$/.test(raw) ? raw.toUpperCase() : "";
    }
  }

  // ------------------------------------------------------------------ leitor de QR code
  let jsqrLoading = null;
  function loadJsQR() {
    if (root.jsQR) return Promise.resolve(root.jsQR);
    if (!jsqrLoading) jsqrLoading = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "/vendor/jsQR.min.js"; s.async = true;
      s.onload = () => (root.jsQR ? resolve(root.jsQR) : reject(new Error("QR_DECODER_UNAVAILABLE")));
      s.onerror = () => { jsqrLoading = null; reject(new Error("QR_DECODER_UNAVAILABLE")); };
      document.head.appendChild(s);
    });
    return jsqrLoading;
  }

  async function makeDetector() {
    if (root.BarcodeDetector) {
      try {
        const formats = root.BarcodeDetector.getSupportedFormats ? await root.BarcodeDetector.getSupportedFormats() : ["qr_code"];
        if (formats.includes("qr_code")) {
          const d = new root.BarcodeDetector({ formats: ["qr_code"] });
          return async (video) => { const r = await d.detect(video); return r && r[0] ? r[0].rawValue : null; };
        }
      } catch (e) {}
    }
    const decode = await loadJsQR();
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    return async (video) => {
      const w = video.videoWidth, h = video.videoHeight; if (!w || !h) return null;
      const scale = Math.min(1, 720 / Math.max(w, h));
      canvas.width = Math.round(w * scale); canvas.height = Math.round(h * scale);
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const r = decode(img.data, img.width, img.height, { inversionAttempts: "dontInvert" });
      return r ? r.data : null;
    };
  }

  let scanning = null;
  function stopScan() { if (scanning) scanning.stop(); }
  function scanQr({ view, video, message, onText } = {}) {
    stopScan();
    return new Promise(async (resolve, reject) => {
      let stream = null, stopped = false, timer = null;
      const stop = (err, value) => {
        if (stopped) return; stopped = true; scanning = null;
        clearTimeout(timer);
        if (stream) stream.getTracks().forEach((t) => t.stop());
        try { video.srcObject = null; } catch (e) {}
        view.hidden = true;
        err ? reject(err) : resolve(value);
      };
      scanning = { stop: () => stop(Object.assign(new Error("QR_CANCELLED"), { cancelled: true })) };
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return stop(new Error("Este aparelho não permite usar a câmera aqui. Digite o código da TV."));
      view.hidden = false;
      if (message) message.textContent = "Aponte a câmera para o QR code da TV";
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
      } catch (e) {
        return stop(new Error("Não foi possível abrir a câmera. Permita o acesso à câmera ou digite o código da TV."));
      }
      if (stopped) { stream.getTracks().forEach((t) => t.stop()); return; }
      video.srcObject = stream;
      try { await video.play(); } catch (e) {}
      let detect;
      try { detect = await makeDetector(); } catch (e) { return stop(new Error("Leitor de QR code indisponível. Digite o código da TV.")); }
      const loop = async () => {
        if (stopped) return;
        try {
          const text = await detect(video);
          if (text) {
            const code = codeFrom(text);
            if (code) return stop(null, { code, text });
            if (onText) onText(text);
            if (message) message.textContent = "Esse QR code não é de uma tela SceneShop.";
          }
        } catch (e) {}
        timer = setTimeout(loop, 180);
      };
      loop();
    });
  }

  root.SceneShopHome = { history, active, codeFrom, scanQr, stopScan };
})(typeof window !== "undefined" ? window : globalThis);
