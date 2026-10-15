/**
 * Marketplace Piloto — vitrine, produto, carrinho, checkout (Pix simulado) e pedido.
 * O carrinho guarda, em cada item, o código de oferta que veio do SceneShop:
 * é ele que garante o preço combinado com a produção.
 */
(function () {
  "use strict";
  const app = document.getElementById("app");
  const brl = (v) => Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const SEAL = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l3 3h4v4l3 3-3 3v4h-4l-3 3-3-3H5v-4l-3-3 3-3V5h4z"/><path d="M8.5 12l2.5 2.5 4.5-5"/></svg>';

  // ---------------------------------------------------------------- carrinho (neste navegador)
  const cart = {
    get() { try { return JSON.parse(localStorage.getItem("mkt-cart") || "[]"); } catch (e) { return []; } },
    set(v) { try { localStorage.setItem("mkt-cart", JSON.stringify(v)); } catch (e) {} ; count(); },
    add(item) {
      const c = cart.get();
      const cur = c.find((x) => x.produto === item.produto);
      if (cur) { cur.qty = Math.min(5, cur.qty + item.qty); if (item.ss_offer) cur.ss_offer = item.ss_offer; }
      else c.push(item);
      cart.set(c);
    },
  };
  function count() { document.getElementById("cartCount").textContent = cart.get().reduce((n, i) => n + i.qty, 0); }

  function toast(msg) {
    const t = document.createElement("div");
    t.className = "toast"; t.textContent = msg; document.body.appendChild(t);
    setTimeout(() => t.remove(), 2600);
  }
  const api = async (url, opts = {}) => {
    const r = await fetch(url, { method: opts.method || "GET", headers: opts.body ? { "Content-Type": "application/json" } : {}, body: opts.body ? JSON.stringify(opts.body) : undefined });
    return { ok: r.ok, data: await r.json().catch(() => ({})) };
  };
  const go = (url) => { history.pushState({}, "", url); route(); window.scrollTo(0, 0); };
  document.addEventListener("click", (e) => {
    const a = e.target.closest("a[href^='/marketplace']");
    if (a && !a.target) { e.preventDefault(); go(a.getAttribute("href")); }
  });
  window.addEventListener("popstate", route);
  document.getElementById("searchForm").onsubmit = (e) => { e.preventDefault(); go("/marketplace?q=" + encodeURIComponent(document.getElementById("q").value)); };

  // ---------------------------------------------------------------- vitrine
  async function home() {
    const q = new URLSearchParams(location.search).get("q") || "";
    const list = (await api("/mkt/api/catalog?q=" + encodeURIComponent(q))).data;
    app.innerHTML = `
      ${q ? `<div class="crumbs">Resultados para “${esc(q)}”</div>` : `<div class="hero"><div><h1>Visto em cena</h1><p>Figurino e objetos das obras parceiras, com preço garantido pela produção.</p></div></div>`}
      ${list.length ? `<div class="grid">${list.map(cardHtml).join("")}</div>` : `<div class="empty">Nenhum produto ${q ? "encontrado" : "à venda ainda. Cadastre produtos no estúdio e marque “vender no Marketplace Piloto”"}.</div>`}`;
  }
  const cardHtml = (p) => `<a class="pcard" href="/marketplace/produto/${encodeURIComponent(p.id)}">
      <div class="ph"><img src="${esc(p.images[0])}" alt="${esc(p.name)}" loading="lazy"/></div>
      <div class="pi"><span class="br">${esc(p.brand)}</span><span class="nm">${esc(p.name)}</span><span class="pr">${brl(p.listPrice)}</span></div></a>`;

  // ---------------------------------------------------------------- produto
  async function product(id, token) {
    const r = await api(`/mkt/api/product/${encodeURIComponent(id)}${token ? "?ss_offer=" + encodeURIComponent(token) : ""}`);
    if (!r.ok) { app.innerHTML = `<div class="empty">${esc(r.data.error || "Produto não encontrado.")}</div>`; return; }
    const { product: p, offer, related, seller } = r.data;
    const valid = offer && offer.valid;
    const price = valid ? offer.price : p.listPrice;
    const pct = valid && p.listPrice > price ? Math.round((1 - price / p.listPrice) * 100) : 0;
    app.innerHTML = `
      <div class="crumbs"><a href="/marketplace">Início</a> › ${esc(p.category)} › ${esc(p.name)}</div>
      <div class="pdp">
        <div class="card gallery">
          <div class="thumbs">${p.images.map((u, i) => `<button data-i="${i}" class="${i ? "" : "on"}" aria-label="Foto ${i + 1}"><img src="${esc(u)}" alt=""/></button>`).join("")}</div>
          <div class="main-img"><img id="mainImg" src="${esc(p.images[0])}" alt="${esc(p.name)}"/></div>
        </div>
        <div class="card buy">
          <span class="brand">${esc(p.brand)}</span>
          <h1>${esc(p.name)}</h1>
          ${p.sku ? `<span class="sku">Cód. ${esc(p.sku)}</span>` : ""}
          <div>${valid && pct ? `<span class="was">${brl(p.listPrice)}</span><span class="off">${pct}% OFF</span>` : ""}<div class="price">${brl(price)}</div>
            <span class="muted">em até 10x de ${brl(price / 10)} sem juros</span></div>
          ${valid ? `<div class="seal">${SEAL}<div><b>Preço garantido pela produção${offer.work ? ` de “${esc(offer.work)}”` : ""}</b><br>Você viu este produto em cena. Oferta válida até ${new Date(offer.expiresAt).toLocaleString("pt-BR")}.</div></div>` : ""}
          ${offer && !offer.valid ? `<div class="seal bad">${SEAL}<div><b>Oferta não aplicada (${esc(offer.reason)})</b><br>Vale o preço normal da loja.</div></div>` : ""}
          <div class="qty"><label for="qty">Quantidade</label><select id="qty">${[1, 2, 3, 4, 5].map((n) => `<option>${n}</option>`).join("")}</select></div>
          <span class="ship">Frete grátis · chega em até 5 dias úteis</span>
          <button class="btn primary" id="buyNow">Comprar agora</button>
          <button class="btn soft" id="addCart">Adicionar ao carrinho</button>
          <div class="seller">Vendido e entregue por <b>${esc(seller.name)}</b></div>
        </div>
      </div>
      ${p.description ? `<div class="card desc"><h2>Descrição</h2>${esc(p.description).replace(/\n/g, "<br>")}</div>` : ""}
      ${related.length ? `<h2 class="section-title">Também em cena</h2><div class="grid">${related.map(cardHtml).join("")}</div>` : ""}`;
    app.querySelectorAll(".thumbs button").forEach((b) => (b.onclick = () => {
      app.querySelectorAll(".thumbs button").forEach((x) => x.classList.toggle("on", x === b));
      document.getElementById("mainImg").src = p.images[Number(b.dataset.i)];
    }));
    const item = () => ({ produto: p.id, qty: Number(document.getElementById("qty").value), ss_offer: valid ? token : null });
    document.getElementById("addCart").onclick = () => { cart.add(item()); toast("Adicionado ao carrinho"); };
    document.getElementById("buyNow").onclick = () => { cart.add(item()); go("/marketplace/carrinho"); };
  }

  // ---------------------------------------------------------------- carrinho
  async function loadLines() {
    return Promise.all(cart.get().map(async (it) => {
      const r = await api(`/mkt/api/product/${encodeURIComponent(it.produto)}${it.ss_offer ? "?ss_offer=" + encodeURIComponent(it.ss_offer) : ""}`);
      if (!r.ok) return null;
      const valid = r.data.offer && r.data.offer.valid;
      return { ...it, p: r.data.product, valid, unit: valid ? r.data.offer.price : r.data.product.listPrice };
    })).then((l) => l.filter(Boolean));
  }
  const totals = (lines) => ({
    total: lines.reduce((n, l) => n + l.unit * l.qty, 0),
    list: lines.reduce((n, l) => n + l.p.listPrice * l.qty, 0),
  });

  async function cartPage() {
    const lines = await loadLines();
    if (!lines.length) { app.innerHTML = `<div class="empty"><h2>Seu carrinho está vazio</h2><p><a href="/marketplace">Ver produtos</a></p></div>`; return; }
    const t = totals(lines);
    app.innerHTML = `<h1 style="font-size:24px;margin-bottom:16px">Carrinho</h1><div class="two">
      <div class="card">${lines.map((l, i) => `<div class="line">
        <img src="${esc(l.p.images[0])}" alt=""/>
        <div><div class="nm">${esc(l.p.name)}</div>${l.valid ? `<span class="tag">Preço garantido pela produção</span>` : ""}
          <div class="ctl">Qtd. <select data-q="${i}">${[1, 2, 3, 4, 5].map((n) => `<option ${n === l.qty ? "selected" : ""}>${n}</option>`).join("")}</select><button data-rm="${i}">Remover</button></div></div>
        <div style="text-align:right">${l.valid && l.p.listPrice > l.unit ? `<div class="was">${brl(l.p.listPrice * l.qty)}</div>` : ""}<b>${brl(l.unit * l.qty)}</b></div></div>`).join("")}</div>
      <div class="card summary"><div class="row"><span>Produtos</span><span>${brl(t.list)}</span></div>
        ${t.list > t.total ? `<div class="row" style="color:var(--ok)"><span>Preço garantido em cena</span><span>− ${brl(t.list - t.total)}</span></div>` : ""}
        <div class="row"><span>Frete</span><span style="color:var(--ok)">Grátis</span></div>
        <div class="row total"><span>Total</span><span>${brl(t.total)}</span></div>
        <a class="btn primary" href="/marketplace/checkout" style="text-align:center;text-decoration:none">Finalizar compra</a></div></div>`;
    app.querySelectorAll("[data-q]").forEach((s) => (s.onchange = () => { const c = cart.get(); c[s.dataset.q].qty = Number(s.value); cart.set(c); cartPage(); }));
    app.querySelectorAll("[data-rm]").forEach((b) => (b.onclick = () => { const c = cart.get(); c.splice(Number(b.dataset.rm), 1); cart.set(c); cartPage(); }));
  }

  // ---------------------------------------------------------------- checkout (Pix simulado)
  async function checkout() {
    const lines = await loadLines();
    if (!lines.length) return go("/marketplace/carrinho");
    const t = totals(lines);
    app.innerHTML = `<h1 style="font-size:24px;margin-bottom:16px">Finalizar compra</h1><div class="two">
      <div><form class="card form" id="co">
        <h2>Entrega</h2>
        <label class="full">Nome completo<input name="name" autocomplete="name" required /></label>
        <label>E-mail<input name="email" type="email" autocomplete="email" required /></label>
        <label>CEP<input name="cep" inputmode="numeric" placeholder="00000-000" required /></label>
        <label class="full">Endereço e número<input name="address" autocomplete="street-address" required /></label>
        <label>Cidade<input name="city" autocomplete="address-level2" /></label>
        <label>Pagamento<input value="Pix (simulado)" disabled /></label>
        <div class="errors" id="coErr"></div>
        <button class="btn primary full" style="grid-column:1/-1">Gerar Pix de ${brl(t.total)}</button>
      </form><div id="pixBox"></div></div>
      <div class="card summary">${lines.map((l) => `<div class="row"><span>${l.qty}× ${esc(l.p.name)}</span><span>${brl(l.unit * l.qty)}</span></div>`).join("")}
        <div class="row total"><span>Total</span><span>${brl(t.total)}</span></div></div></div>`;
    document.getElementById("co").onsubmit = async (e) => {
      e.preventDefault();
      const buyer = Object.fromEntries(new FormData(e.target));
      const r = await api("/mkt/api/checkout", { method: "POST", body: { buyer, items: cart.get() } });
      if (!r.ok) return (document.getElementById("coErr").textContent = (r.data.errors || [r.data.error]).join(" "));
      const o = r.data;
      e.target.querySelector("button").disabled = true;
      document.getElementById("pixBox").innerHTML = `<div class="card pix" style="margin-top:16px">
        <img src="${o.pixQr}" alt="QR code Pix (simulado)"/>
        <div><h2 style="font-size:18px">Pague com Pix</h2><p class="muted">Pedido ${esc(o.number)} · ${brl(o.total)}. Este Pix é simulado: nenhum valor é cobrado.</p>
          <code>${esc(o.pixCode)}</code>
          <button class="btn primary" id="payBtn">Simular pagamento do Pix</button></div></div>`;
      document.getElementById("payBtn").onclick = async () => {
        document.getElementById("payBtn").disabled = true;
        const p = await api(`/mkt/api/order/${o.id}/pay`, { method: "POST" });
        if (!p.ok) return toast("Não foi possível confirmar.");
        cart.set([]);
        go(`/marketplace/pedido/${o.id}`);
      };
    };
  }

  // ---------------------------------------------------------------- pedido
  const STATUS = { pago: "Pagamento aprovado", aguardando_pagamento: "Aguardando pagamento", cancelado: "Cancelado" };
  async function order(id) {
    const r = await api(`/mkt/api/order/${encodeURIComponent(id)}`);
    if (!r.ok) { app.innerHTML = `<div class="empty">Pedido não encontrado.</div>`; return; }
    const o = r.data;
    app.innerHTML = `<div class="card" style="padding:24px">
        <span class="status ${o.status}">${STATUS[o.status]}</span>
        <h1 style="font-size:26px;margin:12px 0 4px">${o.status === "pago" ? "Obrigado pela compra!" : "Pedido " + esc(o.number)}</h1>
        <p class="muted">Pedido ${esc(o.number)} · ${new Date(o.at).toLocaleString("pt-BR")} · entrega para ${esc(o.buyer.name)}</p>
        ${o.items.map((i) => `<div class="line"><img src="${esc(i.image)}" alt=""/><div><div class="nm">${esc(i.name)}</div>${i.guaranteed ? '<span class="tag">Preço garantido pela produção</span>' : ""}<div class="muted" style="font-size:13px">${i.qty} × ${brl(i.unitPrice)}</div></div><b>${brl(i.unitPrice * i.qty)}</b></div>`).join("")}
        <div class="summary" style="position:static;padding:16px 0 0">${o.savings > 0 ? `<div class="row" style="color:var(--ok)"><span>Economia com o preço garantido</span><span>${brl(o.savings)}</span></div>` : ""}
          <div class="row total"><span>Total</span><span>${brl(o.total)}</span></div></div>
        ${o.status === "pago" ? `<button class="btn ghost" id="cancel">Cancelar pedido (simular devolução)</button>` : ""}
      </div>
      <details class="card backstage"><summary>Nos bastidores do piloto</summary>
        <p class="muted">Para cada item com preço garantido, a loja avisou o SceneShop com uma mensagem assinada. O SceneShop conferiu o código e o preço e registrou a comissão.</p>
        <table><tr><th>Item</th><th>Aviso ao SceneShop</th><th>Comissão</th></tr>
        ${o.items.map((i) => `<tr><td>${esc(i.name)}</td><td>${!i.guaranteed ? "Sem código de oferta (venda comum)" : i.sceneshop ? (i.sceneshop.ok ? (i.sceneshop.duplicate ? "Já registrado" : "Aceito") : "Recusado: " + esc(i.sceneshop.error)) : "Pendente"}${i.refund ? " · devolução: " + (i.refund.ok ? "estornada" : esc(i.refund.error)) : ""}</td><td>${i.sceneshop && i.sceneshop.commission != null ? brl(i.sceneshop.commission) : "—"}</td></tr>`).join("")}</table>
      </details>`;
    const c = document.getElementById("cancel");
    if (c) c.onclick = async () => { await api(`/mkt/api/order/${o.id}/cancel`, { method: "POST" }); toast("Pedido cancelado e comissão estornada."); order(id); };
  }

  // ---------------------------------------------------------------- rotas
  function route() {
    count();
    const p = location.pathname.replace(/\/+$/, "");
    const qs = new URLSearchParams(location.search);
    let m;
    if (p === "/marketplace/oferta") {
      // entrada vinda do SceneShop: guarda o código na URL do produto
      const id = qs.get("produto"), token = qs.get("ss_offer");
      history.replaceState({}, "", `/marketplace/produto/${encodeURIComponent(id)}${token ? "?ss_offer=" + encodeURIComponent(token) : ""}`);
      return product(id, token);
    }
    if ((m = p.match(/^\/marketplace\/produto\/(.+)$/))) return product(decodeURIComponent(m[1]), qs.get("ss_offer"));
    if (p === "/marketplace/carrinho") return cartPage();
    if (p === "/marketplace/checkout") return checkout();
    if ((m = p.match(/^\/marketplace\/pedido\/([a-f0-9]+)$/))) return order(m[1]);
    return home();
  }
  route();
})();
