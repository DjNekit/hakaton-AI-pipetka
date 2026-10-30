"""Задачи для ЛЛМ. Принцип: модель только читает текст и формулирует выводы,
а все числа, коды и решения «соответствует / не соответствует» считает код.
Ответы модели валидируются: коды, которых нет в исходном тексте, отбрасываются.
"""
from __future__ import annotations

import json
import re

from .extract import FinishRow
from .llm import LLMClient
from .palettes import parse_color_spec
from .textmatch import Mention

MENTIONS_SYSTEM = (
    "Ты — эксперт по паспортам колористических решений фасадов (ПП Москвы № 114-ПП). "
    "Тебе дают пояснительную записку и перечень позиций таблицы отделки. Найди в записке, какие марки цвета "
    "(RAL и NCS) указаны для каждой позиции. Правила: используй только то, что прямо написано в записке; "
    "не додумывай и не переноси коды из таблицы; если для позиции цвет в записке не указан — не включай её; "
    "RAL — 4 цифры без префикса; NCS — в виде «S 1020-Y10R»; в поле quote — дословный фрагмент записки. "
    "Отвечай строго JSON по схеме."
)

MENTIONS_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "mentions": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "element_n": {"type": "string"},
                    "ral": {"type": "array", "items": {"type": "string"}},
                    "ncs": {"type": "array", "items": {"type": "string"}},
                    "quote": {"type": "string"},
                },
                "required": ["element_n", "ral", "ncs", "quote"],
            },
        }
    },
    "required": ["mentions"],
}


def llm_mentions(client: LLMClient, note: str, rows: list[FinishRow]) -> list[Mention]:
    table = "\n".join(f"{r.n}. {r.name}" for r in rows)
    user = f"Позиции таблицы отделки:\n{table}\n\nПояснительная записка:\n{note[:12000]}"
    data = client.chat_json(MENTIONS_SYSTEM, user, MENTIONS_SCHEMA, max_tokens=2500)
    note_spec = parse_color_spec(note)
    note_ral = set(note_spec.ral)
    note_ncs = {n.notation for n in note_spec.ncs}
    valid_n = {r.n for r in rows}
    out: list[Mention] = []
    for m in data.get("mentions", []):
        # модели пишут номер по-разному: «3», «3.», «№ 3», «3. Цоколь», «2.1.2 Стены» — берём ведущий номер
        raw_n = str(m.get("element_n", ""))
        num = re.match(r"\D*(\d+(?:\.\d+)*)", raw_n)
        n = num.group(1) if num else raw_n.strip(" .№")
        if n not in valid_n:
            continue
        ral = []
        for code in m.get("ral", []):
            digits = re.sub(r"\D", "", str(code))
            if len(digits) == 4 and digits in note_ral:  # защита от галлюцинаций
                ral.append(digits)
        ncs = []
        for code in m.get("ncs", []):
            spec = parse_color_spec(str(code) if str(code).upper().startswith(("S", "NCS")) else f"S {code}")
            for c in spec.ncs:
                if c.notation in note_ncs:
                    ncs.append(c.notation)
        if ral or ncs:
            out.append(Mention(elements=[n], ral=ral, ncs=ncs, quote=str(m.get("quote", ""))[:300], source="llm"))
    return out


CONCLUSION_SYSTEM = (
    "Ты — эксперт, готовящий заключение по проверке документа: паспорта колористического решения фасадов "
    "(ПП Москвы № 114-ПП) или дизайн-проекта размещения вывесок (ПП Москвы № 902-ПП) — вид документа указан "
    "в сведениях (kind: passport или signage). Пиши официально-деловым стилем на русском языке, кратко (до 250 слов). "
    "Используй ТОЛЬКО переданные факты и замечания, не добавляй новых, не меняй коды и номера пунктов. "
    "Структура: 1) вывод (соответствует / требует доработки); 2) нумерованный перечень замечаний с указанием "
    "листа и требования; 3) рекомендация. Без markdown-заголовков, без вступлений."
)


def llm_conclusion(client: LLMClient, summary: dict, findings: list[dict]) -> str:
    compact = [
        {
            "правило": f["rule"],
            "важность": "ошибка" if f["severity"] == "error" else "предупреждение",
            "лист": (f["page"] + 1) if f.get("page") is not None else None,
            "суть": f["message"],
            "основание": f.get("ref"),
        }
        for f in findings
        if f["severity"] in ("error", "warning")
    ]
    user = "Сведения о паспорте:\n" + json.dumps(summary, ensure_ascii=False, indent=1)
    user += "\n\nЗамечания автоматической проверки:\n" + json.dumps(compact, ensure_ascii=False, indent=1)
    return client.chat(CONCLUSION_SYSTEM, user, max_tokens=1500)


# ------------------------------------------------------------------ сравнение фото с развёрткой

PHOTO_CATEGORIES = ["цвет", "вывеска или реклама", "окна и двери", "навесное оборудование", "архитектурные элементы", "другое"]

PHOTO_SYSTEM = (
    "Ты — инспектор, который сверяет фото здания с утверждённой развёрткой фасада из паспорта колористического "
    "решения (ПП Москвы № 114-ПП, вывески — № 902-ПП). Изображение 1 — развёртка (чертёж), изображение 2 — фото, "
    "приведённое к плоскости развёртки, изображение 3 — карта отличий по цвету, найденных программой (отличия "
    "в цвете, остальное приглушено, номера в синих рамках). Опиши, чем фасад на фото отличается от развёртки: цвет "
    "поверхностей, вывески и реклама, окна и двери, кондиционеры и другое навесное оборудование, архитектурные "
    "элементы. Не описывай людей, машины, деревья, погоду, отражения в стёклах и водяные знаки. Пиши только то, "
    "что видно; если отличий нет — пустой список. Отвечай строго JSON по схеме, по-русски."
)

PHOTO_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "same_facade": {"type": "boolean"},
        "differences": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "category": {"type": "string", "enum": PHOTO_CATEGORIES},
                    "description": {"type": "string"},
                    "where": {"type": "string"},
                },
                "required": ["category", "description", "where"],
            },
        },
        "summary": {"type": "string"},
    },
    "required": ["same_facade", "differences", "summary"],
}


def llm_photo_review(client: LLMClient, images_b64: list[str], code_result: dict) -> dict:
    """Описание отличий мультимодальной моделью. Вердикт модель не меняет — только добавляет наблюдения."""
    found = [
        {"№": i, "на фото": d["photo_hex"], "по развёртке": d["expected_hex"], "ΔE00": d["delta_e"],
         "доля площади, %": round(d["share"] * 100, 1), "суть": d["note"]}
        for i, d in enumerate(code_result.get("differences", []), 1)
    ]
    user = (
        "Отличия по цвету, найденные программой (номера совпадают с картой отличий):\n"
        + json.dumps(found, ensure_ascii=False, indent=1)
        + "\n\nПроверь их по изображениям и добавь отличия, которые программа по цвету не находит "
        "(вывески, навесное оборудование, изменённые проёмы). summary — 2–4 предложения для инспектора."
    )
    data = client.chat_json(PHOTO_SYSTEM, user, PHOTO_SCHEMA, max_tokens=1500, images=images_b64)
    diffs = []
    for d in data.get("differences", [])[:12]:
        cat = d.get("category") if d.get("category") in PHOTO_CATEGORIES else "другое"
        desc = str(d.get("description", "")).strip()[:300]
        if desc:
            diffs.append({"category": cat, "description": desc, "where": str(d.get("where", "")).strip()[:120]})
    return {
        "same_facade": bool(data.get("same_facade", True)),
        "differences": diffs,
        "summary": str(data.get("summary", "")).strip()[:1200],
    }
