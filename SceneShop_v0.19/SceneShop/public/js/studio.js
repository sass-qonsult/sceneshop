/**
 * SceneShop Estúdio
 *  - Editor: divide a obra em cenas, liga produtos e marca onde aparecem (gera a trilha)
 *  - Ganhos: comissões por trilha, custódia de 30 dias, onboarding KYC, saque
 *  - Moderação (moderador): KYC, alertas de AML, denúncias e auditoria
 */
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const brl = (v) => Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  const fmtT = (s) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}`;
  let token = null;
  let organizationId = null;
  let organizationList = [];
  let mfaChallenge = null;
  const api = async (url, opts = {}) => {
    const headers = { ...(opts.body ? { "Content-Type": "application/json" } : {}), ...(opts.headers || {}) };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (organizationId && !opts.noOrganization) headers["X-SceneShop-Organization"] = organizationId;
    const r = await fetch(url, { method: opts.method || "GET", headers, body: opts.body ? JSON.stringify(opts.body) : undefined });
    const data = await r.json().catch(() => ({}));
    if (r.status === 401 && token && !opts.noLogout) { logout("Sua sessão expirou. Entre novamente."); }
    return { ok: r.ok, status: r.status, data };
  };
  const store = {
    get: (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} },
  };

  const st = {
    user: null, config: {}, works: [], workId: null,
    track: null, sel: 0, products: {}, drawing: null, duration: 60,
  };
  const video = $("video");
  const isMod = () => st.user && st.user.role === "moderator";

  function toast(msg, bad) {
    const t = $("toast");
    t.textContent = msg;
    t.className = "toast" + (bad ? " bad" : "");
    t.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => (t.hidden = true), 3200);
  }

  // ================================================================ abas
  document.querySelectorAll(".tabs button").forEach((b) => (b.onclick = () => showTab(b.dataset.tab)));
  function showTab(tab) {
    document.querySelectorAll(".tabs button").forEach((b) => b.classList.toggle("is-on", b.dataset.tab === tab));
    document.querySelectorAll(".tab").forEach((s) => (s.hidden = s.id !== `tab-${tab}`));
    if (tab === "ganhos") loadLedger();
    if (tab === "moderacao") loadModeration();
    if (tab === "ofertas") loadOffers();
    if (tab === "editor") requestAnimationFrame(renderBoxes);
    if (tab === "obras") loadWorks();
    if (tab === "produtos") loadMyProducts();
    if (tab === "piloto") loadPilot();
    if (tab === "equipe") loadTeamSecurity();
    if (tab === "aiops") loadAiOps();
    store.set("ss-studio-tab", tab);
  }

  // ================================================================ login
  function showLogin(msg) {
    $("login").hidden = false;
    $("loginMsg").textContent = msg || "";
    $("demoAccounts").innerHTML = (st.config.demoAccounts || []).map((a) =>
      `<button type="button" class="ghost small" data-u="${a.username}">${esc(a.label)}</button>`).join("");
    $("demoHint").hidden = !st.config.demo;
    $("demoAccounts").querySelectorAll("[data-u]").forEach((b) => (b.onclick = () => {
      $("loginUser").value = b.dataset.u;
      $("loginPass").value = st.config.demoPassword;
      $("loginForm").requestSubmit();
    }));
    setTimeout(() => $("loginUser").focus(), 50);
  }

  async function loadOrganizations() {
    const r = await api("/api/me/organizations", { noOrganization: true, noLogout: true });
    organizationList = r.ok && Array.isArray(r.data) ? r.data : [];
    const saved = store.get("ss-studio-org");
    const preferred = organizationList.find((o) => o.id === saved) || organizationList[0] || null;
    organizationId = preferred ? preferred.id : null;
    if (organizationId) store.set("ss-studio-org", organizationId);
  }

  function whoHtml() {
    const orgSelect = organizationList.length ? `<select id="orgSelect" title="Organização ativa">${organizationList.map((o) => `<option value="${esc(o.id)}"${o.id===organizationId?" selected":""}>${esc(o.name)} · ${esc((o.membership||{}).role||"")}</option>`).join("")}</select>` : "";
    return `<span class="me"><b>${esc(st.user.name)}</b> · ${{ author: "autor da comunidade", producer: "produtora", moderator: "moderador" }[st.user.role]}</span>${orgSelect}
      <button class="ghost small" id="logoutBtn">Sair</button>`;
  }

  function renderWhoControls() {
    $("who").innerHTML = whoHtml();
    $("logoutBtn").onclick = () => logout();
    const orgSel = $("orgSelect");
    if (orgSel) orgSel.onchange = async (e) => {
      organizationId = e.target.value || null;
      store.set("ss-studio-org", organizationId || "");
      st.workId = null; st.track = null; st.works = []; st.products = {};
      toast("Organização alterada.");
      const tab = store.get("ss-studio-tab") || "editor";
      if (tab === "editor") { await loadWorks(); await loadTrackList(); newTrack(); }
      else showTab(tab);
    };
  }

  async function onLoggedIn(r) {
    token = r.token;
    store.set("ss-studio-token", token);
    st.user = r.user;
    $("login").hidden = true;
    if (!isMod()) await loadOrganizations();
    renderWhoControls();
    // abas conforme o papel
    const orgRole=(activeOrg()&&activeOrg().membership&&activeOrg().membership.role)||null;
    const allowed = isMod() ? ["moderacao"]
      : ["OWNER","ADMIN"].includes(orgRole) ? ["obras","produtos","editor","aiops","ofertas","piloto","ganhos","equipe"]
      : orgRole === "EDITOR" ? ["obras","produtos","editor","aiops","piloto","ganhos","equipe"]
      : orgRole === "COMMERCIAL" ? ["produtos","ofertas","piloto","ganhos","equipe"]
      : orgRole === "ANALYST" ? ["aiops","piloto","ganhos","equipe"]
      : ["ganhos","equipe"];
    document.querySelectorAll(".tabs button").forEach((b) => (b.hidden = !allowed.includes(b.dataset.tab)));
    if (!isMod()) { await loadTrackList(); newTrack(); }
    refreshAi();
    // a opção "Vender no Marketplace Piloto" só existe quando essa loja existe (demonstração)
    st.hasPilotSeller = false;
    if (st.user.role === "producer") { const sl = await api("/api/me/sellers"); st.hasPilotSeller = !!(sl.ok && (sl.data || []).some((x) => x.id === "loja-piloto")); }
    const saved = store.get("ss-studio-tab");
    // primeiro acesso de uma produtora: sem obras, começa enviando o vídeo
    const firstRun = st.user.role === "producer" && !st.works.length;
    showTab(isMod() ? "moderacao" : firstRun ? "obras" : allowed.includes(saved) ? saved : "editor");
  }

  function logout(msg) {
    token = null;
    st.user = null;
    organizationId = null; organizationList = [];
    store.set("ss-studio-token", "");
    $("who").innerHTML = "";
    showLogin(msg);
  }

  $("loginForm").onsubmit = async (e) => {
    e.preventDefault();
    const signup = e.submitter && e.submitter.dataset.mode === "signup";
    const body = { username: $("loginUser").value.trim(), password: $("loginPass").value };
    const r = await api(signup ? "/api/auth/signup" : "/api/auth/login", { method: "POST", body, noLogout: true });
    if (!r.ok) return ($("loginMsg").textContent = r.data.error || (r.data.errors || []).join(" "));
    if (r.data.mfaRequired) {
      mfaChallenge = r.data.challenge; $("mfaLoginBox").hidden = false; $("loginMsg").textContent = "Digite o código do seu autenticador."; $("mfaLoginCode").focus(); return;
    }
    if (signup) toast("Conta criada. Conclua a verificação na aba Ganhos para receber comissões.");
    onLoggedIn(r.data);
  };
  $("mfaLoginSubmit").onclick = async () => {
    const r=await api("/api/auth/mfa",{method:"POST",body:{challenge:mfaChallenge,code:$("mfaLoginCode").value.trim()},noLogout:true,noOrganization:true});
    if(!r.ok)return($("loginMsg").textContent=r.data.error||"Código MFA inválido.");
    mfaChallenge=null;$("mfaLoginBox").hidden=true;$("mfaLoginCode").value="";onLoggedIn(r.data);
  };

  // ================================================================ equipe e segurança
  const activeOrg = () => organizationList.find((o) => o.id === organizationId) || null;
  async function loadTeamSecurity() {
    if (!organizationId) return;
    const org=activeOrg(); $("teamOrgName").textContent=org ? `${org.name} · ${(org.membership||{}).role||""}` : organizationId;
    const [members,mfaStatus,sessions] = await Promise.all([api(`/api/organizations/${encodeURIComponent(organizationId)}/members`),api('/api/me/mfa'),api('/api/me/sessions')]);
    $("teamMembers").innerHTML=(members.ok?members.data:[]).map((m)=>`<tr><td>${esc(m.username)}</td><td>${esc(m.role)}</td><td>${esc(m.status)}</td></tr>`).join("");
    $("mfaStatus").textContent=mfaStatus.ok && mfaStatus.data.enabled ? "MFA TOTP ativo nesta conta." : "MFA ainda não está ativo nesta conta.";
    $("mfaDisableBtn").disabled=!(mfaStatus.ok&&mfaStatus.data.enabled);
    $("activeSessions").innerHTML=(sessions.ok?sessions.data:[]).map((x)=>`<div class="row"><span class="grow"><b>${esc(x.authStrength||'PASSWORD')}</b> · ${new Date(x.issuedAt).toLocaleString('pt-BR')} · expira ${new Date(x.expiresAt).toLocaleString('pt-BR')}</span><button class="ghost small" data-revoke-session="${esc(x.id)}">Revogar</button></div>`).join("")||'<p class="help">Nenhuma sessão ativa.</p>';
    $("activeSessions").querySelectorAll('[data-revoke-session]').forEach((b)=>b.onclick=async()=>{const r=await api(`/api/me/sessions/${encodeURIComponent(b.dataset.revokeSession)}`,{method:'DELETE'});if(r.ok){toast('Sessão revogada.');loadTeamSecurity();}else toast(r.data.error||'Falha ao revogar.',true);});
    const role=org&&org.membership&&org.membership.role; const canAdmin=['OWNER','ADMIN'].includes(role);
    $("inviteCard").hidden=!canAdmin; $("orgSecurityCard").hidden=!canAdmin;
    $("requireMfaWrites").checked=!!(org&&org.settings&&org.settings.security&&org.settings.security.requireMfaForWrites);
    if(canAdmin){const inv=await api(`/api/organizations/${encodeURIComponent(organizationId)}/invites`);$("teamInvites").innerHTML=(inv.ok?inv.data:[]).map((i)=>`<tr><td>${esc(i.username||'')}</td><td>${esc(i.role)}</td><td>${esc(i.status)}</td><td>${i.expiresAt?new Date(i.expiresAt).toLocaleString('pt-BR'):'—'}</td></tr>`).join("");}
  }
  $("teamRefresh").onclick=loadTeamSecurity;
  $("inviteBtn").onclick=async()=>{const r=await api(`/api/organizations/${encodeURIComponent(organizationId)}/invites`,{method:'POST',body:{username:$("inviteUser").value.trim(),role:$("inviteRole").value}});$("inviteResult").textContent=r.ok?`Token (exibido uma vez): ${r.data.token}`:(r.data.error||(r.data.errors||[]).join(' '));if(r.ok)loadTeamSecurity();};
  $("acceptInviteBtn").onclick=async()=>{const r=await api('/api/organization-invites/accept',{method:'POST',body:{token:$("acceptInviteToken").value.trim()},noOrganization:true});$("acceptInviteMsg").textContent=r.ok?'Convite aceito.':(r.data.error||(r.data.errors||[]).join(' '));if(r.ok){await loadOrganizations();renderWhoControls();loadTeamSecurity();}};
  $("mfaSetupBtn").onclick=async()=>{const r=await api('/api/me/mfa/setup',{method:'POST',body:{}});$("mfaSetupResult").textContent=r.ok?`Segredo: ${r.data.secret} · adicione no autenticador e confirme com o código.`:(r.data.error||'Falha ao iniciar MFA.');};
  $("mfaEnableBtn").onclick=async()=>{const r=await api('/api/me/mfa/enable',{method:'POST',body:{code:$("mfaEnableCode").value.trim()}});$("mfaSetupResult").textContent=r.ok?'MFA ativado. Faça logout/login para obter uma sessão forte.':(r.data.error||'Código inválido.');if(r.ok)loadTeamSecurity();};
  $("mfaDisableBtn").onclick=async()=>{const code=prompt('Código atual do autenticador:');if(!code)return;const r=await api('/api/me/mfa/disable',{method:'POST',body:{code}});if(r.ok)logout('MFA desativado. Entre novamente.');else $("mfaSetupResult").textContent=r.data.error||'Falha ao desativar MFA.';};
  $("saveOrgSecurity").onclick=async()=>{const r=await api(`/api/organizations/${encodeURIComponent(organizationId)}/settings`,{method:'PATCH',body:{security:{requireMfaForWrites:$("requireMfaWrites").checked}}});$("orgSecurityMsg").textContent=r.ok?'Política salva.':(r.data.message||r.data.error||'Falha ao salvar.');if(r.ok){await loadOrganizations();loadTeamSecurity();}};

  // ================================================================ editor: trilha
  async function loadTrackList() {
    if (!st.workId) { $("trackSel").innerHTML = `<option value="">+ Nova trilha</option>`; return; }
    const list = ((await api(`/api/me/tracks?work=${st.workId}`)).data || []).filter((t) => t.status !== "removida");
    $("trackSel").innerHTML = `<option value="">+ Nova trilha</option>` +
      list.map((t) => `<option value="${t.id}">${esc(t.title)} (${t.scenes} cenas)</option>`).join("");
  }
  $("trackSel").onchange = (e) => (e.target.value ? loadTrack(e.target.value) : newTrack());
  $("work").onchange = (e) => selectWork(e.target.value);

  // Troca a obra do editor: vídeo, duração e trilhas
  async function selectWork(id) {
    const w = st.works.find((x) => x.id === id) || st.works[0];
    if (!w) { st.workId = null; st.duration = 0; video.removeAttribute("src"); return; } // ainda não há obras
    st.workId = w.id;
    st.duration = w.duration;
    $("work").value = w.id;
    if (video.getAttribute("src") !== w.video) { video.src = w.video; video.load(); }
    store.set("ss-studio-work", w.id);
    if (st.user && !isMod()) { await loadTrackList(); newTrack(); }
    refreshAi();
  }

  async function refreshWorks() {
    st.works = (await api("/api/works")).data;
    $("work").innerHTML = st.works.map((w) => `<option value="${w.id}">${esc(w.title)}${w.pilot ? " (piloto)" : ""}</option>`).join("");
    $("work").value = st.workId;
  }

  function newTrack() {
    st.track = { id: null, title: "", offset: 0, scenes: [{ id: "c1", title: "Cena 1", start: 0, end: st.duration, products: [] }] };
    st.sel = 0;
    $("trackSel").value = "";
    renderAll();
    setLinks();
  }

  async function loadTrack(id) {
    const t = (await api(`/api/tracks/${id}`)).data;
    st.track = JSON.parse(JSON.stringify({ id: t.id, title: t.title, offset: t.offset, scenes: t.scenes }));
    const ids = [...new Set(t.scenes.flatMap((s) => s.products.map((p) => p.id)))];
    await Promise.all(ids.filter((i) => !st.products[i]).map(async (i) => (st.products[i] = (await api(`/api/products/${i}`)).data)));
    st.sel = 0;
    renderAll();
    setLinks();
  }

  $("trackTitle").oninput = (e) => (st.track.title = e.target.value);
  $("offset").oninput = (e) => { st.track.offset = Number(e.target.value) || 0; renderTimeline(); };

  function renderSeal() {
    const a = st.user || {};
    const org=activeOrg();
    const official = !!(org && ["CONTENT_OWNER","PRODUCER","CHANNEL","PLATFORM"].includes(org.kind));
    $("sealLine").innerHTML = `Será publicada como <span class="seal ${official ? "is-official" : "is-community"}">${official ? "Oficial" : "Comunidade"}</span>` +
      (a.kyc !== "aprovado" ? ` <span class="warn">· Você pode publicar, mas só recebe comissão depois da verificação de identidade (aba Ganhos).</span>` : "");
  }

  // ================================================================ editor: cenas
  const scenes = () => st.track.scenes;
  const cur = () => scenes()[st.sel];

  function nextSceneId() {
    const n = Math.max(0, ...scenes().map((s) => Number(String(s.id).replace(/\D/g, "")) || 0));
    return `c${n + 1}`;
  }

  function sceneIndexAt(t) {
    const off = st.track.offset;
    const i = scenes().findIndex((s) => t >= s.start + off && t < s.end + off);
    return i < 0 ? scenes().length - 1 : i;
  }

  $("splitBtn").onclick = () => {
    const t = Math.round((video.currentTime - st.track.offset) * 10) / 10;
    const i = scenes().findIndex((s) => t > s.start && t < s.end);
    if (i < 0) return toast("Posicione o vídeo dentro de uma cena.", true);
    const s = scenes()[i];
    if (t - s.start < 0.5 || s.end - t < 0.5) return toast("Muito perto do corte existente.", true);
    const novo = { id: nextSceneId(), title: `Cena ${scenes().length + 1}`, start: t, end: s.end, products: [] };
    s.end = t;
    scenes().splice(i + 1, 0, novo);
    st.sel = i + 1;
    renderAll();
    $("sceneTitle").select();
  };

  function renderScenes() {
    $("sceneList").innerHTML = scenes().map((s, i) => `
      <li class="${i === st.sel ? "is-sel" : ""}" data-i="${i}">
        <span class="n">${i + 1}</span>
        <span class="t">${esc(s.title)}</span>
        <span class="r">${fmtT(s.start)}–${fmtT(s.end)}</span>
        <span class="c">${s.products.length} prod.</span>
      </li>`).join("");
    $("sceneList").querySelectorAll("li").forEach((li) => (li.onclick = () => selectScene(Number(li.dataset.i), true)));
  }

  function selectScene(i, seek) {
    st.sel = i;
    if (seek) video.currentTime = Math.max(0, cur().start + st.track.offset) + 0.05;
    renderScenes(); renderSceneForm(); renderTimeline(); renderBoxes();
  }

  function renderSceneForm() {
    const s = cur();
    $("sceneTitle").value = s.title;
    $("sceneStart").value = s.start;
    $("sceneEnd").value = s.end;
    $("delScene").disabled = scenes().length < 2;
    renderProducts();
  }

  $("sceneTitle").oninput = (e) => { cur().title = e.target.value; renderScenes(); renderTimeline(); };
  function setBound(which, v) {
    const s = cur(), i = st.sel;
    v = Math.round(Number(v) * 10) / 10;
    if (isNaN(v)) return;
    s[which] = v;
    // mantém as cenas vizinhas encostadas
    if (which === "start" && scenes()[i - 1]) scenes()[i - 1].end = v;
    if (which === "end" && scenes()[i + 1]) scenes()[i + 1].start = v;
    renderScenes(); renderTimeline();
  }
  $("sceneStart").onchange = (e) => setBound("start", e.target.value);
  $("sceneEnd").onchange = (e) => setBound("end", e.target.value);
  $("startNow").onclick = () => { setBound("start", video.currentTime - st.track.offset); renderSceneForm(); };
  $("endNow").onclick = () => { setBound("end", video.currentTime - st.track.offset); renderSceneForm(); };
  $("delScene").onclick = () => {
    if (scenes().length < 2) return;
    const i = st.sel, s = scenes()[i];
    if (scenes()[i - 1]) scenes()[i - 1].end = s.end; else scenes()[i + 1].start = s.start;
    scenes().splice(i, 1);
    selectScene(Math.max(0, i - 1));
  };

  // ================================================================ editor: linha do tempo
  function renderTimeline() {
    const tl = $("timeline"), d = st.duration, off = st.track.offset;
    tl.querySelectorAll(".blk").forEach((b) => b.remove());
    scenes().forEach((s, i) => {
      const b = document.createElement("button");
      b.className = "blk" + (i === st.sel ? " is-sel" : "") + (i % 2 ? " alt" : "");
      b.style.left = `${Math.max(0, (s.start + off) / d) * 100}%`;
      b.style.width = `${((s.end - s.start) / d) * 100}%`;
      b.innerHTML = `<span>${i + 1}. ${esc(s.title)}</span><b>${s.products.length}</b>`;
      b.onclick = () => selectScene(i, true);
      tl.appendChild(b);
    });
    moveCursor();
  }
  function moveCursor() {
    $("cursor").style.left = `${(video.currentTime / st.duration) * 100}%`;
    $("clock").textContent = `${fmtT(video.currentTime)} / ${fmtT(st.duration)}`;
  }
  $("timeline").onclick = (e) => {
    if (e.target.closest(".blk")) return;
    const r = e.currentTarget.getBoundingClientRect();
    video.currentTime = ((e.clientX - r.left) / r.width) * st.duration;
  };

  video.addEventListener("timeupdate", () => {
    moveCursor();
    if (!video.paused) {
      const i = sceneIndexAt(video.currentTime);
      if (i !== st.sel) selectScene(i); // seleção acompanha a reprodução
    }
  });
  video.addEventListener("loadedmetadata", () => {
    st.duration = video.duration || st.duration;
    if (!st.track) return; // metadados chegaram antes do estúdio terminar de carregar
    if (st.track && st.track.scenes.length === 1 && !st.track.id) st.track.scenes[0].end = Math.round(st.duration * 10) / 10;
    renderAll();
  });
  video.addEventListener("play", () => ($("playBtn").textContent = "Pausar"));
  video.addEventListener("pause", () => ($("playBtn").textContent = "Tocar"));
  $("playBtn").onclick = () => (video.paused ? video.play() : video.pause());
  $("back").onclick = () => (video.currentTime = Math.max(0, video.currentTime - 0.5));
  $("fwd").onclick = () => (video.currentTime = Math.min(st.duration, video.currentTime + 0.5));

  // ================================================================ editor: produtos
  function renderProducts() {
    const s = cur();
    $("prodList").innerHTML = s.products.length ? s.products.map((it, i) => {
      const p = st.products[it.id] || { name: it.id, image: "/media/products/placeholder.svg", brand: "" };
      return `<li data-i="${i}">
        <img src="${p.image}" alt=""/>
        <div class="pi"><b>${esc(p.name)}</b><span>${esc(p.brand)}</span></div>
        <select data-match title="O produto é exatamente o da cena ou um parecido?">
          <option value="exato" ${it.match !== "parecido" ? "selected" : ""}>Exato</option>
          <option value="parecido" ${it.match === "parecido" ? "selected" : ""}>Parecido</option>
        </select>
        <button class="ghost small ${it.box ? "" : "need"}" data-draw>${it.box ? "Remarcar" : "Marcar na imagem"}</button>
        <button class="x" data-del aria-label="Remover">×</button>
      </li>`;
    }).join("") : `<li class="empty">Nenhum produto nesta cena ainda.</li>`;
    $("prodList").querySelectorAll("li[data-i]").forEach((li) => {
      const i = Number(li.dataset.i);
      li.querySelector("[data-match]").onchange = (e) => (cur().products[i].match = e.target.value);
      li.querySelector("[data-draw]").onclick = () => startDraw(i);
      li.querySelector("[data-del]").onclick = () => { cur().products.splice(i, 1); renderProducts(); renderScenes(); renderTimeline(); renderBoxes(); };
      li.onmouseenter = () => highlightBox(i);
      li.onmouseleave = () => highlightBox(-1);
    });
  }

  function addProduct(p) {
    st.products[p.id] = p;
    if (cur().products.some((x) => x.id === p.id)) return toast("Esse produto já está na cena.", true);
    cur().products.push({ id: p.id, match: "exato", box: null });
    renderProducts(); renderScenes(); renderTimeline();
    startDraw(cur().products.length - 1);
  }

  let searchT;
  $("prodSearch").oninput = (e) => {
    clearTimeout(searchT);
    searchT = setTimeout(async () => {
      const q = e.target.value.trim();
      const res = $("results");
      if (!q) { res.hidden = true; return; }
      const list = (await api(`/api/products?q=${encodeURIComponent(q)}`)).data;
      res.innerHTML = list.length ? list.map((p) => `<li data-id="${p.id}"><img src="${p.image}" alt=""/><span><b>${esc(p.name)}</b> ${esc(p.brand)}</span><em>${brl(p.referencePrice)}</em></li>`).join("")
        : `<li class="none">Nada encontrado. Cadastre abaixo.</li>`;
      res.hidden = false;
      res.querySelectorAll("li[data-id]").forEach((li) => (li.onclick = () => {
        addProduct(list.find((p) => p.id === li.dataset.id));
        res.hidden = true; $("prodSearch").value = "";
      }));
    }, 180);
  };
  document.addEventListener("click", (e) => { if (!e.target.closest(".search")) $("results").hidden = true; });

  $("newProd").onsubmit = async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(e.target));
    const r = await api("/api/products", { method: "POST", body });
    if (!r.ok) return toast((r.data.errors || ["Erro"]).join(" "), true);
    e.target.reset();
    e.target.closest("details").open = false;
    addProduct(r.data);
  };

  // ================================================================ editor: caixas sobre a imagem
  function imageRect() {
    const vw = video.videoWidth || 1280, vh = video.videoHeight || 720;
    const bw = video.clientWidth, bh = video.clientHeight;
    const k = Math.min(bw / vw, bh / vh);
    const w = vw * k, h = vh * k;
    return { left: (bw - w) / 2, top: (bh - h) / 2, width: w, height: h };
  }

  function renderBoxes() {
    const layer = $("boxes"), r = imageRect();
    Object.assign(layer.style, { left: r.left + "px", top: r.top + "px", width: r.width + "px", height: r.height + "px" });
    layer.querySelectorAll(".bx").forEach((b) => b.remove());
    if (!st.track) return;
    cur().products.forEach((it, i) => {
      if (!it.box) return;
      const b = document.createElement("div");
      b.className = "bx";
      b.dataset.i = i;
      Object.assign(b.style, { left: it.box.x + "%", top: it.box.y + "%", width: it.box.w + "%", height: it.box.h + "%" });
      b.innerHTML = `<span>${esc((st.products[it.id] || {}).name || it.id)}</span>`;
      layer.appendChild(b);
    });
  }
  function highlightBox(i) {
    $("boxes").querySelectorAll(".bx").forEach((b) => b.classList.toggle("is-on", Number(b.dataset.i) === i));
  }

  function startDraw(i) {
    video.pause();
    st.drawing = i;
    $("stage").classList.add("drawing");
    $("drawHint").hidden = false;
    $("drawHint").textContent = `Arraste sobre a imagem para marcar: ${(st.products[cur().products[i].id] || {}).name || ""} · Esc cancela`;
  }
  function stopDraw() {
    st.drawing = null;
    $("stage").classList.remove("drawing");
    $("drawHint").hidden = true;
    const g = $("boxes").querySelector(".ghostbox");
    if (g) g.remove();
  }
  (function bindDraw() {
    const layer = $("boxes");
    let start = null, ghost = null;
    const pt = (e) => {
      const r = layer.getBoundingClientRect();
      return { x: Math.min(100, Math.max(0, ((e.clientX - r.left) / r.width) * 100)), y: Math.min(100, Math.max(0, ((e.clientY - r.top) / r.height) * 100)) };
    };
    layer.addEventListener("pointerdown", (e) => {
      if (st.drawing == null) return;
      start = pt(e);
      ghost = document.createElement("div");
      ghost.className = "bx ghostbox";
      layer.appendChild(ghost);
      layer.setPointerCapture(e.pointerId);
    });
    layer.addEventListener("pointermove", (e) => {
      if (!start) return;
      const p = pt(e);
      Object.assign(ghost.style, { left: Math.min(p.x, start.x) + "%", top: Math.min(p.y, start.y) + "%", width: Math.abs(p.x - start.x) + "%", height: Math.abs(p.y - start.y) + "%" });
    });
    layer.addEventListener("pointerup", (e) => {
      if (!start) return;
      const p = pt(e);
      const box = { x: +Math.min(p.x, start.x).toFixed(2), y: +Math.min(p.y, start.y).toFixed(2), w: +Math.abs(p.x - start.x).toFixed(2), h: +Math.abs(p.y - start.y).toFixed(2) };
      start = null;
      if (box.w > 1 && box.h > 1 && st.drawing != null) cur().products[st.drawing].box = box;
      stopDraw();
      renderProducts(); renderBoxes();
    });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && st.drawing != null) { stopDraw(); } });
    window.addEventListener("resize", renderBoxes);
  })();

  // ================================================================ editor: publicar
  function setLinks() {
    const id = st.track && st.track.id;
    $("vttLink").hidden = $("playLink").hidden = !id;
    const w = st.works.find((x) => x.id === st.workId) || {};
    if (id) { $("vttLink").href = `/api/tracks/${id}.vtt`; $("playLink").href = w.pilot ? `/assistir/${st.workId}?track=${id}` : `/?track=${id}`; }
    $("saveBtn").textContent = id ? "Salvar alterações" : "Publicar trilha";
  }

  $("saveBtn").onclick = async () => {
    const t = st.track;
    const empty = t.scenes.filter((s) => !s.products.length).length;
    const noBox = t.scenes.reduce((n, s) => n + s.products.filter((p) => !p.box).length, 0);
    const w = st.works.find((x) => x.id === st.workId) || {};
    if (w.pilot) {
      // miniatura de cada cena, capturada do próprio vídeo (aparece na faixa de cenas do espectador)
      $("msg").className = "msg"; $("msg").textContent = "Gerando miniaturas das cenas…";
      for (const sc of t.scenes) {
        try { sc.thumb = await captureThumb((sc.start + sc.end) / 2 + t.offset); } catch (e) { /* segue sem miniatura */ }
      }
    }
    const body = { workId: st.workId, title: t.title || "Minha trilha", offset: t.offset, scenes: t.scenes };
    const r = t.id ? await api(`/api/tracks/${t.id}`, { method: "PUT", body }) : await api("/api/tracks", { method: "POST", body });
    if (!r.ok) { $("msg").className = "msg bad"; $("msg").textContent = (r.data.errors || [r.data.error || "Erro"]).join(" "); return; }
    t.id = r.data.track.id;
    await loadTrackList();
    $("trackSel").value = t.id;
    setLinks();
    $("msg").className = "msg ok";
    $("msg").textContent = `Trilha publicada como ${r.data.track.type === "official" ? "Oficial" : "Comunidade"}.` +
      (empty ? ` ${empty} cena(s) sem produto.` : "") + (noBox ? ` ${noBox} produto(s) sem posição marcada.` : "");
  };

  function renderAll() {
    $("trackTitle").value = st.track.title;
    $("offset").value = st.track.offset;
    $("msg").textContent = "";
    renderSeal(); renderScenes(); renderSceneForm(); renderTimeline(); renderBoxes();
  }

  // ================================================================ ganhos
  const STATUS = {
    custodia: ["Em custódia", "hold"], congelado: ["Congelado", "frozen"], aguardando_kyc: ["Aguardando verificação", "kyc"],
    liberado: ["Liberado", "free"], pago: ["Pago", "paid"], estornado: ["Estornado", "rev"],
  };
  const KYC = { aprovado: ["Verificado", "free"], em_analise: ["Em análise", "hold"], pendente: ["Não verificado", "kyc"], reprovado: ["Reprovado", "rev"] };

  async function loadLedger() {
    const r = await api("/api/me/ledger");
    if (!r.ok) return;
    const L = r.data, a = L.author;
    const [kLabel, kCls] = KYC[a.kyc] || [a.kyc, "kyc"];

    $("kyc").innerHTML = `
      <div class="head-row">
        <div><h3>${esc(a.name)}</h3><div class="help">${a.type === "producer" ? "Produtora parceira" : "Autor da comunidade"}${a.document ? " · " + esc(a.document) : ""}</div></div>
        <span class="pill ${kCls}">${kLabel}</span>
      </div>
      ${a.kyc === "pendente" || a.kyc === "reprovado" ? `
        <p class="help">Para receber comissões, confirme sua identidade. Exigido pela prevenção à lavagem de dinheiro (Lei 9.613/1998). Seu saldo continua acumulando enquanto isso.</p>
        <form id="kycForm" class="grid kycgrid">
          <input name="name" placeholder="Nome completo ou razão social" required />
          <input name="document" placeholder="CPF ou CNPJ" inputmode="numeric" required />
          <input name="birth" type="date" title="Data de nascimento (pessoa física)" />
          <input name="bank" placeholder="Chave Pix ou conta (mesmo titular)" required />
          <label class="chk"><input type="checkbox" name="pep" /> Sou pessoa politicamente exposta (PEP)</label>
          <label class="chk"><input type="checkbox" required /> Declaro que as informações são verdadeiras</label>
          <button class="primary">Enviar para verificação</button>
        </form>
        <div class="msg bad" id="kycMsg"></div>` : ""}
      ${a.kyc === "em_analise" ? `<p class="help">Documentos enviados. Na versão real, o parceiro de pagamentos confere identidade, listas restritivas e titularidade da conta.</p>
        ${st.config.demo ? '<button id="approveKyc">Simular aprovação pelo parceiro</button> <span class="help">ou entre como moderador para aprovar</span>' : ""}` : ""}`;
    const f = $("kycForm");
    if (f) f.onsubmit = async (e) => {
      e.preventDefault();
      const body = Object.fromEntries(new FormData(f));
      body.pep = !!body.pep;
      const r2 = await api("/api/me/kyc", { method: "POST", body });
      if (!r2.ok) return ($("kycMsg").textContent = (r2.data.errors || [r2.data.error]).join(" "));
      toast("Verificação enviada.");
      await refreshMe(); loadLedger();
    };
    const ap = $("approveKyc");
    if (ap) ap.onclick = async () => { await api("/api/dev/kyc", { method: "POST", body: {} }); await refreshMe(); loadLedger(); toast("Identidade verificada."); };
    $("payoutHold").hidden = !L.payoutHold;
    $("payoutHold").textContent = L.payoutHold || "";

    const T = L.totals;
    $("tiles").innerHTML = [
      ["custodia", "Retido até completar 30 dias"], ["congelado", "Trilha em revisão por denúncias"],
      ["aguardando_kyc", "Prazo cumprido, falta verificação"], ["liberado", "Disponível para saque"], ["pago", "Já transferido"],
    ].map(([k, sub]) => `<div class="tile ${STATUS[k][1]}"><div class="lbl">${STATUS[k][0]}</div><div class="val">${brl(T[k])}</div><div class="sub">${sub}</div></div>`).join("");

    // v0.19: as regras vêm da política comercial versionada (rules.commercialPolicy.terms)
    const R = L.rules, terms = (R.commercialPolicy && R.commercialPolicy.terms) || R;
    const sp = (terms.splits || R.split || {})[a.type === "producer" ? "official" : "community"] || { owner: 0 };
    $("rules").innerHTML = `Cada venda gera comissão da loja (${Object.entries(terms.storeCommission || R.storeCommission || {}).map(([k, v]) => `${k} ${Math.round(v * 100)}%`).join(", ")}). ` +
      `Você recebe <b>${Math.round(sp.owner * 100)}%</b> dela (valor de exemplo). O valor fica <b>${R.HOLD_DAYS} dias em custódia</b> para cobrir devoluções e denúncias. Saque mínimo ${brl(R.MIN_PAYOUT)}. ${L.clicks} cliques rastreados.`;

    $("withdrawBtn").disabled = !L.canWithdraw;
    $("ledgerBody").innerHTML = L.entries.length ? L.entries.map((e) => {
      const [lbl, cls] = STATUS[e.status];
      return `<tr>
        <td>${new Date(e.at).toLocaleDateString("pt-BR")}</td>
        <td>${esc(e.product)}</td><td>${e.official ? `<span class="pill gold">Oficial</span> ${esc(e.storeName)}` : esc(e.storeName || e.store)}${e.partnerId ? `<div class="help">via canal ${esc(e.partnerId)} (−${brl(e.partnerPart)})</div>` : ""}</td>
        <td>${e.track ? `<span class="seal mini ${e.track.type === "official" ? "is-official" : "is-community"}">${e.track.type === "official" ? "O" : "C"}</span> ${esc(e.track.title)}` : "—"}</td>
        <td class="num">${brl(e.value)}</td><td class="num">${brl(e.commission)}</td><td class="num"><b>${brl(e.share)}</b></td>
        <td><span class="pill ${cls}">${lbl}</span>${e.status === "custodia" ? ` <small>libera em ${e.daysLeft} d</small>` : ""}</td>
      </tr>`;
    }).join("") : `<tr><td colspan="8" class="empty">Nenhuma venda ainda.</td></tr>`;

    $("myTracks").innerHTML = L.tracks.length ? `<table class="ledger"><thead><tr><th>Trilha</th><th>Selo</th><th>Aprovação</th><th>Votos</th><th>Denúncias</th><th>Situação</th></tr></thead><tbody>` +
      L.tracks.map((t) => `<tr><td>${esc(t.title)}</td><td><span class="seal ${t.type === "official" ? "is-official" : "is-community"}">${t.type === "official" ? "Oficial" : "Comunidade"}</span></td>
        <td>${t.approval != null ? t.approval + "%" : "—"}</td><td>${t.votes.up} / ${t.votes.down}</td><td>${t.reports}</td><td>${statusTrack(t.status)}</td></tr>`).join("") + "</tbody></table>"
      : `<p class="help">Você ainda não publicou trilhas.</p>`;
  }
  const statusTrack = (s) => ({ ativa: '<span class="pill free">No ar</span>', em_revisao: '<span class="pill frozen">Em revisão</span>', removida: '<span class="pill rev">Removida</span>' }[s] || s);

  $("withdrawBtn").onclick = async () => {
    const r = await api("/api/me/withdraw", { method: "POST" });
    r.ok ? toast(`Saque de ${brl(r.data.paid)} solicitado.`) : toast(r.data.error, true);
    loadLedger();
  };
  $("simSale").onclick = async () => {
    const r = await api("/api/dev/sale", { method: "POST", body: {} });
    if (r.data.error) return toast(r.data.error, true);
    toast(`Venda simulada: ${r.data.sale.product} — sua parte ${brl(r.data.sale.share)}`);
    loadLedger();
  };
  $("simSelf").onclick = async () => {
    const r = await api("/api/dev/sale", { method: "POST", body: { selfPurchase: true } });
    if (r.data.error) return toast(r.data.error, true);
    toast("3 compras do mesmo aparelho registradas. Veja o efeito no saque e no painel do moderador.");
    loadLedger();
  };
  async function refreshMe() {
    const r = await api("/api/me");
    if (r.ok) st.user = r.data;
    renderSeal();
  }
  $("advance").onclick = async () => { await api("/api/dev/advance", { method: "POST", body: { days: 30 } }); toast("Relógio avançou 30 dias."); loadLedger(); };
  $("resetDemo").onclick = async () => {
    await api("/api/dev/reset", { method: "POST" });
    const me = await api("/api/me", { noLogout: true });
    if (!me.ok) return logout("Dados restaurados. Entre novamente.");
    st.user = me.data; await loadTrackList(); newTrack(); loadLedger();
    toast("Dados da demonstração restaurados.");
  };

  // ================================================================ ofertas oficiais (produtora)
  async function loadOffers() {
    const [items, sellers, policy, campaigns] = await Promise.all([api("/api/me/official-offers"), api("/api/me/sellers"), api("/api/commercial-policy"), api("/api/commerce/campaigns")]);
    const defaultCommissionPct = +(((policy.data || {}).current?.terms?.defaultCommissionRate ?? 0.10) * 100).toFixed(2);
    const kindLbl = (x) => x.kind === "varejista" ? `varejista · ${x.integration === "codigos_unicos" ? "cupons" : "campanha"}` : "loja da marca";
    const opts = (sel) => `<option value="">— sem oferta garantida —</option>` +
      sellers.data.filter((x) => x.agreement && x.agreement.valid).map((x) => `<option value="${x.id}" ${x.id === sel ? "selected" : ""}>${esc(x.name)} (${kindLbl(x)})</option>`).join("");
    $("offersBody").innerHTML = items.data.map((it) => {
      const o = it.offer || {};
      const days = o.validUntil ? Math.max(1, Math.round((o.validUntil - Date.now()) / 864e5)) : 90;
      return `<tr data-id="${it.productId}">
        <td><div class="pcell"><img src="${it.image}" alt=""/><div><b>${esc(it.name)}</b><div class="help">${esc(it.brand)}</div></div></div></td>
        <td class="num">${brl(it.referencePrice)}</td>
        <td><select data-f="sellerId">${opts(o.sellerId)}</select></td>
        <td class="num"><input data-f="price" type="number" step="0.01" min="0" value="${o.price ?? it.referencePrice}" /></td>
        <td class="num"><input data-f="commission" type="number" step="0.1" min="0" max="100" value="${o.commission != null ? +(o.commission * 100).toFixed(2) : defaultCommissionPct}" /></td>
        <td class="num"><input data-f="validDays" type="number" min="1" max="365" value="${days}" /></td>
        <td><button class="small" data-save>Salvar</button></td>
      </tr>`;
    }).join("") || `<tr><td colspan="7" class="empty">Nenhum produto nas suas trilhas oficiais.</td></tr>`;
    $("offersBody").querySelectorAll("[data-save]").forEach((b) => (b.onclick = async () => {
      const tr = b.closest("tr"), f = (k) => tr.querySelector(`[data-f=${k}]`).value;
      const body = { sellerId: f("sellerId"), price: Number(f("price")), commission: Number(f("commission")) / 100, validDays: Number(f("validDays")) };
      const r = await api(`/api/official-offers/${tr.dataset.id}`, { method: "PUT", body });
      if (!r.ok) return toast((r.data.errors || [r.data.error]).join(" "), true);
      toast(body.sellerId ? "Oferta oficial salva. Vale para os próximos cliques." : "Oferta oficial removida.");
      loadOffers();
    }));
    const prodOpts = items.data.map((it) => `<option value="${it.productId}">${esc(it.name)}</option>`).join("");
    const previewProduct=$("commercePreviewProduct"), previewCampaign=$("commercePreviewCampaign");
    if(previewProduct) previewProduct.innerHTML=prodOpts;
    if(previewCampaign) previewCampaign.innerHTML='<option value="">— automática / nenhuma —</option>'+((campaigns.ok?campaigns.data:[])||[]).map((c)=>`<option value="${esc(c.id)}">${esc(c.name)} · ${esc(c.status)}</option>`).join('');
    const pname = (id) => (items.data.find((i) => i.productId === id) || {}).name || id;
    $("sellersList").innerHTML = sellers.data.map((x) => {
      const a = x.agreement || {};
      let extra = "";
      if (x.integration === "codigos_unicos" && x.pool) {
        const per = Object.entries(x.pool.byProduct).map(([k, n]) => `${k === "*" ? "qualquer produto" : esc(pname(k))}: ${n}`).join(" · ") || "nenhum livre";
        extra = `<div class="pool ${x.pool.low ? "low" : ""}">Cupons: <b>${x.pool.livre}</b> livres · ${x.pool.reservado} entregues a espectadores · ${x.pool.usado} usados
            ${x.pool.low ? '<span class="pill frozen">estoque baixo: peça um novo lote ao varejista</span>' : ""}<div class="help">${per}</div></div>
          <form class="codes-form" data-seller="${x.id}">
            <select name="productId"><option value="">qualquer produto</option>${prodOpts}</select>
            <textarea name="codes" rows="2" placeholder="Cole aqui o lote de cupons enviado pelo varejista (um por linha)"></textarea>
            <button class="small">Carregar lote</button>
          </form>`;
      }
      if (x.integration === "link_campanha") {
        const camps = Object.entries(x.campaigns || {}).map(([pid, c]) => `${esc(pname(pid))}: <code>${esc(c)}</code>`).join(" · ") || "nenhuma";
        extra = `<div class="pool">Campanhas: ${camps}</div>
          <form class="camp-form" data-seller="${x.id}">
            <select name="productId">${prodOpts}</select><input name="campaignId" placeholder="ID da campanha criada pelo varejista" />
            <button class="small">Registrar campanha</button>
          </form>`;
      }
      return `<div class="agreement">
        <div class="head-row"><div><b>${esc(x.name)}</b> <span class="pill ${x.kind === "varejista" ? "hold" : "gold"}">${x.kind === "varejista" ? "Grande varejista" : "Loja da marca"}</span>
          <div class="help">CNPJ ${esc(x.cnpj)} · ${esc(x.integrationLabel)} · ${x.orders} pedido(s) confirmado(s)</div>
          <div class="help">${esc(a.notes || "")} Acordo válido até ${a.until ? new Date(a.until).toLocaleDateString("pt-BR") : "—"}.</div></div>
          ${a.valid ? '<span class="pill free">Acordo vigente</span>' : '<span class="pill rev">Acordo vencido</span>'}</div>
        ${extra}</div>`;
    }).join("");
    $("sellersList").querySelectorAll(".codes-form").forEach((f) => (f.onsubmit = async (e) => {
      e.preventDefault();
      const body = Object.fromEntries(new FormData(f));
      const r = await api(`/api/sellers/${f.dataset.seller}/codes`, { method: "POST", body });
      if (!r.ok) return toast(r.data.error, true);
      toast(`${r.data.added} cupom(ns) carregado(s)` + (r.data.duplicated ? `, ${r.data.duplicated} repetido(s) ignorado(s)` : "") + (r.data.invalid.length ? `, ${r.data.invalid.length} inválido(s)` : "") + ".");
      loadOffers();
    }));
    $("sellersList").querySelectorAll(".camp-form").forEach((f) => (f.onsubmit = async (e) => {
      e.preventDefault();
      const b = Object.fromEntries(new FormData(f));
      const r = await api(`/api/sellers/${f.dataset.seller}/campaigns/${b.productId}`, { method: "PUT", body: { campaignId: b.campaignId } });
      if (!r.ok) return toast(r.data.error, true);
      toast("Campanha registrada.");
      loadOffers();
    }));
    const previewBtn=$("commercePreviewBtn");
    if(previewBtn) previewBtn.onclick=async()=>{
      const body={productId:$("commercePreviewProduct").value,campaignId:$("commercePreviewCampaign").value||null,territory:$("commercePreviewTerritory").value||'GLOBAL'};
      const r=await api('/api/commerce/resolve-preview',{method:'POST',body});
      $("commercePreviewResult").textContent=r.ok?`Política: ${r.data.resolution.strategy} · ${r.data.offers.length} oferta(s) elegível(is)`:(r.data.error||(r.data.errors||[]).join(' '));
      $("commercePreviewOffers").innerHTML=r.ok?r.data.offers.map((o,i)=>`<div class="agreement"><b>${i+1}. ${esc((o.provider||{}).name||o.providerId)}</b> · ${o.price==null?'preço sob consulta':brl(o.price)} · ${esc(o.cta||'BUY')} · ${esc(o.territory||'GLOBAL')}</div>`).join(''):'';
    };
    await loadFinanceOps();
  }

  async function loadFinanceOps(){
    if(!$("financeBalances")) return;
    const [bal,conns,settlements,payouts,recons]=await Promise.all([
      api('/api/payments/balances'),api('/api/payments/connections'),api('/api/payments/settlements'),api('/api/payments/payouts'),api('/api/payments/reconciliation')
    ]);
    if(!bal.ok){$("financeMsg").textContent=bal.data.error||'Financeiro indisponível.';return;}
    $("financeBalances").innerHTML=[['Recebível no processor',bal.data.processorReceivable],['Caixa liquidado',bal.data.bankCash],['A pagar',bal.data.merchantPayable],['Fees',bal.data.processorFees]].map(([k,v])=>`<div class="tile"><b>${brl(v||0)}</b><span>${esc(k)}</span></div>`).join('');
    const managed=(conns.ok?conns.data:[]).filter(c=>c.mode==='MANAGED');
    $("financeConnection").innerHTML=managed.map(c=>`<option value="${esc(c.id)}">${esc(c.label)} · ${esc((c.provider||{}).name||c.providerId)}</option>`).join('')||'<option value="">— nenhuma conexão MANAGED —</option>';
    const rows=[];
    for(const x of (settlements.ok?settlements.data:[]).slice(0,4)) rows.push(`<div class="agreement"><b>Settlement</b> ${brl(x.net_amount??x.netAmount??0)} · ${esc(x.status||'')}</div>`);
    for(const x of (payouts.ok?payouts.data:[]).slice(0,4)) rows.push(`<div class="agreement"><b>Payout</b> ${brl(x.amount||0)} · ${esc(x.status||'')}</div>`);
    for(const x of (recons.ok?recons.data:[]).slice(0,3)) rows.push(`<div class="agreement"><b>Conciliação</b> ${esc(x.status||'')} · exceções ${x.exception_count??x.exceptionCount??0}</div>`);
    $("financeOps").innerHTML=rows.join('')||'<p class="help">Nenhuma operação financeira registrada.</p>';
    $("financeRefresh").onclick=loadFinanceOps;
    $("settlementBtn").onclick=async()=>{const connectionId=$("financeConnection").value,gross=Number($("settleGross").value),fees=Number($("settleFees").value||0);if(!connectionId)return toast('Crie/configure uma conexão MANAGED primeiro.',true);const r=await api('/api/payments/settlements',{method:'POST',headers:{'Idempotency-Key':`studio-settle-${Date.now()}`},body:{connectionId,grossAmount:gross,fees,netAmount:gross-fees,currency:'BRL'}});$("financeMsg").textContent=r.ok?'Settlement registrado.':(r.data.message||r.data.error||(r.data.errors||[]).join(' '));if(r.ok)loadFinanceOps();};
    $("payoutBtn").onclick=async()=>{const amount=Number($("payoutAmount").value);const r=await api('/api/payments/payouts',{method:'POST',headers:{'Idempotency-Key':`studio-payout-${Date.now()}`},body:{amount,currency:'BRL'}});$("financeMsg").textContent=r.ok?'Payout solicitado.':(r.data.message||r.data.error||(r.data.errors||[]).join(' '));if(r.ok)loadFinanceOps();};
  }

  // ================================================================ moderação
  const RULES = { preco_divergente: "Cobrança acima do preço garantido", cupom_reutilizado: "Cupom usado em mais de um pedido", autocompra: "Autocompra", pico: "Pico de vendas", valor_elevado: "Comissão elevada", volume_mensal: "Volume mensal", pep: "Pessoa politicamente exposta" };
  const ALERT_ST = { aberto: ["Aberto", "frozen"], sem_irregularidade: ["Sem irregularidade", "free"], comunicado: ["Comunicado ao COAF", "rev"] };
  const ACTIONS = {
    login: "Login", login_falhou: "Login recusado", conta_criada: "Conta criada", logout_todos: "Saiu de todos os aparelhos",
    trilha_publicada: "Trilha publicada", trilha_editada: "Trilha editada", trilha_em_revisao: "Trilha em revisão (denúncias)",
    moderacao_trilha: "Moderação de trilha", kyc_enviado: "KYC enviado", kyc_decisao: "Decisão de KYC", saque: "Saque",
    alerta_aml: "Alerta AML gerado", alerta_decisao: "Decisão sobre alerta", alerta_vendedor: "Alerta contra vendedor",
    oferta_oficial_definida: "Oferta oficial definida", oferta_oficial_removida: "Oferta oficial removida",
    pedido_confirmado: "Pedido confirmado pela loja", relatorio_conciliado: "Relatório de vendas conciliado", cupons_recebidos: "Lote de cupons carregado",
    cupons_esgotados: "Cupons esgotados", cupom_reutilizado: "Cupom reutilizado", campanha_registrada: "Campanha registrada", pedido_devolvido: "Pedido devolvido", preco_divergente: "Preço acima do garantido", aviso_pedido_recusado: "Aviso de pedido recusado",
  };

  async function loadModeration() {
    const [kyc, alerts, aud] = await Promise.all([api("/api/aml/kyc"), api("/api/aml/alerts"), api("/api/audit?n=40")]);

    // KYC em análise
    $("kycQueue").innerHTML = kyc.data.length ? kyc.data.map((a) => `
      <div class="qrow"><div><b>${esc(a.name)}</b> <span class="help">${esc(a.type || "")} · ${esc(a.document || "")}${a.pep ? ' · <span class="pill frozen">PEP</span>' : ""}</span></div>
        <div class="actions"><button data-kyc="aprovado" data-id="${a.id}">Aprovar</button><button class="danger" data-kyc="reprovado" data-id="${a.id}">Reprovar</button></div></div>`).join("")
      : `<p class="help">Nenhum cadastro aguardando análise.</p>`;
    $("kycQueue").querySelectorAll("[data-kyc]").forEach((b) => (b.onclick = async () => {
      await api(`/api/aml/kyc/${b.dataset.id}`, { method: "POST", body: { status: b.dataset.kyc } });
      toast(b.dataset.kyc === "aprovado" ? "Cadastro aprovado." : "Cadastro reprovado.");
      loadModeration();
    }));

    // Alertas de AML
    const open = alerts.data.filter((a) => a.status === "aberto").length;
    $("amlCount").textContent = open ? `${open} aberto(s)` : "nenhum aberto";
    $("amlList").innerHTML = alerts.data.length ? alerts.data.map((a) => {
      const [lbl, cls] = ALERT_ST[a.status];
      return `<div class="alert ${a.status}">
        <div class="head-row"><div>
          <b>${RULES[a.rule] || a.rule}</b> · ${esc(a.authorName || a.authorId)}
          <span class="pill ${a.severity === "alta" ? "rev" : "frozen"}">${a.severity === "alta" ? "Grave: bloqueia saque" : "Atenção"}</span>
          <div class="help">${esc(a.detail)} · ${new Date(a.at).toLocaleDateString("pt-BR")}</div>
          ${a.note ? `<div class="help">Parecer (${esc(a.decidedBy)}): ${esc(a.note)}</div>` : ""}
        </div><span class="pill ${cls}">${lbl}</span></div>
        ${a.status === "aberto" ? `<div class="decide">
          <input placeholder="Parecer / fundamento (obrigatório para comunicar)" data-note="${a.id}" />
          <button data-alert="sem_irregularidade" data-id="${a.id}">Sem irregularidade</button>
          <button class="danger" data-alert="comunicado" data-id="${a.id}">Registrar comunicação</button></div>` : ""}
      </div>`;
    }).join("") : `<p class="help">Nenhum alerta.</p>`;
    $("amlList").querySelectorAll("[data-alert]").forEach((b) => (b.onclick = async () => {
      const note = $("amlList").querySelector(`[data-note="${b.dataset.id}"]`).value;
      const r = await api(`/api/aml/alerts/${b.dataset.id}`, { method: "POST", body: { decision: b.dataset.alert, note } });
      if (!r.ok) return toast(r.data.error, true);
      toast("Decisão registrada na auditoria.");
      loadModeration();
    }));

    // Auditoria
    const I = aud.data.integrity;
    $("auditIntegrity").innerHTML = I.ok ? `<span class="pill free">Cadeia íntegra · ${I.total} registros</span>` : `<span class="pill rev">Cadeia quebrada no registro ${I.brokenAt}</span>`;
    $("auditBody").innerHTML = aud.data.entries.map((e) => `<tr><td>${e.seq}</td><td>${new Date(e.at).toLocaleString("pt-BR")}</td><td>${esc(e.actor)}</td>
      <td>${ACTIONS[e.action] || esc(e.action)}</td><td class="mono" title="${esc(JSON.stringify(e.data))}">${esc(Object.entries(e.data).map(([k, v]) => `${k}: ${v}`).join(" · ").slice(0, 90))}</td><td class="mono">${e.hash.slice(0, 10)}…</td></tr>`).join("");

    const list = (await api("/api/moderation")).data;
    $("modList").innerHTML = list.map((t) => `
      <div class="card mod ${t.status}">
        <div class="head-row">
          <div>
            <div class="mod-title"><span class="seal ${t.type === "official" ? "is-official" : "is-community"}">${t.type === "official" ? "Oficial" : "Comunidade"}</span>
              <b>${esc(t.title)}</b> <span class="help">por ${esc(t.author.name)}</span></div>
            <div class="help">${t.scenes} cenas · ${t.products} produtos · ${t.approval != null ? `aprovação ${t.approval}% (${t.votes.up}/${t.votes.down})` : "sem votos ainda"} · ${t.reports} denúncias abertas (peso ${String(t.reportWeight).replace(".", ",")}) · nota ${t.score.toFixed(2).replace(".", ",")}</div>
          </div>
          <div class="actions">${statusTrack(t.status)}
            ${t.type === "community" && t.status !== "removida" ? `
              ${t.status === "em_revisao" ? `<button data-v="ok" data-id="${t.id}">Aprovar</button>` : ""}
              <button class="danger" data-v="fraude" data-id="${t.id}">Condenar</button>` : ""}
          </div>
        </div>
        ${t.reportList.length ? `<ul class="reports">${t.reportList.map((r) => `<li>${new Date(r.at).toLocaleDateString("pt-BR")} · cena ${esc(r.sceneId)} · ${esc(r.product || r.productId)} — ${esc(r.reason)}${r.resolved ? ` <em>(${r.resolved === "ok" ? "improcedente" : "procedente"})</em>` : ""}</li>`).join("")}</ul>` : ""}
      </div>`).join("");
    $("modList").querySelectorAll("[data-v]").forEach((b) => (b.onclick = async () => {
      await api(`/api/moderation/tracks/${b.dataset.id}`, { method: "POST", body: { verdict: b.dataset.v } });
      toast(b.dataset.v === "ok" ? "Trilha aprovada e valores descongelados." : "Trilha removida e comissões retidas estornadas.");
      loadModeration();
    }));
  }

  // ================================================================ piloto: ferramentas de vídeo
  // Vídeo auxiliar (fora da tela) para analisar quadros sem mexer no player do editor
  let probeVideo = null;
  function helperVideo() {
    const w = st.works.find((x) => x.id === st.workId);
    if (!probeVideo) { probeVideo = document.createElement("video"); probeVideo.muted = true; probeVideo.preload = "auto"; probeVideo.playsInline = true; }
    if (probeVideo.getAttribute("src") !== w.video) probeVideo.src = w.video;
    return probeVideo;
  }
  function seekTo(v, t) {
    return new Promise((resolve, reject) => {
      const done = () => { clearTimeout(to); v.removeEventListener("seeked", done); resolve(); };
      const to = setTimeout(() => { v.removeEventListener("seeked", done); reject(new Error("seek")); }, 4000);
      v.addEventListener("seeked", done);
      v.currentTime = Math.max(0, Math.min(t, (v.duration || st.duration) - 0.05));
    });
  }
  async function ready(v) {
    if (v.readyState >= 1) return;
    await new Promise((res, rej) => { v.addEventListener("loadedmetadata", res, { once: true }); v.addEventListener("error", () => rej(new Error("video")), { once: true }); });
  }
  async function captureThumb(t) {
    const v = helperVideo();
    await ready(v);
    await seekTo(v, t);
    const c = document.createElement("canvas");
    c.width = 480; c.height = Math.round(480 * (v.videoHeight || 9) / (v.videoWidth || 16));
    c.getContext("2d").drawImage(v, 0, 0, c.width, c.height);
    const r = await api("/api/uploads-thumb", { method: "POST", body: { dataUrl: c.toDataURL("image/jpeg", 0.82) } });
    if (!r.ok) throw new Error(r.data.error);
    return r.data.url;
  }

  // Detecção de cortes: compara quadros em sequência; mudança brusca = corte de cena
  let detectArmed = false;
  $("detectBtn").onclick = async () => {
    const hasProducts = st.track.scenes.some((s) => s.products.length);
    if (hasProducts && !detectArmed) {
      detectArmed = true;
      $("detectBtn").textContent = "Substituir as cenas atuais? Clique de novo";
      setTimeout(() => { detectArmed = false; $("detectBtn").textContent = "Detectar cortes"; }, 5000);
      return;
    }
    detectArmed = false;
    const btn = $("detectBtn");
    btn.disabled = true;
    try {
      const v = helperVideo();
      await ready(v);
      const dur = v.duration || st.duration;
      const step = dur > 900 ? 1 : 0.5;
      const W = 64, H = 36, c = document.createElement("canvas");
      c.width = W; c.height = H;
      const ctx = c.getContext("2d", { willReadFrequently: true });
      let prev = null; const diffs = [];
      for (let t = 0; t < dur; t += step) {
        await seekTo(v, t);
        ctx.drawImage(v, 0, 0, W, H);
        const d = ctx.getImageData(0, 0, W, H).data;
        const g = new Float32Array(W * H);
        for (let i = 0; i < g.length; i++) g[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
        if (prev) { let s = 0; for (let i = 0; i < g.length; i++) s += Math.abs(g[i] - prev[i]); diffs.push({ t, v: s / g.length / 255 }); }
        prev = g;
        btn.textContent = `Analisando… ${Math.round((t / dur) * 100)}%`;
      }
      // corte = diferença alta e bem acima da média local, com pelo menos 1,5 s entre cortes
      const cuts = [];
      diffs.forEach((d, i) => {
        const win = diffs.slice(Math.max(0, i - 6), i).map((x) => x.v);
        const avg = win.length ? win.reduce((a, b) => a + b, 0) / win.length : 0;
        const isPeak = (!diffs[i + 1] || d.v >= diffs[i + 1].v) && (!diffs[i - 1] || d.v >= diffs[i - 1].v);
        if (d.v > 0.12 && d.v > avg * 2.5 && isPeak && (!cuts.length || d.t - cuts[cuts.length - 1] >= 1.5) && d.t > 1 && dur - d.t > 1) cuts.push(Math.round(d.t * 10) / 10);
      });
      const bounds = [0, ...cuts, Math.round(dur * 10) / 10];
      st.track.scenes = bounds.slice(0, -1).map((b, i) => ({ id: `c${i + 1}`, title: `Cena ${i + 1}`, start: b, end: bounds[i + 1], products: [] }));
      st.sel = 0;
      renderAll();
      toast(`${st.track.scenes.length} cena(s) encontradas. Confira os cortes e dê nome às cenas.`);
    } catch (e) {
      toast("Não foi possível analisar o vídeo neste navegador.", true);
    }
    btn.disabled = false;
    btn.textContent = "Detectar cortes";
  };

  // Uma cena só: o vídeo inteiro vira uma cena, com todos os produtos já marcados
  $("oneSceneBtn").onclick = () => {
    const seen = new Set(), products = [];
    st.track.scenes.forEach((s) => s.products.forEach((p) => { if (!seen.has(p.id)) { seen.add(p.id); products.push(p); } }));
    const title = st.track.scenes.length === 1 ? st.track.scenes[0].title : "Cena única";
    st.track.scenes = [{ id: "c1", title, start: 0, end: Math.round((st.duration || helperVideo().duration || 0) * 10) / 10, products }];
    st.sel = 0;
    renderAll();
    toast("O vídeo inteiro agora é uma cena só.");
  };

  // ================================================================ piloto: obras
  function upload(url, file, onProgress) {
    return new Promise((resolve) => {
      const x = new XMLHttpRequest();
      x.open("POST", url);
      x.setRequestHeader("Authorization", `Bearer ${token}`);
      x.setRequestHeader("Content-Type", "application/octet-stream");
      x.upload.onprogress = (e) => e.lengthComputable && onProgress && onProgress(e.loaded / e.total);
      x.onload = () => { let d = {}; try { d = JSON.parse(x.responseText); } catch (e) {} resolve({ ok: x.status < 300, data: d }); };
      x.onerror = () => resolve({ ok: false, data: { error: "Falha de conexão durante o envio." } });
      x.send(file);
    });
  }
  function progress(el, frac, label) {
    el.hidden = false;
    el.querySelector("div").style.width = `${Math.round(frac * 100)}%`;
    el.querySelector("span").textContent = label || `${Math.round(frac * 100)}%`;
  }
  const fmtDur = (s) => `${Math.floor(s / 60)} min ${String(Math.round(s % 60)).padStart(2, "0")} s`;

  // Ao escolher o arquivo: confere se o navegador toca e mede a duração
  let probed = null;
  $("workFile").onchange = () => {
    probed = null;
    const f = $("workFile").files[0], box = $("workProbe");
    if (!f) return (box.hidden = true);
    if (!$("workTitle").value) $("workTitle").value = f.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ");
    const v = document.createElement("video");
    v.muted = true; v.preload = "auto"; v.src = URL.createObjectURL(f);
    box.hidden = false; box.className = "probe"; box.textContent = "Lendo o vídeo…";
    v.onloadeddata = async () => {
      try { await seekTo(v, Math.min(3, v.duration * 0.1)); } catch (e) {}
      const c = document.createElement("canvas"); c.width = 480; c.height = Math.round(480 * v.videoHeight / v.videoWidth) || 270;
      c.getContext("2d").drawImage(v, 0, 0, c.width, c.height);
      probed = { duration: v.duration, poster: c.toDataURL("image/jpeg", 0.8) };
      box.innerHTML = `<img src="${probed.poster}" alt=""/><span>${v.videoWidth}×${v.videoHeight} · ${fmtDur(v.duration)} · ${(f.size / 1024 ** 2).toFixed(1)} MB<br>O navegador toca este vídeo.</span>`;
    };
    v.onerror = () => { box.className = "probe bad"; box.textContent = "Este navegador não consegue tocar esse arquivo. Exporte em MP4 (H.264 + AAC) e tente de novo."; };
  };

  $("workForm").onsubmit = async (e) => {
    e.preventDefault();
    const f = $("workFile").files[0];
    if (!f) return;
    if (!probed) return toast("Aguarde a leitura do vídeo (ou exporte em MP4 H.264).", true);
    $("workSend").disabled = true;
    const up = await upload(`/api/uploads/video?filename=${encodeURIComponent(f.name)}`, f, (x) => progress($("workProg"), x, `Enviando ${Math.round(x * 100)}%`));
    if (!up.ok) { $("workSend").disabled = false; return toast(up.data.error || "Falha no envio.", true); }
    const poster = await api("/api/uploads-thumb", { method: "POST", body: { dataUrl: probed.poster } });
    const r = await api("/api/works", { method: "POST", body: { title: $("workTitle").value, video: up.data.url, duration: probed.duration, poster: poster.ok ? poster.data.url : null } });
    $("workSend").disabled = false;
    if (!r.ok) return toast((r.data.errors || [r.data.error]).join(" "), true);
    progress($("workProg"), 1, "Obra cadastrada");
    $("workForm").reset(); $("workProbe").hidden = true; probed = null;
    toast(`“${r.data.title}” cadastrada. Agora é inventariar os produtos.`);
    await refreshWorks();
    loadWorks();
  };

  async function loadWorks() {
    const list = (await api("/api/me/works")).data || [];
    $("myWorks").innerHTML = list.length ? list.map((w) => `<div class="work">
        <img src="${esc(w.poster || "/media/products/placeholder.svg")}" alt=""/>
        <div class="wi"><b>${esc(w.title)}</b><span class="help">${fmtDur(w.duration)} · ${w.tracks.length} trilha(s)${w.tracks[0] ? ` · ${w.tracks[0].scenes} cenas · ${w.tracks[0].products} produtos` : ""}</span>
          <div class="wa"><button class="small primary" data-inv="${w.id}">Inventariar</button>
            <a class="ghost small" href="/assistir/${encodeURIComponent(w.id)}" target="_blank">Assistir</a>
            <button class="small" data-pil="${w.id}">Painel</button></div></div></div>`).join("")
      : `<p class="help">Nenhuma obra ainda. Envie o primeiro vídeo acima.</p>`;
    $("myWorks").querySelectorAll("[data-inv]").forEach((b) => (b.onclick = async () => { await selectWork(b.dataset.inv); showTab("editor"); }));
    $("myWorks").querySelectorAll("[data-pil]").forEach((b) => (b.onclick = () => { st.pilotWork = b.dataset.pil; showTab("piloto"); }));
  }

  // ================================================================ piloto: produtos com fotos
  const niceName = (file) => file.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim().replace(/^./, (c) => c.toUpperCase());
  let drafts = [];

  $("photoSend").onclick = async () => {
    const files = [...$("photoFiles").files];
    if (!files.length) return toast("Selecione as fotos primeiro.", true);
    $("photoSend").disabled = true;
    const urls = [];
    for (let i = 0; i < files.length; i++) {
      const r = await upload(`/api/uploads/image?filename=${encodeURIComponent(files[i].name)}`, files[i], (x) => progress($("photoProg"), (i + x) / files.length, `Foto ${i + 1} de ${files.length}`));
      if (r.ok) urls.push({ url: r.data.url, name: files[i].name });
      else toast(`${files[i].name}: ${r.data.error}`, true);
    }
    $("photoSend").disabled = false;
    progress($("photoProg"), 1, `${urls.length} foto(s) enviadas`);
    $("photoFiles").value = "";
    if (!urls.length) return;
    if ($("photoMode").value === "one") drafts.push({ name: niceName(urls[0].name), images: urls.map((u) => u.url) });
    else urls.forEach((u) => drafts.push({ name: niceName(u.name), images: [u.url] }));
    renderDrafts();
  };

  const money2 = (v) => Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  function productForm(p, key) {
    const o = p.offer && p.offer.sellerId === "loja-piloto" ? p.offer : null;
    return `<form class="pedit" data-key="${key}">
      <div class="gal">
        <img class="main" src="${esc(p.images[0] || "/media/products/placeholder.svg")}" alt=""/>
        <div class="row2">${p.images.map((u, i) => `<span class="th ${i ? "" : "on"}"><img src="${esc(u)}" data-main="${i}" alt="" title="Tornar foto principal"/><button type="button" data-rmimg="${i}" aria-label="Remover foto">×</button></span>`).join("")}</div>
        <label class="help">Adicionar fotos <input type="file" accept="image/jpeg,image/png,image/webp" multiple data-addimg /></label>
      </div>
      <div class="fields">
        <label class="full">Nome <input name="name" value="${esc(p.name)}" required /></label>
        <label>Marca <input name="brand" value="${esc(p.brand && p.brand !== "Sem marca" ? p.brand : "")}" /></label>
        <label>Categoria <input name="category" value="${esc(p.category && p.category !== "Outros" ? p.category : "")}" placeholder="Moda, Casa, Beleza…" /></label>
        <label>SKU / código <input name="sku" value="${esc(p.sku || "")}" /></label>
        <label>Preço de tabela (R$) <input name="referencePrice" inputmode="decimal" value="${p.referencePrice != null ? money2(p.referencePrice) : ""}" required /></label>
        <label class="full">Descrição <textarea name="description" maxlength="1200">${esc(p.description || "")}</textarea></label>
        ${st.hasPilotSeller ? `<div class="mkt">
          <label class="chk"><input type="checkbox" name="sell" ${o || !p.id ? "checked" : ""}/> Vender no Marketplace Piloto</label>
          <label>Preço garantido em cena (R$) <input name="offerPrice" inputmode="decimal" value="${o ? money2(o.price) : ""}" placeholder="igual ao de tabela" /></label>
          <label>Comissão (%) <input name="commission" type="number" min="1" max="50" step="0.5" value="${o ? +(o.commission * 100).toFixed(1) : 10}" /></label>
        </div>` : ""}
        <div class="foot"><span class="msg" data-msg></span>${p.id ? "" : `<button type="button" class="ghost small" data-discard>Descartar</button>`}<button class="primary">${p.id ? "Salvar alterações" : "Salvar produto"}</button></div>
      </div>
    </form>`;
  }

  function bindProductForm(form, p, onSaved) {
    const refresh = () => { const f = form.parentNode; const n = document.createElement("div"); n.innerHTML = productForm(p, form.dataset.key); const nf = n.firstElementChild; f.replaceChild(nf, form); bindProductForm(nf, p, onSaved); };
    form.querySelectorAll("[data-main]").forEach((img) => (img.onclick = () => { const i = Number(img.dataset.main); p.images.unshift(...p.images.splice(i, 1)); refresh(); }));
    form.querySelectorAll("[data-rmimg]").forEach((b) => (b.onclick = () => { p.images.splice(Number(b.dataset.rmimg), 1); refresh(); }));
    form.querySelector("[data-addimg]").onchange = async (e) => {
      for (const f of e.target.files) { const r = await upload(`/api/uploads/image?filename=${encodeURIComponent(f.name)}`, f); if (r.ok) p.images.push(r.data.url); else toast(r.data.error, true); }
      refresh();
    };
    const dis = form.querySelector("[data-discard]");
    if (dis) dis.onclick = () => { drafts.splice(Number(form.dataset.key.slice(1)), 1); renderDrafts(); };
    form.onsubmit = async (e) => {
      e.preventDefault();
      const fd = Object.fromEntries(new FormData(form));
      const body = { name: fd.name, brand: fd.brand, category: fd.category, sku: fd.sku, referencePrice: fd.referencePrice, description: fd.description, images: p.images };
      const r = p.id ? await api(`/api/products/${p.id}`, { method: "PUT", body }) : await api("/api/products", { method: "POST", body });
      const msg = form.querySelector("[data-msg]");
      if (!r.ok) { msg.className = "msg bad"; msg.textContent = (r.data.errors || [r.data.error]).join(" "); return; }
      const saved = r.data;
      // vitrine do piloto: oferta com preço garantido (ou remove)
      const wantsSell = !!fd.sell;
      const hadPilot = p.offer && p.offer.sellerId === "loja-piloto";
      if (wantsSell) {
        const price = fd.offerPrice ? Number(String(fd.offerPrice).replace(/\./g, "").replace(",", ".")) : saved.referencePrice;
        const o = await api(`/api/official-offers/${saved.id}`, { method: "PUT", body: { sellerId: "loja-piloto", price, commission: Number(fd.commission) / 100, validDays: 180 } });
        if (!o.ok) { msg.className = "msg bad"; msg.textContent = (o.data.errors || [o.data.error]).join(" "); return; }
      } else if (hadPilot) {
        await api(`/api/official-offers/${saved.id}`, { method: "PUT", body: {} });
      }
      toast(`“${saved.name}” salvo${wantsSell ? " e à venda no Marketplace Piloto" : ""}.`);
      onSaved();
    };
  }

  function renderDrafts() {
    $("drafts").innerHTML = drafts.length ? `<div class="card"><h3>Completar ${drafts.length} produto(s)</h3><div class="plist">${drafts.map((d, i) => productForm({ ...d }, "d" + i)).join("")}</div></div>` : "";
    $("drafts").querySelectorAll("form").forEach((f) => {
      const i = Number(f.dataset.key.slice(1));
      bindProductForm(f, drafts[i], () => { drafts.splice(i, 1); renderDrafts(); loadMyProducts(); });
    });
  }

  async function loadMyProducts() {
    const list = (await api("/api/me/products")).data || [];
    $("myProducts").innerHTML = list.length ? list.map((p) => productForm({ ...p, images: p.images && p.images.length ? p.images : [p.image] }, "p" + p.id)).join("")
      : `<p class="help">Nenhum produto cadastrado ainda.</p>`;
    $("myProducts").querySelectorAll("form").forEach((f, i) => {
      const p = { ...list[i], images: list[i].images && list[i].images.length ? [...list[i].images] : [list[i].image] };
      bindProductForm(f, p, loadMyProducts);
    });
  }

  // ================================================================ piloto: painel
  async function loadPilot() {
    const mine = st.works.filter((w) => w.pilot || w.id === "demo-01");
    const cur = st.pilotWork || (mine.find((w) => w.pilot) || mine[0] || {}).id;
    $("pilotWork").innerHTML = mine.map((w) => `<option value="${w.id}" ${w.id === cur ? "selected" : ""}>${esc(w.title)}</option>`).join("");
    if (!cur) return;
    st.pilotWork = cur;
    const w = st.works.find((x) => x.id === cur);
    $("pilotWatch").href = w && w.pilot ? `/assistir/${encodeURIComponent(cur)}` : "/parceiro/aurora.html";
    const r = await api(`/api/me/pilot?work=${encodeURIComponent(cur)}`);
    if (!r.ok) { $("pilotTiles").innerHTML = `<p class="help">${esc(r.data.error || "Sem dados.")}</p>`; return; }
    const d = r.data, k = d.kpis;
    $("pilotTiles").innerHTML = [
      ["Espectadores", k.viewers, "iniciaram a exibição", "hold"],
      ["Abertura do painel", k.panelRate + "%", "dos espectadores", "kyc"],
      ["Conversão", k.conversion + "%", "de quem clicou em comprar", "free"],
      ["Receita", brl(k.revenue), `${k.orders} pedido(s)`, "paid"],
      ["Comissão", brl(k.commission), k.viewers >= 100 ? `${brl(k.revenuePer1000)} por mil espectadores` : "sobre as vendas atribuídas", "frozen"],
    ].map(([l, v, s, c]) => `<div class="tile ${c}"><div class="lbl">${l}</div><div class="val">${v}</div><div class="sub">${s}</div></div>`).join("");
    const top = Math.max(1, ...d.funnel.map((f) => f.value));
    $("pilotFunnel").innerHTML = d.funnel.map((f) => `<div class="fr"><span>${esc(f.step)}</span><div class="bar"><div style="width:${(f.value / top) * 100}%"></div></div><b>${f.value}</b></div>`).join("");
    $("pilotScenes").innerHTML = d.byScene.length ? d.byScene.map((s) => `<tr><td>${s.thumb ? `<img class="sthumb" src="${esc(s.thumb)}" alt=""/>` : ""}${esc(s.title)}</td><td>${fmtT(s.start)}–${fmtT(s.end)}</td><td class="num">${s.products}</td><td class="num">${s.panelOpens}</td><td class="num">${s.clicks}</td></tr>`).join("")
      : `<tr><td colspan="5" class="empty">Publique uma trilha para ver os dados por cena.</td></tr>`;
    $("pilotProducts").innerHTML = d.byProduct.length ? d.byProduct.map((p) => `<tr><td>${esc(p.name)}</td><td class="num">${p.clicks}</td><td class="num">${p.orders}</td><td class="num">${brl(p.revenue)}</td><td class="num">${brl(p.commission)}</td></tr>`).join("")
      : `<tr><td colspan="5" class="empty">Nenhum clique ainda.</td></tr>`;
    const ST = { pago: ["Pago", "free"], aguardando_pagamento: ["Aguardando Pix", "hold"], cancelado: ["Cancelado", "rev"] };
    $("pilotOrders").innerHTML = d.orders.length ? d.orders.map((o) => `<tr><td>${esc(o.number)}</td><td>${new Date(o.at).toLocaleString("pt-BR")}</td><td>${o.items.map((i) => `${i.qty}× ${esc(i.name)}`).join(", ")}</td><td class="num">${brl(o.total)}</td><td><span class="pill ${ST[o.status][1]}">${ST[o.status][0]}</span></td></tr>`).join("")
      : `<tr><td colspan="5" class="empty">Nenhum pedido ainda.</td></tr>`;
  }
  $("pilotWork").onchange = (e) => { st.pilotWork = e.target.value; loadPilot(); };
  $("pilotRefresh").onclick = () => loadPilot();

  // ================================================================ v0.15: IA & Publicação operacional
  const aiOps = { workId: null, data: null, poll: null };
  const aiOpsFmt = (s) => Number.isFinite(Number(s)) ? `${Math.floor(Number(s)/60)}:${String(Math.floor(Number(s)%60)).padStart(2,"0")}` : "—";
  const aiOpsLatestVerification = (candidateId) => {
    const rows=(aiOps.data&&aiOps.data.verifications||[]).filter(v=>v.candidateId===candidateId).sort((a,b)=>Number(b.checkedAt||0)-Number(a.checkedAt||0));
    return rows[0]||null;
  };
  const aiOpsOpenFlag = (candidateId) => (aiOps.data&&aiOps.data.flags||[]).find(f=>f.candidateId===candidateId&&f.status==='OPEN')||null;
  const aiOpsAssetName = (id) => ((aiOps.data&&aiOps.data.assets||[]).find(a=>a.id===id)||{}).name || id || "—";

  async function loadAiOps() {
    if (!organizationId) return;
    clearTimeout(aiOps.poll);
    const worksR=await api('/api/me/works');
    const works=worksR.ok&&Array.isArray(worksR.data)?worksR.data:[];
    if(!works.length){
      $("aiOpsWork").innerHTML='<option value="">Nenhuma obra</option>';
      $("aiOpsReview").innerHTML='<div class="empty-state">Envie uma obra na aba Obras para iniciar o pipeline de IA.</div>';
      return;
    }
    const select=$("aiOpsWork");
    const wanted=aiOps.workId||st.workId||works[0].id;
    select.innerHTML=works.map(w=>`<option value="${esc(w.id)}"${w.id===wanted?' selected':''}>${esc(w.title)}</option>`).join('');
    aiOps.workId=select.value||works[0].id;
    const [r,policyR]=await Promise.all([api(`/api/ai/workspace?workId=${encodeURIComponent(aiOps.workId)}`),api(`/api/distribution/works/${encodeURIComponent(aiOps.workId)}/timeline-policy`)]);
    if(!r.ok){$("aiOpsReview").innerHTML=`<div class="empty-state bad">${esc(r.data.error||'Falha ao carregar o workspace de IA.')}</div>`;return;}
    aiOps.data={...r.data, timelinePolicy:policyR.ok?policyR.data:null}; renderAiOps();
    if((r.data.jobs||[]).some(j=>['QUEUED','RUNNING'].includes(j.status))) aiOps.poll=setTimeout(loadAiOps,2500);
  }

  function renderAiOps(){
    const d=aiOps.data||{},assets=d.assets||[],jobs=d.jobs||[],cands=d.candidates||[],flags=d.flags||[],placements=d.placements||[];
    const openFlags=flags.filter(f=>f.status==='OPEN').length,approved=cands.filter(c=>c.reviewStatus==='APPROVED').length;
    $("aiOpsKpis").innerHTML=[
      ['Ativos comerciais',assets.length,'Inventário governado'],
      ['Identificações',cands.length,`${approved} aprovadas`],
      ['Flags abertas',openFlags,openFlags?'exigem operador':'sem pendências'],
      ['Placements',placements.length,'aprovados']
    ].map(([l,v,s])=>`<div class="aiops-kpi"><span>${esc(l)}</span><b>${esc(v)}</b><small>${esc(s)}</small></div>`).join('');

    const mode=$("aiOpsMode").value;
    $("aiOpsAssets").innerHTML=assets.length?assets.map(a=>`<label class="asset-chip"><input type="checkbox" value="${esc(a.id)}" ${mode==='DISCOVERY'?'disabled':''}/><span><b>${esc(a.name)}</b><small>${esc([a.brand,a.model,a.category].filter(Boolean).join(' · '))}</small></span></label>`).join(''):'<div class="empty-state">Nenhum Commercial Asset cadastrado ainda.</div>';

    $("aiOpsJobs").innerHTML=jobs.length?jobs.slice(0,8).map(j=>`<div class="stack-row"><div><b>${esc(j.mode)}</b> · ${esc(j.scanDepth||'STANDARD')}<small>${new Date(j.createdAt).toLocaleString('pt-BR')} · ${esc(j.primaryProvider||'SceneShop')}</small></div><span class="status-pill ${String(j.status||'').toLowerCase()}">${esc(j.status)}</span></div>`).join(''):'<div class="empty-state">Nenhuma análise persistente desta obra.</div>';

    const verBy=new Map();(d.verifications||[]).forEach(v=>{if(!verBy.has(v.candidateId))verBy.set(v.candidateId,[]);verBy.get(v.candidateId).push(v);});
    $("aiOpsReview").innerHTML=cands.length?cands.map(c=>{
      const ver=(verBy.get(c.id)||[]).sort((a,b)=>Number(b.checkedAt||0)-Number(a.checkedAt||0))[0]||null;
      const flag=aiOpsOpenFlag(c.id); const locked=['APPROVED','REJECTED'].includes(c.reviewStatus);
      const assetOptions=assets.map(a=>`<option value="${esc(a.id)}"${a.id===(c.resolvedAssetId||c.assetId)?' selected':''}>${esc(a.name)}</option>`).join('');
      return `<article class="review-card ${flag?'has-flag':''}" data-candidate="${esc(c.id)}">
        <div class="review-time"><b>${aiOpsFmt(c.startSeconds)}–${aiOpsFmt(c.endSeconds)}</b><span>${Math.round(Number(c.primaryConfidence||0)*100)}%</span></div>
        <div class="review-main"><div class="review-title"><b>${esc(c.candidateName||aiOpsAssetName(c.assetId)||'Item detectado')}</b><span class="status-pill ${String(c.reviewStatus||'').toLowerCase()}">${esc(c.reviewStatus)}</span></div>
          <p>${esc(c.candidateDescription||[c.proposedBrand,c.proposedModel,c.category].filter(Boolean).join(' · ')||'Sem descrição adicional.')}</p>
          <div class="evidence-line"><span>Primário <b>congelado</b></span><span>SHA ${esc(String(c.primaryFingerprint||'').slice(0,12))}…</span>${ver?`<span>Redundância <b>${esc(ver.state)}</b> · ${esc(ver.provider)}</span>`:'<span>Redundância ainda não registrada</span>'}${flag?`<span class="flag-label">⚑ ${esc(flag.reason)}</span>`:''}</div>
        </div>
        <div class="review-actions"><select data-review-asset ${locked?'disabled':''}><option value="">Selecionar Commercial Asset…</option>${assetOptions}</select><textarea data-review-note placeholder="Nota do operador" ${locked?'disabled':''}></textarea><div class="row"><button class="primary small" data-review="APPROVE" ${locked?'disabled':''}>Aprovar</button><button class="ghost small danger" data-review="REJECT" ${locked?'disabled':''}>Rejeitar</button></div></div>
      </article>`;
    }).join(''):'<div class="empty-state">Nenhuma identificação para revisar nesta obra.</div>';

    $("aiOpsReview").querySelectorAll('[data-review]').forEach(btn=>btn.onclick=()=>reviewAiOps(btn.closest('[data-candidate]'),btn.dataset.review));

    $("aiOpsPlacements").innerHTML=placements.length?placements.map(p=>`<div class="stack-row"><div><b>${esc(aiOpsAssetName(p.assetId))}</b><small>${aiOpsFmt(p.displayStartSeconds)}–${aiOpsFmt(p.displayEndSeconds)} · físico ${aiOpsFmt(p.physicalStartSeconds)}–${aiOpsFmt(p.physicalEndSeconds)}</small></div><span class="status-pill approved">APPROVED</span></div>`).join(''):'<div class="empty-state">Nenhum placement aprovado ainda.</div>';

    const tl=d.timeline;
    $("aiOpsTimeline").innerHTML=tl&&tl.scenes&&tl.scenes.length?`<div class="timeline-meta"><b>rev. ${esc(tl.revision)}</b><span>${esc((tl.policy||{}).visibility||'PAST_AND_CURRENT')}</span><span>${tl.scenes.length} cenas comerciais</span></div><div class="timeline-rail">${tl.scenes.map(sc=>`<div class="timeline-event"><span>${aiOpsFmt(sc.start)}</span><b>${esc((sc.products||[]).map(p=>p.name).join(' · ')||'Placement')}</b><small>${aiOpsFmt(sc.end)}</small></div>`).join('')}</div>`:'<div class="empty-state">A Commerce Timeline ainda não foi publicada para esta obra.</div>';
    const pol=d.timelinePolicy||tl&&tl.policy||{};
    $("aiOpsVisibility").value=pol.visibility||'PAST_AND_CURRENT';
    $("aiOpsThumbs").checked=pol.thumbnailsEnabled!==false;
    $("aiOpsMissed").checked=pol.missedItemsEnabled!==false;
    $("aiOpsSeek").checked=!!pol.allowSceneSeek;
  }

  async function reviewAiOps(card,decision){
    const candidateId=card.dataset.candidate, assetId=card.querySelector('[data-review-asset]').value, note=card.querySelector('[data-review-note]').value.trim();
    if(decision==='APPROVE'&&!assetId)return toast('Selecione o Commercial Asset que será publicado.',true);
    const flag=aiOpsOpenFlag(candidateId);
    const url=flag?`/api/ai/operator-flags/${encodeURIComponent(flag.id)}/resolve`:`/api/ai/candidates/${encodeURIComponent(candidateId)}/review`;
    const r=await api(url,{method:'POST',body:{decision,assetId:assetId||undefined,note}});
    if(!r.ok)return toast(r.data.error||(r.data.errors||[]).join(' ')||'Falha na revisão.',true);
    toast(decision==='APPROVE'?'Placement aprovado.':'Identificação rejeitada.'); await loadAiOps();
  }

  $("aiOpsWork").onchange=()=>{aiOps.workId=$("aiOpsWork").value;loadAiOps();};
  $("aiOpsRefresh").onclick=loadAiOps;
  $("aiOpsMode").onchange=()=>renderAiOps();
  $("aiOpsRun").onclick=async()=>{
    const workId=$("aiOpsWork").value;if(!workId)return;
    const mode=$("aiOpsMode").value;
    const assetIds=[...$("aiOpsAssets").querySelectorAll('input:checked')].map(x=>x.value);
    const categories=[...$("aiOpsCategories").querySelectorAll('input:checked')].map(x=>x.value);
    if(mode==='TARGETED'&&!assetIds.length)return toast('TARGETED exige ao menos um ativo comercial.',true);
    if(mode==='HYBRID'&&!assetIds.length)return toast('HYBRID exige ao menos um ativo comercial.',true);
    const body={analysisMode:mode,assetIds,categories,scanDepth:$("aiOpsDepth").value,minimumConfidence:Number($("aiOpsConfidence").value||0.6),includeBackground:$("aiOpsBackground").checked};
    $("aiOpsRun").disabled=true;$("aiOpsRunMsg").textContent='Iniciando análise…';
    const r=await api(`/api/works/${encodeURIComponent(workId)}/ai`,{method:'POST',body});
    $("aiOpsRun").disabled=false;
    if(!r.ok){$("aiOpsRunMsg").textContent=r.data.error||(r.data.errors||[]).join(' ')||'Falha ao iniciar.';return;}
    $("aiOpsRunMsg").textContent=`Job ${r.data.analysisJob&&r.data.analysisJob.id||''} iniciado.`; aiOps.poll=setTimeout(loadAiOps,1000);
  };
  $("aiOpsToEditor").onclick=async()=>{const wid=$("aiOpsWork").value;if(wid){st.workId=wid;await selectWork(wid);}showTab('editor');};
  $("aiOpsSavePolicy").onclick=async()=>{
    const wid=$("aiOpsWork").value;if(!wid)return;
    const body={visibility:$("aiOpsVisibility").value,thumbnailsEnabled:$("aiOpsThumbs").checked,missedItemsEnabled:$("aiOpsMissed").checked,allowSceneSeek:$("aiOpsSeek").checked};
    const r=await api(`/api/distribution/works/${encodeURIComponent(wid)}/timeline-policy`,{method:'PUT',body});
    $("aiOpsPolicyMsg").textContent=r.ok?'Política atualizada.':(r.data.error||(r.data.errors||[]).join(' ')||'Falha ao salvar política.');
    if(r.ok)await loadAiOps();
  };

  // ================================================================ marcação com IA (Gemini)
  // O Gemini sugere cenas, itens, posições e o produto do catálogo; a produtora confirma.
  const ai = { job: null, poll: null, items: [], products: [] };
  const curWork = () => st.works.find((w) => w.id === st.workId) || {};
  const workUrl = (id) => `/api/works/${encodeURIComponent(id)}/ai`;

  async function refreshAi() {
    const w = curWork();
    const show = !!(st.user && st.user.role === "producer" && w.pilot);
    $("aiCard").hidden = !show;
    clearTimeout(ai.poll);
    if (!show) return;
    const s = (await api("/api/ai/status")).data || {};
    $("aiConnect").hidden = !!s.configured;
    $("aiKeyBox").hidden = true;
    $("aiRun").hidden = !s.configured;
    if (s.configured) showJob((await api(workUrl(w.id))).data);
  }

  function showJob(j) {
    clearTimeout(ai.poll);
    if (j && j.workId && j.workId !== st.workId) return;
    ai.job = j;
    const box = $("aiStatus");
    box.className = "ai-status";
    $("aiGo").disabled = !!(j && j.status === "rodando");
    if (!j || j.status === "nenhum") { box.innerHTML = ""; return; }
    if (j.status === "rodando") {
      box.innerHTML = `<span class="spin"></span><span>${esc(j.step || "analisando")}…</span>`;
      ai.poll = setTimeout(async () => showJob((await api(workUrl(j.workId))).data), 2500);
      return;
    }
    if (j.status === "erro") { box.className = "ai-status bad"; box.textContent = j.error; return; }
    const n = j.scenes.reduce((a, s) => a + s.items.length, 0);
    const m = j.scenes.reduce((a, s) => a + s.items.filter((i) => i.productId).length, 0);
    box.innerHTML = `<span>${j.scenes.length} cena(s) · ${n} item(ns) · ${m} com produto do catálogo${j.model ? ` · ${esc(j.model)}` : ""}</span><button class="small primary" id="aiOpen">Revisar sugestões</button>`;
    $("aiOpen").onclick = openAi;
  }

  $("aiGo").onclick = async () => {
    const r = await api(workUrl(st.workId), { method: "POST", body: { oneScene: $("aiMode").value === "unica" } });
    if (!r.ok) return toast(r.data.error || "Não foi possível iniciar a análise.", true);
    showJob(r.data);
  };

  const confClass = (c) => (c >= 0.75 ? "hi" : c >= 0.5 ? "mid" : "lo");
  const fmtS = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;

  async function openAi() {
    const j = ai.job;
    ai.products = (await api("/api/me/products")).data || [];
    ai.products.forEach((p) => (st.products[p.id] = st.products[p.id] || p));
    ai.items = [];
    const opts = (sel) => `<option value="">— sem produto —</option>` + ai.products.map((p) => `<option value="${esc(p.id)}" ${p.id === sel ? "selected" : ""}>${esc(p.name)}</option>`).join("");
    $("aiSub").textContent = `${j.scenes.length} cena(s) · marque o que está certo, troque o produto quando precisar e aplique. Nada vai ao ar antes de você publicar a trilha.`;
    $("aiBody").innerHTML = j.scenes.map((s, si) => `<section class="ai-scene"><h4>${esc(s.title)} <small>${fmtS(s.start)}–${fmtS(s.end)}</small></h4>${
      s.items.length ? s.items.map((it) => {
        ai.items.push({ ...it, si });
        const p = ai.products.find((x) => x.id === it.productId);
        const on = !!it.productId && it.confidence >= 0.5;
        return `<div class="ai-item ${on ? "" : "off"}" data-k="${it.key}">
          <input type="checkbox" ${on ? "checked" : ""} aria-label="Usar esta sugestão" />
          <canvas width="264" height="264"></canvas>
          <div><div class="nm">${esc(it.name)}</div><div class="ds">${esc(it.category)} · aparece em ${fmtS(it.t)}${it.description ? ` · ${esc(it.description)}` : ""}</div>${it.visibleText ? `<span class="vt">Na tela: ${esc(it.visibleText)}</span>` : ""}</div>
          <div class="ai-match">
            ${p ? `<span class="conf ${confClass(it.confidence)}">${Math.round(it.confidence * 100)}% de certeza</span>` : `<span class="conf lo">Sem produto no catálogo</span>`}
            <select aria-label="Produto">${opts(it.productId)}</select>
            <button type="button" class="ghost small" data-create>Criar produto com esta imagem</button>
          </div></div>`;
      }).join("") : `<p class="help">Nenhum item encontrado nesta cena.</p>`}</section>`).join("");
    $("aiBody").querySelectorAll(".ai-item").forEach((row) => {
      const it = ai.items.find((x) => x.key === row.dataset.k);
      const cb = row.querySelector("input[type=checkbox]"), sel = row.querySelector("select");
      cb.onchange = () => row.classList.toggle("off", !cb.checked);
      sel.onchange = () => { it.productId = sel.value || null; cb.checked = !!sel.value; row.classList.toggle("off", !cb.checked); };
      row.querySelector("[data-create]").onclick = () => createFromItem(it, row.querySelector("canvas"));
    });
    $("aiUseScenes").checked = true;
    $("aiModal").hidden = false;
    // miniaturas: o quadro do instante sugerido, recortado na caixa do item
    for (const row of $("aiBody").querySelectorAll(".ai-item")) {
      const it = ai.items.find((x) => x.key === row.dataset.k);
      try { await drawCrop(row.querySelector("canvas"), it.t, it.box); } catch (e) { /* segue sem miniatura */ }
      if ($("aiModal").hidden) break;
    }
  }

  async function drawCrop(canvas, t, box) {
    const v = helperVideo();
    await ready(v);
    await seekTo(v, t);
    const W = v.videoWidth, H = v.videoHeight;
    let side = Math.min(W, H), cx = W / 2, cy = H / 2;
    if (box) {
      const bw = (box.w / 100) * W, bh = (box.h / 100) * H;
      side = Math.min(Math.max(bw, bh) * 1.25, W, H);
      cx = ((box.x + box.w / 2) / 100) * W;
      cy = ((box.y + box.h / 2) / 100) * H;
    }
    const sx = Math.max(0, Math.min(W - side, cx - side / 2)), sy = Math.max(0, Math.min(H - side, cy - side / 2));
    canvas.getContext("2d").drawImage(v, sx, sy, side, side, 0, 0, canvas.width, canvas.height);
  }

  // item sem produto: vira um rascunho na aba Produtos, com a imagem recortada do vídeo
  async function createFromItem(it, canvas) {
    const big = document.createElement("canvas");
    big.width = big.height = 800;
    try { await drawCrop(big, it.t, it.box); } catch (e) { big.getContext("2d").drawImage(canvas, 0, 0, 800, 800); }
    const up = await api("/api/uploads-thumb", { method: "POST", body: { dataUrl: big.toDataURL("image/jpeg", 0.9) } });
    if (!up.ok) return toast(up.data.error || "Não foi possível salvar a imagem.", true);
    drafts.push({ name: it.name, category: it.category, description: [it.description, it.visibleText && `Na tela: ${it.visibleText}`].filter(Boolean).join(" "), images: [up.data.url] });
    $("aiModal").hidden = true;
    showTab("produtos");
    renderDrafts();
    toast("Rascunho criado com a imagem do vídeo. Complete o preço, salve e volte às sugestões.");
  }

  $("aiClose").onclick = () => ($("aiModal").hidden = true);
  $("aiModal").onclick = (e) => { if (e.target === $("aiModal")) $("aiModal").hidden = true; };
  $("aiApply").onclick = async () => {
    const j = ai.job;
    const useScenes = $("aiUseScenes").checked;
    const scenes = useScenes ? j.scenes.map((s) => ({ id: s.id, title: s.title, start: s.start, end: s.end, products: [] })) : st.track.scenes;
    let n = 0;
    for (const row of $("aiBody").querySelectorAll(".ai-item")) {
      const it = ai.items.find((x) => x.key === row.dataset.k);
      if (!row.querySelector("input[type=checkbox]").checked || !it.productId) continue;
      const target = useScenes ? scenes[it.si] : scenes.find((s) => it.t >= s.start && it.t < s.end) || scenes[scenes.length - 1];
      if (!target || target.products.some((p) => p.id === it.productId)) continue;
      if (!st.products[it.productId]) st.products[it.productId] = (await api(`/api/products/${encodeURIComponent(it.productId)}`)).data;
      target.products.push({ id: it.productId, match: "exato", box: it.box });
      n++;
    }
    st.track.scenes = scenes;
    st.sel = 0;
    renderAll();
    $("aiModal").hidden = true;
    toast(`${n} produto(s) aplicados${useScenes ? ` em ${scenes.length} cena(s)` : ""}. Confira as posições e publique a trilha.`);
  };
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("aiModal").hidden) $("aiModal").hidden = true; });

  // ================================================================ início
  (async function init() {
    st.config = (await api("/api/config")).data;
    st.works = (await api("/api/works")).data;
    const savedWork = store.get("ss-studio-work");
    st.workId = st.works.some((w) => w.id === savedWork) ? savedWork : (st.works[0] ? st.works[0].id : null);
    await refreshWorks();
    await selectWork(st.workId);
    token = store.get("ss-studio-token") || null;
    if (token) {
      const me = await api("/api/me", { noLogout: true });
      if (me.ok) return onLoggedIn({ token, user: me.data });
      token = null;
    }
    showLogin();
  })();
})();
