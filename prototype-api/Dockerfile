# Серверная логика нового интерфейса (/new): better-auth, заявки (SQLite), проверка, ассистент.
# glibc-образ: для better-sqlite3 есть готовые сборки, компилятор не нужен.
FROM node:22-bookworm-slim
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY src ./src
COPY migrations ./migrations
ENV NODE_ENV=production PORT=3100 AUTH_DB_PATH=/data/auth.db UPLOADS_DIR=/data/uploads
VOLUME /data
EXPOSE 3100
HEALTHCHECK --interval=15s --timeout=5s --retries=5 CMD node -e "fetch('http://127.0.0.1:3100/new/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["npx", "tsx", "src/index.ts"]
