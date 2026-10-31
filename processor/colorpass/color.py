"""Цветовая математика: sRGB <-> CIELAB (D65) и цветовое отличие CIEDE2000.

Реализовано на numpy без внешних цветовых библиотек, чтобы не тянуть зависимости.
Формулы: IEC 61966-2-1 (sRGB), CIE 15 (Lab), Sharma et al. 2005 (CIEDE2000).
"""
from __future__ import annotations

import math
from typing import Iterable, Sequence

import numpy as np

# Белая точка D65 (нормированная, Y = 1)
_XN, _YN, _ZN = 0.95047, 1.0, 1.08883

_M_RGB2XYZ = np.array(
    [
        [0.4124564, 0.3575761, 0.1804375],
        [0.2126729, 0.7151522, 0.0721750],
        [0.0193339, 0.1191920, 0.9503041],
    ]
)


def hex_to_rgb(value: str) -> tuple[int, int, int]:
    v = value.strip().lstrip("#")
    if len(v) != 6:
        raise ValueError(f"Ожидался HEX вида #RRGGBB, получено {value!r}")
    return int(v[0:2], 16), int(v[2:4], 16), int(v[4:6], 16)


def rgb_to_hex(rgb: Sequence[float]) -> str:
    r, g, b = (int(round(max(0, min(255, c)))) for c in rgb[:3])
    return f"#{r:02X}{g:02X}{b:02X}"


def srgb_to_lab(rgb: np.ndarray | Sequence[float]) -> np.ndarray:
    """sRGB 0..255 (форма (..., 3)) -> CIELAB (D65)."""
    arr = np.asarray(rgb, dtype=np.float64) / 255.0
    lin = np.where(arr <= 0.04045, arr / 12.92, ((arr + 0.055) / 1.055) ** 2.4)
    xyz = lin @ _M_RGB2XYZ.T
    x = xyz[..., 0] / _XN
    y = xyz[..., 1] / _YN
    z = xyz[..., 2] / _ZN
    eps, kappa = 216 / 24389, 24389 / 27

    def f(t: np.ndarray) -> np.ndarray:
        return np.where(t > eps, np.cbrt(t), (kappa * t + 16) / 116)

    fx, fy, fz = f(x), f(y), f(z)
    lab = np.stack([116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)], axis=-1)
    return lab


def lab_to_srgb(lab: np.ndarray | Sequence[float]) -> np.ndarray:
    """CIELAB (D65) -> sRGB 0..255 (с обрезкой в гамут)."""
    lab = np.asarray(lab, dtype=np.float64)
    fy = (lab[..., 0] + 16) / 116
    fx = fy + lab[..., 1] / 500
    fz = fy - lab[..., 2] / 200
    eps, kappa = 216 / 24389, 24389 / 27

    def finv(t: np.ndarray) -> np.ndarray:
        t3 = t**3
        return np.where(t3 > eps, t3, (116 * t - 16) / kappa)

    xyz = np.stack([finv(fx) * _XN, finv(fy) * _YN, finv(fz) * _ZN], axis=-1)
    lin = xyz @ np.linalg.inv(_M_RGB2XYZ).T
    lin = np.clip(lin, 0, 1)
    srgb = np.where(lin <= 0.0031308, lin * 12.92, 1.055 * np.power(lin, 1 / 2.4) - 0.055)
    return np.clip(srgb * 255.0, 0, 255)


def chroma(lab: Sequence[float]) -> float:
    return float(math.hypot(lab[1], lab[2]))


def delta_e2000(
    lab1: np.ndarray | Sequence[float], lab2: np.ndarray | Sequence[float], kl: float = 1.0
) -> np.ndarray | float:
    """CIEDE2000 (kC = kH = 1; kL = 1 по умолчанию, 2 — для фото, где светлота зависит от освещения).

    Поддерживает broadcasting по последней оси = 3."""
    l1, a1, b1 = np.moveaxis(np.asarray(lab1, dtype=np.float64), -1, 0)
    l2, a2, b2 = np.moveaxis(np.asarray(lab2, dtype=np.float64), -1, 0)

    c1 = np.hypot(a1, b1)
    c2 = np.hypot(a2, b2)
    c_bar = (c1 + c2) / 2
    g = 0.5 * (1 - np.sqrt(c_bar**7 / (c_bar**7 + 25.0**7)))
    a1p = (1 + g) * a1
    a2p = (1 + g) * a2
    c1p = np.hypot(a1p, b1)
    c2p = np.hypot(a2p, b2)
    h1p = np.degrees(np.arctan2(b1, a1p)) % 360
    h2p = np.degrees(np.arctan2(b2, a2p)) % 360

    dlp = l2 - l1
    dcp = c2p - c1p
    zero = (c1p * c2p) == 0
    dh = h2p - h1p
    dh = np.where(dh > 180, dh - 360, dh)
    dh = np.where(dh < -180, dh + 360, dh)
    dh = np.where(zero, 0.0, dh)
    dhp = 2 * np.sqrt(c1p * c2p) * np.sin(np.radians(dh / 2))

    lp_bar = (l1 + l2) / 2
    cp_bar = (c1p + c2p) / 2
    hsum = h1p + h2p
    hp_bar = np.where(
        zero,
        hsum,
        np.where(
            np.abs(h1p - h2p) <= 180,
            hsum / 2,
            np.where(hsum < 360, (hsum + 360) / 2, (hsum - 360) / 2),
        ),
    )
    t = (
        1
        - 0.17 * np.cos(np.radians(hp_bar - 30))
        + 0.24 * np.cos(np.radians(2 * hp_bar))
        + 0.32 * np.cos(np.radians(3 * hp_bar + 6))
        - 0.20 * np.cos(np.radians(4 * hp_bar - 63))
    )
    d_theta = 30 * np.exp(-(((hp_bar - 275) / 25) ** 2))
    rc = 2 * np.sqrt(cp_bar**7 / (cp_bar**7 + 25.0**7))
    sl = 1 + (0.015 * (lp_bar - 50) ** 2) / np.sqrt(20 + (lp_bar - 50) ** 2)
    sc = 1 + 0.045 * cp_bar
    sh = 1 + 0.015 * cp_bar * t
    rt = -np.sin(np.radians(2 * d_theta)) * rc
    de = np.sqrt(
        (dlp / (kl * sl)) ** 2 + (dcp / sc) ** 2 + (dhp / sh) ** 2 + rt * (dcp / sc) * (dhp / sh)
    )
    if np.ndim(de) == 0:
        return float(de)
    return de


def dominant_color(pixels_rgb: np.ndarray, merge_de: float = 6.0) -> tuple[np.ndarray, float]:
    """Доминирующий цвет набора пикселей (N, 3) sRGB.

    Грубая кластеризация: квантование в Lab-сетку 4x4x4, затем медиана самого большого кластера.
    Возвращает (rgb медианы, доля пикселей в кластере).
    """
    px = np.asarray(pixels_rgb, dtype=np.float64).reshape(-1, 3)
    if len(px) == 0:
        raise ValueError("Нет пикселей для оценки цвета")
    lab = srgb_to_lab(px)
    keys = np.floor(lab / np.array([4.0, 4.0, 4.0])).astype(np.int64)
    _, inverse, counts = np.unique(keys, axis=0, return_inverse=True, return_counts=True)
    inverse = inverse.reshape(-1)
    best = int(np.argmax(counts))
    center = np.median(lab[inverse == best], axis=0)
    near = delta_e2000(lab, center) <= merge_de
    rgb = np.median(px[near], axis=0)
    return rgb, float(near.mean())


def kmeans_lab(lab: np.ndarray, k: int, iters: int = 20, seed: int = 0) -> tuple[np.ndarray, np.ndarray]:
    """Простой k-means в Lab (евклидово расстояние) — без зависимостей от sklearn."""
    rng = np.random.default_rng(seed)
    n = len(lab)
    k = max(1, min(k, n))
    # k-means++ инициализация
    centers = [lab[rng.integers(n)]]
    for _ in range(1, k):
        d2 = np.min(((lab[:, None, :] - np.array(centers)[None, :, :]) ** 2).sum(-1), axis=1)
        if d2.sum() == 0:
            break
        centers.append(lab[rng.choice(n, p=d2 / d2.sum())])
    centers = np.array(centers)
    labels = np.zeros(n, dtype=np.int64)
    for _ in range(iters):
        d = ((lab[:, None, :] - centers[None, :, :]) ** 2).sum(-1)
        labels = d.argmin(1)
        new = np.array([lab[labels == i].mean(0) if np.any(labels == i) else centers[i] for i in range(len(centers))])
        if np.allclose(new, centers, atol=1e-3):
            break
        centers = new
    return centers, labels


def merge_close(centers: np.ndarray, weights: Iterable[float], threshold: float) -> list[tuple[np.ndarray, float]]:
    """Сливает близкие (ΔE00 < threshold) центры кластеров, суммируя веса."""
    items = sorted(zip(list(centers), list(weights)), key=lambda t: -t[1])
    merged: list[tuple[np.ndarray, float]] = []
    for c, w in items:
        for i, (mc, mw) in enumerate(merged):
            if delta_e2000(c, mc) < threshold:
                merged[i] = ((mc * mw + c * w) / (mw + w), mw + w)
                break
        else:
            merged.append((np.asarray(c, dtype=np.float64), float(w)))
    return merged
