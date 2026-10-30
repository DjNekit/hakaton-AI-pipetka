import { useEffect, useMemo, useState } from "react";
import { api } from "../api.js";
import { VERDICT, plural } from "../format.js";
import Findings from "./Findings.jsx";
import SheetViewer from "./SheetViewer.jsx";
import FinishTable from "./FinishTable.jsx";
import Checklist from "./Checklist.jsx";
import Conclusion from "./Conclusion.jsx";
import Sheets from "./Sheets.jsx";
import PhotoCompare from "./PhotoCompare.jsx";
import Explication from "./Explication.jsx";

const TABS = [
  ["findings", "Замечания"],
  ["sheets", "Листы"],
  ["table", "Таблица отделки"],
  ["explication", "Экспликация"],
  ["checklist", "Чек-лист"],
  ["conclusion", "Заключение"],
  ["photo", "Сравнение с фото"],
];

export default function Report({ run, useLlm }) {
  const report = run.report;
  const signage = report.document_kind === "signage";
  const tabs = TABS.filter(([key]) => (signage ? key !== "table" : key !== "explication"));
  const [tab, setTab] = useState("findings");
  const [selected, setSelected] = useState(null);
  const [page, setPage] = useState(null);

  const findings = report.findings;
  const defaultPage = useMemo(() => {
    if (findings.length && findings[0].page != null) return findings[0].page;
    const facade = report.pages.find((p) => p.kinds[0] === "facade");
    return facade ? facade.index : 0;
  }, [report, findings]);

  useEffect(() => {
    setSelected(findings.length ? findings[0].id : null);
    setPage(defaultPage);
    setTab("findings");
  }, [run.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const select = (f) => {
    setSelected(f.id);
    if (f.page != null) setPage(f.page);
  };

  const v = VERDICT[report.verdict];
  const s = report.summary;
  const c = report.counts;
  const passed = c.rules_ok;
  const applicable = c.rules_total - c.rules_skipped;

  return (
    <article className="report">
      <div className={`stamp tone-${v.tone}`}>
        <div className="stamp-verdict">
          <span className="stamp-label">Вердикт</span>
          <strong>{v.title}</strong>
        </div>
        <dl className="stamp-grid">
          <div className="cell-wide">
            <dt>Адрес объекта</dt>
            <dd>{s.address || "не найден"}</dd>
          </div>
          <div>
            <dt>{signage ? "Документ" : "Паспорт"}</dt>
            <dd>
              {signage ? "Дизайн-проект вывесок (902-ПП)" : s.number ? `№ ${s.number}` : "номер не найден"}
              {!signage && s.date ? ` от ${s.date}` : ""}
            </dd>
          </div>
          <div className="cell-end">
            <dt>Нарушения</dt>
            <dd className="num tone-text-error">{c.errors}</dd>
          </div>
          <div className="cell-wide">
            <dt>Объект</dt>
            <dd>{s.object || "—"}</dd>
          </div>
          <div>
            <dt>Файл</dt>
            <dd className="ellipsis" title={run.file}>
              {run.file}
            </dd>
          </div>
          <div className="cell-end">
            <dt>Предупреждения</dt>
            <dd className="num tone-text-warn">{c.warnings}</dd>
          </div>
          <div className="cell-wide">
            <dt>Требования</dt>
            <dd>
              {passed} из {applicable} применимых выполнено
              {c.rules_skipped ? `, ${c.rules_skipped} не применимо` : ""}
            </dd>
          </div>
          <div className="cell-wide cell-end">
            <dt>Проверка</dt>
            <dd>
              {report.duration_s} с, {s.pages} {plural(s.pages, "лист", "листа", "листов")}
              {report.llm.used ? `, ${report.llm.model}` : ", без модели"}
            </dd>
          </div>
        </dl>
      </div>

      {run.expected && <Expected run={run} />}

      <nav className="tabs" role="tablist" aria-label="Разделы отчёта">
        {tabs.map(([key, title]) => (
          <button key={key} type="button" role="tab" aria-selected={tab === key} className={`tab${tab === key ? " is-active" : ""}`} onClick={() => setTab(key)}>
            {title}
            {key === "findings" && findings.length > 0 && <span className="tab-count">{findings.length}</span>}
          </button>
        ))}
        <a className="tab tab-link" href={api.fileUrl(run.id, "report.json")} target="_blank" rel="noreferrer">
          Отчёт JSON
        </a>
      </nav>

      {tab === "findings" && (
        <div className="split">
          <Findings findings={findings} selected={selected} onSelect={select} report={report} />
          <SheetViewer run={run} pageIndex={page ?? defaultPage} findings={findings} selected={selected} onSelect={select} onPage={setPage} />
        </div>
      )}
      {tab === "sheets" && (
        <div className="split">
          <Sheets run={run} current={page ?? defaultPage} onPick={setPage} />
          <SheetViewer run={run} pageIndex={page ?? defaultPage} findings={findings} selected={selected} onSelect={select} onPage={setPage} />
        </div>
      )}
      {tab === "table" && <FinishTable report={report} findings={findings} onSelect={(f) => { select(f); setTab("findings"); }} />}
      {tab === "explication" && <Explication report={report} onSelect={(f) => { select(f); setTab("findings"); }} />}
      {tab === "checklist" && <Checklist report={report} onSelect={(f) => { select(f); setTab("findings"); }} />}
      {tab === "conclusion" && <Conclusion run={run} />}
      {tab === "photo" && <PhotoCompare run={run} useLlm={useLlm} />}
    </article>
  );
}

function Expected({ run }) {
  const exp = run.expected;
  const findings = run.report.findings.filter((f) => f.severity !== "info");
  const rules = new Set(findings.map((f) => f.rule));
  const defects = exp.defects;
  const found = defects.filter((d) => (d.rule_any || [d.rule]).some((r) => rules.has(r)));
  return (
    <section className="expected" aria-label="Сравнение с эталоном">
      <h2>
        Разметка документа: {defects.length === 0 ? "ошибок нет" : `размечено ${defects.length}, найдено ${found.length}`}
      </h2>
      {defects.length > 0 && (
        <ul>
          {defects.map((d, i) => {
            const ok = (d.rule_any || [d.rule]).some((r) => rules.has(r));
            return (
              <li key={i} className={ok ? "is-found" : "is-missed"}>
                <span className="exp-mark" aria-label={ok ? "найдено" : "не найдено"}>{ok ? "✓" : "✗"}</span>
                <code>{d.rule}</code> {d.detail}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
