# Сервис chat (TanStack AI): все обращения к языковой модели — GigaChat API.
FROM node:22-alpine
WORKDIR /app
# Сертификаты НУЦ Минцифры — без них Node не примет TLS-сертификат GigaChat API. Если gu-st.ru недоступен
# при сборке, образ всё равно собирается (GigaChat тогда не подключится, проверка по правилам работает).
RUN mkdir -p /app/certs && node -e "\
  const names = ['russian_trusted_root_ca_pem', 'russian_trusted_sub_ca_pem'];\
  Promise.all(names.map((n) => fetch('https://gu-st.ru/content/lending/' + n + '.crt', { signal: AbortSignal.timeout(30000) }).then((r) => r.text())))\
    .then((pems) => require('fs').writeFileSync('/app/certs/russian.pem', pems.join('\n')))\
    .catch((e) => { console.log('Сертификаты НУЦ Минцифры не загружены:', e.message); require('fs').writeFileSync('/app/certs/russian.pem', ''); });"
ENV NODE_EXTRA_CA_CERTS=/app/certs/russian.pem
COPY package*.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY src ./src
ENV PORT=3000
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --retries=5 CMD wget -qO- http://127.0.0.1:3000/chat/health >/dev/null || exit 1
CMD ["node", "src/server.js"]
