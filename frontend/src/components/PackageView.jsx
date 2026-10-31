import { api } from "../api.js";
import { STATUS, VERDICT, formatTime, packageStatus, plural, runStatus } from "../format.js";

const KIND = {
  passport: "Паспорт колористического решения (114-ПП)",
  signage: "Дизайн-проект размещения вывесок (902-ПП)",
};

// Пакет документов одной заявки: общий вердикт, сверка документов между собой, список документов и фото.
export default function PackageView({ pkg }) {
  const status = packageStatus(pkg);
  const busy = pkg.state === "queued" || pkg.state === "running";
  const docs = pkg.documents || [];
  const c = pkg.counts || {};
  const v = VERDICT[pkg.verdict];

  return (
    <article className="package">
      <div className={`stamp tone-${status.tone}`}>
        <div className="stamp-verdict">
          <span className="stamp-label">Пакет документов</span>
          <strong>{busy ? "Идёт проверка" : v ? v.title : status.title}</strong>
        </div>
        <dl className="stamp-grid">
          <div className="cell-wide">
            <dt>Заявка</dt>
            <dd>{pkg.title}</dd>
          </div>
          <div>
            <dt>Документы</dt>
            <dd className="num">{docs.length}</dd>
          </div>
          <div className="cell-end">
            <dt>Нарушения</dt>
            <dd className="num tone-text-error">{c.errors ?? "—"}</dd>
          </div>
          <div className="cell-wide">
            <dt>Создан</dt>
            <dd>{formatTime(pkg.created_at)}</dd>
          </div>
          <div>
            <dt>Фото</dt>
            <dd className="num">{(pkg.photos || []).length || pkg.photos_uploaded || 0}</dd>
          </div>
          <div className="cell-end">
            <dt>Предупреждения</dt>
            <dd className="num tone-text-warn">{c.warnings ?? "—"}</dd>
          </div>
        </dl>
      </div>

      {busy && (
        <div className="progress-bar pkg-progress" aria-label="Ход проверки пакета">
          <span style={{ width: `${Math.max(4, Math.round((pkg.progress || 0) * 100))}%` }} />
        </div>
      )}

      <section className="pkg-section" aria-label="Документы пакета">
        <h2>Документы</h2>
        <ul className="pkg-docs">
          {docs.map((d) => {
            const s = runStatus(d);
            const dc = d.counts || {};
            return (
              <li key={d.id}>
                <a className="pkg-doc" href={`#/check/${d.id}`}>
                  <span className={`run-mark tone-${s.tone}`} aria-hidden="true" />
                  <span className="pkg-doc-main">
                    <strong className="ellipsis" title={d.file}>
                      {d.file}
                    </strong>
                    <span className="muted">{d.kind ? KIND[d.kind] || d.kind : d.state === "error" ? "не проверен" : "вид документа определяется…"}</span>
                  </span>
                  <span className="pkg-doc-state">
                    {d.state === "done" ? (
                      <>
                        <span className={`tone-text-${s.tone}`}>{s.title}</span>
                        <span className="muted">
                          {dc.errors || 0} {plural(dc.errors || 0, "нарушение", "нарушения", "нарушений")}, {dc.warnings || 0}{" "}
                          {plural(dc.warnings || 0, "предупреждение", "предупреждения", "предупреждений")}
                        </span>
                      </>
                    ) : d.state === "error" ? (
                      <span className="tone-text-error" title={d.error}>
                        Ошибка: {d.error}
                      </span>
                    ) : (
                      <span className="muted">
                        {d.stage || "В очереди"} {d.progress ? `· ${Math.round(d.progress * 100)} %` : ""}
                      </span>
                    )}
                  </span>
                </a>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="pkg-section" aria-label="Сверка документов пакета">
        <h2>Чек-лист пакета документов</h2>
        {(pkg.checks || []).length === 0 ? (
          <p className="muted">{busy ? "Появится, когда будут проверены все документы." : "Нет данных."}</p>
        ) : (
          <ul className="pkg-checks">
            {pkg.checks.map((ch) => {
              const st = STATUS[ch.status] || STATUS.skip;
              return (
                <li key={ch.rule}>
                  <span className={`badge tone-${st.tone}`}>{st.label}</span>
                  <span>
                    <code>{ch.rule}</code> {ch.title}
                    {ch.note && <span className="muted pkg-note">{ch.note}</span>}
                    {ch.requirement && <span className="muted pkg-note">{ch.requirement}</span>}
                    {ch.ref && <span className="muted pkg-note">Основание: {ch.ref}</span>}
                    {(ch.evidence || []).map((e, i) => (
                      <span className="muted pkg-note" key={i}>
                        {e.file}{e.page ? `, стр. ${e.page}` : ""}: {e.quote || e.note || e.status}
                      </span>
                    ))}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {(pkg.photos || []).length > 0 && docs[0] && (
        <section className="pkg-section" aria-label="Фото пакета">
          <h2>Фото объекта</h2>
          <p className="muted">Сравнить фото с развёрткой — в документе паспорта, вкладка «Сравнение с фото».</p>
          <div className="pkg-photos">
            {pkg.photos.map((ph) => (
              <figure key={ph.id}>
                <img src={api.fileUrl(docs[0].id, ph.image)} alt={ph.name} loading="lazy" />
                <figcaption className="ellipsis">{ph.name}</figcaption>
              </figure>
            ))}
          </div>
        </section>
      )}
    </article>
  );
}
