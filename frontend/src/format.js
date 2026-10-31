export const VERDICT = {
  pass: { title: "Соответствует требованиям", short: "Соответствует", tone: "ok" },
  warn: { title: "Есть предупреждения", short: "Предупреждения", tone: "warn" },
  fail: { title: "Требует доработки", short: "Требует доработки", tone: "error" },
};

export const STATUS = {
  ok: { label: "Пройдено", tone: "ok" },
  warn: { label: "Предупреждение", tone: "warn" },
  fail: { label: "Нарушение", tone: "error" },
  skip: { label: "Не применимо", tone: "muted" },
};

export const DECISION = {
  accepted: { label: "Проверен и принят", short: "Принят", tone: "ok" },
  rejected: { label: "Проверен и отклонён", short: "Отклонён", tone: "error" },
};

export function runStatus(run) {
  if (run.archived_at) return { label: "В архиве", short: "Архив", tone: "muted" };
  if (run.decision && DECISION[run.decision]) return DECISION[run.decision];
  if (run.state === "error") return { label: "ошибка", short: "ошибка", tone: "error" };
  if (run.state !== "done") return { label: "идёт проверка", short: "идёт проверка", tone: "muted" };
  const verdict = VERDICT[run.verdict] || { title: "", short: "", tone: "muted" };
  return { label: verdict.short, short: verdict.short, tone: verdict.tone };
}

export const SEVERITY = {
  error: { label: "Ошибка", tone: "error" },
  warning: { label: "Предупреждение", tone: "warn" },
  info: { label: "Сведения", tone: "muted" },
};

export function plural(n, one, few, many) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

export function formatTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export function formatDate(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export function sampleTitle(name) {
  // «04_swatch_A» → «04 swatch A»
  return (name || "").replace(/_/g, " ");
}

export const RULE_HINTS = {
  "CMP-01": "разделы I–V",
  "CMP-02": "все фасады",
  "GEN-01": "общие сведения",
  "GEN-02": "адрес",
  "GRF-01": "штампы",
  "GRF-02": "масштаб",
  "GRF-03": "остекление",
  "GRF-04": "отметки, реклама",
  "GRF-05": "dpi сканов",
  "TAB-01": "NCS и RAL",
  "TAB-02": "коды RAL",
  "TAB-03": "коды NCS",
  "TAB-04": "пары NCS–RAL",
  "TAB-05": "образцы цвета",
  "TAB-06": "материалы",
  "TXT-01": "записка ↔ таблица",
  "DRW-01": "зоны ↔ таблица",
  "DRW-02": "лишние цвета",
  "DRW-03": "выноски",
};
