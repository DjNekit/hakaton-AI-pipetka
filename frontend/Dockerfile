# Прод: собранный интерфейс отдаёт Caddy — он же получает сертификат Let's Encrypt и проксирует /api на backend.
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM caddy:2.8-alpine
COPY --from=build /app/dist /srv
COPY Caddyfile /etc/caddy/Caddyfile
