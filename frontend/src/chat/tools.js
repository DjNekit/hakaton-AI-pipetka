// Клиентские инструменты чата: модель просит — браузер показывает. Имена и схемы совпадают с описаниями
// на сервере чата (chat/src/tools.js), реализация — здесь: она управляет отчётом через переданные функции.
import { toolDefinition } from "@tanstack/ai";
import { z } from "zod";

export const TABS = ["findings", "sheets", "table", "explication", "checklist", "conclusion", "photo"];

const showFindingDef = toolDefinition({
  name: "show_finding",
  description: "Показать замечание на листе",
  inputSchema: z.object({ finding_id: z.string() }),
});

const showPageDef = toolDefinition({
  name: "show_page",
  description: "Открыть лист документа",
  inputSchema: z.object({ page_index: z.number().int() }),
});

const openTabDef = toolDefinition({
  name: "open_tab",
  description: "Открыть вкладку отчёта",
  inputSchema: z.object({ tab: z.enum(TABS) }),
});

/** handlersRef.current = { showFinding(id) → bool, showPage(index) → bool, openTab(tab) → bool } — из отчёта. */
export function makeClientTools(handlersRef) {
  return [
    showFindingDef.client(({ finding_id }) => ({ shown: Boolean(handlersRef.current.showFinding(finding_id)) })),
    showPageDef.client(({ page_index }) => ({ shown: Boolean(handlersRef.current.showPage(page_index)) })),
    openTabDef.client(({ tab }) => ({ opened: Boolean(handlersRef.current.openTab(tab)) })),
  ];
}

export const TOOL_LABELS = {
  get_document: "Смотрю сведения о документе",
  get_findings: "Смотрю замечания",
  get_finding: "Разбираю замечание",
  get_checklist: "Смотрю чек-лист",
  get_rule: "Смотрю правило",
  get_table: "Смотрю таблицу",
  get_photo_comparisons: "Смотрю сравнения с фото",
  show_finding: "Показываю замечание",
  show_page: "Открываю лист",
  open_tab: "Открываю вкладку",
};
