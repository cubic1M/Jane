import unittest

from tests import helpers  # noqa: F401  (path setup)
from engine.cards import (DECK, FLUSH, FULL_HOUSE, STRAIGHT, STRAIGHT_FLUSH,
                          THREE_OF_A_KIND, TWO_PAIR, FOUR_OF_A_KIND, evaluate, hand_name)


def ev(s):
    return evaluate(s.split())


class DeckTest(unittest.TestCase):
    def test_36_cards_six_to_ace(self):
        self.assertEqual(len(DECK), 36)
        self.assertEqual(len(set(DECK)), 36)
        self.assertFalse(any(c[0] in "2345" for c in DECK))
        self.assertEqual({c[0] for c in DECK}, set("6789TJQKA"))
        self.assertEqual({c[1] for c in DECK}, set("cdhs"))


class RankingTest(unittest.TestCase):
    def test_flush_beats_full_house(self):
        flush = ev("Ah Jh 9h 7h 6h Kc Kd")
        boat = ev("Ks Kc Kd 7s 7d 6c 8c")
        self.assertEqual(flush[0], FLUSH)
        self.assertEqual(boat[0], FULL_HOUSE)
        self.assertGreater(flush, boat)

    def test_three_of_a_kind_beats_straight(self):
        trips = ev("6c 6d 6h Ks Qd")
        straight = ev("Tc Jd Qh Ks Ad")
        self.assertEqual(trips[0], THREE_OF_A_KIND)
        self.assertEqual(straight[0], STRAIGHT)
        self.assertGreater(trips, straight)

    def test_seven_cards_prefer_trips_over_straight(self):
        self.assertEqual(ev("9c 9d 9h Ts Jd Qc Kh")[0], THREE_OF_A_KIND)

    def test_seven_cards_prefer_flush_over_trips(self):
        self.assertEqual(ev("Ah Ad Ac Kh Qh 9h 7h")[0], FLUSH)

    def test_a6789_is_the_lowest_straight(self):
        low = ev("Ac 6d 7h 8s 9d")
        self.assertEqual(low, (STRAIGHT, 9))
        self.assertGreater(ev("6c 7d 8h 9s Td"), low)
        self.assertGreater(low, ev("Ac Ad Kh Ks 9d"))         # beats two pair

    def test_a6789_straight_flush(self):
        self.assertEqual(ev("Ah 6h 7h 8h 9h Kd Kc"), (STRAIGHT_FLUSH, 9))
        self.assertGreater(ev("Th Jh Qh Kh Ah"), ev("Ah 6h 7h 8h 9h"))

    def test_quads_beat_flush(self):
        self.assertEqual(ev("7c 7d 7h 7s Ah")[0], FOUR_OF_A_KIND)
        self.assertGreater(ev("7c 7d 7h 7s Ah"), ev("Ah Kh Qh Jh 9h"))

    def test_two_trips_make_full_house(self):
        self.assertEqual(ev("8c 8d 8h 6c 6d 6h Ac"), (FULL_HOUSE, 8, 6))

    def test_kickers(self):
        self.assertEqual(ev("Ac Ad Kh Ks Qd Qc 9h"), (TWO_PAIR, 14, 13, 12))
        self.assertGreater(ev("Ac Ad Kh 9s 8d"), ev("Ac Ad Qh Js Td"))
        self.assertEqual(ev("Ac Ad Kh 9s 8d"), ev("Ah As Kd 9c 8h"))

    def test_hand_name(self):
        self.assertEqual(hand_name(ev("Ah Jh 9h 7h 6h")), "flush")


if __name__ == "__main__":
    unittest.main()
