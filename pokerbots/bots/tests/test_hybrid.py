import unittest

from bots.hybrid import HybridBot
from bots.dummies import make_bot as make_dummy
from bots.balanced import BalancedBot
from engine.conformance import check_bot
from engine.match import play_match
from engine.variants import VARIANTS


class TestHybrid(unittest.TestCase):
    def test_legal(self):
        self.assertEqual(check_bot(lambda: HybridBot(budget="1m"), specs=[VARIANTS["a_nlhe100"], VARIANTS["g_pineapple"]],
                                   hands=30, verbose=False), [])

    def test_gate(self):
        h = HybridBot(budget="1m")
        play_match(h, make_dummy(kind="station"), VARIANTS["a_nlhe100"], deal_seed=2, hands=250)
        self.assertGreater(h.hands_adaptive, 100)          # exploits the station
        h = HybridBot(budget="1m")
        play_match(h, BalancedBot(), VARIANTS["a_nlhe100"], deal_seed=2, hands=250)
        self.assertEqual(h.hands_adaptive, 0)              # plays CFR vs a sound opponent

    def test_fallback_without_policy(self):
        h = HybridBot(budget="no_such_budget", verbose=False)
        h.new_match(VARIANTS["a_nlhe100"], 0)
        self.assertTrue(h.using_fallback)


if __name__ == "__main__":
    unittest.main()
