import { api } from "../api.js";

export default function Sheets({ run, current, onPick }) {
  return (
    <ul className="sheets">
      {run.report.pages.map((p) => (
        <li key={p.index}>
          <button type="button" className={`thumb${p.index === current ? " is-current" : ""}`} onClick={() => onPick(p.index)}>
            <img src={api.fileUrl(run.id, p.image)} alt="" loading="lazy" />
            <span className="thumb-cap">
              <b>{p.number}</b> {p.kind_title}
            </span>
            {p.findings.length > 0 && <span className="thumb-badge">{p.findings.length}</span>}
          </button>
        </li>
      ))}
    </ul>
  );
}
