#!/bin/sh
# SceneShop — Mac e Linux. Dê dois cliques (Mac: renomeie para iniciar.command) ou rode ./iniciar.sh
# Mensagens no idioma do sistema (português, español; outros = English).
cd "$(dirname "$0")"
case "${LC_ALL:-${LC_MESSAGES:-${LANG:-en}}}" in
  pt*) SCENESHOP_LANG=pt ;; es*) SCENESHOP_LANG=es ;; *) SCENESHOP_LANG=en ;;
esac
export SCENESHOP_LANG
case "$SCENESHOP_LANG" in
  pt) M_NODE="É preciso o Node.js 20 ou mais novo: https://nodejs.org (versão LTS)."; M_ENV="Configurações lidas de sceneshop.env" ;;
  es) M_NODE="Se necesita Node.js 20 o más reciente: https://nodejs.org (versión LTS)."; M_ENV="Configuración leída de sceneshop.env" ;;
  *)  M_NODE="Node.js 20 or newer is required: https://nodejs.org (LTS version)."; M_ENV="Settings read from sceneshop.env" ;;
esac
if ! command -v node >/dev/null 2>&1 || ! node -e "process.exit(Number(process.versions.node.split('.')[0])<20?1:0)"; then
  echo "$M_NODE"; exit 1
fi
# configurações opcionais em sceneshop.env (NOME=valor por linha)
if [ -f sceneshop.env ]; then set -a; . ./sceneshop.env; set +a; echo "$M_ENV"; fi
PORT="${PORT:-3000}"; export PORT
[ -d node_modules/express ] || npm install --omit=dev --no-audit --no-fund
(
  i=0; while [ $i -lt 60 ]; do
    if curl -sf "http://localhost:$PORT/api/health" >/dev/null 2>&1; then
      open "http://localhost:$PORT/studio.html" 2>/dev/null || xdg-open "http://localhost:$PORT/studio.html" 2>/dev/null; break
    fi; i=$((i+1)); sleep 0.5
  done
) &
exec node server/index.js
