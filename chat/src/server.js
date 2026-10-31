// Сервис chat — единственное место, где работает языковая модель — GigaChat API (бэкенд к ней не обращается).
//   POST /chat/checks/:id                              диалог по отчёту: поток AG-UI (SSE) для useChat на фронтенде
//   POST /chat/checks/:id/conclusion                   заключение моделью → сохраняется в бэкенд, ответ — проверка
//   POST /chat/checks/:id/comparisons/:cid/review      описание отличий на фото → сохраняется в бэкенд, ответ — сравнение
//   POST /chat/assistant                               ассистент заявителя в новом интерфейсе (/new) — вызывает applications-api
//   GET  /chat/health                                  доступен ли GigaChat
// Данные проверок — из основного бэкенда (BACKEND_URL).
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { chat, chatParamsFromRequest, toServerSentEventsResponse } from "@tanstack/ai";
import { config } from "./config.js";
import { BackendError, backend } from "./backend.js";
import { llm } from "./llm.js";
import { reviewPhoto, writeConclusion } from "./tasks.js";
import { systemPrompt } from "./prompt.js";

const ID = /^[0-9a-f]{12}$/;
const app = new Hono();

app.get("/chat/health", async (c) => c.json({ ok: true, llm: await llm.status() }));

app.post("/chat/checks/:id", async (c) => {
  const checkId = c.req.param("id");
  if (!ID.test(checkId)) return c.json({ error: "Неверный id проверки" }, 400);

  const run = await backend.check(checkId);
  if (run.state !== "done" || !run.report) return c.json({ error: "Проверка документа ещё не завершена" }, 409);
  const model = await llm.dialogModel();

  const { messages, threadId, runId, forwardedProps } = await chatParamsFromRequest(c.req.raw);
  const abortController = new AbortController();
  c.req.raw.signal?.addEventListener("abort", () => abortController.abort());

  const stream = chat({
    adapter: model.adapter,
    messages,
    threadId,
    runId,
    systemPrompts: [systemPrompt(run, forwardedProps?.ui)],
    modelOptions: { temperature: 0.2 },
    metadata: { provider: model.provider, model: model.model, checkId },
    abortController,
  });
  return toServerSentEventsResponse(stream);
});

const ASSISTANT_PROMPT = [
  "Ты — ассистент заявителя в сервисе «Колорпаспорт» (Москомархитектура). Заявитель готовит и подаёт документы:",
  "паспорт колористического решения фасадов (ПП Москвы № 114-ПП), дизайн-проект размещения вывесок (№ 902-ПП),",
  "проект изменения внешнего облика фасада. Помогай понять требования, состав документов и типичные ошибки.",
  "Отвечай по-русски, коротко и по делу. Не выдумывай номера пунктов НПА; если не уверен — так и скажи.",
].join("\n");

app.post("/chat/assistant", async (c) => {
  const model = await llm.dialogModel();
  const { messages, threadId, runId } = await chatParamsFromRequest(c.req.raw);
  const abortController = new AbortController();
  c.req.raw.signal?.addEventListener("abort", () => abortController.abort());
  const stream = chat({
    adapter: model.adapter,
    messages,
    threadId,
    runId,
    systemPrompts: [ASSISTANT_PROMPT],
    modelOptions: { temperature: 0.3 },
    metadata: { provider: model.provider, model: model.model, assistant: true },
    abortController,
  });
  return toServerSentEventsResponse(stream);
});

app.post("/chat/checks/:id/conclusion", async (c) => {
  const checkId = c.req.param("id");
  if (!ID.test(checkId)) return c.json({ error: "Неверный id проверки" }, 400);
  return c.json(await writeConclusion(checkId));
});

app.post("/chat/checks/:id/comparisons/:cid/review", async (c) => {
  const { id, cid } = c.req.param();
  if (!ID.test(id) || !ID.test(cid)) return c.json({ error: "Неверный id" }, 400);
  return c.json(await reviewPhoto(id, cid));
});

app.onError((err, c) => {
  const status = err instanceof BackendError ? (err.status === 404 ? 404 : 502) : err.status === 404 ? 404 : 503;
  if (status >= 500) console.error("chat:", err.message);
  return c.json({ error: err.message }, status);
});

serve({ fetch: app.fetch, port: config.port }, () => {
  console.log(
    `chat: :${config.port}; бэкенд ${config.backendUrl}; GigaChat ${config.gigachat.key ? config.gigachat.model : "без ключа"}`,
  );
});
