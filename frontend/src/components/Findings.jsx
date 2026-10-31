import { useEffect, useRef, useState } from "react";
import { SEVERITY } from "../format.js";
import ColorPair from "./ColorPair.jsx";

export default function Findings({ findings, selected, onSelect, onDismiss, onRestore, busy, error, report }) {
  const listRef = useRef(null);
  const [showDismissed, setShowDismissed] = useState(false);
  const active = findings.filter((f) => !f.dismissed);
  const dismissed = findings.filter((f) => f.dismissed);

  useEffect(() => {
    const el = listRef.current && listRef.current.querySelector(".finding.is-selected");
    if (el && el.scrollIntoView) el.scrollIntoView({ block: "nearest" });
  }, [selected]);

  const card = (f, isDismissed) => {
    const sev = SEVERITY[f.severity] || SEVERITY.info;
    const ev = f.evidence || {};
    return (
      <li key={f.id}>
        <div className={`finding tone-${sev.tone}${f.id === selected ? " is-selected" : ""}${isDismissed ? " is-dismissed" : ""}`}>
          <button type="button" className="finding-main" onClick={() => onSelect(f)}>
            <span className="finding-head">
              <code className="finding-rule">{f.rule}</code>
              <span className="finding-title">{f.title}</span>
              <span className="finding-sev">{isDismissed ? "Исключено" : sev.label}</span>
            </span>
            <span className="finding-msg">{f.message}</span>
            {(ev.expected_hex || ev.actual_hex) && (
              <ColorPair expected={ev.expected_hex} expectedLabel={f.expected} actual={ev.actual_hex} actualLabel={labelFor(f)} deltaE={f.delta_e} />
            )}
            {ev.quote && <span className="finding-quote">«{ev.quote}»</span>}
            <span className="finding-foot">
              <span className="finding-page">{f.page != null ? `Лист ${f.page + 1}` : "Документ целиком"}</span>
              <span className="finding-ref">{f.ref}</span>
            </span>
          </button>
          <div className="finding-actions">
            {isDismissed ? (
              <button type="button" className="btn btn-quiet" disabled={busy === f.id} onClick={() => onRestore(f)}>
                Вернуть в отчёт
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-quiet"
                disabled={busy === f.id}
                title="Замечание будет исключено из вердикта, счётчиков и заключения"
                onClick={() => onDismiss(f)}
              >
                {busy === f.id ? "Исключаем…" : "Ложное срабатывание"}
              </button>
            )}
          </div>
        </div>
        {ev.url && (
          <a className="finding-link" href={ev.url} target="_blank" rel="noreferrer">
            Перечень утверждённых АХК на mos.ru ↗
          </a>
        )}
      </li>
    );
  };

  return (
    <div className="findings-panel">
      {error && (
        <div className="banner banner-error" role="alert">
          Не удалось изменить замечание: {error}
        </div>
      )}
      {!active.length && (
        <div className="findings findings-empty">
          <h2>{dismissed.length ? "Все замечания исключены" : "Расхождений не найдено"}</h2>
          <p>
            {dismissed.length
              ? "Активных замечаний нет. Исключённые можно вернуть в отчёт."
              : `Все ${report.counts.rules_total - report.counts.rules_skipped} применимых требований выполнены. Подробности по каждому требованию — на вкладке «Чек-лист».`}
          </p>
        </div>
      )}
      {active.length > 0 && (
        <ol className="findings" ref={listRef}>
          {active.map((f) => card(f, false))}
        </ol>
      )}
      {dismissed.length > 0 && (
        <section className="findings-dismissed">
          <button type="button" className="btn btn-quiet" onClick={() => setShowDismissed((v) => !v)} aria-expanded={showDismissed}>
            {showDismissed ? "Скрыть исключённые" : "Показать исключённые"} ({dismissed.length})
          </button>
          {showDismissed && <ol className="findings findings-dismissed-list">{dismissed.map((f) => card(f, true))}</ol>}
        </section>
      )}
    </div>
  );
}

function labelFor(f) {
  if (f.rule === "TAB-05") return "образец в таблице";
  if (f.rule === "TAB-04") return f.actual ? `NCS ${f.actual}` : "NCS";
  if (f.rule === "GRF-03") return "остекление";
  return "на развёртке";
}
