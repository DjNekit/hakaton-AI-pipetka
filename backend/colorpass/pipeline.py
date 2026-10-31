"""Полный цикл проверки: PDF -> отчёт (JSON + изображения листов + заключение)."""
from __future__ import annotations

import json
import logging
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable

import cv2
import numpy as np
from PIL import Image

from . import __version__
from .checks import Context, load_rules, run_checks
from .extract import PAGE_KINDS, build_passport
from .ingest import Document
from .llm import LLMClient, LLMError, make_client
from .llm_tasks import llm_conclusion, llm_mentions
from .color import rgb_to_hex
from .palettes import ncs_to_rgb, ral_lookup

log = logging.getLogger(__name__)
PREVIEW_SCALE = 1.5  # 108 dpi — изображения листов для интерфейса

Progress = Callable[[str, float], None]


def _noop(stage: str, frac: float) -> None:  # pragma: no cover
    pass


def template_conclusion(summary: dict, findings: list[dict]) -> str:
    if summary.get("kind") == "signage":
        head = "Заключение по дизайн-проекту размещения информационных конструкций (вывесок)"
    else:
        head = f"Заключение по паспорту колористического решения фасадов № {summary.get('number') or '—'}"
    if summary.get("address"):
        head += f" (адрес: {summary['address']})"
    head += "."
    errors = [f for f in findings if f["severity"] == "error"]
    warns = [f for f in findings if f["severity"] == "warning"]
    if not errors and not warns:
        what = "Дизайн-проект" if summary.get("kind") == "signage" else "Паспорт"
        return head + f"\n\nНесоответствий формализованным требованиям не выявлено. {what} может быть рекомендован к согласованию."
    lines = [head, "", f"Выявлено несоответствий: {len(errors)}, предупреждений: {len(warns)}."]
    for i, f in enumerate(errors + warns, 1):
        where = f" (лист {f['page'] + 1})" if f.get("page") is not None else ""
        kind = "" if f["severity"] == "error" else " [предупреждение]"
        lines.append(f"{i}. [{f['rule']}]{kind} {f['message']}{where}. Основание: {f['ref']}.")
    lines.append("")
    what = "Дизайн-проект" if summary.get("kind") == "signage" else "Паспорт"
    lines.append(
        f"{what} подлежит доработке и повторному представлению после устранения замечаний."
        if errors
        else f"{what} может быть согласован после проверки предупреждений специалистом."
    )
    return "\n".join(lines)


def _annotate(img: np.ndarray, findings: list[dict], scale: float) -> np.ndarray:
    out = img.copy()
    for i, f in enumerate(findings, 1):
        if not f.get("bbox"):
            continue
        x0, y0, x1, y1 = (int(v * scale) for v in f["bbox"])
        color = (220, 38, 38) if f["severity"] == "error" else (217, 119, 6)
        cv2.rectangle(out, (x0 - 3, y0 - 3), (x1 + 3, y1 + 3), color, 3)
        label = f["rule"]
        (tw, th), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.5, 1)
        cv2.rectangle(out, (x0 - 3, y0 - th - 10), (x0 + tw + 5, y0 - 3), color, -1)
        cv2.putText(out, label, (x0 + 1, y0 - 7), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1, cv2.LINE_AA)
    return out


def run_check(
    pdf_path: str | Path,
    out_dir: str | Path,
    use_llm: bool = True,
    llm: LLMClient | None = None,
    progress: Progress = _noop,
    write_images: bool = True,
) -> dict:
    t0 = time.time()
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    rules = load_rules()

    progress("Чтение PDF", 0.05)
    doc = Document(pdf_path)
    try:
        from .signage import is_signage

        if is_signage(doc):
            return _run_signage(doc, pdf_path, out, rules, use_llm, llm, progress, write_images, t0)
        progress("Разбор структуры паспорта", 0.15)
        passport = build_passport(doc)

        llm_info: dict = {"requested": use_llm, "used": False, "model": None, "tasks": {}, "error": None}
        client = None
        mentions = None
        if use_llm:
            client = llm or make_client()
            st = client.status()
            llm_info["status"] = st
            if st.get("available"):
                llm_info["model"] = st.get("model")
                llm_info["provider"] = st.get("provider", "gigachat")
                if passport.note_text and passport.finish_rows:
                    progress("Модель: разбор пояснительной записки", 0.3)
                    try:
                        mentions = llm_mentions(client, passport.note_text, passport.finish_rows)
                        llm_info["tasks"]["note_mentions"] = "ok"
                        llm_info["used"] = True
                    except (LLMError, ValueError, KeyError) as exc:
                        llm_info["tasks"]["note_mentions"] = f"ошибка: {exc}"
                        llm_info["error"] = str(exc)
            else:
                llm_info["error"] = st.get("error") or "GigaChat недоступен"

        progress("Проверки по чек-листу", 0.5)
        ctx = Context(doc, passport, llm_mentions=mentions)
        results = run_checks(ctx)

        findings = []
        for r in results:
            for f in r.findings:
                d = f.to_dict()
                d["ref"] = rules["rules"][f.rule]["ref"]
                d["title"] = rules["rules"][f.rule]["title"]
                d["id"] = f"F{len(findings) + 1:03d}"
                d["dismissed"] = False
                findings.append(d)
        checklist = [
            {
                "rule": r.rule,
                "title": rules["rules"][r.rule]["title"],
                "category": rules["rules"][r.rule]["category"],
                "category_title": rules["categories"][rules["rules"][r.rule]["category"]],
                "ref": rules["rules"][r.rule]["ref"],
                "status": r.status,
                "note": r.note,
                "findings": [f["id"] for f in findings if f["rule"] == r.rule],
            }
            for r in results
        ]
        n_err = sum(1 for f in findings if f["severity"] == "error")
        n_warn = sum(1 for f in findings if f["severity"] == "warning")
        verdict = "fail" if n_err else ("warn" if n_warn else "pass")

        summary = {
            "kind": "passport",
            "number": passport.title.get("Номер"),
            "date": passport.title.get("Дата"),
            "address": passport.title.get("Адрес") or passport.general.get("Адрес объекта"),
            "object": passport.general.get("Наименование объекта"),
            "developer": passport.general.get("Разработчик проекта"),
            "pages": len(doc.pages),
            "facades": len(passport.facades),
            "finish_rows": len(passport.finish_rows),
        }

        progress("Изображения листов", 0.7)
        pages_out = []
        for p in doc.pages:
            entry = {
                "index": p.index,
                "number": p.index + 1,
                "kinds": passport.pages[p.index],
                "kind_title": PAGE_KINDS.get(passport.pages[p.index][0], "Прочее"),
                "width": p.width,
                "height": p.height,
                "is_scan": p.is_scan,
                "ocr": p.ocr_used,
                "notes": p.notes,
                "image": f"pages/p{p.index + 1:02d}.png",
                "findings": [f["id"] for f in findings if f.get("page") == p.index],
            }
            if write_images:
                (out / "pages").mkdir(exist_ok=True)
                img = doc.render(p.index, PREVIEW_SCALE)
                Image.fromarray(img).save(out / entry["image"], optimize=True)
                page_f = [f for f in findings if f.get("page") == p.index]
                if page_f:
                    (out / "annotated").mkdir(exist_ok=True)
                    entry["annotated"] = f"annotated/p{p.index + 1:02d}.png"
                    Image.fromarray(_annotate(img, page_f, PREVIEW_SCALE)).save(out / entry["annotated"], optimize=True)
            pages_out.append(entry)

        conclusion = {"text": template_conclusion(summary, findings), "source": "template"}
        if client is not None and llm_info.get("model"):
            progress("Модель: формулировка заключения", 0.85)
            try:
                conclusion = {"text": llm_conclusion(client, summary, findings), "source": "llm", "template": conclusion["text"]}
                llm_info["tasks"]["conclusion"] = "ok"
                llm_info["used"] = True
            except (LLMError, ValueError) as exc:
                llm_info["tasks"]["conclusion"] = f"ошибка: {exc}"
                llm_info["error"] = llm_info["error"] or str(exc)
        if client is not None:
            llm_info["calls"] = client.calls

        report = {
            "version": __version__,
            "document_kind": "passport",
            "file": Path(pdf_path).name,
            "created_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "duration_s": None,
            "verdict": verdict,
            "counts": {
                "errors": n_err,
                "warnings": n_warn,
                "rules_total": len(checklist),
                "rules_ok": sum(1 for c in checklist if c["status"] == "ok"),
                "rules_failed": sum(1 for c in checklist if c["status"] == "fail"),
                "rules_warn": sum(1 for c in checklist if c["status"] == "warn"),
                "rules_skipped": sum(1 for c in checklist if c["status"] == "skip"),
            },
            "summary": summary,
            "checklist": checklist,
            "findings": findings,
            "pages": pages_out,
            "passport": {
                "title": passport.title,
                "general": passport.general,
                "facade_list": passport.facade_list,
                "facades": [
                    {
                        "page": fs.page,
                        "name": fs.name,
                        "scale": fs.scale,
                        "stamp_address": fs.stamp_address,
                        "stamp_author": fs.stamp_author,
                        "markers": [m.label for m in fs.markers],
                        "palette": ctx.palettes.get(fs.page, []),
                    }
                    for fs in passport.facades
                ],
                "finish_table": [
                    {
                        "n": r.n,
                        "name": r.name,
                        "material": r.material,
                        "marks": r.marks.to_dict(),
                        "page": r.page,
                        "swatch_hex": ctx.swatches[r.n].hex if r.n in ctx.swatches else None,
                        "ral_hex": [ral_lookup(c).hex if ral_lookup(c) else None for c in r.marks.ral],
                        "ncs_hex": [rgb_to_hex(ncs_to_rgb(n)) if n.valid else None for n in r.marks.ncs],
                        "ncs_valid": [n.valid for n in r.marks.ncs],
                        "reference": r.marks.reference_lab()[1] or None,
                        "group": r.group,
                        "codes_source": r.codes_source,
                    }
                    for r in passport.finish_rows
                ],
                "note_mentions": [m.to_dict() for m in ctx.mentions],
                "note_mentions_source": ctx.mentions_source,
                "marker_samples": ctx.marker_samples,
            },
            "llm": llm_info,
            "conclusion": conclusion,
        }
        report["duration_s"] = round(time.time() - t0, 2)
        (out / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
        (out / "conclusion.md").write_text(conclusion["text"], encoding="utf-8")
        progress("Готово", 1.0)
        return report
    finally:
        doc.close()


def _findings_and_checklist(results, rules) -> tuple[list[dict], list[dict]]:
    findings = []
    for r in results:
        for f in r.findings:
            d = f.to_dict()
            d["ref"] = rules["rules"][f.rule]["ref"]
            d["title"] = rules["rules"][f.rule]["title"]
            d["id"] = f"F{len(findings) + 1:03d}"
            d["dismissed"] = False
            findings.append(d)
    checklist = [
        {
            "rule": r.rule,
            "title": rules["rules"][r.rule]["title"],
            "category": rules["rules"][r.rule]["category"],
            "category_title": rules["categories"][rules["rules"][r.rule]["category"]],
            "ref": rules["rules"][r.rule]["ref"],
            "status": r.status,
            "note": r.note,
            "findings": [f["id"] for f in findings if f["rule"] == r.rule],
        }
        for r in results
    ]
    return findings, checklist


def _run_signage(doc, pdf_path, out: Path, rules: dict, use_llm: bool, llm, progress: Progress, write_images: bool, t0: float) -> dict:
    """Дизайн-проект размещения вывесок (902-ПП): те же отчёт, листы и заключение, другой набор проверок."""
    from .signage import SIGN_KINDS, SignContext, build_signage, run_signage_checks

    progress("Разбор дизайн-проекта вывесок", 0.15)
    project = build_signage(doc)
    progress("Проверки по 902-ПП", 0.45)
    results = run_signage_checks(SignContext(doc, project))
    findings, checklist = _findings_and_checklist(results, rules)
    n_err = sum(1 for f in findings if f["severity"] == "error")
    n_warn = sum(1 for f in findings if f["severity"] == "warning")
    verdict = "fail" if n_err else ("warn" if n_warn else "pass")
    summary = {
        "kind": "signage",
        "number": None,
        "date": project.doc_date,
        "address": project.address,
        "object": project.object_name or "Дизайн-проект размещения информационных конструкций",
        "customer": project.customer,
        "pages": len(doc.pages),
        "signs": len(project.rows),
    }
    progress("Изображения листов", 0.65)
    pages_out = []
    for p in doc.pages:
        kinds = project.pages[p.index]
        entry = {
            "index": p.index, "number": p.index + 1, "kinds": kinds, "kind_title": SIGN_KINDS.get(kinds[0], "Прочее"),
            "width": p.width, "height": p.height, "is_scan": p.is_scan, "ocr": p.ocr_used, "notes": p.notes,
            "image": f"pages/p{p.index + 1:02d}.png", "findings": [f["id"] for f in findings if f.get("page") == p.index],
        }
        if write_images:
            (out / "pages").mkdir(exist_ok=True)
            img = doc.render(p.index, PREVIEW_SCALE)
            Image.fromarray(img).save(out / entry["image"], optimize=True)
            page_f = [f for f in findings if f.get("page") == p.index]
            if page_f:
                (out / "annotated").mkdir(exist_ok=True)
                entry["annotated"] = f"annotated/p{p.index + 1:02d}.png"
                Image.fromarray(_annotate(img, page_f, PREVIEW_SCALE)).save(out / entry["annotated"], optimize=True)
        pages_out.append(entry)

    llm_info: dict = {"requested": use_llm, "used": False, "model": None, "tasks": {}, "error": None}
    conclusion = {"text": template_conclusion(summary, findings), "source": "template"}
    client = None
    if use_llm:
        client = llm or make_client()
        st = client.status()
        llm_info["status"] = st
        if st.get("available"):
            llm_info["model"] = st.get("model")
            llm_info["provider"] = st.get("provider", "gigachat")
            progress("Модель: формулировка заключения", 0.85)
            try:
                conclusion = {"text": llm_conclusion(client, summary, findings), "source": "llm", "template": conclusion["text"]}
                llm_info["tasks"]["conclusion"] = "ok"
                llm_info["used"] = True
            except (LLMError, ValueError) as exc:
                llm_info["tasks"]["conclusion"] = f"ошибка: {exc}"
                llm_info["error"] = str(exc)
        else:
            llm_info["error"] = st.get("error") or "GigaChat недоступен"
        llm_info["calls"] = client.calls

    report = {
        "version": __version__,
        "document_kind": "signage",
        "file": Path(pdf_path).name,
        "created_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "duration_s": None,
        "verdict": verdict,
        "counts": {
            "errors": n_err, "warnings": n_warn, "rules_total": len(checklist),
            "rules_ok": sum(1 for c in checklist if c["status"] == "ok"),
            "rules_failed": sum(1 for c in checklist if c["status"] == "fail"),
            "rules_warn": sum(1 for c in checklist if c["status"] == "warn"),
            "rules_skipped": sum(1 for c in checklist if c["status"] == "skip"),
        },
        "summary": summary,
        "checklist": checklist,
        "findings": findings,
        "pages": pages_out,
        "signage": project.to_dict(),
        "passport": {"title": {}, "general": {}, "facade_list": [], "facades": [], "finish_table": [], "note_mentions": [],
                     "note_mentions_source": "rules", "marker_samples": []},
        "llm": llm_info,
        "conclusion": conclusion,
    }
    report["duration_s"] = round(time.time() - t0, 2)
    (out / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    (out / "conclusion.md").write_text(conclusion["text"], encoding="utf-8")
    progress("Готово", 1.0)
    return report
