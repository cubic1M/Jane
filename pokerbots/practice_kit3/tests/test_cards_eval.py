import unittest

import helpers  # noqa: F401
from engine.cards import card_str, parse_card, rank_of, suit_of
from engine.evaluator import evaluate, hand_name
from engine.cards import parse_cards


def ev(s):
    return evaluate(parse_cards(s))


class CardTests(unittest.TestCase):
    def test_mapping(self):
        self.assertEqual(parse_card("2s"), 0)
        self.assertEqual(parse_card("As"), 12)
        self.assertEqual(parse_card("2h"), 13)
        self.assertEqual(parse_card("Ah"), 25)
        self.assertEqual(parse_card("2d"), 26)
        self.assertEqual(parse_card("2c"), 39)
        self.assertEqual(parse_card("Ac"), 51)
        self.assertEqual(card_str(8), "Ts")
        for c in range(52):
            self.assertEqual(parse_card(card_str(c)), c)
            self.assertEqual(c, suit_of(c) * 13 + rank_of(c))


class EvaluatorTests(unittest.TestCase):
    def test_category_order(self):
        hands = [
            "2s 4h 6d 8c Ts Qh 3d",      # high card
            "2s 2h 6d 8c Ts Qh 3d",      # pair
            "2s 2h 6d 6c Ts Qh 3d",      # two pair
            "2s 2h 2d 6c Ts Qh 3d",      # trips
            "As 2h 3d 4c 5s Qh 9d",      # wheel straight
            "2s 7s 9s Js Ks Qh 3d",      # flush
            "2s 2h 2d 6c 6s Qh 3d",      # full house
            "2s 2h 2d 2c Ts Qh 3d",      # quads
            "9h Th Jh Qh Kh 2s 3d",      # straight flush
        ]
        vals = [ev(h) for h in hands]
        self.assertEqual([v[0] for v in vals], list(range(9)))
        self.assertEqual(vals, sorted(vals))

    def test_details(self):
        self.assertEqual(ev("As 2h 3d 4c 5s Qh 9d"), (4, 3))
        self.assertGreater(ev("2s 3h 4d 5c 6s Qh 9d"), ev("As 2h 3d 4c 5s Qh 9d"))
        self.assertEqual(ev("As 2s 3s 4s 5s Ah Ad")[0], 8)
        # two trips -> full house using the second trips as the pair
        self.assertEqual(ev("Ks Kh Kd 9s 9h 9d 2c"), (6, 11, 7))
        # three pairs -> best two + best kicker
        self.assertEqual(ev("Ks Kh 9d 9s 4h 4d Ac"), (2, 11, 7, 12))
        self.assertEqual(ev("Ks Kh 9d 9s 4h 4d 2c"), (2, 11, 7, 2))
        self.assertEqual(ev("Ts Js Qs Ks As 9s 8s"), (8, 12))
        self.assertEqual(hand_name(ev("Ts Js Qs Ks As 9s 8s")), "Royal Flush")
        self.assertEqual(hand_name(ev("Ks Kh 9d 9s 4h 4d 2c")), "Two Pair, Kings and Nines")

    def test_kickers(self):
        self.assertGreater(ev("As Ah Kd 7c 5s 3h 2d"), ev("As Ah Qd 7c 5s 3h 2d"))
        self.assertEqual(ev("As Ah Kd 7c 5s 3h 2d"), ev("Ac Ad Kh 7s 5d 3s 2h"))


if __name__ == "__main__":
    unittest.main()
