// Настройки сервиса chat — единственного места, где работают языковые модели.
//
//   BACKEND_URL=http://backend:8000          основной бэкенд (Django): данные проверок, сюда же сохраняются ответы модели
//   FILES_URL=http://processor:8001/files    файлы документов (листы, развёртки, карты отличий) — сервис processor
//
//   Основная модель — LM Studio (или любой OpenAI-совместимый сервер), в проде — через ngrok:
//   LOCAL_LLM_URL=https://<домен>.ngrok-free.dev/v1
//   LOCAL_LLM_MODEL=                         пусто — первая чат-модель из /models
//   LOCAL_LLM_KEY=                           токен LM Studio, если включена авторизация
//
//   Запасная — GigaChat API (Сбер), если LM Studio недоступна:
//   GIGACHAT_AUTH_KEY=                       ключ авторизации (Base64 от «Client ID:Client Secret»)
//   GIGACHAT_SCOPE=GIGACHAT_API_PERS
//   GIGACHAT_MODEL=GigaChat-2-Max            Max и Pro понимают изображения
//
//   LLM_TIMEOUT=300                          секунд на ответ модели
//   CHAT_MAX_STEPS=8                         сколько раз модель может вызвать инструменты за один ответ в чате

const env = (name, fallback = "") => (process.env[name] ?? "").trim() || fallback;

/** Прощает типичные ошибки в адресе модели: «LOCAL_LLM_URL=…» в значении, нет схемы, нет /v1, кавычки. */
export function normalizeLlmUrl(raw) {
  let url = String(raw || "").trim().replace(/^['"]|['"]$/g, "");
  while (/^[A-Z_]+_URL=/i.test(url)) url = url.split("=").slice(1).join("=").trim().replace(/^['"]|['"]$/g, "");
  if (!url) return "";
  if (!url.includes("://")) url = (/^(localhost|127\.|host\.docker\.internal)/.test(url) ? "http://" : "https://") + url;
  url = url.replace(/\/+$/, "");
  if (!url.endsWith("/v1")) url += "/v1";
  return url;
}

function gigachatKey() {
  const key = env("GIGACHAT_AUTH_KEY");
  if (key) return key;
  const id = env("GIGACHAT_CLIENT_ID");
  const secret = env("GIGACHAT_CLIENT_SECRET");
  return id && secret ? Buffer.from(`${id}:${secret}`).toString("base64") : "";
}

export const config = {
  port: Number(env("PORT", "3000")),
  backendUrl: env("BACKEND_URL", "http://backend:8000").replace(/\/+$/, ""),
  filesUrl: env("FILES_URL", "http://processor:8001/files").replace(/\/+$/, ""),
  timeoutMs: Number(env("LLM_TIMEOUT", "300")) * 1000,
  maxSteps: Number(env("CHAT_MAX_STEPS", "8")),
  local: {
    url: normalizeLlmUrl(env("LOCAL_LLM_URL")),
    model: env("LOCAL_LLM_MODEL"),
    key: env("LOCAL_LLM_KEY", "lm-studio"),
  },
  gigachat: {
    key: gigachatKey(),
    scope: env("GIGACHAT_SCOPE", "GIGACHAT_API_PERS"),
    model: env("GIGACHAT_MODEL", "GigaChat-2-Max"),
    baseUrl: env("GIGACHAT_BASE_URL", "https://gigachat.devices.sberbank.ru/api/v1").replace(/\/+$/, ""),
    authUrl: env("GIGACHAT_AUTH_URL", "https://ngw.devices.sberbank.ru:9443/api/v2/oauth"),
  },
};
