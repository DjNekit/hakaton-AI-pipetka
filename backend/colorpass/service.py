"""Сервисный слой веб-API (не зависит от веб-фреймворка).

Используется Django-приложением ``api`` и резервным сервером ``devserver.py``.
Проверки выполняются в фоновых потоках; состояние хранится в файлах runs/web/<id>/.
"""
from __future__ import annotations

import json
import logging
import os
import re
import threading
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

from . import __version__
from .checks import load_rules
from .llm import LLMClient, make_client
from .store import get_store, safe
from .pipeline import run_check, template_conclusion

log = logging.getLogger(__name__)

ROOT = Path(__file__).resolve().parents[2]
RUNS_DIR = Path(os.getenv("COLORPASS_RUNS_DIR", ROOT / "runs" / "web"))
REAL_DIR = Path(os.getenv("COLORPASS_REAL_DIR", ROOT / "dataset" / "real"))
SIGNS_DIR = Path(os.getenv("COLORPASS_SIGNS_DIR", ROOT / "dataset" / "signs"))


def _sample_dirs() -> list[Path]:
    return [d for d in (REAL_DIR, SIGNS_DIR) if d.exists()]
MAX_UPLOAD_MB = int(os.getenv("COLORPASS_MAX_UPLOAD_MB", "100"))
_SEM = threading.Semaphore(int(os.getenv("COLORPASS_WORKERS", "2")))
_LOCK = threading.Lock()


class NotFound(Exception):
    pass


class BadRequest(Exception):
    pass


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _status_path(run_id: str) -> Path:
    return RUNS_DIR / run_id / "status.json"


def _write_status(run_id: str, report: dict | None = None, **updates) -> dict:
    with _LOCK:
        path = _status_path(run_id)
        data = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
        data.update(updates)
        tmp = path.with_suffix(".tmp")
        tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
        tmp.replace(path)
    store = get_store()
    # в базу — смены состояния и итог; промежуточный прогресс (каждые доли секунды) не пишем
    if store and (report is not None or set(updates) - {"stage", "progress"}):
        safe("запись проверки", lambda: store.save_status(data, report))
    return data


def _valid_id(run_id: str) -> bool:
    return bool(re.fullmatch(r"[0-9a-f]{12}", run_id or ""))


# ----------------------------------------------------------------- справочные


def health() -> dict:
    store = get_store()
    db = {"enabled": False}
    if store:
        stats = safe("статус", store.stats)
        db = {"enabled": True, "ok": stats is not None, **(stats or {})}
    return {"ok": True, "version": __version__, "llm": make_client().status(), "db": db}


def rules() -> dict:
    r = load_rules()
    return {
        "categories": r["categories"],
        "rules": [{"id": k, **v} for k, v in r["rules"].items()],
        "thresholds": r["thresholds"],
        "required_sections": r["required_sections"],
        "required_general_fields": r["required_general_fields"],
        "allowed_scales": r["allowed_scales"],
    }


def list_samples() -> list[dict]:
    out = []
    for d in _sample_dirs():
        for exp in sorted(d.glob("*.expected.json")):
            data = json.loads(exp.read_text(encoding="utf-8"))
            if not (d / data["file"]).exists():
                continue  # разметка есть, а PDF не скачан
            out.append(
                {
                    "name": data["sample"],
                    "file": data["file"],
                    "clean": data["clean"],
                    "real": True,
                    "kind": data.get("kind", "passport"),
                    "label": data.get("label"),
                    "defects": [{"rule": x["rule"], "detail": x["detail"]} for x in data["defects"]],
                    "reference_conclusion": data.get("reference_conclusion", ""),
                }
            )
    return out


def _expected_path(name: str) -> Path | None:
    for d in _sample_dirs():
        p = d / f"{name}.expected.json"
        if p.exists():
            return p
    return None


def sample_pdf(name: str) -> Path:
    if not re.fullmatch(r"[\w\-]+", name or ""):
        raise NotFound(name)
    for d in _sample_dirs():
        path = d / f"{name}.pdf"
        if path.exists():
            return path
    raise NotFound(name)


# ----------------------------------------------------------------- запуски


def _worker(run_id: str, use_llm: bool) -> None:
    run_dir = RUNS_DIR / run_id
    with _SEM:
        _write_status(run_id, state="running", stage="Запуск", progress=0.02, started_at=_now())
        t0 = time.time()

        def progress(stage: str, frac: float) -> None:
            _write_status(run_id, stage=stage, progress=round(frac, 3))

        try:
            report = run_check(run_dir / "input.pdf", run_dir, use_llm=use_llm, progress=progress)
            _write_status(
                run_id,
                state="done",
                stage="Готово",
                progress=1.0,
                finished_at=_now(),
                seconds=round(time.time() - t0, 1),
                verdict=report["verdict"],
                counts=report["counts"],
                llm_used=report["llm"]["used"],
                kind=report.get("document_kind", "passport"),
                report=report,
            )
        except Exception as exc:  # noqa: BLE001 — показываем ошибку пользователю
            log.exception("Проверка %s завершилась ошибкой", run_id)
            _write_status(run_id, state="error", stage="Ошибка", error=f"{type(exc).__name__}: {exc}", finished_at=_now())


def _start(data: bytes, filename: str, use_llm: bool, sample: str | None = None) -> dict:
    if not data.startswith(b"%PDF"):
        raise BadRequest("Ожидается PDF-файл")
    if len(data) > MAX_UPLOAD_MB * 1024 * 1024:
        raise BadRequest(f"Файл больше {MAX_UPLOAD_MB} МБ")
    run_id = uuid.uuid4().hex[:12]
    run_dir = RUNS_DIR / run_id
    run_dir.mkdir(parents=True, exist_ok=True)
    (run_dir / "input.pdf").write_bytes(data)
    status = _write_status(
        run_id,
        id=run_id,
        file=Path(filename).name or "passport.pdf",
        sample=sample,
        use_llm=use_llm,
        state="queued",
        stage="В очереди",
        progress=0.0,
        created_at=_now(),
    )
    threading.Thread(target=_worker, args=(run_id, use_llm), daemon=True, name=f"check-{run_id}").start()
    return status


def start_upload(filename: str, data: bytes, use_llm: bool = True) -> dict:
    return _start(data, filename, use_llm)


def start_sample(name: str, use_llm: bool = True) -> dict:
    path = sample_pdf(name)
    return _start(path.read_bytes(), path.name, use_llm, sample=name)


def _import_files_to_db(store) -> None:
    """Пустая база при уже накопленных файлах (база подключена позже): переносим проверки и сравнения."""
    for p in sorted(RUNS_DIR.glob("*/status.json")) if RUNS_DIR.exists() else []:
        try:
            status = json.loads(p.read_text(encoding="utf-8"))
            rp = p.parent / "report.json"
            report = json.loads(rp.read_text(encoding="utf-8")) if rp.exists() else None
            store.save_status(status, report)
            for cp in sorted((p.parent / "compare").glob("*/result.json")):
                store.save_comparison(json.loads(cp.read_text(encoding="utf-8")))
        except (OSError, json.JSONDecodeError, KeyError) as exc:
            log.warning("Не перенесён в базу %s: %s", p.parent.name, exc)


def list_runs(limit: int = 50) -> list[dict]:
    store = get_store()
    if store:
        rows = safe("журнал проверок", lambda: store.list_runs(limit))
        if rows == [] and RUNS_DIR.exists() and any(RUNS_DIR.glob("*/status.json")):
            safe("перенос файлов в базу", lambda: _import_files_to_db(store))
            rows = safe("журнал проверок", lambda: store.list_runs(limit))
        # в базе могут остаться проверки, чьи файлы удалены вместе с runs/ — такие не показываем
        rows = [r for r in rows or [] if _status_path(r.get("id", "")).exists()]
        if rows:
            return rows
    if not RUNS_DIR.exists():
        return []
    items = []
    for p in RUNS_DIR.glob("*/status.json"):
        try:
            items.append(json.loads(p.read_text(encoding="utf-8")))
        except (OSError, json.JSONDecodeError):
            continue
    items.sort(key=lambda s: s.get("created_at", ""), reverse=True)
    return items[:limit]


def get_run(run_id: str) -> dict:
    if not _valid_id(run_id) or not _status_path(run_id).exists():
        raise NotFound(run_id)
    status = json.loads(_status_path(run_id).read_text(encoding="utf-8"))
    report_path = RUNS_DIR / run_id / "report.json"
    if status.get("state") == "done" and report_path.exists():
        status["report"] = json.loads(report_path.read_text(encoding="utf-8"))
    if status.get("sample"):
        exp = _expected_path(status["sample"])
        if exp:
            status["expected"] = json.loads(exp.read_text(encoding="utf-8"))
    return status


_EDIT_LOCK = threading.Lock()
_FINDING_ACTIONS = {"dismiss", "restore", "delete"}


def _recalc_report(report: dict) -> list[dict]:
    """Пересчитывает вердикт, счётчики, чек-лист и заключение без исключённых замечаний."""
    findings = report.get("findings") or []
    for f in findings:
        f.setdefault("dismissed", False)
    active = [f for f in findings if not f.get("dismissed")]
    errors = [f for f in active if f.get("severity") == "error"]
    warns = [f for f in active if f.get("severity") == "warning"]
    report["verdict"] = "fail" if errors else ("warn" if warns else "pass")

    checklist = report.get("checklist") or []
    for item in checklist:
        if item.get("status") == "skip":
            item["findings"] = []
            continue
        own = [f for f in active if f.get("rule") == item.get("rule")]
        item["findings"] = [f["id"] for f in own]
        sev = {f.get("severity") for f in own}
        item["status"] = "fail" if "error" in sev else ("warn" if "warning" in sev else "ok")

    counts = report.setdefault("counts", {})
    counts.update(
        errors=len(errors),
        warnings=len(warns),
        rules_total=len(checklist),
        rules_ok=sum(1 for c in checklist if c.get("status") == "ok"),
        rules_failed=sum(1 for c in checklist if c.get("status") == "fail"),
        rules_warn=sum(1 for c in checklist if c.get("status") == "warn"),
        rules_skipped=sum(1 for c in checklist if c.get("status") == "skip"),
    )
    for page in report.get("pages") or []:
        page["findings"] = [f["id"] for f in active if f.get("page") == page.get("index")]
    report["conclusion"] = {
        "text": template_conclusion(report.get("summary") or {}, active),
        "source": "template",
        "recalculated": True,
    }
    return active


def _refresh_annotations(run_dir: Path, report: dict, active: list[dict]) -> None:
    """Перерисовывает листы с рамками только по оставленным замечаниям."""
    pages = report.get("pages") or []
    if not pages:
        return
    try:
        from PIL import Image

        from .ingest import Document
        from .pipeline import PREVIEW_SCALE, _annotate

        doc = Document(run_dir / "input.pdf")
        try:
            for entry in pages:
                page_f = [f for f in active if f.get("page") == entry.get("index") and f.get("bbox")]
                rel = entry.get("annotated")
                if page_f:
                    rel = rel or f"annotated/p{entry['index'] + 1:02d}.png"
                    (run_dir / "annotated").mkdir(exist_ok=True)
                    img = doc.render(entry["index"], PREVIEW_SCALE)
                    Image.fromarray(_annotate(img, page_f, PREVIEW_SCALE)).save(run_dir / rel, optimize=True)
                    entry["annotated"] = rel
                elif rel:
                    entry.pop("annotated", None)
                    (run_dir / rel).unlink(missing_ok=True)
        finally:
            doc.close()
    except Exception as exc:  # noqa: BLE001 — без картинок отчёт остаётся корректным
        log.warning("Не удалось обновить изображения листов: %s", exc)


def change_finding_status(run_id: str, finding_id: str, action: str = "dismiss", reason: str = "") -> dict:
    """Исключает замечание как ложное срабатывание, возвращает его или удаляет из отчёта."""
    action = (action or "").strip().lower()
    if action not in _FINDING_ACTIONS:
        raise BadRequest("Действие должно быть dismiss, restore или delete")
    if not finding_id:
        raise BadRequest("Не указано замечание")
    with _EDIT_LOCK:
        run_dir, report = _done_report(run_id)
        findings = report.get("findings") or []
        target = next((f for f in findings if f.get("id") == finding_id), None)
        if target is None:
            raise NotFound(finding_id)
        if action == "delete":
            report["findings"] = [f for f in findings if f.get("id") != finding_id]
        else:
            target["dismissed"] = action == "dismiss"
            if target["dismissed"]:
                target["dismissed_at"] = _now()
                target["dismiss_reason"] = (reason or "").strip() or None
            else:
                target.pop("dismissed_at", None)
                target.pop("dismiss_reason", None)
        active = _recalc_report(report)
        _refresh_annotations(run_dir, report, active)
        (run_dir / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
        (run_dir / "conclusion.md").write_text(report["conclusion"]["text"], encoding="utf-8")
        _write_status(
            run_id,
            report=report,
            verdict=report["verdict"],
            counts=report["counts"],
            dismissed=sum(1 for f in report["findings"] if f.get("dismissed")),
            edited_at=_now(),
        )
        return get_run(run_id)


def run_file(run_id: str, relpath: str) -> Path:
    if not _valid_id(run_id):
        raise NotFound(run_id)
    base = (RUNS_DIR / run_id).resolve()
    path = (base / relpath).resolve()
    if base not in path.parents or not path.is_file():
        raise NotFound(relpath)
    return path


# ----------------------------------------------------------------- сравнение фото с развёрткой

_BLOCK_LOCK = threading.Lock()


def _done_report(run_id: str) -> tuple[Path, dict]:
    run = get_run(run_id)
    if run.get("state") != "done" or "report" not in run:
        raise BadRequest("Проверка паспорта ещё не завершена")
    return RUNS_DIR / run_id, run["report"]


def list_blocks(run_id: str) -> dict:
    """Развёртки и фото фотофиксации паспорта (кэш: runs/web/<id>/blocks/)."""
    from .photo import passport_blocks, save_rgb

    run_dir, report = _done_report(run_id)
    index = run_dir / "blocks" / "blocks.json"
    with _BLOCK_LOCK:
        if not index.exists():
            index.parent.mkdir(parents=True, exist_ok=True)
            items = []
            for b, img in passport_blocks(run_dir / "input.pdf", report["pages"]):
                save_rgb(run_dir / "blocks" / f"{b.id}.png", img)
                items.append({**b.__dict__, "image": f"blocks/{b.id}.png"})
            index.write_text(json.dumps(items, ensure_ascii=False, indent=2), encoding="utf-8")
    items = json.loads(index.read_text(encoding="utf-8"))
    return {
        "facades": [b for b in items if b["kind"] == "facade"],
        "photos": [b for b in items if b["kind"] == "photo"],
    }


def _parse_points(raw, n: int, name: str) -> list[list[float]] | None:
    if raw in (None, "", []):
        return None
    pts = json.loads(raw) if isinstance(raw, str) else raw
    try:
        pts = [[float(x), float(y)] for x, y in pts]
    except (TypeError, ValueError) as exc:
        raise BadRequest(f"{name}: ожидается список точек [[x, y], …]") from exc
    if len(pts) != n:
        raise BadRequest(f"{name}: нужно {n} точки")
    return pts


def compare_photo(
    run_id: str,
    facade_id: str,
    photo_bytes: bytes | None = None,
    photo_name: str = "",
    photo_block: str | None = None,
    quad=None,
    rect=None,
    use_llm: bool = True,
) -> dict:
    """Сравнивает фото с развёрткой; результат — runs/web/<id>/compare/<cid>/result.json и изображения."""
    from .llm_tasks import llm_photo_review
    from .photo import VERDICT_TEXT, compare, load_rgb, png_b64, save_rgb, template_conclusion

    run_dir, _ = _done_report(run_id)
    blocks = list_blocks(run_id)
    by_id = {b["id"]: b for b in blocks["facades"] + blocks["photos"]}
    facade = by_id.get(facade_id)
    if not facade or facade["kind"] != "facade":
        raise BadRequest("Не выбрана развёртка")
    quad_pts = _parse_points(quad, 4, "Углы фасада на фото")
    rect_pts = _parse_points(rect, 2, "Часть развёртки")

    cid = uuid.uuid4().hex[:12]
    out = run_dir / "compare" / cid
    out.mkdir(parents=True, exist_ok=True)
    if photo_bytes:
        if len(photo_bytes) > MAX_UPLOAD_MB * 1024 * 1024:
            raise BadRequest(f"Файл больше {MAX_UPLOAD_MB} МБ")
        src = out / ("photo" + (Path(photo_name).suffix.lower() if Path(photo_name).suffix else ".jpg"))
        src.write_bytes(photo_bytes)
        source = {"kind": "upload", "name": Path(photo_name).name or "photo"}
    elif photo_block and photo_block in by_id:
        src = run_dir / by_id[photo_block]["image"]
        source = {"kind": "passport", "block": photo_block, "name": by_id[photo_block]["label"]}
    else:
        raise BadRequest("Загрузите фото или выберите фото из паспорта")
    try:
        photo = load_rgb(src)
    except ValueError as exc:
        raise BadRequest(str(exc)) from exc
    drawing = load_rgb(run_dir / facade["image"])

    t0 = time.time()
    drawing_rect = None
    if rect_pts:
        (x0, y0), (x1, y1) = rect_pts
        drawing_rect = (min(x0, x1), min(y0, y1), max(x0, x1), max(y0, y1))
    res, imgs = compare(drawing, photo, quad_pts, drawing_rect)
    for name, img in imgs.items():
        save_rgb(out / f"{name}.png", img)
    result = res.to_dict()
    llm_info = {"used": False, "model": None, "error": None}
    review = None
    if use_llm:
        client = make_client()
        st = client.status()
        if st.get("available"):
            try:
                review = llm_photo_review(
                    client, [png_b64(imgs["drawing"]), png_b64(imgs["photo_warped"]), png_b64(imgs["diff_overlay"])], result
                )
                llm_info = {"used": True, "model": st.get("model"), "provider": st.get("provider", "gigachat"), "error": None}
            except Exception as exc:  # noqa: BLE001 — модель без зрения, таймаут и т. п.: работаем без неё
                log.warning("Модель не описала фото: %s", exc)
                llm_info = {"used": False, "model": st.get("model"), "error": str(exc)[:300]}
        else:
            llm_info["error"] = st.get("error") or "Модель недоступна"

    verdict = result["verdict"]
    if review and verdict == "match" and (review["differences"] or not review["same_facade"]):
        verdict = "attention"  # модель видит то, что код по цвету не нашёл — пусть посмотрит инспектор
    result["verdict"] = verdict
    text = template_conclusion(res, facade["label"]).replace(
        VERDICT_TEXT[res.verdict].lower(), VERDICT_TEXT[verdict].lower(), 1
    )
    if review:
        if not review["same_facade"]:
            text += "\nМодель сомневается, что на фото тот же фасад, — проверьте выбор развёртки и углы."
        if review["summary"]:
            text += "\n\nОписание модели: " + review["summary"]
    payload = {
        "id": cid,
        "run_id": run_id,
        "created_at": _now(),
        "seconds": round(time.time() - t0, 1),
        "facade": {"id": facade["id"], "label": facade["label"]},
        "source": source,
        "quad": quad_pts,
        "rect": rect_pts,
        "result": result,
        "review": review,
        "llm": llm_info,
        "conclusion": text,
        "images": {k: f"compare/{cid}/{k}.png" for k in imgs},
    }
    (out / "result.json").write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    store = get_store()
    if store:
        safe("запись сравнения", lambda: store.save_comparison(payload))
    return payload


def list_comparisons(run_id: str) -> list[dict]:
    if not _valid_id(run_id):
        raise NotFound(run_id)
    store = get_store()
    if store:
        rows = safe("сравнения", lambda: store.list_comparisons(run_id))
        rows = [r for r in rows or [] if (RUNS_DIR / run_id / "compare" / r.get("id", "") / "result.json").exists()]
        if rows:
            return rows
    items = []
    for p in (RUNS_DIR / run_id / "compare").glob("*/result.json"):
        try:
            items.append(json.loads(p.read_text(encoding="utf-8")))
        except (OSError, json.JSONDecodeError):
            continue
    items.sort(key=lambda s: s.get("created_at", ""), reverse=True)
    return items


def suggest_corners(run_id: str, photo_bytes: bytes | None = None, photo_block: str | None = None) -> dict:
    """Подсказка 4 углов фасада на фото (по линиям); инспектор проверяет и правит точки."""
    import cv2
    import numpy as np

    from .photo import load_rgb, suggest_quad

    run_dir, _ = _done_report(run_id)
    if photo_bytes:
        img = cv2.imdecode(np.frombuffer(photo_bytes, np.uint8), cv2.IMREAD_COLOR)
        if img is None:
            raise BadRequest("Не удалось прочитать изображение (нужен JPEG или PNG)")
        img = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
    else:
        blocks = list_blocks(run_id)
        by_id = {b["id"]: b for b in blocks["photos"] + blocks["facades"]}
        if photo_block not in by_id:
            raise BadRequest("Загрузите фото или выберите фото из документа")
        img = load_rgb(run_dir / by_id[photo_block]["image"])
    quad, info = suggest_quad(img)
    return {"quad": quad, "confident": info.get("confident", False), "info": info}
