"""Every field-3 bot stays legal (no exceptions, no illegal actions) on several card
games, 8-bot tables conserve chips, and discard phases are answered.
    python3 -m unittest discover -s sng/field3/tests -t .
"""
import unittest
from types import SimpleNamespace

from engine.game import DISCARD, RAISE
from engine.variants import D_OMAHA4X2, E_SHORTDECK
from sng.field3.registry import BOTS, FIELDS, make
from sng.field3.tests.helpers import all_bots
from sng.rules import NLHE, SngRules
from sng.table import Legal, play_table

VARIANTS = {
    "nlhe": SngRules(enforce_time=False),
    "pot_limit": SngRules(spec=NLHE.with_(name="sng_plhe", betting="pot_limit"), enforce_time=False),
    "short_deck": SngRules(spec=E_SHORTDECK.with_(stack_reset_per_hand=False), enforce_time=False,
                           max_hands=120),
    "omaha": SngRules(spec=D_OMAHA4X2.with_(stack_reset_per_hand=False), enforce_time=False,
                      max_hands=50),
}


def check_table(tc, rules, bots, seed):
    res = play_table(bots, rules, seed=seed)
    for b, st in zip(bots, res.stats):
        tc.assertEqual(st.errors, 0, f"{b.name}: {st.first_error}")
        tc.assertEqual(st.illegal, 0, f"{b.name}: {st.first_error}")
    tc.assertEqual(sum(res.final_stacks), rules.num_players * rules.starting_stack)
    tc.assertAlmostEqual(sum(res.points), sum(rules.payouts[:rules.num_players]), places=6)
    return res


class TestLegality(unittest.TestCase):
    def _variant(self, key, tables):
        rules = VARIANTS[key]
        for t in range(tables):
            _, bots = all_bots(rotate=t)
            check_table(self, rules, bots, seed=1000 + t)

    def test_nlhe(self):
        self._variant("nlhe", 4)

    def test_pot_limit(self):
        self._variant("pot_limit", 3)

    def test_short_deck(self):
        self._variant("short_deck", 2)

    def test_omaha(self):
        self._variant("omaha", 1)

    def test_field_mix_tables_conserve_chips(self):
        import random
        rng = random.Random(5)
        names, w = zip(*FIELDS["field3"])
        rules = SngRules()          # timing enforced, as on the day
        for t in range(4):
            lineup = rng.choices(names, weights=w, k=8)
            check_table(self, rules, [make(n) for n in lineup], seed=77 + t)

    def test_heads_up_and_short_stacks(self):
        # a two-seat table with a huge blind exercises all-in-for-less and heads-up order
        rules = SngRules(num_players=2, payouts=(100, 0), blinds=((400, 800),), enforce_time=False)
        names = list(BOTS)
        for i in range(len(names)):
            bots = [make(names[i]), make(names[(i + 3) % len(names)])]
            check_table(self, rules, bots, seed=i)


class TestDiscard(unittest.TestCase):
    def test_every_bot_discards_lowest_cards(self):
        hole = (51, 0, 30, 5)      # As, 2c, 9h, 3d
        legal = SimpleNamespace(discard_count=2, can_check=False, can_call=False, can_raise=False,
                                call_amount=0, min_raise_to=0, max_raise_to=0)
        obs = SimpleNamespace(legal=legal, hole=hole)
        rules = SngRules()
        for n in BOTS:
            b = make(n)
            b.new_table(rules, 0, 1)
            a = b.act(obs)
            self.assertEqual(a.kind, DISCARD, n)
            self.assertEqual(sorted(a.cards), [0, 5], n)


class TestBuggyMinRaises(unittest.TestCase):
    def test_non_allin_raises_are_min_raises(self):
        seen = []

        class Spy:
            def __init__(self, bot):
                self.bot, self.name = bot, bot.name

            def new_table(self, *a):
                self.bot.new_table(*a)

            def act(self, obs):
                a = self.bot.act(obs)
                if a.kind == RAISE:
                    seen.append((a.amount, obs.legal))
                return a

        _, bots = all_bots()
        names = list(BOTS)
        i = names.index("f3_buggy")
        bots[i] = Spy(bots[i])
        for t in range(3):
            play_table(bots, SngRules(enforce_time=False), seed=50 + t)
        self.assertTrue(seen)
        for amt, lg in seen:
            self.assertIn(amt, (lg.min_raise_to, lg.max_raise_to))


class TestSanitize(unittest.TestCase):
    def test_sanitize_makes_actions_legal(self):
        from engine.game import Call, Check, Fold, RaiseTo
        from sng.field3.common import sanitize
        lg = Legal(can_check=True, can_call=False, call_amount=0, can_raise=True,
                   min_raise_to=40, max_raise_to=500)
        self.assertEqual(sanitize(Fold(), lg).kind, "check")
        self.assertEqual(sanitize(RaiseTo(10_000), lg).amount, 500)
        self.assertEqual(sanitize(RaiseTo(3), lg).amount, 40)
        self.assertEqual(sanitize(Call(), lg).kind, "check")
        lg2 = Legal(can_check=False, can_call=True, call_amount=30, can_raise=False,
                    min_raise_to=0, max_raise_to=0)
        self.assertEqual(sanitize(RaiseTo(100), lg2).kind, "call")
        self.assertEqual(sanitize(Check(), lg2).kind, "fold")
        self.assertEqual(sanitize(None, lg2).kind, "call")


if __name__ == "__main__":
    unittest.main()
