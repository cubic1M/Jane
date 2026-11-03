import itertools
import unittest

from tests import helpers  # noqa: F401
from engine.icm import icm
from engine.rules import POINTS


def brute(stacks, pay):
    """Enumerate every finishing order (Malmuth-Harville)."""
    n = len(stacks)
    eq = [0.0] * n
    for perm in itertools.permutations(range(n)):
        p, left = 1.0, sum(stacks)
        for i in perm:
            p *= stacks[i] / left
            left -= stacks[i]
        for place, i in enumerate(perm):
            eq[i] += p * pay[place]
    return eq


class IcmTest(unittest.TestCase):
    def test_equal_stacks_split_evenly(self):
        eq = icm([2000] * 8, POINTS)
        for e in eq:
            self.assertAlmostEqual(e, sum(POINTS) / 8)

    def test_heads_up(self):
        a, b = icm([3000, 1000], [100, 65])
        self.assertAlmostEqual(a, 0.75 * 100 + 0.25 * 65)
        self.assertAlmostEqual(b, 0.25 * 100 + 0.75 * 65)

    def test_matches_brute_force(self):
        stacks = [5000, 3000, 1500, 700, 300]
        for x, y in zip(icm(stacks, POINTS[:5]), brute(stacks, POINTS[:5])):
            self.assertAlmostEqual(x, y)

    def test_sum_and_order(self):
        stacks = [4000, 2500, 2500, 1200, 900, 500, 300, 100]
        eq = icm(stacks, POINTS)
        self.assertAlmostEqual(sum(eq), sum(POINTS))
        self.assertEqual(eq, sorted(eq, reverse=True))
        self.assertAlmostEqual(eq[1], eq[2])
        self.assertLess(eq[0], POINTS[0])     # chip leader does not get 1st's 100

    def test_single_player(self):
        self.assertEqual(icm([777], [100]), [100])


if __name__ == "__main__":
    unittest.main()
