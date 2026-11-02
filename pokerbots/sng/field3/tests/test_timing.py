"""Decision time: every bot but the deliberately slow one has p99 < 0.5 ms; the slow
one goes over 1 ms on a good share of decisions. Measured as CPU time of act() so a
loaded machine does not make the test flaky (wall time is checked loosely)."""
import os
import unittest

import numpy as np

from sng.field3.registry import BOTS
from sng.field3.tests.helpers import Timed, all_bots
from sng.rules import SngRules
from sng.table import play_table


def run(tables=3, rules=None):
    rules = rules or SngRules(enforce_time=False)
    recs = {n: [] for n in BOTS}
    for t in range(tables):
        names, bots = all_bots(rotate=t)
        timed = [Timed(b) for b in bots]
        play_table(timed, rules, seed=500 + t)
        for n, tb in zip(names, timed):
            recs[n].append(tb)
    return recs


@unittest.skipIf(os.environ.get("SNG_SKIP_TIMING"), "timing skipped")
class TestTiming(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.recs = run()

    def test_fast_bots_p99_under_half_ms(self):
        for n, tbs in self.recs.items():
            if n == "f3_mc_slow":
                continue
            cpu = np.concatenate([t.cpu for t in tbs])
            self.assertGreater(len(cpu), 100, n)
            p99 = np.percentile(cpu, 99) * 1e3
            self.assertLess(p99, 0.5, f"{n} p99 cpu {p99:.3f} ms")

    def test_slow_bot_is_slow_multiway(self):
        tbs = self.recs["f3_mc_slow"]
        cpu = np.concatenate([t.cpu for t in tbs])
        opps = np.concatenate([t.opps for t in tbs])
        multi = cpu[opps >= 4]
        self.assertGreater(len(multi), 20)
        self.assertGreater(np.mean(multi > 0.001), 0.5)

    def test_wall_time_loose(self):
        for n, tbs in self.recs.items():
            if n == "f3_mc_slow":
                continue
            wall = np.concatenate([t.wall for t in tbs])
            self.assertLess(np.percentile(wall, 90) * 1e3, 1.0, n)


if __name__ == "__main__":
    unittest.main()
