#!/bin/sh
# SceneShop — Mac e Linux. Dê dois cliques (Mac: renomeie para iniciar.command) ou rode ./iniciar.sh
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1 || ! node -e "process.exit(Number(process.versions.node.split('.')[0])<20?1:0)"; then
  echo "É preciso o Node.js 20 ou mais novo: https://nodejs.org (versão LTS)."; exit 1
fi
# configurações opcionais em sceneshop.env (NOME=valor por linha)
if [ -f sceneshop.env ]; then set -a; . ./sceneshop.env; set +a; echo "Configurações lidas de sceneshop.env"; fi
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
