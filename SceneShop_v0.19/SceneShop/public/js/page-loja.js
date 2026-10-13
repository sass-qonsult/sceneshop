// Extraído do HTML: a Content-Security-Policy (script-src 'self') bloqueia scripts embutidos.
    (async function () {
      const $ = (id) => document.getElementById(id);
      const brl = (v) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
      const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
      const seller = location.pathname.split("/").filter(Boolean)[1];
      const qs = new URLSearchParams(location.search);
      // tudo o que veio no link (produto, ss_offer, cupom, campanha, ss_ref)
      const params = Object.fromEntries(qs.entries());
      const produto = params.produto;
      const info = await (await fetch(`/loja-demo/${seller}/oferta?${qs}`)).json();
      if (info.error) { $("name").textContent = info.error; $("buy").disabled = true; return; }
      const retailer = info.seller.kind === "varejista";
      document.documentElement.style.setProperty("--brand", info.seller.color);
      document.title = `${info.product.name} — ${info.seller.name}`;
      $("sellerName").textContent = info.seller.name;
      $("sellerKind").textContent = retailer ? "· varejista com acordo com a produção" : "· loja oficial da marca, vendedor verificado";
      $("brand").textContent = info.product.brand;
      $("name").textContent = info.product.name;
      $("img").src = info.product.image;
      $("token").textContent = [params.cupom && "cupom=" + params.cupom, params.campanha && "campanha=" + params.campanha, params.ss_ref && "ss_ref=" + params.ss_ref, params.ss_offer && "ss_offer=" + params.ss_offer].filter(Boolean).join("\n") || "sem código de oferta";
      const o = info.offer;
      const how = { assinatura: "Código de oferta conferido com a chave pública do SceneShop.", cupom: `Cupom de uso único <b>${esc((o || {}).code || "")}</b> aplicado.`, campanha: `Campanha <b>${esc((o || {}).campaign || "")}</b> com preço negociado.` };
      if (o && o.valid) {
        $("was").hidden = false;
        $("was").textContent = brl(info.normalPrice);
        $("price").textContent = brl(o.price);
        $("seal").hidden = false;
        $("seal").innerHTML = `<div><b>Preço ${retailer ? "negociado" : "garantido"} pela produção${o.work ? " de “" + esc(o.work) + "”" : ""}</b><br>${how[o.mode]} Válido até ${new Date(o.expiresAt).toLocaleString("pt-BR")}.</div>`;
      } else {
        $("price").textContent = brl(info.normalPrice);
        if (o) { $("seal").hidden = false; $("seal").className = "seal bad"; $("seal").innerHTML = `<div><b>Oferta não aplicada (${esc(o.reason)})</b><br>Vale o preço normal da loja.</div>`; }
      }

      function reportBox(n) {
        return `<div class="row"><button class="ghost" id="sendReport">Enviar relatório de vendas do dia (${n} pedido${n > 1 ? "s" : ""})</button></div>`;
      }
      function bindReport() {
        const b = $("sendReport");
        if (!b) return;
        b.onclick = async () => {
          const x = await (await fetch(`/loja-demo/${seller}/relatorio`, { method: "POST" })).json();
          const s = x.summary || {};
          b.replaceWith(Object.assign(document.createElement("div"), { className: "report-sum",
            innerHTML: x.ok ? `Relatório conciliado pelo SceneShop: <b>${s.registrados}</b> venda(s) registrada(s), ${s.recusados} recusada(s), ${s.repetidos} repetida(s).` + (x.results || []).filter((r) => r.error).map((r) => `<br>${esc(r.orderId)}: ${esc(r.error)}`).join("") : esc(x.error || "Erro") }));
        };
      }

      async function buy(extra) {
        $("buy").disabled = true;
        const r = await fetch(`/loja-demo/${seller}/checkout`, { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...params, quantity: Number($("qty").value), ...extra }) });
        const d = await r.json();
        const sc = d.sceneshop;
        if (d.queued) {
          $("result").innerHTML = `<div class="done"><h3>Pedido ${esc(d.orderId)} confirmado</h3>Total: <b>${brl(d.total)}</b> (${brl(d.unitPrice)} por unidade)<br>
            Este varejista informa as vendas ao SceneShop em um relatório diário. O pedido entrou no relatório de hoje.${reportBox(d.pendingReport)}</div>`;
          bindReport();
        } else if (sc && sc.error) {
          $("result").innerHTML = `<div class="done bad"><h3>SceneShop recusou o pedido ${esc(d.orderId)}</h3>${esc(sc.error)}<br>Cobrado: ${brl(d.unitPrice)} por unidade. Um alerta de compliance foi aberto contra a loja.</div>`;
        } else {
          $("result").innerHTML = `<div class="done"><h3>Pedido ${esc(d.orderId)} confirmado</h3>Total: <b>${brl(d.total)}</b> (${brl(d.unitPrice)} por unidade)<br>` +
            (sc ? `SceneShop registrou a venda: comissão de <b>${brl(sc.commission)}</b>${sc.attributedTo ? ", atribuída à trilha que o espectador assistia" : ""}.` : esc(d.note)) +
            (sc ? `<div class="row"><button class="ghost" id="refund">Solicitar devolução</button></div>` : "") + `</div>`;
          const rf = $("refund");
          if (rf) rf.onclick = async () => {
            const x = await (await fetch(`/loja-demo/${seller}/devolucao`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orderId: d.orderId }) })).json();
            rf.replaceWith(Object.assign(document.createElement("div"), { textContent: x.ok ? "Devolução registrada: a comissão foi estornada no SceneShop." : x.error }));
          };
        }
        $("buy").disabled = false;
      }
      $("buy").onclick = () => buy({});
      $("overcharge").onclick = () => buy({ cobrarAcima: true });
    })();
  
