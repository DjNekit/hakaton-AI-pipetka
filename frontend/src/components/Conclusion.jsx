import { useState } from "react";
import { api } from "../api.js";
import { DECISION, formatDate } from "../format.js";

export default function Conclusion({ run, onUpdate }) {
  const { conclusion, llm } = run.report;
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const reference = run.expected && run.expected.reference_conclusion;
  const decision = run.decision && DECISION[run.decision];
  const archived = Boolean(run.archived_at);
  const documentName = run.report.document_kind === "signage" ? "проект" : "паспорт";

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(conclusion.text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  const decide = async (value) => {
    setBusy(true);
    setError(null);
    try {
      const updated = await api.setDecision(run.id, value);
      onUpdate(updated);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`conclusion${reference ? " with-reference" : ""}`}>
      <section className="paper">
        <header className="paper-head">
          <h2>Заключение</h2>
          <span className="paper-source">
            {conclusion.recalculated
              ? "Пересчитано по шаблону после изменения списка замечаний"
              : conclusion.source === "llm"
                ? `Сформулировано языковой моделью ${llm.model} по результатам проверки`
                : "Составлено по шаблону из результатов проверки"}
          </span>
        </header>
        <div className="paper-text">{conclusion.text}</div>
        <footer className="paper-actions">
          <button type="button" className="btn btn-primary" onClick={copy}>
            {copied ? "Скопировано" : "Скопировать текст"}
          </button>
          <a className="btn" href={api.fileUrl(run.id, "conclusion.md")} download={`заключение-${run.id}.md`}>
            Скачать .md
          </a>
          <a className="btn" href={api.exportExcelUrl(run.id)}>
            Скачать Excel
          </a>
          {llm.requested && !llm.used && llm.error && <span className="muted">Модель не использована: {llm.error}</span>}
        </footer>
      </section>

      {reference && (
        <section className="paper paper-reference">
          <header className="paper-head">
            <h2>Эталонное заключение</h2>
            <span className="paper-source">Из разметки тестового датасета — для сравнения</span>
          </header>
          <div className="paper-text">{reference}</div>
        </section>
      )}

      <section className={`paper paper-decision${decision ? ` tone-${decision.tone}` : ""}`}>
        <header className="paper-head">
          <h2>Решение по документу</h2>
          <span className="paper-source">
            {archived
              ? `Файл в архиве с ${formatDate(run.archived_at)}`
              : "Решение фиксируется в журнале проверок; через 30 дней файл уходит в архив"}
          </span>
        </header>
        {archived ? (
          <p className="decision-note">
            Статус: {decision ? decision.label : "в архиве"}. Изменение решения недоступно.
          </p>
        ) : (
          <>
            <p className={`decision-status${decision ? ` tone-text-${decision.tone}` : ""}`}>
              {decision
                ? `Статус: ${decision.label}${run.decided_at ? `, ${formatDate(run.decided_at)}` : ""}`
                : "Прочитайте заключение и примите решение по документу."}
            </p>
            <div className="decision-actions">
              <button
                type="button"
                className={`btn${run.decision === "accepted" ? " btn-primary" : ""}`}
                disabled={busy}
                onClick={() => decide("accepted")}
              >
                Принять {documentName}
              </button>
              <button
                type="button"
                className={`btn btn-danger${run.decision === "rejected" ? " is-active" : ""}`}
                disabled={busy}
                onClick={() => decide("rejected")}
              >
                Отклонить {documentName}
              </button>
            </div>
            {run.archive_at && <p className="decision-note">Файл будет перемещён в архив {formatDate(run.archive_at)}.</p>}
            {error && <p className="decision-error">{error}</p>}
          </>
        )}
      </section>
    </div>
  );
}
