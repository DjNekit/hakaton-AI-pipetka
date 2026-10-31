export default function EmptyState({ rules, samples, onSample }) {
  const groups = {};
  if (rules) {
    for (const r of rules.rules) {
      (groups[r.category] = groups[r.category] || []).push(r);
    }
  }
  const demo = samples.find((s) => s.kind !== "signage") || samples[0];
  return (
    <div className="empty">
      <div className="empty-lead">
        <h1>Проверка паспорта колористического решения и дизайн-проекта вывесок</h1>
        <p>
          Загрузите PDF паспорта колористического решения или дизайн-проекта размещения вывесок: сервис определит вид
          документа, сверит его с ПП Москвы № 114-ПП или № 902-ПП и покажет каждое расхождение на листе. Во вкладке
          «Сравнение с фото» — сравнение фото здания или скрина с камеры с развёрткой или фотомонтажом.
        </p>
        {/* {demo && (
          <button type="button" className="btn btn-primary" onClick={() => onSample(demo.name)}>
            Проверить реальный паспорт
          </button>
        )} */}
      </div>
      {rules && (
        <div className="rulebook" aria-label="Что проверяется">
          {Object.entries(rules.categories).map(([key, title]) => (
            <section key={key} className="rulebook-group">
              <h2>{title}</h2>
              <ul>
                {(groups[key] || []).map((r) => (
                  <li key={r.id}>
                    <code>{r.id}</code>
                    <span>{r.title}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
