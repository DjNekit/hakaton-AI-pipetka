"""Задачи сервиса processor: проверка пакета документов и быстрые операции с файлами.

Проверка пакета (очередь cp:jobs) идёт в фоне: ход каждого документа — в cp:progress:<doc>, готовые отчёты
и итог пакета — в cp:result:* (их забирает бэкенд в свою базу). Быстрые операции (очередь cp:rpc) отвечают
сразу в cp:reply:<id>.
"""
from __future__ import annotations

import hashlib
import json
import logging
import shutil
import threading
import time
from datetime import datetime, timezone

from colorpass import __version__
from colorpass.checks import load_rules
from colorpass.pipeline import run_check, template_conclusion

from . import storage
from .package import package_checks
from .redisq import READY, Redis, progress_key, result_key
from .storage import BadRequest, NotFound

log = logging.getLogger(__name__)
RESULT_TTL = 7 * 24 * 3600  # бэкенд забирает результат при первом обращении; неделя — с запасом


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def sha256(path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def publish(r: Redis, key: str, data: dict) -> None:
    r.set(result_key(key), json.dumps(data, ensure_ascii=False), ex=RESULT_TTL)
    r.sadd(READY, key)


# ================================================================= проверка пакета


def check_package(r: Redis, args: dict) -> None:
    """args: {package_id, documents: [{doc_id, upload_id | sample, file}], photos: [upload_id]}"""
    pkg = args["package_id"]
    pdir = storage.package_dir(pkg)
    photos = []
    for i, uid in enumerate(args.get("photos") or [], 1):
        try:
            src, meta = storage.upload(uid)
        except NotFound:
            continue
        data = src.read_bytes()
        ext = ".png" if data.startswith(b"\x89PNG") else ".jpg"
        rel = f"photos/{i:02d}{ext}"
        (pdir / "photos").mkdir(parents=True, exist_ok=True)
        (pdir / rel).write_bytes(data)
        photos.append({"id": f"pkg-{i:02d}", "name": meta["name"], "image": f"package/{rel}", "sha256": sha256(pdir / rel)})
        storage.drop_upload(uid)
    storage.write_json(pdir / "photos.json", photos)

    docs = []
    for d in args["documents"]:
        docs.append(_check_document(r, pkg, d))

    checks = package_checks(docs, photos)
    publish(r, f"pkg:{pkg}", {
        "id": pkg,
        "finished_at": now(),
        "checks": checks,
        "photos": [{k: p[k] for k in ("id", "name", "image")} for p in photos],
    })


def _check_document(r: Redis, pkg: str, d: dict) -> dict:
    doc_id = d["doc_id"]
    ddir = storage.doc_dir(doc_id, must_exist=False)
    ddir.mkdir(parents=True, exist_ok=True)
    pkey = progress_key(doc_id)
    started = now()
    t0 = time.time()
    r.hset(pkey, {"state": "running", "stage": "Запуск", "progress": 0.02, "started_at": started})
    r.expire(pkey, RESULT_TTL)
    info = {"doc_id": doc_id, "file": d.get("file") or "document.pdf", "state": "error"}
    try:
        if d.get("sample"):
            src = storage.sample_pdf(d["sample"])
        else:
            src, meta = storage.upload(d["upload_id"])
            info["file"] = d.get("file") or meta["name"]
        shutil.copyfile(src, ddir / "input.pdf")
        if not d.get("sample"):
            storage.drop_upload(d["upload_id"])
        info["sha256"] = sha256(ddir / "input.pdf")
        storage.write_json(ddir / "meta.json", {"doc_id": doc_id, "package_id": pkg, "file": info["file"], "sample": d.get("sample")})

        def progress(stage: str, frac: float) -> None:
            r.hset(pkey, {"stage": stage, "progress": round(frac, 3)})

        report = run_check(ddir / "input.pdf", ddir, progress=progress)
        status = {
            "state": "done", "stage": "Готово", "progress": 1.0, "started_at": started, "finished_at": now(),
            "seconds": round(time.time() - t0, 1), "verdict": report["verdict"], "counts": report["counts"],
            "llm_used": False, "kind": report.get("document_kind", "passport"),
        }
        expected = storage.sample_expected(d["sample"]) if d.get("sample") else None
        publish(r, f"doc:{doc_id}", {"id": doc_id, "status": status, "report": report, "expected": expected})
        info.update(state="done", report=report)
    except Exception as exc:  # noqa: BLE001 — ошибку документа показываем пользователю, пакет продолжается
        log.exception("Документ %s: ошибка проверки", doc_id)
        error = f"{type(exc).__name__}: {exc}"
        info["error"] = error
        publish(r, f"doc:{doc_id}", {"id": doc_id, "status": {"state": "error", "stage": "Ошибка", "error": error, "finished_at": now()}})
    finally:
        r.delete(pkey)
    return info


# ================================================================= быстрые операции

_BLOCK_LOCK = threading.Lock()


def rules(args: dict) -> dict:
    r = load_rules()
    return {
        "version": __version__,
        "categories": r["categories"],
        "rules": [{"id": k, **v} for k, v in r["rules"].items()],
        "thresholds": r["thresholds"],
        "required_sections": r["required_sections"],
        "required_general_fields": r["required_general_fields"],
        "allowed_scales": r["allowed_scales"],
    }


def samples(args: dict) -> list[dict]:
    return storage.list_samples()


def blocks(args: dict) -> dict:
    """Развёртки и фото документа (кэш в blocks/) + фото, загруженные вместе с пакетом."""
    from colorpass.photo import passport_blocks, save_rgb

    doc_id = args["doc_id"]
    ddir = storage.doc_dir(doc_id)
    index = ddir / "blocks" / "blocks.json"
    with _BLOCK_LOCK:
        if not index.exists():
            index.parent.mkdir(parents=True, exist_ok=True)
            items = []
            for b, img in passport_blocks(ddir / "input.pdf", _pages(doc_id, args)):
                save_rgb(ddir / "blocks" / f"{b.id}.png", img)
                items.append({**b.__dict__, "image": f"blocks/{b.id}.png"})
            storage.write_json(index, items)
    items = storage.read_json(index, [])
    pkg = storage.doc_meta(doc_id).get("package_id")
    pkg_photos = storage.read_json(storage.package_dir(pkg) / "photos.json", []) if pkg else []
    return {
        "facades": [b for b in items if b["kind"] == "facade"],
        "photos": [{"id": p["id"], "kind": "photo", "label": f"Фото пакета: {p['name']}", "image": p["image"], "page": None}
                   for p in pkg_photos] + [b for b in items if b["kind"] == "photo"],
    }


def _pages(doc_id: str, args: dict) -> list[dict]:
    """Листы документа: из запроса или из report.json рядом с файлами."""
    if args.get("pages"):
        return args["pages"]
    report = storage.read_json(storage.doc_dir(doc_id) / "report.json", {}) or {}
    return report.get("pages") or []


def _load_photo(doc_id: str, args: dict, pages: list[dict]):
    """Фото для сравнения: загруженное (upload_id) или из документа/пакета (photo_block). → (img, source, src_path)"""
    from colorpass.photo import load_rgb

    if args.get("upload_id"):
        src, meta = storage.upload(args["upload_id"])
        source = {"kind": "upload", "name": meta["name"]}
    else:
        by_id = {b["id"]: b for b in (lambda bl: bl["facades"] + bl["photos"])(blocks({"doc_id": doc_id, "pages": pages}))}
        b = by_id.get(args.get("photo_block") or "")
        if not b:
            raise BadRequest("Загрузите фото или выберите фото из документа")
        src = storage.resolve_file(doc_id, b["image"])
        source = {"kind": "passport", "block": b["id"], "name": b["label"]}
    try:
        return load_rgb(src), source, src
    except ValueError as exc:
        raise BadRequest(str(exc)) from exc


def corners(args: dict) -> dict:
    """Подсказка 4 углов фасада на фото (по линиям); инспектор проверяет и правит точки."""
    from colorpass.photo import suggest_quad

    img, _, _ = _load_photo(args["doc_id"], args, _pages(args["doc_id"], args))
    quad, info = suggest_quad(img)
    return {"quad": quad, "confident": info.get("confident", False), "info": info}


def _points(raw, n: int, name: str):
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


def compare(args: dict) -> dict:
    """Сравнение фото с развёрткой; изображения — в compare/<cid>/, итог возвращается бэкенду для базы."""
    from colorpass.photo import compare as run_compare
    from colorpass.photo import load_rgb, save_rgb
    from colorpass.photo import template_conclusion as photo_conclusion

    doc_id = args["doc_id"]
    pages = _pages(doc_id, args)
    ddir = storage.doc_dir(doc_id)
    bl = blocks({"doc_id": doc_id, "pages": pages})
    facade = next((b for b in bl["facades"] if b["id"] == args.get("facade")), None)
    if not facade:
        raise BadRequest("Не выбрана развёртка")
    quad = _points(args.get("quad"), 4, "Углы фасада на фото")
    rect = _points(args.get("rect"), 2, "Часть развёртки")
    photo, source, src = _load_photo(doc_id, args, pages)

    cid = storage.new_id()
    out = ddir / "compare" / cid
    out.mkdir(parents=True, exist_ok=True)
    if source["kind"] == "upload":
        shutil.copyfile(src, out / "photo.jpg")
    t0 = time.time()
    drawing_rect = None
    if rect:
        (x0, y0), (x1, y1) = rect
        drawing_rect = (min(x0, x1), min(y0, y1), max(x0, x1), max(y0, y1))
    res, imgs = run_compare(load_rgb(ddir / facade["image"]), photo, quad, drawing_rect)
    for name, img in imgs.items():
        save_rgb(out / f"{name}.png", img)
    result = res.to_dict()
    text = photo_conclusion(res, facade["label"])
    payload = {
        "id": cid,
        "run_id": doc_id,
        "created_at": now(),
        "seconds": round(time.time() - t0, 1),
        "facade": {"id": facade["id"], "label": facade["label"]},
        "source": source,
        "quad": quad,
        "rect": rect,
        "result": result,
        "review": None,
        "llm": {"used": False, "model": None, "error": None},
        "conclusion": text,
        "template_conclusion": text,
        "code_verdict": result["verdict"],
        "images": {k: f"compare/{cid}/{k}.png" for k in imgs},
    }
    storage.write_json(out / "result.json", payload)
    return payload


def recalc(args: dict) -> dict:
    """Пересчёт отчёта после исключения замечаний: вердикт, счётчики, чек-лист, заключение, листы с рамками."""
    doc_id, report = args["doc_id"], args["report"]
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
    report.setdefault("counts", {}).update(
        errors=len(errors), warnings=len(warns), rules_total=len(checklist),
        rules_ok=sum(1 for c in checklist if c.get("status") == "ok"),
        rules_failed=sum(1 for c in checklist if c.get("status") == "fail"),
        rules_warn=sum(1 for c in checklist if c.get("status") == "warn"),
        rules_skipped=sum(1 for c in checklist if c.get("status") == "skip"),
    )
    for page in report.get("pages") or []:
        page["findings"] = [f["id"] for f in active if f.get("page") == page.get("index")]
    report["conclusion"] = {"text": template_conclusion(report.get("summary") or {}, active), "source": "template", "recalculated": True}
    try:
        ddir = storage.doc_dir(doc_id)
        _refresh_annotations(ddir, report, active)
        storage.write_json(ddir / "report.json", report)
    except NotFound:
        pass  # файлов нет (удалены) — отчёт в базе всё равно корректен
    return {"report": report}


def _refresh_annotations(ddir, report: dict, active: list[dict]) -> None:
    from PIL import Image

    from colorpass.ingest import Document
    from colorpass.pipeline import PREVIEW_SCALE, _annotate

    pages = report.get("pages") or []
    if not pages or not (ddir / "input.pdf").exists():
        return
    try:
        doc = Document(ddir / "input.pdf")
        try:
            for entry in pages:
                page_f = [f for f in active if f.get("page") == entry.get("index") and f.get("bbox")]
                rel = entry.get("annotated")
                if page_f:
                    rel = rel or f"annotated/p{entry['index'] + 1:02d}.png"
                    (ddir / "annotated").mkdir(exist_ok=True)
                    img = doc.render(entry["index"], PREVIEW_SCALE)
                    Image.fromarray(_annotate(img, page_f, PREVIEW_SCALE)).save(ddir / rel, optimize=True)
                    entry["annotated"] = rel
                elif rel:
                    entry.pop("annotated", None)
                    (ddir / rel).unlink(missing_ok=True)
        finally:
            doc.close()
    except Exception as exc:  # noqa: BLE001 — без картинок отчёт остаётся корректным
        log.warning("Не удалось обновить изображения листов: %s", exc)


def excel(args: dict) -> dict:
    """XLSX с чек-листом и заключением → export/<имя>.xlsx в каталоге документа."""
    from colorpass.excel import build_report_xlsx, report_filename

    ddir = storage.doc_dir(args["doc_id"])
    report, source = args["report"], args.get("file") or args["report"].get("file") or ""
    name = report_filename(report, source)
    (ddir / "export").mkdir(exist_ok=True)
    (ddir / "export" / name).write_bytes(build_report_xlsx(report, source))
    return {"path": f"export/{name}", "filename": name}


def archive(args: dict) -> dict:
    return {"archived": storage.archive_doc(args["doc_id"])}


RPC_HANDLERS = {
    "rules": rules,
    "samples": samples,
    "blocks": blocks,
    "corners": corners,
    "compare": compare,
    "recalc": recalc,
    "excel": excel,
    "archive": archive,
}
