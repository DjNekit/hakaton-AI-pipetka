"""Сопоставление пояснительной записки с позициями таблицы отделки (без ЛЛМ).

Алгоритм: записка режется на фразы (по «.» и «;»), внутри фразы находятся группы кодов
(«NCS S 1020-Y10R (RAL 1015)»), текст перед каждой группой сопоставляется с наименованиями
элементов таблицы по основам слов. Языковая модель здесь не участвует: сравнение кодов делает код.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field

from .extract import FinishRow
from .palettes import NCS_NOS_RE, NCS_RE, RAL_RE, parse_color_spec

_WORD = re.compile(r"[а-яёa-z]+", re.IGNORECASE)
_STOP = {"стены", "стен"}  # слишком общие — учитываются, но с меньшим весом


def _stems(text: str) -> list[str]:
    out = []
    for w in _WORD.findall(text.lower().replace("ё", "е")):
        if len(w) >= 4:
            out.append(w[:4])
    return out


@dataclass
class Mention:
    elements: list[str]  # номера позиций таблицы
    ral: list[str] = field(default_factory=list)
    ncs: list[str] = field(default_factory=list)
    quote: str = ""
    source: str = "rules"

    def to_dict(self) -> dict:
        return {"elements": self.elements, "ral": self.ral, "ncs": self.ncs, "quote": self.quote, "source": self.source}


def _code_groups(clause: str) -> list[tuple[int, int]]:
    spans = sorted(
        [(m.start(), m.end()) for rx in (RAL_RE, NCS_RE, NCS_NOS_RE) for m in rx.finditer(clause)]
    )
    groups: list[list[int]] = []
    for s, e in spans:
        if groups and s - groups[-1][1] <= 6 and not re.search(r"[а-яёa-z]{3,}", clause[groups[-1][1]:s], re.I):
            groups[-1][1] = max(groups[-1][1], e)
        elif groups and s < groups[-1][1]:
            groups[-1][1] = max(groups[-1][1], e)
        else:
            groups.append([s, e])
    # расширяем на «NCS » перед S-кодом
    return [(s, e) for s, e in groups]


def _match_elements(text: str, rows: list[FinishRow]) -> list[str]:
    words = set(_stems(text))
    if not words:
        return []
    best, best_rows = 0.0, []
    for r in rows:
        stems = list(dict.fromkeys(_stems(r.name)))
        if not stems:
            continue
        hits = sum(1 for s in stems if s in words)
        score = hits / len(stems)
        if hits and all(s in {x[:4] for x in _STOP} for s in stems if s in words) and len(stems) > 1:
            score *= 0.5
        if score > best + 1e-9:
            best, best_rows = score, [r.n]
        elif abs(score - best) < 1e-9 and score > 0:
            best_rows.append(r.n)
    return best_rows if best > 0 else []


def extract_mentions(note: str, rows: list[FinishRow]) -> list[Mention]:
    mentions: list[Mention] = []
    text = note.replace("\n", " ")
    clauses = re.split(r"(?<=[.;])\s+|;\s*", text)
    for clause in clauses:
        groups = _code_groups(clause)
        if not groups:
            continue
        prev_end = 0
        last_elements: list[str] = []
        for s, e in groups:
            segment = clause[prev_end:s]
            elements = _match_elements(segment, rows) or last_elements
            if not elements:
                elements = _match_elements(clause, rows)
            spec = parse_color_spec(clause[s:e])
            if elements and not spec.empty:
                mentions.append(
                    Mention(
                        elements=elements,
                        ral=spec.ral,
                        ncs=[n.notation for n in spec.ncs],
                        quote=clause[max(0, prev_end):e].strip(" ,—-"),
                    )
                )
            last_elements = elements
            prev_end = e
    return mentions
