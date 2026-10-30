import { STATUS } from "../format.js";

export default function Checklist({ report, onSelect }) {
  const byCat = [];
  const index = {};
  for (const item of report.checklist) {
    if (!(item.category in index)) {
      index[item.category] = byCat.length;
      byCat.push({ title: item.category_title, items: [] });
    }
    byCat[index[item.category]].items.push(item);
  }
  const findingById = Object.fromEntries(report.findings.map((f) => [f.id, f]));

  return (
    <div className="checklist">
      {byCat.map((group) => (
        <section key={group.title} className="check-group">
          <h2>{group.title}</h2>
          <ul>
            {group.items.map((item) => {
              const st = STATUS[item.status];
              return (
                <li key={item.rule} className={`check tone-${st.tone}`}>
                  <span className="check-status">{st.label}</span>
                  <span className="check-body">
                    <span className="check-title">
                      <code>{item.rule}</code> {item.title}
                    </span>
                    <span className="check-ref">{item.ref}</span>
                    {item.note && <span className="check-note">{item.note}</span>}
                    {item.findings.length > 0 && (
                      <span className="check-links">
                        {item.findings.map((id) => (
                          <button key={id} type="button" className="issue-link" onClick={() => onSelect(findingById[id])}>
                            {findingById[id].page != null ? `лист ${findingById[id].page + 1}` : "документ"}
                            {findingById[id].element ? `, поз. ${findingById[id].element}` : ""}
                          </button>
                        ))}
                      </span>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
