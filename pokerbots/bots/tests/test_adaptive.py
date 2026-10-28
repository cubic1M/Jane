"""Tests for bots/adaptive.py (python3 -m unittest bots.tests.test_adaptive)."""
from __future__ import annotations

import unittest
from dataclasses import replace

from engine.game import ActionRecord, HandResult, RaiseTo
from engine.match import play_match
from engine.variants import VARIANTS, get_variant
from bots.adaptive import (ADAPT_PARAMS, DIMENSIONS, EXTRA_ADJUSTABLE, KNOB_MAP, STATS,
                           AdaptiveBot, knob_bounds, make_bot)
from bots.balanced import ADJUSTABLE, DEFAULT_PARAMS, BalancedBot
from bots.dummies import ManiacBot, PushBot, StationBot
from bots.random_legal import RandomLegalBot
from bots.tests.test_balanced import spot
from bots.registry import make

A = get_variant("a")


def assert_clean(tc, r, bot, label=""):
    for st in r.stats:
        s = st.summary()
        tc.assertEqual(s["illegal"], 0, label)
        tc.assertEqual(s["errors"], 0, (label, s["first_error"]))
    tc.assertEqual(bot.errors, 0, (label, bot.last_error))


def assert_bounded(tc, bot):
    for k in KNOB_MAP:
        lo, hi = knob_bounds(k)
        tc.assertGreaterEqual(bot.params[k], lo - 1e-12, k)
        tc.assertLessEqual(bot.params[k], hi + 1e-12, k)
    for k in bot.params:   # nothing outside the map ever moves
        if k not in KNOB_MAP:
            tc.assertEqual(bot.params[k], DEFAULT_PARAMS[k], k)


class TestApi(unittest.TestCase):
    def test_make_bot_registry_and_name(self):
        b = make("adaptive")
        self.assertIsInstance(b, AdaptiveBot)
        self.assertIsInstance(b, BalancedBot)
        self.assertEqual(b.name, "adaptive")
        self.assertIsInstance(make_bot(), AdaptiveBot)

    def test_tables_are_consistent(self):
        for k in KNOB_MAP:
            self.assertIn(k, DEFAULT_PARAMS)
            lo, hi = knob_bounds(k)
            self.assertLessEqual(lo, DEFAULT_PARAMS[k])
            self.assertLessEqual(DEFAULT_PARAMS[k], hi)
            parts, rn, rp = KNOB_MAP[k]
            self.assertTrue(0 <= rn <= 1 and 0 <= rp <= 1, k)
            for d, _ in parts:
                self.assertIn(d, DIMENSIONS)
        for k in EXTRA_ADJUSTABLE:
            self.assertNotIn(k, ADJUSTABLE)
        for parts in DIMENSIONS.values():
            for s, _ in parts:
                self.assertIn(s, STATS)
        with self.assertRaises(KeyError):
            AdaptiveBot(adapt={"nope": 1})


class TestLegality(unittest.TestCase):
    def test_all_variants(self):
        for spec in VARIANTS.values():
            for opp_f in (RandomLegalBot, AdaptiveBot, PushBot, ManiacBot):
                bot = AdaptiveBot()
                for seat in (0, 1):
                    opp = opp_f()
                    pair = (bot, opp) if seat == 0 else (opp, bot)
                    r = play_match(pair[0], pair[1], spec, deal_seed=3 + seat, hands=20)
                    assert_clean(self, r, bot, f"{spec.name} {opp_f.__name__}")

    def test_adapted_bot_stays_legal(self):
        # low sample thresholds so the knobs move inside a short test match
        fast = dict(min_sample=5, min_sample_showdown=2, ramp=10)
        for name in ("a", "c", "d", "f"):
            spec = get_variant(name)
            for opp_f in (StationBot, ManiacBot, PushBot, RandomLegalBot):
                bot = AdaptiveBot(adapt=fast)
                r = play_match(bot, opp_f(), spec, deal_seed=7, hands=60)
                assert_clean(self, r, bot, f"{name} {opp_f.__name__}")
                assert_bounded(self, bot)

    def test_tight_clock_still_legal(self):
        spec = A.with_(time_per_decision=0.004, time_per_match=0.5)
        bot = AdaptiveBot()
        r = play_match(bot, RandomLegalBot(), spec, deal_seed=9, hands=40)
        assert_clean(self, r, bot)


class TestAdaptation(unittest.TestCase):
    def test_no_adjustment_before_min_sample(self):
        bot = AdaptiveBot()
        play_match(bot, StationBot(), A, deal_seed=4, hands=8)
        for k in STATS:
            self.assertLess(bot.stats.n(k), ADAPT_PARAMS["min_sample"], k)
            self.assertEqual(bot.stats.score(k), 0.0, k)
        self.assertEqual(bot.params, DEFAULT_PARAMS)
        self.assertTrue(all(v == 0.0 for v in bot.dims.values()))

    def test_each_knob_waits_for_its_own_sample(self):
        # after every hand: a knob whose statistics are all below min_sample is at default
        checks = []

        class Spy(AdaptiveBot):
            def end_hand(self, result):
                super().end_hand(result)
                st = self.stats
                for knob, (parts, _, _) in KNOB_MAP.items():
                    stats = [s for d, _ in parts for s, _ in DIMENSIONS[d]]
                    if knob == "post_bet_keep":
                        stats.append("stab")
                    if knob == "post_raise_keep":
                        stats.append("raise_bet")
                    if all(st.conf(s) == 0.0 for s in stats):
                        checks.append((knob, self.params[knob] == DEFAULT_PARAMS[knob]))
                if all(st.conf(s) == 0.0 for s in ("pre_open", "pre_reraise")):
                    checks.append(("floors", max(self.floors.values()) == 0.0))
        for opp in (StationBot(), ManiacBot()):
            play_match(Spy(), opp, A, deal_seed=4, hands=80)
        self.assertGreater(len(checks), 100)
        self.assertTrue(all(ok for _, ok in checks), [k for k, ok in checks if not ok][:5])

    def test_station_reduces_bluffing_and_bets_thinner(self):
        bot = AdaptiveBot()
        play_match(bot, StationBot(), A, deal_seed=5, hands=300)
        p, d = bot.params, DEFAULT_PARAMS
        self.assertLess(bot.stats.rate("fold_bet"), 0.1)
        for k in ("bluff_freq", "bluff_freq_river", "cbet_freq", "bluff_raise_freq"):
            self.assertLess(p[k], d[k], k)
        self.assertLess(p["bluff_freq"], 0.5 * d["bluff_freq"])
        self.assertLess(p["value_bet_eq"], d["value_bet_eq"])
        self.assertGreater(p["bet_big"], d["bet_big"])
        self.assertLessEqual(p["slowplay_freq"], d["slowplay_freq"])
        assert_bounded(self, bot)

    def test_push_widens_defence(self):
        bot = AdaptiveBot()
        play_match(bot, PushBot(), A, deal_seed=6, hands=300)
        p, d = bot.params, DEFAULT_PARAMS
        self.assertLess(p["pre_call_margin_oop"], d["pre_call_margin_oop"])
        self.assertLess(p["pre_call_margin_ip"], d["pre_call_margin_ip"])
        self.assertGreater(p["mdf_scale"], d["mdf_scale"])
        self.assertGreater(p["pre_range_k"], d["pre_range_k"])
        self.assertGreater(bot.floors["pre_open"], 0.8)    # it shoves ~every hand
        assert_bounded(self, bot)

    def test_maniac_widens_postflop_defence_and_traps(self):
        bot = AdaptiveBot()
        play_match(bot, ManiacBot(), A, deal_seed=8, hands=400)
        p, d = bot.params, DEFAULT_PARAMS
        self.assertLess(p["call_margin"], d["call_margin"])
        self.assertGreater(p["post_bet_keep"], d["post_bet_keep"])
        self.assertGreater(p["post_raise_keep"], d["post_raise_keep"])
        self.assertGreater(p["slowplay_freq"], d["slowplay_freq"])
        self.assertLess(p["bluff_freq"], d["bluff_freq"])
        assert_bounded(self, bot)

    def test_observed_frequency_widens_preflop_range(self):
        # facing a 100bb preflop shove: after 200 hands vs an always-all-in opponent the
        # range floor makes the shoving range (nearly) all hands
        obs = spot(A, "7c2d", "Ah9s", "", [RaiseTo(200)])
        self.assertEqual(obs.position, 1)
        fresh = AdaptiveBot()
        fresh.new_match(A, 0)
        f_fresh = fresh.opponent_range(obs)[0]
        bot = AdaptiveBot()
        play_match(bot, PushBot(), A, deal_seed=6, hands=300)
        f_adapt = bot.opponent_range(obs)[0]
        self.assertLess(f_fresh, 0.5)
        self.assertGreater(f_adapt, 0.8)
        self.assertGreater(bot.strength(obs), fresh.strength(obs))

    def test_balanced_opponent_stays_near_defaults(self):
        bot = AdaptiveBot()
        play_match(bot, BalancedBot(), A, deal_seed=10, hands=300)
        for k in KNOB_MAP:
            lo, hi = knob_bounds(k)
            self.assertLess(abs(bot.params[k] - DEFAULT_PARAMS[k]), 0.25 * (hi - lo), k)

    def test_gradual(self):
        # more evidence -> a larger (never smaller) move, all within bounds
        seen = []
        for hands in (60, 120, 240):
            bot = AdaptiveBot()
            play_match(bot, StationBot(), A, deal_seed=5, hands=hands)
            seen.append(bot.params["bluff_freq"])
            assert_bounded(self, bot)
        self.assertGreaterEqual(seen[0], seen[1])
        self.assertGreaterEqual(seen[1], seen[2])


class TestResetAndInformation(unittest.TestCase):
    def test_stats_reset_per_match(self):
        bot = AdaptiveBot()
        play_match(bot, StationBot(), A, deal_seed=5, hands=200)
        self.assertNotEqual(bot.params, DEFAULT_PARAMS)
        self.assertGreater(bot.stats.hands, 0)
        bot.new_match(A, 99)
        self.assertEqual(bot.params, DEFAULT_PARAMS)
        self.assertEqual(bot.stats.hands, 0)
        for k in STATS:
            self.assertEqual(bot.stats.n(k), 0.0)
        self.assertTrue(all(v == 0.0 for v in bot.dims.values()))
        self.assertTrue(all(v == 0.0 for v in bot.floors.values()))

    def _showdown_result(self, showdown: bool) -> HandResult:
        """A hand where the opponent (BB) raised preflop and bet the river."""
        from engine.cards import parse_cards
        me, opp = 0, 1
        h = (ActionRecord(me, 0, "call", 1), ActionRecord(opp, 0, "raise", 6),
             ActionRecord(me, 0, "call", 4),
             ActionRecord(opp, 1, "check"), ActionRecord(me, 1, "check"),
             ActionRecord(opp, 2, "check"), ActionRecord(me, 2, "check"),
             ActionRecord(opp, 3, "raise", 6), ActionRecord(me, 3, "call", 6))
        return HandResult(position=me, delta=-12, showdown=showdown,
                          my_cards=tuple(parse_cards("KdQd")),
                          opp_cards=tuple(parse_cards("7c2h")),   # forged when showdown=False
                          board=tuple(parse_cards("As9s5c3hJd")), history=h, folded_by=None)

    def test_opponent_cards_used_only_at_showdown(self):
        sd_names = ("sd_bluff", "sd_agg_hs", "sd_call_hs", "sd_pre_pct")
        bot = AdaptiveBot()
        bot.new_match(A, 0)
        bot.end_hand(self._showdown_result(showdown=False))
        self.assertEqual(bot.errors, 0, bot.last_error)
        for k in sd_names:
            self.assertEqual(bot.stats.n(k), 0.0, k)
        self.assertEqual(bot.stats.showdowns, 0)
        self.assertGreater(bot.stats.n("stab"), 0)      # the action history was used
        bot.end_hand(self._showdown_result(showdown=True))
        self.assertEqual(bot.errors, 0, bot.last_error)
        self.assertEqual(bot.stats.showdowns, 1)
        self.assertEqual(bot.stats.n("sd_bluff"), 1.0)   # 72o on that board is a bluff
        self.assertEqual(bot.stats.rates["sd_bluff"].k, 1.0)
        self.assertEqual(bot.stats.n("sd_pre_pct"), 1.0)
        # a result with showdown=True but no cards is ignored safely
        bot.end_hand(replace(self._showdown_result(True), opp_cards=None))
        self.assertEqual(bot.stats.showdowns, 1)

    def test_engine_hides_cards_without_showdown(self):
        # every non-showdown result the bot receives in a real match has no opp cards
        seen = []

        class Spy(AdaptiveBot):
            def end_hand(self, result):
                seen.append((result.showdown, result.opp_cards is not None))
                super().end_hand(result)
        play_match(Spy(), BalancedBot(), A, deal_seed=2, hands=40)
        self.assertTrue(all(sd == has for sd, has in seen))
        self.assertTrue(any(sd for sd, _ in seen) and not all(sd for sd, _ in seen))


if __name__ == "__main__":
    unittest.main()
