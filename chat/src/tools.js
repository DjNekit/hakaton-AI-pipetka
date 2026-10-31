// Инструменты модели. Серверные — читают данные проверки из основного бэкенда (только чтение).
// Клиентские — выполняет браузер: показать замечание, лист, вкладку. Здесь только их описания;
// реализации — frontend/src/chat/tools.js (имена и схемы должны совпадать).
import { toolDefinition } from "@tanstack/ai";
import { z } from "zod";
import { backend, rulesIndex } from "./backend.js";

const TABS = ["findings", "sheets", "table", "explication", "checklist", "conclusion", "photo"];

const pick = (obj, keys) => Object.fromEntries(keys.filter((k) => obj[k] !== undefined).map((k) => [k, obj[k]]));

function brief(f) {
  return {
    ...pick(f, ["id", "rule", "severity", "title", "message", "element", "expected", "actual", "delta_e", "ref"]),
    page_index: f.page ?? null,
    dismissed: Boolean(f.dismissed),
  };
}

/** Загружает проверку один раз на ответ модели — инструменты в одном ответе видят одни и те же данные. */
export function makeCheckLoader(checkId) {
  let pending = null;
  return () => {
    if (!pending) {
      pending = backend.check(checkId).then((run) => {
        if (run.state !== "done" || !run.report) throw new Error(`Проверка ${checkId} ещё не завершена (${run.stage || run.state})`);
        return run;
      });
      pending.catch(() => (pending = null));
    }
    return pending;
  };
}

/** Короткая сводка для системного промпта: модель знает, о каком документе речь, ещё до вызова инструментов. */
export function overview(run) {
  const r = run.report;
  const s = r.summary || {};
  const active = r.findings.filter((f) => !f.dismissed);
  return {
    check_id: run.id,
    file: run.file,
    document_kind: r.document_kind === "signage" ? "дизайн-проект вывесок (902-ПП)" : "паспорт колористического решения (114-ПП)",
    verdict: r.verdict,
    errors: active.filter((f) => f.severity === "error").length,
    warnings: active.filter((f) => f.severity === "warning").length,
    dismissed: r.findings.length - active.length,
    address: s.address || null,
    object: s.object || null,
    number: s.number || null,
    date: s.date || null,
    pages: r.pages.length,
    decision: run.decision || null,
  };
}

export function serverTools(loadCheck, checkId) {
  const getDocument = toolDefinition({
    name: "get_document",
    description:
      "Сведения о документе: адрес, объект, разработчик, общие сведения паспорта, список листов (page_index, номер, тип, замечания на листе), " +
      "заключение по проверке, решение инспектора.",
    inputSchema: z.object({}),
  }).server(async () => {
    const run = await loadCheck();
    const r = run.report;
    return {
      ...overview(run),
      summary: r.summary,
      general: r.passport?.general ?? null,
      pages: r.pages.map((p) => ({ page_index: p.index, number: p.number, kind: p.kind_title, scan: p.is_scan, findings: p.findings })),
      conclusion: r.conclusion?.text ?? null,
      decision_note: run.decision_note ?? null,
    };
  });

  const getFindings = toolDefinition({
    name: "get_findings",
    description: "Список замечаний проверки. Можно отфильтровать по важности и по листу. Исключённые инспектором замечания по умолчанию не возвращаются.",
    inputSchema: z.object({
      severity: z.enum(["error", "warning", "info", "all"]).optional().describe("error — нарушения, warning — предупреждения; по умолчанию all"),
      page_index: z.number().int().optional().describe("индекс листа (page_index из get_document)"),
      include_dismissed: z.boolean().optional().describe("вернуть и исключённые инспектором замечания"),
    }),
  }).server(async ({ severity = "all", page_index, include_dismissed = false }) => {
    const run = await loadCheck();
    const items = run.report.findings
      .filter((f) => include_dismissed || !f.dismissed)
      .filter((f) => severity === "all" || f.severity === severity)
      .filter((f) => page_index == null || f.page === page_index)
      .map(brief);
    return { count: items.length, findings: items };
  });

  const getFinding = toolDefinition({
    name: "get_finding",
    description: "Одно замечание целиком (по id, например F001): что ожидалось, что найдено, ΔE, ссылка на норму, описание правила.",
    inputSchema: z.object({ finding_id: z.string().describe("id замечания, например F001") }),
  }).server(async ({ finding_id }) => {
    const run = await loadCheck();
    const f = run.report.findings.find((x) => x.id.toLowerCase() === finding_id.trim().toLowerCase());
    if (!f) return { error: `Замечания ${finding_id} нет. Есть: ${run.report.findings.map((x) => x.id).join(", ")}` };
    const rules = await rulesIndex();
    return { ...brief(f), evidence: f.evidence ?? null, rule_info: rules[f.rule] ?? null };
  });

  const getChecklist = toolDefinition({
    name: "get_checklist",
    description: "Чек-лист проверки по правилам: какие требования выполнены (ok), нарушены (fail), под вопросом (warn), неприменимы (skip).",
    inputSchema: z.object({
      status: z.enum(["ok", "fail", "warn", "skip", "all"]).optional().describe("фильтр по статусу; по умолчанию all"),
    }),
  }).server(async ({ status = "all" }) => {
    const run = await loadCheck();
    const items = run.report.checklist
      .filter((c) => status === "all" || c.status === status)
      .map((c) => pick(c, ["rule", "title", "category_title", "status", "note", "ref", "findings"]));
    return { count: items.length, items };
  });

  const getRule = toolDefinition({
    name: "get_rule",
    description: "Описание правила проверки по коду (например TAB-02, SGN-05): название, ссылка на НПА, важность, результат в этой проверке.",
    inputSchema: z.object({ rule_id: z.string().describe("код правила, например TAB-02") }),
  }).server(async ({ rule_id }) => {
    const id = rule_id.trim().toUpperCase();
    const rules = await rulesIndex();
    if (!rules[id]) return { error: `Правила ${id} нет. Есть: ${Object.keys(rules).join(", ")}` };
    const run = await loadCheck();
    const item = run.report.checklist.find((c) => c.rule === id);
    return { id, ...rules[id], in_this_check: item ? pick(item, ["status", "note", "findings"]) : "не применялось" };
  });

  const getTable = toolDefinition({
    name: "get_table",
    description:
      "Для паспорта — таблица отделки (элементы фасада, материалы, коды цвета RAL/NCS); для дизайн-проекта вывесок — экспликация вывесок. " +
      "query — поиск по названию, материалу или коду цвета.",
    inputSchema: z.object({ query: z.string().optional().describe("подстрока для поиска, например «цоколь» или «7035»") }),
  }).server(async ({ query }) => {
    const run = await loadCheck();
    const r = run.report;
    const q = (query || "").trim().toLowerCase();
    const match = (row) => !q || JSON.stringify(row).toLowerCase().includes(q);
    if (r.document_kind === "signage") {
      const rows = (r.signage?.rows || []).filter(match);
      return { kind: "экспликация вывесок", count: rows.length, rows: rows.slice(0, 40) };
    }
    const byNumber = Object.fromEntries(r.pages.map((p) => [p.number, p.index]));
    const rows = (r.passport?.finish_table || []).filter(match).map((row) => ({
      n: row.n,
      group: row.group,
      name: row.name,
      material: row.material,
      colors: row.marks?.raw || [...(row.marks?.ral || []), ...(row.marks?.ncs || [])].join(", ") || null,
      page_number: row.page,
      page_index: byNumber[row.page] ?? null,
    }));
    return { kind: "таблица отделки", count: rows.length, rows: rows.slice(0, 40), truncated: rows.length > 40 };
  });

  const getComparisons = toolDefinition({
    name: "get_photo_comparisons",
    description: "Результаты сравнения фото здания с развёрткой фасада: какой фасад, вердикт (match/mismatch/attention), доля отличий, вывод.",
    inputSchema: z.object({}),
  }).server(async () => {
    const data = await backend.comparisons(checkId);
    const items = (data.comparisons || []).map((c) => ({
      id: c.id,
      created_at: c.created_at,
      facade: c.facade?.label,
      photo: c.source?.name,
      verdict: c.result?.verdict,
      diff_share: c.result?.diff_share,
      conclusion: c.conclusion,
    }));
    return { count: items.length, comparisons: items };
  });

  return [getDocument, getFindings, getFinding, getChecklist, getRule, getTable, getComparisons];
}

// ---------------------------------------------------------------- клиентские инструменты (выполняет браузер)

export const showFindingDef = toolDefinition({
  name: "show_finding",
  description: "Показать пользователю замечание: открыть вкладку «Замечания», выделить его и лист, на котором оно отмечено.",
  inputSchema: z.object({ finding_id: z.string().describe("id замечания, например F001") }),
});

export const showPageDef = toolDefinition({
  name: "show_page",
  description: "Открыть лист документа на вкладке «Листы».",
  inputSchema: z.object({ page_index: z.number().int().describe("индекс листа (page_index)") }),
});

export const openTabDef = toolDefinition({
  name: "open_tab",
  description:
    "Открыть вкладку отчёта: findings — замечания, sheets — листы, table — таблица отделки, explication — экспликация вывесок, " +
    "checklist — чек-лист, conclusion — заключение, photo — сравнение с фото.",
  inputSchema: z.object({ tab: z.enum(TABS) }),
});

export const clientToolDefs = [showFindingDef, showPageDef, openTabDef];
