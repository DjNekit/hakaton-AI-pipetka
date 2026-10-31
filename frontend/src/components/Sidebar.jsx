import { useRef, useState } from "react";
import { formatTime, packageStatus, plural } from "../format.js";

const ACCEPT = "application/pdf,.pdf,image/jpeg,image/png,.jpg,.jpeg,.png";
const isAccepted = (f) => /\.(pdf|jpe?g|png)$/i.test(f.name) || ["application/pdf", "image/jpeg", "image/png"].includes(f.type);

// Новый пакет: документы одной заявки (PDF паспорта, дизайн-проекта вывесок) и фото объекта — проверяются вместе.
export default function Sidebar({ packages, currentId, uploading, onUpload, onOpen }) {
  const inputRef = useRef(null);
  const [drag, setDrag] = useState(false);
  const [files, setFiles] = useState([]);
  const [title, setTitle] = useState("");

  const add = (list) => {
    const picked = Array.from(list || []).filter(isAccepted);
    setFiles((prev) => [...prev, ...picked.filter((f) => !prev.some((p) => p.name === f.name && p.size === f.size))]);
  };
  const remove = (i) => setFiles((prev) => prev.filter((_, j) => j !== i));
  const pdfs = files.filter((f) => /\.pdf$/i.test(f.name) || f.type === "application/pdf").length;

  const submit = async () => {
    if (!pdfs || uploading) return;
    await onUpload(files, title);
    setFiles([]);
    setTitle("");
  };

  return (
    <aside className="sidebar" aria-label="Пакеты документов">
      <section className="side-block">
        <h2 className="side-title">Новый пакет</h2>
        <div
          className={`dropzone${drag ? " is-drag" : ""}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDrag(false);
            add(e.dataTransfer.files);
          }}
        >
          <p>Перетащите документы заявки: PDF паспорта, дизайн-проекта вывесок и фото фасада (JPEG, PNG)</p>
          <button type="button" className="btn" onClick={() => inputRef.current && inputRef.current.click()}>
            Выбрать файлы
          </button>
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPT}
            multiple
            hidden
            onChange={(e) => {
              add(e.target.files);
              e.target.value = "";
            }}
          />
        </div>
        {files.length > 0 && (
          <div className="pkg-draft">
            <ul className="pkg-files">
              {files.map((f, i) => (
                <li key={`${f.name}-${i}`}>
                  <span className="pkg-file-kind">{/\.pdf$/i.test(f.name) ? "PDF" : "фото"}</span>
                  <span className="pkg-file-name" title={f.name}>
                    {f.name}
                  </span>
                  <button type="button" className="pkg-file-remove" onClick={() => remove(i)} aria-label={`Убрать ${f.name}`}>
                    ×
                  </button>
                </li>
              ))}
            </ul>
            <input
              className="pkg-title"
              type="text"
              placeholder="Название заявки (необязательно)"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
            <button type="button" className="btn btn-primary" disabled={!pdfs || Boolean(uploading)} onClick={submit}>
              {uploading || `Проверить пакет: ${pdfs} ${plural(pdfs, "документ", "документа", "документов")}`}
            </button>
            {!pdfs && <p className="muted">Добавьте хотя бы один PDF-документ</p>}
          </div>
        )}
      </section>

      {packages.length > 0 && (
        <section className="side-block">
          <h2 className="side-title">Журнал пакетов</h2>
          <ul className="run-list">
            {packages.slice(0, 30).map((p) => {
              const status = packageStatus(p);
              const n = (p.documents || []).length;
              return (
                <li key={p.id}>
                  <button
                    type="button"
                    className={`run${p.id === currentId ? " is-current" : ""}`}
                    onClick={() => onOpen(p.id)}
                    aria-current={p.id === currentId ? "page" : undefined}
                  >
                    <span className={`run-mark tone-${status.tone}`} aria-hidden="true" />
                    <span className="run-file">{p.title}</span>
                    <span className="run-meta">
                      {status.short}, {n} {plural(n, "документ", "документа", "документов")}
                      <time>{formatTime(p.created_at)}</time>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </aside>
  );
}
