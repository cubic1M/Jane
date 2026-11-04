"""Pot-splitting rules (engine/showdown.py) and their use in the SNG table payout."""
import random
import unittest

from engine.cards import parse_cards
from engine.evaluator import get_evaluator
from engine.showdown import best_low, part_keys, share, share_keys, split, split_boards, wild_high
from engine.spec import GameSpec

HL = GameSpec(name="hl", showdown="hilo8")
OHL = GameSpec(name="ohl", showdown="hilo8", hole_cards=4, hole_usage="exactly", hole_exact=2, betting="pot_limit")
DB = GameSpec(name="db", showdown="double_board", board_cards_per_street=(0, 6, 2, 2))
WD = GameSpec(name="wd", showdown="wild2")


class TestShowdown(unittest.TestCase):
    def test_hilo_split_and_scoop(self):
        ev = get_evaluator(HL)
        board = parse_cards("2c 5d 7h Kd Ks")
        holes = {0: parse_cards("Ah 3s"), 1: parse_cards("Kh Qc"), 2: parse_cards("9c 9d")}
        self.assertEqual(split(HL, ev, holes, board, [0, 1, 2]), [(0.5, [1]), (0.5, [0])])
        self.assertEqual(best_low(HL, holes[0], board), (7, 5, 3, 2, 1))
        board2 = parse_cards("9s Td Jh Kd 2s")                 # no low possible: high (the straight) scoops
        self.assertEqual(split(HL, ev, holes, board2, [0, 1, 2]), [(1.0, [1])])
        self.assertIsNone(best_low(HL, holes[2], board))       # 9-9 + 2-5-7: no five distinct <= 8

    def test_omaha_low_uses_exactly_two_hole_cards(self):
        board = parse_cards("2c 3d 4h Kd Ks")
        self.assertIsNone(best_low(OHL, parse_cards("Ah Kc Qs Jd"), board))      # only one low hole card
        self.assertEqual(best_low(OHL, parse_cards("Ah 5c Qs Jd"), board), (5, 4, 3, 2, 1))

    def test_double_board(self):
        board = parse_cards("2c 3c 4c 9h 9d 9s 5c Td 6c Jd")
        a, b = split_boards(DB, board)
        self.assertEqual(a, parse_cards("2c 3c 4c 5c 6c"))
        self.assertEqual(b, parse_cards("9h 9d 9s Td Jd"))
        ev = get_evaluator(DB)
        holes = {0: parse_cards("7h 8h"), 1: parse_cards("9c Ah")}   # 1: quads on board B, nothing on A
        parts = split(DB, ev, holes, board, [0, 1])
        self.assertEqual(parts[1], (0.5, [1]))
        self.assertAlmostEqual(share(DB, ev, holes, board, 1, [0, 1]) + share(DB, ev, holes, board, 0, [0, 1]), 1.0)

    def test_share_keys_matches_split(self):
        """The builder's fast path gives the same shares as split() on random deals."""
        rng = random.Random(3)
        for spec in (HL, OHL, DB, WD):
            ev = get_evaluator(spec)
            for _ in range(150):
                deck = list(spec.deck)
                rng.shuffle(deck)
                h = spec.hole_cards
                holes = {j: tuple(deck[j * h:(j + 1) * h]) for j in range(4)}
                board = deck[4 * h:4 * h + spec.total_board_dealt]
                fr, pk = part_keys(spec, ev, holes, board, range(4))
                for elig in ([0, 1], [0, 1, 2, 3], [1, 3]):
                    tot = 0.0
                    for me in elig:
                        a = share_keys(fr, pk, me, elig)
                        self.assertAlmostEqual(a, share(spec, ev, holes, board, me, elig), msg=spec.name)
                        tot += a
                    self.assertAlmostEqual(tot, 1.0)

    def test_sng_table_conserves_chips_on_split_pots(self):
        from sng.presets import PRESETS
        from sng.registry import make
        from sng.rules import SngRules
        from sng.table import play_table
        for name in ("holdem_hilo8", "omaha_hilo8", "double_board", "holdem_wild2"):
            r = SngRules(enforce_time=False, spec=PRESETS[name]["spec"])
            bots = [make(b) for b in ("icm_any", "icm_any", "chen_tag", "station", "lag", "nit", "random", "maniac")]
            res = play_table(bots, r, seed=11)
            self.assertEqual(sum(res.final_stacks), 8 * r.spec.starting_stack, name)
            self.assertEqual(sum(s.errors + s.illegal for s in res.stats), 0, name)

    def test_wild_deuces_match_brute_force(self):
        """1-2 wilds: the substitution shortcut equals trying all 52 cards for every wild."""
        from itertools import product
        ev = get_evaluator(WD)
        self.assertEqual(ev.category(wild_high(WD, ev, parse_cards("2c 2d"), parse_cards("Ah As 7d 9c Jh"))), "quads")
        self.assertEqual(ev.category(wild_high(WD, ev, parse_cards("2c Ah"), parse_cards("Kh Qh Jh 3d 4s"))),
                         "straight_flush")
        rng = random.Random(5)
        deck = list(WD.deck)
        n = 0
        while n < 60:
            rng.shuffle(deck)
            hole, board = deck[:2], deck[2:7]
            cards = hole + board
            wpos = [i for i, c in enumerate(cards) if c >> 2 == 0]
            if not 1 <= len(wpos) <= 2:
                continue
            n += 1
            real = [c for i, c in enumerate(cards) if i not in wpos]
            best = 0
            for sub in product(range(52), repeat=len(wpos)):
                if len(set(sub)) < len(sub) or set(real) & set(sub):
                    continue
                row = cards[:]
                for i, c in zip(wpos, sub):
                    row[i] = c
                best = max(best, ev.evaluate(row[:2], row[2:]))
            self.assertEqual(wild_high(WD, ev, hole, board), best)

    def test_unknown_rule_rejected(self):
        with self.assertRaises(ValueError):
            GameSpec(name="x", showdown="lowball27")
        with self.assertRaises(ValueError):
            GameSpec(name="x", showdown="double_board")          # odd street sizes (3, 1, 1)


if __name__ == "__main__":
    unittest.main()
