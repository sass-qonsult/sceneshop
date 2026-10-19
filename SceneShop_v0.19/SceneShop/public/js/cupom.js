// Página do cupom SceneShop: copia o código e segue para a loja.
(function () {
  "use strict";
  const btn = document.getElementById("code");
  const copy = () => { try { navigator.clipboard.writeText(btn.dataset.code).then(() => btn.classList.add("copied")).catch(() => {}); } catch (e) {} };
  btn.addEventListener("click", copy);
  copy();
  document.getElementById("go").addEventListener("click", copy);
})();
