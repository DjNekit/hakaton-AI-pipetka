"""Структурирование паспорта: классификация листов и извлечение сведений.

Результат — объект ``Passport``: титул, общие сведения, пояснительная записка,
листы развёрток (штампы, выноски, масштаб) и таблица отделки (с образцами цвета).
Всё извлекается детерминированно; ЛЛМ подключается отдельно (см. llm.py).
"""
from __future__ import annotations

import math
import re
from dataclasses import dataclass, field

from .ingest import BBox, Document, PageData, Word, norm_text
from .palettes import ColorSpec, parse_color_spec

# ----------------------------------------------------------------- классификация

PAGE_KINDS = {
    "title": "Титульный лист",
    "general": "Раздел I. Общие сведения об объекте",
    "urban": "Раздел II. Градостроительная характеристика",
    "arch": "Раздел III. Архитектурная характеристика / пояснительная записка",
    "photo": "Фотофиксация объекта",
    "facade": "Раздел IV. Развёртка фасада",
    "finish_table": "Раздел V. Таблица отделки",
    "other": "Прочее",
}

_KIND_PATTERNS = [
    ("finish_table", [r"таблица отделки", r"ведомость отделки", r"марка цвета по палитрам", r"окраска и отделка"]),
    ("facade", [r"разв[её]ртк\w* фасад", r"\bфасад\w* \S+[–-]\S+", r"фасады объекта", r"^iv\.?\s+фасад", r"чертеж\w* фасад"]),
    ("photo", [r"фотофиксац"]),
    ("general", [r"общие сведения"]),
    ("urban", [r"(?<!архитектурно-)градостроительн\w* характеристик", r"схема местоположения", r"местоположение объекта"]),
    (
        "arch",
        [
            r"архитектурн\w* характеристик",
            r"архитектурно-градостроительн\w* характеристик",
            r"пояснительн\w* записк",
            r"существующее состояние фасад",
        ],
    ),
]


def classify_page(page: PageData) -> list[str]:
    """Возвращает список видов листа (первый — основной)."""
    head = page.head_text(0.22).lower()
    full = norm_text(page.text).lower()
    kinds: list[str] = []
    if page.index == 0 and re.search(r"паспорт", head + full[:400]) and re.search(r"колористическ", full[:600]):
        kinds.append("title")
    for kind, pats in _KIND_PATTERNS:
        if any(re.search(p, head) for p in pats):
            kinds.append(kind)
    if not kinds:
        for kind, pats in _KIND_PATTERNS:
            if kind in ("facade",):
                continue
            if any(re.search(p, full) for p in pats):
                kinds.append(kind)
                break
    # содержательные признаки, которых может не быть в заголовке
    if "arch" not in kinds and re.search(r"проектн\w* (колористическ\w* )?решени|колористическое решение разработано", full):
        if not {"finish_table", "facade", "title"} & set(kinds):
            kinds.append("arch")
    return kinds or ["other"]


# ----------------------------------------------------------------- модель


@dataclass
class Marker:
    label: str
    center: tuple[float, float]
    radius: float
    bbox: BBox
    target: tuple[float, float] | None = None  # конец линии-выноски
    leader: tuple[float, float, float, float] | None = None


@dataclass
class FacadeSheet:
    page: int
    name: str
    scale: str | None
    stamp_address: str | None
    stamp_author: str | None
    markers: list[Marker] = field(default_factory=list)
    facade_list: list[str] = field(default_factory=list)


@dataclass
class FinishRow:
    n: str
    name: str
    material: str
    marks: ColorSpec
    note: str
    page: int
    row_bbox: BBox | None
    swatch_bbox: BBox | None
    marks_bbox: BBox | None
    group: str = ""  # группа строк таблицы («Поверхности стен»…)
    codes_source: str = "text"  # text | ocr | text-layer (починенный OCR-слой скана)


@dataclass
class Passport:
    pages: dict[int, list[str]]
    title: dict[str, str]
    general: dict[str, str]
    general_page: int | None
    note_text: str
    note_pages: list[int]
    facades: list[FacadeSheet]
    finish_rows: list[FinishRow]
    finish_pages: list[int]
    facade_list: list[str]

    def row_by_n(self, n: str) -> FinishRow | None:
        for r in self.finish_rows:
            if r.n == n:
                return r
        return None


# ----------------------------------------------------------------- титул / общие сведения

ADDRESS_RE = re.compile(r"Адрес(?: объекта)?\s*(?::\s*|\s+)(.+)", re.IGNORECASE)


NUMBER_RE = re.compile(r"№\s*(\d{1,4}\s?/\s?\d{3,6}|[A-ZА-ЯЁ]+-\d+/\d+|\S+/\S+)")
DATE_RE = re.compile(r"(?<!\d)([0-3])\s?(\d)\s?\.\s?([01])\s?(\d)\s?\.\s?((?:19|20)\d\d)(?!\d)")


def _find_date(text: str) -> str | None:
    m = re.search(r"Дата\s*:?\s*(\d{2}\.\d{2}\.\d{4})", text)
    if m:
        return m.group(1)
    m = DATE_RE.search(text)
    return f"{m.group(1)}{m.group(2)}.{m.group(3)}{m.group(4)}.{m.group(5)}" if m else None


def _title_info(page: PageData) -> dict[str, str]:
    info: dict[str, str] = {}
    text = norm_text(page.text)
    m = NUMBER_RE.search(text)
    if m:
        info["Номер"] = re.sub(r"\s+", "", m.group(1))
    date = _find_date(text)
    if date:
        info["Дата"] = date
    for line in page.text_lines():
        m = ADDRESS_RE.match(line)
        if m:
            info["Адрес"] = m.group(1).strip()
            break
    return info


def _footer_info(doc: Document) -> dict[str, str]:
    """Номер и дата из колонтитулов «ПАСПОРТ № 19/04406 16.10.2019» на любых листах."""
    info: dict[str, str] = {}
    for p in doc.pages:
        text = norm_text(p.text)
        m = re.search(r"ПАСПОРТ\s*№\s*(\d{1,4}\s?/\s?\d{4,6})(?!\d)", text, re.IGNORECASE)
        if m and "Номер" not in info:
            info["Номер"] = re.sub(r"\s+", "", m.group(1))
        if "Дата" not in info:
            tail = text[m.end():] if m else ""
            date = _find_date(tail)
            if date:
                info["Дата"] = date
        if len(info) == 2:
            break
    return info


def _general_info(page: PageData) -> dict[str, str]:
    data: dict[str, str] = {}
    for t in page.tables:
        for row in t.rows:
            if len(row) >= 2 and row[0].text and row[0].text.lower() not in ("показатель", "наименование показателя"):
                data[row[0].text.rstrip(":")] = row[1].text
    if not data:  # запасной вариант: строки «1. Ключ: значение» (+ строки-продолжения)
        last = None
        for line in page.text_lines():
            m = re.match(r"^(?:\d+(?:\.\d+)*\.?\s*)?([А-ЯЁA-Z][^:]{2,70}?)\s*:\s*(.*)$", line)
            if m:
                last = m.group(1).strip()
                data[last] = m.group(2).strip()
            elif last and not re.match(r"^\d+(\.\d+)*\.?\s", line) and len(data[last]) < 300:
                data[last] = (data[last] + " " + line).strip()
    return data


def general_get(general: dict[str, str], field: str) -> str | None:
    """Значение показателя по названию с учётом вариантов («Вид работ по объекту» ~ «Вид работ»)."""
    f = field.lower()
    for k, v in general.items():
        kl = k.lower()
        if kl == f or kl.startswith(f) or f.startswith(kl):
            return v
    return None


# ----------------------------------------------------------------- развёртки

SCALE_RE = re.compile(r"(?:\bМ(?:асштаб)?\s*:?\s*)(1\s*:\s*\d+)", re.IGNORECASE)
FACADE_NAME_RE = re.compile(r"(Фасад\s+[^\s,;]+(?:\s*\([^)]*\))?)")


_STAMP_LABELS = {
    "Адрес объекта": r"адрес объекта",
    "Автор проекта": r"автор проект\w*(?:\s+решени\w*)?",
}


def _stamp_value(page: PageData, label: str) -> str | None:
    """Значение поля штампа; '' — поле есть, но пустое или прочерк; None — поля нет."""
    pat = re.compile(r"^" + _STAMP_LABELS.get(label, re.escape(label.lower())) + r"\s*:?\s*(.*)$", re.IGNORECASE)
    for line in page.text_lines():
        m = pat.match(line)
        if m:
            value = m.group(1).strip(" :")
            return "" if re.fullmatch(r"[-–—.\s]*", value) else value
    return None


def _facade_name(page: PageData) -> str:
    head_lines = [ln for ln in page.text_lines()[:6]]
    for ln in head_lines:
        if ln.lower().startswith("фасад"):
            return re.split(r"\s+М\s*1\s*:", ln)[0].strip()
    m = FACADE_NAME_RE.search(page.head_text())
    if m and re.search(r"[–-]", m.group(1)):
        return m.group(1)
    for ln in head_lines:  # «IV. ФАСАДЫ ОБЪЕКТА (М 1:100)»
        if re.search(r"фасад", ln, re.IGNORECASE):
            name = re.sub(r"\(?\s*М\s*1\s*:\s*\d+\s*\)?", "", ln).strip(" .")
            if name.isupper():  # «IV. ФАСАДЫ ОБЪЕКТА» → «IV. Фасады объекта»
                m2 = re.match(r"^([IVXLC]+\.\s*)?(.*)$", name)
                body = m2.group(2)
                name = (m2.group(1) or "") + body[:1].upper() + body[1:].lower()
            return name
    return f"Лист {page.index + 1}"


def _point_seg_dist(px: float, py: float, seg: tuple[float, float, float, float]) -> float:
    ax, ay, bx, by = seg
    vx, vy = bx - ax, by - ay
    L2 = vx * vx + vy * vy
    t = 0.0 if L2 == 0 else max(0.0, min(1.0, ((px - ax) * vx + (py - ay) * vy) / L2))
    return math.hypot(px - (ax + t * vx), py - (ay + t * vy))


def _raster_circle_radius(img, cx: float, cy: float, scale: float = 2.0) -> float | None:
    """Есть ли на растре тёмная окружность вокруг точки (кружок выноски)? Возвращает радиус в пунктах."""
    import numpy as np

    h, w = img.shape[:2]
    gray = img.mean(axis=2)
    angles = np.linspace(0, 2 * np.pi, 48, endpoint=False)
    for r in np.arange(4.0, 11.0, 0.5):
        xs = ((cx + r * np.cos(angles)) * scale).astype(int)
        ys = ((cy + r * np.sin(angles)) * scale).astype(int)
        if xs.min() < 1 or ys.min() < 1 or xs.max() >= w - 1 or ys.max() >= h - 1:
            return None
        # тёмный пиксель в окрестности 3x3 каждой точки окружности
        dark = [gray[y - 1:y + 2, x - 1:x + 2].min() < 110 for x, y in zip(xs, ys)]
        if np.mean(dark) >= 0.85:
            inner = gray[int((cy - r * 0.45) * scale):int((cy + r * 0.45) * scale), int((cx - r * 0.45) * scale):int((cx + r * 0.45) * scale)]
            if inner.size and inner.mean() > 120:  # внутри кружка светлый фон с цифрой
                return float(r)
    return None


def _markers(page: PageData, img=None) -> list[Marker]:
    markers: list[Marker] = []
    circles = [c for c in page.curves if 6 <= (c[2] - c[0]) <= 26 and abs((c[2] - c[0]) - (c[3] - c[1])) < 3]
    for w in page.words:
        if not re.fullmatch(r"\d{1,2}", w.text):
            continue
        cx, cy = w.center
        host = None
        for c in circles:
            if c[0] - 1 <= cx <= c[2] + 1 and c[1] - 1 <= cy <= c[3] + 1:
                host = c
                break
        if host is None and (page.curves or img is None):
            continue  # векторный лист: номер вне кружка — не выноска
        if host is None:
            r = _raster_circle_radius(img, cx, cy)
            if r is None:
                continue  # растр: вокруг номера нет кружка — это не выноска
            center = (cx, cy)
            bbox = (cx - r, cy - r, cx + r, cy + r)
        else:
            center = ((host[0] + host[2]) / 2, (host[1] + host[3]) / 2)
            r = (host[2] - host[0]) / 2
            bbox = host
        mk = Marker(w.text, center, r, bbox)
        # линия-выноска: один конец у кружка
        best = None
        for s in page.lines:
            d0 = math.hypot(s.x0 - center[0], s.y0 - center[1])
            d1 = math.hypot(s.x1 - center[0], s.y1 - center[1])
            if min(d0, d1) <= r + 2.5:
                far = (s.x1, s.y1) if d0 < d1 else (s.x0, s.y0)
                length = math.hypot(far[0] - center[0], far[1] - center[1])
                if length > r + 4 and (best is None or length > best[0]):
                    best = (length, far, (s.x0, s.y0, s.x1, s.y1))
        if best:
            mk.target = best[1]
            mk.leader = best[2]
        markers.append(mk)
    return markers


def _facade_sheet(page: PageData, img=None) -> FacadeSheet:
    head = page.head_text(0.25)
    m = SCALE_RE.search(head) or SCALE_RE.search(norm_text(page.text))
    scale = re.sub(r"\s+", "", m.group(1)) if m else None
    stamp_scale = _stamp_value(page, "Масштаб")
    if stamp_scale:
        scale = re.sub(r"\s+", "", stamp_scale) or scale
    fl = []
    m = re.search(r"Перечень разв[её]рток\s*:\s*(.+?)(?:\.\s|\.$|$)", norm_text(page.text))
    if m:
        fl = [norm_text(x) for x in re.split(r",|;", m.group(1)) if norm_text(x)]
    return FacadeSheet(
        page=page.index,
        name=_facade_name(page),
        scale=scale,
        stamp_address=_stamp_value(page, "Адрес объекта"),
        stamp_author=_stamp_value(page, "Автор проекта"),
        markers=_markers(page, img),
        facade_list=fl,
    )


# ----------------------------------------------------------------- таблица отделки

_COLS = {
    "n": [r"^№", r"п/п"],
    "name": [r"наименование"],
    "material": [r"материал", r"вид отделки"],
    "swatch": [r"образец"],
    "marks": [r"марка", r"цвет.*палитр", r"ncs", r"ral"],
    "note": [r"примечан"],
}


def _header_map(row: list) -> dict[str, int] | None:
    mapping: dict[str, int] = {}
    for i, cell in enumerate(row):
        t = cell.text.lower()
        for key, pats in _COLS.items():
            if key not in mapping and any(re.search(p, t) for p in pats):
                mapping[key] = i
                break
    if {"name", "marks"} <= mapping.keys():
        return mapping
    return None


def _finish_rows(doc: Document, pages: list[int]) -> list[FinishRow]:
    rows: list[FinishRow] = []
    mapping: dict[str, int] | None = None
    for pi in pages:
        page = doc.pages[pi]
        for t in page.tables:
            for row in t.rows:
                hm = _header_map(row)
                if hm:
                    mapping = hm
                    continue
                if not mapping:
                    continue

                def cell(key: str):
                    i = mapping.get(key)  # type: ignore[union-attr]
                    return row[i] if i is not None and i < len(row) else None

                name_c, marks_c = cell("name"), cell("marks")
                if not name_c or not name_c.text:
                    continue
                n_c = cell("n")
                n = n_c.text.strip(" .") if n_c and n_c.text else str(len(rows) + 1)
                bboxes = [c.bbox for c in row if c and c.bbox]
                row_bbox = (
                    (min(b[0] for b in bboxes), min(b[1] for b in bboxes), max(b[2] for b in bboxes), max(b[3] for b in bboxes))
                    if bboxes
                    else None
                )
                sw = cell("swatch")
                mat = cell("material")
                note = cell("note")
                rows.append(
                    FinishRow(
                        n=n,
                        name=name_c.text,
                        material=mat.text if mat else "",
                        marks=parse_color_spec(marks_c.text if marks_c else ""),
                        note=note.text if note else "",
                        page=pi,
                        row_bbox=row_bbox,
                        swatch_bbox=sw.bbox if sw else None,
                        marks_bbox=marks_c.bbox if marks_c else None,
                    )
                )
    return rows


# ----------------------------------------------------------------- сборка


def build_passport(doc: Document) -> Passport:
    kinds = {p.index: classify_page(p) for p in doc.pages}
    title: dict[str, str] = {}
    general: dict[str, str] = {}
    general_page = None
    note_parts: list[str] = []
    note_pages: list[int] = []
    facades: list[FacadeSheet] = []
    finish_pages: list[int] = []
    for p in doc.pages:
        k = kinds[p.index]
        if "title" in k:
            title = _title_info(p)
        if "general" in k and not general:
            general = _general_info(p)
            general_page = p.index
        if "arch" in k:
            note_parts.append(norm_text(p.text))
            note_pages.append(p.index)
        if k[0] == "facade":
            img = doc.render(p.index, 2.0) if (p.images and not p.curves) else None
            facades.append(_facade_sheet(p, img))
        if "finish_table" in k:
            finish_pages.append(p.index)
    facade_list: list[str] = []
    for f in facades:
        if f.facade_list:
            facade_list = f.facade_list
            break
    if "title" in {x for v in kinds.values() for x in v}:
        for key, value in _footer_info(doc).items():
            title.setdefault(key, value)
    finish_rows = _finish_rows(doc, finish_pages)
    vector_pages = {r.page for r in finish_rows}
    scan_pages = [pi for pi in finish_pages if pi not in vector_pages and doc.pages[pi].images]
    if scan_pages:  # таблица отделки — изображение (скан): разбор по сетке и OCR
        from .scantable import parse_scanned_table

        finish_rows += parse_scanned_table(doc, scan_pages)
    return Passport(
        pages=kinds,
        title=title,
        general=general,
        general_page=general_page,
        note_text="\n".join(note_parts),
        note_pages=note_pages,
        facades=facades,
        finish_rows=finish_rows,
        finish_pages=finish_pages,
        facade_list=facade_list,
    )


def words_in(page: PageData, bbox: BBox) -> list[Word]:
    x0, t, x1, b = bbox
    return [w for w in page.words if w.x0 >= x0 - 1 and w.x1 <= x1 + 1 and w.top >= t - 1 and w.bottom <= b + 1]
