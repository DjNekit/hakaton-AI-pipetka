"""ЛЛМ-часть без сети: поддельный клиент вместо GigaChat API, данные — реальный паспорт № 19/04406."""
import json
import tempfile
import unittest
from pathlib import Path

from colorpass.extract import build_passport
from colorpass.ingest import Document
from colorpass.llm import LLMClient, LLMConfig, parse_json
from colorpass.llm_tasks import llm_mentions
from colorpass.pipeline import run_check

PDF = Path(__file__).resolve().parents[2] / "dataset" / "real" / "moskvakadastr_pasport_19-04406.pdf"
CONCLUSION = "Паспорт требует доработки. 1. В штампе листа «IV. Фасады объекта» не указан автор проекта."


class FakeLLM(LLMClient):
    """Имитирует доступный сервер: на разбор записки отдаёт заданные упоминания, на заключение — готовый текст."""

    def __init__(self, mentions: list[dict]):
        super().__init__(LLMConfig(base_url="http://fake/v1", model="fake-model"))
        self.mentions = mentions

    def status(self) -> dict:
        return {"enabled": True, "available": True, "model": "fake-model", "base_url": "http://fake/v1"}

    def chat(self, system, user, schema=None, max_tokens=2000):
        self.calls.append({"json": schema is not None})
        if schema is None:
            return CONCLUSION
        return json.dumps({"mentions": self.mentions}, ensure_ascii=False)


@unittest.skipUnless(PDF.exists(), "реальный паспорт не скачан (см. dataset/real/README.md)")
class LlmTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with Document(PDF) as doc:
            cls.rows = build_passport(doc).finish_rows

    def test_mentions_validated_against_note(self):
        # номера реальной формы («2.1.2») и защита от выдуманных кодов
        note = "2.1.2. Стены: кирпич неокрашенный, цвет S 1030-Y30R (RAL 1002)."
        fake = FakeLLM([
            {"element_n": "2.1.2 Стены", "ral": ["1002", "7016"], "ncs": ["S 1030-Y30R"], "quote": note},
            {"element_n": "9.9", "ral": ["1002"], "ncs": [], "quote": ""},
        ])
        out = llm_mentions(fake, note, self.rows)
        self.assertEqual(len(out), 1)
        self.assertEqual(out[0].elements, ["2.1.2"])
        self.assertEqual(out[0].ral, ["1002"])
        self.assertEqual(out[0].ncs, ["S 1030-Y30R"])

    def test_pipeline_with_llm(self):
        # в записке реального паспорта нет кодов — всё, что «нашла» модель, отбрасывается; заключение — от модели
        fake = FakeLLM([{"element_n": "2.1", "ral": ["7035"], "ncs": [], "quote": "стены серые"}])
        with tempfile.TemporaryDirectory() as tmp:
            report = run_check(PDF, tmp, use_llm=True, llm=fake, write_images=False)
        self.assertTrue(report["llm"]["used"])
        self.assertEqual(report["passport"]["note_mentions"], [])
        self.assertEqual(report["conclusion"]["source"], "llm")
        self.assertEqual(report["conclusion"]["text"], CONCLUSION)
        self.assertEqual(report["verdict"], "fail")

    def test_parse_json_fenced(self):
        self.assertEqual(parse_json('```json\n{"a": 1}\n```'), {"a": 1})
        self.assertEqual(parse_json('Ответ: {"a": 2} конец'), {"a": 2})


if __name__ == "__main__":
    unittest.main()
