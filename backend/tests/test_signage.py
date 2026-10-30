"""Дизайн-проекты вывесок (902-ПП): официальные образцы mos.ru и правила на заполненных значениях."""
import unittest
from datetime import date
from pathlib import Path

from colorpass.ingest import Document
from colorpass.signage import SignContext, SignRow, SignageProject, build_signage, clean_text, is_signage, run_signage_checks

SIGNS = Path(__file__).resolve().parents[2] / "dataset" / "signs"
TC = SIGNS / "DP_TC_OBRAZEC_2021.pdf"


def project(**kw) -> SignageProject:
    base = dict(
        pages={0: ["sg_title"], 1: ["sg_note"], 2: ["sg_photo"], 3: ["sg_drawing", "sg_explication"], 4: ["sg_montage"]},
        texts={0: "", 1: "", 2: "", 3: "ВЫВЕСКА 1.1 ВЫВЕСКА 1.2 М 1:100", 4: "ВЫВЕСКА 1.1 1.2"},
        address="г. Москва, ул. Учебная, д. 12", customer="ООО «Ромашка»", object_name="магазин", year_built="1975",
        note_text=("Адрес: г. Москва, ул. Учебная, д. 12, здание 1975 года постройки. Настенная вывеска из объемных букв "
                   "размещается над входом на фризе, крепление анкерное. Освещение — внутренняя подсветка. "
                   "Размеры 6000х500х100 мм."),
        note_pages=[1], note_is_template=False, rows=[], scales={3: ["1:100"]}, scale_hint_pages=[],
        photo_dates={2: ["01.10.2026"]}, doc_date="15.10.2026",
        stamp_values={"Адрес": [(3, "г. Москва, ул. Учебная, д. 12")], "Заказчик": [(3, "ООО «Ромашка»")], "Объект": []},
    )
    base.update(kw)
    return SignageProject(**base)


def row(n, sign_type, length, height, width=100, kind="Объемные буквы с внутренним подсветом на подложке", offset=None):
    return SignRow(n=n, page=3, sign_type=sign_type, kind_text=kind, dims_raw=f"{length}х{height}х{width}",
                   length=length, height=height, width=width, offset=offset, pages=[3])


def findings(p: SignageProject, today=date(2026, 10, 28)) -> dict:
    out = {}
    for r in run_signage_checks(SignContext(None, p, today=today)):
        for f in r.findings:
            out.setdefault(r.rule, []).append(f)
    return out


class SignRulesTest(unittest.TestCase):
    def test_filled_project_passes(self):
        p = project(rows=[row("1.1", "настенная", 6000, 500), row("1.2", "консольная", 600, 600, 150, offset=700)])
        got = {k: v for k, v in findings(p).items() if k != "SGN-11"}
        self.assertEqual(got, {}, {k: [f.message for f in v] for k, v in got.items()})

    def test_sizes(self):
        p = project(rows=[row("1.1", "настенная", 16000, 600), row("1.2", "консольная", 600, 1200, 300, offset=1100),
                          row("1.3", "витринная", 2000, 450, kind="буквы на стекле")])
        msgs = [f.message for f in findings(p)["SGN-05"]]
        self.assertTrue(any("1.1" in m and "длина 16000" in m for m in msgs), msgs)
        self.assertTrue(any("1.1" in m and "высота 600" in m for m in msgs), msgs)
        self.assertEqual(sum("1.2" in m for m in msgs), 3)  # высота, ширина, вынос консоли
        self.assertTrue(any("1.3" in m and "400" in m for m in msgs), msgs)

    def test_volume_letters_without_backing(self):
        p = project(rows=[row("1.1", "настенная", 6000, 700, kind="Объемные буквы без подложки")])
        f = findings(p)["SGN-05"][0]
        self.assertEqual(f.severity, "warning")  # до 750 мм допустимо, если основной шрифт ≤ 500 мм

    def test_forbidden_and_old_photos(self):
        p = project(rows=[row("1.1", "настенная", 6000, 500, kind="Неоновая вывеска с мигающими элементами")],
                    photo_dates={2: ["01.05.2026"]})
        got = findings(p)
        self.assertEqual(len(got["SGN-06"]), 2)
        self.assertIn("старше", got["SGN-08"][0].message)

    def test_template_note_and_missing_parts(self):
        p = project(note_is_template=True, pages={0: ["sg_title"], 1: ["sg_note"], 3: ["sg_drawing"]}, rows=[],
                    scales={}, scale_hint_pages=[3])
        got = findings(p)
        self.assertIn("SGN-02", got)
        self.assertEqual(len(got["SGN-01"]), 3)  # нет фотофиксации, фотомонтажа, экспликации
        self.assertIn("подсказка образца", got["SGN-03"][0].message)

    def test_clean_text(self):
        self.assertEqual(clean_text("О\nВВЫЫВВЕЕССККАА 11..11\nЦ"), "ВЫВЕСКА 1.1")


@unittest.skipUnless(TC.exists(), "образцы mos.ru не скачаны (dataset/signs)")
class SignTemplatesTest(unittest.TestCase):
    def test_tc_template(self):
        with Document(TC) as doc:
            self.assertTrue(is_signage(doc))
            p = build_signage(doc)
        self.assertEqual(p.address, "г. Москва, Нагатинский бульвар, д.6А")
        self.assertTrue(p.note_is_template)
        self.assertEqual(p.scales.get(4), ["1:100"])
        self.assertIn("1.1", [r.n for r in p.rows])
        self.assertTrue(all(not r.dims_given for r in p.rows))

    def test_passport_is_not_signage(self):
        pdf = SIGNS.parent / "real" / "moskvakadastr_pasport_19-04406.pdf"
        if pdf.exists():
            with Document(pdf) as doc:
                self.assertFalse(is_signage(doc))


if __name__ == "__main__":
    unittest.main()
