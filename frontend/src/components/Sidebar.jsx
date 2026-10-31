import { useRef, useState } from "react";
import { formatTime, runStatus } from "../format.js";

export default function Sidebar({ runs, currentId, onUpload, onOpen }) {
  const inputRef = useRef(null);
  const [drag, setDrag] = useState(false);

  const pick = (files) => {
    const f = files && files[0];
    if (f) onUpload(f);
  };

  const active = runs.filter((r) => !r.archived_at);
  const archived = runs.filter((r) => r.archived_at);

  return (
    <aside className="sidebar" aria-label="Проверки">
      <section className="side-block">
        <h2 className="side-title">Новая проверка</h2>
        <div
          className={`dropzone${drag ? " is-drag" : ""}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDrag(false);
            pick(e.dataTransfer.files);
          }}
        >
          <p>Перетащите сюда PDF паспорта или дизайн-проекта вывесок</p>
          <button type="button" className="btn btn-primary" onClick={() => inputRef.current && inputRef.current.click()}>
            Выбрать файл
          </button>
          <input
            ref={inputRef}
            type="file"
            accept="application/pdf,.pdf"
            hidden
            onChange={(e) => {
              pick(e.target.files);
              e.target.value = "";
            }}
          />
        </div>
      </section>

      {active.length > 0 && (
        <section className="side-block">
          <h2 className="side-title">Журнал проверок</h2>
          <RunList runs={active} currentId={currentId} onOpen={onOpen} />
        </section>
      )}

      {archived.length > 0 && (
        <section className="side-block">
          <h2 className="side-title">Архив</h2>
          <RunList runs={archived} currentId={currentId} onOpen={onOpen} />
        </section>
      )}
    </aside>
  );
}

function RunList({ runs, currentId, onOpen }) {
  return (
    <ul className="run-list">
      {runs.slice(0, 30).map((r) => {
        const status = runStatus(r);
        return (
          <li key={r.id}>
            <button
              type="button"
              className={`run${r.id === currentId ? " is-current" : ""}`}
              onClick={() => onOpen(r.id)}
              aria-current={r.id === currentId ? "page" : undefined}
              title={status.label}
            >
              <span className={`run-mark tone-${status.tone}`} aria-hidden="true" />
              <span className="run-file">{r.file}</span>
              <span className="run-meta">
                {status.label}
                {r.state === "done" && r.llm_used ? ", с моделью" : ""}
                <time>{formatTime(r.created_at)}</time>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
