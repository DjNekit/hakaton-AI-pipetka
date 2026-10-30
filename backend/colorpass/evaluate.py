"""Оценка качества на размеченных паспортах (dataset/real/*.expected.json).

Метрики:
* recall (доля найденных заложенных ошибок) — главный показатель, ориентир ≥ 70 %;
* precision — доля замечаний (ошибки + предупреждения), которые соответствуют заложенным;
* clean pass — эталонные паспорта без ошибок должны получить вердикт «соответствует».
Сопоставление: правило совпадает, а если в эталоне указан элемент или лист — совпадают и они.
"""
from __future__ import annotations

import json
import time
from collections import defaultdict
from pathlib import Path

from .llm import LLMClient, make_client
from .pipeline import run_check


def _norm(s: str) -> str:
    return s.lower().replace("–", "-").replace("—", "-").replace("ё", "е")


def match(report: dict, expected: dict) -> dict:
    findings = [f for f in report["findings"] if f["severity"] in ("error", "warning")]
    page_names = {fs["page"]: _norm(fs["name"]) for fs in report["passport"]["facades"]}
    used: set[str] = set()
    per_defect = []
    for d in expected["defects"]:
        hit = None
        for f in findings:
            if f["id"] in used or f["rule"] not in (d.get("rule_any") or [d["rule"]]):
                continue
            if d.get("page") is not None and f.get("page") is not None and int(d["page"]) != f["page"] + 1:
                continue
            if d.get("element") is not None and str(d["element"]) != str(f.get("element")):
                continue
            if d.get("page_hint") and f.get("page") is not None:
                name = page_names.get(f["page"], "")
                if _norm(d["page_hint"]).split(" (")[0] not in name:
                    continue
            hit = f
            break
        if hit:
            used.add(hit["id"])
            # все замечания того же правила/листа/элемента считаем частью найденной ошибки
            for f in findings:
                if f["rule"] == hit["rule"] and f.get("page") == hit.get("page") and f.get("element") == hit.get("element"):
                    used.add(f["id"])
        per_defect.append({"rule": d["rule"], "detail": d["detail"], "found": bool(hit), "finding": hit["message"] if hit else None})
    false_pos = [f for f in findings if f["id"] not in used]
    return {"defects": per_defect, "false_positives": [{"rule": f["rule"], "message": f["message"]} for f in false_pos]}


def evaluate(dataset_dir: str | Path, out_dir: str | Path, use_llm: bool = False, verbose: bool = True) -> dict:
    dataset_dir, out_dir = Path(dataset_dir), Path(out_dir)
    client = make_client() if use_llm else None
    rows = []
    per_rule = defaultdict(lambda: {"expected": 0, "found": 0})
    tp = fn = fp = 0
    clean_total = clean_pass = 0
    t_all = time.time()
    for exp_path in sorted(dataset_dir.glob("*.expected.json")):
        expected = json.loads(exp_path.read_text(encoding="utf-8"))
        pdf = dataset_dir / expected["file"]
        t0 = time.time()
        report = run_check(pdf, out_dir / expected["sample"], use_llm=use_llm, llm=client, write_images=False)
        m = match(report, expected)
        found = sum(d["found"] for d in m["defects"])
        tp += found
        fn += len(m["defects"]) - found
        fp += len(m["false_positives"])
        for d in m["defects"]:
            per_rule[d["rule"]]["expected"] += 1
            per_rule[d["rule"]]["found"] += int(d["found"])
        if expected["clean"]:
            clean_total += 1
            clean_pass += int(report["verdict"] == "pass")
        row = {
            "sample": expected["sample"],
            "expected": len(m["defects"]),
            "found": found,
            "false_positives": len(m["false_positives"]),
            "verdict": report["verdict"],
            "seconds": round(time.time() - t0, 1),
            "details": m,
            "note_mentions_source": report["passport"]["note_mentions_source"],
        }
        rows.append(row)
        if verbose:
            mark = "✓" if found == len(m["defects"]) and not m["false_positives"] else "✗"
            print(f"{mark} {expected['sample']:24s} найдено {found}/{len(m['defects'])}  ложных {len(m['false_positives'])}  вердикт {report['verdict']:4s}  {row['seconds']:5.1f} с")
            for d in m["defects"]:
                if not d["found"]:
                    print(f"     пропущено: [{d['rule']}] {d['detail']}")
            for f in m["false_positives"]:
                print(f"     лишнее:    [{f['rule']}] {f['message']}")
    recall = tp / (tp + fn) if tp + fn else 1.0
    precision = tp / (tp + fp) if tp + fp else 1.0
    summary = {
        "samples": len(rows),
        "defects_total": tp + fn,
        "defects_found": tp,
        "recall": round(recall, 3),
        "precision": round(precision, 3),
        "false_positives": fp,
        "clean_pass": f"{clean_pass}/{clean_total}",
        "llm": use_llm,
        "seconds_total": round(time.time() - t_all, 1),
        "per_rule": {k: v for k, v in sorted(per_rule.items())},
    }
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "eval.json").write_text(json.dumps({"summary": summary, "samples": rows}, ensure_ascii=False, indent=2), encoding="utf-8")
    if verbose:
        print()
        print(f"Заложенных ошибок: {tp + fn}, найдено: {tp}  →  recall = {recall:.1%}")
        print(f"Ложных замечаний: {fp}  →  precision = {precision:.1%}")
        print(f"Эталоны без ошибок прошли проверку: {clean_pass}/{clean_total}")
        print(f"Время: {summary['seconds_total']} с на {len(rows)} паспортов (ЛЛМ: {'да' if use_llm else 'нет'})")
    return summary


def evaluate_photos(dataset_dir: str | Path) -> dict:
    """Точность сравнения фото с развёрткой по ручной разметке dataset/real/*.photos.json.

    Вердикт «требует внимания» считается как «совпадает» (явного несоответствия программа не нашла)."""
    from .photo import compare, passport_blocks

    dataset_dir = Path(dataset_dir)
    rows = []
    for spec_path in sorted(dataset_dir.glob("*.photos.json")):
        spec = json.loads(spec_path.read_text(encoding="utf-8"))
        pdf = dataset_dir / f"{spec['passport']}.pdf"
        report_pages = _pages_for(pdf)
        found = passport_blocks(pdf, report_pages)
        blocks = {b.id: img for b, img in found}
        boxes = {b.id: b.box for b, _ in found}
        for case in spec["cases"]:
            x0, y0 = boxes[case["photo"]][:2]
            quad = [[x - x0, y - y0] for x, y in case["quad_page"]]
            rect = case.get("rect")
            drawing_rect = (rect[0][0], rect[0][1], rect[1][0], rect[1][1]) if rect else None
            t0 = time.time()
            res, _ = compare(blocks[case["facade"]], blocks[case["photo"]], quad, drawing_rect)
            got = "mismatch" if res.verdict == "mismatch" else "match"
            rows.append({"passport": spec["passport"], "case": case["name"], "expected": case["expected"], "got": res.verdict,
                         "ok": got == case["expected"], "diff_share": res.diff_share, "seconds": round(time.time() - t0, 2)})
    n = len(rows)
    acc = sum(r["ok"] for r in rows) / n if n else 0.0
    for r in rows:
        print(f"{'✓' if r['ok'] else '✗'} {r['case']:45s} ожидалось {r['expected']:8s} получено {r['got']:9s} отличия {r['diff_share']*100:5.1f} %")
    print(f"\nТочность сравнения фото: {sum(r['ok'] for r in rows)}/{n} = {acc * 100:.1f} %")
    return {"accuracy": acc, "cases": rows}


def _pages_for(pdf: Path) -> list[dict]:
    from .extract import build_passport
    from .ingest import Document

    with Document(pdf) as doc:
        passport = build_passport(doc)
    return [{"index": i, "kinds": kinds} for i, kinds in passport.pages.items()]
