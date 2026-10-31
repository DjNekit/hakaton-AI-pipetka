"""Импорт пунктов Excel в rules.yaml; настройки проверок остаются в YAML."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
import sys
import xml.etree.ElementTree as ET
import zipfile


def main() -> None:
    source = Path(sys.argv[1])
    target = Path(__file__).resolve().parents[1] / "checker/colorpass/data/rules.yaml"
    ns = {"s": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
    with zipfile.ZipFile(source) as archive:
        strings = ["".join(si.itertext()) for si in ET.fromstring(
            archive.read("xl/sharedStrings.xml")).findall("s:si", ns)]
        root = ET.fromstring(archive.read("xl/worksheets/sheet1.xml"))
        book = ET.fromstring(archive.read("xl/workbook.xml"))
        sheet = book.find("s:sheets/s:sheet", ns).get("name")
        rows = {}
        for row in root.findall(".//s:row", ns):
            values = {}
            for cell in row.findall("s:c", ns):
                value = cell.find("s:v", ns)
                column = "".join(c for c in cell.attrib["r"] if c.isalpha())
                values[column] = (
                    strings[int(value.text)] if cell.get("t") == "s" and value is not None
                    else "".join(cell.itertext()))
            rows[int(row.attrib["r"])] = values
    sections = {"intake": (24, 29), "special": (33, 34),
                "passport": (47, 60), "signage": (65, 78), "facade": (82, 111)}
    data = {"source": source.name, "sha256": hashlib.sha256(source.read_bytes()).hexdigest(),
            "sheet": sheet, "sections": {}}
    for name, (start, end) in sections.items():
        data["sections"][name] = [
            {"id": f"{name}-{i - start + 1}", "title": rows[i].get("C", "").strip(),
             "requirement": rows[i].get("D", "").strip(), "ref": rows[i].get("E", "").strip(),
             "source_range": f"C{i}:F{i}",
             "options": [s.strip() for s in rows[i].get("F", "").split("□") if s.strip()]}
            for i in range(start, end + 1)]
    content = target.read_text(encoding="utf-8")
    original = content.split("\npackage_checklists:", 1)[0]
    settings = "\npackage_evidence:" + content.split("\npackage_evidence:", 1)[1] if "\npackage_evidence:" in content else ""
    # JSON — подмножество YAML; исходные тексты сохраняются без переформулировок.
    target.write_text(original.rstrip() + "\n\npackage_checklists:\n  " +
                      json.dumps(data, ensure_ascii=False) + "\n" + settings, encoding="utf-8")


if __name__ == "__main__":
    main()
