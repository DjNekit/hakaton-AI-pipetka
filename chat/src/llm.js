// Языковая модель сервиса — GigaChat API (Сбер). Разовые задачи (заключение, описание фото) идут через complete(),
// диалог — через TanStack AI (dialogModel() отдаёт адаптер для chat()).
import { randomUUID } from "node:crypto";
import { openaiCompatible } from "@tanstack/ai-openai/compatible";
import { config } from "./config.js";

export class LlmError extends Error {}

async function readJson(res, what) {
  const text = await res.text();
  if (!res.ok) throw new LlmError(`${what}: HTTP ${res.status}: ${text.slice(0, 300)}`);
  try {
    return JSON.parse(text);
  } catch {
    throw new LlmError(`${what}: ответ не JSON — туннель закрыт или адрес неверный`);
  }
}

/** Ответ модели → объект: снимает ```json-обёртку и мысли <think>, берёт первый {...}. */
export function parseJson(text) {
  let t = String(text || "").replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  t = t.replace(/^```(?:json)?\s*|\s*```$/g, "");
  try {
    return JSON.parse(t);
  } catch {
    const m = t.match(/\{[\s\S]*\}/);
    if (!m) throw new LlmError(`Ответ модели не JSON: ${t.slice(0, 200)}`);
    return JSON.parse(m[0]);
  }
}

// ---------------------------------------------------------------- GigaChat API

export class GigaChat {
  provider = "gigachat";
  #token = null;
  #expires = 0;

  constructor({ key, scope, model, baseUrl, authUrl }) {
    Object.assign(this, { key, scope, model, baseUrl, authUrl });
  }

  async token(force = false) {
    if (!this.key) throw new LlmError("Не задан ключ GigaChat API (GIGACHAT_AUTH_KEY)");
    if (!force && this.#token && this.#expires - Date.now() > 60_000) return this.#token;
    let res;
    try {
      res = await fetch(this.authUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
          RqUID: randomUUID(),
          Authorization: `Basic ${this.key}`,
        },
        body: new URLSearchParams({ scope: this.scope }),
        signal: AbortSignal.timeout(30_000),
      });
    } catch (err) {
      const hint = /certificate/i.test(String(err.cause?.message || err.message)) ? " Нет сертификата НУЦ Минцифры (NODE_EXTRA_CA_CERTS)." : "";
      throw new LlmError(`GigaChat: сервер авторизации недоступен: ${err.cause?.message || err.message}.${hint}`);
    }
    const data = await readJson(res, "GigaChat: токен");
    if (!data.access_token) throw new LlmError("GigaChat: в ответе нет access_token");
    const exp = Number(data.expires_at || 0);
    this.#token = data.access_token;
    this.#expires = exp > 1e11 ? exp : exp ? exp * 1000 : Date.now() + 25 * 60_000; // приходит в мс
    return this.#token;
  }

  async call(path, init = {}, timeout = config.timeoutMs) {
    for (const force of [false, true]) {
      const res = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        headers: { Accept: "application/json", ...(init.headers || {}), Authorization: `Bearer ${await this.token(force)}` },
        signal: AbortSignal.timeout(timeout),
      }).catch((err) => {
        throw new LlmError(`GigaChat недоступен: ${err.cause?.message || err.message}`);
      });
      if (res.status === 401 && !force) continue; // токен истёк раньше срока
      return readJson(res, "GigaChat");
    }
  }

  async status() {
    const base = { provider: "gigachat", url: this.baseUrl };
    if (!this.key) return { ...base, available: false, model: null, error: "Не задан GIGACHAT_AUTH_KEY" };
    try {
      const data = await this.call("/models", {}, 15_000);
      const models = (data.data || []).map((m) => m.id).filter(Boolean);
      const model = !models.length || models.includes(this.model) ? this.model : models[0];
      return { ...base, available: true, model, models };
    } catch (err) {
      return { ...base, available: false, model: null, error: err.message };
    }
  }

  async upload(b64, name) {
    const form = new FormData();
    form.append("purpose", "general");
    form.append("file", new Blob([Buffer.from(b64, "base64")], { type: "image/png" }), name);
    const data = await this.call("/files", { method: "POST", body: form });
    if (!data?.id) throw new LlmError("GigaChat: в ответе на загрузку нет id");
    return data.id;
  }

  async complete({ system, user, images = [], schema = null, maxTokens = 2000, model }) {
    let sys = system;
    if (schema) sys += `\n\nОтвет — только JSON-объект без пояснений и без markdown, строго по JSON-схеме:\n${JSON.stringify(schema)}`;
    const ids = [];
    for (const [i, b64] of images.slice(0, 10).entries()) ids.push(await this.upload(b64, `image${i + 1}.png`));
    const messages = [{ role: "system", content: sys }];
    if (ids.length) {
      // одно изображение на сообщение: задание — с первым, остальные — отдельными сообщениями
      ids.forEach((id, i) => messages.push({ role: "user", content: i === 0 ? user : `Изображение ${i + 1}.`, attachments: [id] }));
      if (ids.length > 1) messages.push({ role: "user", content: "Это все изображения. Выполни задание из первого сообщения." });
    } else {
      messages.push({ role: "user", content: user });
    }
    try {
      const data = await this.call("/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: model || this.model, messages, max_tokens: maxTokens, temperature: 0.01 }), // 0 GigaChat не принимает
      });
      const text = (data.choices?.[0]?.message?.content || "").trim();
      if (!text) throw new LlmError("GigaChat вернул пустой ответ");
      return text;
    } finally {
      for (const id of ids) this.call(`/files/${id}/delete`, { method: "POST" }, 15_000).catch(() => {});
    }
  }

  /** Адаптер TanStack AI для диалога (OpenAI-совместимый чат GigaChat). У GigaChat свой формат вызова функций,
   *  поэтому диалог — без инструментов: данные проверки передаются в системном промпте. */
  async adapter(model) {
    const token = await this.token();
    return openaiCompatible({ name: "gigachat", baseURL: this.baseUrl, apiKey: token, models: [model] })(model);
  }
}

// ---------------------------------------------------------------- модель сервиса

const gigachat = new GigaChat(config.gigachat);

export const llm = {
  /** Доступна ли модель: { available, provider, model, error }. */
  async status() {
    const st = await gigachat.status();
    return { available: st.available, provider: "gigachat", model: st.model, error: st.error ?? null };
  },

  /** Разовая задача → { text, provider, model }. */
  async complete(task) {
    const st = await gigachat.status();
    if (!st.available) throw new LlmError(st.error || "GigaChat недоступен");
    return { text: await gigachat.complete({ ...task, model: st.model }), provider: "gigachat", model: st.model };
  },

  /** Модель для диалога: { adapter, provider, model }. */
  async dialogModel() {
    const st = await gigachat.status();
    if (!st.available) throw new LlmError(st.error || "GigaChat недоступен");
    return { adapter: await gigachat.adapter(st.model), provider: "gigachat", model: st.model };
  },
};
