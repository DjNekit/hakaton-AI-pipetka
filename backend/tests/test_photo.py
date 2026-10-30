"""Сравнение фото с развёрткой на реальном паспорте № 19/04406 (фото фотофиксации ↔ развёртки проекта)."""
import json
import unittest
from pathlib import Path

from colorpass.evaluate import _pages_for, evaluate_photos
from colorpass.llm import LLMClient, LLMConfig
from colorpass.llm_tasks import llm_photo_review
from colorpass.photo import compare, find_blocks, passport_blocks, png_b64, suggest_quad

REAL = Path(__file__).resolve().parents[2] / "dataset" / "real"
PDF = REAL / "moskvakadastr_pasport_19-04406.pdf"


class FakeVision(LLMClient):
    def __init__(self, answer: dict):
        super().__init__(LLMConfig(base_url="http://fake/v1", model="fake-vlm"))
        self.answer = answer
        self.images = None

    def chat(self, system, user, schema=None, max_tokens=2000, images=None):
        self.images = images
        return json.dumps(self.answer, ensure_ascii=False)


@unittest.skipUnless(PDF.exists(), "реальный паспорт не скачан (см. dataset/real/README.md)")
class PhotoTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.blocks = {b.id: (b, img) for b, img in passport_blocks(PDF, _pages_for(PDF))}

    def quad(self, block_id, page_quad):
        """Углы в пикселях листа → в пикселях вырезанного фото."""
        x0, y0 = self.blocks[block_id][0].box[:2]
        return [[x - x0, y - y0] for x, y in page_quad]

    def test_blocks(self):
        facades = [b for b, _ in self.blocks.values() if b.kind == "facade"]
        photos = [b for b, _ in self.blocks.values() if b.kind == "photo"]
        self.assertEqual(len(facades), 5)  # пять развёрток на одном листе, водяной знак не мешает
        self.assertGreaterEqual(len(photos), 8)

    def test_frieze_mismatch(self):
        drawing = self.blocks["p12-b1"][1]
        photo = self.blocks["p9-b1"][1]
        res, imgs = compare(drawing, photo, self.quad("p9-b1", [[316, 389], [1105, 387], [1105, 655], [316, 695]]), (0, 0, 0.333, 1))
        self.assertEqual(res.verdict, "mismatch")
        notes = " ".join(d.note for d in res.differences)
        self.assertIn("красный", notes)
        self.assertIn("зелёный", notes)
        self.assertEqual(imgs["diff_overlay"].shape, imgs["drawing"].shape)

    def test_labelled_cases(self):
        result = evaluate_photos(REAL)
        self.assertGreaterEqual(result["accuracy"], 0.95, result["cases"])

    def test_model_cannot_flip_verdict(self):
        drawing = self.blocks["p12-b1"][1]
        photo = self.blocks["p10-b2"][1]
        res, imgs = compare(drawing, photo, self.quad("p10-b2", [[322, 946], [612, 946], [612, 1026], [322, 1026]]), (0.7193, 0.1311, 0.7817, 0.3607))
        self.assertEqual(res.verdict, "match")
        fake = FakeVision({"same_facade": True, "differences": [
            {"category": "навесное оборудование", "description": "кондиционер на стене", "where": "справа"},
            {"category": "что-то своё", "description": "трещина", "where": ""}], "summary": "Есть кондиционер."})
        review = llm_photo_review(fake, [png_b64(imgs["drawing"]), png_b64(imgs["photo_warped"])], res.to_dict())
        self.assertEqual(len(fake.images), 2)
        self.assertEqual(review["differences"][1]["category"], "другое")  # категории — только из закрытого списка

    def test_suggest_corners(self):
        quad, info = suggest_quad(self.blocks["p9-b1"][1])  # фасад «Пятёрочки»: верх — граница фриза с небом
        self.assertTrue(info["confident"])
        self.assertLess(abs(quad[0][1] - 84), 15)
        _, info = suggest_quad(self.blocks["p6-b1"][1])  # улица без явного фасада — честно отказывается
        self.assertFalse(info["confident"])

    def test_find_blocks_ignores_thin_lines(self):
        import numpy as np

        img = np.full((400, 600, 3), 255, np.uint8)
        img[50:150, 40:300] = (180, 190, 185)  # развёртка
        for i in range(0, 600, 3):  # диагональный «водяной знак» тонкой линией
            img[min(399, i * 2 // 3), i] = 0
        self.assertEqual(len(find_blocks(img)), 1)


if __name__ == "__main__":
    unittest.main()
