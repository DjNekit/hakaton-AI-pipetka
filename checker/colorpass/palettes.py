"""Справочники цветовых систем и разбор обозначений цвета.

* RAL Classic — таблица ``data/ral_classic.csv`` (HEX-приближения в sRGB, источник см. README датасета).
* NCS — проверка синтаксиса и приближённый перевод в sRGB по модели смешения
  (белизна + чернота + хроматичность). Официальные значения NCS проприетарны,
  поэтому сравнения по NCS считаются приблизительными и используют более мягкий порог.
"""
from __future__ import annotations

import csv
import re
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path

import numpy as np

from .color import hex_to_rgb, srgb_to_lab

DATA_DIR = Path(__file__).resolve().parent / "data"


@dataclass(frozen=True)
class RalColor:
    code: str
    hex: str
    name_ru: str = ""

    @property
    def rgb(self) -> tuple[int, int, int]:
        return hex_to_rgb(self.hex)

    @property
    def lab(self) -> np.ndarray:
        return srgb_to_lab(self.rgb)


@lru_cache(maxsize=1)
def ral_table() -> dict[str, RalColor]:
    table: dict[str, RalColor] = {}
    with open(DATA_DIR / "ral_classic.csv", encoding="utf-8") as fh:
        for row in csv.DictReader(fh):
            table[row["code"]] = RalColor(row["code"], row["hex"], row.get("name_ru", "") or "")
    return table


def ral_lookup(code: str) -> RalColor | None:
    return ral_table().get(code.strip())


# --------------------------------------------------------------------------- NCS

# Элементарные цвета NCS (приближённо, sRGB)
_NCS_ELEMENTARY = {
    "Y": np.array([255.0, 211.0, 0.0]),
    "R": np.array([196.0, 2.0, 51.0]),
    "B": np.array([0.0, 135.0, 189.0]),
    "G": np.array([0.0, 159.0, 107.0]),
}
_NCS_NEXT = {"Y": "R", "R": "B", "B": "G", "G": "Y"}

NCS_RE = re.compile(
    r"(?:NCS\s*)?(?<![A-Za-zА-Яа-я])[SС]\s?(?P<s>\d{2})(?P<c>\d{2})\s?[-–]\s?(?P<hue>N|[YRBG](?:\d{2}[YRBG])?)(?![A-Za-z0-9])",
)
# Запись без префикса S допустима только после явного «NCS»
NCS_NOS_RE = re.compile(r"NCS\s+(?P<s>\d{2})(?P<c>\d{2})\s?[-–]\s?(?P<hue>N|[YRBG](?:\d{2}[YRBG])?)(?![A-Za-z0-9])")
RAL_RE = re.compile(r"(?:RAL|РАЛ)\s*[-–]?\s*(?P<code>\d{3}\s+\d{2}\s+\d{2}|\d{4})(?!\d)", re.IGNORECASE)


@dataclass
class NcsCode:
    raw: str
    blackness: int
    chromaticness: int
    hue: str
    errors: list[str] = field(default_factory=list)

    @property
    def notation(self) -> str:
        return f"S {self.blackness:02d}{self.chromaticness:02d}-{self.hue}"

    @property
    def valid(self) -> bool:
        return not self.errors

    @property
    def whiteness(self) -> int:
        return 100 - self.blackness - self.chromaticness


def validate_ncs(blackness: int, chromaticness: int, hue: str) -> list[str]:
    errors: list[str] = []
    if blackness + chromaticness > 100:
        errors.append(
            f"сумма черноты ({blackness}) и хроматичности ({chromaticness}) превышает 100"
        )
    if hue == "N":
        if chromaticness != 0:
            errors.append("для ахроматического тона N хроматичность должна быть 00")
    else:
        if chromaticness == 0:
            errors.append("при хроматичности 00 тон должен обозначаться N")
        if len(hue) == 4:
            a, pct, b = hue[0], int(hue[1:3]), hue[3]
            if _NCS_NEXT.get(a) != b:
                errors.append(f"недопустимый тон {hue}: после {a} в круге NCS идёт {_NCS_NEXT.get(a)}")
            if not 1 <= pct <= 99:
                errors.append(f"недопустимая доля тона в {hue}")
    return errors


def parse_ncs(text: str) -> NcsCode | None:
    m = NCS_RE.search(text) or NCS_NOS_RE.search(text)
    if not m:
        return None
    s, c, hue = int(m.group("s")), int(m.group("c")), m.group("hue")
    return NcsCode(m.group(0), s, c, hue, validate_ncs(s, c, hue))


def ncs_hue_rgb(hue: str) -> np.ndarray:
    if hue == "N":
        return np.array([128.0, 128.0, 128.0])
    if len(hue) == 1:
        return _NCS_ELEMENTARY[hue]
    a, pct, b = hue[0], int(hue[1:3]) / 100.0, hue[3]
    return _NCS_ELEMENTARY[a] * (1 - pct) + _NCS_ELEMENTARY[b] * pct


def ncs_to_rgb(code: NcsCode) -> np.ndarray:
    """Приближённый перевод NCS -> sRGB (модель аддитивного смешения в sRGB)."""
    s = code.blackness / 100.0
    c = code.chromaticness / 100.0
    w = max(0.0, 1.0 - s - c)
    full = ncs_hue_rgb(code.hue)
    rgb = w * np.array([255.0, 255.0, 255.0]) + c * full + s * np.array([0.0, 0.0, 0.0])
    # Ахроматические цвета NCS заметно светлее линейной модели — лёгкая гамма-коррекция
    return np.clip(255.0 * (rgb / 255.0) ** 0.9, 0, 255)


def ncs_to_lab(code: NcsCode) -> np.ndarray:
    return srgb_to_lab(ncs_to_rgb(code))


# --------------------------------------------------------------- Разбор строки


@dataclass
class ColorSpec:
    """Обозначение цвета элемента: всё, что удалось найти в ячейке/фразе."""

    raw: str
    ral: list[str] = field(default_factory=list)
    ncs: list[NcsCode] = field(default_factory=list)

    @property
    def empty(self) -> bool:
        return not self.ral and not self.ncs

    def reference_lab(self) -> tuple[np.ndarray | None, str]:
        """Эталонный Lab: приоритет RAL (точнее), затем NCS (приблизительно)."""
        for code in self.ral:
            ral = ral_lookup(code)
            if ral:
                return ral.lab, f"RAL {code}"
        for n in self.ncs:
            if n.valid:
                return ncs_to_lab(n), f"NCS {n.notation} (≈)"
        return None, ""

    def to_dict(self) -> dict:
        return {
            "raw": self.raw,
            "ral": list(self.ral),
            "ncs": [n.notation for n in self.ncs],
            "ncs_raw": [n.raw for n in self.ncs],
        }


def parse_color_spec(text: str) -> ColorSpec:
    text = text or ""
    spec = ColorSpec(raw=text.strip())
    for m in RAL_RE.finditer(text):
        code = " ".join(m.group("code").split())
        if code not in spec.ral:
            spec.ral.append(code)
    seen = set()
    for rx in (NCS_RE, NCS_NOS_RE):
        for m in rx.finditer(text):
            s, c, hue = int(m.group("s")), int(m.group("c")), m.group("hue")
            key = (s, c, hue)
            if key in seen:
                continue
            seen.add(key)
            spec.ncs.append(NcsCode(m.group(0), s, c, hue, validate_ncs(s, c, hue)))
    return spec


@lru_cache(maxsize=4)
def _ncs_grid(step: int) -> tuple[list[tuple[int, int, str]], np.ndarray]:
    hues = ["N"]
    for a in "YRBG":
        hues.append(a)
        for pct in range(10, 100, 10):
            hues.append(f"{a}{pct:02d}{_NCS_NEXT[a]}")
    keys: list[tuple[int, int, str]] = []
    for s in range(step, 91, step):
        for c in range(0, 101 - s, step):
            for hue in hues:
                if (hue == "N") != (c == 0):
                    continue
                keys.append((s, c, hue))
    labs = np.array([ncs_to_lab(NcsCode("", s, c, h)) for s, c, h in keys])
    return keys, labs


def nearest_ncs_for_lab(lab: np.ndarray, step: int = 5) -> NcsCode:
    """Подбор ближайшего (по приближённой модели) NCS-обозначения — для генератора тестовых данных."""
    from .color import delta_e2000

    keys, labs = _ncs_grid(step)
    d = delta_e2000(labs, np.asarray(lab, dtype=np.float64)[None, :])
    s, c, hue = keys[int(np.argmin(d))]
    code = NcsCode("", s, c, hue)
    code.raw = code.notation
    return code
