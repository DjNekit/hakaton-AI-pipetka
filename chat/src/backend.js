// Обращения к основному бэкенду (Django API): чат берёт отсюда данные и сюда сохраняет ответы модели;
// файлы документов — у сервиса processor (FILES_URL).
import { config } from "./config.js";

export class BackendError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

async function call(path, init = {}) {
  const res = await fetch(`${config.backendUrl}/api${path}`, { ...init, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    let detail = text.slice(0, 300);
    try {
      detail = JSON.parse(text).detail || detail;
    } catch {}
    throw new BackendError(`Бэкенд: HTTP ${res.status} на ${path}: ${detail}`, res.status);
  }
  return res;
}

const get = async (path) => (await call(path)).json();
const post = async (path, body) =>
  (await call(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })).json();
const id = encodeURIComponent;

export const backend = {
  check: (checkId) => get(`/checks/${id(checkId)}`),
  comparisons: (checkId) => get(`/checks/${id(checkId)}/comparisons`),
  /** Файл документа (картинка листа, сравнения) — у сервиса processor, в base64 для модели. */
  fileBase64: async (checkId, rel) => {
    const res = await fetch(`${config.filesUrl}/${id(checkId)}/${rel}`, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new BackendError(`Файлы: HTTP ${res.status} на ${rel}`, res.status);
    return Buffer.from(await res.arrayBuffer()).toString("base64");
  },
  saveConclusion: (checkId, body) => post(`/checks/${id(checkId)}/conclusion`, body),
  saveReview: (checkId, cid, body) => post(`/checks/${id(checkId)}/comparisons/${id(cid)}/review`, body),
};
