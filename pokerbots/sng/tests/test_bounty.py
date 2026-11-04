"""Knockout bounties: SngRules.bounty points go to the hand's biggest winner when a player busts;
the exact-ICM call counts the bounty when we cover the shover."""
import unittest

from sng.ours.icm_exact import allin_call_need
from sng.registry import make
from sng.rules import SngRules
from sng.table import play_table


class TestBounty(unittest.TestCase):
    def test_points_include_bounties(self):
        line = ["icm_tag", "maniac", "station", "random", "lag", "nit", "chen_tag", "push"]
        base = play_table([make(n) for n in line], SngRules(enforce_time=False), seed=21)
        bty = play_table([make(n) for n in line], SngRules(enforce_time=False, bounty=10.0), seed=21)
        self.assertEqual(base.final_stacks, bty.final_stacks)          # same play, same deals
        knockouts = sum(b is not None for b in base.bust_hand)
        self.assertGreater(knockouts, 0)
        self.assertAlmostEqual(sum(bty.points) - sum(base.points), 10.0 * knockouts)

    def test_call_need_drops_when_covering(self):
        pays = (100, 65, 45, 30, 20, 10, 5, 0)
        t = [None, 1500, 2000, 2000, 2000, 2000, 2000, 2000]
        c = [0, 1500, 0, 0, 0, 0, 20, 10]
        n0 = allin_call_need(2500, 0, 1, t, c, pays)
        n10 = allin_call_need(2500, 0, 1, t, c, pays, 10.0)
        self.assertLess(n10, n0 - 0.05)
        # when the shover covers me, a bounty cannot be won: no change
        t2 = [None, 3000] + t[2:]
        self.assertAlmostEqual(allin_call_need(2500, 0, 1, t2, c, pays, 10.0), allin_call_need(2500, 0, 1, t2, c, pays))


if __name__ == "__main__":
    unittest.main()
