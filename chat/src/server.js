// Сервис chat — единственное место, где работают языковые модели (бэкенд к ним не обращается).
//   POST /chat/checks/:id                              диалог по отчёту: поток AG-UI (SSE) для useChat на фронтенде
//   POST /chat/checks/:id/conclusion                   заключение моделью → сохраняется в бэкенд, ответ — проверка
//   POST /chat/checks/:id/comparisons/:cid/review      описание отличий на фото → сохраняется в бэкенд, ответ — сравнение
//   GET  /chat/health                                  какая модель отвечает: LM Studio или запасной GigaChat
// Данные проверок — из основного бэкенда (BACKEND_URL).
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { chat, chatParamsFromRequest, maxIterations, toServerSentEventsResponse } from "@tanstack/ai";
import { config } from "./config.js";
import { BackendError } from "./backend.js";
import { router } from "./llm.js";
import { reviewPhoto, writeConclusion } from "./tasks.js";
import { clientToolDefs, makeCheckLoader, serverTools } from "./tools.js";
import { systemPrompt } from "./prompt.js";

const ID = /^[0-9a-f]{12}$/;
const app = new Hono();

app.get("/chat/health", async (c) => c.json({ ok: true, llm: await router.status() }));

app.post("/chat/checks/:id", async (c) => {
  const checkId = c.req.param("id");
  if (!ID.test(checkId)) return c.json({ error: "Неверный id проверки" }, 400);

  const loadCheck = makeCheckLoader(checkId);
  const run = await loadCheck();
  const llm = await router.dialogModel();

  const { messages, threadId, runId, forwardedProps } = await chatParamsFromRequest(c.req.raw);
  const abortController = new AbortController();
  c.req.raw.signal?.addEventListener("abort", () => abortController.abort());

  const stream = chat({
    adapter: llm.adapter,
    messages,
    threadId,
    runId,
    systemPrompts: [systemPrompt(run, forwardedProps?.ui, llm.tools)],
    ...(llm.tools ? { tools: [...serverTools(loadCheck, checkId), ...clientToolDefs], agentLoopStrategy: maxIterations(config.maxSteps) } : {}),
    modelOptions: { temperature: 0.2 },
    metadata: { provider: llm.provider, model: llm.model, checkId },
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
    `chat: :${config.port}; бэкенд ${config.backendUrl}; LM Studio ${config.local.url || "не задана"} ${config.local.model}; ` +
      `GigaChat ${config.gigachat.key ? config.gigachat.model : "без ключа"}`,
  );
});
