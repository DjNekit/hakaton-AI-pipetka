"""Файлы сервиса processor. Всё, что связано с файлами, живёт только здесь (бэкенд их не видит).

runs/
  uploads/<upload>/<имя файла>, meta.json    загруженные, ещё не разобранные файлы (PDF и фото)
  docs/<doc>/                                 документ пакета: input.pdf, meta.json, pages/, annotated/, blocks/,
                                              compare/<cid>/, report.json, conclusion.md, export/
  packages/<package>/photos/                  фото, загруженные вместе с пакетом (для сравнения с развёртками)
  archive/<doc>/                              документы через 30 дней после решения инспектора
  web/<id>/                                   проверки прежней версии (только чтение)
"""
from __future__ import annotations

import json
import os
import re
import shutil
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
RUNS = Path(os.getenv("COLORPASS_RUNS_DIR", ROOT / "runs"))
UPLOADS, DOCS, PACKAGES, ARCHIVE, LEGACY = (RUNS / n for n in ("uploads", "docs", "packages", "archive", "web"))
SAMPLE_DIRS = [Path(os.getenv("COLORPASS_REAL_DIR", ROOT / "dataset" / "real")), Path(os.getenv("COLORPASS_SIGNS_DIR", ROOT / "dataset" / "signs"))]
MAX_UPLOAD_MB = int(os.getenv("COLORPASS_MAX_UPLOAD_MB", "100"))

ID = re.compile(r"[0-9a-f]{12}")
IMAGE_EXT = {b"\xff\xd8\xff": ".jpg", b"\x89PNG": ".png"}


class NotFound(Exception):
    pass


class BadRequest(Exception):
    pass


def new_id() -> str:
    return uuid.uuid4().hex[:12]


def valid_id(value: str) -> bool:
    return bool(ID.fullmatch(value or ""))


def read_json(path: Path, default=None):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return default


def write_json(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(path)


# ---------------------------------------------------------------- загрузки


def file_kind(data: bytes) -> str | None:
    if data.startswith(b"%PDF"):
        return "pdf"
    if any(data.startswith(sig) for sig in IMAGE_EXT):
        return "image"
    return None


def save_upload(name: str, data: bytes) -> dict:
    """Сохраняет загруженный файл; PDF — документ пакета, JPEG/PNG — фото для сравнения."""
    name = Path(name or "file").name[:200] or "file"
    kind = file_kind(data)
    if kind is None:
        raise BadRequest(f"«{name}»: нужен PDF, JPEG или PNG")
    if len(data) > MAX_UPLOAD_MB * 1024 * 1024:
        raise BadRequest(f"«{name}»: файл больше {MAX_UPLOAD_MB} МБ")
    uid = new_id()
    d = UPLOADS / uid
    d.mkdir(parents=True, exist_ok=True)
    (d / "file").write_bytes(data)
    meta = {"id": uid, "name": name, "kind": kind, "size": len(data)}
    write_json(d / "meta.json", meta)
    return meta


def upload(uid: str) -> tuple[Path, dict]:
    if not valid_id(uid):
        raise NotFound(uid)
    d = UPLOADS / uid
    meta = read_json(d / "meta.json")
    if not meta or not (d / "file").exists():
        raise NotFound(f"Загрузка {uid} не найдена")
    return d / "file", meta


def drop_upload(uid: str) -> None:
    if valid_id(uid):
        shutil.rmtree(UPLOADS / uid, ignore_errors=True)


# ---------------------------------------------------------------- образцы


def sample_pdf(name: str) -> Path:
    if not re.fullmatch(r"[\w\-]+", name or ""):
        raise NotFound(name)
    for d in SAMPLE_DIRS:
        if (d / f"{name}.pdf").exists():
            return d / f"{name}.pdf"
    raise NotFound(name)


def sample_expected(name: str) -> dict | None:
    for d in SAMPLE_DIRS:
        data = read_json(d / f"{name}.expected.json")
        if data:
            return data
    return None


def list_samples() -> list[dict]:
    out = []
    for d in SAMPLE_DIRS:
        if not d.exists():
            continue
        for exp in sorted(d.glob("*.expected.json")):
            data = read_json(exp, {})
            if not data or not (d / data.get("file", "")).exists():
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


# ---------------------------------------------------------------- документы


def doc_dir(doc_id: str, must_exist: bool = True) -> Path:
    """Каталог документа: текущий, архивный или прежней версии."""
    if not valid_id(doc_id):
        raise NotFound(doc_id)
    for base in (DOCS, ARCHIVE, LEGACY):
        if (base / doc_id).is_dir():
            return base / doc_id
    if must_exist:
        raise NotFound(f"Файлы документа {doc_id} не найдены")
    return DOCS / doc_id


def doc_meta(doc_id: str) -> dict:
    return read_json(doc_dir(doc_id) / "meta.json", {}) or {}


def package_dir(package_id: str) -> Path:
    if not valid_id(package_id):
        raise NotFound(package_id)
    return PACKAGES / package_id


def resolve_file(doc_id: str, rel: str) -> Path:
    """Файл документа по относительному пути; «package/…» — файлы пакета, к которому относится документ."""
    base = doc_dir(doc_id)
    if rel.startswith("package/"):
        pkg = doc_meta(doc_id).get("package_id")
        if not pkg:
            raise NotFound(rel)
        base, rel = package_dir(pkg), rel[len("package/"):]
    base = base.resolve()
    path = (base / rel).resolve()
    if base not in path.parents or not path.is_file():
        raise NotFound(rel)
    return path


def archive_doc(doc_id: str) -> bool:
    src = DOCS / doc_id
    if not valid_id(doc_id) or not src.is_dir() or (ARCHIVE / doc_id).exists():
        return False
    ARCHIVE.mkdir(parents=True, exist_ok=True)
    src.rename(ARCHIVE / doc_id)
    return True
