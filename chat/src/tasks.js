// Разовые задачи модели. Принцип прежний: модель только формулирует текст и описывает увиденное,
// вердикт и замечания считает код бэкенда. Результат сохраняется в бэкенд через его API.
import { backend } from "./backend.js";
import { llm, parseJson } from "./llm.js";

// ---------------------------------------------------------------- заключение

const CONCLUSION_SYSTEM =
  "Ты — эксперт, готовящий заключение по проверке документа: паспорта колористического решения фасадов " +
  "(ПП Москвы № 114-ПП) или дизайн-проекта размещения вывесок (ПП Москвы № 902-ПП) — вид документа указан " +
  "в сведениях (kind: passport или signage). Пиши официально-деловым стилем на русском языке, кратко (до 250 слов). " +
  "Используй ТОЛЬКО переданные факты и замечания, не добавляй новых, не меняй коды и номера пунктов. " +
  "Структура: 1) вывод (соответствует / требует доработки); 2) нумерованный перечень замечаний с указанием " +
  "листа и требования; 3) рекомендация. Без markdown-заголовков, без вступлений.";

/** Заключение моделью по результатам проверки (исключённые инспектором замечания не учитываются). */
export async function writeConclusion(checkId) {
  const run = await backend.check(checkId);
  if (run.state !== "done" || !run.report) throw new Error("Проверка ещё не завершена");
  const r = run.report;
  const compact = r.findings
    .filter((f) => !f.dismissed && (f.severity === "error" || f.severity === "warning"))
    .map((f) => ({
      правило: f.rule,
      важность: f.severity === "error" ? "ошибка" : "предупреждение",
      лист: f.page != null ? f.page + 1 : null,
      суть: f.message,
      основание: f.ref ?? null,
    }));
  const user =
    "Сведения о документе:\n" + JSON.stringify(r.summary, null, 1) + "\n\nЗамечания автоматической проверки:\n" + JSON.stringify(compact, null, 1);
  const { text, provider, model } = await llm.complete({ system: CONCLUSION_SYSTEM, user, maxTokens: 1500 });
  return backend.saveConclusion(checkId, { text, provider, model });
}

// ---------------------------------------------------------------- советы заявителю

const ADVICE_SYSTEM =
  "Ты помогаешь заявителю исправить документ до подачи в Москомархитектуру: паспорт колористического решения " +
  "фасадов (ПП Москвы № 114-ПП) или дизайн-проект размещения вывесок (ПП Москвы № 902-ПП). По замечаниям " +
  "автоматической проверки напиши, что исправить, простым языком, на русском. Используй ТОЛЬКО переданные " +
  "замечания, не добавляй новых, не меняй номера листов и пунктов. Сначала ошибки, потом предупреждения. " +
  "Формат: нумерованный список «что сделать — где (лист) — почему (пункт НПА)», до 200 слов, без вступлений " +
  "и без markdown-заголовков. Если замечаний нет — одна фраза, что документ можно подавать.";

/** Что исправить перед подачей: текст для заявителя; в бэкенд не сохраняется. */
export async function writeAdvice(checkId) {
  const run = await backend.check(checkId);
  if (run.state !== "done" || !run.report) throw new Error("Проверка ещё не завершена");
  const r = run.report;
  const compact = r.findings
    .filter((f) => f.severity === "error" || f.severity === "warning")
    .map((f) => ({
      важность: f.severity === "error" ? "ошибка" : "предупреждение",
      лист: f.page != null ? f.page + 1 : null,
      суть: f.message,
      основание: f.ref ?? null,
    }));
  const user = "Замечания автоматической проверки:\n" + JSON.stringify(compact, null, 1);
  const { text, provider, model } = await llm.complete({ system: ADVICE_SYSTEM, user, maxTokens: 1200 });
  return { text, provider, model };
}

// ---------------------------------------------------------------- описание отличий на фото

const PHOTO_CATEGORIES = ["цвет", "вывеска или реклама", "окна и двери", "навесное оборудование", "архитектурные элементы", "другое"];

const PHOTO_SYSTEM =
  "Ты — инспектор, который сверяет фото здания с утверждённой развёрткой фасада из паспорта колористического " +
  "решения (ПП Москвы № 114-ПП, вывески — № 902-ПП). Изображение 1 — развёртка (чертёж), изображение 2 — фото, " +
  "приведённое к плоскости развёртки, изображение 3 — карта отличий по цвету, найденных программой (отличия " +
  "в цвете, остальное приглушено, номера в синих рамках). Опиши, чем фасад на фото отличается от развёртки: цвет " +
  "поверхностей, вывески и реклама, окна и двери, кондиционеры и другое навесное оборудование, архитектурные " +
  "элементы. Не описывай людей, машины, деревья, погоду, отражения в стёклах и водяные знаки. Пиши только то, " +
  "что видно; если отличий нет — пустой список. Отвечай строго JSON по схеме, по-русски.";

const PHOTO_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    same_facade: { type: "boolean" },
    differences: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          category: { type: "string", enum: PHOTO_CATEGORIES },
          description: { type: "string" },
          where: { type: "string" },
        },
        required: ["category", "description", "where"],
      },
    },
    summary: { type: "string" },
  },
  required: ["same_facade", "differences", "summary"],
};

/** Описание отличий мультимодальной моделью; бэкенд сохраняет его и сам решает, менять ли вердикт. */
export async function reviewPhoto(checkId, cid) {
  const { comparisons = [] } = await backend.comparisons(checkId);
  const item = comparisons.find((c) => c.id === cid);
  if (!item) throw Object.assign(new Error(`Сравнения ${cid} нет`), { status: 404 });
  const images = await Promise.all(
    ["drawing", "photo_warped", "diff_overlay"].map((k) => backend.fileBase64(checkId, item.images?.[k] || `compare/${cid}/${k}.png`)),
  );
  const found = (item.result?.differences || []).map((d, i) => ({
    "№": i + 1,
    "на фото": d.photo_hex,
    "по развёртке": d.expected_hex,
    ΔE00: d.delta_e,
    "доля площади, %": Math.round((d.share || 0) * 1000) / 10,
    суть: d.note,
  }));
  const user =
    "Отличия по цвету, найденные программой (номера совпадают с картой отличий):\n" +
    JSON.stringify(found, null, 1) +
    "\n\nПроверь их по изображениям и добавь отличия, которые программа по цвету не находит " +
    "(вывески, навесное оборудование, изменённые проёмы). summary — 2–4 предложения для инспектора.";
  try {
    const { text, provider, model } = await llm.complete({ system: PHOTO_SYSTEM, user, images, schema: PHOTO_SCHEMA, maxTokens: 1500 });
    return backend.saveReview(checkId, cid, { review: parseJson(text), provider, model });
  } catch (err) {
    if (err.status) throw err; // ошибка бэкенда — не модели
    console.warn("chat: описание фото не получено:", err.message);
    return backend.saveReview(checkId, cid, { review: null, error: err.message });
  }
}
