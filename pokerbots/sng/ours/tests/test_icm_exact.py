import itertools
import os
import random
import time
import unittest

from sng.ours.icm_exact import allin_call_need, value


def harville_brute(stacks, pays):
    """Expected points of player 0 by enumerating every finishing order (Harville)."""
    n = len(stacks)
    pays = list(pays) + [0.0] * n
    total = 0.0
    for order in itertools.permutations(range(n)):
        p, left = 1.0, sum(stacks)
        for i in order:
            p *= stacks[i] / left
            left -= stacks[i]
        total += p * pays[order.index(0)]
    return total


class TestIcmExact(unittest.TestCase):
    def test_matches_brute_force(self):
        rng = random.Random(3)
        for _ in range(60):
            n = rng.randint(1, 6)
            st = [rng.randint(1, 5000) for _ in range(n)]
            pays = sorted((rng.randint(0, 100) for _ in range(n)), reverse=True)
            self.assertAlmostEqual(value(st[0], st[1:], pays), harville_brute(st, pays), places=9)

    def test_edge_cases(self):
        self.assertEqual(value(0, [100, 200], (50, 30, 20)), 20)      # busted: last remaining place
        self.assertEqual(value(500, [], (50, 30)), 50)               # alone: 1st
        self.assertAlmostEqual(value(100, [100], (100, 0)), 50)      # winner-take-all = chip share

    def test_chip_ev_case_is_pot_odds(self):
        # heads-up, winner-take-all, no dead money: break-even 50%
        self.assertAlmostEqual(allin_call_need(1000, 0, 1, [None, 1000], [0, 1000], (100, 0)), 0.5)
        # with dead money (my 20 blind in, their 1000 shove): chip pot odds = 980 / 2000
        need = allin_call_need(1000, 20, 1, [None, 1000], [20, 1000], (100, 0))
        self.assertAlmostEqual(need, 980 / 2000, places=9)

    def test_icm_needs_more_than_chip_ev_on_a_bubble(self):
        # 4 left, 3 paid: calling off my stack needs more than pot odds
        pays = (50, 30, 20, 0)
        need = allin_call_need(2000, 0, 1, [None, 4000, 1000, 1000], [0, 2000, 0, 0], pays)
        self.assertGreater(need, 0.5)

    def test_fast(self):
        if os.environ.get("SNG_SKIP_TIMING"):
            return
        pays = (100, 65, 45, 30, 20, 12, 6, 0)
        tot = [None, 2000, 3500, 1200, 800, 4000, 2500, 900]
        com = [0, 0, 3500, 10, 20, 0, 0, 0]
        import gc
        allin_call_need(1100, 20, 2, tot, com, pays)               # mask tables built
        ts = []
        gc.disable()                                               # measure the code, not a GC pause
        try:
            for _ in range(300):
                t = time.perf_counter()
                allin_call_need(1100, 20, 2, tot, com, pays)
                ts.append(time.perf_counter() - t)
        finally:
            gc.enable()
        ts.sort()
        self.assertLess(ts[len(ts) // 2], 0.2e-3)                   # typical 8-handed decision
        self.assertLess(ts[int(0.95 * len(ts))], 0.5e-3)            # a scheduler tick may hit p99


class TestIcmCallInBot(unittest.TestCase):
    def test_on_by_default(self):
        from sng.ours.icm_tag import PARAMS
        self.assertEqual(PARAMS["icm_call"], 1)                     # validated on fresh seeds

    def test_bubble_fold_that_pot_odds_would_call(self):
        """4 left, 3 paid, medium stack facing a big stack's shove: pot odds say call with a
        hand near 50%, ICM says fold."""
        from sng.ours.icm_tag import IcmTag
        from sng.rules import SngRules
        from sng.table import SeatView
        r = SngRules(enforce_time=False, num_players=4, payouts=(50, 30, 20, 0))
        b = IcmTag()
        b.new_table(r, 1, 0)
        need = b._icm_need(type("O", (), dict(
            seat=1, my_stack=2000, seats=(SeatView(0, 0, 4000, 4000, False, True, True),
                                          SeatView(1, 2000, 0, 0, False, False, True),
                                          SeatView(2, 1000, 0, 0, True, False, True),
                                          SeatView(3, 1000, 0, 0, True, False, True))))(), 0)
        self.assertGreater(need, 0.55)

    def test_bot_with_icm_call_is_legal_and_fast(self):
        from sng.registry import make
        from sng.rules import SngRules
        from sng.table import play_table
        for seed in range(3):
            r = SngRules(enforce_time=False, max_hands=120)
            bots = [make("icm_tag:icm_call=1")] + [make(x) for x in ("push", "maniac", "station", "push",
                                                                      "lag", "nit", "random")]
            res = play_table(bots, r, seed=seed)
            st = res.stats[0]
            self.assertEqual(st.errors + st.illegal, 0, st.first_error)
            if not os.environ.get("SNG_SKIP_TIMING"):
                ts = sorted(st.times)
                self.assertLess(ts[int(0.99 * len(ts))], 0.5e-3)


if __name__ == "__main__":
    unittest.main()
