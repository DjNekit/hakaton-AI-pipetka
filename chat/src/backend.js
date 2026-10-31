// Обращения к основному бэкенду (Django API). Чат ничего не считает сам: все данные — отсюда.
import { config } from "./config.js";

export class BackendError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

async function get(path) {
  const res = await fetch(`${config.backendUrl}/api${path}`, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new BackendError(`Бэкенд: HTTP ${res.status} на ${path} ${text.slice(0, 200)}`, res.status);
  }
  return res.json();
}

export const backend = {
  check: (id) => get(`/checks/${encodeURIComponent(id)}`),
  comparisons: (id) => get(`/checks/${encodeURIComponent(id)}/comparisons`),
  rules: () => get("/rules"),
};

// Справочник правил меняется только с кодом — кэшируем на время жизни процесса.
let rulesCache = null;
export async function rulesIndex() {
  if (!rulesCache) {
    const data = await backend.rules();
    rulesCache = Object.fromEntries(data.rules.map((r) => [r.id, r]));
  }
  return rulesCache;
}
