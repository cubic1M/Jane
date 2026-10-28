import random
import unittest
from collections import Counter
from itertools import combinations

import numpy as np

from engine.cards import parse_cards, full_deck
from engine.evaluator import get_evaluator
from engine.spec import GameSpec, SHORT_DECK_ORDER
from engine.variants import VARIANTS


def ref5(cards, spec):
    """Independent slow 5-card reference: (category index, tiebreak tuple)."""
    ranks = sorted((c >> 2 for c in cards), reverse=True)
    suits = {c & 3 for c in cards}
    cnt = Counter(ranks)
    groups = sorted(cnt.items(), key=lambda kv: (kv[1], kv[0]), reverse=True)
    flush = len(suits) == 1
    deck_r = sorted(spec.deck_ranks)
    straight_top = None
    if len(cnt) == 5:
        if ranks[0] - ranks[4] == 4:
            straight_top = ranks[0]
        elif spec.ace_low_straight and set(ranks) == {12, *deck_r[:4]}:
            straight_top = deck_r[3]
    shape = tuple(g[1] for g in groups)
    if straight_top is not None and flush:
        cat, tb = "straight_flush", (straight_top,)
    elif shape == (4, 1):
        cat, tb = "quads", tuple(g[0] for g in groups)
    elif shape == (3, 2):
        cat, tb = "full_house", tuple(g[0] for g in groups)
    elif flush:
        cat, tb = "flush", tuple(ranks)
    elif straight_top is not None:
        cat, tb = "straight", (straight_top,)
    elif shape == (3, 1, 1):
        cat, tb = "trips", tuple(g[0] for g in groups)
    elif shape == (2, 2, 1):
        cat, tb = "two_pair", tuple(g[0] for g in groups)
    elif shape == (2, 1, 1, 1):
        cat, tb = "pair", tuple(g[0] for g in groups)
    else:
        cat, tb = "high_card", tuple(ranks)
    return (spec.category_order.index(cat), tb), cat


def ref_best(hole, board, spec):
    if spec.hole_usage == "any":
        pool = list(hole) + list(board)
        return max(ref5(c, spec) for c in combinations(pool, 5))
    k = spec.hole_exact
    return max(ref5(list(h) + list(b), spec)
               for h in combinations(hole, k) for b in combinations(board, 5 - k))


def sign(x):
    return (x > 0) - (x < 0)


STD = GameSpec("std")
SHORT = VARIANTS["e_shortdeck"]


class TestCategories(unittest.TestCase):
    def cat(self, hole, board, spec=STD):
        ev = get_evaluator(spec)
        return ev.category(ev.evaluate(parse_cards(hole), parse_cards(board)))

    def test_every_category_standard(self):
        cases = {
            "straight_flush": ("9h8h", "7h6h5h2c3d"),
            "quads": ("9h9d", "9s9c5h2c3d"),
            "full_house": ("9h9d", "9s5c5h2c3d"),
            "flush": ("Ah8h", "7h6h2h2c3d"),
            "straight": ("9h8d", "7s6c5h2c2d"),
            "trips": ("9h9d", "9sKc5h2c3d"),
            "two_pair": ("9h9d", "KsKc5h2c3d"),
            "pair": ("9h9d", "AsKc5h2c3d"),
            "high_card": ("Ah9d", "7sKc5h2c3d"),
        }
        for want, (h, b) in cases.items():
            self.assertEqual(self.cat(h, b), want, want)

    def test_wheel_and_broadway(self):
        ev = get_evaluator(STD)
        wheel = ev.evaluate(parse_cards("As2d"), parse_cards("3h4c5sKdQd"))
        six = ev.evaluate(parse_cards("6s2d"), parse_cards("3h4c5sKdQd"))
        bway = ev.evaluate(parse_cards("AsKd"), parse_cards("QhJcTs2d3d"))
        self.assertEqual(ev.category(wheel), "straight")
        self.assertLess(wheel, six)
        self.assertLess(six, bway)
        # no wrap-around straight Q-K-A-2-3
        self.assertNotEqual(self.cat("AsKd", "Qh2c3s8d9c"), "straight")
        steel = ev.evaluate(parse_cards("As2s"), parse_cards("3s4s5sKdQd"))
        self.assertEqual(ev.category(steel), "straight_flush")

    def test_ties_and_kickers(self):
        ev = get_evaluator(STD)
        board = parse_cards("AsAdKhKc2s")
        # board plays: both have AAKK + best kicker on board? kicker Q vs J decides
        a = ev.evaluate(parse_cards("Qd3c"), board)
        b = ev.evaluate(parse_cards("Jd3h"), board)
        self.assertGreater(a, b)
        # identical best five -> tie
        board = parse_cards("AsKdQhJcTs")
        self.assertEqual(ev.evaluate(parse_cards("2c3d"), board), ev.evaluate(parse_cards("4c5d"), board))
        # counterfeit: higher pair on board makes third pair irrelevant beyond kicker
        board = parse_cards("9s9dTsTdKc")
        self.assertEqual(ev.evaluate(parse_cards("3c3d"), board), ev.evaluate(parse_cards("4c4d"), board))
        # same flush different 5th card
        self.assertGreater(ev.evaluate(parse_cards("Kh2c"), parse_cards("Ah9h7h5h3h")),
                           ev.evaluate(parse_cards("Qh2c"), parse_cards("Ah9h7h5h3h")))
        # quads kicker
        self.assertGreater(ev.evaluate(parse_cards("Ac2c"), parse_cards("9s9d9h9cKs")),
                           ev.evaluate(parse_cards("Qc2d"), parse_cards("9s9d9h9cKs")))
        # two trips -> full house with the higher trips
        self.assertEqual(self.cat("9h9d", "9s5c5h5d3d"), "full_house")
        self.assertGreater(ev.evaluate(parse_cards("9h9d"), parse_cards("9s5c5h5d3d")),
                           ev.evaluate(parse_cards("8h8d"), parse_cards("8s5c5h5d3d")))

    def test_short_deck(self):
        self.assertEqual(SHORT.category_order, SHORT_DECK_ORDER)
        ev = get_evaluator(SHORT)
        flush = ev.evaluate(parse_cards("Ah8h"), parse_cards("7h6hTh9cJd"))
        boat = ev.evaluate(parse_cards("9h9d"), parse_cards("9s6c6hJcQd"))
        self.assertGreater(flush, boat)
        trips = ev.evaluate(parse_cards("9h9d"), parse_cards("9sKc6hJc7d"))
        straight = ev.evaluate(parse_cards("TsJd"), parse_cards("QcKhAs7c6d"))
        self.assertGreater(trips, straight)
        wheel = ev.evaluate(parse_cards("As6d"), parse_cards("7h8c9sKdQd"))
        self.assertEqual(ev.category(wheel), "straight")
        self.assertLess(wheel, ev.evaluate(parse_cards("Ts6d"), parse_cards("7h8c9sKdQd")))

    def test_omaha_exactly_two(self):
        sp = VARIANTS["d_omaha4x2"]
        ev = get_evaluator(sp)
        # four hearts in hand, one on board: no flush in Omaha
        s = ev.evaluate(parse_cards("AhKhQhJh"), parse_cards("2h7c8d9sTc"))
        self.assertNotEqual(ev.category(s), "flush")
        # four-flush on board with one heart in hand: no flush
        s = ev.evaluate(parse_cards("Ah2c3d4s"), parse_cards("Kh9h7h5hJc"))
        self.assertNotEqual(ev.category(s), "flush")
        s = ev.evaluate(parse_cards("Ah2h3d4s"), parse_cards("Kh9h7h5cJc"))
        self.assertEqual(ev.category(s), "flush")
        # board quads: Omaha player can use only three of them (AA + 999 = full house)
        s = ev.evaluate(parse_cards("AsAd2c3c"), parse_cards("9s9d9h9cQs"))
        self.assertEqual(ev.category(s), "full_house")


class TestAgainstReference(unittest.TestCase):
    def _random_check(self, spec, n_pairs, n_hole, n_board, seed):
        rng = random.Random(seed)
        ev = get_evaluator(spec)
        deck = full_deck(spec.deck_ranks)
        holes_a, holes_b, boards, refs = [], [], [], []
        for _ in range(n_pairs):
            cards = rng.sample(deck, 2 * n_hole + n_board)
            holes_a.append(cards[:n_hole])
            holes_b.append(cards[n_hole:2 * n_hole])
            boards.append(cards[2 * n_hole:])
        sa = ev.evaluate_batch(np.array(holes_a), np.array(boards))
        sb = ev.evaluate_batch(np.array(holes_b), np.array(boards))
        for i in range(n_pairs):
            ra, ca = ref_best(holes_a[i], boards[i], spec)
            rb, cb = ref_best(holes_b[i], boards[i], spec)
            self.assertEqual(ev.category(sa[i]), ca, (holes_a[i], boards[i]))
            self.assertEqual(sign(int(sa[i]) - int(sb[i])), sign((ra > rb) - (ra < rb)),
                             (holes_a[i], holes_b[i], boards[i]))

    def test_holdem_7(self):
        self._random_check(STD, 1500, 2, 5, 1)

    def test_five_and_six_cards(self):
        self._random_check(STD, 500, 2, 3, 2)
        self._random_check(STD, 500, 2, 4, 3)

    def test_nine_cards_discard_variant(self):
        self._random_check(VARIANTS["c_discard3"], 400, 2, 7, 4)

    def test_short_deck_random(self):
        self._random_check(SHORT, 1500, 2, 5, 5)

    def test_omaha_random(self):
        self._random_check(VARIANTS["d_omaha4x2"], 400, 4, 5, 6)

    def test_flush_heavy(self):
        # hands drawn from two suits to stress flush/straight-flush logic
        sp = GameSpec("twosuit")
        rng = random.Random(9)
        ev = get_evaluator(sp)
        deck = [c for c in full_deck() if c & 3 in (0, 1)]
        for _ in range(400):
            cards = rng.sample(deck, 9)
            a, b, board = cards[:2], cards[2:4], cards[4:]
            ra, _ = ref_best(a, board, sp)
            rb, _ = ref_best(b, board, sp)
            self.assertEqual(sign(ev.evaluate(a, board) - ev.evaluate(b, board)),
                             sign((ra > rb) - (ra < rb)))


if __name__ == "__main__":
    unittest.main()
