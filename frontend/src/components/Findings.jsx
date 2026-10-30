import { useEffect, useRef } from "react";
import { SEVERITY } from "../format.js";
import ColorPair from "./ColorPair.jsx";

export default function Findings({ findings, selected, onSelect, report }) {
  const listRef = useRef(null);

  useEffect(() => {
    const el = listRef.current && listRef.current.querySelector(".finding.is-selected");
    if (el && el.scrollIntoView) el.scrollIntoView({ block: "nearest" });
  }, [selected]);

  if (!findings.length) {
    return (
      <div className="findings findings-empty">
        <h2>Расхождений не найдено</h2>
        <p>
          Все {report.counts.rules_total - report.counts.rules_skipped} применимых требований выполнены. Подробности по каждому
          требованию — на вкладке «Чек-лист».
        </p>
      </div>
    );
  }

  return (
    <ol className="findings" ref={listRef}>
      {findings.map((f) => {
        const sev = SEVERITY[f.severity] || SEVERITY.info;
        const ev = f.evidence || {};
        return (
          <li key={f.id}>
            <button type="button" className={`finding tone-${sev.tone}${f.id === selected ? " is-selected" : ""}`} onClick={() => onSelect(f)}>
              <span className="finding-head">
                <code className="finding-rule">{f.rule}</code>
                <span className="finding-title">{f.title}</span>
                <span className="finding-sev">{sev.label}</span>
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
            {ev.url && (
              <a className="finding-link" href={ev.url} target="_blank" rel="noreferrer">
                Перечень утверждённых АХК на mos.ru ↗
              </a>
            )}
          </li>
        );
      })}
    </ol>
  );
}

function labelFor(f) {
  if (f.rule === "TAB-05") return "образец в таблице";
  if (f.rule === "TAB-04") return f.actual ? `NCS ${f.actual}` : "NCS";
  if (f.rule === "GRF-03") return "остекление";
  return "на развёртке";
}
