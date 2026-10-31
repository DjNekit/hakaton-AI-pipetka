"""Сравнение фото здания (снимок инспектора, скрин с городской камеры) с развёрткой фасада из паспорта.

Решение «совпадает / не совпадает» принимает код:
1. развёртка и фото приводятся к одной плоскости (перспектива по четырём углам фасада на фото);
2. обе картинки сглаживаются (швы, кладка, линии чертежа, водяной знак не должны влиять);
3. развёртка делится на цветовые зоны (k-means в Lab), остекление и почти белые зоны не сравниваются —
   на фото стекло отражает небо и интерьер;
4. на фото поправляется экспозиция (светлота подгоняется к развёртке);
5. в каждой точке считается ΔE00 (kL = 2: светлота на фото сильно зависит от освещения) между фото и цветом зоны;
   связные области с ΔE выше порога — отличия; зона, которая на фото в основном другого цвета, — отличие зоны.
"""
from __future__ import annotations

import base64
import json
import logging
from dataclasses import asdict, dataclass, field
from pathlib import Path

import cv2
import numpy as np
import pypdfium2 as pdfium

from .color import delta_e2000, kmeans_lab, lab_to_srgb, merge_close, rgb_to_hex, srgb_to_lab
from .palettes import ral_table
from .checks import load_rules

log = logging.getLogger(__name__)

BLOCK_SCALE = 150 / 72  # рендер листов для вырезания развёрток и фото, 150 dpi
WORK_WIDTH = 480  # ширина рабочего изображения сравнения, px

Box = tuple[int, int, int, int]  # x0, y0, x1, y1 в пикселях рендера BLOCK_SCALE


# ------------------------------------------------------------------ области на листе


def _runs(mask: np.ndarray) -> list[tuple[int, int]]:
    out, start = [], None
    for i, v in enumerate(list(mask) + [False]):
        if v and start is None:
            start = i
        elif not v and start is not None:
            out.append((start, i))
            start = None
    return out


def _xycut(filled: np.ndarray, box: Box, min_size: int, thr: float, depth: int = 0) -> list[Box]:
    """Рекурсивное разрезание по пустым полосам (XY-cut): строки/столбцы, заполненные меньше чем на thr, — разрывы."""
    x0, y0, x1, y1 = box
    if depth > 8:
        return [box]
    for axis in (0, 1):
        sub = filled[y0:y1, x0:x1]
        if sub.size == 0:
            return []
        prof = sub.mean(axis=1) if axis == 0 else sub.mean(axis=0)
        level = max(0.15, thr * float(prof.max())) if prof.size else 1.0  # порог от самой заполненной полосы
        segs = [(a, b) for a, b in _runs(prof > level) if b - a >= min_size]
        if not segs:
            return []
        if len(segs) > 1:
            out: list[Box] = []
            for a, b in segs:
                nb = (x0, y0 + a, x1, y0 + b) if axis == 0 else (x0 + a, y0, x0 + b, y1)
                out += _xycut(filled, nb, min_size, thr, depth + 1)
            return out
        a, b = segs[0]
        if axis == 0:
            y0, y1 = y0 + a, y0 + b
        else:
            x0, x1 = x0 + a, x0 + b
    return [(x0, y0, x1, y1)]


def find_blocks(img: np.ndarray, min_area: float = 0.02, thr: float = 0.6) -> list[Box]:
    """Крупные залитые прямоугольные области листа: развёртки фасадов, фотографии.

    Тонкие линии (водяной знак, рамки, текст) заполняют строку/столбец меньше чем на thr и становятся разрывами."""
    gray = cv2.cvtColor(img, cv2.COLOR_RGB2GRAY)
    filled = gray < 235
    h, w = gray.shape
    boxes = _xycut(filled, (0, 0, w, h), max(8, int(0.06 * min(h, w))), thr)
    return [b for b in boxes if (b[2] - b[0]) * (b[3] - b[1]) >= min_area * h * w]


@dataclass
class Block:
    id: str  # «p12-b1»: лист (с 1) и номер области
    page: int  # индекс листа с 0
    kind: str  # facade | photo
    box: Box  # в пикселях рендера BLOCK_SCALE
    label: str
    size: tuple[int, int] = (0, 0)


def _render(pdf: pdfium.PdfDocument, page: int) -> np.ndarray:
    return np.asarray(pdf[page].render(scale=BLOCK_SCALE).to_pil().convert("RGB"))


def passport_blocks(path: str | Path, pages: list[dict]) -> list[tuple[Block, np.ndarray]]:
    """Развёртки (листы раздела IV) и фото (листы фотофиксации) с вырезанными изображениями.

    Вид листов берётся из report["pages"]; рендер — напрямую pypdfium2, без повторного разбора текста."""
    kinds = {int(p["index"]): p.get("kinds", []) for p in pages}
    out: list[tuple[Block, np.ndarray]] = []
    pdf = pdfium.PdfDocument(str(path))
    try:
        for page, ks in sorted(kinds.items()):
            ref = next((k for k in ("facade", "sg_montage", "sg_drawing") if k in ks), None)
            kind = "facade" if ref else "photo" if ({"photo", "sg_photo"} & set(ks)) else None
            if kind is None:
                continue
            img = _render(pdf, page)
            boxes = find_blocks(img)
            if kind == "photo" or ref in ("sg_montage", "sg_drawing"):  # фото и рендеры крупные; таблицы и схемы мельче
                boxes = [b for b in boxes if (b[2] - b[0]) * (b[3] - b[1]) >= 0.05 * img.shape[0] * img.shape[1]]
            name = {"facade": "Развёртка", "sg_montage": "Фотомонтаж", "sg_drawing": "Чертёж"}.get(ref, "Фото")
            for i, (x0, y0, x1, y1) in enumerate(boxes, 1):
                block = Block(
                    id=f"p{page + 1}-b{i}", page=page, kind=kind, box=(int(x0), int(y0), int(x1), int(y1)),
                    label=f"{name} {i}, лист {page + 1}", size=(int(x1 - x0), int(y1 - y0)),
                )
                out.append((block, img[y0:y1, x0:x1].copy()))
    finally:
        pdf.close()
    return out


# ------------------------------------------------------------------ сравнение


@dataclass
class Zone:
    id: int
    hex: str  # цвет зоны на развёртке
    share: float  # доля площади развёртки
    photo_hex: str | None  # медианный цвет этой зоны на фото
    delta_e: float | None
    differs: float  # доля пикселей зоны, отличающихся на фото
    status: str  # ok | mismatch | glass | unknown
    ral: str | None = None  # ближайший RAL (для подписи)


@dataclass
class Difference:
    bbox: tuple[float, float, float, float]  # доли ширины/высоты развёртки: x0, y0, x1, y1
    share: float  # доля площади развёртки
    photo_hex: str
    expected_hex: str
    delta_e: float
    zone: int | None
    note: str = ""


@dataclass
class PhotoComparison:
    verdict: str  # match | mismatch | attention
    zones: list[Zone]
    differences: list[Difference]
    diff_share: float  # доля сравниваемой площади с отличиями
    compared_share: float  # доля площади развёртки, которая сравнивалась (без стекла и линий)
    white_balance: list[float]
    size: tuple[int, int]
    thresholds: dict
    notes: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return asdict(self)


def _thresholds() -> dict:
    t = load_rules().get("thresholds", {})
    return {
        "zone_delta_e": float(t.get("photo_zone_delta_e", 14.0)),
        "zone_mismatch_share": float(t.get("photo_zone_mismatch_share", 0.5)),
        "undeclared_min_share": float(t.get("photo_undeclared_min_share", 0.02)),
        "mismatch_total_share": float(t.get("photo_mismatch_total_share", 0.08)),
        "glass_l": float(t.get("photo_glass_min_l", 88.0)),
    }


def warp_photo(photo: np.ndarray, quad: list[list[float]] | None, size: tuple[int, int]) -> np.ndarray:
    """Приводит фасад на фото к прямоугольнику size (w, h). quad — 4 угла (ЛВ, ПВ, ПН, ЛН) в пикселях фото."""
    w, h = size
    ph, pw = photo.shape[:2]
    src = np.float32(quad) if quad else np.float32([[0, 0], [pw, 0], [pw, ph], [0, ph]])
    if src.shape != (4, 2):
        raise ValueError("Нужно ровно 4 точки углов фасада")
    m = cv2.getPerspectiveTransform(src, np.float32([[0, 0], [w, 0], [w, h], [0, h]]))
    return cv2.warpPerspective(photo, m, (w, h), flags=cv2.INTER_AREA, borderMode=cv2.BORDER_REPLICATE)


def _smooth(img: np.ndarray) -> np.ndarray:
    k = max(3, (img.shape[1] // 60) | 1)
    out = cv2.medianBlur(img, k)
    return cv2.medianBlur(out, k)


def _zones(lab: np.ndarray, valid: np.ndarray, merge_de: float = 10.0) -> tuple[list[np.ndarray], np.ndarray]:
    """Цветовые зоны развёртки: k-means по сглаженной картинке, близкие центры сливаются. Возвращает центры и карту меток."""
    h, w, _ = lab.shape
    px = lab[valid]
    sample = px[:: max(1, len(px) // 6000)]
    centers, _ = kmeans_lab(sample, 8, seed=1)
    counts = [float(np.sum(np.argmin(((sample[:, None] - centers[None]) ** 2).sum(-1), 1) == i)) for i in range(len(centers))]
    merged = [c for c, wgt in merge_close(centers, counts, merge_de) if wgt / len(sample) >= 0.01]
    centers = np.array(merged)
    d = np.stack([delta_e2000(lab, c) for c in centers], axis=-1)
    labels = d.argmin(-1)
    labels[~valid] = -1
    return list(centers), labels


def _glass_mask(dr: np.ndarray, dr_lab: np.ndarray, min_l: float) -> np.ndarray:
    """Остекление развёртки: светлые малонасыщенные заливки. Ищем по несглаженной картинке, чтобы тонкие
    импосты и переплёты не «размазывали» стекло в серый; переплёты внутри проёма тоже относим к стеклу."""
    raw = srgb_to_lab(dr.reshape(-1, 3)).reshape(dr_lab.shape)
    light = (raw[..., 0] >= min_l) & (np.hypot(raw[..., 1], raw[..., 2]) < 8)
    light = cv2.morphologyEx(light.astype(np.uint8), cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))
    n, comp, stats, _ = cv2.connectedComponentsWithStats(light)
    keep = np.zeros_like(light, dtype=bool)
    min_area = 0.0015 * light.size
    for k in range(1, n):
        if stats[k][4] >= min_area:
            keep |= comp == k
    smooth = (dr_lab[..., 0] >= min_l) & (np.hypot(dr_lab[..., 1], dr_lab[..., 2]) < 6)
    return cv2.dilate((keep | smooth).astype(np.uint8), np.ones((5, 5), np.uint8)).astype(bool)


def _white_balance(photo_lab: np.ndarray, ref_lab: np.ndarray, mask: np.ndarray) -> tuple[np.ndarray, list[float]]:
    """Поправка экспозиции: светлота фото подгоняется к медиане развёртки (в пределах ×0,8…×1,25).

    Оттенок (a*, b*) не трогаем: на реальных фото «серый мир» сдвигал бежевый кирпич к серому и прятал отличия."""
    p = photo_lab[mask]
    r = ref_lab[mask]
    out = photo_lab.copy()
    lp, lr = float(np.median(p[:, 0])), float(np.median(r[:, 0]))
    gain = float(np.clip(lr / max(lp, 1.0), 0.8, 1.25))
    out[..., 0] = np.clip(out[..., 0] * gain, 0, 100)
    return out, [round(gain, 3)]


def _nearest_ral(lab: np.ndarray) -> str | None:
    best, code = 99.0, None
    for c, info in ral_table().items():
        d = float(delta_e2000(info.lab, lab))
        if d < best:
            best, code = d, c
    return f"RAL {code}" if code and best < 8 else None


def _hex(lab) -> str:
    return rgb_to_hex(lab_to_srgb(np.asarray(lab, dtype=np.float64)))


def compare(drawing: np.ndarray, photo: np.ndarray, quad: list[list[float]] | None = None,
            drawing_rect: tuple[float, float, float, float] | None = None) -> tuple[PhotoComparison, dict]:
    """Сравнивает развёртку (RGB) и фото (RGB).

    drawing_rect — часть развёртки, видимая на фото (доли: x0, y0, x1, y1), по умолчанию вся.
    Возвращает результат и изображения для отчёта: drawing, photo_warped, diff_overlay."""
    th = _thresholds()
    if drawing_rect:
        h0, w0 = drawing.shape[:2]
        x0, y0, x1, y1 = drawing_rect
        drawing = drawing[int(y0 * h0):max(int(y1 * h0), int(y0 * h0) + 2), int(x0 * w0):max(int(x1 * w0), int(x0 * w0) + 2)]
    dh, dw = drawing.shape[:2]
    w = WORK_WIDTH
    h = max(8, int(round(w * dh / dw)))
    dr = cv2.resize(drawing, (w, h), interpolation=cv2.INTER_AREA)
    pw = warp_photo(photo, quad, (w, h))

    dr_lab = srgb_to_lab(_smooth(dr).reshape(-1, 3)).reshape(h, w, 3)
    ph_lab = srgb_to_lab(_smooth(pw).reshape(-1, 3)).reshape(h, w, 3)

    # стекло и белые поля развёртки не сравниваются; края картинки — тоже (неточность углов)
    glass = _glass_mask(dr, dr_lab, th["glass_l"])
    border = np.zeros((h, w), bool)
    m = max(2, w // 80)
    border[:m, :] = border[-m:, :] = border[:, :m] = border[:, -m:] = True
    valid = ~glass & ~border
    notes: list[str] = []
    if valid.mean() < 0.15:
        notes.append("На развёртке почти нет непрозрачных окрашенных поверхностей — сравнивать нечего")

    centers, labels = _zones(dr_lab, valid)
    ref = np.zeros_like(dr_lab)
    for i, c in enumerate(centers):
        ref[labels == i] = c
    ph_lab, wb = _white_balance(ph_lab, ref, valid)

    de = np.zeros((h, w))
    de[valid] = delta_e2000(ph_lab[valid], ref[valid], kl=2.0)
    bad = (de > th["zone_delta_e"]) & valid
    bad = cv2.morphologyEx(bad.astype(np.uint8), cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    bad = cv2.morphologyEx(bad, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8)).astype(bool) & valid

    zones: list[Zone] = []
    zone_bad: set[int] = set()
    total = float(h * w)
    for i, c in enumerate(centers):
        mask = labels == i
        n = int(mask.sum())
        if n == 0:
            continue
        p_med = np.median(ph_lab[mask], axis=0)
        d_med = float(delta_e2000(p_med, c, kl=2.0))
        frac = float(bad[mask].mean())
        big = n / total >= th["undeclared_min_share"]
        status = "mismatch" if big and (frac >= th["zone_mismatch_share"] or d_med > th["zone_delta_e"]) else "ok"
        if status == "mismatch":
            zone_bad.add(i)
        zones.append(Zone(id=i, hex=_hex(c), share=round(n / total, 4), photo_hex=_hex(p_med), delta_e=round(d_med, 1),
                          differs=round(frac, 3), status=status, ral=_nearest_ral(c)))
    zones.sort(key=lambda z: -z.share)

    diffs = _differences(bad, ph_lab, ref, de, labels, centers, total, th)
    diffs.sort(key=lambda d: -d.share)

    compared = float(valid.mean())
    diff_share = float(bad.sum()) / max(1.0, float(valid.sum()))
    mismatch = bool(zone_bad) or diff_share >= th["mismatch_total_share"]
    verdict = "mismatch" if mismatch else "match"
    if not mismatch and diffs:
        verdict = "attention"  # мелкие отличия — пусть посмотрит инспектор
    result = PhotoComparison(
        verdict=verdict, zones=zones, differences=diffs, diff_share=round(diff_share, 4),
        compared_share=round(compared, 4), white_balance=wb, size=(w, h), thresholds=th, notes=notes,
    )
    overlay = _overlay(pw, bad, diffs)
    return result, {"drawing": dr, "photo_warped": pw, "diff_overlay": overlay}


def _describe(lab) -> str:
    """Словесное название цвета (для вывода без модели)."""
    l, a, b = (float(v) for v in lab)
    c = float(np.hypot(a, b))
    if c < 8:
        if l > 85:
            return "белый"
        if l > 60:
            return "светло-серый"
        if l > 35:
            return "серый"
        return "тёмно-серый"
    hue = (np.degrees(np.arctan2(b, a)) + 360) % 360
    names = [(38, "красный"), (55, "оранжевый"), (75, "кирпичный/бежевый"), (100, "жёлтый"), (165, "зелёный"),
             (250, "голубой/синий"), (320, "фиолетовый"), (360, "красный")]
    name = next(n for lim, n in names if hue < lim)
    if name == "оранжевый" and l < 55:
        name = "коричневый"
    shade = "светло-" if l > 75 else "тёмно-" if l < 35 else ""
    return shade + name


def _differences(bad, ph_lab, ref, de, labels, centers, total, th) -> list[Difference]:
    """Отличия: отличающиеся точки группируются по цвету на фото (красный фриз отдельно от зелёного входа),
    затем по связности; мелкие области отбрасываются."""
    h, w = bad.shape
    pts = ph_lab[bad]
    if len(pts) == 0:
        return []
    sample = pts[:: max(1, len(pts) // 4000)]
    cc, _ = kmeans_lab(sample, 5, seed=2)
    cnt = np.bincount(np.argmin(((sample[:, None] - cc[None]) ** 2).sum(-1), 1), minlength=len(cc))
    groups = np.array([c for c, _ in merge_close(cc, cnt, 12.0)])
    lab_map = np.full((h, w), -1)
    lab_map[bad] = np.argmin(np.stack([delta_e2000(pts, g) for g in groups], -1), -1)
    out: list[Difference] = []
    for gi in range(len(groups)):
        m = (lab_map == gi).astype(np.uint8)
        m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, np.ones((7, 7), np.uint8)) & bad.astype(np.uint8)
        n, comp, stats, _ = cv2.connectedComponentsWithStats(m)
        for k in range(1, n):
            x, y, bw, bh, area = stats[k]
            if area / total < th["undeclared_min_share"]:
                continue
            mk = comp == k
            p_med = np.median(ph_lab[mk], axis=0)
            zl = labels[mk]
            zl = zl[zl >= 0]
            zone = int(np.bincount(zl).argmax()) if len(zl) else None
            exp = centers[zone] if zone is not None else np.median(ref[mk], axis=0)
            out.append(Difference(
                bbox=(round(x / w, 4), round(y / h, 4), round((x + bw) / w, 4), round((y + bh) / h, 4)),
                share=round(float(area / total), 4), photo_hex=_hex(p_med), expected_hex=_hex(exp),
                delta_e=round(float(np.median(de[mk])), 1), zone=zone,
                note=f"на фото {_describe(p_med)}, по развёртке {_describe(exp)}",
            ))
    return out


def _overlay(photo: np.ndarray, bad: np.ndarray, diffs: list[Difference]) -> np.ndarray:
    """Карта отличий: совпадающее приглушено в серый, отличия — в исходном цвете с рамками и номерами."""
    gray = cv2.cvtColor(cv2.cvtColor(photo, cv2.COLOR_RGB2GRAY), cv2.COLOR_GRAY2RGB)
    out = (0.35 * gray + 0.65 * 255).astype(np.uint8)
    out[bad] = photo[bad]
    h, w = bad.shape
    edge = cv2.morphologyEx(bad.astype(np.uint8), cv2.MORPH_GRADIENT, np.ones((3, 3), np.uint8)).astype(bool)
    out[edge] = (20, 20, 20)
    for i, d in enumerate(diffs, 1):
        x0, y0, x1, y1 = d.bbox
        p0, p1 = (int(x0 * w), int(y0 * h)), (int(x1 * w) - 1, int(y1 * h) - 1)
        cv2.rectangle(out, p0, p1, (0, 90, 220), 2)
        cv2.rectangle(out, (p0[0], p0[1]), (p0[0] + 16, p0[1] + 16), (0, 90, 220), -1)
        cv2.putText(out, str(i), (p0[0] + 4, p0[1] + 13), cv2.FONT_HERSHEY_SIMPLEX, 0.42, (255, 255, 255), 1, cv2.LINE_AA)
    return out


# ------------------------------------------------------------------ вывод


VERDICT_TEXT = {"match": "СОВПАДАЕТ", "mismatch": "НЕ СОВПАДАЕТ", "attention": "ТРЕБУЕТ ВНИМАНИЯ"}


def template_conclusion(res: PhotoComparison, facade_label: str) -> str:
    lines = [f"Вывод: внешний вид фасада {VERDICT_TEXT[res.verdict].lower()} с графической частью паспорта ({facade_label})."]
    if res.differences:
        lines.append("Отличия:")
        for i, d in enumerate(res.differences, 1):
            lines.append(f"{i}. {d.note[:1].upper() + d.note[1:]} (ΔE00 ≈ {d.delta_e}, {d.share * 100:.0f} % площади фасада).")
    bad_zones = [z for z in res.zones if z.status == "mismatch"]
    for z in bad_zones:
        lines.append(f"Зона цвета {z.hex}{' (≈ ' + z.ral + ')' if z.ral else ''} на фото выглядит как {z.photo_hex}: "
                     f"отличается {z.differs * 100:.0f} % площади зоны.")
    if res.verdict == "match":
        lines.append("Цвета окрашенных поверхностей соответствуют развёртке с учётом освещения; остекление не сравнивалось.")
    lines.append(f"Сравнивалось {res.compared_share * 100:.0f} % площади развёртки (без остекления).")
    return "\n".join(lines)


def png_b64(img: np.ndarray, max_side: int = 768) -> str:
    h, w = img.shape[:2]
    s = min(1.0, max_side / max(h, w))
    if s < 1:
        img = cv2.resize(img, (int(w * s), int(h * s)), interpolation=cv2.INTER_AREA)
    ok, buf = cv2.imencode(".png", cv2.cvtColor(img, cv2.COLOR_RGB2BGR))
    return base64.b64encode(buf.tobytes()).decode("ascii")


def save_rgb(path: Path, img: np.ndarray) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(path), cv2.cvtColor(img, cv2.COLOR_RGB2BGR))


def load_rgb(path: str | Path) -> np.ndarray:
    data = np.fromfile(str(path), dtype=np.uint8)
    img = cv2.imdecode(data, cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("Не удалось прочитать изображение (нужен JPEG или PNG)")
    return cv2.cvtColor(img, cv2.COLOR_BGR2RGB)


def dump(obj) -> str:
    return json.dumps(obj, ensure_ascii=False, indent=2)


# ------------------------------------------------------------------ предложение углов фасада


def _line_y(seg, x: float) -> float:
    x1, y1, x2, y2 = seg
    return y1 if x2 == x1 else y1 + (y2 - y1) * (x - x1) / (x2 - x1)


def _line_x(seg, y: float) -> float:
    x1, y1, x2, y2 = seg
    return x1 if y2 == y1 else x1 + (x2 - x1) * (y - y1) / (y2 - y1)


def suggest_quad(photo: np.ndarray) -> tuple[list[list[float]], dict]:
    """Предлагает 4 угла фасада по линиям: верх — граница с небом (или самая высокая длинная горизонталь),
    низ — нижняя длинная горизонталь (цоколь, отмостка), бока — крайние длинные вертикали (углы здания),
    иначе края кадра. Это подсказка: инспектор проверяет и поправляет точки."""
    h0, w0 = photo.shape[:2]
    s = 800 / max(h0, w0)
    img = cv2.resize(photo, (int(w0 * s), int(h0 * s)), interpolation=cv2.INTER_AREA) if s < 1 else photo.copy()
    s = min(s, 1.0)
    h, w = img.shape[:2]
    gray = cv2.cvtColor(img, cv2.COLOR_RGB2GRAY)
    edges = cv2.Canny(cv2.GaussianBlur(gray, (5, 5), 0), 50, 150)
    segs = cv2.HoughLinesP(edges, 1, np.pi / 180, threshold=60, minLineLength=int(0.12 * w), maxLineGap=12)
    segs = [] if segs is None else [tuple(float(v) for v in l) for l in np.asarray(segs).reshape(-1, 4)]
    horiz, vert = [], []
    for x1, y1, x2, y2 in segs:
        ang = abs(np.degrees(np.arctan2(y2 - y1, x2 - x1)))
        ang = min(ang, 180 - ang)
        length = float(np.hypot(x2 - x1, y2 - y1))
        if ang < 20:
            horiz.append(((x1, y1, x2, y2), length))
        elif ang > 75:
            vert.append(((x1, y1, x2, y2), length))

    # небо: светлые малонасыщенные пиксели, связанные с верхним краем
    hsv = cv2.cvtColor(img, cv2.COLOR_RGB2HSV)
    sky = ((hsv[..., 2] > 150) & (hsv[..., 1] < 60)).astype(np.uint8)
    n, comp, stats, _ = cv2.connectedComponentsWithStats(sky)
    top_ids = {int(v) for v in np.unique(comp[0]) if v}
    sky_mask = np.isin(comp, list(top_ids)) if top_ids else np.zeros_like(sky, bool)
    sky_bottom = np.array([int(np.max(np.where(sky_mask[:, x])[0])) if sky_mask[:, x].any() else 0 for x in range(w)])

    info: dict = {"lines": len(segs)}
    long_h = [(seg, ln) for seg, ln in horiz if ln >= 0.25 * w]
    # верх: длинная горизонталь сразу под небом; без неба — самая высокая в верхней половине
    top = None
    if long_h:
        def sky_gap(seg):
            xm = (seg[0] + seg[2]) / 2
            return abs(_line_y(seg, xm) - sky_bottom[int(np.clip(xm, 0, w - 1))])
        cands = [(seg, ln) for seg, ln in long_h if _line_y(seg, w / 2) < 0.6 * h]
        if cands and sky_mask.any():
            top = min(cands, key=lambda t: sky_gap(t[0]) - 0.02 * t[1])[0]
            info["top"] = "граница с небом"
        elif cands:
            top = min(cands, key=lambda t: _line_y(t[0], w / 2))[0]
            info["top"] = "верхняя горизонталь"
    lows = [(seg, ln) for seg, ln in long_h if _line_y(seg, w / 2) > 0.45 * h]
    bottom = max(lows, key=lambda t: _line_y(t[0], w / 2) + 0.3 * t[1])[0] if lows else None
    if top is None:
        top = (0.0, float(np.median(sky_bottom)) if sky_mask.any() else 0.05 * h, float(w), float(np.median(sky_bottom)) if sky_mask.any() else 0.05 * h)
        info["top"] = info.get("top", "по небу или краю кадра")
    if bottom is None or _line_y(bottom, w / 2) - _line_y(top, w / 2) < 0.2 * h:
        bottom = (0.0, 0.92 * h, float(w), 0.92 * h)
        info["bottom"] = "край кадра"
    else:
        info["bottom"] = "нижняя горизонталь"

    # бока: длинные вертикали между верхом и низом
    def span_ok(seg):
        ya, yb = sorted((seg[1], seg[3]))
        yt, yb2 = _line_y(top, (seg[0] + seg[2]) / 2), _line_y(bottom, (seg[0] + seg[2]) / 2)
        return (yb - ya) >= 0.35 * (yb2 - yt) and ya < yt + 0.5 * (yb2 - yt)
    vs = [seg for seg, ln in vert if span_ok(seg)]
    xs = sorted(((seg[0] + seg[2]) / 2, seg) for seg in vs)
    left = xs[0][1] if xs and xs[0][0] < 0.35 * w else (0.0, 0.0, 0.0, float(h))
    right = xs[-1][1] if xs and xs[-1][0] > 0.65 * w else (float(w - 1), 0.0, float(w - 1), float(h))
    info["sides"] = int(left != (0.0, 0.0, 0.0, float(h))) + int(right != (float(w - 1), 0.0, float(w - 1), float(h)))

    def cross(hseg, vseg):
        y = _line_y(hseg, _line_x(vseg, _line_y(hseg, (vseg[0] + vseg[2]) / 2)))
        x = _line_x(vseg, y)
        return [float(np.clip(x, 0, w - 1)) / s, float(np.clip(y, 0, h - 1)) / s]

    quad = [cross(top, left), cross(top, right), cross(bottom, right), cross(bottom, left)]

    def slope(seg):
        return np.degrees(np.arctan2(seg[3] - seg[1], seg[2] - seg[0] if seg[2] != seg[0] else 1e-6))

    area = cv2.contourArea(np.float32(quad) * s)
    info["confident"] = bool(abs(slope(top) - slope(bottom)) <= 8 and area >= 0.15 * w * h)
    if not info["confident"]:  # линии противоречат друг другу — лучше честно отдать рамку по умолчанию
        mx, my = 0.12 * w0, 0.12 * h0
        quad = [[mx, my], [w0 - mx, my], [w0 - mx, h0 - my], [mx, h0 - my]]
    return [[round(x, 1), round(y, 1)] for x, y in quad], info
