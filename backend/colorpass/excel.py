"""Выгрузка результатов проверки в Excel (XLSX) без внешних зависимостей."""
from __future__ import annotations

import re
from datetime import datetime, timezone
from io import BytesIO
from pathlib import Path
from xml.sax.saxutils import escape
from zipfile import ZIP_DEFLATED, ZipFile

_STATUS_PASS = "Пройдено"
_STATUS_WARN = "Пройдено (с предупреждением)"
_STATUS_FAIL = "Не пройдено"
_STATUS_SKIP = "Не применимо"
_VERDICT = {
    "pass": "Соответствует требованиям",
    "warn": "Есть предупреждения",
    "fail": "Требует доработки",
}


def report_filename(report: dict, source_name: str = "") -> str:
    summary = report.get("summary") or {}
    if summary.get("kind") == "signage":
        base = summary.get("object") or Path(source_name or report.get("file") or "проект").stem
        base = f"Проект {base}" if base else "Проект"
    else:
        number = str(summary.get("number") or "").strip()
        if number:
            base = f"Паспорт {number}"
        else:
            stem = Path(source_name or report.get("file") or "паспорт").stem
            base = "Паспорт" if stem.lower() in ("", "input") else f"Паспорт {stem}"
    stamp = datetime.now().astimezone().strftime("%Y-%m-%d_%H-%M-%S")
    return f"{_safe_name(base)}_{stamp}.xlsx"


def build_report_xlsx(report: dict, source_name: str = "") -> bytes:
    rows: list[dict] = []
    merges: list[str] = []

    def add(cells: list[tuple[str, int]], merge: bool = False, height: float | None = None) -> int:
        number = len(rows) + 1
        rows.append({"cells": cells, "height": height})
        if merge:
            merges.append(f"A{number}:D{number}")
        return number

    summary = report.get("summary") or {}
    conclusion = report.get("conclusion") or {}
    llm = report.get("llm") or {}
    verdict = _VERDICT.get(report.get("verdict"), str(report.get("verdict") or "—"))

    add([(_document_title(report), 1)], merge=True, height=24)
    if summary.get("address"):
        add([(f"Адрес: {summary['address']}", 0)], merge=True)
    meta = [f"Файл: {source_name or report.get('file') or '—'}", f"Вердикт: {verdict}"]
    if report.get("created_at"):
        meta.append(f"Проверка: {report['created_at']}")
    add([(" · ".join(meta), 0)], merge=True)
    add([])

    add(
        [
            ("Правило", 2),
            ("Текст правила", 2),
            ("Результат проверки", 2),
            ("Где найдена ошибка", 2),
        ],
        height=32,
    )

    findings_by_rule: dict[str, list[dict]] = {}
    for finding in report.get("findings") or []:
        if finding.get("dismissed"):
            continue
        findings_by_rule.setdefault(finding.get("rule"), []).append(finding)

    for item in report.get("checklist") or []:
        rule = str(item.get("rule") or "")
        rule_findings = findings_by_rule.get(rule, [])
        status, location = _status_and_location(item, rule_findings)
        add([(rule, 3), (item.get("title") or "", 3), (status, 3), (location, 3)])

    add([])
    if conclusion.get("source") == "llm" and llm.get("used"):
        heading = "Заключение языковой модели"
        if llm.get("model"):
            heading += f" {llm['model']}"
    elif llm.get("used"):
        heading = "Заключение по шаблону (модель использовалась при первичной проверке)"
    elif llm.get("requested"):
        heading = "Заключение по шаблону (языковая модель не использовалась)"
    else:
        heading = "Заключение по шаблону"
    if conclusion.get("recalculated"):
        heading += " — пересчитано после изменения замечаний"
    add([(heading, 4)], merge=True, height=20)
    if conclusion.get("text"):
        text = str(conclusion["text"])
        lines = text.count("\n") + max(1, len(text) // 100)
        add([(text, 5)], merge=True, height=min(409, max(30, lines * 15)))

    return _xlsx(rows, merges, _document_title(report))


def _document_title(report: dict) -> str:
    summary = report.get("summary") or {}
    if summary.get("kind") == "signage":
        title = "Заключение по дизайн-проекту размещения информационных конструкций"
        if summary.get("object"):
            title += f": {summary['object']}"
        return title
    number = str(summary.get("number") or "").strip()
    title = f"Проверка паспорта колористического решения фасадов № {number}" if number else "Проверка паспорта"
    if summary.get("address"):
        title += f" ({summary['address']})"
    return title


def _status_and_location(item: dict, findings: list[dict]) -> tuple[str, str]:
    errors = [f for f in findings if f.get("severity") == "error"]
    warnings = [f for f in findings if f.get("severity") == "warning"]
    if errors:
        status = _STATUS_FAIL
    elif item.get("status") == "skip" and not warnings:
        status = _STATUS_SKIP
    elif warnings:
        status = _STATUS_WARN
    else:
        status = _STATUS_PASS
    relevant = errors or warnings
    if not relevant:
        note = str(item.get("note") or "").strip()
        return status, note or "—"
    return status, "\n".join(_where(f, warning=f.get("severity") == "warning") for f in relevant)


def _where(finding: dict, warning: bool = False) -> str:
    place = []
    if finding.get("page") is not None:
        place.append(f"лист {int(finding['page']) + 1}")
    if finding.get("element"):
        place.append(f"поз. {finding['element']}")
    message = str(finding.get("message") or finding.get("title") or "").strip()
    if warning:
        message = f"предупреждение: {message}"
    return f"{', '.join(place)}: {message}" if place else message


def _safe_name(value: str) -> str:
    value = re.sub(r'[\\/:*?"<>|\x00-\x1f]+', "_", value)
    value = re.sub(r"\s+", " ", value).strip(" ._")
    return (value[:100].rstrip(" ._") or "паспорт")


def _col(index: int) -> str:
    letters = ""
    while index:
        index, rest = divmod(index - 1, 26)
        letters = chr(65 + rest) + letters
    return letters


def _esc(value) -> str:
    text = str(value or "")
    text = "".join(ch for ch in text if ch in "\t\n\r" or ord(ch) >= 0x20)
    return escape(text)


def _sheet_xml(rows: list[dict], merges: list[str]) -> str:
    parts = [
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">',
        f'<dimension ref="A1:D{max(1, len(rows))}"/>',
        '<sheetViews><sheetView workbookViewId="0"/></sheetViews>',
        '<sheetFormatPr defaultRowHeight="15"/>',
        '<cols>',
        '<col min="1" max="1" width="14" customWidth="1"/>',
        '<col min="2" max="2" width="46" customWidth="1"/>',
        '<col min="3" max="3" width="28" customWidth="1"/>',
        '<col min="4" max="4" width="64" customWidth="1"/>',
        '</cols>',
        "<sheetData>",
    ]
    for number, row in enumerate(rows, 1):
        height = f' ht="{row["height"]}" customHeight="1"' if row.get("height") else ""
        parts.append(f'<row r="{number}"{height}>')
        for column, (value, style) in enumerate(row["cells"], 1):
            ref = f"{_col(column)}{number}"
            parts.append(
                f'<c r="{ref}" s="{style}" t="inlineStr"><is><t xml:space="preserve">{_esc(value)}</t></is></c>'
            )
        parts.append("</row>")
    parts.append("</sheetData>")
    if merges:
        parts.append(f'<mergeCells count="{len(merges)}">')
        parts.extend(f'<mergeCell ref="{ref}"/>' for ref in merges)
        parts.append("</mergeCells>")
    parts.append('<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>')
    parts.append("</worksheet>")
    return "".join(parts)


def _styles_xml() -> str:
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        '<fonts count="3">'
        '<font><sz val="11"/><name val="Calibri"/></font>'
        '<font><b/><sz val="11"/><name val="Calibri"/></font>'
        '<font><b/><sz val="14"/><name val="Calibri"/></font>'
        '</fonts>'
        '<fills count="3">'
        '<fill><patternFill patternType="none"/></fill>'
        '<fill><patternFill patternType="gray125"/></fill>'
        '<fill><patternFill patternType="solid"><fgColor rgb="FFEDEDED"/><bgColor indexed="64"/></patternFill></fill>'
        '</fills>'
        '<borders count="2">'
        '<border><left/><right/><top/><bottom/><diagonal/></border>'
        '<border><left style="thin"><color rgb="FFBFBFBF"/></left>'
        '<right style="thin"><color rgb="FFBFBFBF"/></right>'
        '<top style="thin"><color rgb="FFBFBFBF"/></top>'
        '<bottom style="thin"><color rgb="FFBFBFBF"/></bottom><diagonal/></border>'
        '</borders>'
        '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
        '<cellXfs count="6">'
        '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
        '<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1">'
        '<alignment vertical="center" wrapText="1"/></xf>'
        '<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">'
        '<alignment vertical="center" wrapText="1"/></xf>'
        '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1">'
        '<alignment vertical="top" wrapText="1"/></xf>'
        '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1">'
        '<alignment vertical="center" wrapText="1"/></xf>'
        '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1">'
        '<alignment vertical="top" wrapText="1"/></xf>'
        '</cellXfs>'
        '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>'
        '</styleSheet>'
    )


def _xlsx(rows: list[dict], merges: list[str], title: str) -> bytes:
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    content_types = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        '<Default Extension="xml" ContentType="application/xml"/>'
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
        '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
        '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>'
        '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>'
        '</Types>'
    )
    root_rels = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>'
        '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>'
        '</Relationships>'
    )
    workbook = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
        '<sheets><sheet name="Проверка" sheetId="1" r:id="rId1"/></sheets>'
        '</workbook>'
    )
    workbook_rels = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>'
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
        '</Relationships>'
    )
    core = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" '
        'xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" '
        'xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">'
        f'<dc:title>{_esc(title)}</dc:title><dc:creator>colorpass</dc:creator>'
        '<cp:lastModifiedBy>colorpass</cp:lastModifiedBy>'
        f'<dcterms:created xsi:type="dcterms:W3CDTF">{now}</dcterms:created>'
        f'<dcterms:modified xsi:type="dcterms:W3CDTF">{now}</dcterms:modified>'
        '</cp:coreProperties>'
    )
    app = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties">'
        '<Application>colorpass</Application>'
        '</Properties>'
    )

    buffer = BytesIO()
    with ZipFile(buffer, "w", ZIP_DEFLATED) as archive:
        archive.writestr("[Content_Types].xml", content_types)
        archive.writestr("_rels/.rels", root_rels)
        archive.writestr("docProps/core.xml", core)
        archive.writestr("docProps/app.xml", app)
        archive.writestr("xl/workbook.xml", workbook)
        archive.writestr("xl/_rels/workbook.xml.rels", workbook_rels)
        archive.writestr("xl/styles.xml", _styles_xml())
        archive.writestr("xl/worksheets/sheet1.xml", _sheet_xml(rows, merges))
    return buffer.getvalue()
