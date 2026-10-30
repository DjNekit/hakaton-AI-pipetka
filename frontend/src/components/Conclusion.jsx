import { useState } from "react";
import { api } from "../api.js";

export default function Conclusion({ run }) {
  const { conclusion, llm } = run.report;
  const [copied, setCopied] = useState(false);
  const reference = run.expected && run.expected.reference_conclusion;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(conclusion.text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
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
    </div>
  );
}
