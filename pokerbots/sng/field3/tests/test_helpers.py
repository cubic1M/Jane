"""Unit tests of the shared field-3 helpers."""
import unittest

import numpy as np

from engine.cards import parse_cards
from sng.field3.icm_fast import IcmCurve, my_icm
from sng.field3.postflop import board_category, hand_info, mc_equity
from sng.field3.preflop import chen, get_preflop
from sng.field3.pushfold import call_outcomes
from sng.icm import icm
from sng.rules import SngRules
from engine.evaluator import get_evaluator

R = SngRules()


class TestPreflop(unittest.TestCase):
    def test_chen(self):
        c = parse_cards
        self.assertEqual(chen(*c("AsAd")), 20)
        self.assertEqual(chen(*c("KsKd")), 16)
        self.assertEqual(chen(*c("AsKs")), 12)
        self.assertEqual(chen(*c("7c2d")), -1)
        self.assertEqual(chen(*c("2c2d")), 5)

    def test_table_order_and_equity(self):
        t = get_preflop(R.spec)
        aa, kk, ako, s72 = (parse_cards(h) for h in ("AsAd", "KcKh", "AhKd", "7c2d"))
        self.assertLess(t.pct(aa), 0.01)
        self.assertLess(t.pct(aa), t.pct(kk))
        self.assertLess(t.pct(ako), 0.10)
        self.assertGreater(t.pct(s72), 0.9)
        self.assertAlmostEqual(t.eq_vs_top(aa, 1.0), 0.85, delta=0.02)
        self.assertGreater(t.eq_vs_top(kk, 0.2), t.eq_vs_top(kk, 0.02))


class TestIcm(unittest.TestCase):
    def test_matches_reference(self):
        st = [3000, 2500, 2000, 1800, 1500, 1200, 1000, 1000]
        ref = icm(st, R.payouts)
        for i in range(8):
            self.assertAlmostEqual(my_icm(st[i], st[:i] + st[i + 1:], R.payouts), ref[i], places=9)

    def test_curve_endpoints_and_monotone(self):
        c = IcmCurve(2000, [2000] * 7, R.payouts)
        self.assertEqual(c(0), R.payouts[7])
        self.assertAlmostEqual(c(16000), R.payouts[0])
        self.assertAlmostEqual(c(2000), sum(R.payouts) / 8, places=6)
        xs = np.linspace(0, 16000, 50)
        ys = [c(x) for x in xs]
        self.assertTrue(all(b >= a for a, b in zip(ys, ys[1:])))


class TestPostflop(unittest.TestCase):
    ev = get_evaluator(R.spec)

    def test_levels(self):
        c = parse_cards
        self.assertEqual(hand_info(c("AsAd"), c("Kc7d2h"), self.ev, R.spec).level, 3)   # overpair
        self.assertEqual(hand_info(c("7s7d"), c("Kc7c2h"), self.ev, R.spec).level, 5)   # set
        self.assertEqual(hand_info(c("KsJd"), c("Kc7d2h"), self.ev, R.spec).level, 3)   # top pair, good kicker
        self.assertEqual(hand_info(c("Ks9d"), c("Kc7d2h"), self.ev, R.spec).level, 2)   # top pair, weak kicker
        self.assertEqual(hand_info(c("Ks4d"), c("Kc7d2h"), self.ev, R.spec).level, 2)
        self.assertEqual(hand_info(c("3s4d"), c("Kc7d2h"), self.ev, R.spec).level, 0)
        hi = hand_info(c("AhTh"), c("Kh7h2c"), self.ev, R.spec)
        self.assertTrue(hi.flush_draw)
        self.assertEqual(board_category(c("KcKd7h7s2c"), R.spec), "two_pair")

    def test_mc_equity(self):
        rng = np.random.default_rng(0)
        e = mc_equity(parse_cards("AsAd"), (), 1, 2000, rng, R.spec, self.ev)
        self.assertAlmostEqual(e, 0.85, delta=0.03)
        e3 = mc_equity(parse_cards("AsAd"), (), 3, 2000, rng, R.spec, self.ev)
        self.assertLess(e3, e)


class TestPushfoldAccounting(unittest.TestCase):
    def test_call_outcomes_match_engine(self):
        from sng.table import Hand
        from engine.game import Call, Fold, RaiseTo

        rules = SngRules(num_players=3, payouts=(50, 30, 20), enforce_time=False)
        deck = [0, 1, 51, 50] + [c for c in range(52) if c not in (0, 1, 51, 50)]   # seat 1 holds AA
        h = Hand(rules, [1000, 3000, 2000], button=0, hand_number=0, deck=deck)
        seen = {}

        def decide(j, obs, lg):
            if j == 0:
                return RaiseTo(lg.max_raise_to)     # button jams 1000
            if j == 1:
                seen["out"] = call_outcomes(obs, 0)
                return Call()
            return Fold()
        h.play(decide, 3)
        win, lose, fold = seen["out"]
        self.assertEqual(fold, 3000 - 10)
        self.assertEqual(lose, 3000 - 1000)
        self.assertEqual(win, 3000 + 1000 + 20)     # my 3000 + his 1000 + BB's dead 20
        self.assertEqual(h.stack[1], win)


if __name__ == "__main__":
    unittest.main()
