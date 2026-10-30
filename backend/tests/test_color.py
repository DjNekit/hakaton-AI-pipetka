"""Цветовая математика и справочники (запуск: python -m pytest или python -m unittest)."""
import unittest

import numpy as np

from colorpass.color import delta_e2000, lab_to_srgb, srgb_to_lab
from colorpass.palettes import ncs_to_lab, parse_color_spec, ral_lookup, ral_table, validate_ncs


class DeltaE2000Test(unittest.TestCase):
    # Эталонные пары Sharma, Wu, Dalal (2005)
    PAIRS = [
        ((50, 2.6772, -79.7751), (50, 0, -82.7485), 2.0425),
        ((50, 3.1571, -77.2803), (50, 0, -82.7485), 2.8615),
        ((50, -1.3802, -84.2814), (50, 0, -82.7485), 1.0000),
        ((50, 0, 0), (50, -1, 2), 2.3669),
        ((50, 2.49, -0.001), (50, -2.49, 0.0009), 7.1792),
        ((50, 2.5, 0), (73, 25, -18), 27.1492),
        ((50, 2.5, 0), (56, -27, -3), 31.9030),
    ]

    def test_sharma_pairs(self):
        for a, b, expected in self.PAIRS:
            self.assertAlmostEqual(delta_e2000(a, b), expected, places=3)

    def test_vectorized(self):
        a = np.array([p[0] for p in self.PAIRS], dtype=float)
        b = np.array([p[1] for p in self.PAIRS], dtype=float)
        np.testing.assert_allclose(delta_e2000(a, b), [p[2] for p in self.PAIRS], atol=1e-3)

    def test_roundtrip(self):
        rgb = np.array([[12, 200, 99], [255, 255, 255], [0, 0, 0], [234, 222, 189]], dtype=float)
        np.testing.assert_allclose(lab_to_srgb(srgb_to_lab(rgb)), rgb, atol=0.01)


class PalettesTest(unittest.TestCase):
    def test_ral_table(self):
        self.assertGreater(len(ral_table()), 200)
        self.assertEqual(ral_lookup("9010").hex, "#FFFFFF")
        self.assertIsNone(ral_lookup("8099"))

    def test_parse_codes(self):
        s = parse_color_spec("NCS S 1020-Y10R; RAL 1015")
        self.assertEqual(s.ral, ["1015"])
        self.assertEqual([n.notation for n in s.ncs], ["S 1020-Y10R"])
        s = parse_color_spec("РАЛ 7016 / NCS 7502-B")
        self.assertEqual(s.ral, ["7016"])
        self.assertEqual([n.notation for n in s.ncs], ["S 7502-B"])
        self.assertTrue(parse_color_spec("без цветового кода").empty)

    def test_ncs_validation(self):
        self.assertEqual(validate_ncs(10, 20, "Y10R"), [])
        self.assertTrue(validate_ncs(60, 50, "Y90R"))  # сумма > 100
        self.assertTrue(validate_ncs(20, 30, "Y90G"))  # после Y идёт R
        self.assertTrue(validate_ncs(5, 10, "N"))  # N только при хроматичности 00
        self.assertEqual(validate_ncs(5, 0, "N"), [])

    def test_ncs_approximation_close_to_ral(self):
        # Типовые пары из реальных паспортов должны быть «похожи» (порог TAB-04 = 20)
        for ncs, ral in (("S 7502-B", "7016"), ("S 0500-N", "9010"), ("S 1505-Y20R", "1013")):
            n = parse_color_spec(ncs).ncs[0]
            self.assertLess(delta_e2000(ncs_to_lab(n), ral_lookup(ral).lab), 20, (ncs, ral))


if __name__ == "__main__":
    unittest.main()
