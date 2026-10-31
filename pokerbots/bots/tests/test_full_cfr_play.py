"""Play-time robustness tests for bots/full_cfr.py and bots/hybrid.py (debugger round 2).

    python3 -m unittest bots.tests.test_full_cfr_play      (from pokerbots/)
"""
from __future__ import annotations

import os
import shutil
import tempfile
import unittest

from engine.game import Discard, HandState, LegalActions
from engine.match import deal_order, play_match
from engine.variants import VARIANTS

from bots.cfr_full.abstraction import AbstractionConfig
from bots.cfr_full.train import train
from bots.full_cfr import FullCFRBot
from bots.hybrid import HybridBot
from bots.random_legal import RandomLegalBot


def _discard_obs(spec, street):
    """A real discard observation from the engine, with its street replaced."""
    got = {}

    def decide(p, o):
        if o.legal.discard_count and "obs" not in got:
            got["obs"] = o
        if o.legal.discard_count:
            return Discard(o.my_cards[:o.legal.discard_count])
        return o.legal.passive()
    HandState(spec, deal_order(spec, 1, 0)).play(decide)
    from dataclasses import replace
    return replace(got["obs"], street=street)


class TestDiscardFallback(unittest.TestCase):
    def test_discard_never_raises(self):
        # a discard request on a street the spec has no rule for (a rules/protocol mapping
        # slip) made EquityModel.discard_options raise StopIteration out of act(), which the
        # engine and servers treat as a fold of the whole pot; it must be a legal discard
        spec = VARIANTS["c_discard3"]
        bot = FullCFRBot(budget="no_such_budget", verbose=False)
        bot.new_match(spec, 0)
        obs = _discard_obs(spec, street=2)
        a = bot.act(obs)
        self.assertTrue(obs.legal.is_legal(a, obs.my_cards), a)


class _MaxRaiser:
    """Wrapper that turns every raise of the inner bot into the maximum raise, as lead
    protection's catch-up mode does (under pot limit the maximum is not all-in)."""
    name = "maxraiser"

    def __init__(self, inner):
        self.inner = inner

    def new_match(self, spec, seed=0):
        self.inner.new_match(spec, seed)

    def act(self, obs):
        from engine.game import RAISE, RaiseTo
        a = self.inner.act(obs)
        if a.kind == RAISE and obs.legal.can_raise:
            return RaiseTo(obs.legal.max_raise_to)
        return a

    def end_hand(self, r):
        self.inner.end_hand(r)

    def end_match(self):
        self.inner.end_match()


class TestOwnActionTracking(unittest.TestCase):
    def test_changed_own_raise_is_tracked_by_its_real_size(self):
        # our recorded action is mapped through the abstract index we chose only if the
        # real action is that action; a wrapper that changed the raise size (lead protection
        # catch-up) must not leave the tree on the smaller raise's branch
        spec = VARIANTS["a_nlhe100"].with_(name="pl_track", betting="pot_limit", starting_stack=400)
        tmp = tempfile.mkdtemp(prefix="full_cfr_track_")
        try:
            cfg = AbstractionConfig(n_fit=200, table_seconds=0.3, n_post=16, n_disc=8)
            written, *_ = train(spec, minutes=0.03, seed=0, out_dir=tmp, abs_cfg=cfg, batch=64,
                                log=lambda s: None)
            bot = FullCFRBot(policy_path=written[0], threshold=0.0)
            checks = {"n": 0, "bad": 0}
            orig = bot._policy_action

            def spy(obs):
                if obs.hand_index != bot._hand:
                    bot._new_hand(obs)
                bot._advance(obs)
                n = bot._node
                tr = bot.policy.tree
                if (n is not None and tr.kind[n] == 0 and tr.player[n] == obs.position
                        and tr.street[n] == obs.street):
                    checks["n"] += 1
                    checks["bad"] += tr.pot[n] != obs.pot
                return orig(obs)
            bot._policy_action = spy
            from bots.dummies import make_bot as dummy
            for seat in (0, 1):
                w = _MaxRaiser(bot)
                pair = (w, dummy(kind="station")) if seat == 0 else (dummy(kind="station"), w)
                play_match(pair[0], pair[1], spec, deal_seed=4 + seat, hands=60)
            self.assertGreater(checks["n"], 50)
            self.assertEqual(checks["bad"], 0, checks)
        finally:
            shutil.rmtree(tmp, ignore_errors=True)


class TestHybridPolicies(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.mkdtemp(prefix="hybrid_play_test_")
        cfg = AbstractionConfig(n_fit=200, table_seconds=0.3, n_post=16, n_disc=8)
        written, *_ = train(VARIANTS["f_nlhe20"], minutes=0.03, seed=0, out_dir=cls.tmp, abs_cfg=cfg,
                            batch=64, log=lambda s: None)
        cls.path = written[0]

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.tmp, ignore_errors=True)

    def test_policy_for_other_rules_is_adaptive(self):
        h = HybridBot(policy_path=self.path, verbose=False)
        h.new_match(VARIANTS["a_nlhe100"], 0)
        self.assertTrue(h.using_fallback)
        r = play_match(h, RandomLegalBot(), VARIANTS["a_nlhe100"], deal_seed=3, hands=20)
        self.assertEqual(r.stats[0].illegal + r.stats[0].errors, 0, r.stats[0].first_error)
        self.assertEqual(h.hands_cfr, 0)

    def test_policy_loads_and_plays(self):
        h = HybridBot(policy_path=self.path, verbose=False)
        r = play_match(h, RandomLegalBot(), VARIANTS["f_nlhe20"], deal_seed=3, hands=30)
        self.assertFalse(h.using_fallback)
        self.assertEqual(r.stats[0].illegal + r.stats[0].errors, 0, r.stats[0].first_error)
        self.assertGreater(h.hands_cfr, 0)


if __name__ == "__main__":
    unittest.main()
