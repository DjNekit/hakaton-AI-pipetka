// Экспликация вывесок дизайн-проекта (902-ПП): распознанные позиции, размеры и связанные замечания
export default function Explication({ report, findings, onSelect }) {
  const sg = report.signage;
  const byElement = {};
  for (const f of findings || report.findings.filter((x) => !x.dismissed)) {
    if (f.element) (byElement[f.element] = byElement[f.element] || []).push(f);
  }
  const fmt = (v) => (v == null ? "—" : Math.round(v).toLocaleString("ru-RU"));
  const photoDates = Object.entries(sg.photo_dates || {});

  return (
    <div className="expl">
      <dl className="expl-facts">
        <div>
          <dt>Адрес</dt>
          <dd>{sg.address || "не указан"}</dd>
        </div>
        <div>
          <dt>Заказчик</dt>
          <dd>{sg.customer || "не указан"}</dd>
        </div>
        <div>
          <dt>Год постройки</dt>
          <dd>{sg.year_built || "не указан"}</dd>
        </div>
        <div>
          <dt>Масштабы чертежей</dt>
          <dd>{Object.values(sg.scales || {}).flat().filter((v, i, a) => a.indexOf(v) === i).join(", ") || "не указаны"}</dd>
        </div>
        <div>
          <dt>Даты фотофиксации</dt>
          <dd>{photoDates.some(([, d]) => d.length) ? photoDates.flatMap(([, d]) => d).join(", ") : "не найдены"}</dd>
        </div>
        <div>
          <dt>Пояснительная записка</dt>
          <dd>{sg.note_pages.length === 0 ? "нет" : sg.note_is_template ? "текст образца, не заполнена" : `листы ${sg.note_pages.map((p) => p + 1).join(", ")}`}</dd>
        </div>
      </dl>

      {sg.rows.length === 0 ? (
        <p className="muted">Экспликация вывесок не найдена или не распознана.</p>
      ) : (
        <div className="table-wrap">
          <table className="finish expl-table">
            <thead>
              <tr>
                <th>№</th>
                <th>Тип</th>
                <th>Вид, освещение</th>
                <th>Длина, мм</th>
                <th>Высота, мм</th>
                <th>Ширина, мм</th>
                <th>Вынос, мм</th>
                <th>Листы</th>
                <th>Замечания</th>
              </tr>
            </thead>
            <tbody>
              {sg.rows.map((r) => {
                const issues = byElement[r.n] || [];
                return (
                  <tr key={r.n} className={issues.some((f) => f.severity === "error") ? "is-bad" : ""}>
                    <td>
                      <b>{r.n}</b>
                    </td>
                    <td>{r.sign_type || <span className="tone-text-error">не указан</span>}</td>
                    <td>{r.kind_text}</td>
                    {r.dims_given ? (
                      <>
                        <td className="num">{fmt(r.length)}</td>
                        <td className="num">{fmt(r.height)}</td>
                        <td className="num">{fmt(r.width)}</td>
                      </>
                    ) : (
                      <td colSpan={3} className="tone-text-error">
                        не указаны («{r.dims_raw || "—"}»)
                      </td>
                    )}
                    <td className="num">{r.offset != null ? fmt(r.offset) : "—"}</td>
                    <td>{r.pages.map((p) => p + 1).join(", ")}</td>
                    <td>
                      {issues.map((f) => (
                        <button key={f.id} type="button" className="issue-link" onClick={() => onSelect(f)}>
                          {f.rule}
                        </button>
                      ))}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="footnote">
        Размеры сверяются с Правилами размещения информационных конструкций (902-ПП, прил. 1): настенные — до 0,5 м в
        высоту (объёмные буквы без подложки — до 0,75 м) и до 15 м в длину; консольные — до 1 × 0,2 м с выносом до 1 м;
        на витрине — до 0,4 м. Пороги — в rules.yaml.
      </p>
    </div>
  );
}
