// Настройки сервиса чата: модель (LM Studio или любой OpenAI-совместимый сервер) и адрес основного бэкенда.
//
//   BACKEND_URL=http://backend:8000          основной бэкенд (Django) — источник данных
//   CHAT_LLM_URL=                            адрес модели; пусто — как у бэкенда (LOCAL_LLM_URL)
//   CHAT_LLM_MODEL=                          модель; пусто — LOCAL_LLM_MODEL, иначе первая чат-модель из /models
//   CHAT_LLM_KEY=                            токен LM Studio; пусто — LOCAL_LLM_KEY
//   CHAT_MAX_STEPS=8                         сколько раз модель может вызвать инструменты за один ответ

const env = (name, fallback = "") => (process.env[name] ?? "").trim() || fallback;

/** Прощает типичные ошибки в адресе модели — как normalize_local_url в backend/colorpass/llm.py. */
export function normalizeLlmUrl(raw) {
  let url = String(raw || "").trim().replace(/^['"]|['"]$/g, "");
  while (/^LOCAL_LLM_URL=|^CHAT_LLM_URL=/i.test(url)) url = url.split("=").slice(1).join("=").trim().replace(/^['"]|['"]$/g, "");
  if (!url) return "";
  if (!url.includes("://")) url = (/^(localhost|127\.|host\.docker\.internal)/.test(url) ? "http://" : "https://") + url;
  url = url.replace(/\/+$/, "");
  if (!url.endsWith("/v1")) url += "/v1";
  return url;
}

export const config = {
  port: Number(env("PORT", "3000")),
  backendUrl: env("BACKEND_URL", "http://backend:8000").replace(/\/+$/, ""),
  llmUrl: normalizeLlmUrl(env("CHAT_LLM_URL", env("LOCAL_LLM_URL"))),
  llmModel: env("CHAT_LLM_MODEL", env("LOCAL_LLM_MODEL")),
  llmKey: env("CHAT_LLM_KEY", env("LOCAL_LLM_KEY", "lm-studio")),
  maxSteps: Number(env("CHAT_MAX_STEPS", "8")),
};

// бесплатный ngrok без этого заголовка может отдать страницу-предупреждение вместо JSON
export const llmHeaders = { "ngrok-skip-browser-warning": "1" };

/** Доступна ли модель и как она называется: { ok, model, models, error }. */
export async function llmStatus() {
  if (!config.llmUrl) return { ok: false, model: null, error: "Не задан адрес модели (CHAT_LLM_URL или LOCAL_LLM_URL)" };
  try {
    const res = await fetch(`${config.llmUrl}/models`, {
      headers: { Authorization: `Bearer ${config.llmKey}`, ...llmHeaders },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return { ok: false, model: null, error: `Модель ответила HTTP ${res.status}` };
    const data = await res.json();
    const models = (data.data || []).map((m) => m.id).filter((id) => id && !/embed/i.test(id));
    const model = config.llmModel || models[0] || null;
    if (!model) return { ok: false, model: null, models, error: "В LM Studio нет загруженной модели" };
    return { ok: true, model, models };
  } catch (err) {
    return { ok: false, model: null, error: `Модель недоступна (${config.llmUrl}): ${err.message}` };
  }
}
