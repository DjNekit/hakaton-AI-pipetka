# Чат по отчёту (TanStack AI): Node без сборки, исходники — обычный JS (ESM).
FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY src ./src
ENV PORT=3000
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --retries=5 CMD wget -qO- http://127.0.0.1:3000/chat/health >/dev/null || exit 1
CMD ["node", "src/server.js"]
