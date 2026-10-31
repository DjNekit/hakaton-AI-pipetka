// Тонкий клиент API: бэкенд (Django: пакеты, отчёты, решения — backend/api/urls.py), сервис checker
// (файлы: загрузка, листы, развёртки — checker/worker/fileserver.py) и сервис chat (модели — chat/src/server.js)
const BASE = "/api";
const CHAT = "/chat";
const FILES = "/files";

const json = (method, body) => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

async function request(path, options = {}, base = BASE) {
  const res = await fetch(base + path, options);
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { detail: text };
  }
  if (!res.ok) {
    const msg = (data && (data.detail || data.error)) || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data;
}

export const api = {
  health: () => request("/health"),
  rules: () => request("/rules"),
  samples: () => request("/samples").then((d) => d.samples),

  // пакет документов одной заявки: файлы загружаются в checker, пакет создаёт бэкенд и ставит в очередь
  uploadFiles: (files) => {
    const fd = new FormData();
    for (const f of files) fd.append("files", f, f.name);
    return request("/uploads", { method: "POST", body: fd }, FILES);
  },
  createPackage: ({ uploads = [], samples = [], title = "", service_type = null }) => request("/packages", json("POST", { uploads, samples, title, service_type })),
  inspectUploads: uploads => request("/uploads/inspect", json("POST", { uploads })),
  packages: () => request("/packages").then((d) => d.packages),
  packageLocations: id => request(`/packages/${encodeURIComponent(id)}/locations`),
  package: (id) => request(`/packages/${id}`),
  packageChecklistReview: (id) => request(`/packages/${encodeURIComponent(id)}/checklist-review`).then(d => d.review),
  checkSample: (name) => request(`/samples/${name}/check`, { method: "POST" }),

  // документ пакета
  check: (id) => request(`/checks/${id}`),
  changeFindingStatus: (id, findingId, action, reason = "") =>
    request(`/checks/${id}/change_status`, json("POST", { finding_id: findingId, action, reason })),
  setDecision: (id, decision, note = "") => request(`/checks/${id}/decision`, json("POST", { decision, note })),

  // сравнение фото с развёрткой (фото — загрузка в checker или фото из документа/пакета)
  blocks: (id) => request(`/checks/${id}/blocks`),
  comparisons: (id) => request(`/checks/${id}/comparisons`).then((d) => d.comparisons),
  compare: (id, { facade, uploadId, photoBlock, quad, rect }) =>
    request(`/checks/${id}/comparisons`, json("POST", {
      facade,
      upload_id: uploadId || null,
      photo_block: photoBlock || null,
      quad: quad.map(([x, y]) => [Math.round(x * 10) / 10, Math.round(y * 10) / 10]),
      rect: rect || null,
    })),
  corners: (id, { uploadId, photoBlock }) =>
    request(`/checks/${id}/corners`, json("POST", { upload_id: uploadId || null, photo_block: photoBlock || null })),

  // языковые модели — сервис chat: он сам берёт данные из бэкенда и сохраняет туда результат
  modelHealth: () => request("/health", {}, CHAT).then((d) => d.llm),
  writeConclusion: (id) => request(`/checks/${id}/conclusion`, { method: "POST" }, CHAT),
  reviewPhoto: (id, cid) => request(`/checks/${id}/comparisons/${cid}/review`, { method: "POST" }, CHAT),

  // ссылки
  fileUrl: (id, rel) => `${FILES}/${id}/${rel}`,
  reportJsonUrl: (id) => `${BASE}/checks/${id}/report.json`,
  conclusionMdUrl: (id) => `${BASE}/checks/${id}/conclusion.md`,
  exportExcelUrl: (id) => `${BASE}/checks/${id}/export.xlsx`,
  samplePdfUrl: (name) => `${FILES}/samples/${name}.pdf`,
};
