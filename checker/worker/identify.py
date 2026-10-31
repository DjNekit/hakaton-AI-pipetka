"""Определение вида документа и адреса из содержимого загруженных PDF."""
from __future__ import annotations

import re
from pathlib import Path

from colorpass.checks import load_rules
from colorpass.extract import build_passport
from colorpass.ingest import Document, norm_text
from colorpass.signage import build_signage, is_signage

from . import storage
from .package import normalize_address, same_address
from .storage import BadRequest


def identify_pdf(path: Path) -> dict:
    settings = load_rules()["document_identification"]
    doc = Document(path)
    try:
        text = " ".join(norm_text(page.text)[:settings["title_characters"]]
                        for page in doc.pages[:settings["title_pages"]]).lower()
        matches = [kind for kind, patterns in settings["patterns"].items()
                   if any(re.search(pattern, text) for pattern in patterns)]
        # Заголовок паспорта важнее упоминания вывесок среди его приложений.
        kind = "passport" if "passport" in matches else "signage" if is_signage(doc) else matches[0] if matches else None
        passport = build_passport(doc)
        address = passport.title.get("Адрес") or passport.general.get("Адрес объекта")
        if kind == "signage" or not address:
            address = build_signage(doc).address or address
        return {"documentType": kind, "address": norm_text(address) if address else None}
    finally:
        doc.close()


def inspect_uploads(args: dict) -> dict:
    uploads = args.get("uploads")
    if not isinstance(uploads, list) or not uploads or len(uploads) > 20:
        raise BadRequest("Нужен пакет PDF-документов")
    documents = []
    for uid in uploads:
        path, meta = storage.upload(uid)
        if meta["kind"] != "pdf":
            raise BadRequest("Нужен PDF-файл")
        cache = path.parent / "identification.json"
        result = storage.read_json(cache)
        if result is None:
            result = identify_pdf(path)
            storage.write_json(cache, result)
        documents.append({**result, "file": meta["name"]})
    kinds = {document["documentType"] for document in documents if document["documentType"]}
    if not kinds:
        return {"error": "document_type_unknown", "documents": documents}
    if len(kinds) > 1:
        return {"error": "mixed_document_types", "documents": documents}
    kind = kinds.pop()
    main = [document for document in documents if document["documentType"] == kind]
    addresses = [document["address"] for document in main if document["address"]]
    known = [(address, normalize_address(address)) for address in addresses]
    known = [(address, normalized) for address, normalized in known if normalized]
    if known and any(a != known[0][1] and not same_address(known[0][1], a) for _, a in known[1:]):
        return {"error": "document_addresses_conflict", "documents": documents}
    return {"documentType": kind, "address": addresses[0] if addresses else "", "documents": documents}
