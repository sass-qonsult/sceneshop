FROM node:22-bookworm-slim

ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
# Production images must consume the exact committed dependency graph.
# Any lock drift or missing package entry is a build failure by design.
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund

COPY . .
# O servidor grava vídeos/imagens enviados e resultados de IA em data/: precisa ser do usuário node.
RUN mkdir -p data/uploads/videos data/uploads/images data/ai && chown -R node:node data
USER node
EXPOSE 3000
CMD ["node", "server/index.js"]
