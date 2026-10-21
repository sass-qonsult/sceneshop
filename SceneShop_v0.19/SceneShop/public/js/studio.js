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
  // valores em reais no padrão 1.250.000,00 (sem teto); aceita também 1250000.5
  const money2 = (v) => (v == null || v === "" || !Number.isFinite(Number(v))) ? "" : Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  function parseMoney(v) {
    if (typeof v === "number") return v;
    let raw = String(v ?? "").trim().replace(/^R\$\s*/i, "").replace(/\s/g, "");
    if (!raw) return NaN;
    if (raw.includes(",")) raw = raw.replace(/\./g, "").replace(",", ".");
    else if ((raw.match(/\./g) || []).length > 1) raw = raw.replace(/\./g, "");
    else if (/^\d{1,3}\.\d{3}$/.test(raw)) raw = raw.replace(".", "");
    return /^-?\d+(\.\d+)?$/.test(raw) ? Number(raw) : NaN;
  }
  // ao sair do campo, o valor é reescrito no padrão brasileiro
  document.addEventListener("focusout", (e) => {
    const el = e.target;
    if (!el.matches || !el.matches("input[data-money], input[name=referencePrice], input[name=offerPrice]") || !el.value.trim()) return;
    const n = parseMoney(el.value);
    if (Number.isFinite(n)) el.value = money2(n);
  });
  document.addEventListener("input", (e) => {
    const el = e.target;
    if (el.matches && el.matches("input[data-money], input[name=referencePrice], input[name=offerPrice]")) el.value = el.value.replace(/[^\d.,]/g, "");
  });
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
    if (tab === "editor") { requestAnimationFrame(renderBoxes); refreshEditorTrack(); }
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
    return `<span class="me"><b>${esc(st.user.name)}</b> · ${{ author: "autor da comunidade", producer: "produtora", moderator: "moderador" }[st.user.role]}${st.user.platformAdmin ? " · administrador" : ""}</span>${orgSelect}
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
      await refreshWorks(); await selectWork(st.workId);
      if (tab === "editor") { await loadTrackList(); newTrack(); }
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
    if (st.user.platformAdmin && !allowed.includes("moderacao")) allowed.push("moderacao");
    document.querySelectorAll(".tabs button").forEach((b) => (b.hidden = !allowed.includes(b.dataset.tab)));
    if (!isMod()) { await refreshWorks(); await selectWork(st.workId); }
    refreshAi();
    st.sellers = [];
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
  $("mfaDisableBtn").onclick=async()=>{const code=prompt((window.t || String)('Código atual do autenticador:'));if(!code)return;const r=await api('/api/me/mfa/disable',{method:'POST',body:{code}});if(r.ok)logout('MFA desativado. Entre novamente.');else $("mfaSetupResult").textContent=r.data.error||'Falha ao desativar MFA.';};
  $("saveOrgSecurity").onclick=async()=>{const r=await api(`/api/organizations/${encodeURIComponent(organizationId)}/settings`,{method:'PATCH',body:{security:{requireMfaForWrites:$("requireMfaWrites").checked}}});$("orgSecurityMsg").textContent=r.ok?'Política salva.':(r.data.message||r.data.error||'Falha ao salvar.');if(r.ok){await loadOrganizations();loadTeamSecurity();}};

  // ================================================================ editor: trilha
  async function loadTrackList() {
    if (!st.workId) { $("trackSel").innerHTML = `<option value="">+ Nova trilha</option>`; return; }
    const wid = st.workId;
    const list = ((await api(`/api/me/tracks?work=${wid}`)).data || []).filter((t) => t.status !== "removida" && t.workId === wid);
    if (st.workId !== wid) return st.trackList || []; // resposta atrasada de outra obra
    st.trackList = list;
    $("trackSel").innerHTML = `<option value="">+ Nova trilha</option>` +
      // texto em português: o tradutor da página reconhece os padrões "{1} ({2} cenas…)" e "● {1} · no app"
      list.map((t) => `<option value="${t.id}">${t.live ? "● " : ""}${esc(t.title)} (${t.scenes} cenas${t.aiProducts ? ` · ${t.aiProducts} da IA` : ""})${t.live ? " · no app" : ""}</option>`).join("");
    if (st.track && st.track.id) $("trackSel").value = st.track.id;
    $("trackDel").disabled = !(st.track && st.track.id);
    return list;
  }
  const liveTrack = () => (st.trackList || []).find((x) => x.live) || null;
  $("trackSel").onchange = (e) => (e.target.value ? loadTrack(e.target.value) : newTrack());
  $("trackDel").onclick = async () => {
    const t = st.track, tr = window.t || String;
    if (!t || !t.id) return;
    const row = (st.trackList || []).find((x) => x.id === t.id) || {};
    if (!confirm(tr("Excluir a trilha “{0}”? Ela sai do Editor, do player e do app.").replace("{0}", row.title || t.title || "") + (row.live ? "\n" + tr("É a trilha que está no app: a próxima trilha oficial mais recente passa a ser usada.") : ""))) return;
    const r = await api(`/api/tracks/${encodeURIComponent(t.id)}`, { method: "DELETE" });
    if (!r.ok) return toast(r.data.error || (r.data.errors || []).join(" ") || tr("Falha ao excluir."), true);
    toast(tr("Trilha excluída.") + (r.data.republished ? " " + tr("O app passou a usar outra trilha oficial.") : r.data.retired ? " " + tr("A obra ficou sem trilha no app.") : ""));
    newTrack();
    await loadTrackList();
    const live = liveTrack();
    if (live) await loadTrack(live.id); else newTrack();
  };
  $("work").onchange = (e) => selectWork(e.target.value);

  // Troca a obra do editor: vídeo, duração e trilhas
  async function selectWork(id) {
    const w = st.works.find((x) => x.id === id) || st.works[0];
    if (!w) { // ainda não há obras
      st.workId = null; st.duration = 0; video.removeAttribute("src");
      if (st.user && !isMod()) { await loadTrackList(); newTrack(); }
      return;
    }
    st.workId = w.id;
    st.duration = w.duration;
    $("work").value = w.id;
    if (video.getAttribute("src") !== w.video) { video.src = w.video; video.load(); }
    store.set("ss-studio-work", w.id);
    if (st.user && !isMod()) {
      const tok = (st.selTok = (st.selTok || 0) + 1);
      newTrack(); // trilha em branco enquanto carrega (nunca fica sem trilha aberta)
      await loadTrackList();
      if (tok !== st.selTok || st.workId !== w.id) return; // trocou de obra no meio: vale a última escolha
      // abre a trilha que está no app (com os produtos aprovados na IA); sem ela, uma trilha nova
      const live = liveTrack();
      if (live) await loadTrack(live.id); else newTrack();
    }
    refreshAi();
  }

  async function refreshWorks() {
    // logado: só as obras da organização ativa; antes do login, a lista pública
    // (na demonstração, a obra de exemplo demo-01 também aparece)
    const mine = token && organizationId ? await api("/api/me/works") : null;
    const pub = !mine || (st.config && st.config.demo) ? await api("/api/works") : null;
    const list = [...(mine && mine.ok && Array.isArray(mine.data) ? mine.data : [])];
    for (const w of (pub && pub.ok && Array.isArray(pub.data) ? pub.data : [])) if (!list.some((x) => x.id === w.id) && (!mine || !w.pilot)) list.push(w);
    st.works = list;
    $("work").innerHTML = st.works.map((w) => `<option value="${esc(w.id)}">${esc(w.title)}</option>`).join("") || `<option value="">${(window.t || String)("Nenhuma obra: envie um vídeo na aba Obras")}</option>`;
    if (!st.works.some((w) => w.id === st.workId)) st.workId = st.works[0] ? st.works[0].id : null;
    $("work").value = st.workId || "";
  }

  function newTrack() {
    st.track = { id: null, title: "", offset: 0, scenes: [{ id: "c1", title: (window.t || String)("Cena {0#}", 1), start: 0, end: st.duration, products: [] }] };
    st.sel = 0;
    $("trackSel").value = "";
    $("trackDel").disabled = true;
    snapshotTrack(null);
    renderAll();
    setLinks();
  }

  // ---- versão aberta no Editor: detecta mudanças feitas pela IA enquanto a trilha estava aberta
  const aiKeyOf = (s, p) => `${s.id}|${p.id}|${p.source}`;
  const isAi = (p) => String(p.source || "").startsWith("ai:");
  const trackJson = () => JSON.stringify({ title: st.track.title, offset: st.track.offset, scenes: st.track.scenes });
  function snapshotTrack(t) {
    st.loaded = { updatedAt: t ? Number(t.updatedAt || 0) : 0, aiKeys: new Set(t ? t.scenes.flatMap((s) => s.products.filter(isAi).map((p) => aiKeyOf(s, p))) : []), at: Date.now() };
    st.aiRemovedSet = new Set();
    st.loadedJson = trackJson();
  }
  // produto da IA tirado de propósito (pelo ×): não volta na próxima sincronização
  function noteRemoved(scene, p) { if (scene && p && isAi(p)) st.aiRemovedSet.add(aiKeyOf(scene, p)); }
  const editorDirty = () => !!st.track && st.loadedJson !== trackJson();
  function aiRemovedKeys() {
    const now = new Set(st.track.scenes.flatMap((s) => s.products.filter(isAi).map((p) => aiKeyOf(s, p))));
    return [...(st.aiRemovedSet || [])].filter((k) => !now.has(k));
  }
  // Ao voltar para o Editor: se a IA atualizou a trilha, recarrega (ou avisa que vai mesclar ao salvar)
  async function refreshEditorTrack() {
    if (!st.user || isMod() || !st.workId || !st.track) return;
    await loadTrackList();
    const tr = window.t || String;
    if (!st.track) return;
    if (st.track.id) {
      const id = st.track.id;
      const r = await api(`/api/tracks/${id}`);
      if (!st.track || st.track.id !== id) return; // a trilha aberta mudou enquanto consultava
      if (!r.ok || r.data.status === "removida") { toast(tr("Esta trilha foi excluída."), true); const live = liveTrack(); return live ? loadTrack(live.id) : newTrack(); }
      if (Number(r.data.updatedAt || 0) > (st.loaded ? st.loaded.updatedAt : 0)) {
        if (!editorDirty()) { const sel = st.sel; await loadTrack(st.track.id); st.sel = Math.min(sel, scenes().length - 1); renderAll(); setLinks(); flashMsg(tr("Trilha atualizada com os produtos aprovados na IA.")); }
        else flashMsg(tr("A IA atualizou esta trilha. Os produtos novos entram junto quando você salvar."));
      }
    } else {
      const live = liveTrack();
      if (live && !editorDirty()) { await loadTrack(live.id); flashMsg(tr("Aberta a trilha que está no app, com os produtos aprovados na IA.")); }
    }
  }
  function flashMsg(text) { $("msg").className = "msg ok"; $("msg").textContent = text; }

  async function loadTrack(id) {
    const t = (await api(`/api/tracks/${id}`)).data;
    if (!t || !t.id || (st.workId && t.workId !== st.workId)) return; // resposta atrasada de outra obra
    st.track = JSON.parse(JSON.stringify({ id: t.id, title: t.title, offset: t.offset, scenes: t.scenes }));
    const ids = [...new Set(t.scenes.flatMap((s) => s.products.map((p) => p.id)))];
    await Promise.all(ids.filter((i) => !st.products[i]).map(async (i) => (st.products[i] = (await api(`/api/products/${i}`)).data)));
    st.sel = 0;
    snapshotTrack(t);
    $("trackSel").value = t.id;
    $("trackDel").disabled = false;
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
    const novo = { id: nextSceneId(), title: (window.t || String)("Cena {0#}", scenes().length + 1), start: t, end: s.end, products: [] };
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
        <div class="pi"><b>${esc(p.name)}${isAi(it) ? ` <em class="ai-tag" title="${esc((window.t || String)("Colocado pela IA (aprovado na Fila de revisão)"))}">IA</em>` : ""}</b><span>${esc(p.brand)}</span></div>
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
      li.querySelector("[data-del]").onclick = () => { noteRemoved(cur(), cur().products[i]); cur().products.splice(i, 1); renderProducts(); renderScenes(); renderTimeline(); renderBoxes(); };
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
  $("goOffers").onclick = () => showTab("ofertas");
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

  $("saveBtn").onclick = () => saveTrack();
  async function saveTrack() {
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
    const tr = window.t || String;
    // trilha nova, mas a IA já publicou uma trilha desta obra no app: salvar nela, para não ficar uma trilha sem os produtos da IA
    if (!t.id) {
      await loadTrackList();
      const live = liveTrack();
      if (live && live.aiProducts && confirm(tr("A IA já publicou no app a trilha “{0}”, com os produtos aprovados. Salvar suas cenas e produtos nela? (Cancelar cria uma trilha separada.)").replace("{0}", live.title))) {
        t.id = live.id; t.title = t.title || live.title; st.loaded = { updatedAt: 1, aiKeys: new Set(), at: Date.now() };
      }
    }
    const body = { workId: st.workId, title: t.title || "Minha trilha", offset: t.offset, scenes: t.scenes };
    if (t.id) { body.baseUpdatedAt = st.loaded ? st.loaded.updatedAt : 0; body.aiRemoved = aiRemovedKeys(); }
    const r = t.id ? await api(`/api/tracks/${t.id}`, { method: "PUT", body }) : await api("/api/tracks", { method: "POST", body });
    if (!r.ok) { $("msg").className = "msg bad"; $("msg").textContent = (r.data.errors || [r.data.error || "Erro"]).join(" "); return false; }
    t.id = r.data.track.id;
    const merged = r.data.aiMerged || 0;
    await loadTrack(t.id); // recarrega a versão salva (inclui os produtos da IA mesclados)
    await loadTrackList();
    setLinks();
    $("msg").className = "msg ok";
    $("msg").textContent = `Trilha publicada como ${r.data.track.type === "official" ? "Oficial" : "Comunidade"}.` +
      (merged ? ` ${merged} ${tr("produto(s) aprovado(s) na IA entraram junto.")}` : "") +
      (empty ? ` ${empty} cena(s) sem produto.` : "") + (noBox ? ` ${noBox} produto(s) sem posição marcada.` : "");
    // a IA recoloca os produtos aprovados pelo segundo de cada item nas cenas salvas
    if (t.id) setTimeout(() => refreshEditorTrack(), 2200);
    return true;
  }

  function renderAll() {
    $("trackTitle").value = st.track.title;
    $("offset").value = st.track.offset;
    $("msg").textContent = "";
    renderSeal(); renderScenes(); renderSceneForm(); renderTimeline(); renderBoxes();
  }

  // ================================================================ editor: produtos por cena
  // Todas as cenas numa só tela: buscar e adicionar produtos em cada cena sem percorrer o vídeo.
  const board = { sel: new Set(), products: [], thumbs: {}, token: 0 };
  const boardRefresh = () => { renderScenes(); renderSceneForm(); renderTimeline(); renderBoxes(); };
  async function openBoard() {
    if (!st.track) return;
    const r = await api("/api/me/products");
    board.products = r.ok ? r.data || [] : [];
    board.products.forEach((p) => (st.products[p.id] = st.products[p.id] || p));
    $("boardProduct").innerHTML = `<option value="">${esc((window.t || String)("— escolha um produto —"))}</option>` + board.products.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join("");
    board.sel = new Set(); $("boardAll").checked = false; $("boardFilter").value = "";
    $("boardModal").hidden = false;
    renderBoard();
  }
  function renderBoard() {
    const tr = window.t || String, f = $("boardFilter").value.trim().toLowerCase();
    $("boardSub").textContent = `${scenes().length} ${tr("cena(s)")} · ${tr("busque o produto dentro da cena; para repetir um produto em várias cenas, marque as cenas e use “Adicionar às cenas marcadas”.")}`;
    $("boardBody").innerHTML = scenes().map((s, i) => (f && !String(s.title).toLowerCase().includes(f)) ? "" : `
      <section class="board-scene ${board.sel.has(i) ? "is-picked" : ""}" data-bi="${i}">
        <label class="pick"><input type="checkbox" data-bsel="${i}" ${board.sel.has(i) ? "checked" : ""} aria-label="${esc(tr("Marcar cena"))}"/></label>
        <button type="button" class="board-thumb" data-bgo="${i}" title="${esc(tr("Abrir esta cena no vídeo"))}">${s.thumb ? `<img src="${esc(s.thumb)}" alt=""/>` : `<canvas width="192" height="108" data-bthumb="${i}"></canvas>`}<span>${fmtT(s.start)}</span></button>
        <div class="board-main">
          <div class="board-head"><b>${i + 1}.</b><input data-btitle="${i}" value="${esc(s.title)}" maxlength="60" aria-label="${esc(tr("Nome da cena"))}"/><small>${fmtT(s.start)}–${fmtT(s.end)} · ${s.products.length} ${tr("prod.")}</small></div>
          <div class="board-chips">${s.products.length ? s.products.map((it, j) => { const p = st.products[it.id] || { name: it.id, image: "/media/products/placeholder.svg" }; return `<span class="chip ${isAi(it) ? "is-ai" : ""}"><img src="${esc(p.image)}" alt=""/>${esc(p.name)}${isAi(it) ? `<em class="ai-tag">IA</em>` : ""}<button type="button" data-brm="${i}:${j}" aria-label="${esc(tr("Remover"))}">×</button></span>`; }).join("") : `<span class="help">${esc(tr("Nenhum produto nesta cena ainda."))}</span>`}</div>
          <div class="search board-search"><input data-bq="${i}" placeholder="${esc(tr("Buscar produto para esta cena…"))}" autocomplete="off"/><ul class="results" data-bres="${i}" hidden></ul></div>
        </div>
      </section>`).join("") || `<p class="help">${esc(tr("Nenhuma cena com esse nome."))}</p>`;
    const body = $("boardBody");
    body.querySelectorAll("[data-bsel]").forEach((cb) => (cb.onchange = () => { const i = Number(cb.dataset.bsel); cb.checked ? board.sel.add(i) : board.sel.delete(i); cb.closest(".board-scene").classList.toggle("is-picked", cb.checked); $("boardAll").checked = board.sel.size === scenes().length; }));
    body.querySelectorAll("[data-btitle]").forEach((inp) => (inp.oninput = () => { scenes()[Number(inp.dataset.btitle)].title = inp.value; renderScenes(); renderTimeline(); }));
    body.querySelectorAll("[data-brm]").forEach((b) => (b.onclick = () => { const [i, j] = b.dataset.brm.split(":").map(Number); noteRemoved(scenes()[i], scenes()[i].products[j]); scenes()[i].products.splice(j, 1); boardRefresh(); renderBoard(); }));
    body.querySelectorAll("[data-bgo]").forEach((b) => (b.onclick = () => { $("boardModal").hidden = true; selectScene(Number(b.dataset.bgo), true); }));
    body.querySelectorAll("[data-bq]").forEach((inp) => {
      let tm;
      inp.oninput = () => { clearTimeout(tm); tm = setTimeout(async () => {
        const i = Number(inp.dataset.bq), res = body.querySelector(`[data-bres="${i}"]`), q = inp.value.trim();
        if (!q) { res.hidden = true; return; }
        const list = (await api(`/api/products?q=${encodeURIComponent(q)}`)).data || [];
        res.innerHTML = list.length ? list.map((p) => `<li data-id="${esc(p.id)}"><img src="${esc(p.image)}" alt=""/><span><b>${esc(p.name)}</b> ${esc(p.brand || "")}</span><em>${brl(p.referencePrice)}</em></li>`).join("") : `<li class="none">${esc(tr("Nada encontrado. Cadastre na aba Produtos."))}</li>`;
        res.hidden = false;
        res.querySelectorAll("li[data-id]").forEach((li) => (li.onclick = () => {
          const p = list.find((x) => x.id === li.dataset.id); st.products[p.id] = p;
          const sc = scenes()[i];
          if (sc.products.some((x) => x.id === p.id)) return toast(tr("Esse produto já está na cena."), true);
          sc.products.push({ id: p.id, match: "exato", box: null });
          boardRefresh(); renderBoard();
          const again = $("boardBody").querySelector(`[data-bq="${i}"]`); if (again) again.focus();
        }));
      }, 180); };
    });
    drawBoardThumbs();
  }
  async function drawBoardThumbs() {
    const token = ++board.token;
    for (const cv of $("boardBody").querySelectorAll("canvas[data-bthumb]")) {
      const s = scenes()[Number(cv.dataset.bthumb)], key = `${s.start}-${s.end}`;
      try {
        if (!board.thumbs[key]) {
          const v = helperVideo(); await ready(v); await seekTo(v, Math.min(s.end - 0.05, (s.start + s.end) / 2) + (st.track.offset || 0));
          const c = document.createElement("canvas"); c.width = 192; c.height = 108; c.getContext("2d").drawImage(v, 0, 0, 192, 108);
          board.thumbs[key] = c;
        }
        if (token !== board.token || $("boardModal").hidden) return;
        cv.getContext("2d").drawImage(board.thumbs[key], 0, 0);
      } catch (e) { /* segue sem miniatura */ }
    }
  }
  $("boardBtn").onclick = openBoard;
  $("boardClose").onclick = () => ($("boardModal").hidden = true);
  $("boardModal").onclick = (e) => { if (e.target === $("boardModal")) $("boardModal").hidden = true; };
  $("boardFilter").oninput = () => renderBoard();
  $("boardAll").onchange = () => { board.sel = new Set($("boardAll").checked ? scenes().map((_, i) => i) : []); renderBoard(); };
  $("boardAdd").onclick = () => {
    const pid = $("boardProduct").value, tr = window.t || String;
    if (!pid) return toast(tr("Escolha o produto."), true);
    if (!board.sel.size) return toast(tr("Marque as cenas."), true);
    let n = 0;
    board.sel.forEach((i) => { const sc = scenes()[i]; if (sc && !sc.products.some((x) => x.id === pid)) { sc.products.push({ id: pid, match: "exato", box: null }); n++; } });
    boardRefresh(); renderBoard();
    toast(`${n} ${tr("cena(s) receberam o produto.")}`);
  };
  $("boardRemove").onclick = () => {
    const pid = $("boardProduct").value, tr = window.t || String;
    if (!pid || !board.sel.size) return toast(tr("Escolha o produto e marque as cenas."), true);
    let n = 0;
    board.sel.forEach((i) => { const sc = scenes()[i]; const k = sc ? sc.products.findIndex((x) => x.id === pid) : -1; if (k >= 0) { noteRemoved(sc, sc.products[k]); sc.products.splice(k, 1); n++; } });
    boardRefresh(); renderBoard();
    toast(`${tr("Produto retirado de")} ${n} ${tr("cena(s).")}`);
  };
  $("boardPublish").onclick = () => { $("boardModal").hidden = true; $("saveBtn").click(); };
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("boardModal").hidden) $("boardModal").hidden = true; });

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
    document.querySelector("#tab-ganhos .card.demo").hidden = !st.config.demo;
    $("rules").innerHTML = (st.config.demo ? `Cada venda gera comissão da loja (${Object.entries(terms.storeCommission || R.storeCommission || {}).map(([k, v]) => `${k} ${Math.round(v * 100)}%`).join(", ")}). `
      : `Cada venda confirmada pela loja (aviso, relatório ou registro na aba Ofertas oficiais) gera a comissão combinada na oferta do produto. `) +
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
  // Lojas da organização, oferta de cada produto (loja + link + preço + comissão) e conferência das vendas.
  const tr = (x) => (window.t || String)(x);
  const SELLER_KIND = { marca: "Loja da marca", varejista: "Grande varejista", marketplace: "Marketplace" };
  const dateInput = (ms) => { if (!ms) return ""; const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
  const errText = (r) => (r.data.errors || [r.data.error || r.data.message || "Erro"]).join(" ");
  const offersSt = { sellers: [], items: [] };

  async function loadOffers() {
    const [items, sellers, policy] = await Promise.all([api("/api/me/official-offers"), api("/api/me/sellers"), api("/api/commercial-policy")]);
    if (!items.ok) { $("offersBody").innerHTML = `<tr><td colspan="8" class="empty">${esc(errText(items))}</td></tr>`; return; }
    offersSt.items = items.data || [];
    offersSt.sellers = sellers.ok ? sellers.data || [] : [];
    const defaultCommissionPct = +((((policy.data || {}).current || {}).terms || {}).defaultCommissionRate ?? 0.10) * 100;
    renderSellers();
    const usable = offersSt.sellers.filter((x) => x.active && x.agreement && x.agreement.valid);
    const opts = (sel) => `<option value="">— não vender —</option>` + usable.map((x) => `<option value="${esc(x.id)}" ${x.id === sel ? "selected" : ""}>${esc(x.name)}</option>`).join("");
    $("offersBody").innerHTML = offersSt.items.map((it) => {
      const o = it.offer || {};
      const days = o.validUntil ? Math.max(1, Math.round((o.validUntil - Date.now()) / 864e5)) : 90;
      return `<tr data-id="${esc(it.productId)}">
        <td><div class="pcell"><img src="${esc(it.image)}" alt=""/><div><b>${esc(it.name)}</b><div class="help">${esc(it.brand)}</div></div></div></td>
        <td class="num">${brl(it.referencePrice)}</td>
        <td><select data-f="sellerId">${opts(o.sellerId)}</select></td>
        <td><input class="url" data-f="url" type="url" placeholder="https://loja.com.br/produto" value="${esc(o.url || "")}" /></td>
        <td class="num"><input data-f="price" data-money value="${money2(o.price ?? it.referencePrice)}" /></td>
        <td class="num"><input data-f="commission" type="number" step="0.1" min="0" max="100" value="${o.commission != null ? +(o.commission * 100).toFixed(2) : +defaultCommissionPct.toFixed(2)}" /></td>
        <td class="num"><input data-f="validDays" type="number" min="1" max="365" value="${days}" /></td>
        <td><button class="small primary" data-save>Salvar</button><span class="rowmsg"></span></td>
      </tr>`;
    }).join("") || `<tr><td colspan="8" class="empty">${tr("Nenhum produto ainda. Cadastre os produtos na aba Produtos.")}</td></tr>`;
    if (!usable.length && offersSt.items.length) $("offersBody").insertAdjacentHTML("afterbegin", `<tr><td colspan="8" class="help">${tr("Cadastre uma loja no passo 1 para poder escolher onde cada produto será vendido.")}</td></tr>`);
    $("offersBody").querySelectorAll("[data-save]").forEach((b) => (b.onclick = async () => {
      const row = b.closest("tr"), f = (k) => row.querySelector(`[data-f=${k}]`).value, msg = row.querySelector(".rowmsg");
      const body = { sellerId: f("sellerId"), url: f("url").trim(), price: parseMoney(f("price")), commission: Number(f("commission")) / 100, validDays: Number(f("validDays")) };
      b.disabled = true;
      const r = await api(`/api/official-offers/${encodeURIComponent(row.dataset.id)}`, { method: "PUT", body });
      b.disabled = false;
      msg.className = "rowmsg " + (r.ok ? "ok" : "bad");
      msg.textContent = r.ok ? (body.sellerId ? tr("Salvo") : tr("Removido")) : errText(r);
      if (r.ok) toast(body.sellerId ? "Oferta salva. Vale para os próximos cliques." : "Produto retirado da venda.");
    }));
    // conferência de vendas por loja
    const refSel = $("refSeller"), keep = refSel.value;
    refSel.innerHTML = offersSt.sellers.map((x) => `<option value="${esc(x.id)}">${esc(x.name)}</option>`).join("") || `<option value="">${tr("— nenhuma loja —")}</option>`;
    if (offersSt.sellers.some((x) => x.id === keep)) refSel.value = keep;
    loadReferrals();
    // avançado
    const prodOpts = offersSt.items.map((it) => `<option value="${esc(it.productId)}">${esc(it.name)}</option>`).join("");
    if ($("commercePreviewProduct")) $("commercePreviewProduct").innerHTML = prodOpts;
    const previewBtn = $("commercePreviewBtn");
    if (previewBtn) previewBtn.onclick = async () => {
      const body = { productId: $("commercePreviewProduct").value, campaignId: $("commercePreviewCampaign").value || null, territory: $("commercePreviewTerritory").value || "GLOBAL" };
      const r = await api("/api/commerce/resolve-preview", { method: "POST", body });
      $("commercePreviewResult").textContent = r.ok ? `Política: ${r.data.resolution.strategy} · ${r.data.offers.length} oferta(s) elegível(is)` : errText(r);
      $("commercePreviewOffers").innerHTML = r.ok ? r.data.offers.map((o, i) => `<div class="agreement"><b>${i + 1}. ${esc((o.provider || {}).name || o.providerId)}</b> · ${o.price == null ? "preço sob consulta" : brl(o.price)} · ${esc(o.cta || "BUY")} · ${esc(o.territory || "GLOBAL")}</div>`).join("") : "";
    };
    const camps = await api("/api/commerce/campaigns");
    if ($("commercePreviewCampaign")) $("commercePreviewCampaign").innerHTML = '<option value="">— automática / nenhuma —</option>' + ((camps.ok ? camps.data : []) || []).map((c) => `<option value="${esc(c.id)}">${esc(c.name)} · ${esc(c.status)}</option>`).join("");
    await loadFinanceOps();
  }

  function renderSellers() {
    const pname = (id) => (offersSt.items.find((i) => i.productId === id) || {}).name || id;
    const prodOpts = offersSt.items.map((it) => `<option value="${esc(it.productId)}">${esc(it.name)}</option>`).join("");
    $("sellersList").innerHTML = offersSt.sellers.map((x) => {
      const a = x.agreement || {};
      let extra = "";
      if (x.integration === "codigos_unicos" && x.pool) {
        const per = Object.entries(x.pool.byProduct).map(([k, n]) => `${k === "*" ? "qualquer produto" : esc(pname(k))}: ${n}`).join(" · ") || "nenhum livre";
        extra = `<div class="pool ${x.pool.low ? "low" : ""}">Cupons: <b>${x.pool.livre}</b> livres · ${x.pool.reservado} entregues a espectadores · ${x.pool.usado} usados
            ${x.pool.low ? '<span class="pill frozen">estoque baixo: peça um novo lote à loja</span>' : ""}<div class="help">${per}</div></div>
          <form class="codes-form seller-form" data-seller="${esc(x.id)}">
            <label>Produto <select name="productId"><option value="">qualquer produto</option>${prodOpts}</select></label>
            <label class="grow">Cupons <textarea name="codes" rows="2" placeholder="Cole o lote de cupons enviado pela loja (um por linha)"></textarea></label>
            <div class="row"><button class="small">Carregar lote</button></div>
          </form>`;
      }
      if (x.integration === "link_campanha") {
        const cs = Object.entries(x.campaigns || {}).map(([pid, c]) => `${esc(pname(pid))}: <code>${esc(c)}</code>`).join(" · ") || "nenhuma";
        extra = `<div class="pool">Campanhas: ${cs}</div>
          <form class="camp-form seller-form" data-seller="${esc(x.id)}">
            <label>Produto <select name="productId">${prodOpts}</select></label><label>ID da campanha <input name="campaignId" placeholder="criado pela loja" /></label>
            <div class="row"><button class="small">Registrar campanha</button></div>
          </form>`;
      }
      const mine = !!x.organizationId;
      return `<div class="agreement" data-seller-id="${esc(x.id)}">
        <div class="head-row"><div><b>${esc(x.name)}</b> <span class="pill ${x.kind === "varejista" ? "hold" : "gold"}">${esc(SELLER_KIND[x.kind] || x.kind)}</span>
          <div class="help">${x.storeUrl ? `<a href="${esc(x.storeUrl)}" target="_blank" rel="noopener">${esc(x.storeUrl)}</a> · ` : ""}${x.cnpj ? "CNPJ " + esc(x.cnpj) + " · " : ""}${esc(x.integrationLabel || x.integration)} · ${x.orders || 0} pedido(s) confirmado(s)</div>
          <div class="help">${esc(a.notes || "")} Acordo válido até ${a.until ? new Date(a.until).toLocaleDateString("pt-BR") : "—"}.</div></div>
          <div class="pills">${x.isDefault ? `<span class="pill hold">${tr("Padrão")}</span>` : ""}${!x.active ? `<span class="pill rev">${x.isDefault ? tr("Desabilitada nesta organização") : tr("Desativada")}</span>` : a.valid ? '<span class="pill free">Acordo vigente</span>' : '<span class="pill rev">Acordo vencido</span>'}</div></div>
        ${extra}
        ${mine ? connBlock(x) : ""}
        ${mine ? `<div class="seller-actions"><button class="ghost small" data-edit>Editar</button><button class="ghost small" data-toggle>${x.active ? "Desativar" : "Reativar"}</button><button class="ghost small" data-secret>Integração automática (chave)</button><button class="ghost small danger" data-del-seller>${tr("Excluir loja")}</button></div>`
          : `<div class="seller-actions"><label class="switch"><input type="checkbox" data-toggle ${x.active ? "checked" : ""}/> ${x.active ? tr("Habilitada para os seus produtos") : tr("Desabilitada: não aparece para os seus produtos")}</label><button class="ghost small danger" data-del-seller>${tr("Excluir loja")}</button></div>`}
      </div>`;
    }).join("") || `<p class="help">${tr("Nenhuma loja cadastrada ainda.")}</p>`;
    $("sellersList").querySelectorAll(".codes-form").forEach((f) => (f.onsubmit = async (e) => {
      e.preventDefault();
      const r = await api(`/api/sellers/${encodeURIComponent(f.dataset.seller)}/codes`, { method: "POST", body: Object.fromEntries(new FormData(f)) });
      if (!r.ok) return toast(errText(r), true);
      toast(`${r.data.added} cupom(ns) carregado(s)` + (r.data.duplicated ? `, ${r.data.duplicated} repetido(s) ignorado(s)` : "") + (r.data.invalid.length ? `, ${r.data.invalid.length} inválido(s)` : "") + ".");
      loadOffers();
    }));
    $("sellersList").querySelectorAll(".camp-form").forEach((f) => (f.onsubmit = async (e) => {
      e.preventDefault();
      const b = Object.fromEntries(new FormData(f));
      const r = await api(`/api/sellers/${encodeURIComponent(f.dataset.seller)}/campaigns/${encodeURIComponent(b.productId)}`, { method: "PUT", body: { campaignId: b.campaignId } });
      if (!r.ok) return toast(errText(r), true);
      toast("Campanha registrada."); loadOffers();
    }));
    $("sellersList").querySelectorAll("[data-test]").forEach((b) => (b.onclick = async () => {
      b.disabled = true; const r = await api(`/api/me/sellers/${encodeURIComponent(b.dataset.test)}/test`, { method: "POST", body: {} }); b.disabled = false;
      r.ok ? toast("Conexão com a loja funcionando.") : toast(errText(r), true);
    }));
    $("sellersList").querySelectorAll("[data-sync]").forEach((b) => (b.onclick = async () => {
      b.disabled = true; b.textContent = (window.t || String)("Lendo pedidos…");
      const r = await api(`/api/me/sellers/${encodeURIComponent(b.dataset.sync)}/sync`, { method: "POST", body: {} });
      r.ok ? toast(`${r.data.lidos} pedido(s) lido(s), ${r.data.vendas} venda(s) nova(s), ${r.data.estornos} estorno(s).`) : toast(errText(r), true);
      loadOffers();
    }));
    $("sellersList").querySelectorAll("[data-import]").forEach((inp) => (inp.onchange = async () => {
      const f = inp.files[0]; if (!f) return;
      const r = await api(`/api/me/sellers/${encodeURIComponent(inp.dataset.import)}/import-report`, { method: "POST", body: { csv: await f.text() } });
      r.ok ? toast(`${r.data.linhas} linha(s): ${r.data.vendas} venda(s) atribuída(s) a cenas, ${r.data.semReferencia} sem referência do SceneShop, ${r.data.duplicadas} repetida(s).`) : toast(errText(r), true);
      inp.value = ""; loadOffers();
    }));
    $("sellersList").querySelectorAll("[data-seller-id]").forEach((el) => {
      const x = offersSt.sellers.find((s) => s.id === el.dataset.sellerId);
      const ed = el.querySelector("[data-edit]"), tg = el.querySelector("[data-toggle]"), sc = el.querySelector("[data-secret]"), dl = el.querySelector("[data-del-seller]");
      if (dl) dl.onclick = async () => {
        if (!confirm(tr("Excluir a loja “{0}”? Ela sai da lista e os produtos com oferta nela deixam de ter compra garantida.").replace("{0}", x.name))) return;
        const r = await api(`/api/me/sellers/${encodeURIComponent(x.id)}`, { method: "DELETE" });
        if (!r.ok) return toast(errText(r), true);
        toast(tr("Loja excluída.") + (r.data.offersRemoved ? ` ${r.data.offersRemoved} ${tr("oferta(s) removida(s).")}` : ""));
        loadOffers();
      };
      if (ed) ed.onclick = () => openSellerForm(x);
      if (tg) tg.onclick = async () => { const r = await api(`/api/me/sellers/${encodeURIComponent(x.id)}/enabled`, { method: "PUT", body: { enabled: !x.active } }); if (!r.ok) return toast(errText(r), true); toast(x.active ? tr("Loja desabilitada.") : tr("Loja habilitada.")); loadOffers(); };
      if (sc) sc.onclick = async () => {
        if (!confirm(tr("Gerar uma nova chave de integração para esta loja? A chave anterior deixa de funcionar."))) return;
        const r = await api(`/api/me/sellers/${encodeURIComponent(x.id)}/secret`, { method: "POST", body: {} });
        if (!r.ok) return toast(errText(r), true);
        showSecret(x, r.data.secret);
      };
    });
  }

  const VIA = { loja_cupom: "cupom lido na loja", loja_link: "link lido na loja", rede_afiliados: "transação da Awin", manual: "registrada por você", relatorio_afiliado: "relatório de afiliados", cupom: "cupom do lote", codigo: "código assinado", referencia: "aviso da loja" };
  function connBlock(x) {
    const c = x.connection;
    if (!c || !c.platform) return `<div class="help">Sem conexão: as vendas entram pelo aviso da loja ou pelo registro na seção 3.</div>`;
    if (c.platform === "afiliado") return `<div class="conn"><b>${esc(c.platformLabel)}</b> · importe o relatório de vendas do programa (CSV).
      <label class="ghost small file-btn">Importar relatório CSV <input type="file" accept=".csv,text/csv,text/plain" data-import="${esc(x.id)}" hidden /></label></div>`;
    const cr = c.credentials || {}, r = c.lastResult;
    return `<div class="conn"><b>Conectada à ${esc(c.platformLabel)}</b> (${esc(c.account || "—")}${c.advertiserId ? ` · anunciante ${esc(c.advertiserId)}` : ""})${c.platform === "awin" ? " · venda reconhecida pelo clickref do link" : ` · cupom ${esc(String(c.couponDiscountPct || 0).replace(".", ","))}%`}
      <div class="help">${cr.ready ? '<span class="pill free">Chaves configuradas no servidor</span>' : `<span class="pill rev">Faltam no servidor</span> ${esc((cr.missing || []).join(", "))}`}
      ${c.lastSync ? ` · última leitura ${new Date(c.lastSync).toLocaleString("pt-BR")}${r ? ` · ${r.lidos} pedidos lidos, ${r.vendas} vendas novas, ${r.estornos} estornos` : ""}` : " · ainda não leu pedidos"}
      ${c.lastError ? ` · <span class="bad">erro: ${esc(c.lastError)}</span>` : ""}</div>
      <div class="seller-actions"><button class="ghost small" data-test="${esc(x.id)}" ${cr.ready ? "" : "disabled"}>Testar conexão</button><button class="ghost small" data-sync="${esc(x.id)}" ${cr.ready ? "" : "disabled"}>Ler pedidos agora</button></div></div>`;
  }

  function showSecret(seller, secret) {
    const origin = location.origin;
    $("sellerSecret").innerHTML = `<div class="secret-box"><b>${esc(seller.name)}</b> · ${tr("chave de integração (aparece só agora; envie à equipe técnica da loja)")}:<br><code>${esc(secret)}</code>
      <div class="help">${tr("Aviso de pedido")}: <code>POST ${esc(origin)}/api/sellers/${esc(seller.id)}/orders</code> · ${tr("Relatório em lote")}: <code>POST ${esc(origin)}/api/sellers/${esc(seller.id)}/report</code> · ${tr("assinatura HMAC-SHA256 nos cabeçalhos X-SceneShop-Timestamp e X-SceneShop-Signature")}</div></div>`;
  }

  function openSellerForm(x) {
    const f = $("sellerForm");
    f.hidden = false; f.reset(); $("sellerFormMsg").textContent = "";
    f.elements.id.value = x ? x.id : "";
    if (x) {
      f.elements.name.value = x.name || ""; f.elements.kind.value = x.kind || "marca"; f.elements.storeUrl.value = x.storeUrl || "";
      f.elements.cnpj.value = x.cnpj || ""; f.elements.integration.value = x.integration || "link_produto";
      f.elements.until.value = dateInput(x.agreement && x.agreement.until); f.elements.notes.value = (x.agreement && x.agreement.notes) || "";
      const c = x.connection || {}; f.elements.platform.value = c.platform || ""; f.elements.account.value = c.account || ""; f.elements.couponDiscountPct.value = String(c.couponDiscountPct || 0).replace(".", ","); f.elements.advertiserId.value = c.advertiserId || "";
    } else f.elements.until.value = dateInput(Date.now() + 365 * 864e5);
    f.elements.name.focus();
  }
  $("sellerNewBtn").onclick = () => openSellerForm(null);
  $("sellerCancel").onclick = () => ($("sellerForm").hidden = true);
  $("sellerForm").onsubmit = async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(e.target)); const id = body.id; delete body.id;
    const r = id ? await api(`/api/me/sellers/${encodeURIComponent(id)}`, { method: "PUT", body }) : await api("/api/me/sellers", { method: "POST", body });
    if (!r.ok) { $("sellerFormMsg").className = "msg bad"; $("sellerFormMsg").textContent = errText(r); return; }
    e.target.hidden = true;
    toast(id ? "Loja atualizada." : "Loja cadastrada. Agora escolha os produtos que ela vende.");
    if (!id && r.data.secret) showSecret(r.data.seller, r.data.secret);
    loadOffers();
  };

  async function loadReferrals() {
    const id = $("refSeller").value;
    if (!id) { $("refBody").innerHTML = `<tr><td colspan="6" class="empty">${tr("Cadastre uma loja para acompanhar os cliques.")}</td></tr>`; return; }
    const r = await api(`/api/me/sellers/${encodeURIComponent(id)}/referrals`);
    const rows = r.ok ? r.data.referrals : [];
    $("refBody").innerHTML = rows.map((x) => `<tr>
      <td>${new Date(x.at).toLocaleString("pt-BR")}</td><td>${esc(x.product)}</td>
      <td class="mono">${esc(x.ref)}${x.coupon ? `<div class="help">cupom ${esc(x.coupon)}</div>` : ""}</td>
      <td class="num">${brl(x.price)}</td>
      <td>${x.order ? `<span class="pill ${x.order.status === "pago" ? "free" : "rev"}">${x.order.status === "pago" ? "Venda" : "Devolvido"}</span> #${esc(x.order.orderId)} · ${brl(x.order.amount)}${x.order.via ? `<div class="help">${esc(VIA[x.order.via] || x.order.via)}</div>` : ""}` : x.expiresAt < Date.now() ? '<span class="pill">Sem compra (vencido)</span>' : '<span class="pill hold">Aguardando a loja</span>'}</td>
      <td>${x.order ? (x.order.status === "pago" ? `<button class="ghost small" data-return="${esc(x.order.orderId)}">Registrar devolução</button>` : "") : `<button class="small" data-use-ref="${esc(x.ref)}" data-price="${esc(money2(x.price))}">Registrar venda</button>`}</td>
    </tr>`).join("") || `<tr><td colspan="6" class="empty">${r.ok ? tr("Nenhum clique enviado para esta loja ainda.") : esc(errText(r))}</td></tr>`;
    $("refBody").querySelectorAll("[data-use-ref]").forEach((b) => (b.onclick = () => {
      const f = $("manualOrder"); f.elements.ref.value = b.dataset.useRef; f.elements.unitPrice.value = b.dataset.price; f.elements.orderId.focus();
      f.scrollIntoView({ behavior: "smooth", block: "center" });
    }));
    $("refBody").querySelectorAll("[data-return]").forEach((b) => (b.onclick = async () => {
      if (!confirm(tr("Registrar a devolução deste pedido? A comissão é estornada."))) return;
      const r2 = await api(`/api/me/sellers/${encodeURIComponent(id)}/orders`, { method: "POST", body: { orderId: b.dataset.return, status: "devolvido" } });
      r2.ok ? toast("Devolução registrada.") : toast(errText(r2), true); loadReferrals();
    }));
  }
  $("refSeller").onchange = loadReferrals;
  $("manualOrder").onsubmit = async (e) => {
    e.preventDefault();
    const id = $("refSeller").value; if (!id) return toast("Escolha a loja.", true);
    const b = Object.fromEntries(new FormData(e.target));
    b.unitPrice = parseMoney(b.unitPrice);
    if (b.orderedAt) b.orderedAt = `${b.orderedAt}T12:00:00`; else delete b.orderedAt;
    const r = await api(`/api/me/sellers/${encodeURIComponent(id)}/orders`, { method: "POST", body: b });
    $("manualOrderMsg").className = "msg " + (r.ok ? "ok" : "bad");
    $("manualOrderMsg").textContent = r.ok ? (r.data.duplicate ? tr("Esse pedido já estava registrado.") : `${tr("Venda registrada. Comissão")}: ${brl(r.data.commission || 0)}`) : errText(r);
    if (r.ok) { e.target.reset(); loadReferrals(); }
  };

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
    $("settlementBtn").onclick=async()=>{const connectionId=$("financeConnection").value,gross=parseMoney($("settleGross").value),fees=parseMoney($("settleFees").value||"0");if(!connectionId)return toast('Crie/configure uma conexão MANAGED primeiro.',true);const r=await api('/api/payments/settlements',{method:'POST',headers:{'Idempotency-Key':`studio-settle-${Date.now()}`},body:{connectionId,grossAmount:gross,fees,netAmount:gross-fees,currency:'BRL'}});$("financeMsg").textContent=r.ok?'Settlement registrado.':(r.data.message||r.data.error||(r.data.errors||[]).join(' '));if(r.ok)loadFinanceOps();};
    $("payoutBtn").onclick=async()=>{const amount=parseMoney($("payoutAmount").value);const r=await api('/api/payments/payouts',{method:'POST',headers:{'Idempotency-Key':`studio-payout-${Date.now()}`},body:{amount,currency:'BRL'}});$("financeMsg").textContent=r.ok?'Payout solicitado.':(r.data.message||r.data.error||(r.data.errors||[]).join(' '));if(r.ok)loadFinanceOps();};
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
    loja_cadastrada: "Loja cadastrada", loja_atualizada: "Loja atualizada", loja_chave_trocada: "Chave da loja trocada", venda_registrada_manual: "Venda registrada pela produtora", administrador_definido: "Administrador definido", video_com_selo_gerado: "Vídeo com selo gerado", venda_sincronizada: "Venda sincronizada da loja", cupom_loja_falhou: "Cupom da loja falhou", relatorio_afiliado_importado: "Relatório de afiliados importado", organizacao_criada: "Organização criada",
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
  // Cortes refeitos: cada produto vai para a cena nova que contém o meio da cena antiga (nada se perde)
  function carryProducts(oldScenes, newScenes) {
    for (const s of oldScenes || []) {
      const mid = (Number(s.start) + Number(s.end)) / 2;
      const target = newScenes.find((x) => mid >= x.start && mid < x.end) || newScenes[newScenes.length - 1];
      for (const p of s.products || []) if (target && !target.products.some((x) => x.id === p.id)) target.products.push(p);
    }
  }
  $("detectBtn").onclick = async () => {
    const hasProducts = st.track.scenes.some((s) => s.products.length);
    if (hasProducts && !detectArmed) {
      detectArmed = true;
      $("detectBtn").textContent = (window.t || String)("Refazer os cortes? Os produtos passam para as cenas novas. Clique de novo");
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
        // compara cor (R, G e B), não só o brilho: cortes entre cenas de mesma luminosidade também contam
        const g = new Float32Array(W * H * 3);
        for (let i = 0; i < W * H; i++) { g[i * 3] = d[i * 4]; g[i * 3 + 1] = d[i * 4 + 1]; g[i * 3 + 2] = d[i * 4 + 2]; }
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
      const old = st.track.scenes;
      st.track.scenes = bounds.slice(0, -1).map((b, i) => ({ id: `c${i + 1}`, title: (window.t || String)("Cena {0#}", i + 1), start: b, end: bounds[i + 1], products: [] }));
      carryProducts(old, st.track.scenes);
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
    const title = st.track.scenes.length === 1 ? st.track.scenes[0].title : (window.t || String)("Cena única");
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
    await selectWork(r.data.id); // o editor já abre na obra recém-enviada
    loadWorks();
  };

  async function loadWorks() {
    const list = (await api("/api/me/works")).data || [];
    $("myWorks").innerHTML = list.length ? list.map((w) => `<div class="work">
        <img src="${esc(w.poster || "/media/products/placeholder.svg")}" alt=""/>
        <div class="wi"><b>${esc(w.title)}</b><span class="help">${fmtDur(w.duration)} · ${w.tracks.length} trilha(s)</span>
          ${w.tracks.length ? `<ul class="work-tracks">${w.tracks.map((t) => `<li${t.live ? ' class="is-live"' : ""}><span>${t.live ? "● " : ""}${esc(t.title)} <small>${t.scenes} cenas · ${t.products} produtos${t.live ? " · no app" : ""}</small></span><button class="ghost small danger" data-del-track="${esc(t.id)}" data-work="${esc(w.id)}" data-title="${esc(t.title)}">${esc((window.t || String)("Excluir"))}</button></li>`).join("")}</ul>` : ""}
          <div class="wa"><button class="small primary" data-inv="${w.id}">Inventariar</button>
            <a class="ghost small" href="/assistir/${encodeURIComponent(w.id)}" target="_blank">Assistir</a>
            <button class="small" data-pil="${w.id}">Painel</button>
            <button class="small" data-brand="${esc(w.id)}" title="Gera uma cópia do vídeo com o selo SceneShop compatible nos primeiros segundos">Vídeo com selo SceneShop</button>${acrOn() ? `
            <button class="small" data-acr-reg="${w.id}">Reconhecimento por áudio</button>` : ""}</div>${acrOn() ? `
          <span class="help acr-state" data-acr="${w.id}">Reconhecimento por áudio: consultando…</span>` : ""}
          <span class="help aid-state" data-aid="${esc(w.id)}">Reconhecimento pelo som (SceneShop ID): consultando…</span>
          <div class="brand-box" data-brand-box="${esc(w.id)}" hidden>
            <select data-brand-style><option value="corner">Selo no canto superior · 4 s</option><option value="intro">Abertura centralizada · 4 s</option></select>
            <button class="small primary" data-brand-go>Gerar vídeo</button>
            <span class="help" data-brand-state></span>
            <a class="ghost small" data-brand-dl hidden download>Baixar MP4 com selo</a>
          </div></div></div>`).join("")
      : `<p class="help">Nenhuma obra ainda. Envie o primeiro vídeo acima.</p>`;
    $("myWorks").querySelectorAll("[data-inv]").forEach((b) => (b.onclick = async () => { await selectWork(b.dataset.inv); showTab("editor"); }));
    $("myWorks").querySelectorAll("[data-pil]").forEach((b) => (b.onclick = () => { st.pilotWork = b.dataset.pil; showTab("piloto"); }));
    $("myWorks").querySelectorAll("[data-del-track]").forEach((b) => (b.onclick = async () => {
      const tr = window.t || String;
      if (!confirm(tr("Excluir a trilha “{0}”? Ela sai do Editor, do player e do app.").replace("{0}", b.dataset.title))) return;
      const r = await api(`/api/tracks/${encodeURIComponent(b.dataset.delTrack)}`, { method: "DELETE" });
      if (!r.ok) return toast(r.data.error || (r.data.errors || []).join(" ") || tr("Falha ao excluir."), true);
      toast(tr("Trilha excluída.") + (r.data.republished ? " " + tr("O app passou a usar outra trilha oficial.") : r.data.retired ? " " + tr("A obra ficou sem trilha no app.") : ""));
      if (st.workId === b.dataset.work) {
        await loadTrackList();
        if (st.track && st.track.id === b.dataset.delTrack) { newTrack(); const live = liveTrack(); if (live) await loadTrack(live.id); else newTrack(); }
      }
      loadWorks();
    }));
    $("myWorks").querySelectorAll("[data-aid]").forEach((el) => aidStatus(el.dataset.aid));
    $("myWorks").querySelectorAll("[data-brand]").forEach((b) => (b.onclick = () => {
      const box = $("myWorks").querySelector(`[data-brand-box="${CSS.escape(b.dataset.brand)}"]`);
      box.hidden = !box.hidden;
      if (!box.hidden) brandStatus(b.dataset.brand);
      box.querySelector("[data-brand-go]").onclick = async () => {
        const r = await api(`/api/works/${encodeURIComponent(b.dataset.brand)}/branded`, { method: "POST", body: { style: box.querySelector("[data-brand-style]").value, seconds: 4 } });
        if (!r.ok) return toast(r.data.error || "Falha ao gerar.", true);
        brandStatus(b.dataset.brand);
      };
    }));
    if (acrOn()) {
      $("myWorks").querySelectorAll("[data-acr]").forEach((el) => acrStatus(el.dataset.acr));
      $("myWorks").querySelectorAll("[data-acr-reg]").forEach((b) => (b.onclick = async () => {
        if (!confirm((window.t || String)("Cadastrar o áudio desta obra na ACRCloud? Depois disso, o celular reconhece a obra só de ouvir o som."))) return;
        const r = await api(`/api/acr/works/${encodeURIComponent(b.dataset.acrReg)}/register`, { method: "POST", body: {} });
        if (!r.ok) return toast(r.data.error || "Falha ao cadastrar.", true);
        toast("Enviando o áudio para a ACRCloud. Isso pode levar alguns minutos.");
        acrStatus(b.dataset.acrReg);
      }));
    }
  }

  // ================================================================ reconhecimento próprio pelo som (SceneShop ID)
  const aidTimers = {};
  async function aidStatus(workId) {
    const el = document.querySelector(`[data-aid="${CSS.escape(workId)}"]`);
    if (!el) return;
    const r = await api(`/api/audio-id/works/${encodeURIComponent(workId)}`);
    const tr = window.t || String, d = r.ok ? r.data : { state: "error", error: r.data.error };
    const label = { ready: tr("pronto: o celular reconhece esta obra pelo som"), indexing: tr("indexando o som da obra…"), not_indexed: tr("ainda não indexado"), error: tr("falhou") }[d.state] || d.state;
    el.innerHTML = `${esc(tr("Reconhecimento pelo som (SceneShop ID)"))}: ${esc(label)}${d.state === "ready" && d.duration ? ` · ${esc(fmtDur(d.duration))}` : ""}${d.error ? ` (${esc(d.error)})` : ""}${d.state !== "indexing" ? ` <button class="ghost small" data-aid-redo="${esc(workId)}">${esc(tr(d.state === "ready" ? "Indexar de novo" : "Indexar agora"))}</button>` : ""}`;
    const btn = el.querySelector("[data-aid-redo]");
    if (btn) btn.onclick = async () => { const x = await api(`/api/audio-id/works/${encodeURIComponent(workId)}/index`, { method: "POST", body: {} }); if (!x.ok) return toast(x.data.error || "Falha.", true); aidStatus(workId); };
    clearTimeout(aidTimers[workId]);
    if (d.state === "indexing") aidTimers[workId] = setTimeout(() => aidStatus(workId), 2000);
  }

  // ================================================================ vídeo com o selo "SceneShop compatible"
  const brandTimers = {};
  async function brandStatus(workId) {
    const box = document.querySelector(`[data-brand-box="${CSS.escape(workId)}"]`);
    if (!box) return;
    const r = await api(`/api/works/${encodeURIComponent(workId)}/branded`);
    const d = r.ok ? r.data : { state: "error", error: r.data.error };
    const tr = window.t || String;
    const label = box.querySelector("[data-brand-state]"), dl = box.querySelector("[data-brand-dl]");
    label.textContent = d.state === "running" ? `${tr("Gerando…")} ${Math.round((d.progress || 0) * 100)}%`
      : d.state === "ready" ? (d.audioCopied === false ? tr("Pronto. O áudio foi convertido para AAC (MP4); o reconhecimento pelo som continua funcionando.") : tr("Pronto. O áudio é o mesmo do original: o celular continua reconhecendo a obra."))
      : d.state === "error" ? `${tr("Falhou")}: ${d.error || ""}` : d.available === false ? tr("O servidor precisa do ffmpeg para gerar o vídeo.") : "";
    dl.hidden = d.state !== "ready"; if (d.url) dl.href = d.url;
    box.querySelector("[data-brand-go]").disabled = d.state === "running";
    clearTimeout(brandTimers[workId]);
    if (d.state === "running") brandTimers[workId] = setTimeout(() => brandStatus(workId), 1500);
  }

  // ================================================================ reconhecimento por áudio (ACRCloud)
  const acrOn = () => !!(st.config && st.config.audioRecognitionRegistry);
  const ACR_LABEL = {
    ready: "pronto: o celular reconhece esta obra pelo som",
    processing: "a ACRCloud está processando o áudio…",
    uploading: "enviando o áudio para a ACRCloud…",
    not_registered: "ainda não cadastrado",
    error: "falhou no cadastro",
    not_configured: "não configurado",
  };
  const acrTimers = {};
  async function acrStatus(workId) {
    const el = document.querySelector(`[data-acr="${CSS.escape(workId)}"]`);
    if (!el) return;
    const r = await api(`/api/acr/works/${encodeURIComponent(workId)}`);
    const state = r.ok ? r.data.state : "error";
    const tr = window.t || String;
    const detail = !r.ok ? (r.data.error || "sem resposta") : r.data.error || "";
    el.textContent = `${tr("Reconhecimento por áudio")}: ${tr(ACR_LABEL[state] || state)}${detail ? ` (${tr(detail)})` : ""}`;
    clearTimeout(acrTimers[workId]);
    if (state === "uploading" || state === "processing") acrTimers[workId] = setTimeout(() => acrStatus(workId), 5000);
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

  function productForm(p, key) {
    const o = p.offer || null;
    const sellers = (st.sellers || []).filter((x) => x.active && x.agreement && x.agreement.valid);
    const seller = o && (st.sellers || []).find((x) => x.id === o.sellerId);
    // produto novo: já vem com a loja escolhida quando só existe uma (ou o Marketplace Piloto, na demonstração)
    const preset = !p.id && !o ? ((sellers.length === 1 && sellers[0].id) || (sellers.find((x) => x.id === "loja-piloto") || {}).id || "") : "";
    const state = !p.id ? "" : o && seller ? `À venda em <b>${esc(seller.name)}</b> por ${brl(o.price)}${o.url || seller.storeUrl ? ` · <a href="${esc(o.url || seller.storeUrl)}" target="_blank" rel="noopener">abrir a página na loja</a>` : ""}` : "Ainda não está à venda.";
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
        <label>Preço de tabela (R$) <input name="referencePrice" inputmode="decimal" placeholder="1.250,00" value="${p.referencePrice != null ? money2(p.referencePrice) : ""}" required /></label>
        <label class="full">Descrição <textarea name="description" maxlength="1200">${esc(p.description || "")}</textarea></label>
        <div class="mkt">
          ${state ? `<div class="offer-state">${state}</div>` : ""}
          <label>Vender na loja <select name="sellerId"><option value="">— não vender agora —</option>${sellers.map((x) => `<option value="${esc(x.id)}" ${(o && o.sellerId === x.id) || preset === x.id ? "selected" : ""}>${esc(x.name)}</option>`).join("")}</select></label>
          <label class="grow">Link do produto na loja <input name="offerUrl" type="url" placeholder="https://loja.com.br/produto" value="${esc((o && o.url) || "")}" /></label>
          <label>Preço em cena (R$) <input name="offerPrice" inputmode="decimal" value="${o ? money2(o.price) : ""}" placeholder="igual ao de tabela" /></label>
          <label>Comissão (%) <input name="commission" type="number" min="0" max="100" step="0.5" value="${o ? +(o.commission * 100).toFixed(1) : 10}" /></label>
          ${sellers.length ? "" : `<p class="help full">Para vender, cadastre a loja oficial na aba <b>Ofertas oficiais</b>.</p>`}
        </div>
        <div class="foot"><span class="msg" data-msg></span>${p.id ? `<button type="button" class="ghost small danger" data-delete>Excluir produto</button>` : `<button type="button" class="ghost small" data-discard>Descartar</button>`}<button class="primary">${p.id ? "Salvar alterações" : "Salvar produto"}</button></div>
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
    const del = form.querySelector("[data-delete]");
    if (del) del.onclick = async () => {
      const tr = window.t || String;
      if (!confirm(`${tr("Excluir o produto")} “${p.name}”? ${tr("Ele sai das cenas das trilhas (que são republicadas), da oferta oficial e do app.")}`)) return;
      const r = await api(`/api/products/${encodeURIComponent(p.id)}`, { method: "DELETE" });
      if (!r.ok) return toast((r.data.errors || [r.data.error]).join(" "), true);
      delete st.products[p.id];
      if (st.track) { let hit = false; st.track.scenes.forEach((sc) => { const n = sc.products.length; sc.products = sc.products.filter((x) => x.id !== p.id); hit = hit || n !== sc.products.length; }); if (hit) renderAll(); }
      toast(`“${p.name}” ${tr("excluído.")}${r.data.tracksUpdated ? ` ${r.data.tracksUpdated} ${tr("trilha(s) republicada(s) sem ele.")}` : ""}`);
      onSaved();
    };
    form.onsubmit = async (e) => {
      e.preventDefault();
      const fd = Object.fromEntries(new FormData(form));
      const msg = form.querySelector("[data-msg]");
      const ref = parseMoney(fd.referencePrice);
      if (!Number.isFinite(ref) || ref <= 0) { msg.className = "msg bad"; msg.textContent = (window.t || String)("Informe o preço no padrão 1.250,00."); return; }
      const body = { name: fd.name, brand: fd.brand, category: fd.category, sku: fd.sku, referencePrice: ref, description: fd.description, images: p.images };
      const r = p.id ? await api(`/api/products/${p.id}`, { method: "PUT", body }) : await api("/api/products", { method: "POST", body });
      if (!r.ok) { msg.className = "msg bad"; msg.textContent = (r.data.errors || [r.data.error]).join(" "); return; }
      const saved = r.data;
      // espelho da aba Ofertas oficiais: loja, link, preço em cena e comissão
      const had = !!(p.offer && p.offer.sellerId);
      if (fd.sellerId) {
        const price = fd.offerPrice ? parseMoney(fd.offerPrice) : saved.referencePrice;
        const days = p.offer && p.offer.validUntil ? Math.max(1, Math.round((p.offer.validUntil - Date.now()) / 864e5)) : 180;
        const o = await api(`/api/official-offers/${encodeURIComponent(saved.id)}`, { method: "PUT", body: { sellerId: fd.sellerId, url: (fd.offerUrl || "").trim(), price, commission: Number(fd.commission) / 100, validDays: days } });
        if (!o.ok) { msg.className = "msg bad"; msg.textContent = (o.data.errors || [o.data.error]).join(" "); return; }
      } else if (had) {
        await api(`/api/official-offers/${encodeURIComponent(saved.id)}`, { method: "PUT", body: {} });
      }
      const sname = fd.sellerId ? ((st.sellers || []).find((x) => x.id === fd.sellerId) || {}).name : "";
      toast(`“${saved.name}” salvo${sname ? ` e à venda em ${sname}` : ""}.`);
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

  async function loadSellersCache() {
    const sl = await api("/api/me/sellers");
    st.sellers = sl.ok ? sl.data || [] : [];
  }
  async function loadMyProducts() {
    await loadSellersCache();
    $("pilotMarketLink").hidden = !(st.config && st.config.demo);
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
    $("pilotMarket").hidden = $("pilotOrdersCard").hidden = !(st.config && st.config.demo);
    // visão geral: uma linha por obra
    const all = await Promise.all(mine.map(async (w) => ({ w, r: await api(`/api/me/pilot?work=${encodeURIComponent(w.id)}`) })));
    $("perfAll").innerHTML = all.map(({ w, r }) => { const k = (r.ok && r.data.kpis) || {}; const clicks = r.ok ? (r.data.byProduct || []).reduce((n, p) => n + (p.clicks || 0), 0) : 0;
      return `<tr data-perf="${esc(w.id)}" style="cursor:pointer"><td><b>${esc(w.title)}</b></td><td class="num">${k.viewers || 0}</td><td class="num">${clicks}</td><td class="num">${k.orders || 0}</td><td class="num">${brl(k.revenue || 0)}</td><td class="num">${brl(k.commission || 0)}</td></tr>`; }).join("")
      || `<tr><td colspan="6" class="empty">${(window.t || String)("Nenhuma obra ainda.")}</td></tr>`;
    const ps = await api("/api/me/stores-performance");
    $("perfStores").innerHTML = (ps.ok ? ps.data : []).map((x) => `<tr><td><b>${esc(x.name)}</b>${x.platform ? `<div class="help">${esc(x.platform)}</div>` : ""}</td><td class="num">${x.clicks}</td><td class="num">${x.coupons}</td>
      <td class="num">${x.orders}${x.affiliate.orders ? `<div class="help">+${x.affiliate.orders} afiliados</div>` : ""}</td><td class="num">${String(x.conversion).replace(".", ",")}%</td>
      <td class="num">${brl(x.revenue)}${x.affiliate.revenue ? `<div class="help">+${brl(x.affiliate.revenue)}</div>` : ""}</td><td class="num">${brl(x.commission)}${x.affiliate.commission ? `<div class="help">+${brl(x.affiliate.commission)}</div>` : ""}</td>
      <td>${Object.entries(x.byVia).map(([k, n]) => `${n} ${esc(VIA[k] || k)}`).join(" · ") || "—"}</td>
      <td>${x.lastSync ? new Date(x.lastSync).toLocaleString("pt-BR") : "—"}${x.lastError ? `<div class="help bad">${esc(x.lastError)}</div>` : ""}</td></tr>`).join("")
      || `<tr><td colspan="9" class="empty">${(window.t || String)("Cadastre as lojas na aba Ofertas oficiais.")}</td></tr>`;
    $("perfAll").querySelectorAll("[data-perf]").forEach((tr) => (tr.onclick = () => { st.pilotWork = tr.dataset.perf; loadPilot(); }));
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
    // produtos da aba Produtos viram o inventário da IA automaticamente
    const prods=await api('/api/me/products'); aiOps.products=prods.ok?prods.data||[]:[];
    if(aiOps.products.length&&!aiOps.synced){const sy=await api('/api/ai/assets/sync-products',{method:'POST',body:{}});if(sy.ok)aiOps.synced=true;}
    const [r,policyR]=await Promise.all([api(`/api/ai/workspace?workId=${encodeURIComponent(aiOps.workId)}`),api(`/api/distribution/works/${encodeURIComponent(aiOps.workId)}/timeline-policy`)]);
    if(!r.ok){$("aiOpsReview").innerHTML=`<div class="empty-state bad">${esc(r.data.error||'Falha ao carregar o workspace de IA.')}</div>`;return;}
    aiOps.data={...r.data, timelinePolicy:policyR.ok?policyR.data:null};
    await loadAiOpsSceneSources();
    renderAiOps();
    if((r.data.jobs||[]).some(j=>['QUEUED','RUNNING'].includes(j.status))) aiOps.poll=setTimeout(loadAiOps,2500);
  }

  // Cortes de cena para a descoberta: os do Editor (mesmo antes de publicar) ou de uma trilha salva
  async function loadAiOpsSceneSources(){
    const wid=aiOps.workId, tr=(window.t||String);
    const opts=[];
    if(st.workId===wid&&st.track&&st.track.scenes&&st.track.scenes.length>1) opts.push({value:'editor',label:tr('Editor de trilha (cortes atuais)'),scenes:st.track.scenes});
    const tl=await api(`/api/me/tracks?work=${encodeURIComponent(wid)}`);
    for(const t of (tl.ok?tl.data||[]:[]).filter(t=>t.status!=='removida'&&t.scenes>1)) opts.push({value:t.id,label:`${t.title} (${t.scenes} ${tr('cenas')})`,scenes:null});
    aiOps.sceneOpts=opts;
    const sel=$("aiOpsSceneTrack"), keep=sel.value;
    sel.innerHTML=opts.map(o=>`<option value="${esc(o.value)}">${esc(o.label)}</option>`).join('')||`<option value="">${esc(tr('Nenhum corte ainda'))}</option>`;
    if(opts.some(o=>o.value===keep))sel.value=keep;
    await loadAiOpsScenes();
  }
  async function loadAiOpsScenes(){
    const o=(aiOps.sceneOpts||[]).find(x=>x.value===$("aiOpsSceneTrack").value);
    if(o&&!o.scenes){const t=await api(`/api/tracks/${encodeURIComponent(o.value)}`);o.scenes=t.ok?t.data.scenes||[]:[];}
    aiOps.scenes=o?o.scenes.map(sc=>({id:sc.id,title:sc.title,start:sc.start,end:sc.end})):[];
    if(!aiOps.srcTouched)$("aiOpsSceneSource").value=aiOps.scenes.length?'TRACK':'AI';
    aiOps.sceneSel=new Set(aiOps.scenes.map(sc=>sc.id));
    renderAiOpsScenes();
  }
  function renderAiOpsScenes(){
    const tr=(window.t||String), src=$("aiOpsSceneSource").value, list=aiOps.scenes||[];
    $("aiOpsScenesBox").hidden=src!=='TRACK';
    if(!list.length){
      $("aiOpsSceneList").innerHTML=`<div class="empty-state">${esc(tr('Ainda não há cortes de cena para esta obra. No Editor de trilha, use Detectar cortes (ou Nova cena a partir daqui) e volte aqui: cada cena é analisada separadamente.'))} <button type="button" class="ghost small" data-go-editor>${esc(tr('Abrir o Editor'))}</button></div>`;
      const b=$("aiOpsSceneList").querySelector('[data-go-editor]'); if(b)b.onclick=()=>$("aiOpsToEditor").click();
      $("aiOpsScenesInfo").textContent=''; return;
    }
    $("aiOpsSceneList").innerHTML=list.map((sc,i)=>`<label><input type="checkbox" value="${esc(sc.id)}" ${aiOps.sceneSel.has(sc.id)?'checked':''}/> ${i+1}. ${esc(sc.title)} <small>${aiOpsFmt(sc.start)}–${aiOpsFmt(sc.end)}</small></label>`).join('');
    $("aiOpsSceneList").querySelectorAll('input').forEach(cb=>cb.onchange=()=>{cb.checked?aiOps.sceneSel.add(cb.value):aiOps.sceneSel.delete(cb.value);renderAiOpsScenesInfo();});
    renderAiOpsScenesInfo();
  }
  function renderAiOpsScenesInfo(){
    const n=aiOps.sceneSel.size, tot=(aiOps.scenes||[]).length;
    $("aiOpsScenesAll").checked=n===tot&&tot>0;
    $("aiOpsScenesInfo").textContent=`· ${n}/${tot} ${(window.t||String)('marcadas, analisadas ao mesmo tempo')}`;
  }
  $("aiOpsSceneSource").onchange=()=>{aiOps.srcTouched=true;renderAiOpsScenes();};
  $("aiOpsSceneTrack").onchange=()=>loadAiOpsScenes();
  $("aiOpsScenesAll").onchange=()=>{aiOps.sceneSel=new Set($("aiOpsScenesAll").checked?(aiOps.scenes||[]).map(sc=>sc.id):[]);renderAiOpsScenes();};

  function renderAiOps(){
    const d=aiOps.data||{},assets=d.assets||[],jobs=d.jobs||[],cands=d.candidates||[],flags=d.flags||[],placements=d.placements||[];
    const openFlags=flags.filter(f=>f.status==='OPEN').length,approved=cands.filter(c=>c.reviewStatus==='APPROVED').length;
    $("aiOpsKpis").innerHTML=[
      ['Produtos no inventário',assets.length,'vindos da aba Produtos'],
      ['Identificações',cands.length,`${approved} aprovadas`],
      ['Flags abertas',openFlags,openFlags?'exigem operador':'sem pendências'],
      ['Placements',placements.length,'aprovados']
    ].map(([l,v,s])=>`<div class="aiops-kpi"><span>${esc(l)}</span><b>${esc(v)}</b><small>${esc(s)}</small></div>`).join('');

    const mode=$("aiOpsMode").value;
    const prodImg=(a)=>{const pr=(aiOps.products||[]).find(p=>p.id===a.productId);return pr?pr.image:((a.references||[])[0]||{}).uri||'';};
    const liveIds=new Set((aiOps.products||[]).map(p=>p.id));
    const visibleAssets=assets.filter(a=>!a.productId||liveIds.has(a.productId));
    const checked=new Set([...$("aiOpsAssets").querySelectorAll('input:checked')].map(x=>x.value));
    $("aiOpsAssets").innerHTML=visibleAssets.length?visibleAssets.map(a=>`<label class="asset-chip"><input type="checkbox" value="${esc(a.id)}" ${checked.has(a.id)?'checked':''} ${mode==='DISCOVERY'?'disabled':''}/>${prodImg(a)?`<img src="${esc(prodImg(a))}" alt="" style="width:34px;height:34px;border-radius:6px;object-fit:cover"/>`:''}<span><b>${esc(a.name)}</b><small>${esc([a.brand,a.model].filter(Boolean).join(' · ')||'produto cadastrado')}</small></span></label>`).join(''):'<div class="empty-state">Cadastre os produtos na aba Produtos: eles aparecem aqui para a IA procurar no vídeo.</div>';

    const tr=(window.t||String);
    const sync=d.sync||{jobIds:[],explicit:false}, syncSet=new Set(sync.jobIds||[]);
    const byJob=new Map();cands.forEach(c=>{const x=byJob.get(c.analysisJobId)||{n:0,ok:0};x.n++;if(c.reviewStatus==='APPROVED')x.ok++;byJob.set(c.analysisJobId,x);});
    const scenesOf=(j)=>{const c=j.config||{};return c.sceneSource==='TRACK'?`${(c.scenes||[]).length} ${tr('cenas do Editor')}`:c.sceneSource==='SINGLE'?tr('uma cena só'):tr('cenas da IA');};
    $("aiOpsJobs").innerHTML=jobs.length?jobs.map(j=>{const k=byJob.get(j.id)||{n:0,ok:0};return `<div class="stack-row job-row ${syncSet.has(j.id)?'is-sync':''}" data-job="${esc(j.id)}">
      <label class="sync-chk" title="${esc(tr('Enviar os itens aprovados desta análise para o app'))}"><input type="checkbox" data-sync-job="${esc(j.id)}" ${syncSet.has(j.id)?'checked':''} ${j.status==='COMPLETED'?'':'disabled'}/> App</label>
      <div class="grow"><b>${esc(j.mode)}</b> · ${esc(j.scanDepth||'STANDARD')} · ${esc(scenesOf(j))}<small>${new Date(j.createdAt).toLocaleString('pt-BR')} · ${k.n} ${tr('itens')} · ${k.ok} ${tr('aprovados')}${j.errorMessage?` · ${esc(j.errorMessage)}`:''}</small></div>
      <span class="status-pill ${String(j.status||'').toLowerCase()}">${esc(j.status)}</span>
      <button class="ghost small danger" data-del-job="${esc(j.id)}" ${j.status==='RUNNING'?'disabled':''} title="${esc(tr('Excluir esta análise e os itens dela'))}">${esc(tr('Excluir'))}</button></div>`;}).join(''):'<div class="empty-state">Nenhuma análise persistente desta obra.</div>';
    const last=sync.last;
    const ago=(ms)=>{const s=Math.max(0,Math.round((Date.now()-Number(ms))/1000));return s<60?`${s}s`:s<3600?`${Math.round(s/60)} min`:new Date(Number(ms)).toLocaleString('pt-BR');};
    $("aiOpsSyncMsg").className='msg'+(last&&!last.ok?' bad':'');
    $("aiOpsSyncMsg").textContent=[
      jobs.length&&!sync.explicit?tr('Nenhuma análise marcada: vale a mais recente concluída.'):'',
      sync.pending?tr('Sincronizando com a trilha e o app…'):last?(last.ok?`${tr('Trilha do Editor e app sincronizados')}${last.trackTitle?` (“${last.trackTitle}”)`:''}: ${last.products} ${tr('produto(s) da IA em')} ${last.scenesWithProducts} ${tr('de')} ${last.scenes} ${tr('cenas')}${last.skipped?` · ${last.skipped} ${tr('aprovado(s) sem produto cadastrado ficaram de fora')}`:''} · ${tr('há {0}').replace('{0}',ago(last.at))}.`:`${tr('Falha na sincronização')}: ${last.error}`):tr('Os itens aprovados vão sozinhos para a trilha do Editor e para o app.')
    ].filter(Boolean).join(' ');
    if(sync.pending){clearTimeout(aiOps.syncT);aiOps.syncT=setTimeout(loadAiOps,1200);}
    $("aiOpsJobs").querySelectorAll('[data-sync-job]').forEach(cb=>cb.onchange=async()=>{
      const ids=[...$("aiOpsJobs").querySelectorAll('[data-sync-job]:checked')].map(x=>x.dataset.syncJob);
      const r=await api(`/api/ai/works/${encodeURIComponent(aiOps.workId)}/sync`,{method:'PUT',body:{jobIds:ids}});
      if(!r.ok)return toast(r.data.error||'Falha ao salvar a seleção.',true);
      aiOps.data.sync=r.data;renderAiOps();
    });
    $("aiOpsJobs").querySelectorAll('[data-del-job]').forEach(b=>b.onclick=async()=>{
      if(!confirm(tr('Excluir esta análise? Os itens descobertos, aceitos e rejeitados dela também são excluídos.')))return;
      const r=await api(`/api/ai/jobs/${encodeURIComponent(b.dataset.delJob)}`,{method:'DELETE'});
      if(!r.ok)return toast(r.data.error||(r.data.errors||[]).join(' ')||'Falha ao excluir.',true);
      toast(`${tr('Análise excluída')} (${r.data.candidates||0} ${tr('itens')}).`);await loadAiOps();
    });

    const verBy=new Map();(d.verifications||[]).forEach(v=>{if(!verBy.has(v.candidateId))verBy.set(v.candidateId,[]);verBy.get(v.candidateId).push(v);});
    const jf=$("aiOpsFilterJob"), jkeep=jf.value;
    jf.innerHTML=`<option value="">${esc(tr('Todas'))}</option>`+jobs.map((j,i)=>`<option value="${esc(j.id)}">#${jobs.length-i} · ${esc(new Date(j.createdAt).toLocaleString('pt-BR'))}</option>`).join('');
    if(jobs.some(j=>j.id===jkeep))jf.value=jkeep;
    aiOps.sel=new Set([...(aiOps.sel||[])].filter(id=>cands.some(c=>c.id===id)));
    const fs=$("aiOpsFilter").value, fj=jf.value;
    const shown=cands.filter(c=>(!fs||c.reviewStatus===fs)&&(!fj||c.analysisJobId===fj));
    aiOps.shown=shown;
    const assetForProduct=(pid)=>(assets.find(a=>a.productId&&a.productId===pid)||{}).id||'';
    const groups=[];const gk=(c)=>`${(c.primaryPayload||{}).sourceSceneId||''}|${c.startSeconds}|${c.endSeconds}`;
    shown.forEach(c=>{let g=groups.find(x=>x.key===gk(c));if(!g){g={key:gk(c),title:(c.primaryPayload||{}).sourceSceneTitle||'',start:c.startSeconds,end:c.endSeconds,items:[]};groups.push(g);}g.items.push(c);});
    groups.sort((a,b)=>a.start-b.start);
    const card=(c)=>{
      const ver=(verBy.get(c.id)||[]).sort((a,b)=>Number(b.checkedAt||0)-Number(a.checkedAt||0))[0]||null;
      const flag=aiOpsOpenFlag(c.id); const locked=['APPROVED','REJECTED'].includes(c.reviewStatus);
      const pre=c.resolvedAssetId||c.assetId||assetForProduct((c.primaryPayload||{}).productId);
      const assetOptions=visibleAssets.map(a=>`<option value="${esc(a.id)}"${a.id===pre?' selected':''}>${esc(a.name)}</option>`).join('');
      return `<article class="review-card ${flag?'has-flag':''} ${aiOps.sel.has(c.id)?'is-picked':''}" data-candidate="${esc(c.id)}">
        <label class="pick"><input type="checkbox" data-pick="${esc(c.id)}" ${aiOps.sel.has(c.id)?'checked':''} aria-label="${esc(tr('Selecionar'))}"/></label>
        <div class="review-time"><b>${aiOpsFmt(c.startSeconds)}–${aiOpsFmt(c.endSeconds)}</b><span>${Math.round(Number(c.primaryConfidence||0)*100)}%</span></div>
        <div class="review-main"><div class="review-title"><b>${esc(c.candidateName||aiOpsAssetName(c.assetId)||'Item detectado')}</b><span class="status-pill ${String(c.reviewStatus||'').toLowerCase()}">${esc(c.reviewStatus)}</span></div>
          <p>${esc(c.candidateDescription||[c.proposedBrand,c.proposedModel,c.category].filter(Boolean).join(' · ')||'Sem descrição adicional.')}</p>
          <div class="evidence-line"><span>Primário <b>congelado</b></span><span>SHA ${esc(String(c.primaryFingerprint||'').slice(0,12))}…</span>${ver?`<span>Redundância <b>${esc(ver.state)}</b> · ${esc(ver.provider)}</span>`:'<span>Redundância ainda não registrada</span>'}${flag?`<span class="flag-label">⚑ ${esc(flag.reason)}</span>`:''}</div>
        </div>
        <div class="review-actions"><select data-review-asset ${locked?'disabled':''}><option value="">Qual produto é este?</option>${assetOptions}</select><textarea data-review-note placeholder="Nota do operador" ${locked?'disabled':''}></textarea><div class="row"><button class="primary small" data-review="APPROVE" ${locked?'disabled':''}>Aprovar</button><button class="ghost small danger" data-review="REJECT" ${locked?'disabled':''}>Rejeitar</button></div></div>
      </article>`;
    };
    $("aiOpsReview").innerHTML=shown.length?groups.map((g,gi)=>`<section class="review-scene"><header><label class="chk"><input type="checkbox" data-pick-group="${gi}" ${g.items.every(c=>aiOps.sel.has(c.id))?'checked':''}/> <b>${esc(g.title||`${tr('Cena')} ${gi+1}`)}</b></label><small>${aiOpsFmt(g.start)}–${aiOpsFmt(g.end)} · ${g.items.length} ${tr('itens')}</small></header>${g.items.map(card).join('')}</section>`).join('')
      :`<div class="empty-state">${cands.length?esc(tr('Nenhum item com esse filtro.')):'Nenhuma identificação para revisar nesta obra.'}</div>`;

    $("aiOpsReview").querySelectorAll('[data-review]').forEach(btn=>btn.onclick=()=>reviewAiOps(btn.closest('[data-candidate]'),btn.dataset.review));
    $("aiOpsReview").querySelectorAll('[data-pick]').forEach(cb=>cb.onchange=()=>{cb.checked?aiOps.sel.add(cb.dataset.pick):aiOps.sel.delete(cb.dataset.pick);cb.closest('.review-card').classList.toggle('is-picked',cb.checked);renderAiOpsSel();});
    $("aiOpsReview").querySelectorAll('[data-pick-group]').forEach(cb=>cb.onchange=()=>{groups[Number(cb.dataset.pickGroup)].items.forEach(c=>cb.checked?aiOps.sel.add(c.id):aiOps.sel.delete(c.id));renderAiOps();});
    renderAiOpsSel();

    $("aiOpsPlacements").innerHTML=placements.length?placements.map(p=>`<div class="stack-row"><div><b>${esc(aiOpsAssetName(p.assetId))}</b><small>${aiOpsFmt(p.displayStartSeconds)}–${aiOpsFmt(p.displayEndSeconds)} · físico ${aiOpsFmt(p.physicalStartSeconds)}–${aiOpsFmt(p.physicalEndSeconds)}</small></div><span class="status-pill approved">APPROVED</span></div>`).join(''):'<div class="empty-state">Nenhum placement aprovado ainda.</div>';

    const tl=d.timeline;
    $("aiOpsTimeline").innerHTML=tl&&tl.scenes&&tl.scenes.length?`<div class="timeline-meta"><b>rev. ${esc(tl.revision)}</b><span>${esc((tl.policy||{}).visibility||'PAST_AND_CURRENT')}</span><span>${tl.scenes.length} cenas comerciais</span></div><div class="timeline-rail">${tl.scenes.map(sc=>`<div class="timeline-event"><span>${aiOpsFmt(sc.start)}</span><b>${esc((sc.products||[]).map(p=>p.name).join(' · ')||'Placement')}</b><small>${aiOpsFmt(sc.end)}</small></div>`).join('')}</div>`:'<div class="empty-state">A Commerce Timeline ainda não foi publicada para esta obra.</div>';
    const pol=d.timelinePolicy||tl&&tl.policy||{};
    $("aiOpsVisibility").value=pol.visibility||'PAST_AND_CURRENT';
    $("aiOpsThumbs").checked=pol.thumbnailsEnabled!==false;
    $("aiOpsMissed").checked=pol.missedItemsEnabled!==false;
    $("aiOpsSeek").checked=!!pol.allowSceneSeek;
  }

  function renderAiOpsSel(){
    const n=aiOps.sel?aiOps.sel.size:0, shown=aiOps.shown||[];
    $("aiOpsSelCount").textContent=n?`${n} ${(window.t||String)('selecionado(s)')}`:'';
    $("aiOpsSelAll").checked=shown.length>0&&shown.every(c=>aiOps.sel.has(c.id));
    $("aiOpsApproveSel").disabled=$("aiOpsDeleteSel").disabled=!n;
  }
  $("aiOpsFilter").onchange=()=>renderAiOps();
  $("aiOpsFilterJob").onchange=()=>renderAiOps();
  $("aiOpsSelAll").onchange=()=>{(aiOps.shown||[]).forEach(c=>$("aiOpsSelAll").checked?aiOps.sel.add(c.id):aiOps.sel.delete(c.id));renderAiOps();};
  $("aiOpsDeleteSel").onclick=async()=>{
    const ids=[...(aiOps.sel||[])];if(!ids.length)return;
    if(!confirm(`${(window.t||String)('Excluir os itens selecionados?')} (${ids.length})`))return;
    const r=await api('/api/ai/candidates/delete',{method:'POST',body:{ids}});
    if(!r.ok)return toast(r.data.error||'Falha ao excluir.',true);
    aiOps.sel.clear();toast(`${r.data.deleted} ${(window.t||String)('item(ns) excluído(s).')}`);await loadAiOps();setTimeout(loadAiOps,1500);
  };
  $("aiOpsApproveSel").onclick=async()=>{
    const d=aiOps.data||{}, assets=d.assets||[];
    const todo=(d.candidates||[]).filter(c=>aiOps.sel.has(c.id)&&c.reviewStatus==='DETECTED');
    let ok=0,skip=0;
    $("aiOpsApproveSel").disabled=true;
    for(const c of todo){
      const cardEl=$("aiOpsReview").querySelector(`[data-candidate="${CSS.escape(c.id)}"]`);
      const chosen=cardEl&&cardEl.querySelector('[data-review-asset]').value;
      const assetId=chosen||c.assetId||(assets.find(a=>a.productId&&a.productId===(c.primaryPayload||{}).productId)||{}).id;
      if(!assetId){skip++;continue;}
      const flag=aiOpsOpenFlag(c.id);
      const url=flag?`/api/ai/operator-flags/${encodeURIComponent(flag.id)}/resolve`:`/api/ai/candidates/${encodeURIComponent(c.id)}/review`;
      const r=await api(url,{method:'POST',body:{decision:'APPROVE',assetId}});
      r.ok?ok++:skip++;
    }
    aiOps.sel.clear();
    toast(`${ok} ${(window.t||String)('aprovado(s).')}${skip?` ${skip} ${(window.t||String)('sem produto escolhido (escolha “Qual produto é este?”).')}`:''}`,!ok&&!!skip);
    await loadAiOps(); setTimeout(()=>{loadAiOps();if(st.workId===aiOps.workId)loadTrackList();},1500);
  };
  $("aiOpsPublish").onclick=async()=>{
    const wid=aiOps.workId;if(!wid)return;
    $("aiOpsPublish").disabled=true;$("aiOpsSyncMsg").textContent=(window.t||String)('Publicando no app…');
    const r=await api(`/api/ai/works/${encodeURIComponent(wid)}/publish`,{method:'POST',body:{}});
    $("aiOpsPublish").disabled=false;
    if(!r.ok){$("aiOpsSyncMsg").textContent=r.data.error||(r.data.errors||[]).join(' ')||'Falha ao publicar.';return;}
    const tr=(window.t||String);
    if(st.workId===wid)await loadTrackList();
    await loadAiOps();
  };

  async function reviewAiOps(card,decision){
    const candidateId=card.dataset.candidate, assetId=card.querySelector('[data-review-asset]').value, note=card.querySelector('[data-review-note]').value.trim();
    if(decision==='APPROVE'&&!assetId)return toast('Escolha qual dos seus produtos é este item.',true);
    const flag=aiOpsOpenFlag(candidateId);
    const url=flag?`/api/ai/operator-flags/${encodeURIComponent(flag.id)}/resolve`:`/api/ai/candidates/${encodeURIComponent(candidateId)}/review`;
    const r=await api(url,{method:'POST',body:{decision,assetId:assetId||undefined,note}});
    if(!r.ok)return toast(r.data.error||(r.data.errors||[]).join(' ')||'Falha na revisão.',true);
    toast(decision==='APPROVE'?(window.t||String)('Aprovado: vai para a trilha do Editor e para o app.'):'Identificação rejeitada.'); await loadAiOps(); setTimeout(()=>{loadAiOps();if(st.workId===aiOps.workId)loadTrackList();},1500);
  }

  $("aiOpsWork").onchange=()=>{aiOps.workId=$("aiOpsWork").value;loadAiOps();};
  $("aiOpsRefresh").onclick=loadAiOps;
  $("aiOpsMode").onchange=()=>renderAiOps();
  $("aiOpsRun").onclick=async()=>{
    const workId=$("aiOpsWork").value;if(!workId)return;
    const mode=$("aiOpsMode").value;
    const assetIds=[...$("aiOpsAssets").querySelectorAll('input:checked')].map(x=>x.value);
    const categories=[...$("aiOpsCategories").querySelectorAll('input:checked')].map(x=>x.value);
    if(mode==='TARGETED'&&!assetIds.length)return toast('Marque ao menos um produto para a IA procurar.',true);
    if(mode==='HYBRID'&&!assetIds.length)return toast('Marque ao menos um produto (ou use Descoberta aberta).',true);
    const sceneSource=$("aiOpsSceneSource").value;
    const body={analysisMode:mode,assetIds,categories,scanDepth:$("aiOpsDepth").value,minimumConfidence:Number($("aiOpsConfidence").value||0.6),includeBackground:$("aiOpsBackground").checked,sceneSource};
    if(sceneSource==='TRACK'){
      body.scenes=(aiOps.scenes||[]).filter(sc=>aiOps.sceneSel.has(sc.id));
      if(!body.scenes.length)return toast('Marque ao menos uma cena (ou crie os cortes no Editor de trilha com Detectar cortes).',true);
      const src=$("aiOpsSceneTrack").value; if(src&&src!=='editor')body.trackId=src;
    }
    $("aiOpsRun").disabled=true;$("aiOpsRunMsg").textContent='Iniciando análise…';
    const r=await api(`/api/works/${encodeURIComponent(workId)}/ai`,{method:'POST',body});
    $("aiOpsRun").disabled=false;
    if(!r.ok){$("aiOpsRunMsg").textContent=r.data.error||(r.data.errors||[]).join(' ')||'Falha ao iniciar.';return;}
    $("aiOpsRunMsg").textContent=sceneSource==='TRACK'?`${(window.t||String)('Análise iniciada')}: ${body.scenes.length} ${(window.t||String)('cena(s) analisadas ao mesmo tempo, cada uma separada.')}`:`Job ${r.data.analysisJob&&r.data.analysisJob.id||''} iniciado.`; aiOps.poll=setTimeout(loadAiOps,1000);
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
    const box = $("aiStatus"), tr = window.t || String;
    box.className = "ai-status";
    $("aiGo").disabled = !!(j && j.status === "rodando");
    $("aiScenesInfo").textContent = st.track ? `${st.track.scenes.length} ${tr("cena(s) nesta trilha")}` : "";
    if (!j || j.status === "nenhum") { box.innerHTML = ""; return; }
    if (j.status === "rodando") {
      box.innerHTML = `<span class="spin"></span><span>${esc(j.step || "analisando")}…</span>`;
      ai.poll = setTimeout(async () => showJob((await api(workUrl(j.workId))).data), 2500);
      return;
    }
    if (j.status === "erro") { box.className = "ai-status bad"; box.textContent = j.error; return; }
    const n = j.scenes.reduce((a, s) => a + s.items.length, 0);
    const auto = j.autoApproved || null;
    box.innerHTML = `<span>${j.scenes.length} ${esc(tr("cena(s) analisadas"))} · ${n} ${esc(tr("item(ns)"))}${auto ? ` · ${auto.approved} ${esc(tr("aprovado(s) sozinho(s)"))}` : ""}${j.model ? ` · ${esc(j.model)}` : ""}</span><button class="small primary" id="aiOpen">${esc(tr("Revisar sugestões"))}</button>`;
    $("aiOpen").onclick = openAi;
    // o que foi aprovado entra na trilha pela sincronização automática: recarrega a trilha quando terminar
    if (ai.reloadedFor !== j.finishedAt) { ai.reloadedFor = j.finishedAt; afterSync(); }
  }

  // espera a sincronização da IA com a trilha e recarrega o Editor (se não houver edição por salvar)
  async function afterSync() {
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 600));
      const ws = await api(`/api/ai/workspace?workId=${encodeURIComponent(st.workId)}`);
      if (ws.ok && ws.data.sync && !ws.data.sync.pending) break;
    }
    await refreshEditorTrack();
    if (!$("boardModal").hidden) { boardRefresh(); renderBoard(); }
  }

  $("aiGo").onclick = async () => {
    const tr = window.t || String;
    if (!st.track || !st.track.scenes.length) return toast(tr("Crie as cenas primeiro (Detectar cortes ou Nova cena a partir daqui)."), true);
    // a análise usa exatamente as cenas salvas desta trilha
    if (!st.track.id || editorDirty()) {
      $("aiStatus").innerHTML = `<span class="spin"></span><span>${esc(tr("Salvando a trilha…"))}</span>`;
      if (!(await saveTrack())) { $("aiStatus").textContent = ""; return; }
    }
    await api("/api/ai/assets/sync-products", { method: "POST", body: {} });
    const assets = ((await api("/api/ai/assets")).data || []).filter((a) => a.productId);
    const body = {
      analysisMode: assets.length ? "HYBRID" : "DISCOVERY", assetIds: assets.map((a) => a.id),
      categories: ["APPAREL", "WATCHES", "JEWELRY", "VEHICLES", "ELECTRONICS", "FURNITURE", "HOME_DECOR", "FOOD_BEVERAGE"],
      sceneSource: "TRACK", trackId: st.track.id,
      scenes: st.track.scenes.map((s) => ({ id: s.id, title: s.title, start: s.start, end: s.end })),
      autoApprove: $("aiAuto").checked, autoApproveMin: 0.7,
    };
    const r = await api(workUrl(st.workId), { method: "POST", body });
    if (!r.ok) return toast(r.data.error || "Não foi possível iniciar a análise.", true);
    showJob(r.data);
  };

  const confClass = (c) => (c >= 0.75 ? "hi" : c >= 0.5 ? "mid" : "lo");
  const fmtS = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;

  // Sugestões ainda não decididas (fila de revisão da IA), agrupadas pelas cenas desta trilha
  async function openAi() {
    const tr = window.t || String;
    const ws = (await api(`/api/ai/workspace?workId=${encodeURIComponent(st.workId)}`)).data || {};
    ai.ws = ws;
    ai.products = (await api("/api/me/products")).data || [];
    ai.products.forEach((p) => (st.products[p.id] = st.products[p.id] || p));
    const assetByProduct = new Map((ws.assets || []).filter((a) => a.productId).map((a) => [a.productId, a.id]));
    const productByAsset = new Map((ws.assets || []).filter((a) => a.productId).map((a) => [a.id, a.productId]));
    ai.assetByProduct = assetByProduct;
    const pending = (ws.candidates || []).filter((c) => c.reviewStatus === "DETECTED");
    ai.items = pending.map((c) => {
      const pid = productByAsset.get(c.assetId) || (c.primaryPayload || {}).productId || null;
      const t = Number.isFinite(Number(c.bestSeconds)) ? Number(c.bestSeconds) : (Number(c.startSeconds) + Number(c.endSeconds)) / 2;
      const sc = st.track.scenes.find((s) => s.id === (c.primaryPayload || {}).sourceSceneId && t >= s.start - 0.5 && t <= s.end + 0.5) || st.track.scenes.find((s) => t >= s.start && t < s.end) || st.track.scenes[st.track.scenes.length - 1];
      return { key: c.id, candidateId: c.id, productId: ws.assets && pid && assetByProduct.has(pid) ? pid : null, name: c.candidateName || tr("Item detectado"), category: c.category || "", description: c.candidateDescription || "",
        visibleText: (c.primaryPayload || {}).visibleText || "", t, box: c.box2d || null, confidence: Number(c.primaryConfidence || 0), sceneId: sc ? sc.id : null };
    });
    const opts = (sel) => `<option value="">— ${esc(tr("sem produto"))} —</option>` + ai.products.map((p) => `<option value="${esc(p.id)}" ${p.id === sel ? "selected" : ""}>${esc(p.name)}</option>`).join("");
    $("aiSub").textContent = pending.length ? `${pending.length} ${tr("sugestão(ões) para confirmar. Marque as certas, troque o produto se precisar e aprove: elas entram na trilha e no app, cada uma na sua cena.")}` : tr("Nada pendente: tudo o que a IA encontrou já foi decidido.");
    $("aiBody").innerHTML = st.track.scenes.map((s) => {
      const list = ai.items.filter((it) => it.sceneId === s.id);
      if (!list.length) return "";
      return `<section class="ai-scene"><h4>${esc(s.title)} <small>${fmtS(s.start)}–${fmtS(s.end)}</small></h4>${list.map((it) => {
        const on = !!it.productId && it.confidence >= 0.5;
        return `<div class="ai-item ${on ? "" : "off"}" data-k="${esc(it.key)}">
          <input type="checkbox" ${on ? "checked" : ""} aria-label="${esc(tr("Usar esta sugestão"))}" />
          <canvas width="264" height="264"></canvas>
          <div><div class="nm">${esc(it.name)}</div><div class="ds">${esc(it.category)} · ${esc(tr("aparece em"))} ${fmtS(it.t)}${it.description ? ` · ${esc(it.description)}` : ""}</div>${it.visibleText ? `<span class="vt">Na tela: ${esc(it.visibleText)}</span>` : ""}</div>
          <div class="ai-match">
            ${it.productId ? `<span class="conf ${confClass(it.confidence)}">${Math.round(it.confidence * 100)}% de certeza</span>` : `<span class="conf lo">Sem produto no catálogo</span>`}
            <select aria-label="Produto">${opts(it.productId)}</select>
            <button type="button" class="ghost small" data-create>Criar produto com esta imagem</button>
          </div></div>`;
      }).join("")}</section>`;
    }).join("") || `<p class="help">${esc(tr("Nada pendente nesta trilha."))}</p>`;
    $("aiBody").querySelectorAll(".ai-item").forEach((row) => {
      const it = ai.items.find((x) => x.key === row.dataset.k);
      const cb = row.querySelector("input[type=checkbox]"), sel = row.querySelector("select");
      cb.onchange = () => row.classList.toggle("off", !cb.checked);
      sel.onchange = () => { it.productId = sel.value || null; cb.checked = !!sel.value; row.classList.toggle("off", !cb.checked); };
      row.querySelector("[data-create]").onclick = () => createFromItem(it, row.querySelector("canvas"));
    });
    $("aiRejectRest").checked = false;
    $("aiApply").disabled = !ai.items.length;
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
  // aprovar os marcados (com produto) e, se pedido, rejeitar os desmarcados: vão para a trilha e o app sozinhos
  $("aiApply").onclick = async () => {
    const tr = window.t || String, ws = ai.ws || {};
    const openFlag = (cid) => (ws.flags || []).find((f) => f.candidateId === cid && f.status === "OPEN");
    const rejectRest = $("aiRejectRest").checked;
    let ok = 0, rej = 0, skip = 0;
    $("aiApply").disabled = true;
    for (const row of $("aiBody").querySelectorAll(".ai-item")) {
      const it = ai.items.find((x) => x.key === row.dataset.k);
      const checked = row.querySelector("input[type=checkbox]").checked;
      let decision = null, assetId;
      if (checked && it.productId) {
        assetId = ai.assetByProduct.get(it.productId);
        if (!assetId) { await api("/api/ai/assets/sync-products", { method: "POST", body: {} }); const a = ((await api("/api/ai/assets")).data || []).find((x) => x.productId === it.productId); assetId = a && a.id; }
        if (assetId) decision = "APPROVE"; else skip++;
      } else if (checked) skip++;
      else if (rejectRest) decision = "REJECT";
      if (!decision) continue;
      const f = openFlag(it.candidateId);
      const url = f ? `/api/ai/operator-flags/${encodeURIComponent(f.id)}/resolve` : `/api/ai/candidates/${encodeURIComponent(it.candidateId)}/review`;
      const r = await api(url, { method: "POST", body: { decision, assetId } });
      if (r.ok) decision === "APPROVE" ? ok++ : rej++; else skip++;
    }
    $("aiModal").hidden = true;
    toast(`${ok} ${tr("aprovado(s): entram na trilha e no app.")}${rej ? ` ${rej} ${tr("rejeitado(s).")}` : ""}${skip ? ` ${skip} ${tr("sem produto escolhido.")}` : ""}`, !ok && !!skip);
    afterSync();
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
