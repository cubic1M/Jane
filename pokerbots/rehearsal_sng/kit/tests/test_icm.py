import unittest

import helpers  # noqa: F401
from icm import finish_probabilities, icm_equity


class IcmTests(unittest.TestCase):
    def test_equal_stacks_split_equally(self):
        eq = icm_equity([1000, 1000, 1000, 1000], [100, 70, 50, 35])
        for e in eq:
            self.assertAlmostEqual(e, 255 / 4)

    def test_total_equity_equals_total_payout(self):
        eq = icm_equity([5200, 3100, 1700, 900, 300], [100, 70, 50, 35, 25])
        self.assertAlmostEqual(sum(eq), 280)

    def test_extra_payouts_ignored_and_missing_places_pay_zero(self):
        self.assertAlmostEqual(sum(icm_equity([10, 20], [100, 70, 50])), 170)
        self.assertAlmostEqual(sum(icm_equity([10, 20, 30], [100])), 100)

    def test_winner_take_all_is_chip_share(self):
        eq = icm_equity([50, 30, 20], [1, 0, 0])
        for e, s in zip(eq, [0.5, 0.3, 0.2]):
            self.assertAlmostEqual(e, s)

    def test_known_three_player_value(self):
        # P(first) = .5; P(second) = .3*50/70 + .2*50/80
        eq = icm_equity([50, 30, 20], [70, 30])
        expected0 = 0.5 * 70 + (0.3 * 50 / 70 + 0.2 * 50 / 80) * 30
        self.assertAlmostEqual(eq[0], expected0)

    def test_chip_leader_gets_less_than_chip_share(self):
        eq = icm_equity([8000, 1000, 1000], [100, 70, 50])
        self.assertLess(eq[0], 0.8 * 220)
        self.assertGreater(eq[0], eq[1])

    def test_probability_matrix_rows_and_columns_sum_to_one(self):
        p = finish_probabilities([400, 300, 200, 100, 0])
        for row in p:
            self.assertAlmostEqual(row.sum(), 1.0)
        for col in p.T:
            self.assertAlmostEqual(col.sum(), 1.0)
        self.assertAlmostEqual(p[4, 4], 1.0)  # zero stack finishes last

    def test_rejects_negative(self):
        with self.assertRaises(ValueError):
            icm_equity([10, -1], [1])


if __name__ == "__main__":
    unittest.main()
