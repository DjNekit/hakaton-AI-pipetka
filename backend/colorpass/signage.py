"""Дизайн-проект размещения вывесок (информационных конструкций) — ПП Москвы № 902-ПП.

Состав по Приложению 2 к 902-ПП «Требования к дизайн-проекту размещения вывески» и образцам Москомархитектуры
(dataset/signs): пояснительная записка (адрес, год постройки, тип и место размещения, способ крепления и освещения,
параметры), фотофиксация (не старше двух месяцев), ортогональные чертежи фасадов (М 1:50–1:500) со сквозной
нумерацией вывесок и размерами, фотомонтаж, экспликация вывесок. Размеры сверяются с Приложением 1 (Правила
размещения и содержания информационных конструкций).
"""
from __future__ import annotations

import re
from dataclasses import asdict, dataclass, field
from datetime import date, datetime

from .checks import Context, Finding, RuleResult, load_rules
from .ingest import Document, PageData, norm_text

SIGN_KINDS = {
    "sg_title": "Титульный лист дизайн-проекта",
    "sg_note": "Пояснительная записка",
    "sg_scheme": "Схема расположения / ситуационный план",
    "sg_photo": "Фотофиксация",
    "sg_drawing": "Чертёж фасадов и мест размещения вывесок",
    "sg_montage": "Фотомонтаж",
    "sg_mount": "Схема крепления, узлы",
    "sg_ahk": "Фрагмент архитектурно-художественной концепции",
    "sg_explication": "Экспликация вывесок",
    "other": "Прочее",
}

_KIND_PATTERNS = [
    ("sg_ahk", r"фрагмент архитектурно-художественной концепции"),
    ("sg_montage", r"фотомонтаж"),
    ("sg_photo", r"фотофиксаци"),
    ("sg_note", r"пояснительная записка"),
    ("sg_scheme", r"схема расположения объекта|ситуационный план"),
    ("sg_drawing", r"ч(?:ертеж|ертёж|етреж)\w* фасад|внешний вид\w* (?:информационн|отдельно)|схема размещения информационн\w* конструкци\w* с привязк"),
    ("sg_mount", r"схема (?:типового )?креплени|узел \d"),
]
_WATERMARK = set("ОБРАЗЕЦP")
_PLACEHOLDER = re.compile(r"указывается|указать|^[_\s.]*$|^д\s*[хx×]\s*в\s*[хx×]\s*ш$|^в\s*[хx×]\s*д\s*[хx×]\s*ш$", re.I)
SIGN_TYPES = {
    "настенная": r"настенн",
    "консольная": r"консольн",
    "витринная": r"витринн",
    "крышная": r"крышн",
    "отдельно стоящая": r"отдельно\s*стоящ|стел[аы]|пилон",
}


def _undouble(token: str) -> str:
    """«ВВЫЫВВЕЕССККАА 11..11» — текст, отрисованный дважды: каждая буква повторена."""
    while len(token) >= 4 and len(token) % 2 == 0 and token[::2] == token[1::2]:
        token = token[::2]
    return token


def clean_text(text: str) -> str:
    """Убирает одиночные буквы водяного знака «ОБРАЗЕЦ» и задвоенные надписи."""
    lines = []
    for line in (text or "").splitlines():
        tokens = [_undouble(t) for t in line.split()]
        tokens = [t for t in tokens if not (len(t) == 1 and t in _WATERMARK)]
        if tokens:
            lines.append(" ".join(tokens))
    return "\n".join(lines)


def is_signage(doc: Document) -> bool:
    head = " ".join(norm_text(p.text).lower()[:600] for p in doc.pages[:2])
    if "дизайн-проект размещения" in head and "колористическ" not in head:
        return True
    expl = sum(1 for p in doc.pages if "экспликация информационных конструкций" in norm_text(p.text).lower())
    return expl >= 2


def classify(page: PageData) -> list[str]:
    text = clean_text(page.text).lower()
    head = norm_text(" ".join(w.text for w in page.words if w.top < page.height * 0.25)).lower()
    kinds: list[str] = []
    if page.index == 0 and "дизайн-проект размещения" in text[:400]:
        kinds.append("sg_title")
    for kind, pat in _KIND_PATTERNS:
        if kind == "sg_note" and "sg_title" in kinds:
            continue
        # заголовок листа — в верхней части; в штампе те же слова встречаются как подпись листа
        if re.search(pat, head) or (kind in ("sg_drawing", "sg_mount", "sg_note") and re.search(pat, text)):
            if kind not in kinds:
                kinds.append(kind)
    if "экспликация информационных конструкций" in text:
        kinds.append("sg_explication")
    return kinds or ["other"]


# ----------------------------------------------------------------- модель документа


@dataclass
class SignRow:
    n: str
    page: int
    sign_type: str | None  # настенная, консольная, витринная, крышная, отдельно стоящая
    kind_text: str  # вид конструкции и освещение — как в экспликации
    dims_raw: str
    length: float | None = None  # мм
    height: float | None = None
    width: float | None = None
    offset_raw: str = ""
    offset: float | None = None
    label: str = ""
    pages: list[int] = field(default_factory=list)

    @property
    def dims_given(self) -> bool:
        return self.height is not None and self.length is not None


@dataclass
class SignageProject:
    pages: dict[int, list[str]]
    texts: dict[int, str]
    address: str | None
    customer: str | None
    object_name: str | None
    year_built: str | None
    note_text: str
    note_pages: list[int]
    note_is_template: bool
    rows: list[SignRow]
    scales: dict[int, list[str]]
    scale_hint_pages: list[int]
    photo_dates: dict[int, list[str]]
    doc_date: str | None
    stamp_values: dict[str, list[tuple[int, str]]]

    def pages_of(self, kind: str) -> list[int]:
        return [i for i, k in self.pages.items() if kind in k]

    def to_dict(self) -> dict:
        d = asdict(self)
        d.pop("texts")
        d["rows"] = [asdict(r) | {"dims_given": r.dims_given} for r in self.rows]
        return d


def _value(raw: str | None) -> str | None:
    v = norm_text(raw or "").strip(" :;")
    v = " ".join(t for t in v.split() if not (len(t) == 1 and t in _WATERMARK))
    return None if not v or _PLACEHOLDER.search(v) else v


def _stamp_values(doc: Document) -> dict[str, list[tuple[int, str]]]:
    """Поля «Заказчик:», «Объект:», «Адрес:» (штамп, титул, ситуационный план): слова той же строки справа от подписи
    до первого большого промежутка — так в значение не попадают соседние графы штампа."""
    out: dict[str, list[tuple[int, str]]] = {"Адрес": [], "Заказчик": [], "Объект": []}
    names = {"заказчик": "Заказчик", "объект": "Объект", "адрес": "Адрес"}
    for p in doc.pages:
        words = sorted(p.words, key=lambda w: (round(w.top), w.x0))
        for i, w in enumerate(words):
            low = w.text.lower().rstrip(":")
            label_end = w
            key = names.get(low)
            if key is None and low == "наименование" and i + 1 < len(words) and words[i + 1].text.lower().startswith("объекта"):
                key, label_end = "Объект", words[i + 1]
            if key == "Адрес" and i + 1 < len(words) and words[i + 1].text.lower().startswith("объекта"):
                label_end = words[i + 1]
            if key is None or not label_end.text.endswith(":"):
                continue
            line = [x for x in words if abs(x.top - w.top) < 2.5 and x.x0 > label_end.x1 - 0.5]
            line.sort(key=lambda x: x.x0)
            picked, last = [], label_end.x1
            for x in line:
                if x.x0 - last > 25:
                    break
                picked.append(x.text)
                last = x.x1
            val = " ".join(picked)
            val = re.split(r"\s(?:Приложение к|Должность|Стадия)\b", val)[0]
            val = _value(re.sub(r"\s+от\s+\d{4}\s*г\.?$", "", val))
            if val and not re.fullmatch(r"(?:[А-ЯЁ]\s*)+", val):
                out[key].append((p.index, val))
    return out


_DIMS = re.compile(r"(\d+(?:[.,]\d+)?)\s*[хxХX×*]\s*(\d+(?:[.,]\d+)?)(?:\s*[хxХX×*]\s*(\d+(?:[.,]\d+)?))?")


def _num(s: str | None) -> float | None:
    return float(s.replace(",", ".")) if s else None


def _explication(doc: Document, pages: list[int]) -> list[SignRow]:
    rows: dict[str, SignRow] = {}
    for pi in pages:
        page = doc.pages[pi]
        for t in page.tables:
            if not t.rows:
                continue
            header = [clean_text(c.text).lower() for c in t.rows[0]]
            if not (any(h.strip().startswith("№") for h in header) and any("габарит" in h for h in header)):
                continue
            col = {}
            for i, h in enumerate(header):
                if "габарит" in h:
                    col["dims"] = i
                    col["order"] = "VDS" if re.search(r"в\s*[хx]\s*д\s*[хx]\s*ш", h) else "DVS"
                elif h.startswith("№"):
                    col["n"] = i
                elif "тип конструкции" in h and "вид" not in h:
                    col["type"] = i
                elif "вид конструкции" in h or "освещ" in h:
                    col["kind"] = i
                elif "расстояние" in h:
                    col["offset"] = i
                elif "обозначение" in h:
                    col["label"] = i
            for row in t.rows[1:]:
                cells = [clean_text(c.text) for c in row]
                get = lambda k: cells[col[k]] if k in col and col[k] < len(cells) else ""  # noqa: E731
                n = re.sub(r"\s+", "", get("n"))
                if n.endswith("-") and col.get("n", 0) + 1 < len(cells) and re.fullmatch(r"\d+(?:\.\d+)?", cells[col["n"] + 1].strip()):
                    n += cells[col["n"] + 1].strip()  # «1-» | «2» — диапазон разорван по ячейкам
                n = n.rstrip("-")
                if not n or not re.match(r"^[А-ЯA-Zа-я]?\d", n):
                    continue
                joined = " ".join(cells).lower()
                sign_type = next((name for name, pat in SIGN_TYPES.items() if re.search(pat, get("type").lower())), None)
                sign_type = sign_type or next((name for name, pat in SIGN_TYPES.items() if re.search(pat, joined)), None)
                dims_raw = get("dims")
                m = _DIMS.search(dims_raw.replace(" ", " "))
                length = height = width = None
                if m:
                    a, b, c = _num(m.group(1)), _num(m.group(2)), _num(m.group(3))
                    length, height = (a, b) if col.get("order") == "DVS" else (b, a)
                    width = c
                off = re.search(r"\d+(?:[.,]\d+)?", get("offset"))
                if n in rows:
                    if pi not in rows[n].pages:
                        rows[n].pages.append(pi)
                    continue
                rows[n] = SignRow(
                    n=n, page=pi, sign_type=sign_type, kind_text=get("kind"), dims_raw=dims_raw,
                    length=length, height=height, width=width, offset_raw=get("offset"),
                    offset=_num(off.group(0)) if off else None, label=get("label"), pages=[pi],
                )
    return list(rows.values())


_DATE = re.compile(r"(?<!\d)(\d{2})\.(\d{2})\.(\d{4}|\d{2})(?!\d)")


def _dates(text: str, skip_contract: bool = True) -> list[str]:
    out = []
    for m in _DATE.finditer(text):
        before = text[max(0, m.start() - 40): m.start()].lower()
        if skip_contract and re.search(r"договор|№\s*[\w/-]+\s+от\s*$", before):
            continue
        d, mth, y = m.groups()
        y = ("20" + y) if len(y) == 2 else y
        try:
            datetime(int(y), int(mth), int(d))
        except ValueError:
            continue
        out.append(f"{d}.{mth}.{y}")
    return out


def build_signage(doc: Document) -> SignageProject:
    kinds = {p.index: classify(p) for p in doc.pages}
    texts = {p.index: clean_text(p.text) for p in doc.pages}
    stamps = _stamp_values(doc)
    note_pages = [i for i, k in kinds.items() if "sg_note" in k]
    note_text = "\n".join(texts[i] for i in note_pages)
    note_is_template = bool(re.search(r"пояснительная записка включает\s*:", note_text, re.I)) and not re.search(
        r"\d{2,}\s*(?:мм|м)\b|\d+\s*[хx×]\s*\d+", note_text
    )
    scales: dict[int, list[str]] = {}
    hint_pages: list[int] = []
    for i, k in kinds.items():
        if not ({"sg_drawing", "sg_montage"} & set(k)) or "sg_scheme" in k:
            continue
        t = texts[i]
        if re.search(r"указывается масштаб", t, re.I):
            hint_pages.append(i)
        t = re.sub(r"\((?:\s*М\s*1\s*:\s*\d+\s*;?)+\s*\)", " ", t)  # подсказка образца «(М 1:50; М 1:100)»
        t = re.sub(r"М\s*1\s*:\s*\d+\s*;\s*М\s*1\s*:\s*\d+(?:\s*;\s*М\s*1\s*:\s*\d+)*", " ", t)
        found = [f"1:{m.group(1)}" for m in re.finditer(r"М\s*1\s*:\s*(\d+)", t)]
        found = [s for s in found if s not in ("1:20", "1:25", "1:10", "1:5")]  # узлы крепления
        if found:
            scales[i] = sorted(set(found), key=found.index)
    photo_dates = {i: _dates(texts[i]) for i, k in kinds.items() if "sg_photo" in k}
    stamp_dates = []
    for p in doc.pages:
        for t in p.tables:
            for row in t.rows:
                for c in row:
                    stamp_dates += _dates(c.text, skip_contract=False) if c.text and len(c.text) < 20 else []
    year = re.search(r"Москва\s+(\d{4})", texts.get(0, ""))
    doc_date = stamp_dates[0] if stamp_dates else (f"01.01.{year.group(1)}" if year else None)
    year_built = re.search(r"(?:год\w* постройки|построен\w*|постройки)\D{0,20}(1[6-9]\d\d|20[0-2]\d)", note_text, re.I)
    rows = _explication(doc, [i for i, k in kinds.items() if "sg_explication" in k])
    first = lambda key: stamps[key][0][1] if stamps[key] else None  # noqa: E731
    return SignageProject(
        pages=kinds, texts=texts, address=first("Адрес"), customer=first("Заказчик"), object_name=first("Объект"),
        year_built=year_built.group(1) if year_built else None, note_text=note_text, note_pages=note_pages,
        note_is_template=note_is_template, rows=rows, scales=scales, scale_hint_pages=hint_pages,
        photo_dates=photo_dates, doc_date=doc_date, stamp_values=stamps,
    )


# ----------------------------------------------------------------- проверки


class SignContext(Context):
    def __init__(self, doc: Document, project: SignageProject, today: date | None = None):
        self.doc = doc
        self.s = project
        self.rules = load_rules()
        self.th = self.rules["thresholds"]
        self.today = today or date.today()


def check_completeness(ctx: SignContext) -> RuleResult:
    res = RuleResult("SGN-01", "ok")
    need = [
        ("sg_note", "пояснительная записка"),
        ("sg_photo", "фотофиксация"),
        ("sg_drawing", "ортогональные чертежи фасадов с местами размещения вывесок"),
        ("sg_montage", "фотомонтаж"),
        ("sg_explication", "экспликация вывесок"),
    ]
    for kind, name in need:
        if not ctx.s.pages_of(kind):
            res.findings.append(ctx.f("SGN-01", f"В дизайн-проекте нет раздела: {name}"))
    return res


NOTE_ITEMS = [
    ("адрес объекта", r"адрес|ул\.|улица|проспект|шоссе|д\.\s*\d"),
    ("тип конструкции вывески", "|".join(SIGN_TYPES.values()) + r"|объемн\w* букв|световой короб|табличк"),
    ("место размещения и способ крепления", r"размеща\w*|расположен\w*|креп\w+|анкер|кронштейн|над входом|фриз"),
    ("способ освещения", r"подсвет|освещ|светов|контражур|без подсветки"),
    ("параметры вывески (длина, высота, ширина)", r"\d+\s*(?:мм|м)\b|\d+\s*[хx×]\s*\d+|высот\w*\s*\d"),
]


def check_note(ctx: SignContext) -> RuleResult:
    res = RuleResult("SGN-02", "ok")
    if not ctx.s.note_pages:
        return RuleResult("SGN-02", "skip", note="Пояснительной записки нет (см. SGN-01)")
    page = ctx.s.note_pages[0]
    if ctx.s.note_is_template:
        res.findings.append(ctx.f("SGN-02", "Пояснительная записка не заполнена: на листе только перечень требований из образца", page=page))
        return res
    body = re.sub(r"пояснительная записка включает:.*?(?:\n\n|$)", " ", ctx.s.note_text, flags=re.I | re.S)
    for name, pat in NOTE_ITEMS:
        if not re.search(pat, body, re.I):
            res.findings.append(ctx.f("SGN-02", f"В пояснительной записке нет сведений: {name}", page=page))
    freestanding = any(r.sign_type == "отдельно стоящая" for r in ctx.s.rows)
    if not ctx.s.year_built and not freestanding:
        res.findings.append(ctx.f("SGN-02", "В пояснительной записке не указан год постройки здания", page=page))
    return res


def check_scale(ctx: SignContext) -> RuleResult:
    res = RuleResult("SGN-03", "ok")
    allowed = set(ctx.rules.get("allowed_scales", []))
    drawings = ctx.s.pages_of("sg_drawing")
    if not drawings:
        return RuleResult("SGN-03", "skip", note="Чертежей фасадов нет (см. SGN-01)")
    for pi in drawings:
        found = ctx.s.scales.get(pi, [])
        if not found:
            hint = " (на листе осталась подсказка образца «Указывается масштаб…»)" if pi in ctx.s.scale_hint_pages else ""
            res.findings.append(ctx.f("SGN-03", f"На чертеже не указан масштаб{hint}", page=pi))
        for sc in found:
            if sc not in allowed:
                res.findings.append(ctx.f("SGN-03", f"Масштаб {sc.replace(':', ' : ')} не из ряда {', '.join(sorted(allowed))}",
                                          page=pi, actual=sc))
    return res


def check_explication(ctx: SignContext) -> RuleResult:
    res = RuleResult("SGN-04", "ok")
    if not ctx.s.rows:
        return RuleResult("SGN-04", "skip" if not ctx.s.pages_of("sg_explication") else "ok",
                          note="Экспликация не найдена или не распознана")
    no_dims = [r for r in ctx.s.rows if not r.dims_given]
    if no_dims:
        nums = ", ".join(r.n for r in no_dims)
        sample = no_dims[0].dims_raw or "—"
        res.findings.append(ctx.f("SGN-04", f"Габаритные размеры не указаны у вывесок: {nums} (в экспликации «{sample}»)",
                                  page=no_dims[0].page, evidence={"signs": [r.n for r in no_dims]}))
    no_type = [r for r in ctx.s.rows if not r.sign_type]
    if no_type:
        res.findings.append(ctx.f("SGN-04", "Не указан тип конструкции у вывесок: " + ", ".join(r.n for r in no_type),
                                  page=no_type[0].page, severity="warning"))
    return res


def check_sizes(ctx: SignContext) -> RuleResult:
    """SGN-05: размеры по Приложению 1 к 902-ПП (пороги — rules.yaml)."""
    res = RuleResult("SGN-05", "ok")
    th = ctx.th
    sized = [r for r in ctx.s.rows if r.dims_given]
    if not sized:
        return RuleResult("SGN-05", "skip", note="Размеры вывесок не указаны (см. SGN-04)")
    for r in sized:
        h, ln, w = r.height, r.length, r.width
        txt = (r.kind_text or "").lower()
        problems: list[tuple[str, str]] = []
        if r.sign_type == "настенная":
            no_backing = "без подложки" in txt or "объемн" in txt and "подложк" not in txt
            limit = th["sign_wall_max_height_no_backing"] if no_backing else th["sign_wall_max_height"]
            if h > limit:
                problems.append(("error", f"высота {h:.0f} мм больше {limit} мм"))
            elif no_backing and h > th["sign_wall_max_height"]:
                problems.append(("warning", f"высота {h:.0f} мм: допустимо до {th['sign_wall_max_height_no_backing']} мм только для объёмных "
                                            f"символов без подложки при высоте основного шрифта ≤ {th['sign_wall_max_height']} мм — проверьте"))
            if ln > th["sign_wall_max_length"]:
                problems.append(("error", f"длина {ln:.0f} мм больше {th['sign_wall_max_length']} мм для одной конструкции"))
        elif r.sign_type == "консольная":
            if h > th["sign_console_max_height"]:
                problems.append(("error", f"высота {h:.0f} мм больше {th['sign_console_max_height']} мм"))
            if w is not None and w > th["sign_console_max_width"]:
                problems.append(("error", f"ширина {w:.0f} мм больше {th['sign_console_max_width']} мм"))
            if r.offset is not None and r.offset > th["sign_console_max_offset"]:
                problems.append(("error", f"вынос {r.offset:.0f} мм больше {th['sign_console_max_offset']} мм"))
        elif r.sign_type == "витринная" and "внутрен" not in txt + (r.dims_raw or "").lower():
            if h > th["sign_window_max_height"]:
                problems.append(("error", f"высота {h:.0f} мм больше {th['sign_window_max_height']} мм для вывески на витрине"))
        elif r.sign_type == "крышная":
            problems.append(("warning", f"высота {h:.0f} мм — сверьте с этажностью здания (от 1,8 м для 1–3 этажей до 6 м для 18 и более)"))
        for sev, text in problems:
            res.findings.append(ctx.f("SGN-05", f"Вывеска {r.n} ({r.sign_type}): {text}", page=r.page, element=r.n, severity=sev,
                                      actual=f"{r.length:.0f}×{r.height:.0f}" + (f"×{r.width:.0f}" if r.width else "") + " мм"))
    return res


FORBIDDEN = [
    (r"неон", "неоновые светильники"),
    (r"мига\w*|мерца\w*", "мигающие (мерцающие) элементы"),
    (r"бегущ\w* строк|динамическ\w* (?:систем|смен)|роллер|призматрон", "динамическая смена изображения, бегущая строка"),
    (r"баннерн\w* ткан|\bбаннер\w*|\bткан[ьи]\b|картон", "картон, ткань, баннерная ткань"),
    (r"оклейк\w* (?:витрин|остеклен)|пл[её]нк\w* на (?:витрин|остеклен)", "окраска или оклейка остекления витрин"),
    (r"вертикальн\w* (?:расположен|надпис|букв)", "вертикальное расположение букв"),
]


def check_forbidden(ctx: SignContext) -> RuleResult:
    res = RuleResult("SGN-06", "ok")
    seen = set()
    sources = [(r.page, f"вывеска {r.n}: {r.kind_text}") for r in ctx.s.rows]
    sources += [(pi, ctx.s.texts[pi]) for pi in ctx.s.note_pages]
    for page, text in sources:
        low = text.lower()
        for pat, name in FORBIDDEN:
            m = re.search(pat, low)
            if m and (name, page) not in seen:
                seen.add((name, page))
                quote = text[max(0, m.start() - 40): m.end() + 40].replace("\n", " ")
                res.findings.append(ctx.f("SGN-06", f"Запрещено: {name} («…{quote.strip()}…»)", page=page))
    return res


def check_stamps(ctx: SignContext) -> RuleResult:
    res = RuleResult("SGN-07", "ok")
    if not ctx.s.address:
        pages = ctx.s.pages_of("sg_drawing") or [0]
        res.findings.append(ctx.f("SGN-07", "Адрес объекта не указан ни на титуле, ни в штампах листов", page=pages[0]))
    if not ctx.s.stamp_values["Заказчик"]:
        res.findings.append(ctx.f("SGN-07", "Не указан заказчик (поле «Заказчик» в штампах пустое)", page=0, severity="warning"))
    return res


def check_photo_dates(ctx: SignContext) -> RuleResult:
    res = RuleResult("SGN-08", "ok")
    pages = ctx.s.pages_of("sg_photo")
    if not pages:
        return RuleResult("SGN-08", "skip", note="Фотофиксации нет (см. SGN-01)")
    max_days = int(ctx.th["sign_photo_max_age_days"])
    for pi in pages:
        dates = ctx.s.photo_dates.get(pi, [])
        if not dates:
            res.findings.append(ctx.f("SGN-08", "На листе фотофиксации не указана дата съёмки (если она впечатана в фото — проверьте вручную)",
                                      page=pi, severity="warning"))
            continue
        newest = max(datetime.strptime(d, "%d.%m.%Y").date() for d in dates)
        age = (ctx.today - newest).days
        if age > max_days:
            res.findings.append(ctx.f("SGN-08", f"Фотографии от {newest:%d.%m.%Y} — старше {max_days} дней на дату проверки ({age} дн.)",
                                      page=pi, actual=f"{newest:%d.%m.%Y}"))
    return res


def check_numbering(ctx: SignContext) -> RuleResult:
    """SGN-09: сквозная нумерация — номер каждой вывески из экспликации есть на чертеже или фотомонтаже."""
    res = RuleResult("SGN-09", "ok")
    if not ctx.s.rows:
        return RuleResult("SGN-09", "skip", note="Экспликации нет")
    graphic = " ".join(ctx.s.texts[i] for i in ctx.s.pages_of("sg_drawing") + ctx.s.pages_of("sg_montage"))
    for r in ctx.s.rows:
        first = re.split(r"[-–]", r.n)[0]
        if not re.search(rf"(?<![\d.]){re.escape(first)}(?![\d])", graphic):
            res.findings.append(ctx.f("SGN-09", f"Номер вывески {r.n} из экспликации не найден на чертежах и фотомонтаже",
                                      page=r.page, element=r.n))
    return res


def check_ahk(ctx: SignContext) -> RuleResult:
    from .ahk import AHK_URL, find_ahk

    if not ctx.s.address:
        return RuleResult("SGN-10", "skip", note="Адрес не указан (см. SGN-07)")
    hit = find_ahk(ctx.s.address)
    if not hit:
        return RuleResult("SGN-10", "ok", note="Улицы нет в перечне улиц с утверждёнными АХК")
    since = ".".join(reversed(hit.since.split("-")))
    res = RuleResult("SGN-10", "ok", note=f"{hit.street}: АХК, этап {hit.stage}, с {since}")
    if ctx.s.pages_of("sg_ahk"):
        res.findings.append(ctx.f("SGN-10", f"Объект на улице с АХК ({hit.street}); фрагмент АХК приложен — сверьте вывески с ним",
                                  page=ctx.s.pages_of("sg_ahk")[0], severity="info", evidence={"url": AHK_URL}))
    else:
        res.findings.append(ctx.f("SGN-10", f"Объект на улице с утверждённой АХК ({hit.street}, с {since}): вывески размещаются по АХК, "
                                  "фрагмент концепции в проекте не найден", evidence={"url": AHK_URL}))
    return res


def check_photo_dpi(ctx: SignContext) -> RuleResult:
    res = RuleResult("SGN-11", "ok")
    if ctx.doc is None:
        return RuleResult("SGN-11", "skip", note="Нет PDF")
    need = float(ctx.th.get("scan_dpi_warn", 300))
    pages = ctx.s.pages_of("sg_photo") + ctx.s.pages_of("sg_montage")
    checked = False
    for pi in pages:
        page = ctx.doc.pages[pi]
        big = [im for im in page.images if (im.bbox[2] - im.bbox[0]) * (im.bbox[3] - im.bbox[1]) > 0.03 * page.width * page.height]
        low = [im for im in big if im.dpi < need * 0.98]
        checked = checked or bool(big)
        if low:
            worst = min(low, key=lambda im: im.dpi)
            res.findings.append(ctx.f("SGN-11", f"{len(low)} фото на листе — меньше {need:.0f} dpi при печати (худшее: {worst.src_size[0]}×{worst.src_size[1]} пикс., "
                                      f"{worst.dpi:.0f} dpi)", page=pi, bbox=worst.bbox, actual=f"{worst.dpi:.0f} dpi"))
    if not checked:
        return RuleResult("SGN-11", "skip", note="Фотографий на листах не найдено")
    return res


ORDER = [
    ("SGN-01", check_completeness),
    ("SGN-02", check_note),
    ("SGN-03", check_scale),
    ("SGN-04", check_explication),
    ("SGN-05", check_sizes),
    ("SGN-06", check_forbidden),
    ("SGN-07", check_stamps),
    ("SGN-08", check_photo_dates),
    ("SGN-09", check_numbering),
    ("SGN-10", check_ahk),
    ("SGN-11", check_photo_dpi),
]


def run_signage_checks(ctx: SignContext) -> list[RuleResult]:
    import logging

    out = []
    for rule_id, fn in ORDER:
        try:
            r = fn(ctx)
        except Exception as exc:  # одна сломанная проверка не роняет отчёт
            logging.getLogger(__name__).exception("Проверка %s упала", rule_id)
            r = RuleResult(rule_id, "skip", note=f"Ошибка выполнения проверки: {exc}")
        if r.status != "skip":
            sev = {f.severity for f in r.findings}
            r.status = "fail" if "error" in sev else ("warn" if "warning" in sev else "ok")
        for f in r.findings:
            f.evidence.setdefault("ref", ctx.rules["rules"][f.rule]["ref"])
        out.append(r)
    return out


__all__ = ["SIGN_KINDS", "is_signage", "build_signage", "SignContext", "run_signage_checks", "Finding"]
