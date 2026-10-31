// Тонкий клиент API: бэкенд (Django, правила — backend/api/urls.py) и сервис chat (языковые модели — chat/src/server.js)
const BASE = "/api";
const CHAT = "/chat";

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
  checks: () => request("/checks").then((d) => d.checks),
  check: (id) => request(`/checks/${id}`),
  checkSample: (name) => request(`/samples/${name}/check`, { method: "POST" }),
  upload: (file) => {
    const fd = new FormData();
    fd.append("file", file);
    return request("/checks", { method: "POST", body: fd });
  },
  blocks: (id) => request(`/checks/${id}/blocks`),
  comparisons: (id) => request(`/checks/${id}/comparisons`).then((d) => d.comparisons),
  compare: (id, { facade, photo, photoBlock, quad, rect }) => {
    const fd = new FormData();
    fd.append("facade", facade);
    if (photo) fd.append("photo", photo);
    if (photoBlock) fd.append("photo_block", photoBlock);
    fd.append("quad", JSON.stringify(quad.map(([x, y]) => [Math.round(x * 10) / 10, Math.round(y * 10) / 10])));
    if (rect) fd.append("rect", JSON.stringify(rect));
    return request(`/checks/${id}/comparisons`, { method: "POST", body: fd });
  },
  corners: (id, { photo, photoBlock }) => {
    const fd = new FormData();
    if (photo) fd.append("photo", photo);
    if (photoBlock) fd.append("photo_block", photoBlock);
    return request(`/checks/${id}/corners`, { method: "POST", body: fd });
  },
  changeFindingStatus: (id, findingId, action, reason = "") => {
    const fd = new FormData();
    fd.append("finding_id", findingId);
    fd.append("action", action);
    if (reason) fd.append("reason", reason);
    return request(`/checks/${id}/change_status`, { method: "POST", body: fd });
  },
  setDecision: (id, decision, note = "") => {
    const fd = new FormData();
    fd.append("decision", decision);
    if (note) fd.append("note", note);
    return request(`/checks/${id}/decision`, { method: "POST", body: fd });
  },
  // языковые модели — сервис chat: он сам берёт данные из бэкенда и сохраняет туда результат
  modelHealth: () => request("/health", {}, CHAT).then((d) => d.llm),
  writeConclusion: (id) => request(`/checks/${id}/conclusion`, { method: "POST" }, CHAT),
  reviewPhoto: (id, cid) => request(`/checks/${id}/comparisons/${cid}/review`, { method: "POST" }, CHAT),
  fileUrl: (id, rel) => `${BASE}/checks/${id}/files/${rel}`,
  exportExcelUrl: (id) => `${BASE}/checks/${id}/export.xlsx`,
  samplePdfUrl: (name) => `${BASE}/samples/${name}/pdf`,
};
