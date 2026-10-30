import { useState } from "react";
import { api } from "../api.js";

const ZOOMS = [1, 1.6, 2.4];

export default function SheetViewer({ run, pageIndex, findings, selected, onSelect, onPage }) {
  const report = run.report;
  const page = report.pages[pageIndex] || report.pages[0];
  const [zoom, setZoom] = useState(0);
  const onPageFindings = findings.filter((f) => f.page === page.index && f.bbox);
  const pad = 4;

  return (
    <section className="viewer" aria-label={`Лист ${page.number}`}>
      <header className="viewer-bar">
        <button type="button" className="btn btn-quiet" disabled={page.index === 0} onClick={() => onPage(page.index - 1)} aria-label="Предыдущий лист">
          ‹
        </button>
        <span className="viewer-title">
          Лист {page.number} из {report.pages.length}
          <small>{page.kind_title}</small>
        </span>
        <button
          type="button"
          className="btn btn-quiet"
          disabled={page.index === report.pages.length - 1}
          onClick={() => onPage(page.index + 1)}
          aria-label="Следующий лист"
        >
          ›
        </button>
        <span className="viewer-spacer" />
        <button type="button" className="btn btn-quiet" onClick={() => setZoom((zoom + 1) % ZOOMS.length)}>
          {zoom === ZOOMS.length - 1 ? "Вписать" : "Увеличить"}
        </button>
      </header>
      <div className="viewer-scroll">
        <div className="sheet" style={{ width: `${ZOOMS[zoom] * 100}%` }}>
          <img src={api.fileUrl(run.id, page.image)} alt={`Лист ${page.number}: ${page.kind_title}`} draggable="false" />
          <svg className="sheet-overlay" viewBox={`0 0 ${page.width} ${page.height}`} preserveAspectRatio="none">
            {onPageFindings.map((f) => {
              const [x0, y0, x1, y1] = f.bbox;
              const isSel = f.id === selected;
              return (
                <g key={f.id} className={`mark mark-${f.severity}${isSel ? " is-selected" : ""}`} onClick={() => onSelect(f)}>
                  <rect x={x0 - pad} y={y0 - pad} width={x1 - x0 + 2 * pad} height={y1 - y0 + 2 * pad} rx="2" />
                  <text x={x0 - pad} y={y0 - pad - 3}>
                    {f.rule}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>
      </div>
      {page.notes && page.notes.length > 0 && <p className="viewer-note">{page.notes.join(" ")}</p>}
    </section>
  );
}
