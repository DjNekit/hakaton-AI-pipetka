// Тонкий клиент REST API бэкенда (Django: backend/api/urls.py)
const BASE = "/api";

async function request(path, options = {}) {
  const res = await fetch(BASE + path, options);
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
  checkSample: (name, llm) => request(`/samples/${name}/check?llm=${llm ? 1 : 0}`, { method: "POST" }),
  upload: (file, llm) => {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("llm", llm ? "1" : "0");
    return request("/checks", { method: "POST", body: fd });
  },
  blocks: (id) => request(`/checks/${id}/blocks`),
  comparisons: (id) => request(`/checks/${id}/comparisons`).then((d) => d.comparisons),
  compare: (id, { facade, photo, photoBlock, quad, rect, llm }) => {
    const fd = new FormData();
    fd.append("facade", facade);
    if (photo) fd.append("photo", photo);
    if (photoBlock) fd.append("photo_block", photoBlock);
    fd.append("quad", JSON.stringify(quad.map(([x, y]) => [Math.round(x * 10) / 10, Math.round(y * 10) / 10])));
    if (rect) fd.append("rect", JSON.stringify(rect));
    fd.append("llm", llm ? "1" : "0");
    return request(`/checks/${id}/comparisons`, { method: "POST", body: fd });
  },
  corners: (id, { photo, photoBlock }) => {
    const fd = new FormData();
    if (photo) fd.append("photo", photo);
    if (photoBlock) fd.append("photo_block", photoBlock);
    return request(`/checks/${id}/corners`, { method: "POST", body: fd });
  },
  fileUrl: (id, rel) => `${BASE}/checks/${id}/files/${rel}`,
  samplePdfUrl: (name) => `${BASE}/samples/${name}/pdf`,
};
