import { useEffect, useMemo, useRef, useState } from "react";
import { fetchServerSentEvents, useChat } from "@tanstack/ai-react";
import { TOOL_LABELS, makeClientTools } from "../chat/tools.js";

const CHAT_BASE = "/chat";

/**
 * Чат по отчёту: сервис chat/ (TanStack AI) отвечает, сам берёт данные проверки из основного бэкенда,
 * а показать замечание, лист или вкладку просит браузер — через клиентские инструменты.
 * handlers: { showFinding(id), showPage(index), openTab(tab) }, ui: { tab, selected, page } — что сейчас на экране.
 */
export default function ChatPanel({ run, handlers, ui, onClose }) {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;
  const uiRef = useRef(ui);
  uiRef.current = ui;

  const tools = useMemo(() => makeClientTools(handlersRef), []);
  const connection = useMemo(
    () => fetchServerSentEvents(`${CHAT_BASE}/checks/${run.id}`, () => ({ body: { ui: uiRef.current } })),
    [run.id],
  );
  const { messages, sendMessage, isLoading, stop, error } = useChat({ connection, tools, threadId: `check-${run.id}` });

  const [input, setInput] = useState("");
  const [health, setHealth] = useState(null);
  const listRef = useRef(null);

  useEffect(() => {
    let alive = true;
    fetch(`${CHAT_BASE}/health`)
      .then((r) => r.json())
      .then((h) => alive && setHealth(h.llm))
      .catch(() => alive && setHealth({ available: false, error: "Сервис чата не отвечает" }));
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages, isLoading]);

  const send = (text) => {
    const t = text.trim();
    if (!t || isLoading) return;
    sendMessage(t);
    setInput("");
  };

  const suggestions = [
    "Почему документ не соответствует требованиям?",
    "Что заявителю нужно исправить?",
    ui.selected ? `Объясни замечание ${ui.selected}` : "Какие нарушения самые серьёзные?",
  ];

  return (
    <aside className="chat" aria-label="Чат по отчёту">
      <header className="chat-head">
        <div>
          <strong>Вопрос по отчёту</strong>
          <span className={`chat-status ${health?.available ? "is-on" : "is-off"}`}>
            {health == null ? "проверяю модель…" : health.available ? health.model : health.error || "модель недоступна"}
          </span>
        </div>
        <button type="button" className="chat-close" onClick={onClose} aria-label="Закрыть чат">
          ×
        </button>
      </header>

      <div className="chat-list" ref={listRef}>
        {messages.length === 0 && (
          <div className="chat-empty">
            <p>Спросите про замечания, требования или таблицу отделки — ответ строится по данным этой проверки.</p>
            {suggestions.map((s) => (
              <button key={s} type="button" className="chat-suggest" onClick={() => send(s)} disabled={isLoading}>
                {s}
              </button>
            ))}
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`chat-msg chat-${m.role}`}>
            {m.parts.map((part, i) => (
              <Part key={i} part={part} onFinding={(id) => handlersRef.current.showFinding(id)} />
            ))}
          </div>
        ))}
        {isLoading && <div className="chat-typing">Модель думает…</div>}
        {error && <div className="chat-error">Ошибка: {error.message || String(error)}</div>}
      </div>

      <form
        className="chat-form"
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
      >
        <textarea
          value={input}
          rows={2}
          placeholder="Например: почему TAB-02 — ошибка?"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send(input);
            }
          }}
        />
        {isLoading ? (
          <button type="button" className="btn" onClick={stop}>
            Стоп
          </button>
        ) : (
          <button type="submit" className="btn btn-primary" disabled={!input.trim()}>
            Спросить
          </button>
        )}
      </form>
    </aside>
  );
}

function Part({ part, onFinding }) {
  if (part.type === "text") return <Text content={part.content} onFinding={onFinding} />;
  if (part.type === "tool-call") {
    return <div className="chat-tool">{TOOL_LABELS[part.name] || part.name}</div>;
  }
  return null;
}

// Текст ответа: абзацы и списки как есть, **жирный** — жирным, id замечаний (F001) — ссылки на замечание.
function Text({ content, onFinding }) {
  const pieces = String(content || "").split(/(\*\*[^*]+\*\*|\bF\d{3}\b)/g);
  return (
    <p className="chat-text">
      {pieces.map((p, i) => {
        if (/^\*\*[^*]+\*\*$/.test(p)) return <strong key={i}>{p.slice(2, -2)}</strong>;
        if (/^F\d{3}$/.test(p)) {
          return (
            <button key={i} type="button" className="chat-ref" onClick={() => onFinding(p)}>
              {p}
            </button>
          );
        }
        return p;
      })}
    </p>
  );
}
