// Extraído do HTML: a Content-Security-Policy (script-src 'self') bloqueia scripts embutidos.
    // ?track=ID abre uma trilha específica; sem isso, vale a melhor do ranking
    SceneShop.attach(document.getElementById("video"), {
      workId: "demo-01",
      trackId: new URLSearchParams(location.search).get("track"),
    });
  
