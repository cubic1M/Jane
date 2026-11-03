"""Plan A bundle on practice kit 4: log parsing, replies, and an invariant run (our rebuilt
pot / bets / stacks must match the kit's view on every decision, 0 errors)."""
import glob
import os
import random
import sys
import unittest

KIT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, KIT)
from engine import rules                           # noqa: E402  (the kit's engine)
from engine.seats import BotFile, Controller, rules_dict   # noqa: E402
from engine.table import Table                     # noqa: E402

BUNDLE = os.path.join(KIT, "submission_planA.py")


class TestPlanA(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.bf = BotFile(BUNDLE, rules_dict())
        assert cls.bf.load_error is None, cls.bf.load_error
        cls.m = cls.bf.module

    def test_parse_log_readme_example(self):
        log = "4s10 5b20 6r50 7f 8f 1f 2c50 3f 4f 5c30 |7h8s9d 5k 6r60 2c60 5f |Ts 6k 2k |Jc 6r130 2f!"
        hist, total, cur = self.m.parse_log(log, 8)
        self.assertEqual(total[5], 50 + 60 + 130)            # seat 6
        self.assertEqual(total[1], 50 + 60)                  # seat 2
        self.assertEqual(total[3], 10)                       # seat 4 (small blind, folded)
        self.assertEqual(cur[5], 130)                        # river street bet
        self.assertIn((5, 0, "raise", 50), hist)             # raise amount = raise-TO
        self.assertIn((1, 3, "fold", 0), hist)               # "!" stripped, river = street 3
        self.assertEqual(hist[0], (3, 0, "post", 10))

    def test_reply_mapping(self):
        from types import SimpleNamespace as NS
        K = self.m.Kit4Bot
        lg = NS(can_raise=True)
        obs = NS(my_bet=20, legal=lg)
        v = dict(owe=80, min_add=180, max_add=1980)
        self.assertEqual(K.reply(NS(kind="raise", amount=300), v, obs), 280)    # to 300 = add 280
        self.assertEqual(K.reply(NS(kind="raise", amount=50), v, obs), 180)     # below min -> min_add
        self.assertEqual(K.reply(NS(kind="raise", amount=99999), v, obs), 1980)
        self.assertEqual(K.reply(NS(kind="call"), v, obs), 80)
        self.assertEqual(K.reply(NS(kind="fold"), v, obs), -1)
        self.assertEqual(K.reply(NS(kind="fold"), dict(owe=0, min_add=20, max_add=500), obs), 0)  # check, not fold
        self.assertEqual(K.reply(NS(kind="call"), dict(owe=900, min_add=None, max_add=500), obs), 500)  # all-in call

    def test_invariant_run(self):
        self.m.INVARIANTS = True
        try:
            opps = [BotFile(p, rules_dict()) for p in sorted(glob.glob(os.path.join(KIT, "bots", "*.py")))
                    if not p.endswith("template_bot.py")]
            errors = decisions = 0
            for t in range(12):
                rng = random.Random(f"adapter:{t}")
                lineup = [self.bf, self.bf] + [opps[(t + k) % len(opps)] for k in range(rules.SEATS - 2)]
                rng.shuffle(lineup)
                ctrls = [Controller(b, rules.TIME_LIMIT_MS, False) for b in lineup]
                Table(ctrls, seed=rng.randrange(2 ** 32)).run()
                for b, c in zip(lineup, ctrls):
                    if b is self.bf:
                        errors += c.errors
                        decisions += c.decisions
                        self.assertEqual(c.problems if hasattr(c, "problems") else [], [] if not c.errors else c.problems)
            self.assertGreater(decisions, 1000)
            self.assertEqual(errors, 0)
        finally:
            self.m.INVARIANTS = False


if __name__ == "__main__":
    unittest.main()
