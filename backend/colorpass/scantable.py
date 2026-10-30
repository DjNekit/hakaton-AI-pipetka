"""Таблица отделки со скана: сетка по линиям изображения, образцы цвета, коды — OCR или текстовый слой.

В реальных паспортах таблица отделки часто — растровое изображение: вертикальные линии граф есть,
а строки элементов горизонтальными линиями не разделены (линиями выделены только шапка и группы:
«Система водоотведения», «Поверхности стен»…). Поэтому:
1) графы — по вертикальным линиям, их назначение — по словам шапки;
2) группы — полосы между длинными горизонтальными линиями без номера в графе «№»;
3) элементы — номера в графе «№»; подстроки элемента — по образцам цвета (залитые прямоугольники);
4) коды цвета — OCR tesseract фрагмента графы «Марка цвета», иначе — «починка» текстового слоя.
"""
from __future__ import annotations

import re
from dataclasses import dataclass

import cv2
import numpy as np

from .extract import FinishRow
from .graphics import measure_box
from .ingest import Document, PageData, Word
from .ocrfix import fuzzy_codes, ocr_codes_image, suppress_watermark
from .palettes import ColorSpec, parse_color_spec, ral_lookup

SCALE = 2.0  # 144 dpi для геометрии
OCR_SCALE = 4.0  # ~288 dpi для OCR кодов

_HEADER = {
    "n": [r"^№", r"п/п"],
    "name": [r"наименован"],
    "material": [r"материал"],
    "swatch": [r"образец"],
    "marks": [r"марка"],
    "note": [r"примеч"],
}


@dataclass
class Grid:
    cols: list[float]  # границы граф, пт
    hlines: list[tuple[float, float, float]]  # (y, x0, x1), пт
    top: float
    bottom: float


def _merge(values: np.ndarray, gap: int = 3) -> list[tuple[int, int]]:
    groups: list[list[int]] = []
    for v in values:
        if groups and v - groups[-1][-1] <= gap:
            groups[-1].append(int(v))
        else:
            groups.append([int(v)])
    return [(g[0], g[-1]) for g in groups]


def detect_grid(img: np.ndarray) -> Grid | None:
    gray = cv2.cvtColor(img, cv2.COLOR_RGB2GRAY)
    bw = (gray < 150).astype(np.uint8)
    h, w = bw.shape
    vmask = cv2.morphologyEx(bw, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_RECT, (1, max(20, h // 15))))
    hmask = cv2.morphologyEx(bw, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_RECT, (max(20, w // 12), 1)))
    xs = np.where(vmask.sum(0) > h // 15)[0]
    if len(xs) == 0:
        return None
    cols = [((a + b) / 2) / SCALE for a, b in _merge(xs)]
    if len(cols) < 4:
        return None
    rows_with_v = np.where(vmask[:, xs].sum(1) > 0)[0]
    top, bottom = rows_with_v.min() / SCALE, rows_with_v.max() / SCALE
    hlines = []
    for a, b in _merge(np.where(hmask.sum(1) > w // 12)[0]):
        y = (a + b) // 2
        xs_line = np.where(hmask[a:b + 1].max(0) > 0)[0]
        hlines.append((y / SCALE, xs_line.min() / SCALE, xs_line.max() / SCALE))
    return Grid(cols, hlines, top, bottom)


def _col_of(x: float, cols: list[float]) -> int | None:
    for i in range(len(cols) - 1):
        if cols[i] <= x < cols[i + 1]:
            return i
    return None


def _header_map(words: list[Word], grid: Grid) -> dict[str, int]:
    mapping: dict[str, int] = {}
    for w in words:
        if w.top > grid.top + 90:
            continue
        c = _col_of(w.center[0], grid.cols)
        if c is None:
            continue
        t = w.text.lower()
        for key, pats in _HEADER.items():
            if key not in mapping and any(re.search(p, t) for p in pats):
                mapping[key] = c
    return mapping


def _swatches(img: np.ndarray, x0: float, x1: float, y0: float, y1: float) -> list[tuple[float, float, float, float]]:
    """Залитые прямоугольники (образцы цвета) в графе «Образец»."""
    X0, X1, Y0, Y1 = (int(v * SCALE) for v in (x0 + 2, x1 - 2, y0, y1))
    crop = img[Y0:Y1, X0:X1]
    if crop.size == 0:
        return []
    gray = cv2.cvtColor(crop, cv2.COLOR_RGB2GRAY)
    filled = (gray < 238).astype(np.uint8)
    k = cv2.getStructuringElement(cv2.MORPH_RECT, (max(5, (X1 - X0) // 4), 9))
    filled = cv2.morphologyEx(filled, cv2.MORPH_OPEN, k)  # убираем текст и тонкие линии водяного знака
    n, _, stats, _ = cv2.connectedComponentsWithStats(filled, connectivity=8)
    out = []
    for i in range(1, n):
        x, y, bw, bh, area = stats[i]
        if bw >= 0.45 * (X1 - X0) and bh >= 8 * SCALE and area >= 0.6 * bw * bh:
            out.append(((X0 + x) / SCALE, (Y0 + y) / SCALE, (X0 + x + bw) / SCALE, (Y0 + y + bh) / SCALE))
    # белые образцы (например, RAL 9010) не залиты — ищем прямоугольные рамки
    edges = (gray < 170).astype(np.uint8)
    hl = cv2.morphologyEx(edges, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_RECT, (max(10, int(0.45 * (X1 - X0))), 1)))
    ys = _merge(np.where(hl.sum(1) > 0)[0])
    ys = [(a + b) // 2 for a, b in ys]
    for ya, yb in zip(ys, ys[1:]):
        h_pt = (yb - ya) / SCALE
        if not 10 <= h_pt <= 45:
            continue
        top, bot = (Y0 + ya) / SCALE, (Y0 + yb) / SCALE
        if any(not (bot <= o[1] + 1 or top >= o[3] - 1) for o in out):
            continue
        xs_line = np.where(hl[ya])[0]
        xl, xr = xs_line.min(), xs_line.max()
        left = edges[ya:yb, max(0, xl - 2):xl + 3].max(1).mean()
        right = edges[ya:yb, max(0, xr - 2):xr + 3].max(1).mean()
        if left < 0.8 or right < 0.8:
            continue  # между двумя образцами — это не рамка
        out.append(((X0 + xl) / SCALE, top, (X0 + xr) / SCALE, bot))
    return sorted(out, key=lambda b: b[1])


def _wx(w: Word) -> float:
    """Центр слова по x; у слов, «раздутых» склейкой с водяным знаком, — по правому краю."""
    est = max(4.0, len(w.text) * 0.55 * (w.bottom - w.top))
    if (w.x1 - w.x0) > 2.5 * est:
        return w.x1 - est / 2
    return w.center[0]


def _text_in(words: list[Word], x0: float, x1: float, y0: float, y1: float) -> str:
    sel = [w for w in words if x0 <= _wx(w) < x1 and y0 <= w.center[1] < y1]
    sel.sort(key=lambda w: (round(w.top / 4), w.x0))
    return " ".join(w.text for w in sel)


def _valid(spec: ColorSpec) -> tuple[list[str], list]:
    return [c for c in spec.ral if ral_lookup(c)], [n for n in spec.ncs if n.valid]


def _ral_from_partial(layer_text: str, ncs, swatch_lab=None) -> str | None:
    """OCR потерял цифру в коде RAL («РАН 002» вместо «RAL 1002»): из кодов RAL Classic, совпадающих
    с уцелевшими цифрами, берём тот, что ближе всего к цвету NCS той же позиции, — только если выбор однозначен."""
    from .color import delta_e2000
    from .ocrfix import _CODE_MAP
    from .palettes import ncs_to_lab, ral_table

    t = "".join(_CODE_MAP.get(ch, ch) for ch in layer_text).upper()
    m = re.search(r"(?<![A-Z0-9])[RPH]\s?A\s?[L1IH]?\s?[.,]?\s?(\d{3})(?!\d)", t)
    if not m:
        return None
    digits = m.group(1)
    cands = [c for c in ral_table() if c.endswith(digits) or c.startswith(digits)]
    if not cands:
        return None
    target = ncs_to_lab(ncs)

    def score(c: str) -> float:  # близость к NCS той же позиции и к образцу цвета (если есть)
        lab = ral_table()[c].lab
        d = float(delta_e2000(lab, target))
        if swatch_lab is not None:
            d = (d + float(delta_e2000(lab, swatch_lab))) / 2
        return d

    scored = sorted((score(c), c) for c in cands)
    best = scored[0]
    second = scored[1][0] if len(scored) > 1 else 99.0
    if best[0] < 15 and second - best[0] >= 6:
        return best[1]
    return None


def _codes_for(crop: np.ndarray, layer_text: str, swatch_lab=None) -> tuple[ColorSpec, str]:
    """Коды позиции из трёх источников: OCR фрагмента, «починенный» текстовый слой, OCR без водяного знака.

    Для каждой палитры берётся первый источник, давший существующий код.
    """
    sources: list[tuple[str, ColorSpec]] = []
    if crop.size:
        sources.append(("ocr", parse_color_spec(ocr_codes_image(crop))))
    sources.append(("text-layer", parse_color_spec(fuzzy_codes(layer_text))))
    ral: list[str] = []
    ncs: list = []
    used: list[str] = []
    for name, spec in sources:
        r, n = _valid(spec)
        if not ral and r:
            ral, used = r, used + [name]
        if not ncs and n:
            ncs = n
            used += [name] if name not in used else []
    if crop.size and (not ral or not ncs):
        r, n = _valid(parse_color_spec(ocr_codes_image(suppress_watermark(crop))))
        if not ral and r:
            ral, used = r, used + ["ocr-clean"]
        if not ncs and n:
            ncs, used = n, used + ["ocr-clean"]
    if not ral and ncs:
        guess = _ral_from_partial(layer_text, ncs[0], swatch_lab)
        if guess:
            ral, used = [guess], used + ["text-layer+цвет"]
    raw_parts = [f"NCS {x.notation}" for x in ncs] + [f"RAL {x}" for x in ral]
    spec = ColorSpec(raw=" ".join(raw_parts) or layer_text.strip(), ral=ral, ncs=ncs)
    if not used:
        return spec, ("не распознано" if re.search(r"\d{3,}", layer_text) else "")
    return spec, "+".join(dict.fromkeys(used))


def parse_scanned_table(doc: Document, page_indices: list[int], group_offset: int = 0) -> list[FinishRow]:
    rows: list[FinishRow] = []
    group_no = group_offset
    for pi in page_indices:
        page: PageData = doc.pages[pi]
        img = doc.render(pi, SCALE)
        grid = detect_grid(img)
        if grid is None:
            continue
        words = [w for w in page.words if grid.top - 2 <= w.top <= grid.bottom + 2]
        cmap = _header_map(words, grid)
        if not {"name", "marks"} <= cmap.keys():
            continue
        cn = cmap.get("n", 0)
        cols = grid.cols
        width = cols[-1] - cols[0]
        # линии строк таблицы пересекают хотя бы одну внутреннюю границу граф (рамки образцов — нет);
        # водяной знак может рвать линии, поэтому полной длины не требуем
        def crosses(a: float, b: float) -> bool:
            return sum(1 for c in cols[1:-1] if a + 3 < c < b - 3) >= 1 and (b - a) > 0.3 * width

        full = sorted(y for y, a, b in grid.hlines if crosses(a, b) and grid.top - 2 <= y <= grid.bottom + 2)
        # тело таблицы начинается после строки нумерации граф «1 2 3 4 5 6»
        num_row = [w for w in words if w.text.isdigit() and len(w.text) == 1]
        body_top = grid.top
        by_y: dict[int, set[str]] = {}
        for w in num_row:
            by_y.setdefault(round(w.top / 3), set()).add(w.text)
        for key, vals in by_y.items():
            if len(vals) >= 4:
                body_top = max(body_top, key * 3 + 8)
        bands = [y for y in full if y > body_top - 6] + [grid.bottom]
        # строки-группы: полосы между длинными линиями без номера в графе «№»
        group_bands = []
        for a, b in zip(bands, bands[1:]):
            if 6 < b - a < 30:
                nums = [w for w in words if _col_of(w.center[0], cols) == cn and a < w.center[1] < b and w.text.isdigit()]
                if not nums and _text_in(words, cols[0], cols[-1], a, b).strip():
                    group_bands.append((a, b, _text_in(words, cols[0], cols[-1], a, b)))
        nums = sorted(
            [w for w in words if _col_of(w.center[0], cols) == cn and w.top > body_top and re.fullmatch(r"\d{1,2}", w.text)],
            key=lambda w: w.top,
        )
        cuts = sorted([w.top - 3 for w in nums] + [a for a, _, _ in group_bands] + [grid.bottom])
        big = doc.render(pi, OCR_SCALE)
        sw_col = cmap.get("swatch")
        swatches = _swatches(img, cols[sw_col], cols[sw_col + 1], body_top, grid.bottom) if sw_col is not None else []
        for w in nums:
            g = [gb for gb in group_bands if gb[1] <= w.top]
            gname = g[-1][2] if g else ""
            gidx = group_no + len(g)
            y0 = w.top - 3
            y1 = min([c for c in cuts if c > y0 + 1] or [grid.bottom])

            def col_text(key: str, a: float, b: float) -> str:
                c = cmap.get(key)
                return _text_in(words, cols[c], cols[c + 1], a, b) if c is not None else ""

            name = re.sub(rf"^{w.text}\s+", "", col_text("name", y0, y1))
            subs = [s for s in swatches if y0 - 2 <= (s[1] + s[3]) / 2 < y1]
            parts = subs or [None]
            for k, sw in enumerate(parts, start=1):
                a, b = (sw[1] - 4, sw[3] + 4) if sw else (y0, y1)
                if sw and k == 1:
                    a = min(a, y0)
                mc = cmap["marks"]
                X0, X1 = int(cols[mc] * OCR_SCALE) + 4, int(cols[mc + 1] * OCR_SCALE) - 4
                crop = big[int(a * OCR_SCALE):int(b * OCR_SCALE), X0:X1]
                sw_lab = None
                if sw:
                    sample = measure_box(img, sw, inset=0.25)
                    sw_lab = sample.lab if sample else None
                spec, source = _codes_for(crop, col_text("marks", a, b), sw_lab)
                n = f"{gidx}.{w.text}" if group_bands or group_no else w.text
                if k > 1:
                    n = f"{n}.{k}"
                rows.append(
                    FinishRow(
                        n=n,
                        name=name.strip(),
                        material=col_text("material", a, b),
                        marks=spec,
                        note=col_text("note", a, b),
                        page=pi,
                        row_bbox=(cols[0], a, cols[-1], b),
                        swatch_bbox=sw,
                        marks_bbox=(cols[mc], a, cols[mc + 1], b),
                        group=gname.strip(),
                        codes_source=source,
                    )
                )
        group_no += len(group_bands)
    return rows


def swatch_color(doc: Document, row: FinishRow):
    if not row.swatch_bbox:
        return None
    return measure_box(doc.render(row.page, SCALE), row.swatch_bbox, inset=0.25)
