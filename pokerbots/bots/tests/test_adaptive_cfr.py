import unittest

from bots.adaptive_cfr import AdaptiveCFRBot
from bots.dummies import make_bot as make_dummy
from engine.conformance import check_bot
from engine.match import play_match
from engine.variants import VARIANTS


class TestAdaptiveCFR(unittest.TestCase):
    def test_legal_on_two_variants(self):
        specs = [VARIANTS["a_nlhe100"], VARIANTS["c_discard3"]]
        self.assertEqual(check_bot(lambda: AdaptiveCFRBot(budget="1m"), specs=specs, hands=30,
                                   verbose=False), [])

    def test_gate_closed_at_start_and_opens_vs_pusher(self):
        bot = AdaptiveCFRBot(budget="1m")
        bot.new_match(VARIANTS["a_nlhe100"], 1)
        self.assertFalse(bot.using_fallback)
        self.assertFalse(bot.preflop_gate_open())
        play_match(bot, make_dummy(kind="push"), VARIANTS["a_nlhe100"], deal_seed=3, hands=300)
        self.assertTrue(bot.preflop_gate_open())
        self.assertGreater(bot.exploit_preflop, 0)

    def test_missing_policy_is_adaptive(self):
        bot = AdaptiveCFRBot(budget="no_such_budget")
        bot.new_match(VARIANTS["a_nlhe100"], 1)
        self.assertTrue(bot.using_fallback)


if __name__ == "__main__":
    unittest.main()
