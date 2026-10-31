import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api.js";
import ColorPair from "./ColorPair.jsx";

// Сравнение фото здания (снимок инспектора, скрин с камеры) с развёрткой фасада из паспорта.
// Шаги: развёртка (при необходимости — видимая на фото часть) → фото → четыре угла фасада → сравнение.

const PHOTO_VERDICT = {
  match: { title: "Совпадает", tone: "ok" },
  mismatch: { title: "Не совпадает", tone: "error" },
  attention: { title: "Требует внимания", tone: "warn" },
};

const CORNERS = ["левый верх", "правый верх", "правый низ", "левый низ"];

function defaultQuad(w, h) {
  const mx = w * 0.12;
  const my = h * 0.12;
  return [
    [mx, my],
    [w - mx, my],
    [w - mx, h - my],
    [mx, h - my],
  ];
}

function svgPoint(svg, e) {
  const pt = svg.createSVGPoint();
  pt.x = e.clientX;
  pt.y = e.clientY;
  const p = pt.matrixTransform(svg.getScreenCTM().inverse());
  return [p.x, p.y];
}

export default function PhotoCompare({ run, modelOn }) {
  const [blocks, setBlocks] = useState(null);
  const [blocksError, setBlocksError] = useState(null);
  const [facadeId, setFacadeId] = useState(null);
  const [rect, setRect] = useState(null); // часть развёртки, доли [[x0,y0],[x1,y1]]
  const [photo, setPhoto] = useState(null); // {kind: "passport"|"upload", block?, file?, url, label}
  const [natural, setNatural] = useState(null); // размер фото в пикселях
  const [quad, setQuad] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [history, setHistory] = useState([]);
  const [current, setCurrent] = useState(null);
  const [hint, setHint] = useState(null);

  useEffect(() => {
    let alive = true;
    setBlocks(null);
    setBlocksError(null);
    setCurrent(null);
    api
      .blocks(run.id)
      .then((b) => {
        if (!alive) return;
        setBlocks(b);
        if (b.facades.length) setFacadeId(b.facades[0].id);
      })
      .catch((e) => alive && setBlocksError(e.message));
    api
      .comparisons(run.id)
      .then((items) => {
        if (!alive) return;
        setHistory(items);
        if (items.length) setCurrent(items[0]);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [run.id]);

  const facade = useMemo(() => blocks && blocks.facades.find((f) => f.id === facadeId), [blocks, facadeId]);

  const choosePassportPhoto = (b) => {
    setPhoto({ kind: "passport", block: b.id, url: api.fileUrl(run.id, b.image), label: b.label });
    setHint(null);
    setNatural(null);
    setQuad(null);
  };

  // своё фото загружается в сервис processor один раз; углы и сравнение ссылаются на него по uploadId
  const chooseUpload = async (file) => {
    if (!file) return;
    if (photo && photo.kind === "upload") URL.revokeObjectURL(photo.url);
    const url = URL.createObjectURL(file);
    setPhoto({ kind: "upload", file, url, label: file.name, uploadId: null });
    setNatural(null);
    setQuad(null);
    setHint("Загружаю фото…");
    try {
      const { uploads } = await api.uploadFiles([file]);
      const up = uploads.find((u) => u.kind === "image");
      if (!up) throw new Error("нужен JPEG или PNG");
      setPhoto((p) => (p && p.url === url ? { ...p, uploadId: up.id } : p));
      setHint(null);
    } catch (e) {
      setHint(`Фото не загружено: ${e.message}`);
    }
  };
  const photoReady = photo && (photo.kind === "passport" || photo.uploadId);

  const onPhotoLoad = (e) => {
    const w = e.currentTarget.naturalWidth;
    const h = e.currentTarget.naturalHeight;
    setNatural([w, h]);
    setQuad((q) => q || defaultQuad(w, h));
  };

  const autoCorners = async () => {
    if (!photoReady) return;
    setHint("Ищу углы фасада…");
    try {
      const res = await api.corners(run.id, {
        uploadId: photo.kind === "upload" ? photo.uploadId : null,
        photoBlock: photo.kind === "passport" ? photo.block : null,
      });
      setQuad(res.quad);
      setHint(res.confident ? "Углы найдены по линиям фасада — проверьте и поправьте точки." : "Уверенно найти углы не удалось — расставьте точки вручную.");
    } catch (e) {
      setHint(`Не удалось: ${e.message}`);
    }
  };

  const submit = async () => {
    if (!facade || !photoReady || !quad) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.compare(run.id, {
        facade: facade.id,
        uploadId: photo.kind === "upload" ? photo.uploadId : null,
        photoBlock: photo.kind === "passport" ? photo.block : null,
        quad,
        rect,
      });
      setCurrent(res);
      setHistory((h) => [res, ...h]);
      if (modelOn) review(res);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  // описание отличий моделью — через сервис chat; вердикт по цвету уже готов, модель только дополняет
  const [reviewing, setReviewing] = useState(null);
  const replace = (item) => {
    setHistory((h) => h.map((x) => (x.id === item.id ? item : x)));
    setCurrent((c) => (c && c.id === item.id ? item : c));
  };
  const review = async (item) => {
    setReviewing(item.id);
    try {
      replace(await api.reviewPhoto(run.id, item.id));
    } catch (e) {
      replace({ ...item, llm: { ...item.llm, error: e.message } });
    } finally {
      setReviewing(null);
    }
  };

  if (blocksError) return <p className="banner banner-error">Не удалось подготовить развёртки и фото: {blocksError}</p>;
  if (!blocks) return <p className="muted">Выделяю развёртки фасадов и фото фотофиксации…</p>;

  return (
    <div className="pc">
      <section className="pc-setup" aria-label="Что сравниваем">
        <div className="pc-step">
          <h3>
            <span className="pc-num">1</span>Развёртка, чертёж или фотомонтаж
          </h3>
          {blocks.facades.length === 0 ? (
            <p className="muted">В документе не найдены развёртки, чертежи фасадов или фотомонтаж.</p>
          ) : (
            <>
              <div className="pc-thumbs">
                {blocks.facades.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    className={`pc-thumb${f.id === facadeId ? " is-active" : ""}`}
                    onClick={() => {
                      setFacadeId(f.id);
                      setRect(null);
                    }}
                    aria-pressed={f.id === facadeId}
                  >
                    <img src={api.fileUrl(run.id, f.image)} alt={f.label} />
                    <span>{f.label}</span>
                  </button>
                ))}
              </div>
              {facade && <RectPicker src={api.fileUrl(run.id, facade.image)} size={facade.size} rect={rect} onChange={setRect} />}
            </>
          )}
        </div>

        <div className="pc-step">
          <h3>
            <span className="pc-num">2</span>Фото здания
          </h3>
          <label className="btn pc-upload">
            Загрузить фото или скрин с камеры
            <input type="file" accept="image/jpeg,image/png" onChange={(e) => chooseUpload(e.target.files[0])} hidden />
          </label>
          {blocks.photos.length > 0 && (
            <>
              <p className="pc-hint">или фото из пакета и фотофиксации документа:</p>
              <div className="pc-thumbs pc-thumbs-photo">
                {blocks.photos.map((b) => (
                  <button
                    key={b.id}
                    type="button"
                    className={`pc-thumb${photo && photo.block === b.id ? " is-active" : ""}`}
                    onClick={() => choosePassportPhoto(b)}
                    aria-pressed={Boolean(photo && photo.block === b.id)}
                  >
                    <img src={api.fileUrl(run.id, b.image)} alt={b.label} />
                    <span>{b.label}</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="pc-step pc-step-wide">
          <h3>
            <span className="pc-num">3</span>Углы фасада на фото
          </h3>
          {!photo ? (
            <p className="muted">Выберите фото — затем перетащите четыре точки на углы той же части фасада, что выбрана на развёртке.</p>
          ) : (
            <QuadPicker src={photo.url} natural={natural} quad={quad} onLoad={onPhotoLoad} onChange={setQuad} />
          )}
          <div className="pc-actions">
            <button type="button" className="btn btn-primary" disabled={!facade || !photoReady || !quad || busy} onClick={submit}>
              {busy ? "Сравниваю…" : "Сравнить"}
            </button>
            {photo && natural && (
              <>
                <button type="button" className="btn btn-quiet" onClick={autoCorners} disabled={!photoReady}>
                  Найти углы автоматически
                </button>
                <button type="button" className="btn btn-quiet" onClick={() => { setQuad(defaultQuad(natural[0], natural[1])); setHint(null); }}>
                  Сбросить углы
                </button>
              </>
            )}
            {hint && <span className="muted">{hint}</span>}
            {error && <span className="tone-text-error">{error}</span>}
          </div>
        </div>
      </section>

      {current && (
        <Result run={run} item={current} reviewing={reviewing === current.id} onReview={modelOn ? () => review(current) : null} />
      )}

      {history.length > 1 && (
        <section className="pc-history" aria-label="Предыдущие сравнения">
          <h3>Сравнения по этому паспорту</h3>
          <ul>
            {history.map((h) => {
              const v = PHOTO_VERDICT[h.result.verdict];
              return (
                <li key={h.id}>
                  <button type="button" className={`pc-hist${current && current.id === h.id ? " is-active" : ""}`} onClick={() => setCurrent(h)}>
                    <span className={`pc-dot tone-${v.tone}`} aria-hidden="true" />
                    <span>{v.title}</span>
                    <span className="muted">
                      {h.facade.label} ↔ {h.source.name}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}

function RectPicker({ src, size, rect, onChange }) {
  const svgRef = useRef(null);
  const [drag, setDrag] = useState(null);
  const [w, h] = size;
  const shown = drag || rect;

  const down = (e) => {
    const p = svgPoint(svgRef.current, e);
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag([p, p].map(([x, y]) => [x / w, y / h]));
  };
  const move = (e) => {
    if (!drag) return;
    const [x, y] = svgPoint(svgRef.current, e);
    setDrag([drag[0], [Math.min(1, Math.max(0, x / w)), Math.min(1, Math.max(0, y / h))]]);
  };
  const up = () => {
    if (!drag) return;
    const [[x0, y0], [x1, y1]] = drag;
    setDrag(null);
    if (Math.abs(x1 - x0) < 0.03 || Math.abs(y1 - y0) < 0.05) return; // щелчок — не выделение
    onChange([
      [Math.min(x0, x1), Math.min(y0, y1)],
      [Math.max(x0, x1), Math.max(y0, y1)],
    ]);
  };

  return (
    <div className="pc-rect">
      <div className="pc-canvas">
        <img src={src} alt="Выбранная развёртка" draggable="false" />
        <svg ref={svgRef} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" onPointerDown={down} onPointerMove={move} onPointerUp={up}>
          {shown && (
            <>
              <path
                className="pc-shade"
                fillRule="evenodd"
                d={`M0 0H${w}V${h}H0Z M${shown[0][0] * w} ${shown[0][1] * h}H${shown[1][0] * w}V${shown[1][1] * h}H${shown[0][0] * w}Z`}
              />
              <rect
                className="pc-sel"
                x={Math.min(shown[0][0], shown[1][0]) * w}
                y={Math.min(shown[0][1], shown[1][1]) * h}
                width={Math.abs(shown[1][0] - shown[0][0]) * w}
                height={Math.abs(shown[1][1] - shown[0][1]) * h}
              />
            </>
          )}
        </svg>
      </div>
      <p className="pc-hint">
        {rect ? "Сравнивается выделенная часть. " : "Сравнивается вся развёртка. "}
        Если на фото видна только часть фасада, выделите её рамкой.
        {rect && (
          <button type="button" className="btn btn-quiet btn-inline" onClick={() => onChange(null)}>
            Вся развёртка
          </button>
        )}
      </p>
    </div>
  );
}

function QuadPicker({ src, natural, quad, onLoad, onChange }) {
  const svgRef = useRef(null);
  const [active, setActive] = useState(null);
  const r = natural ? Math.max(natural[0], natural[1]) / 90 : 8;

  const move = (e) => {
    if (active == null || !natural) return;
    let [x, y] = svgPoint(svgRef.current, e);
    x = Math.min(natural[0], Math.max(0, x));
    y = Math.min(natural[1], Math.max(0, y));
    onChange(quad.map((p, i) => (i === active ? [x, y] : p)));
  };

  return (
    <div className="pc-canvas pc-quad">
      <img src={src} alt="Фото здания" draggable="false" onLoad={onLoad} />
      {natural && quad && (
        <svg
          ref={svgRef}
          viewBox={`0 0 ${natural[0]} ${natural[1]}`}
          preserveAspectRatio="none"
          onPointerMove={move}
          onPointerUp={() => setActive(null)}
          onPointerLeave={() => setActive(null)}
        >
          <polygon className="pc-poly" points={quad.map((p) => p.join(",")).join(" ")} />
          {quad.map(([x, y], i) => (
            <g key={i} className={`pc-handle${active === i ? " is-active" : ""}`}>
              <circle
                cx={x}
                cy={y}
                r={r}
                onPointerDown={(e) => {
                  e.currentTarget.setPointerCapture(e.pointerId);
                  setActive(i);
                }}
              >
                <title>{CORNERS[i]}</title>
              </circle>
              <text x={x + r * 1.4} y={y - r * 1.2} fontSize={r * 1.6}>
                {i + 1}
              </text>
            </g>
          ))}
        </svg>
      )}
    </div>
  );
}

function Result({ run, item, reviewing, onReview }) {
  const res = item.result;
  const v = PHOTO_VERDICT[res.verdict];
  const [copied, setCopied] = useState(false);
  const img = (k) => api.fileUrl(run.id, item.images[k]);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(item.conclusion);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  return (
    <section className="pc-result" aria-label="Результат сравнения">
      <div className={`stamp pc-stamp tone-${v.tone}`}>
        <div className="stamp-verdict">
          <span className="stamp-label">Фото ↔ развёртка</span>
          <strong>{v.title}</strong>
        </div>
        <dl className="stamp-grid">
          <div className="cell-wide">
            <dt>Развёртка</dt>
            <dd>{item.facade.label}</dd>
          </div>
          <div className="cell-wide cell-end">
            <dt>Фото</dt>
            <dd className="ellipsis" title={item.source.name}>
              {item.source.name}
            </dd>
          </div>
          <div className="cell-wide">
            <dt>Отличается</dt>
            <dd>
              {Math.round(res.diff_share * 100)} % сравниваемой площади, сравнивалось {Math.round(res.compared_share * 100)} % развёртки
            </dd>
          </div>
          <div className="cell-wide cell-end">
            <dt>Описание</dt>
            <dd>
              {reviewing ? "модель смотрит фото…" : item.llm.used ? `модель ${item.llm.model}` : "по шаблону, без модели"}
              {!reviewing && onReview && (
                <button type="button" className="btn btn-quiet pc-review-btn" onClick={onReview}>
                  {item.llm.used ? "описать заново" : "описать моделью"}
                </button>
              )}
            </dd>
          </div>
        </dl>
      </div>

      <div className="pc-triptych">
        <figure>
          <img src={img("drawing")} alt="Развёртка" />
          <figcaption>Развёртка</figcaption>
        </figure>
        <figure>
          <img src={img("photo_warped")} alt="Фото, приведённое к развёртке" />
          <figcaption>Фото, приведённое к плоскости развёртки</figcaption>
        </figure>
        <figure>
          <img src={img("diff_overlay")} alt="Карта отличий" />
          <figcaption>Отличия по цвету (остальное приглушено)</figcaption>
        </figure>
      </div>

      <div className="pc-details">
        <div>
          <h3>Отличия</h3>
          {res.differences.length === 0 ? (
            <p className="muted">По цвету отличий не найдено.</p>
          ) : (
            <ol className="pc-diffs">
              {res.differences.map((d, i) => (
                <li key={i}>
                  <span className="pc-diff-text">
                    {d.note}, {Math.round(d.share * 100)} % площади
                  </span>
                  <ColorPair expected={d.expected_hex} expectedLabel="развёртка" actual={d.photo_hex} actualLabel="фото" deltaE={d.delta_e} />
                </li>
              ))}
            </ol>
          )}
          {item.review && item.review.differences.length > 0 && (
            <>
              <h3>Модель заметила</h3>
              <ul className="pc-review">
                {item.review.differences.map((d, i) => (
                  <li key={i}>
                    <span className="pc-cat">{d.category}</span> {d.description}
                    {d.where && <span className="muted"> — {d.where}</span>}
                  </li>
                ))}
              </ul>
            </>
          )}
          {item.llm.error && <p className="muted">Модель не использована: {item.llm.error}</p>}
        </div>
        <div>
          <h3>Цветовые зоны развёртки</h3>
          <table className="pc-zones">
            <thead>
              <tr>
                <th>Развёртка ↔ фото</th>
                <th>Площадь</th>
                <th>Отличается</th>
              </tr>
            </thead>
            <tbody>
              {res.zones.map((z) => (
                <tr key={z.id} className={z.status === "mismatch" ? "is-bad" : ""}>
                  <td>
                    <ColorPair expected={z.hex} expectedLabel={z.ral ? `≈ ${z.ral}` : "развёртка"} actual={z.photo_hex} actualLabel="фото" deltaE={z.delta_e} />
                  </td>
                  <td>{Math.round(z.share * 100)} %</td>
                  <td>{Math.round(z.differs * 100)} %</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <section className="paper pc-paper">
        <header className="paper-head">
          <h2>Вывод</h2>
          <span className="paper-source">Вердикт выносит программа по цвету; модель только описывает отличия</span>
        </header>
        <div className="paper-text">{item.conclusion}</div>
        <footer className="paper-actions">
          <button type="button" className="btn btn-primary" onClick={copy}>
            {copied ? "Скопировано" : "Скопировать вывод"}
          </button>
          <a className="btn" href={api.fileUrl(run.id, `compare/${item.id}/result.json`)} target="_blank" rel="noreferrer">
            Результат JSON
          </a>
        </footer>
      </section>
    </section>
  );
}
