"""Сервисный слой бэкенда (не зависит от Django): пакеты, документы, журнал, решения инспектора.

Файлов и PDF бэкенд не касается. Проверку пакета он ставит в очередь Redis (сервис checker), быстрые операции
с файлами (развёртки, углы, сравнение фото, пересчёт листов, Excel) запрашивает через ту же очередь с ответом,
а готовые отчёты забирает из Redis в базу при первом обращении (sync). Языковые модели — сервис chat.
"""
from __future__ import annotations

import json
import logging
import os
import re
import threading
import time
from datetime import datetime, timedelta, timezone
from urllib.parse import quote

from .redisq import HEARTBEAT, JOBS, READY, RPC, Redis, progress_key, push_job, result_key
from .store import get_store

log = logging.getLogger(__name__)

ID = re.compile(r"[0-9a-f]{12}")
DECISIONS = {"accepted", "rejected"}
FINDING_ACTIONS = {"dismiss", "restore", "delete"}
VERDICT_TEXT = {"match": "СОВПАДАЕТ", "mismatch": "НЕ СОВПАДАЕТ", "attention": "ТРЕБУЕТ ВНИМАНИЯ"}
PHOTO_CATEGORIES = ["цвет", "вывеска или реклама", "окна и двери", "навесное оборудование", "архитектурные элементы", "другое"]
RPC_TIMEOUT = int(os.getenv("COLORPASS_RPC_TIMEOUT", "180"))
MAX_DOCUMENTS = int(os.getenv("COLORPASS_MAX_DOCUMENTS", "20"))


class NotFound(Exception):
    pass


class BadRequest(Exception):
    pass


class Unavailable(Exception):
    """Сервис checker или Redis недоступны."""


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _new_id() -> str:
    import uuid

    return uuid.uuid4().hex[:12]


def _valid(value: str) -> bool:
    return bool(ID.fullmatch(value or ""))


_redis: Redis | None = None


def redis() -> Redis:
    global _redis
    if _redis is None:
        _redis = Redis()
    return _redis


def rpc(kind: str, args: dict, timeout: int = RPC_TIMEOUT):
    """Быстрая операция в checker: задача в очередь cp:rpc, ответ — в cp:reply:<id>."""
    try:
        key = push_job(redis(), RPC, kind, args, reply=True)
        raw = redis().blpop(key, timeout=timeout)
    except OSError as exc:
        raise Unavailable(f"Очередь задач (Redis) недоступна: {exc}") from exc
    if raw is None:
        raise Unavailable(f"Сервис обработки файлов не ответил за {timeout} с")
    data = json.loads(raw)
    if data.get("ok"):
        return data["result"]
    status = data.get("status")
    if status == 404:
        raise NotFound(data.get("error"))
    if status == 400:
        raise BadRequest(data.get("error"))
    raise Unavailable(data.get("error") or "Ошибка сервиса обработки файлов")


_cache: dict[str, tuple[float, object]] = {}


def _cached(kind: str, ttl: int):
    hit = _cache.get(kind)
    if hit and time.time() - hit[0] < ttl:
        return hit[1]
    value = rpc(kind, {}, timeout=30)
    _cache[kind] = (time.time(), value)
    return value


# ================================================================= справочные


def health() -> dict:
    store = get_store()
    try:
        db = {"enabled": True, "ok": True, "kind": type(store).__name__, **store.stats()}
    except Exception as exc:  # noqa: BLE001
        db = {"enabled": True, "ok": False, "error": str(exc)[:200]}
    try:
        beat = redis().get(HEARTBEAT)
        queue = {"ok": True}
        checker = {"ok": bool(beat), **(json.loads(beat) if beat else {"error": "сервис checker не отвечает"})}
    except OSError as exc:
        queue, checker = {"ok": False, "error": str(exc)[:200]}, {"ok": False}
    return {"ok": True, "db": db, "queue": queue, "checker": checker}


def rules() -> dict:
    return _cached("rules", 300)


def inspect_uploads(uploads: list[str]) -> dict:
    if (not isinstance(uploads, list) or not uploads or len(uploads) > MAX_DOCUMENTS
            or any(not isinstance(uid, str) or not _valid(uid) for uid in uploads)):
        raise BadRequest("Неверные идентификаторы загрузок")
    return rpc("inspect_uploads", {"uploads": uploads})


def samples() -> list[dict]:
    return _cached("samples", 60)


def _archive_days() -> int:
    try:
        return max(0, int((rules().get("thresholds") or {}).get("archive_after_days", 30)))
    except (Unavailable, TypeError, ValueError):
        return 30


# ================================================================= результаты checker → база

_SYNC_LOCK = threading.Lock()


def sync() -> None:
    """Забирает готовые отчёты и итоги пакетов из Redis в базу. Вызывается при чтении журнала и отчётов."""
    store = get_store()
    try:
        keys = redis().smembers(READY)
    except OSError as exc:
        log.warning("Redis недоступен, результаты заберу позже: %s", exc)
        return
    if not keys:
        return
    with _SYNC_LOCK:
        touched = set()
        for key in sorted(keys, key=lambda k: k.startswith("pkg:")):  # сначала документы, потом итог пакета
            raw = redis().get(result_key(key))
            if raw:
                data = json.loads(raw)
                if key.startswith("doc:"):
                    found = store.get_check(data["id"])
                    status = found[0] if found else {"id": data["id"]}
                    status.update(data["status"])
                    if data.get("expected"):
                        status["expected"] = data["expected"]
                    store.save_status(status, data.get("report"))
                    if status.get("package_id"):
                        touched.add(status["package_id"])
                else:
                    pkg = store.get_package(data["id"])
                    if pkg:
                        pkg.update(checks=data["checks"], photos=data["photos"], finished_at=data["finished_at"])
                        store.save_package(pkg)
                        touched.add(pkg["id"])
            redis().delete(result_key(key))
            redis().srem(READY, key)
        for pid in touched:
            _refresh_package(pid)


_ORDER = {"pass": 0, "warn": 1, "fail": 2}


def _refresh_package(pid: str) -> dict | None:
    """Состояние и вердикт пакета: худший из документов и сверки документов между собой."""
    store = get_store()
    pkg = store.get_package(pid)
    if not pkg:
        return None
    docs = store.package_checks(pid)
    states = {d.get("state") for d in docs}
    if pkg.get("finished_at") and not states & {"queued", "running"}:
        pkg["state"] = "done"
    elif states & {"running", "done", "error"}:
        pkg["state"] = "running"
    verdicts = [d.get("verdict") for d in docs if d.get("state") == "done" and d.get("verdict")]
    verdicts += ["fail" if c.get("status") == "fail" else "warn" if c.get("status") == "warn" else "pass" for c in pkg.get("checks") or []]
    if any(d.get("state") == "error" for d in docs):
        verdicts.append("fail")
    pkg["verdict"] = max(verdicts, key=lambda v: _ORDER[v]) if pkg["state"] == "done" and verdicts else None
    pkg["counts"] = {
        "documents": len(docs),
        "errors": sum((d.get("counts") or {}).get("errors", 0) for d in docs) + sum(c.get("status") == "fail" for c in pkg.get("checks") or []),
        "warnings": sum((d.get("counts") or {}).get("warnings", 0) for d in docs) + sum(c.get("status") == "warn" for c in pkg.get("checks") or []),
    }
    store.save_package(pkg)
    return pkg


def _live(status: dict) -> dict:
    """Ход проверки документа, пока он в работе (живёт в Redis, в базу не пишется)."""
    if status.get("state") in ("queued", "running"):
        try:
            p = redis().hgetall(progress_key(status["id"]))
        except OSError:
            p = {}
        if p:
            status.update(state=p.get("state") or status["state"], stage=p.get("stage") or status.get("stage"),
                          progress=float(p.get("progress") or 0))
    return status


# ================================================================= пакеты


def create_package(uploads: list[dict] | None = None, samples_: list[str] | None = None, title: str = "",
                   service_type: str | None = None) -> dict:
    """Пакет документов одной заявки: PDF — документы (паспорт, дизайн-проект вывесок), JPEG/PNG — фото объекта.
    uploads — ответ checker на загрузку: [{id, name, kind}]; samples_ — имена образцов из dataset/."""
    if service_type not in (None, "passport", "signage", "facade"):
        raise BadRequest("Тип проверки: passport, signage или facade")
    uploads = [u for u in (uploads or []) if isinstance(u, dict)]
    for u in uploads:
        if not _valid(u.get("id")) or u.get("kind") not in ("pdf", "image"):
            raise BadRequest("Неверная загрузка: нужен id и kind (pdf или image)")
    names = [s for s in (samples_ or []) if isinstance(s, str)]
    if any(not re.fullmatch(r"[\w\-]+", s) for s in names):
        raise BadRequest("Неверное имя образца")
    if names:
        known = {s["name"]: s for s in samples()}
        if any(s not in known for s in names):
            raise NotFound("Образец не найден")
    docs_in = [{"upload_id": u["id"], "file": str(u.get("name") or "документ.pdf")[:200]} for u in uploads if u["kind"] == "pdf"]
    docs_in += [{"sample": s, "file": known[s]["file"]} for s in names]
    photos = [u["id"] for u in uploads if u["kind"] == "image"]
    if not docs_in:
        raise BadRequest("В пакете нет ни одного PDF-документа")
    if len(docs_in) > MAX_DOCUMENTS:
        raise BadRequest(f"В пакете больше {MAX_DOCUMENTS} документов")

    store = get_store()
    pid, created = _new_id(), _now()
    documents = []
    for i, d in enumerate(docs_in):
        doc_id = _new_id()
        status = {"id": doc_id, "package_id": pid, "position": i, "file": d["file"], "sample": d.get("sample"),
                  "state": "queued", "stage": "В очереди", "progress": 0.0, "created_at": created}
        store.save_status(status)
        documents.append({"doc_id": doc_id, **d})
    pkg = {
        "id": pid,
        "title": (title or "").strip()[:200] or (docs_in[0]["file"] if len(docs_in) == 1 else f"Пакет из {len(docs_in)} документов"),
        "state": "queued",
        "verdict": None,
        "created_at": created,
        "finished_at": None,
        "checks": [],
        "service_type": service_type,
        "photos": [],
        "photos_uploaded": len(photos),
    }
    store.save_package(pkg)
    try:
        push_job(redis(), JOBS, "check_package", {"package_id": pid, "documents": documents,
                                               "photos": photos, "service_type": service_type})
    except OSError as exc:
        raise Unavailable(f"Очередь задач (Redis) недоступна: {exc}") from exc
    return get_package(pid)


def get_package(pid: str) -> dict:
    if not _valid(pid):
        raise NotFound(pid)
    sync()
    store = get_store()
    pkg = store.get_package(pid)
    if not pkg:
        raise NotFound(pid)
    docs = [_live(_maybe_archive(d)) for d in store.package_checks(pid)]
    pkg["documents"] = docs
    pkg["progress"] = round(sum(1.0 if d.get("state") in ("done", "error") else float(d.get("progress") or 0) for d in docs) / max(1, len(docs)), 3)
    return pkg


def save_checklist_review(pid: str, review: dict) -> dict:
    """Пояснения GigaChat сохраняются отдельно и не меняют нормативный вердикт."""
    pkg = get_package(pid)
    if pkg.get("state") != "done":
        raise BadRequest("Проверка пакета ещё не завершена")
    if not isinstance(review, dict) or review.get("state") not in ("queued", "running", "done", "failed"):
        raise BadRequest("Неверное состояние разбора")
    titles = {c["rule"]: c.get("title", c["rule"]) for c in pkg.get("checks", [])}
    allowed = set(titles)
    items = review.get("items", [])
    if not isinstance(items, list) or len(items) > len(allowed):
        raise BadRequest("Неверные пункты разбора")
    cleaned = []
    seen = set()
    for item in items:
        if not isinstance(item, dict) or item.get("id") not in allowed or item["id"] in seen:
            raise BadRequest("Неизвестный или повторяющийся пункт чек-листа")
        seen.add(item["id"])
        citations = item.get("citations", [])
        if not isinstance(citations, list) or len(citations) > 5:
            raise BadRequest("Неверные ссылки на доказательства")
        refs = []
        for citation in citations:
            if not isinstance(citation, dict) or not isinstance(citation.get("page"), int):
                raise BadRequest("Неверная ссылка на страницу")
            refs.append({"documentId": str(citation.get("documentId", ""))[:12],
                         "file": str(citation.get("file", ""))[:200], "page": citation["page"],
                         "quote": str(citation.get("quote", ""))[:700]})
        cleaned.append({"id": item["id"], "title": titles[item["id"]], "explanation": str(item.get("explanation", ""))[:1800],
                        "suggestion": str(item.get("suggestion", ""))[:1000], "citations": refs})
    stored = {"state": review["state"], "items": cleaned,
              "inputHash": str(review.get("inputHash", ""))[:64],
              "model": str(review.get("model", ""))[:100], "provider": "gigachat",
              "completed": len(cleaned), "total": len(allowed), "updatedAt": _now(),
              "used": review.get("used") is True,
              "error": str(review.get("error", ""))[:300]}
    pkg["checklist_review"] = stored
    get_store().save_package(pkg)
    return stored


def package_locations(pid: str) -> dict:
    pkg = get_package(pid)
    citations = [{**citation, "rule": item["id"]}
                 for item in (pkg.get("checklist_review") or {}).get("items", [])
                 for citation in item.get("citations", [])]
    return rpc("locations", {"package_id": pid,
                            "documents": [{"id": d["id"], "file": d["file"]} for d in pkg["documents"]],
                            "citations": citations})


def list_packages(limit: int = 50) -> list[dict]:
    sync()
    store = get_store()
    out = []
    for pkg in store.list_packages(limit):
        docs = [_live(d) for d in store.package_checks(pkg["id"])]
        pkg["documents"] = [{k: d.get(k) for k in ("id", "file", "kind", "state", "stage", "progress", "verdict", "counts", "decision", "archived_at")} for d in docs]
        out.append(pkg)
    return out


def start_sample(name: str) -> dict:
    """Один образец — пакет из одного документа (кнопки на стартовом экране)."""
    return create_package(samples_=[name])


# ================================================================= документы


def _maybe_archive(status: dict) -> dict:
    """Через 30 дней после решения инспектора файлы документа уходят в архив checker (ссылки работают)."""
    if status.get("archived_at") or status.get("decision") not in DECISIONS or not status.get("decided_at"):
        return status
    decided = datetime.fromisoformat(status["decided_at"])
    if decided.tzinfo is None:
        decided = decided.replace(tzinfo=timezone.utc)
    if datetime.now(timezone.utc) < decided + timedelta(days=_archive_days()):
        return status
    status["archived_at"] = _now()
    found = get_store().get_check(status["id"])
    get_store().save_status(status, found[1] if found else None)
    try:
        push_job(redis(), RPC, "archive", {"doc_id": status["id"]})
    except OSError as exc:
        log.warning("Архивация %s отложена: %s", status["id"], exc)
    return status


def get_check(check_id: str) -> dict:
    if not _valid(check_id):
        raise NotFound(check_id)
    sync()
    found = get_store().get_check(check_id)
    if not found:
        raise NotFound(check_id)
    status, report = found
    status = _live(_maybe_archive(status))
    if report is not None and status.get("state") == "done":
        status["report"] = report
    return status


def _done(check_id: str) -> tuple[dict, dict]:
    run = get_check(check_id)
    if run.get("state") != "done" or "report" not in run:
        raise BadRequest("Проверка документа ещё не завершена")
    report = run.pop("report")
    return run, report


_EDIT_LOCK = threading.Lock()


def _save(status: dict, report: dict | None = None) -> None:
    clean = {k: v for k, v in status.items() if k != "report"}
    get_store().save_status(clean, report)


def change_finding_status(check_id: str, finding_id: str, action: str = "dismiss", reason: str = "") -> dict:
    """Исключает замечание как ложное срабатывание, возвращает или удаляет; checker пересчитывает отчёт и листы."""
    action = (action or "").strip().lower()
    if action not in FINDING_ACTIONS:
        raise BadRequest("Действие должно быть dismiss, restore или delete")
    if not finding_id:
        raise BadRequest("Не указано замечание")
    with _EDIT_LOCK:
        status, report = _done(check_id)
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
        report = rpc("recalc", {"doc_id": check_id, "report": report})["report"]
        status.update(verdict=report["verdict"], counts=report["counts"], edited_at=_now(),
                      dismissed=sum(1 for f in report["findings"] if f.get("dismissed")))
        _save(status, report)
    if status.get("package_id"):
        _refresh_package(status["package_id"])
    return get_check(check_id)


def set_decision(check_id: str, decision: str, note: str = "") -> dict:
    """Решение инспектора: документ проверен и принят или отклонён."""
    decision = (decision or "").strip().lower()
    if decision not in DECISIONS:
        raise BadRequest("Решение должно быть accepted или rejected")
    with _EDIT_LOCK:
        status, report = _done(check_id)
        if status.get("archived_at"):
            raise BadRequest("Файл уже в архиве, решение изменить нельзя")
        decided = datetime.now(timezone.utc).replace(microsecond=0)
        status.update(decision=decision, decided_at=decided.isoformat(), decision_note=(note or "").strip() or None,
                      archive_at=(decided + timedelta(days=_archive_days())).isoformat())
        _save(status, report)
    return get_check(check_id)


def save_conclusion(check_id: str, text: str, model: str = "", provider: str = "") -> dict:
    """Заключение, сформулированное моделью (присылает сервис chat). Вердикт и замечания не меняются."""
    text = (text or "").strip()
    if not text:
        raise BadRequest("Пустой текст заключения")
    with _EDIT_LOCK:
        status, report = _done(check_id)
        prev = report.get("conclusion") or {}
        template = prev.get("template") or (prev.get("text") if prev.get("source") != "llm" else None)
        report["conclusion"] = {"text": text[:6000], "source": "llm", "template": template, "created_at": _now()}
        llm = report.setdefault("llm", {})
        llm.update({"requested": True, "used": True, "model": model or None, "provider": provider or None, "error": None})
        llm.setdefault("tasks", {})["conclusion"] = "ok"
        status.update(llm_used=True, edited_at=_now())
        _save(status, report)
    return get_check(check_id)


def report_json(check_id: str) -> dict:
    return _done(check_id)[1]


def conclusion_text(check_id: str) -> str:
    return ((_done(check_id)[1].get("conclusion") or {}).get("text") or "").strip() + "\n"


def export_excel_url(check_id: str) -> str:
    """Processor формирует XLSX из текущего отчёта (с исключёнными замечаниями) → ссылка на файл."""
    status, report = _done(check_id)
    res = rpc("excel", {"doc_id": check_id, "report": report, "file": status.get("file")})
    return f"/files/{check_id}/{quote(res['path'])}"


# ================================================================= сравнение фото


def blocks(check_id: str) -> dict:
    _, report = _done(check_id)
    return rpc("blocks", {"doc_id": check_id, "pages": report.get("pages") or []})


def _photo_args(data: dict) -> dict:
    upload_id, block = data.get("upload_id"), data.get("photo_block")
    if upload_id and not _valid(upload_id):
        raise BadRequest("Неверный upload_id")
    if not upload_id and not block:
        raise BadRequest("Загрузите фото или выберите фото из документа")
    return {"upload_id": upload_id or None, "photo_block": block or None}


def corners(check_id: str, data: dict) -> dict:
    _, report = _done(check_id)
    return rpc("corners", {"doc_id": check_id, "pages": report.get("pages") or [], **_photo_args(data)})


def compare_photo(check_id: str, data: dict) -> dict:
    """Сравнение фото с развёрткой (checker); результат — в базу. Описание моделью добавляет сервис chat."""
    _, report = _done(check_id)
    payload = rpc("compare", {
        "doc_id": check_id, "pages": report.get("pages") or [], "facade": data.get("facade") or "",
        "quad": data.get("quad"), "rect": data.get("rect"), **_photo_args(data),
    })
    get_store().save_comparison(payload)
    return payload


def list_comparisons(check_id: str) -> list[dict]:
    if not _valid(check_id):
        raise NotFound(check_id)
    return get_store().list_comparisons(check_id)


def _clean_review(raw: dict) -> dict:
    if not isinstance(raw, dict):
        raise BadRequest("review: ожидается объект")
    diffs = []
    for d in (raw.get("differences") or [])[:12]:
        if not isinstance(d, dict):
            continue
        desc = str(d.get("description", "")).strip()[:300]
        if desc:
            cat = d.get("category") if d.get("category") in PHOTO_CATEGORIES else "другое"
            diffs.append({"category": cat, "description": desc, "where": str(d.get("where", "")).strip()[:120]})
    return {"same_facade": bool(raw.get("same_facade", True)), "differences": diffs, "summary": str(raw.get("summary", "")).strip()[:1200]}


def save_photo_review(check_id: str, cid: str, review: dict | None, model: str = "", provider: str = "", error: str = "") -> dict:
    """Описание отличий на фото от модели (через chat). Вердикт считает код: модель может только поднять
    «совпадает» до «требует внимания», если видит отличия, которых нет в цвете."""
    if not _valid(check_id) or not _valid(cid):
        raise NotFound(cid)
    store = get_store()
    with _EDIT_LOCK:
        payload = store.get_comparison(cid)
        if not payload or payload.get("run_id") != check_id:
            raise NotFound(cid)
        result = payload["result"]
        code_verdict = payload.get("code_verdict") or result["verdict"]
        text = payload.get("template_conclusion") or payload.get("conclusion") or ""
        if review is None:  # модель не ответила: прежнее описание, если было, остаётся
            if not payload.get("review"):
                payload["llm"] = {"used": False, "model": model or None, "provider": provider or None, "error": None}
            payload["llm"]["error"] = (error or "Модель не ответила")[:300]
        else:
            review = _clean_review(review)
            verdict = code_verdict
            if verdict == "match" and (review["differences"] or not review["same_facade"]):
                verdict = "attention"  # модель видит то, что код по цвету не нашёл — пусть посмотрит инспектор
            if verdict != code_verdict:
                text = text.replace(VERDICT_TEXT[code_verdict].lower(), VERDICT_TEXT[verdict].lower(), 1)
            if not review["same_facade"]:
                text += "\nМодель сомневается, что на фото тот же фасад, — проверьте выбор развёртки и углы."
            if review["summary"]:
                text += "\n\nОписание модели: " + review["summary"]
            result["verdict"] = verdict
            payload.update(review=review, conclusion=text, llm={"used": True, "model": model or None, "provider": provider or None, "error": None})
        store.save_comparison(payload)
    return payload
