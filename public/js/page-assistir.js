// Extraído do HTML: a Content-Security-Policy (script-src 'self') bloqueia scripts embutidos.
    (async function () {
      const workId = decodeURIComponent(location.pathname.split("/").filter(Boolean)[1] || "");
      const fail = (title, msg) => { document.getElementById("err").hidden = false; document.getElementById("errTitle").textContent = title; document.getElementById("errMsg").textContent = msg; };
      const r = await fetch(`/api/works/${encodeURIComponent(workId)}`);
      if (!r.ok) return fail("Obra não encontrada", "Confira o link. A obra precisa ter ao menos uma trilha publicada no estúdio.");
      const work = await r.json();
      document.title = `${work.title} — assistir`;
      const video = document.getElementById("video");
      video.src = work.video;
      if (work.poster) video.poster = work.poster;
      video.addEventListener("error", () => fail("O navegador não conseguiu tocar este vídeo", "Exporte o vídeo em MP4 (H.264 + AAC) e envie de novo pelo estúdio. Arquivos .mov (HEVC) de celular costumam não abrir no Chrome."));
      SceneShop.attach(video, { workId, trackId: new URLSearchParams(location.search).get("track") });
    })();
  
