"""Анализ графической части: цвет зон по выноскам, палитра развёртки, образцы цвета, остекление."""
from __future__ import annotations

import math
from dataclasses import dataclass

import cv2
import numpy as np

from .color import delta_e2000, dominant_color, kmeans_lab, merge_close, rgb_to_hex, srgb_to_lab
from .extract import Marker
from .ingest import BBox, PageData

RENDER_SCALE = 2.0  # 144 dpi


@dataclass
class ColorSample:
    rgb: np.ndarray
    lab: np.ndarray
    share: float
    n_pixels: int
    area_bbox: BBox  # в пунктах

    @property
    def hex(self) -> str:
        return rgb_to_hex(self.rgb)


def _grid(img: np.ndarray, bbox_pt: BBox, scale: float):
    h, w = img.shape[:2]
    x0 = max(0, int(math.floor(bbox_pt[0] * scale)))
    y0 = max(0, int(math.floor(bbox_pt[1] * scale)))
    x1 = min(w, int(math.ceil(bbox_pt[2] * scale)))
    y1 = min(h, int(math.ceil(bbox_pt[3] * scale)))
    if x1 <= x0 or y1 <= y0:
        return None
    ys, xs = np.mgrid[y0:y1, x0:x1]
    # центры пикселей в пунктах
    return (xs + 0.5) / scale, (ys + 0.5) / scale, img[y0:y1, x0:x1]


def _seg_dist(px: np.ndarray, py: np.ndarray, seg) -> np.ndarray:
    ax, ay, bx, by = seg
    vx, vy = bx - ax, by - ay
    L2 = vx * vx + vy * vy
    if L2 == 0:
        return np.hypot(px - ax, py - ay)
    t = np.clip(((px - ax) * vx + (py - ay) * vy) / L2, 0, 1)
    return np.hypot(px - (ax + t * vx), py - (ay + t * vy))


def sample_marker(
    img: np.ndarray,
    marker: Marker,
    others: list[Marker],
    page: PageData,
    scale: float = RENDER_SCALE,
) -> ColorSample | None:
    """Цвет зоны, на которую указывает выноска.

    * Выноска с линией — небольшой круг у конца линии (за вычетом самой линии).
    * Номер внутри зоны — кольцо вокруг кружка (за вычетом других выносок, линий и текста).
    """
    if marker.target is not None:
        cx, cy = marker.target
        r_in, r_out = 0.0, 1.8
    else:
        cx, cy = marker.center
        r_in, r_out = marker.radius + 2.0, marker.radius + 6.5
    g = _grid(img, (cx - r_out - 1, cy - r_out - 1, cx + r_out + 1, cy + r_out + 1), scale)
    if g is None:
        return None
    xs, ys, patch = g
    d = np.hypot(xs - cx, ys - cy)
    mask = (d <= r_out) & (d >= r_in)
    for m in [marker] + others:
        if m.leader is not None:
            mask &= _seg_dist(xs, ys, m.leader) > 1.1
        if m is not marker:
            mask &= np.hypot(xs - m.center[0], ys - m.center[1]) > m.radius + 1.5
    if marker.target is None:
        for w in page.words:
            if w.text == marker.label and abs(w.center[0] - cx) < marker.radius and abs(w.center[1] - cy) < marker.radius:
                continue
            mask &= ~((xs >= w.x0 - 1) & (xs <= w.x1 + 1) & (ys >= w.top - 1) & (ys <= w.bottom + 1))
    px = patch[mask]
    if len(px) < 6:
        return None
    rgb, share = dominant_color(px)
    return ColorSample(rgb, srgb_to_lab(rgb), share, int(len(px)), (cx - r_out, cy - r_out, cx + r_out, cy + r_out))


def measure_box(img: np.ndarray, bbox: BBox, inset: float = 0.22, scale: float = RENDER_SCALE) -> ColorSample | None:
    """Доминирующий цвет внутри прямоугольника (например, ячейки «Образец цвета»)."""
    x0, t, x1, b = bbox
    dx, dy = (x1 - x0) * inset, (b - t) * inset
    inner = (x0 + dx, t + dy, x1 - dx, b - dy)
    g = _grid(img, inner, scale)
    if g is None:
        return None
    _, _, patch = g
    px = patch.reshape(-1, 3)
    if len(px) < 4:
        return None
    rgb, share = dominant_color(px)
    return ColorSample(rgb, srgb_to_lab(rgb), share, int(len(px)), inner)


@dataclass
class PaletteCluster:
    lab: np.ndarray
    rgb: np.ndarray
    share: float
    boxes: list[BBox]  # крупнейшие связные области, пункты

    @property
    def hex(self) -> str:
        return rgb_to_hex(self.rgb)


def facade_palette(
    img: np.ndarray,
    page: PageData,
    markers: list[Marker],
    scale: float = RENDER_SCALE,
    k: int = 10,
    min_share: float = 0.006,
) -> list[PaletteCluster]:
    """Палитра «плоских» (без сглаживания) цветных пикселей развёртки."""
    # анализ палитры на уменьшенном изображении (~72 dpi): быстрее и достаточно точно
    page_area = page.width * page.height
    raster = any((im.bbox[2] - im.bbox[0]) * (im.bbox[3] - im.bbox[1]) > 0.3 * page_area for im in page.images)
    target_scale = 1.0
    if scale > target_scale:
        f = target_scale / scale
        interp = cv2.INTER_AREA if raster else cv2.INTER_NEAREST
        img = cv2.resize(img, (int(img.shape[1] * f), int(img.shape[0] * f)), interpolation=interp)
        scale = target_scale
    if raster:  # шум скана/JPEG: сглаживаем и ослабляем критерий «плоскости»
        img = cv2.medianBlur(img, 3)
    h, w = img.shape[:2]
    kernel = np.ones((3, 3), np.uint8)
    mx = cv2.dilate(img, kernel)
    mn = cv2.erode(img, kernel)
    flat = (mx.astype(np.int16) - mn.astype(np.int16)).max(axis=2) <= (12 if raster else 6)
    exclude = np.zeros((h, w), dtype=bool)
    for wd in page.words:
        x0, y0 = int(max(0, (wd.x0 - 1.5) * scale)), int(max(0, (wd.top - 1.5) * scale))
        x1, y1 = int(min(w, (wd.x1 + 1.5) * scale)), int(min(h, (wd.bottom + 1.5) * scale))
        exclude[y0:y1, x0:x1] = True
    for m in markers:
        cv2.circle(exclude.view(np.uint8), (int(m.center[0] * scale), int(m.center[1] * scale)), int((m.radius + 2) * scale), 1, -1)
        if m.leader is not None:
            a = (int(m.leader[0] * scale), int(m.leader[1] * scale))
            b = (int(m.leader[2] * scale), int(m.leader[3] * scale))
            cv2.line(exclude.view(np.uint8), a, b, 1, max(2, int(2.5 * scale)))
    cand0 = flat & ~exclude
    ys, xs = np.nonzero(cand0)
    if len(ys) < 50:
        return []
    lab_px = srgb_to_lab(img[ys, xs].astype(np.float64))
    L = lab_px[:, 0]
    C = np.hypot(lab_px[:, 1], lab_px[:, 2])
    keep = ~(((L > 95) & (C < 10)) | ((L > 92) & (C < 4)) | ((L < 18) & (C < 8)))  # бумага и линии/текст
    ys, xs, lab_px = ys[keep], xs[keep], lab_px[keep]
    if len(ys) < 50:
        return []
    cand = np.zeros((h, w), dtype=bool)
    cand[ys, xs] = True
    rng = np.random.default_rng(0)
    idx = rng.choice(len(ys), size=min(len(ys), 20000), replace=False)
    sample = lab_px[idx]
    centers, labels = kmeans_lab(sample, k)
    weights = np.bincount(labels, minlength=len(centers)) / len(labels)
    merged = merge_close(centers, weights, threshold=5.0)
    clusters: list[PaletteCluster] = []
    for center, share in merged:
        if share < min_share:
            continue
        near = np.linalg.norm(lab_px - center, axis=1) < 7  # ΔE76 — быстрый отбор пикселей кластера
        comp_mask = np.zeros((h, w), dtype=np.uint8)
        comp_mask[ys[near], xs[near]] = 1
        n, _, stats, _ = cv2.connectedComponentsWithStats(comp_mask, connectivity=8)
        order = np.argsort(-stats[1:, cv2.CC_STAT_AREA])[:4] + 1 if n > 1 else []
        boxes = []
        for i in order:
            x, y, bw, bh, area = stats[i]
            if area < 30:
                continue
            boxes.append((x / scale, y / scale, (x + bw) / scale, (y + bh) / scale))
        rgb = np.median(img[comp_mask.astype(bool)], axis=0) if comp_mask.any() else np.array([0, 0, 0])
        clusters.append(PaletteCluster(center, rgb, float(share), boxes))
    return clusters


@dataclass
class GlazingGroup:
    fill_rgb: tuple[float, float, float]
    boxes: list[BBox]


def glazing_groups(page: PageData, *, max_frame_scale: float) -> list[GlazingGroup]:
    """Векторное остекление: повторяющиеся прямоугольники, вложенные в другие повторяющиеся (рамы)."""
    groups: dict[tuple, list] = {}
    for r in page.rects:
        if r.fill_rgb is None:
            continue
        x0, t, x1, b = r.bbox
        w, h = x1 - x0, b - t
        if w < 4 or h < 4 or w > 200 or h > 200:
            continue
        key = (round(w), round(h), tuple(int(round(c / 4)) for c in r.fill_rgb))
        groups.setdefault(key, []).append(r)
    rep = {k: v for k, v in groups.items() if len(v) >= 4}
    result: list[GlazingGroup] = []
    for key, rects in rep.items():
        inside = 0
        for r in rects:
            for k2, others in rep.items():
                if (k2 == key or k2[0] <= key[0] or k2[1] <= key[1]
                        or k2[0] > key[0] * max_frame_scale
                        or k2[1] > key[1] * max_frame_scale):
                    continue
                # Рама окружает стекло со всех сторон. Панель стены внутри
                # большого прямоугольника здания не является окном.
                if any(o.bbox[0] < r.bbox[0] and o.bbox[1] < r.bbox[1] and o.bbox[2] > r.bbox[2] and o.bbox[3] > r.bbox[3] for o in others):
                    inside += 1
                    break
        if inside >= 0.8 * len(rects):
            result.append(GlazingGroup(rects[0].fill_rgb, [r.bbox for r in rects]))
    return result


def union_bbox(boxes: list[BBox]) -> BBox | None:
    if not boxes:
        return None
    return (min(b[0] for b in boxes), min(b[1] for b in boxes), max(b[2] for b in boxes), max(b[3] for b in boxes))
