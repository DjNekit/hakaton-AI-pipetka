/** Короткая сводка проверки. */
function overview(run) {
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

const TAB_TITLES = {
  findings: "Замечания",
  sheets: "Листы",
  table: "Таблица отделки",
  explication: "Экспликация",
  checklist: "Чек-лист",
  conclusion: "Заключение",
  photo: "Сравнение с фото",
};

/** Системный промпт: роль, правила, данные проверки (замечания, чек-лист, заключение) и что пользователь видит
 *  на экране. Инструментов у GigaChat в TanStack AI нет — всё нужное передаётся здесь. */
export function systemPrompt(run, ui) {
  const r = run.report;
  const active = r.findings.filter((f) => !f.dismissed);
  const lines = [
    "Ты — помощник инспектора Москомархитектуры в сервисе «Колорпаспорт». Сервис проверяет паспорта колористических решений",
    "фасадов (ПП Москвы № 114-ПП) и дизайн-проекты вывесок (№ 902-ПП) и сравнивает фото зданий с чертежами.",
    "",
    "Правила:",
    "- Отвечай по-русски, коротко и по делу. Пользователь — инспектор, а не программист.",
    "- Факты бери только из данных проверки ниже. Не выдумывай замечаний, кодов цвета, номеров листов и пунктов НПА.",
    "- Вердикт и замечания посчитаны программой по правилам. Ты их объясняешь, но не меняешь и не отменяешь.",
    "  Если пользователь не согласен с замечанием, объясни, на чём оно основано, и подскажи, что исключить его может инспектор кнопкой в списке замечаний.",
    "- Называй замечания по id (F001) и правила по коду (TAB-02), ссылайся на пункт НПА из поля ref.",
    "  Пользователь может нажать на id замечания в ответе и увидеть его на листе.",
    "- Если данных нет, так и скажи.",
    "",
    "Текущая проверка:",
    JSON.stringify(overview(run), null, 0),
    "",
    "Замечания (page_index — индекс листа):",
    JSON.stringify(active.map((f) => ({ id: f.id, rule: f.rule, severity: f.severity, message: f.message, page_index: f.page, ref: f.ref }))),
    "",
    "Чек-лист — нарушенные и спорные требования:",
    JSON.stringify(r.checklist.filter((c) => c.status === "fail" || c.status === "warn").map((c) => ({ rule: c.rule, title: c.title, status: c.status, ref: c.ref }))),
    "",
    "Заключение по проверке:",
    r.conclusion?.text || "—",
  ];
  if (ui && typeof ui === "object") {
    const tab = TAB_TITLES[ui.tab] || ui.tab;
    const parts = [];
    if (tab) parts.push(`открыта вкладка «${tab}»`);
    if (ui.selected) parts.push(`выделено замечание ${ui.selected}`);
    if (ui.page != null) parts.push(`открыт лист page_index=${ui.page}`);
    if (parts.length) lines.push("", `На экране у пользователя: ${parts.join(", ")}. «Это замечание», «этот лист» — про них.`);
  }
  return lines.join("\n");
}
