import os
import random
import unittest

import helpers
from engine.loader import load_factory
from engine.table import Table

BOTS = os.path.join(helpers.KIT, "bots")


class ChaosBot:
    """Random, often illegal, actions to stress the engine."""

    def __init__(self, seed):
        self.r = random.Random(seed)

    def on_discard_request(self, state):
        return self.r.choice(state["hole_cards"] + [99, 1, "x"])

    def on_action_request(self, state):
        return self.r.choice(["f", "c", "c", "r 0", "r 1", "r 2.25", "r 3", "r 7.5", "r 40",
                              "r 999", "k", "r -2", None, " C ", "r .5"])


class ChipConservationTests(unittest.TestCase):
    def _run(self, entrants, seed, hands=200):
        t = Table(entrants, seed=seed, max_hands=hands, enforce_time=False)
        total = t.starting_total
        t._setup()
        while t.hand_no < t.max_hands and len(t.alive_seats()) > 1:
            t.play_hand()
            self.assertEqual(sum(s.stack for s in t.seats), total)
            self.assertTrue(all(s.stack >= 0 for s in t.seats))
            for s in t.seats:
                if not s.alive:
                    self.assertEqual(s.stack, 0)
        res = t._finish()
        self.assertAlmostEqual(sum(p["points"] for p in res["players"]),
                               sum(t.points_table[:len(entrants)]), places=9)
        return res

    def test_chaos_tables(self):
        for seed in range(25):
            n = 2 + seed % 7
            entrants = [("chaos%d" % i, (lambda i=i: ChaosBot(seed * 100 + i))) for i in range(n)]
            self._run(entrants, seed)

    def test_sample_bot_tables(self):
        names = ["calling_station", "tight_aggressive", "random_raiser", "template_bot"]
        facs = {n: load_factory(os.path.join(BOTS, n + ".py")) for n in names}
        for seed in range(6):
            entrants = [(names[i % 4], facs[names[i % 4]]) for i in range(8)]
            res = self._run(entrants, 1000 + seed)
            self.assertAlmostEqual(sum(p["points"] for p in res["players"]), 22.0, places=9)


if __name__ == "__main__":
    unittest.main()
