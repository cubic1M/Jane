import itertools
import unittest

from helpers import ScriptBot, stacked_deck, table
from engine.icm import icm_equities


def brute_force_icm(stacks, payouts):
    """Harville model by enumerating every finishing order."""
    n = len(stacks)
    pay = list(payouts[:n]) + [0] * (n - len(payouts))
    eq = [0.0] * n
    for perm in itertools.permutations(range(n)):
        p, remaining = 1.0, sum(stacks)
        for i in perm:
            p *= stacks[i] / remaining
            remaining -= stacks[i]
        for place, i in enumerate(perm):
            eq[i] += p * pay[place]
    return eq


class IcmTests(unittest.TestCase):
    def test_matches_brute_force(self):
        cases = [([5000, 3000, 2000], [12, 7, 4]),
                 ([8000, 5000, 2000, 1000], [12, 7, 4, 2]),
                 ([2000] * 8, [12, 7, 4, 2, 0, 0, 0, -3]),
                 ([9000, 3000, 1500, 1200, 800, 300, 150, 50], [12, 7, 4, 2, 0, 0, 0, -3]),
                 ([100, 900], [5])]
        for stacks, pay in cases:
            got = icm_equities(stacks, pay)
            want = brute_force_icm(stacks, pay)
            for g, w in zip(got, want):
                self.assertAlmostEqual(g, w, places=9)
            self.assertAlmostEqual(sum(got), sum(pay[:len(stacks)]), places=9)

    def test_equal_stacks_share_equally(self):
        self.assertEqual(icm_equities([1000, 1000], [12, 7]), [9.5, 9.5])
        eq = icm_equities([2000] * 8, [12, 7, 4, 2, 0, 0, 0, -3])
        for e in eq:
            self.assertAlmostEqual(e, 22 / 8)

    def test_negative_last_place_hurts_short_stack(self):
        eq = icm_equities([15000, 500, 500], [12, 7, -3])
        eq0 = icm_equities([15000, 500, 500], [12, 7, 0])
        self.assertLess(eq[1], eq0[1] - 1.0)
        self.assertGreater(eq[0], eq[1])


class PointsTests(unittest.TestCase):
    def test_cap_survivors_split_by_icm(self):
        # one hand, nobody busts: places 1..3 split by ICM of the final stacks
        bots = [ScriptBot(["r 3"]), ScriptBot(["c"]), ScriptBot(["f"])]
        t = table(bots, max_hands=1)
        res = t.run()
        stacks = [p["stack"] for p in res["players"]]
        want = icm_equities(stacks, [12, 7, 4])
        for p, w in zip(res["players"], want):
            self.assertAlmostEqual(p["points"], w)
            self.assertTrue(p["survived"])
            self.assertIsNone(p["place"])

    def test_simultaneous_busts_ordered_by_starting_stack(self):
        # p0 BTN (3000) shoves, p1 SB (500) and p2 BB (800) call and lose; p3 (2000) folds
        bots = [ScriptBot(["r 999"], "last"), ScriptBot(["c"], "last"), ScriptBot(["c"], "last"),
                ScriptBot(["f"], "last")]
        # postflop/deal order: p1, p2, p3, p0
        deck = stacked_deck("2s 7h 3c", "2h 8d 4c", "5s 6s 9c", "As Ah Kc", "Kd Qd Jc 4h 9s")
        t = table(bots, stacks=[3000, 500, 800, 2000], deck=deck, max_hands=5)
        t.run()
        p = {s.pid: s for s in t.seats}
        self.assertEqual(p["p2"].place, 3)   # bigger starting stack -> higher place
        self.assertEqual(p["p1"].place, 4)
        self.assertEqual(p["p2"].points, 4)
        self.assertEqual(p["p1"].points, 2)

    def test_equal_starting_stacks_share_places(self):
        bots = [ScriptBot(["r 999"], "last"), ScriptBot(["c"], "last"), ScriptBot(["c"], "last")]
        deck = stacked_deck("2s 7h 3c", "2h 8d 4c", "As Ah Kc", "Kd Qd Jc 4h 9s")
        t = table(bots, stacks=[3000, 500, 500], deck=deck, max_hands=5)
        t.run()
        self.assertEqual(t.seats[1].place, [2, 3])
        self.assertEqual(t.seats[1].points, (7 + 4) / 2)
        self.assertEqual(t.seats[2].points, (7 + 4) / 2)
        self.assertEqual(t.seats[0].points, 12)

    def test_eighth_place_is_negative(self):
        bots = [ScriptBot(["f"] * 400, "last") for _ in range(7)] + [ScriptBot(["r 999"] * 400, "last")]
        t = table(bots, max_hands=200)
        res = t.run()
        pts = sorted(p["points"] for p in res["players"])
        self.assertAlmostEqual(sum(pts), 22.0)
        self.assertLess(pts[0], 0)


if __name__ == "__main__":
    unittest.main()
