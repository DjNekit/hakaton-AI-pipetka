"""Архитектурно-художественные концепции (АХК) внешнего облика улиц Москвы.

Справочник data/ahk_streets.csv — улицы, магистрали и территории с утверждёнными АХК по этапам (1–4).
Источник перечня — сводка sign365.ru по материалам Москомархитектуры (официальный раздел на mos.ru:
«Утверждённые архитектурно-художественные концепции…»); перед использованием в работе — сверить с mos.ru.
Сами альбомы АХК (требования к вывескам на конкретных домах) — PDF на mos.ru; сервис только определяет,
что объект находится на улице с АХК, и даёт ссылку для ручной сверки.
"""
from __future__ import annotations

import csv
import re
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

DATA = Path(__file__).resolve().parent / "data" / "ahk_streets.csv"
AHK_URL = (
    "https://www.mos.ru/dgp/function/poryadok-razmesheniya-informacionnykh-konstrukcii-vyvesok/"
    "utverzhdennye-arkhitekturno-khudozhestvennye-koncepcii-vneshnego-oblika-ulic-magistralei-i-territorii-goroda-moskvy-2-etap/"
)

# тип улицы → каноническое обозначение
_TYPES = [
    (r"улица|ул", "ул"),
    (r"проспект|пр-т|просп", "пр-т"),
    (r"шоссе|ш", "ш"),
    (r"набережная|наб", "наб"),
    (r"бульвар|б-р", "б-р"),
    (r"переулок|пер", "пер"),
    (r"площадь|пл", "пл"),
    (r"проезд|пр-д|пр", "пр-д"),
    (r"аллея", "аллея"),
    (r"кольцо", "кольцо"),
    (r"вал", "вал"),
]
_ABBR = {"б": "большая", "м": "малая", "в": "верхняя", "н": "нижняя", "ст": "старая"}
_ADJ_FORMS = {"большой": "большая", "малый": "малая", "большая": "большая", "малая": "малая", "верхний": "верхняя",
              "верхняя": "верхняя", "старая": "старая", "старый": "старая"}


def _norm(s: str) -> str:
    return s.lower().replace("ё", "е").replace("–", "-").replace("—", "-")


def street_key(name: str) -> tuple[str, frozenset[str]] | None:
    """(тип, слова названия) — «Маршала Бирюзова ул.» и «ул. Маршала Бирюзова» дают один ключ."""
    s = _norm(name)
    kind = ""
    for pat, canon in _TYPES:
        m = re.search(rf"(?<![а-яa-z-])(?:{pat})(?![а-яa-z-])\.?", s)
        if m:
            kind = canon
            s = s[: m.start()] + " " + s[m.end():]
            break
    words = []
    for w in re.findall(r"[а-яa-z0-9-]+", s):
        w = _ABBR.get(w, _ADJ_FORMS.get(w, w))
        if w in ("г", "москва", "город"):
            continue
        words.append(w)
    if not words:
        return None
    return kind, frozenset(words)


@dataclass
class AhkStreet:
    street: str
    stage: str
    zone: str
    since: str


@lru_cache(maxsize=1)
def _table() -> dict[tuple[str, frozenset[str]], AhkStreet]:
    out = {}
    with open(DATA, encoding="utf-8") as fh:
        for row in csv.DictReader(fh):
            key = street_key(row["street"])
            if key:
                out.setdefault(key, AhkStreet(**row))
    return out


def street_of(address: str | None) -> str | None:
    """Улица из адреса «г. Москва, ул. Маршала Бирюзова, д. 20, корп. 1» или «Маршала Бирюзова ул., д. 20»."""
    if not address:
        return None
    parts = [p.strip() for p in re.split(r"[,;]", address) if p.strip()]
    for p in parts:
        low = _norm(p)
        if re.match(r"^(г\.?|город)\s*москва$|^москва$|^\d{6}$", low):
            continue
        if re.match(r"^(д\.?|дом|корп\.?|корпус|стр\.?|строение|вл\.?|владение)\s*\d", low):
            break
        return re.sub(r"\s+(д\.?|дом)\s*\d.*$", "", p, flags=re.I).strip()
    return None


def find_ahk(address: str | None) -> AhkStreet | None:
    street = street_of(address)
    if not street:
        return None
    key = street_key(street)
    if not key:
        return None
    table = _table()
    if key in table:
        return table[key]
    if not key[0]:  # тип в адресе не указан — ищем по словам, если совпадение однозначное
        hits = [v for (k, w), v in table.items() if w == key[1]]
        return hits[0] if len(hits) == 1 else None
    return None
