# Новый интерфейс (/new): сборка SPA и раздача статики. Серверная часть — сервис applications-api.
FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --no-frozen-lockfile
COPY . .
RUN pnpm build

FROM caddy:2.8-alpine
COPY --from=build /app/dist /srv/new
COPY Caddyfile /etc/caddy/Caddyfile
