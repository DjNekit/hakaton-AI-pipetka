"""Сверка документов одной заявки между собой (пакет: паспорт, дизайн-проект вывесок, фото).

Каждый документ проверяется своими правилами (rules.yaml); здесь — только то, что видно по пакету целиком.
Вердикт пакета считает бэкенд: худший из вердиктов документов и этих проверок.
"""
from __future__ import annotations

import re

_ABBR = [
    (r"\bулица\b", "ул"), (r"\bпроспект\b", "пр-т"), (r"\bпр\b", "пр-т"), (r"\bпереулок\b", "пер"),
    (r"\bшоссе\b", "ш"), (r"\bбульвар\b", "б-р"), (r"\bнабережная\b", "наб"), (r"\bплощадь\b", "пл"),
    (r"\bпроезд\b", "пр-д"), (r"\bдом\b", "д"), (r"\bкорпус\b", "корп"), (r"\bк\b", "корп"), (r"\bстроение\b", "стр"),
]
_STOP = {"г", "город", "москва", "москвы", "россия", "рф", "ул", "пр-т", "пер", "ш", "б-р", "наб", "пл", "пр-д", "д", "корп",
         "стр", "владение", "вл", "муниципальный", "округ", "район", "внутригородская", "территория", "адрес"}


def normalize_address(text: str) -> tuple[frozenset, tuple] | None:
    """Адрес → (значимые слова улицы, номера дома/корпуса/строения). Порядок слов и сокращения не важны."""
    if not text:
        return None
    t = text.lower().replace("ё", "е")
    t = re.sub(r"[«»\"'(),;:]", " ", t).replace(".", " ")
    for pat, rep in _ABBR:
        t = re.sub(pat, rep, t)
    words = [w for w in re.findall(r"[а-яa-z\-]+", t) if len(w) > 2 and w not in _STOP]
    numbers = tuple(re.findall(r"\d+[а-я]?", t))
    if not words and not numbers:
        return None
    return frozenset(w[:6] for w in words), numbers  # основа слова: «Бирюзова» и «Бирюзова,» совпадут


def same_address(a, b) -> bool:
    return bool(a[0] & b[0]) and a[1] == b[1]


def package_checks(docs: list[dict], photos: list[dict]) -> list[dict]:
    """docs: [{doc_id, file, state, report?, sha256}]; результат — список проверок как в чек-листе документа."""
    checks = []
    done = [d for d in docs if d.get("state") == "done" and d.get("report")]

    # PKG-01: адрес
    addrs = [(d, (d["report"].get("summary") or {}).get("address")) for d in done]
    known = [(d, a, normalize_address(a)) for d, a in addrs if a and normalize_address(a)]
    missing = [d["file"] for d, a in addrs if not a or not normalize_address(a)]
    item = {"rule": "PKG-01", "title": "Адрес объекта одинаковый во всех документах пакета",
            "ref": "Документы одной заявки должны относиться к одному объекту"}
    if len(done) < 2:
        item.update(status="skip", note="В пакете меньше двух проверенных документов")
    else:
        base = known[0] if known else None
        differ = [(d, a) for d, a, n in known[1:] if not same_address(base[2], n)] if base else []
        if differ:
            lines = [f"«{base[0]['file']}»: {base[1]}"] + [f"«{d['file']}»: {a}" for d, a in differ]
            item.update(status="fail", note="Адреса не совпадают — " + "; ".join(lines))
        elif missing:
            item.update(status="warn", note="Адрес не найден в: " + ", ".join(f"«{m}»" for m in missing))
        else:
            item.update(status="ok", note=f"Во всех документах: {base[1]}" if base else "")
    checks.append(item)

    # PKG-02: все документы проверены
    failed = [d for d in docs if d.get("state") != "done"]
    checks.append({
        "rule": "PKG-02", "title": "Все документы пакета проверены", "ref": "Комплектность заявки",
        "status": "fail" if failed else "ok",
        "note": "Не удалось проверить: " + "; ".join(f"«{d['file']}» — {d.get('error') or 'ошибка'}" for d in failed) if failed else "",
    })

    # PKG-03: повторы
    seen, dups = {}, []
    for d in docs + photos:
        h = d.get("sha256")
        if h and h in seen:
            dups.append(f"«{d.get('file') or d.get('name')}» = «{seen[h]}»")
        elif h:
            seen[h] = d.get("file") or d.get("name")
    checks.append({
        "rule": "PKG-03", "title": "В пакете нет повторяющихся файлов", "ref": "Комплектность заявки",
        "status": "warn" if dups else "ok", "note": "Одинаковые файлы: " + ", ".join(dups) if dups else "",
    })
    return checks
