import unittest

import helpers  # noqa: F401  (sets sys.path)
from cards import (
    FLUSH, FOUR_OF_A_KIND, FULL_DECK, FULL_HOUSE, STRAIGHT, STRAIGHT_FLUSH,
    THREE_OF_A_KIND, TWO_PAIR, evaluate, parse_card,
)


class CardTests(unittest.TestCase):
    def test_deck_is_36_unique_cards_six_to_ace(self):
        self.assertEqual(len(FULL_DECK), 36)
        self.assertEqual(len(set(FULL_DECK)), 36)
        self.assertNotIn("5h", FULL_DECK)
        self.assertIn("Th", FULL_DECK)
        self.assertIn("6c", FULL_DECK)

    def test_parse_rejects_bad_spellings(self):
        for bad in ("10h", "2c", "5s", "TH", "th", "A", ""):
            with self.assertRaises(ValueError):
                parse_card(bad)
        self.assertEqual(parse_card("Td"), (10, "d"))

    def test_flush_beats_full_house(self):
        flush = evaluate(["6h", "8h", "Th", "Qh", "7h"])
        boat = evaluate(["As", "Ad", "Ac", "Ks", "Kd"])
        self.assertEqual(flush[0], FLUSH)
        self.assertEqual(boat[0], FULL_HOUSE)
        self.assertGreater(flush, boat)

    def test_three_of_a_kind_beats_straight(self):
        trips = evaluate(["6s", "6d", "6c", "8s", "9d"])
        straight = evaluate(["Ts", "Jd", "Qc", "Ks", "Ad"])
        self.assertEqual(trips[0], THREE_OF_A_KIND)
        self.assertEqual(straight[0], STRAIGHT)
        self.assertGreater(trips, straight)

    def test_ace_six_seven_eight_nine_is_lowest_straight(self):
        wheel = evaluate(["As", "6d", "7c", "8s", "9h"])
        six_high_missing = evaluate(["6s", "7d", "8c", "9s", "Th"])
        self.assertEqual(wheel, (STRAIGHT, 9))
        self.assertLess(wheel, six_high_missing)
        sf = evaluate(["Ah", "6h", "7h", "8h", "9h"])
        self.assertEqual(sf, (STRAIGHT_FLUSH, 9))

    def test_order_of_top_categories(self):
        quads = evaluate(["9s", "9d", "9c", "9h", "6d"])
        flush = evaluate(["Ah", "Kh", "Qh", "Jh", "9h"])
        self.assertEqual(quads[0], FOUR_OF_A_KIND)
        self.assertGreater(quads, flush)
        self.assertGreater(evaluate(["Th", "Jh", "Qh", "Kh", "Ah"]), quads)

    def test_best_of_seven_prefers_three_of_a_kind_over_straight(self):
        score = evaluate(["6s", "6d", "6c", "7h", "8d", "9s", "Tc"])
        self.assertEqual(score[0], THREE_OF_A_KIND)
        self.assertEqual(score[1], 6)

    def test_kickers_and_two_pair(self):
        a = evaluate(["Ks", "Kd", "Qc", "Qs", "9h"])
        b = evaluate(["Ks", "Kd", "Qc", "Qs", "8h"])
        self.assertEqual(a[0], TWO_PAIR)
        self.assertGreater(a, b)

    def test_evaluate_validates(self):
        with self.assertRaises(ValueError):
            evaluate(["As", "As", "Kd", "Qd", "Jd"])
        with self.assertRaises(ValueError):
            evaluate(["As", "Kd", "Qd", "Jd"])


if __name__ == "__main__":
    unittest.main()
