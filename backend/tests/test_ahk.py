"""Улицы с утверждёнными архитектурно-художественными концепциями (АХК)."""
import unittest

from colorpass.ahk import find_ahk, street_of


class AhkTest(unittest.TestCase):
    def test_address_forms(self):
        for addr in ("Маршала Бирюзова ул., д. 20, корп. 1", "г. Москва, ул. Маршала Бирюзова, д. 20"):
            hit = find_ahk(addr)
            self.assertIsNotNone(hit, addr)
            self.assertEqual(hit.stage, "4")

    def test_abbreviations_and_rings(self):
        self.assertEqual(find_ahk("Москва, ул. Большая Ордынка, д. 5").street, "Ордынка Б. ул.")
        self.assertEqual(find_ahk("г. Москва, Ленинский проспект, 1").street, "Ленинский пр-т")
        self.assertIsNotNone(find_ahk("Тверской бульвар, д. 10"))  # Бульварное кольцо

    def test_not_listed(self):
        self.assertIsNone(find_ahk("г. Москва, ул. Учебная, д. 12"))
        self.assertIsNone(find_ahk(None))
        self.assertEqual(street_of("г. Москва, Нагатинский бульвар, д.6А"), "Нагатинский бульвар")


if __name__ == "__main__":
    unittest.main()
