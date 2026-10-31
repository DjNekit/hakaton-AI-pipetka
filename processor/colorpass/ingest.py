"""Чтение PDF: текст со координатами, таблицы, векторные примитивы, растр страниц.

pdfplumber (MIT) — текст/таблицы/векторы, pypdfium2 (Apache-2.0/BSD) — рендер страниц.
Координаты везде в пунктах PDF с началом в левом верхнем углу (как в pdfplumber).
"""
from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import pdfplumber
import pypdfium2 as pdfium

log = logging.getLogger(__name__)

BBox = tuple[float, float, float, float]  # x0, top, x1, bottom


def norm_text(s: str) -> str:
    return re.sub(r"\s+", " ", (s or "").replace("ё", "е").replace("Ё", "Е")).strip()


@dataclass
class Word:
    text: str
    x0: float
    top: float
    x1: float
    bottom: float

    @property
    def bbox(self) -> BBox:
        return (self.x0, self.top, self.x1, self.bottom)

    @property
    def center(self) -> tuple[float, float]:
        return ((self.x0 + self.x1) / 2, (self.top + self.bottom) / 2)


@dataclass
class Segment:
    x0: float
    y0: float
    x1: float
    y1: float
    width: float = 0.5


@dataclass
class RectObj:
    bbox: BBox
    fill_rgb: tuple[float, float, float] | None


@dataclass
class Cell:
    text: str
    bbox: BBox | None


@dataclass
class TableData:
    bbox: BBox
    rows: list[list[Cell]]


@dataclass
class ImageInfo:
    bbox: BBox
    src_size: tuple[int, int]

    @property
    def dpi(self) -> float:
        w_pt = max(1e-6, self.bbox[2] - self.bbox[0])
        return self.src_size[0] / (w_pt / 72.0)


@dataclass
class PageData:
    index: int
    width: float
    height: float
    text: str
    words: list[Word]
    lines: list[Segment]
    rects: list[RectObj]
    curves: list[BBox]
    tables: list[TableData]
    images: list[ImageInfo]
    is_scan: bool = False
    ocr_used: bool = False
    notes: list[str] = field(default_factory=list)

    def text_lines(self) -> list[str]:
        return [norm_text(line) for line in self.text.splitlines() if norm_text(line)]

    def head_text(self, frac: float = 0.2) -> str:
        limit = self.height * frac
        return norm_text(" ".join(w.text for w in self.words if w.top < limit))


def _to_rgb(color) -> tuple[float, float, float] | None:
    """Цвет pdfplumber (кортеж в цветовом пространстве PDF) -> sRGB 0..255."""
    if color is None:
        return None
    if isinstance(color, (int, float)):
        color = (color,)
    try:
        vals = [float(v) for v in color]
    except (TypeError, ValueError):
        return None
    if len(vals) == 1:
        g = vals[0] * 255
        return (g, g, g)
    if len(vals) == 3:
        return tuple(v * 255 for v in vals)  # type: ignore[return-value]
    if len(vals) == 4:
        c, m, y, k = vals
        return ((1 - c) * (1 - k) * 255, (1 - m) * (1 - k) * 255, (1 - y) * (1 - k) * 255)
    return None


class Document:
    """Открытый PDF: извлечённые страницы + ленивый рендер."""

    def __init__(self, path: str | Path, ocr_lang: str = "rus+eng"):
        self.path = Path(path)
        self.ocr_lang = ocr_lang
        self._pdfium = pdfium.PdfDocument(str(self.path))
        self._render_cache: dict[tuple[int, float], np.ndarray] = {}
        self.pages: list[PageData] = []
        with pdfplumber.open(str(self.path)) as pdf:
            for i, page in enumerate(pdf.pages):
                self.pages.append(self._extract(i, page))
        # документ-скан: текстовый слой OCR чистим и на листах, собранных из нескольких картинок (титул и т. п.)
        if sum(p.is_scan for p in self.pages) >= max(1, len(self.pages) // 3):
            for p in self.pages:
                if p.images and not p.is_scan and not p.ocr_used:
                    self._clean_scan_text(p)

    # ------------------------------------------------------------------ extract
    def _extract(self, index: int, page) -> PageData:
        words = [
            Word(w["text"], float(w["x0"]), float(w["top"]), float(w["x1"]), float(w["bottom"]))
            for w in page.extract_words(x_tolerance=1.5, y_tolerance=2, keep_blank_chars=False)
        ]
        text = page.extract_text(x_tolerance=1.5, y_tolerance=3) or ""
        lines = []
        for ln in page.lines:
            pts = ln.get("pts") or [(ln["x0"], ln["top"]), (ln["x1"], ln["bottom"])]
            (ax, ay), (bx, by) = pts[0], pts[-1]
            lines.append(Segment(float(ax), float(ay), float(bx), float(by), float(ln.get("linewidth") or 0.5)))
        rects = []
        for r in page.rects:
            fill = _to_rgb(r.get("non_stroking_color")) if r.get("fill") else None
            rects.append(RectObj((float(r["x0"]), float(r["top"]), float(r["x1"]), float(r["bottom"])), fill))
        curves = [(float(c["x0"]), float(c["top"]), float(c["x1"]), float(c["bottom"])) for c in page.curves]
        tables = []
        try:
            for t in page.find_tables():
                texts = t.extract()
                rows: list[list[Cell]] = []
                for r_i, row in enumerate(t.rows):
                    cells = []
                    for c_i, bbox in enumerate(row.cells):
                        txt = ""
                        if r_i < len(texts) and c_i < len(texts[r_i]):
                            txt = texts[r_i][c_i] or ""
                        cells.append(Cell(norm_text(txt), tuple(float(v) for v in bbox) if bbox else None))
                    rows.append(cells)
                tables.append(TableData(tuple(float(v) for v in t.bbox), rows))
        except Exception as exc:  # pragma: no cover - защитный код для «грязных» PDF
            log.warning("Не удалось извлечь таблицы со страницы %s: %s", index + 1, exc)
        images = []
        for im in page.images:
            src = im.get("srcsize") or (0, 0)
            images.append(ImageInfo((float(im["x0"]), float(im["top"]), float(im["x1"]), float(im["bottom"])), (int(src[0]), int(src[1]))))

        pd = PageData(index, float(page.width), float(page.height), text, words, lines, rects, curves, tables, images)
        page_area = pd.width * pd.height
        # скан может быть одной картинкой или набором полос — считаем суммарное покрытие листа
        coverage = sum(
            max(0.0, min(im.bbox[2], pd.width) - max(im.bbox[0], 0)) * max(0.0, min(im.bbox[3], pd.height) - max(im.bbox[1], 0))
            for im in images
        ) / max(page_area, 1.0)
        big_image = coverage > 0.8
        pd.is_scan = big_image  # лист — растровое изображение (скан/экспорт картинкой)
        if big_image and len(words) < 5:
            self._ocr(pd)
        elif big_image:
            self._clean_scan_text(pd)
        return pd

    @staticmethod
    def _clean_scan_text(pd: PageData) -> None:
        """Текстовый слой скана (OCR): убираем буквы водяного знака и прочий мусор."""
        from .ocrfix import clean_ocr_text, clean_ocr_word

        heights = sorted(w.bottom - w.top for w in pd.words) or [10.0]
        median_h = heights[len(heights) // 2]
        cleaned = []
        for w in pd.words:
            h = w.bottom - w.top
            t = clean_ocr_word(w.text)
            if h > 2.5 * median_h and len(t) <= 2 and not re.search(r"\d", t):
                continue  # гигантские повёрнутые буквы водяного знака
            if re.fullmatch(r"[a-z/:.]", t):
                continue
            if t:
                bottom = w.bottom if h <= 2.5 * median_h else w.top + median_h  # слово «склеилось» с водяным знаком
                cleaned.append(Word(t, w.x0, w.top, w.x1, bottom))
        pd.words = cleaned
        pd.text = clean_ocr_text(pd.text)
        pd.notes.append("Лист — скан с текстовым слоем OCR; текст очищен от шума.")

    def _ocr(self, pd: PageData) -> None:
        try:
            import pytesseract  # noqa: WPS433
        except Exception:
            pd.notes.append("Страница — скан без текстового слоя; OCR недоступен (pytesseract не установлен).")
            return
        scale = 300 / 72
        img = self.render(pd.index, scale)
        try:
            data = pytesseract.image_to_data(img, lang=self.ocr_lang, output_type=pytesseract.Output.DICT)
        except Exception as exc:
            pd.notes.append(f"OCR не выполнен: {exc}")
            return
        words: list[Word] = []
        lines_map: dict[tuple[int, int, int], list[str]] = {}
        for i, txt in enumerate(data["text"]):
            if not txt or not txt.strip():
                continue
            x, y, w, h = (data[k][i] / scale for k in ("left", "top", "width", "height"))
            words.append(Word(txt.strip(), x, y, x + w, y + h))
            key = (data["block_num"][i], data["par_num"][i], data["line_num"][i])
            lines_map.setdefault(key, []).append(txt.strip())
        pd.words = words
        pd.text = "\n".join(" ".join(v) for v in lines_map.values())
        pd.ocr_used = True
        pd.notes.append("Текст страницы получен через OCR (tesseract).")

    # ------------------------------------------------------------------ render
    def render(self, index: int, scale: float = 2.0) -> np.ndarray:
        """Рендер страницы в RGB uint8 (H, W, 3). scale=2 -> 144 dpi."""
        key = (index, round(scale, 3))
        if key not in self._render_cache:
            bitmap = self._pdfium[index].render(scale=scale)
            img = np.asarray(bitmap.to_pil().convert("RGB"))
            self._render_cache[key] = img
        return self._render_cache[key]

    def close(self) -> None:
        self._pdfium.close()

    def __enter__(self) -> "Document":
        return self

    def __exit__(self, *exc) -> None:
        self.close()
