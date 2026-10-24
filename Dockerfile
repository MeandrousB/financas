# Minhas finanças — servidor (Hono + SQLite nativo do Node) + PWA
# Testado com Node 24.21. A tag de linha (24-slim) recebe correções de segurança a cada rebuild.
FROM node:24-slim

ENV NODE_ENV=production \
    DATA_DIR=/data \
    PORT=3000

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY server ./server
COPY public ./public

# /data precisa de armazenamento persistente (Coolify: Persistent Storage; Dokploy: Volumes/Mounts).
RUN mkdir -p /data && chown node:node /data
USER node

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"

CMD ["node", "--disable-warning=ExperimentalWarning", "server/index.js"]
