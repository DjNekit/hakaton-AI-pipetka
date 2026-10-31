// Сервис чата по отчёту проверки (TanStack AI).
//   POST /chat/checks/:id   — поток ответа модели (AG-UI поверх SSE) для useChat на фронтенде
//   GET  /chat/health       — доступна ли модель
// Данные проверки — из основного бэкенда (BACKEND_URL), модель — LM Studio или любой OpenAI-совместимый сервер.
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { chat, chatParamsFromRequest, maxIterations, toServerSentEventsResponse } from "@tanstack/ai";
import { openaiCompatible } from "@tanstack/ai-openai/compatible";
import { config, llmHeaders, llmStatus } from "./config.js";
import { BackendError } from "./backend.js";
import { clientToolDefs, makeCheckLoader, serverTools } from "./tools.js";
import { systemPrompt } from "./prompt.js";

const providers = new Map();
function adapterFor(model) {
  if (!providers.has(model)) {
    providers.set(
      model,
      openaiCompatible({
        name: "lmstudio",
        baseURL: config.llmUrl,
        apiKey: config.llmKey,
        models: [model],
        defaultHeaders: llmHeaders,
      }),
    );
  }
  return providers.get(model)(model);
}

const app = new Hono();

app.get("/chat/health", async (c) => {
  const llm = await llmStatus();
  return c.json({ ok: true, llm: { available: llm.ok, model: llm.model, error: llm.error ?? null, url: config.llmUrl || null } });
});

app.post("/chat/checks/:id", async (c) => {
  const checkId = c.req.param("id");
  if (!/^[0-9a-f]{12}$/.test(checkId)) return c.json({ error: "Неверный id проверки" }, 400);

  const llm = await llmStatus();
  if (!llm.ok) return c.json({ error: llm.error }, 503);

  const loadCheck = makeCheckLoader(checkId);
  let run;
  try {
    run = await loadCheck();
  } catch (err) {
    const status = err instanceof BackendError && err.status === 404 ? 404 : 409;
    return c.json({ error: err.message }, status);
  }

  const { messages, threadId, runId, forwardedProps } = await chatParamsFromRequest(c.req.raw);
  const abortController = new AbortController();
  c.req.raw.signal?.addEventListener("abort", () => abortController.abort());

  const stream = chat({
    adapter: adapterFor(llm.model),
    messages,
    threadId,
    runId,
    systemPrompts: [systemPrompt(run, forwardedProps?.ui)],
    tools: [...serverTools(loadCheck, checkId), ...clientToolDefs],
    agentLoopStrategy: maxIterations(config.maxSteps),
    modelOptions: { temperature: 0.2 },
    abortController,
  });
  return toServerSentEventsResponse(stream);
});

app.onError((err, c) => {
  console.error("chat:", err);
  return c.json({ error: err.message }, 500);
});

serve({ fetch: app.fetch, port: config.port }, () => {
  console.log(`chat: http://0.0.0.0:${config.port}, бэкенд ${config.backendUrl}, модель ${config.llmUrl || "не задана"} ${config.llmModel}`);
});
