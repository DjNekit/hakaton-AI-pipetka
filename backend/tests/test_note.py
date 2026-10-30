"""Состав пояснительной записки (TXT-02, TXT-03) на тексте реальной формы."""
import unittest
from types import SimpleNamespace

from colorpass.checks import Context, check_note_content, check_note_description

FULL = (
    "III. АРХИТЕКТУРНО-ГРАДОСТРОИТЕЛЬНАЯ ХАРАКТЕРИСТИКА ОБЪЕКТА 1. Текстовая часть, содержащая информацию об архитектурной "
    "стилистике объекта, пластике фасада, форме здания в плане, колористике, наличии архитектурных деталей на фасаде и пр. "
    "(подтверждается материалами фотофиксации) Объектом проектирования является кирпичный 1-этажный магазин, построенный "
    "в 1988 году. Здание прямоугольное в плане. На фасадах присутствуют витринные окна и входная группа с колоннами. "
    "Существующая колористика фасадов здания - светло-серого, зеленого цветов. 2. Существующее состояние фасадов объекта "
    "(материал, колористика): 2.1. Кровля: рулонная; 2.2. Стены: металлокассеты серого цвета; 2.3. Ограждение балконов "
    "и лоджий: нет; 2.4. Оконные блоки (переплет): ПВХ белого цвета; 2.5. Дверные блоки: металл; 2.6. Цоколь: плитка; "
    "2.7. Лестницы: тротуарная плитка; 2.8. Архитектурные детали: нет; 2.9. Иные поверхности: металлокассеты красного цвета."
)


def ctx_for(text):
    return Context(None, SimpleNamespace(note_text=text, note_pages=[6]))


class NoteTest(unittest.TestCase):
    def test_complete(self):
        self.assertEqual(check_note_content(ctx_for(FULL)).findings, [])
        self.assertEqual(check_note_description(ctx_for(FULL)).findings, [])

    def test_empty_and_missing_items(self):
        text = FULL.replace("2.6. Цоколь: плитка;", "2.6. Цоколь: ;").replace("2.7. Лестницы: тротуарная плитка;", "")
        found = {f.element: f.message for f in check_note_content(ctx_for(text)).findings}
        self.assertEqual(set(found), {"2.6", "2.7"})
        self.assertIn("не заполнено", found["2.6"])

    def test_template_only(self):
        a = FULL.index("Объектом")
        b = FULL.index("2. Существующее")
        r = check_note_description(ctx_for(FULL[:a] + FULL[b:]))
        self.assertEqual(len(r.findings), 1)
        self.assertEqual(r.findings[0].severity, "error")

    def test_thin_description(self):
        text = FULL.replace("Здание прямоугольное в плане. ", "")
        r = check_note_description(ctx_for(text))
        self.assertEqual(r.findings[0].severity, "warning")
        self.assertIn("форма здания в плане", r.findings[0].message)


if __name__ == "__main__":
    unittest.main()
