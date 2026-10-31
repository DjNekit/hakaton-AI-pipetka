"""Связь пунктов чек-листа с листами и координатами исходных документов."""
from __future__ import annotations

import re

from colorpass.ingest import Document

from . import storage


def _tokens(text: str) -> list[str]:
    return re.findall(r"[\w]+", text.casefold().replace("ё", "е"))


def _quote_box(doc_id: str, page: int, quote: str) -> list[float] | None:
    target = _tokens(quote)
    if not target:
        return None
    directory = storage.doc_dir(doc_id)
    cache = directory / "word_locations.json"
    words = storage.read_json(cache)
    if words is None:
        with Document(directory / "input.pdf") as doc:
            words = [[{"text": w.text, "box": list(w.bbox)} for w in p.words] for p in doc.pages]
        storage.write_json(cache, words)
    if not 0 <= page < len(words):
        return None
    tokens = [(token, word["box"]) for word in words[page] for token in _tokens(word["text"])]
    for start in range(len(tokens) - len(target) + 1):
        if [token for token, _ in tokens[start:start + len(target)]] == target:
            boxes = [box for _, box in tokens[start:start + len(target)]]
            return [min(b[0] for b in boxes), min(b[1] for b in boxes),
                    max(b[2] for b in boxes), max(b[3] for b in boxes)]
    return None


def package_locations(args: dict) -> dict:
    pid = args["package_id"]
    documents = args["documents"]
    known = {d["id"]: d for d in documents}
    reports = {d["id"]: storage.read_json(storage.doc_dir(d["id"]) / "report.json") or {} for d in documents}
    package = storage.read_json(storage.package_dir(pid) / "report.json") or {}
    combined = storage.read_json(storage.package_dir(pid) / "combined" / "report.json") or {}
    source_pages = [(d["id"], p["index"]) for d in documents for p in reports[d["id"]].get("pages", [])]
    locations: dict[str, list[dict]] = {}

    def add(rule: str, doc_id: str, page: int, box=None, quote: str = "") -> None:
        if doc_id not in known or not isinstance(page, int) or page < 0:
            return
        if not any(p["index"] == page for p in reports[doc_id].get("pages", [])):
            return
        item = {"documentId": doc_id, "file": known[doc_id]["file"], "page": page + 1,
                "bbox": box, "quote": quote}
        entries = locations.setdefault(rule, [])
        if item not in entries:
            entries.append(item)

    for doc_id, report in reports.items():
        for finding in report.get("findings", []):
            if isinstance(finding.get("page"), int):
                add(finding["rule"], doc_id, finding["page"], finding.get("bbox"))
    for check in package.get("checks", []):
        for evidence in check.get("evidence", []):
            doc_id, page = evidence.get("document_id"), evidence.get("page")
            if doc_id in known and isinstance(page, int):
                quote = evidence.get("quote", "")
                box = _quote_box(doc_id, page - 1, quote) if quote else evidence.get("bbox")
                add(check["rule"], doc_id, page - 1, box, quote)
            rule = evidence.get("rule")
            if doc_id == pid and rule:
                for finding in combined.get("findings", []):
                    index = finding.get("page")
                    if finding.get("rule") == rule and isinstance(index, int) and 0 <= index < len(source_pages):
                        source_id, source_index = source_pages[index]
                        add(check["rule"], source_id, source_index, finding.get("bbox"))
            if doc_id in known:
                for index in evidence.get("pages", []):
                    add(check["rule"], doc_id, index - 1)
    for citation in args.get("citations", []):
        doc_id, page = citation.get("documentId"), citation.get("page")
        if doc_id in known and isinstance(page, int):
            quote = citation.get("quote", "")
            add(citation["rule"], doc_id, page - 1, _quote_box(doc_id, page - 1, quote), quote)
    # Сначала точные области; ссылка без координат не должна скрывать найденную рамку.
    for entries in locations.values():
        entries.sort(key=lambda item: item["bbox"] is None)
    return {"locations": locations}
