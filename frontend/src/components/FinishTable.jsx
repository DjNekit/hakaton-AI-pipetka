import { Chip } from "./ColorPair.jsx";

export default function FinishTable({ report, findings, onSelect }) {
  const rows = report.passport.finish_table;
  const mentions = report.passport.note_mentions || [];
  const byElement = {};
  for (const m of mentions) {
    for (const n of m.elements) (byElement[n] = byElement[n] || []).push(m);
  }
  const issues = {};
  for (const f of findings) if (f.element) (issues[f.element] = issues[f.element] || []).push(f);

  if (!rows.length) return <p className="muted-block">Таблица отделки не распознана — см. замечание CMP-01 на вкладке «Замечания».</p>;

  return (
    <div className="table-wrap">
      <table className="finish">
        <caption>
          Таблица отделки, распознанная из паспорта. Пояснительная записка разобрана{" "}
          {report.passport.note_mentions_source === "llm" ? "языковой моделью (коды проверены по тексту)" : "правилами"}.
          {rows.some((r) => r.codes_source && r.codes_source !== "text") &&
            " Таблица — скан: коды распознаны OCR, сверяйте их с изображением листа."}
        </caption>
        <thead>
          <tr>
            <th scope="col">№</th>
            <th scope="col">Элемент и материал</th>
            <th scope="col">Образец в паспорте</th>
            <th scope="col">RAL</th>
            <th scope="col">NCS (≈)</th>
            <th scope="col">В пояснительной записке</th>
            <th scope="col">Замечания</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const unused = !r.material && !r.swatch_hex && !r.marks.ral.length && !r.marks.ncs.length;
            if (unused)
              return (
                <tr key={r.n} className="is-unused">
                  <td className="n">{r.n}</td>
                  <td>
                    <b>{r.name}</b>
                    <span className="sub">{r.group ? `${r.group}: ` : ""}элемент не применяется (строка формы)</span>
                  </td>
                  <td colSpan={5} />
                </tr>
              );
            return (
            <tr key={r.n} className={issues[r.n] ? "has-issue" : ""}>
              <td className="n">{r.n}</td>
              <td>
                <b>{r.name}</b>
                <span className="sub">{r.material || <em className="tone-text-error">материал не указан</em>}</span>
                {r.group && <span className="sub">{r.group}</span>}
              </td>
              <td>{r.swatch_hex ? <Chip hex={r.swatch_hex} caption="образец" small /> : "—"}</td>
              <td>
                {r.marks.ral.length
                  ? r.marks.ral.map((code, i) =>
                      r.ral_hex[i] ? <Chip key={code} hex={r.ral_hex[i]} caption={`RAL ${code}`} small /> : <em key={code} className="tone-text-error">RAL {code}: нет в палитре</em>,
                    )
                  : (issues[r.n] || []).some((f) => f.rule === "TAB-01") ? <em className="tone-text-error">не указан</em> : <span className="muted">—</span>}
              </td>
              <td>
                {r.marks.ncs.length
                  ? r.marks.ncs.map((code, i) =>
                      r.ncs_valid[i] ? <Chip key={code} hex={r.ncs_hex[i]} caption={code} small /> : <em key={code} className="tone-text-error">{code}: некорректно</em>,
                    )
                  : (issues[r.n] || []).some((f) => f.rule === "TAB-01") ? <em className="tone-text-error">не указан</em> : <span className="muted">—</span>}
              </td>
              <td className="note-cell">
                {(byElement[r.n] || []).map((m, i) => (
                  <span key={i} className="note-codes">
                    {[...m.ral.map((x) => `RAL ${x}`), ...m.ncs].join(", ")}
                  </span>
                ))}
                {!byElement[r.n] && <span className="muted">не упоминается</span>}
              </td>
              <td>
                {(issues[r.n] || []).map((f) => (
                  <button key={f.id} type="button" className={`issue-link tone-${f.severity === "error" ? "error" : "warn"}`} onClick={() => onSelect(f)}>
                    {f.rule}
                  </button>
                ))}
              </td>
            </tr>
            );
          })}
        </tbody>
      </table>
      <p className="footnote">
        NCS (≈) — приблизительный перевод в экранный цвет: официальные значения NCS проприетарны, поэтому сравнения по NCS
        используют более мягкие пороги. RAL — по справочнику RAL Classic.
      </p>
    </div>
  );
}
