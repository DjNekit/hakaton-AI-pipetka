"""Проверки паспорта по формализованным требованиям (data/rules.yaml)."""
from __future__ import annotations

import logging
import re
from dataclasses import asdict, dataclass, field
from functools import lru_cache
from pathlib import Path
from typing import Callable

import numpy as np
import yaml

from .color import chroma, delta_e2000, rgb_to_hex, srgb_to_lab
from .extract import FinishRow, Passport, PAGE_KINDS, general_get
from .graphics import (
    RENDER_SCALE,
    ColorSample,
    facade_palette,
    glazing_groups,
    measure_box,
    sample_marker,
    union_bbox,
)
from .ingest import BBox, Document, PageData, norm_text
from .palettes import ColorSpec, ncs_to_lab, ral_lookup
from .textmatch import Mention, extract_mentions

log = logging.getLogger(__name__)
RULES_PATH = Path(__file__).resolve().parent / "data" / "rules.yaml"


@lru_cache(maxsize=1)
def load_rules() -> dict:
    with open(RULES_PATH, encoding="utf-8") as fh:
        return yaml.safe_load(fh)


@dataclass
class Finding:
    rule: str
    severity: str
    message: str
    page: int | None = None
    bbox: BBox | None = None
    element: str | None = None
    expected: str | None = None
    actual: str | None = None
    delta_e: float | None = None
    evidence: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        d = asdict(self)
        if d["bbox"] is not None:
            d["bbox"] = [round(v, 1) for v in d["bbox"]]
        if d["delta_e"] is not None:
            d["delta_e"] = round(float(d["delta_e"]), 1)
        return d


@dataclass
class RuleResult:
    rule: str
    status: str  # ok | fail | warn | skip
    findings: list[Finding] = field(default_factory=list)
    note: str = ""


class Context:
    def __init__(self, doc: Document, passport: Passport):
        self.doc = doc
        self.p = passport
        self.rules = load_rules()
        self.th = self.rules["thresholds"]
        self.mentions: list[Mention] = []
        self.mentions_source = "rules"
        self.swatches: dict[str, ColorSample] = {}
        self.marker_samples: list[dict] = []
        self.palettes: dict[int, list[dict]] = {}
        self._img: dict[int, np.ndarray] = {}

    def img(self, page: int) -> np.ndarray:
        if page not in self._img:
            self._img[page] = self.doc.render(page, RENDER_SCALE)
        return self._img[page]

    def severity(self, rule: str) -> str:
        return self.rules["rules"][rule].get("severity", "error")

    def f(self, rule: str, message: str, severity: str | None = None, **kw) -> Finding:
        return Finding(rule=rule, severity=severity or self.severity(rule), message=message, **kw)


# ----------------------------------------------------------------- утилиты


def norm_address(s: str | None) -> str:
    s = (s or "").lower().replace("ё", "е")
    repl = {
        r"\bгород\b": "г",
        r"\bулица\b": "ул",
        r"\bдом\b": "д",
        r"\bкорпус\b": "корп",
        r"\bстроение\b": "стр",
        r"\bпроезд\b": "пр",
    }
    for a, b in repl.items():
        s = re.sub(a, b, s)
    s = re.sub(r"\bг\.?\s*москва\b|\bмосква\b", "", s)
    return re.sub(r"[^0-9a-zа-я]", "", s)


def find_text_bbox(page: PageData, needle: str) -> BBox | None:
    """bbox строки, начинающейся со слова needle (например, «Автор»)."""
    for w in page.words:
        if w.text.lower().startswith(needle.lower()):
            same = [x for x in page.words if abs(x.top - w.top) < 3 and x.x0 >= w.x0 - 1]
            return union_bbox([x.bbox for x in same])
    return None


def row_reference(row: FinishRow, th: dict) -> tuple[np.ndarray | None, str, float]:
    """Эталонный Lab элемента + подпись + множитель порога (NCS — приближённо)."""
    lab, label = row.marks.reference_lab()
    factor = th["delta_e_ncs_factor"] if label.startswith("NCS") else 1.0
    return lab, label, factor


def _lab_hex(lab: np.ndarray) -> str:
    from .color import lab_to_srgb

    return rgb_to_hex(lab_to_srgb(lab))


# ----------------------------------------------------------------- комплектность


def check_sections(ctx: Context) -> RuleResult:
    present = {k for kinds in ctx.p.pages.values() for k in kinds}
    res = RuleResult("CMP-01", "ok")
    for kind, title in ctx.rules["required_sections"].items():
        if kind not in present:
            res.findings.append(ctx.f("CMP-01", f"Не найден раздел: {title}", expected=title, actual="отсутствует"))
    return res


def _norm_facade(name: str) -> str:
    name = norm_text(name).lower().replace("—", "-").replace("–", "-")
    name = re.sub(r"\(.*?\)", "", name)
    return re.sub(r"\s+", "", name)


def check_facades(ctx: Context) -> RuleResult:
    res = RuleResult("CMP-02", "ok")
    sheets = ctx.p.facades
    names = {_norm_facade(f.name) for f in sheets}
    listed = ctx.p.facade_list
    named = [f for f in sheets if re.search(r"фасад\s*\S+\s*[–-]\s*\S+", f.name, re.IGNORECASE)]
    if sheets and not listed and not named:
        return RuleResult(
            "CMP-02",
            "skip",
            note="Развёртки не подписаны (нет названий вида «Фасад 1–6») и перечня нет — полноту набора фасадов проверьте вручную",
        )
    for item in listed:
        if _norm_facade(item) not in names:
            res.findings.append(ctx.f("CMP-02", f"Развёртка «{item}» указана в перечне, но лист отсутствует", expected=item, actual="нет листа"))
    need = max(int(ctx.th["min_facades"]), len(listed)) if named else len(listed)
    if len(sheets) < need and not res.findings:
        res.findings.append(
            ctx.f("CMP-02", f"Представлено развёрток: {len(sheets)}, требуется не менее {need} (все фасады)", expected=str(need), actual=str(len(sheets)))
        )
    return res


# ----------------------------------------------------------------- общие сведения


def check_general_fields(ctx: Context) -> RuleResult:
    res = RuleResult("GEN-01", "ok")
    if not ctx.p.general:
        return RuleResult("GEN-01", "skip", note="Раздел «Общие сведения» не найден (см. CMP-01)")
    page = ctx.doc.pages[ctx.p.general_page] if ctx.p.general_page is not None else None
    for field_name in ctx.rules["required_general_fields"]:
        value = general_get(ctx.p.general, field_name)
        if value is None:
            res.findings.append(ctx.f("GEN-01", f"Нет поля «{field_name}» в общих сведениях", page=ctx.p.general_page, expected=field_name, actual="поле отсутствует"))
        elif not value.strip(" .") or value.strip(" .") in ("-", "—"):
            bbox = find_text_bbox(page, field_name.split()[0]) if page else None
            res.findings.append(ctx.f("GEN-01", f"Не заполнено поле «{field_name}»", page=ctx.p.general_page, bbox=bbox, expected="значение", actual="пусто"))
    for k in ("Номер", "Дата", "Адрес"):
        if not ctx.p.title.get(k) and "title" in {x for v in ctx.p.pages.values() for x in v}:
            res.findings.append(ctx.f("GEN-01", f"На титульном листе не указано: {k.lower()}", page=0))
    return res


def check_address(ctx: Context) -> RuleResult:
    res = RuleResult("GEN-02", "ok")
    ref = ctx.p.title.get("Адрес") or general_get(ctx.p.general, "Адрес объекта")
    if not ref:
        return RuleResult("GEN-02", "skip", note="Адрес объекта не найден")
    ref_n = norm_address(ref)
    gen_addr = general_get(ctx.p.general, "Адрес объекта")
    if gen_addr and norm_address(gen_addr) != ref_n:
        page = ctx.doc.pages[ctx.p.general_page] if ctx.p.general_page is not None else None
        res.findings.append(
            ctx.f(
                "GEN-02",
                "Адрес в разделе I не совпадает с адресом на титульном листе",
                page=ctx.p.general_page,
                bbox=find_text_bbox(page, "Адрес") if page else None,
                expected=ref,
                actual=gen_addr,
            )
        )
    for fs in ctx.p.facades:
        if fs.stamp_address and norm_address(fs.stamp_address) != ref_n:
            res.findings.append(
                ctx.f(
                    "GEN-02",
                    f"Адрес в штампе листа «{fs.name}» не совпадает с адресом объекта",
                    page=fs.page,
                    bbox=find_text_bbox(ctx.doc.pages[fs.page], "Адрес"),
                    expected=ref,
                    actual=fs.stamp_address,
                )
            )
    return res


# ----------------------------------------------------------------- графическая часть: оформление


def check_stamps(ctx: Context) -> RuleResult:
    res = RuleResult("GRF-01", "ok")
    if not ctx.p.facades:
        return RuleResult("GRF-01", "skip", note="Нет листов развёрток")
    for fs in ctx.p.facades:
        page = ctx.doc.pages[fs.page]
        for label, value in (("Адрес объекта", fs.stamp_address), ("Автор проекта", fs.stamp_author)):
            if not value:
                res.findings.append(
                    ctx.f(
                        "GRF-01",
                        f"На листе «{fs.name}» не указан {('адрес объекта' if label.startswith('Адрес') else 'автор проекта')}",
                        page=fs.page,
                        bbox=find_text_bbox(page, label.split()[0]),
                        expected=label,
                        actual="пусто",
                    )
                )
    return res


def check_scale(ctx: Context) -> RuleResult:
    res = RuleResult("GRF-02", "ok")
    if not ctx.p.facades:
        return RuleResult("GRF-02", "skip", note="Нет листов развёрток")
    allowed = set(ctx.rules["allowed_scales"])
    for fs in ctx.p.facades:
        page = ctx.doc.pages[fs.page]
        if not fs.scale:
            res.findings.append(ctx.f("GRF-02", f"На листе «{fs.name}» не указан масштаб", page=fs.page, expected=", ".join(sorted(allowed)), actual="нет"))
        elif fs.scale not in allowed:
            res.findings.append(
                ctx.f(
                    "GRF-02",
                    f"Масштаб {fs.scale} на листе «{fs.name}» не из допустимого ряда",
                    page=fs.page,
                    bbox=find_text_bbox(page, "Масштаб") or find_text_bbox(page, "М"),
                    expected=", ".join(sorted(allowed, key=lambda s: int(s.split(':')[1]))),
                    actual=fs.scale,
                )
            )
    return res


def check_glazing(ctx: Context) -> RuleResult:
    res = RuleResult("GRF-03", "ok")
    found_any = False
    for fs in ctx.p.facades:
        page = ctx.doc.pages[fs.page]
        groups = glazing_groups(page)
        for g in groups:
            found_any = True
            lab = srgb_to_lab(g.fill_rgb)
            c = chroma(lab)
            if c > ctx.th["glazing_max_chroma"]:
                res.findings.append(
                    ctx.f(
                        "GRF-03",
                        f"Остекление на листе «{fs.name}» залито не серым цветом ({rgb_to_hex(g.fill_rgb)}, C*={c:.0f})",
                        page=fs.page,
                        bbox=union_bbox(g.boxes),
                        expected=f"серый (C* ≤ {ctx.th['glazing_max_chroma']})",
                        actual=rgb_to_hex(g.fill_rgb),
                        evidence={"actual_hex": rgb_to_hex(g.fill_rgb), "boxes": [list(map(lambda v: round(v, 1), b)) for b in g.boxes[:40]]},
                    )
                )
    if not found_any and ctx.p.facades:
        if all(ctx.doc.pages[f.page].is_scan for f in ctx.p.facades):
            return RuleResult("GRF-03", "skip", note="Развёртки — скан: заливка остекления проверяется только в векторных PDF, проверьте вручную")
        return RuleResult("GRF-03", "skip", note="Остекление не распознано (векторные окна не найдены)")
    return res


def check_forbidden(ctx: Context) -> RuleResult:
    res = RuleResult("GRF-04", "ok")
    pats = ctx.rules["forbidden_patterns"]
    titles = {
        "height_marks": "высотные отметки",
        "equipment": "навесное оборудование",
        "advertising": "рекламные/информационные конструкции",
    }
    for fs in ctx.p.facades:
        page = ctx.doc.pages[fs.page]
        for key, pat in pats.items():
            rx = re.compile(pat, re.IGNORECASE)
            hits = [w for w in page.words if rx.search(w.text)]
            if key != "height_marks":
                text_hits = rx.findall(norm_text(page.text))
                if not text_hits:
                    hits = []
            if hits:
                res.findings.append(
                    ctx.f(
                        "GRF-04",
                        f"На развёртке «{fs.name}» обнаружены {titles[key]}: " + ", ".join(sorted({w.text for w in hits})[:6]),
                        page=fs.page,
                        bbox=union_bbox([w.bbox for w in hits]),
                        expected="отсутствуют",
                        actual=", ".join(sorted({w.text for w in hits})[:6]),
                    )
                )
    return res


def check_scans(ctx: Context) -> RuleResult:
    res = RuleResult("GRF-05", "ok")
    scans = [p for p in ctx.doc.pages if p.is_scan]
    if not scans:
        return RuleResult("GRF-05", "skip", note="Сканированных листов нет (векторный PDF)")
    low_err, low_warn = [], []
    for p in scans:
        big = [im for im in p.images if (im.bbox[2] - im.bbox[0]) * (im.bbox[3] - im.bbox[1]) > 0.05 * p.width * p.height]
        dpi = min(im.dpi for im in big) if big else 0
        if dpi < ctx.th["scan_dpi_error"] - 1:
            low_err.append((p.index, dpi))
        elif dpi < ctx.th["scan_dpi_warn"] - 1:
            low_warn.append((p.index, dpi))
    for items, sev, limit in ((low_err, "error", ctx.th["scan_dpi_error"]), (low_warn, "warning", ctx.th["scan_dpi_warn"])):
        if items:
            pages = ", ".join(str(i + 1) for i, _ in items)
            dpis = sorted({round(d) for _, d in items})
            res.findings.append(
                ctx.f(
                    "GRF-05",
                    f"Разрешение растровых листов ({pages}) — {', '.join(map(str, dpis))} dpi, менее {limit} dpi",
                    severity=sev,
                    page=items[0][0],
                    expected=f"≥ {limit} dpi",
                    actual=f"{min(dpis)} dpi",
                    evidence={"pages": [i for i, _ in items]},
                )
            )
    return res


# ----------------------------------------------------------------- таблица отделки

_NO_COLOR = re.compile(r"без (цветового кода|окраски)|неокраш|натуральн\w* (камн|цвет)|очистк", re.IGNORECASE)


def _no_color_expected(row: FinishRow) -> bool:
    return bool(_NO_COLOR.search(" ".join([row.marks.raw, row.note, row.material])))


def _template_row(r: FinishRow) -> bool:
    """Строка-шаблон формы («Указан примерный перечень элементов»): нет ни образца, ни марки, ни материала."""
    return r.marks.empty and r.swatch_bbox is None and not r.material.strip() and not re.search(r"\d{3,}", r.marks.raw)


def check_both_palettes(ctx: Context) -> RuleResult:
    res = RuleResult("TAB-01", "ok")
    if not ctx.p.finish_rows:
        return RuleResult("TAB-01", "skip", note="Таблица отделки не распознана")
    for r in ctx.p.finish_rows:
        if r.marks.empty and _no_color_expected(r):
            continue
        if _template_row(r) or (r.marks.empty and r.swatch_bbox is None and r.codes_source == ""):
            continue  # элемент не применяется (строка-шаблон или материал без окраски, например «кровля рулонная»)
        missing = [name for name, codes in (("NCS", r.marks.ncs), ("RAL", r.marks.ral)) if not codes]
        if missing:
            scan = ctx.doc.pages[r.page].is_scan
            res.findings.append(
                ctx.f(
                    "TAB-01",
                    f"Поз. {r.n} «{r.name}»: не указана марка цвета по {' и '.join(missing)}"
                    + (" (возможно, код не распознан на скане — проверьте вручную)" if scan else ""),
                    severity="warning" if scan else None,
                    page=r.page,
                    bbox=r.marks_bbox,
                    element=r.n,
                    expected="NCS и RAL",
                    actual=r.marks.raw or "пусто",
                )
            )
    return res


def check_ral_codes(ctx: Context) -> RuleResult:
    res = RuleResult("TAB-02", "ok")
    for r in ctx.p.finish_rows:
        for code in r.marks.ral:
            if not ral_lookup(code):
                res.findings.append(
                    ctx.f("TAB-02", f"Поз. {r.n} «{r.name}»: код RAL {code} отсутствует в палитре RAL Classic", page=r.page, bbox=r.marks_bbox, element=r.n, actual=f"RAL {code}")
                )
    return res


def check_ncs_codes(ctx: Context) -> RuleResult:
    res = RuleResult("TAB-03", "ok")
    for r in ctx.p.finish_rows:
        for n in r.marks.ncs:
            if not n.valid:
                res.findings.append(
                    ctx.f(
                        "TAB-03",
                        f"Поз. {r.n} «{r.name}»: некорректное обозначение NCS {n.notation} — {'; '.join(n.errors)}",
                        page=r.page,
                        bbox=r.marks_bbox,
                        element=r.n,
                        actual=n.notation,
                    )
                )
    return res


def check_pairs(ctx: Context) -> RuleResult:
    res = RuleResult("TAB-04", "ok")
    for r in ctx.p.finish_rows:
        rals = [ral_lookup(c) for c in r.marks.ral if ral_lookup(c)]
        ncs = [n for n in r.marks.ncs if n.valid]
        if not rals or not ncs:
            continue
        de = float(delta_e2000(ncs_to_lab(ncs[0]), rals[0].lab))
        if de > ctx.th["delta_e_pair_warn"]:
            res.findings.append(
                ctx.f(
                    "TAB-04",
                    f"Поз. {r.n} «{r.name}»: NCS {ncs[0].notation} и RAL {rals[0].code} обозначают разные цвета (ΔE≈{de:.0f})",
                    page=r.page,
                    bbox=r.marks_bbox,
                    element=r.n,
                    expected=f"RAL {rals[0].code} ≈ NCS",
                    actual=ncs[0].notation,
                    delta_e=de,
                    evidence={"expected_hex": rals[0].hex, "actual_hex": _lab_hex(ncs_to_lab(ncs[0]))},
                )
            )
    return res


def check_swatches(ctx: Context) -> RuleResult:
    res = RuleResult("TAB-05", "ok")
    measured = 0
    scanned: dict[str, list[tuple[FinishRow, ColorSample, float]]] = {}
    for r in ctx.p.finish_rows:
        if not r.swatch_bbox:
            continue
        sample = measure_box(ctx.img(r.page), r.swatch_bbox)
        if sample is None:
            continue
        ctx.swatches[r.n] = sample
        ref, label, factor = row_reference(r, ctx.th)
        if ref is None:
            continue
        measured += 1
        de = float(delta_e2000(sample.lab, ref))
        ev = {"expected_hex": _lab_hex(ref), "actual_hex": sample.hex}
        if ctx.doc.pages[r.page].is_scan:
            scanned.setdefault(label, []).append((r, sample, de))
            continue
        warn, err = ctx.th["delta_e_swatch_warn"] * factor, ctx.th["delta_e_swatch_error"] * factor
        is_blank = sample.lab[0] > 96 and chroma(sample.lab) < 4
        if is_blank and de > warn:
            res.findings.append(
                ctx.f("TAB-05", f"Поз. {r.n} «{r.name}»: образец цвета не приведён", severity="warning", page=r.page, bbox=r.swatch_bbox, element=r.n, expected=label, actual="пусто", delta_e=de, evidence=ev)
            )
        elif de > err:
            res.findings.append(
                ctx.f("TAB-05", f"Поз. {r.n} «{r.name}»: образец цвета не соответствует марке {label} (ΔE00={de:.1f})", page=r.page, bbox=r.swatch_bbox, element=r.n, expected=label, actual=sample.hex, delta_e=de, evidence=ev)
            )
        elif de > warn:
            res.findings.append(
                ctx.f("TAB-05", f"Поз. {r.n} «{r.name}»: образец цвета заметно отличается от марки {label} (ΔE00={de:.1f})", severity="warning", page=r.page, bbox=r.swatch_bbox, element=r.n, expected=label, actual=sample.hex, delta_e=de, evidence=ev)
            )
    # Сканы: цвет образца искажён сканером, поэтому оцениваем образцы одной марки вместе (по медиане ΔE)
    # и выделяем отдельные образцы, резко отличающиеся от остальных образцов той же марки.
    for label, items in scanned.items():
        factor = (ctx.th["delta_e_ncs_factor"] if label.startswith("NCS") else 1.0) * ctx.th.get("scan_color_factor", 1.5)
        warn, err = ctx.th["delta_e_swatch_warn"] * factor, ctx.th["delta_e_swatch_error"] * factor
        des = sorted(d for _, _, d in items)
        median = des[len(des) // 2]
        first_r, first_s, _ = items[0]
        ev = {"expected_hex": _lab_hex(row_reference(first_r, ctx.th)[0]), "actual_hex": first_s.hex}
        if median > warn:
            rows_txt = ", ".join(f"поз. {r.n}" for r, _, _ in items)
            res.findings.append(
                ctx.f(
                    "TAB-05",
                    f"Образцы марки {label} ({rows_txt}) отличаются от эталона: ΔE00 {des[0]:.0f}–{des[-1]:.0f} (скан — проверьте вручную)",
                    severity="warning",
                    page=first_r.page,
                    bbox=first_r.swatch_bbox,
                    element=first_r.n,
                    expected=label,
                    actual=first_s.hex,
                    delta_e=median,
                    evidence=ev,
                )
            )
        for r, sample, de in items:
            if de > err and de > median + 8:
                res.findings.append(
                    ctx.f(
                        "TAB-05",
                        f"Поз. {r.n} «{r.name}»: образец цвета не соответствует марке {label} (ΔE00={de:.1f}; другие образцы этой марки — около {median:.0f})",
                        severity="warning",
                        page=r.page,
                        bbox=r.swatch_bbox,
                        element=r.n,
                        expected=label,
                        actual=sample.hex,
                        delta_e=de,
                        evidence={"expected_hex": _lab_hex(row_reference(r, ctx.th)[0]), "actual_hex": sample.hex},
                    )
                )
    if not measured:
        return RuleResult("TAB-05", "skip", note="Образцы цвета не найдены")
    return res


def check_materials(ctx: Context) -> RuleResult:
    res = RuleResult("TAB-06", "ok")
    for r in ctx.p.finish_rows:
        if _template_row(r):
            continue
        if not r.material.strip():
            bbox = None
            if r.row_bbox:
                bbox = r.row_bbox
            res.findings.append(ctx.f("TAB-06", f"Поз. {r.n} «{r.name}»: не указан материал / вид отделки", page=r.page, bbox=bbox, element=r.n, actual="пусто"))
    return res


# ----------------------------------------------------------------- пояснительная записка


def check_note_vs_table(ctx: Context) -> RuleResult:
    res = RuleResult("TXT-01", "ok")
    if not ctx.p.note_text or not ctx.p.finish_rows:
        return RuleResult("TXT-01", "skip", note="Нет пояснительной записки или таблицы отделки")
    ctx.mentions, ctx.mentions_source = extract_mentions(ctx.p.note_text, ctx.p.finish_rows), "rules"
    note_page = ctx.p.note_pages[0] if ctx.p.note_pages else None
    reported: set[tuple] = set()
    for m in ctx.mentions:
        for n in m.elements:
            row = ctx.p.row_by_n(n)
            if not row:
                continue
            problems = []
            row_ral_valid = [c for c in row.marks.ral if ral_lookup(c)]
            # если код в таблице не существует (TAB-02), расхождение с запиской — следствие той же ошибки
            if m.ral and row_ral_valid and not set(m.ral) & set(row.marks.ral):
                problems.append(("RAL", ", ".join(m.ral), ", ".join(row.marks.ral)))
            row_ncs = {c.notation for c in row.marks.ncs}
            if m.ncs and row_ncs and not set(m.ncs) & row_ncs:
                problems.append(("NCS", ", ".join(m.ncs), ", ".join(sorted(row_ncs))))
            for pal, in_note, in_table in problems:
                key = (n, pal, in_note)
                if key in reported:
                    continue
                reported.add(key)
                bbox = None
                if note_page is not None:
                    page = ctx.doc.pages[note_page]
                    hits = [w for w in page.words if in_note.split(",")[0].strip() in w.text]
                    bbox = union_bbox([w.bbox for w in hits[:2]]) if hits else None
                res.findings.append(
                    ctx.f(
                        "TXT-01",
                        f"Поз. {n} «{row.name}»: в пояснительной записке {pal} {in_note}, в таблице отделки — {pal} {in_table}",
                        page=note_page,
                        bbox=bbox,
                        element=n,
                        expected=f"{pal} {in_table}",
                        actual=f"{pal} {in_note}",
                        evidence={"quote": m.quote, "source": m.source},
                    )
                )
    return res


# ----------------------------------------------------------------- состав пояснительной записки

NOTE_ELEMENTS = [
    ("2.1", "Кровля", r"кровл"),
    ("2.2", "Стены", r"стен"),
    ("2.3", "Ограждение балконов и лоджий", r"огражден\w* балкон"),
    ("2.4", "Оконные блоки", r"оконн"),
    ("2.5", "Дверные блоки", r"дверн"),
    ("2.6", "Цоколь", r"цокол"),
    ("2.7", "Лестницы", r"лестниц"),
    ("2.8", "Архитектурные детали", r"архитектурн\w* детал"),
    ("2.9", "Иные поверхности", r"ин\w+ поверхност"),
]
NOTE_ASPECTS = {
    "форма здания в плане": r"в плане|прямоугольн|квадратн|г-образн|п-образн|сложн\w* формы",
    "колористика": r"колористик|цвет|окрас",
    "этажность или назначение": r"этаж|жил\w* дом|магазин|школ|здани\w+ (?:администрат|торгов|обществ)",
    "архитектурные детали": r"детал|колонн|карниз|пилястр|декор|входн\w* групп|витрин|балкон|эркер",
}
_NOTE_TEMPLATE = re.compile(
    r"текстовая часть, содержащая информацию.*?\(подтверждается материалами фотофиксации\)", re.I | re.S
)


def _note_sections(text: str) -> tuple[str | None, str | None]:
    """Делит раздел III на п. 1 (характеристика) и п. 2 (существующее состояние). None — пункт не найден."""
    t = norm_text(text)
    m1 = re.search(r"(?<![\d.])1\.\s*текстовая часть", t, re.I)
    m2 = re.search(r"(?<![\d.])2\.\s*существующее состояние", t, re.I)
    part1 = part2 = None
    if m1:
        part1 = t[m1.start(): m2.start() if m2 and m2.start() > m1.start() else len(t)]
        part1 = _NOTE_TEMPLATE.sub("", part1)
        part1 = re.sub(r"^\s*1\.\s*", "", part1)
    if m2:
        end = re.search(r"(?<![\d.])3\.\s*фотофиксаци|паспорт №", t[m2.end():], re.I)
        part2 = t[m2.start(): m2.end() + (end.start() if end else len(t))]
    return part1, part2


def check_note_content(ctx: Context) -> RuleResult:
    """TXT-02: в п. 2 раздела III заполнено существующее состояние по всем элементам формы."""
    res = RuleResult("TXT-02", "ok")
    if not ctx.p.note_text:
        return RuleResult("TXT-02", "skip", note="Пояснительная записка не найдена (см. CMP-01)")
    _, part2 = _note_sections(ctx.p.note_text)
    page = ctx.p.note_pages[0] if ctx.p.note_pages else None
    if part2 is None:
        res.findings.append(ctx.f("TXT-02", "В пояснительной записке нет п. 2 «Существующее состояние фасадов объекта (материал, колористика)»", page=page))
        return res
    for i, (num, name, pat) in enumerate(NOTE_ELEMENTS):
        m = re.search(rf"{re.escape(num)}\.?\s*[^:;]{{0,40}}?{pat}[^:]{{0,40}}:\s*", part2, re.I)
        if not m:
            res.findings.append(ctx.f("TXT-02", f"П. {num} «{name}»: нет в описании существующего состояния", page=page, element=num))
            continue
        nxt = re.search(r"(?<![\d.])2\.\d\.?\s|паспорт №", part2[m.end():], re.I)
        value = part2[m.end(): m.end() + (nxt.start() if nxt else 200)].strip(" ;.,")
        if len(re.sub(r"[^\wА-Яа-яЁё]", "", value)) < 2:
            res.findings.append(ctx.f("TXT-02", f"П. {num} «{name}»: не заполнено (укажите материал и цвет или «нет»)", page=page, element=num))
    return res


def check_note_description(ctx: Context) -> RuleResult:
    """TXT-03: п. 1 раздела III — описание стилистики, формы в плане, колористики, деталей, а не только заголовок формы."""
    res = RuleResult("TXT-03", "ok")
    if not ctx.p.note_text:
        return RuleResult("TXT-03", "skip", note="Пояснительная записка не найдена (см. CMP-01)")
    part1, _ = _note_sections(ctx.p.note_text)
    page = ctx.p.note_pages[0] if ctx.p.note_pages else None
    if part1 is None:
        res.findings.append(ctx.f("TXT-03", "В пояснительной записке нет п. 1 — текстовой характеристики объекта", page=page))
        return res
    words = re.findall(r"[А-Яа-яЁёA-Za-z]{3,}", part1)
    if len(words) < 15:
        res.findings.append(ctx.f("TXT-03", f"Характеристика объекта почти не заполнена ({len(words)} слов)", page=page))
        return res
    missing = [name for name, pat in NOTE_ASPECTS.items() if not re.search(pat, part1, re.I)]
    if missing:
        res.findings.append(ctx.f("TXT-03", "В характеристике объекта не описано: " + ", ".join(missing), page=page,
                                  severity="warning", evidence={"words": len(words)}))
    return res


# ----------------------------------------------------------------- архитектурно-художественные концепции


def check_ahk(ctx: Context) -> RuleResult:
    """AHK-01: объект на улице с утверждённой АХК — сведения и ссылка для сверки (решение принимает специалист)."""
    from .ahk import AHK_URL, find_ahk

    address = ctx.p.title.get("Адрес") or general_get(ctx.p.general, "Адрес объекта")
    if not address:
        return RuleResult("AHK-01", "skip", note="Адрес объекта не найден")
    hit = find_ahk(address)
    if not hit:
        return RuleResult("AHK-01", "ok", note="Улицы объекта нет в перечне улиц с утверждёнными АХК")
    since = ".".join(reversed(hit.since.split("-")))
    msg = (f"Объект на улице с утверждённой архитектурно-художественной концепцией: {hit.street} "
           f"(этап {hit.stage}, {hit.zone}, действует с {since}). Решения по фасаду и вывескам сверить с альбомом АХК")
    res = RuleResult("AHK-01", "ok", note=msg)
    res.findings.append(ctx.f("AHK-01", msg, page=ctx.p.general_page, evidence={"street": hit.street, "url": AHK_URL}))
    return res


# ----------------------------------------------------------------- развёртки ↔ таблица


def check_zone_colors(ctx: Context) -> RuleResult:
    res = RuleResult("DRW-01", "ok")
    sampled = 0
    for fs in ctx.p.facades:
        page = ctx.doc.pages[fs.page]
        img = ctx.img(fs.page)
        for mk in fs.markers:
            row = ctx.p.row_by_n(mk.label)
            if not row:
                continue
            sample = sample_marker(img, mk, [m for m in fs.markers if m is not mk], page)
            if sample is None:
                continue
            ref, label, factor = row_reference(row, ctx.th)
            if ref is None and row.n in ctx.swatches:
                ref, label, factor = ctx.swatches[row.n].lab, "образец цвета", 1.0
            if ref is None:
                continue
            de = float(delta_e2000(sample.lab, ref))
            background = sample.lab[0] > 94 and chroma(sample.lab) < 6
            if mk.target is None and background and de > ctx.th["delta_e_zone_error"]:
                # кольцо вокруг выноски попало на фон листа — цвет зоны определить нельзя
                ctx.marker_samples.append({"page": fs.page, "facade": fs.name, "marker": mk.label, "element": row.name, "undetermined": True})
                continue
            sampled += 1
            info = {
                "page": fs.page,
                "facade": fs.name,
                "marker": mk.label,
                "element": row.name,
                "expected": label,
                "expected_hex": _lab_hex(ref),
                "actual_hex": sample.hex,
                "delta_e": round(de, 1),
                "bbox": [round(v, 1) for v in sample.area_bbox],
                "marker_bbox": [round(v, 1) for v in mk.bbox],
            }
            ctx.marker_samples.append(info)
            if de > ctx.th["delta_e_zone_error"] * factor:
                bbox = union_bbox([sample.area_bbox, mk.bbox])
                res.findings.append(
                    ctx.f(
                        "DRW-01",
                        f"«{fs.name}», выноска {mk.label} («{row.name}»): цвет на развёртке {sample.hex} не соответствует {label} (ΔE00={de:.1f})",
                        page=fs.page,
                        bbox=bbox,
                        element=row.n,
                        expected=label,
                        actual=sample.hex,
                        delta_e=de,
                        evidence={"expected_hex": info["expected_hex"], "actual_hex": sample.hex, "lab": [round(v, 1) for v in sample.lab]},
                    )
                )
    if not sampled:
        if not any(fs.markers for fs in ctx.p.facades):
            return RuleResult("DRW-01", "skip", note="На развёртках нет выносок с номерами позиций — цвета зон сверяются только через палитру (DRW-02)")
        return RuleResult("DRW-01", "skip", note="Цвет зон по выноскам определить не удалось")
    return res


def check_markers(ctx: Context) -> RuleResult:
    res = RuleResult("DRW-03", "ok")
    if not ctx.p.facades:
        return RuleResult("DRW-03", "skip", note="Нет листов развёрток")
    if not ctx.p.finish_rows:
        return RuleResult("DRW-03", "skip", note="Таблица отделки не распознана")
    for fs in ctx.p.facades:
        for mk in fs.markers:
            if not ctx.p.row_by_n(mk.label):
                res.findings.append(
                    ctx.f("DRW-03", f"«{fs.name}»: выноска № {mk.label} ссылается на отсутствующую позицию таблицы отделки", page=fs.page, bbox=mk.bbox, element=mk.label, actual=f"№ {mk.label}")
                )
    return res


def check_undeclared(ctx: Context, prior: list[Finding]) -> RuleResult:
    res = RuleResult("DRW-02", "ok")
    if not ctx.p.facades:
        return RuleResult("DRW-02", "skip", note="Нет листов развёрток")
    declared: list[np.ndarray] = []
    for r in ctx.p.finish_rows:
        added = False
        for code in r.marks.ral:
            ral = ral_lookup(code)
            if ral:
                declared.append(ral.lab)
                added = True
        for n in r.marks.ncs:
            if n.valid:
                declared.append(ncs_to_lab(n))
                added = True
        if not added and r.n in ctx.swatches:
            declared.append(ctx.swatches[r.n].lab)
    if not declared:
        return RuleResult("DRW-02", "skip", note="Нет заявленных цветов")
    declared_arr = np.array(declared)
    explained: dict[int, list[np.ndarray]] = {}
    for f in prior:
        if f.rule in ("DRW-01",) and f.page is not None and "lab" in f.evidence:
            explained.setdefault(f.page, []).append(np.array(f.evidence["lab"]))
        if f.rule == "GRF-03" and f.page is not None and f.evidence.get("actual_hex"):
            from .color import hex_to_rgb

            explained.setdefault(f.page, []).append(srgb_to_lab(hex_to_rgb(f.evidence["actual_hex"])))
    for fs in ctx.p.facades:
        page = ctx.doc.pages[fs.page]
        scan = page.is_scan
        limit = ctx.th["delta_e_undeclared"]  # на сканах порог тот же, но замечание — предупреждение
        clusters = facade_palette(ctx.img(fs.page), page, fs.markers, min_share=ctx.th["undeclared_min_share"])
        rows = []
        for cl in clusters:
            de = delta_e2000(declared_arr, cl.lab)
            min_de = float(np.min(de))
            is_glazing = chroma(cl.lab) <= ctx.th["glazing_max_chroma"] and 30 < cl.lab[0] < 88
            rows.append({"hex": cl.hex, "share": round(cl.share, 4), "min_de": round(min_de, 1), "glazing_like": bool(is_glazing)})
            if min_de <= limit or is_glazing:
                continue
            if any(float(delta_e2000(e, cl.lab)) < 8 for e in explained.get(fs.page, [])):
                continue
            res.findings.append(
                ctx.f(
                    "DRW-02",
                    f"«{fs.name}»: цвет {cl.hex} (≈{cl.share * 100:.1f}% закрашенной площади) не заявлен в таблице отделки (ближайший заявленный ΔE00={min_de:.1f})"
                    + (" — скан, проверьте вручную" if scan else ""),
                    severity="warning" if scan else None,
                    page=fs.page,
                    bbox=union_bbox(cl.boxes),
                    expected="цвет из таблицы отделки",
                    actual=cl.hex,
                    delta_e=min_de,
                    evidence={"actual_hex": cl.hex, "boxes": [[round(v, 1) for v in b] for b in cl.boxes]},
                )
            )
        ctx.palettes[fs.page] = rows
    return res


# ----------------------------------------------------------------- запуск

ORDER: list[tuple[str, Callable]] = [
    ("CMP-01", check_sections),
    ("CMP-02", check_facades),
    ("GEN-01", check_general_fields),
    ("GEN-02", check_address),
    ("GRF-01", check_stamps),
    ("GRF-02", check_scale),
    ("GRF-03", check_glazing),
    ("GRF-04", check_forbidden),
    ("GRF-05", check_scans),
    ("TAB-01", check_both_palettes),
    ("TAB-02", check_ral_codes),
    ("TAB-03", check_ncs_codes),
    ("TAB-04", check_pairs),
    ("TAB-05", check_swatches),
    ("TAB-06", check_materials),
    ("TXT-01", check_note_vs_table),
    ("TXT-02", check_note_content),
    ("TXT-03", check_note_description),
    ("AHK-01", check_ahk),
    ("DRW-01", check_zone_colors),
    ("DRW-03", check_markers),
]


def run_checks(ctx: Context) -> list[RuleResult]:
    results: list[RuleResult] = []
    all_findings: list[Finding] = []
    for rule_id, fn in ORDER:
        try:
            r = fn(ctx)
        except Exception as exc:  # одна сломанная проверка не должна ронять весь отчёт
            log.exception("Проверка %s упала", rule_id)
            r = RuleResult(rule_id, "skip", note=f"Ошибка выполнения проверки: {exc}")
        results.append(r)
        all_findings += r.findings
    try:
        r = check_undeclared(ctx, all_findings)
    except Exception as exc:
        log.exception("Проверка DRW-02 упала")
        r = RuleResult("DRW-02", "skip", note=f"Ошибка выполнения проверки: {exc}")
    results.insert([x.rule for x in results].index("DRW-03"), r)
    for r in results:
        if r.status != "skip":
            sev = {f.severity for f in r.findings}
            r.status = "fail" if "error" in sev else ("warn" if "warning" in sev else "ok")
        for f in r.findings:
            f.evidence.setdefault("ref", load_rules()["rules"][f.rule]["ref"])
    return results


__all__ = ["Context", "Finding", "RuleResult", "run_checks", "load_rules", "PAGE_KINDS", "ColorSpec"]
