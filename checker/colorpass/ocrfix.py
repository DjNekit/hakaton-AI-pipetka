"""Очистка OCR-шума и «восстановление» кодов цвета из плохого текстового слоя сканов.

Реальные паспорта часто приходят сканами с текстовым слоем от OCR: в слова вклеены буквы водяного
знака («колориvстического»), латиница в кодах распознана кириллицей («РА1.7035» вместо RAL 7035,
«ИСЗЗЮЗО-УЗОР» вместо NCS S 1030-Y30R). Здесь — эвристики для обоих случаев.
"""
from __future__ import annotations

import re
import shutil

_LAT_IN_CYR = re.compile(r"(?<=[А-Яа-яЁё])[a-z]+(?=[А-Яа-яЁё])|(?<!\S)[a-z](?=[А-Яа-яЁё])|(?<=[А-Яа-яЁё])[a-z](?=[\s.,;:]|$)")


def clean_ocr_text(text: str) -> str:
    """Убирает вклеенные строчные латинские буквы (водяной знак) и строки из 1–2 символов."""
    out = []
    for line in (text or "").splitlines():
        s = line.strip()
        if len(s) <= 2 and not s.isdigit():
            continue
        s = _LAT_IN_CYR.sub("", s)
        s = re.sub(r"^[a-z]\s+(?=[А-ЯЁ0-9])", "", s)  # «t И. о. …»
        s = re.sub(r"\s+[a-z]$", "", s)  # «… корп. 1. r»
        out.append(s)
    return "\n".join(out)


def clean_ocr_word(text: str) -> str:
    t = _LAT_IN_CYR.sub("", text)
    t = re.sub(r"^[a-z](?=\d)", "", t)  # «t8» → «8»
    # «ффрриизз,,» — каждая буква удвоена (жирный шрифт в OCR)
    if len(t) >= 4 and len(t) % 2 == 0 and all(t[i] == t[i + 1] for i in range(0, len(t), 2)):
        t = t[::2]
    return t


# Кириллические «двойники» латиницы и цифр в кодах цвета
_CODE_MAP = {
    "А": "A", "а": "A", "В": "B", "С": "C", "с": "C", "Е": "E", "е": "E", "Н": "H", "н": "H",
    "К": "K", "М": "M", "О": "0", "о": "0", "Р": "R", "р": "R", "Т": "T", "Х": "X", "У": "Y", "у": "Y",
    "И": "N", "З": "3", "Ю": "10", "б": "6", "Б": "6", "Ч": "4", "Л": "L", "О́": "0",
}
_RAL_FUZZY = re.compile(r"(?<![A-Z0-9])[RPH]\s?A\s?[L1I]\s?[.,]?\s?(\d{4})(?!\d)")
_NCS_FUZZY = re.compile(
    r"N\s?[C0]?\s?[S35]?\s?[S35]\s?(\d{4})\s?[-–]\s?([YRBG](?:\s?[0-9]{2}\s?[YRBG])?|[NMH](?![0-9]))"
)


def fuzzy_codes(text: str) -> str:
    """Переписывает испорченные OCR-коды в нормальную запись «NCS S 1030-Y30R RAL 1002».

    Возвращает строку только с найденными кодами (пустую, если ничего не найдено).
    """
    t = "".join(_CODE_MAP.get(ch, ch) for ch in (text or "")).upper()
    found: list[str] = []
    for m in _NCS_FUZZY.finditer(t):
        hue = m.group(2).replace(" ", "")
        if hue in ("M", "H"):
            hue = "N"
        found.append(f"NCS S {m.group(1)}-{hue}")
    for m in _RAL_FUZZY.finditer(t):
        found.append(f"RAL {m.group(1)}")
    return " ".join(found)


def suppress_watermark(img, threshold: int = 20):
    """Убирает самые тёмные тонкие штрихи (контур водяного знака), оставляя серый текст."""
    import cv2
    import numpy as np

    gray = img if img.ndim == 2 else cv2.cvtColor(img, cv2.COLOR_RGB2GRAY)
    out = gray.copy()
    mask = cv2.dilate((gray < threshold).astype(np.uint8), np.ones((3, 3), np.uint8)).astype(bool)
    out[mask] = 255
    return out


def tesseract_available() -> bool:
    try:
        import pytesseract  # noqa: F401
    except Exception:
        return False
    return shutil.which("tesseract") is not None


def ocr_codes_image(img) -> str:
    """OCR кодов цвета (латиница, цифры) с фрагмента изображения; '' если tesseract недоступен."""
    if not tesseract_available():
        return ""
    import pytesseract
    from PIL import Image

    pil = Image.fromarray(img) if not hasattr(img, "save") else img
    pil = pil.convert("L")
    cfg = "--psm 6 -c tessedit_char_whitelist=NCSRALYBGncsral0123456789-.: "
    try:
        text = pytesseract.image_to_string(pil, lang="eng", config=cfg)
    except Exception:
        return ""
    # OCR склеивает пробелы: «NCSS2500-N» → «NCS S 2500-N»
    text = re.sub(r"N\s?C\s?S\s?S\s?(?=\d)", "NCS S ", text.upper())
    return re.sub(r"RAL\s?(?=\d)", "RAL ", text)
