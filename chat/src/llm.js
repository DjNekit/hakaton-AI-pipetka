// Языковые модели: LM Studio (основная, OpenAI-совместимый API) и GigaChat API (запасная).
// Router выбирает доступную модель; разовые задачи (заключение, описание фото) идут через complete(),
// диалог — через TanStack AI (dialogModel() отдаёт адаптер для chat()).
import { randomUUID } from "node:crypto";
import { openaiCompatible } from "@tanstack/ai-openai/compatible";
import { config } from "./config.js";

export class LlmError extends Error {}

const NGROK_HEADERS = { "ngrok-skip-browser-warning": "1" }; // бесплатный ngrok иначе может отдать HTML-предупреждение

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

// ---------------------------------------------------------------- LM Studio

export class LocalLlm {
  provider = "local";

  constructor({ url, model, key }) {
    this.url = url;
    this.model = model || null;
    this.key = key || "lm-studio";
  }

  headers() {
    return { "Content-Type": "application/json", Authorization: `Bearer ${this.key}`, ...NGROK_HEADERS };
  }

  async status() {
    const base = { provider: "local", url: this.url || null };
    if (!this.url) return { ...base, available: false, model: null, error: "Не задан LOCAL_LLM_URL" };
    try {
      const res = await fetch(`${this.url}/models`, { headers: this.headers(), signal: AbortSignal.timeout(5000) });
      const data = await readJson(res, "LM Studio");
      const models = (data.data || []).map((m) => m.id).filter((id) => id && !/embed/i.test(id));
      const model = this.model || models[0] || null;
      if (!model) return { ...base, available: false, model: null, error: "В LM Studio нет загруженной модели" };
      return { ...base, available: true, model, models };
    } catch (err) {
      return { ...base, available: false, model: null, error: `LM Studio недоступна (${this.url}): ${err.message}` };
    }
  }

  async complete({ system, user, images = [], schema = null, maxTokens = 2000, model }) {
    const content = images.length
      ? [{ type: "text", text: user }, ...images.map((b64) => ({ type: "image_url", image_url: { url: `data:image/png;base64,${b64}` } }))]
      : user;
    const payload = {
      model: model || this.model,
      messages: [
        { role: "system", content: system },
        { role: "user", content },
      ],
      temperature: 0,
      max_tokens: maxTokens,
    };
    if (schema) payload.response_format = { type: "json_schema", json_schema: { name: "result", strict: true, schema } };
    const post = (body) =>
      fetch(`${this.url}/chat/completions`, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(config.timeoutMs),
      });
    let res = await post(payload);
    if (res.status === 400 && payload.response_format) {
      delete payload.response_format; // сервер не понимает structured output — схема остаётся в промпте
      payload.messages[0].content += `\n\nОтвет — только JSON-объект по схеме:\n${JSON.stringify(schema)}`;
      res = await post(payload);
    }
    const data = await readJson(res, "LM Studio");
    const text = (data.choices?.[0]?.message?.content || "").replace(/<think>[\s\S]*?<\/think>/g, "").trim();
    if (!text) throw new LlmError("LM Studio вернула пустой ответ");
    return text;
  }

  /** Адаптер TanStack AI для диалога. */
  adapter(model) {
    return openaiCompatible({ name: "lmstudio", baseURL: this.url, apiKey: this.key, models: [model], defaultHeaders: NGROK_HEADERS })(model);
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

  /** Адаптер TanStack AI для диалога: у GigaChat свой формат вызова функций, поэтому диалог — без инструментов. */
  async adapter(model) {
    const token = await this.token();
    return openaiCompatible({ name: "gigachat", baseURL: this.baseUrl, apiKey: token, models: [model] })(model);
  }
}

// ---------------------------------------------------------------- выбор модели

export class Router {
  constructor() {
    this.local = new LocalLlm(config.local);
    this.gigachat = new GigaChat(config.gigachat);
  }

  /** Активная модель и состояние обеих: сначала LM Studio, иначе GigaChat. */
  async status() {
    const local = await this.local.status();
    const giga = local.available ? null : await this.gigachat.status();
    const active = local.available ? local : giga;
    const brief = (s) => s && { available: s.available, model: s.model, error: s.error ?? null, url: s.url };
    return {
      available: active.available,
      provider: active.available ? active.provider : null,
      model: active.available ? active.model : null,
      error: active.available ? null : [local.error, giga?.error].filter(Boolean).join("; "),
      local: brief(local),
      gigachat: brief(giga),
    };
  }

  /** Разовая задача: LM Studio, при сбое — GigaChat. Возвращает { text, provider, model }. */
  async complete(task) {
    const errors = [];
    const local = await this.local.status();
    if (local.available) {
      try {
        return { text: await this.local.complete({ ...task, model: local.model }), provider: "local", model: local.model };
      } catch (err) {
        errors.push(err.message);
        console.warn("chat: LM Studio не ответила, пробую GigaChat:", err.message);
      }
    } else errors.push(local.error);
    const giga = await this.gigachat.status();
    if (!giga.available) throw new LlmError([...errors, giga.error].filter(Boolean).join("; "));
    return { text: await this.gigachat.complete({ ...task, model: giga.model }), provider: "gigachat", model: giga.model };
  }

  /** Модель для диалога: { adapter, provider, model, tools } — у GigaChat инструментов нет. */
  async dialogModel() {
    const local = await this.local.status();
    if (local.available) return { adapter: this.local.adapter(local.model), provider: "local", model: local.model, tools: true };
    const giga = await this.gigachat.status();
    if (giga.available) return { adapter: await this.gigachat.adapter(giga.model), provider: "gigachat", model: giga.model, tools: false };
    throw new LlmError([local.error, giga.error].filter(Boolean).join("; "));
  }
}

export const router = new Router();
