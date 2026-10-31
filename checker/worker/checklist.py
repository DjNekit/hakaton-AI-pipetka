"""Пункты исходного Excel и доказательства из всего пакета; решения принимает код."""
from __future__ import annotations

import re

from colorpass.checks import load_rules


def review_package(docs: list[dict], service_type: str | None = None,
                   combined: dict | None = None) -> list[dict]:
    config = load_rules()
    catalog = config["package_checklists"]
    done = [d for d in docs if d.get("state") == "done"]
    kinds = {d["report"].get("document_kind") for d in done}
    profiles = [service_type] if service_type else [k for k in ("passport", "signage", "facade") if k in kinds]
    sections = list(dict.fromkeys(section for profile in profiles
                                  for section in catalog["profiles"][profile]))
    if not profiles:
        sections = ["intake"]
    checks = []
    for section in sections:
        for source in catalog["sections"][section]:
            item = {"rule": source["id"], "section": section, "title": source["title"],
                    "requirement": source["requirement"], "ref": source["ref"],
                    "source": {"file": catalog["source"], "sha256": catalog["sha256"],
                               "sheet": catalog["sheet"], "range": source["source_range"]},
                    "status": "warn", "verdict": "unknown", "evidence": [],
                    "note": "Недостаточно данных для автоматического решения. Требуется проверка инспектором."}
            spec = config.get("package_evidence", {}).get(source["id"], {})
            rules = spec.get("rules", [])
            matched = []
            for d in ([combined] if combined and rules else done):
                report = d["report"]
                if rules and section in ("passport", "signage") and report.get("document_kind") != section:
                    continue
                for check in report.get("checklist", []):
                    if check["rule"] not in rules:
                        continue
                    matched.append(check)
                    findings = [f for f in report.get("findings", []) if f.get("rule") == check["rule"]]
                    item["evidence"].append({"document_id": d["doc_id"], "file": d["file"],
                                             "rule": check["rule"], "status": check["status"],
                                             "pages": sorted({f["page"] + 1 for f in findings if isinstance(f.get("page"), int)}),
                                             "note": check.get("note", "")})
                    for finding in findings:
                        page = finding.get("page")
                        if isinstance(page, int) and 0 <= page < len(d.get("source_pages", [])):
                            item["evidence"].append({**d["source_pages"][page],
                                                     "note": finding.get("message", finding.get("title", ""))})
                for page in report.get("page_texts", []):
                    for pattern in spec.get("patterns", []):
                        match = re.search(pattern, page["text"], re.I)
                        if match:
                            item["evidence"].append({"document_id": d["doc_id"], "file": d["file"],
                                                     "page": page["page"],
                                                     "quote": page["text"][max(0, match.start() - 60):match.end() + 120]})
                            break
            if any(c["status"] == "fail" for c in matched):
                item.update(status="fail", verdict="violation",
                            note="Выявлены нарушения формализованных требований. См. доказательства и отчёт документа.")
            elif matched or item["evidence"]:
                item["note"] = "Найдены частичные подтверждения. Полное соответствие пункту требует проверки инспектором."
            if spec.get("missing_data"):
                item["missing_data"] = spec["missing_data"]
                item["note"] += " Необходимо: " + "; ".join(spec["missing_data"]) + "."
            checks.append(item)
    return checks
