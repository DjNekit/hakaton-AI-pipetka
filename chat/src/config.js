// Настройки сервиса chat — единственного места, где работает языковая модель (GigaChat API).
//
//   BACKEND_URL=http://backend:8000          основной бэкенд (Django): данные проверок, сюда же сохраняются ответы модели
//   FILES_URL=http://checker:8001/files    файлы документов (листы, развёртки, карты отличий) — сервис checker
//
//   Языковая модель — GigaChat API (Сбер):
//   GIGACHAT_AUTH_KEY=                       ключ авторизации (Base64 от «Client ID:Client Secret»)
//   GIGACHAT_SCOPE=GIGACHAT_API_PERS
//   GIGACHAT_MODEL=GigaChat-2-Max            Max и Pro понимают изображения
//
//   LLM_TIMEOUT=300                          секунд на ответ модели

const env = (name, fallback = "") => (process.env[name] ?? "").trim() || fallback;

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
  filesUrl: env("FILES_URL", "http://checker:8001/files").replace(/\/+$/, ""),
  timeoutMs: Number(env("LLM_TIMEOUT", "300")) * 1000,
  gigachat: {
    key: gigachatKey(),
    scope: env("GIGACHAT_SCOPE", "GIGACHAT_API_PERS"),
    model: env("GIGACHAT_MODEL", "GigaChat-2-Max"),
    baseUrl: env("GIGACHAT_BASE_URL", "https://gigachat.devices.sberbank.ru/api/v1").replace(/\/+$/, ""),
    authUrl: env("GIGACHAT_AUTH_URL", "https://ngw.devices.sberbank.ru:9443/api/v2/oauth"),
  },
};
