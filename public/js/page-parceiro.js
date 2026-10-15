// Extraído do HTML: a Content-Security-Policy (script-src 'self') bloqueia scripts embutidos.
    // Integração do parceiro: chave pública + obra. O domínio precisa estar autorizado.
    SceneShop.attach(document.getElementById("video"), { workId: "demo-01", partnerKey: "pk_aurora_demo" })
      .catch((e) => (document.getElementById("err").textContent = "SceneShop: " + e.message));
  
