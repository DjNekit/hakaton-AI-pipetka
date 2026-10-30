"""Регрессия на реальном паспорте (скан с OCR-слоем). PDF в git не хранится — см. dataset/real/README.md."""
import json
import tempfile
import unittest
from pathlib import Path

from colorpass.evaluate import match
from colorpass.extract import build_passport
from colorpass.ingest import Document
from colorpass.llm import LLMClient, LLMConfig
from colorpass.pipeline import run_check

REAL = Path(__file__).resolve().parents[2] / "dataset" / "real"
PDF = REAL / "moskvakadastr_pasport_19-04406.pdf"


@unittest.skipUnless(PDF.exists(), "реальный паспорт не скачан (см. dataset/real/README.md)")
class RealPassportTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.expected = json.loads((REAL / "moskvakadastr_pasport_19-04406.expected.json").read_text(encoding="utf-8"))
        with Document(PDF) as doc:
            cls.passport = build_passport(doc)
        with tempfile.TemporaryDirectory() as tmp:
            cls.report = run_check(PDF, tmp, use_llm=False, write_images=False)

    def test_structure(self):
        present = {k for kinds in self.passport.pages.values() for k in kinds}
        self.assertTrue({"title", "general", "urban", "arch", "photo", "facade", "finish_table"} <= present)
        self.assertEqual(self.passport.title.get("Номер"), "19/04406")
        self.assertEqual(self.passport.title.get("Дата"), "16.10.2019")

    def test_finish_table_codes(self):
        coded = [r for r in self.passport.finish_rows if not r.marks.empty]
        got_ncs = [tuple(n.notation for n in r.marks.ncs) for r in coded]
        got_ral = [tuple(r.marks.ral) for r in coded]
        expected = list(self.expected["expected_codes"].values())
        hits = 0
        for ncs, ral in expected:
            ncs, ral = (ncs.replace("NCS ", ""),), (ral.replace("RAL ", ""),)
            hits += sum(1 for n, r in zip(got_ncs, got_ral) if n == ncs and r == ral) > 0
        # все пары кодов распознаются и без tesseract — «починкой» OCR-слоя PDF и подбором RAL по цвету
        need = len(expected)
        self.assertGreaterEqual(hits, need, (got_ncs, got_ral))

    def test_findings(self):
        m = match(self.report, self.expected)
        self.assertTrue(all(d["found"] for d in m["defects"]), m)
        errors = [f for f in self.report["findings"] if f["severity"] == "error"]
        self.assertEqual([f["rule"] for f in errors], ["GRF-01"])
        warnings = {f["rule"] for f in self.report["findings"] if f["severity"] == "warning"}
        self.assertIn("DRW-02", warnings)
        self.assertTrue(warnings <= {"DRW-02", "TAB-01", "TAB-05"}, warnings)

    def test_report_files_and_unavailable_llm(self):
        # ЛЛМ недоступна → проверка проходит на правилах, заключение по шаблону, листы с разметкой сохранены
        dead = LLMClient(LLMConfig(base_url="http://127.0.0.1:9/v1", timeout=1), auth_key="")
        with tempfile.TemporaryDirectory() as tmp:
            report = run_check(PDF, tmp, use_llm=True, llm=dead)
            self.assertTrue((Path(tmp) / "report.json").exists())
            self.assertTrue((Path(tmp) / "pages" / "p01.png").exists())
            self.assertTrue(any(p.get("annotated") for p in report["pages"]))
        self.assertFalse(report["llm"]["used"])
        self.assertEqual(report["conclusion"]["source"], "template")
        self.assertEqual(report["verdict"], "fail")


if __name__ == "__main__":
    unittest.main()
