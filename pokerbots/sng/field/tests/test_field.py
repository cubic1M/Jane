"""Opponent field tests: helpers, legality on variants, timing, style, chip conservation.
    python3 -m unittest discover -s sng/field/tests -t .
Set FIELD_SKIP_TIMING=1 to skip the wall-clock assertions on a loaded machine.
"""
import os
import random
import time
import unittest

import numpy as np

from engine.cards import parse_card
from engine.evaluator import get_evaluator
from engine.game import RAISE
from engine.variants import get_variant
from sng.field import BOTS, FIELD_WEIGHTS, draw_field, field_mix
from sng.field.adaptive import Adaptive
from sng.field.common import (NOTHING, STRONG, TOP_PAIR, WEAK_PAIR, chen, draw_strength, made_tier,
                              ranker_for)
from sng.field.pushfold import push_range
from sng.rules import NLHE, SngRules
from sng.table import play_table


def cards(s):
    return [parse_card(c) for c in s.split()]


def variant_rules(name, **kw):
    return SngRules(spec=get_variant(name).with_(stack_reset_per_hand=False), enforce_time=False, **kw)


RULES = {
    "nlhe": SngRules(enforce_time=False),
    "pot_limit": SngRules(spec=NLHE.with_(betting="pot_limit"), enforce_time=False),
    "short_deck": variant_rules("e_shortdeck"),
    "omaha4": variant_rules("d_omaha4x2"),
}
NAMES = list(BOTS)


class Spy:
    """Wraps a bot: records each decision's time, observation and action."""

    def __init__(self, bot, name):
        self.bot, self.name = bot, name
        self.times, self.decisions, self.histories = [], [], []

    def new_table(self, rules, seat, seed=0):
        self.seat = seat
        self.bot.new_table(rules, seat, seed)

    def act(self, obs):
        t = time.perf_counter()
        a = self.bot.act(obs)
        self.times.append(time.perf_counter() - t)
        self.decisions.append((obs, a))
        return a

    def end_hand(self, info):
        self.histories.append(info["history"])
        self.bot.end_hand(info)


def rotation(t, names=NAMES):
    """8 of the archetypes for table t, rotating which one sits out and the seats."""
    sel = [names[(t + i) % len(names)] for i in range(8)]
    random.Random(t).shuffle(sel)
    return sel


def run_tables(rules, tables, names=NAMES, factories=BOTS):
    spies, results = [], []
    for t in range(tables):
        sel = rotation(t, names)
        bots = [Spy(factories[n](), n) for n in sel]
        results.append(play_table(bots, rules, seed=1000 + t))
        spies.append(bots)
    return spies, results


def style_stats(spies):
    """Per archetype: VPIP, PFR, call rate facing a postflop bet, decisions."""
    acc = {}
    for table in spies:
        for spy in table:
            d = acc.setdefault(spy.name, dict(hands=0, vpip=0, pfr=0, faced=0, calls=0))
            for hist in spy.histories:
                mine = [k for s, st, k, _ in hist if s == spy.seat and st == 0 and k != "post"]
                if not mine:
                    continue
                d["hands"] += 1
                d["vpip"] += any(k in ("call", "raise") for k in mine)
                d["pfr"] += "raise" in mine
            for obs, a in spy.decisions:
                if obs.street > 0 and obs.legal.can_call:
                    d["faced"] += 1
                    d["calls"] += a.kind == "call"
    return {n: dict(vpip=d["vpip"] / max(1, d["hands"]), pfr=d["pfr"] / max(1, d["hands"]),
                    call=d["calls"] / max(1, d["faced"])) for n, d in acc.items()}


class TestHelpers(unittest.TestCase):
    def test_chen(self):
        c = lambda s: chen(*cards(s))  # noqa: E731
        self.assertEqual(c("Ah Ad"), 20)
        self.assertEqual(c("Kh Kd"), 16)
        self.assertEqual(c("2h 2d"), 5)
        self.assertEqual(c("As Ks"), 12)
        self.assertEqual(c("7h 2d"), -1)
        self.assertEqual(c("Js Ts"), 9)

    def test_ranker_percentiles(self):
        for spec in (NLHE, get_variant("e_shortdeck"), get_variant("d_omaha4x2")):
            r = ranker_for(spec)
            hi, lo = sorted(spec.deck_ranks)[-1], sorted(spec.deck_ranks)[0]
            aces = [hi << 2 | s for s in range(spec.hole_cards)] if spec.hole_cards <= 4 else None
            junk = [lo << 2, (lo + 5) << 2 | 1, (lo + 1) << 2 | 2, (lo + 3) << 2 | 3][:spec.hole_cards]
            self.assertLess(r.top(aces), 0.02, spec.name)
            self.assertGreater(r.top(junk), 0.6, spec.name)

    def test_made_tier(self):
        ev = get_evaluator(NLHE)
        self.assertEqual(made_tier(ev, cards("Ah Kd"), cards("7c 7d 2s")), NOTHING)   # board pair
        self.assertEqual(made_tier(ev, cards("Ah Kd"), cards("Kc 7d 2s")), TOP_PAIR)
        self.assertEqual(made_tier(ev, cards("Ah 7h"), cards("Kc 7d 2s")), WEAK_PAIR)
        self.assertEqual(made_tier(ev, cards("Qh Qd"), cards("Jc 7d 2s")), TOP_PAIR)  # overpair
        self.assertEqual(made_tier(ev, cards("7h 7s"), cards("Kc 7d 2s")), STRONG)    # set
        self.assertEqual(made_tier(ev, cards("Kh Qd"), cards("Jc Jd Js 2s 3h")), NOTHING)  # board trips

    def test_draws(self):
        self.assertEqual(draw_strength(NLHE, cards("Ah Kh"), cards("2h 7h Jc")), 2)       # flush draw
        self.assertEqual(draw_strength(NLHE, cards("9h 8d"), cards("7c 6s Kd")), 2)       # open-ended
        self.assertEqual(draw_strength(NLHE, cards("9h 8d"), cards("7c 5s Kd")), 1)       # gutshot
        self.assertEqual(draw_strength(NLHE, cards("Ah Kh"), cards("2h 7h Jc 3d 9s")), 0)  # river
        sd = get_variant("e_shortdeck")
        self.assertGreaterEqual(draw_strength(sd, cards("Ah 6d"), cards("7c 8s Kd")), 1)  # A-6-7-8-9

    def test_push_range_widens_short_and_late(self):
        self.assertGreater(push_range(5, 7), push_range(15, 7))
        self.assertGreater(push_range(10, 1), push_range(10, 7))
        self.assertLessEqual(push_range(1, 0), 1.0)

    def test_adaptive_steals_more_vs_folders(self):
        from sng.field.common import Situation
        bot = Adaptive()
        bot.new_table(SngRules(), 0, 1)

        class O:  # minimal observation: me in seat 0, two live players behind
            seat = 0
            seats = tuple(type("S", (), dict(seat=j, in_hand=True, folded=False))() for j in range(3))
        sit = Situation(bb=20, to_call=0, cur=20, pot=30, opps=2, behind=2, after_static=2,
                        is_blind=False, raises=0, limpers=0, last_raiser=-1, pf_raiser=-1,
                        my_bb=100, eff_bb=100, facing_allin=False)
        base = bot.open_range(O, sit)
        for j in (1, 2):
            bot.stats.c[j]["faced_raise"] += 30
            bot.stats.c[j]["fold_raise"] += 29
        self.assertGreater(bot.open_range(O, sit), base * 1.5)

    def test_field_mix(self):
        pairs = field_mix()
        names = [n for n, _ in pairs]
        self.assertEqual(len(names), len(set(names)))
        self.assertEqual(set(names), set(FIELD_WEIGHTS))
        for _n, f in pairs:
            self.assertTrue(hasattr(f(), "act"))
        a = [n for n, _ in draw_field(random.Random(3), 7)]
        b = [n for n, _ in draw_field(random.Random(3), 7)]
        self.assertEqual(a, b)


class TestLegality(unittest.TestCase):
    def _check(self, key, tables):
        spies, results = run_tables(RULES[key], tables)
        for table, r in zip(spies, results):
            self.assertEqual(sum(r.final_stacks), 8 * RULES[key].starting_stack)
            for spy, st in zip(table, r.stats):
                self.assertEqual((st.errors, st.illegal), (0, 0), f"{key} {spy.name}: {st.first_error}")

    def test_nlhe(self):
        self._check("nlhe", 18)

    def test_pot_limit(self):
        self._check("pot_limit", 9)

    def test_short_deck(self):
        self._check("short_deck", 9)

    def test_omaha4(self):
        self._check("omaha4", 9)

    def test_raises_respect_pot_limit(self):
        spies, _ = run_tables(RULES["pot_limit"], 3)
        raises = [(o, a) for t in spies for s in t for o, a in s.decisions if a.kind == RAISE]
        self.assertGreater(len(raises), 50)
        for o, a in raises:
            self.assertLessEqual(a.amount, o.legal.max_raise_to)


@unittest.skipIf(os.environ.get("FIELD_SKIP_TIMING"), "timing skipped")
class TestTiming(unittest.TestCase):
    def _p99(self, key, tables):
        rules = RULES[key].with_(enforce_time=True)
        spies, results = run_tables(rules, tables)
        times, over = {}, {}
        for table, r in zip(spies, results):
            for spy, st in zip(table, r.stats):
                times.setdefault(spy.name, []).extend(spy.times)
                o = over.setdefault(spy.name, [0, 0])
                o[0] += st.over_limit
                o[1] += st.decisions
        return {n: float(np.percentile(t, 99)) for n, t in times.items()}, over

    def test_p99_under_half_a_millisecond(self):
        for key in ("nlhe", "omaha4"):
            p99, over = self._p99(key, 9)
            for name, p in p99.items():
                if name == "mc_equity":
                    continue
                self.assertLess(p, 0.0005, f"{key} {name} p99 {p * 1e3:.3f} ms")
                self.assertLess(over[name][0], 0.01 * over[name][1] + 1, f"{key} {name} over limit")

    def test_mc_equity_is_often_too_slow(self):
        _, over = self._p99("omaha4", 3)
        self.assertGreater(over["mc_equity"][0], 0.3 * over["mc_equity"][1])


class TestStyle(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.spies, cls.results = run_tables(RULES["nlhe"], 27)
        cls.stats = style_stats(cls.spies)

    def test_vpip_order(self):
        s = self.stats
        self.assertLess(s["nit"]["vpip"], s["chen_tag"]["vpip"])
        self.assertLess(s["chen_tag"]["vpip"], s["lag"]["vpip"])
        self.assertLess(s["lag"]["vpip"], s["maniac"]["vpip"])
        self.assertLess(s["nit"]["vpip"], 0.08)

    def test_station_calls_and_rarely_raises(self):
        s = self.stats
        self.assertGreater(s["station"]["vpip"], 0.4)
        self.assertLess(s["station"]["pfr"], 0.05)
        self.assertGreater(s["station"]["call"], s["nit"]["call"])
        self.assertGreater(s["station"]["call"], s["chen_tag"]["call"])

    def test_maniac_raises_most(self):
        s = self.stats
        self.assertEqual(max(s, key=lambda n: s[n]["pfr"]), "maniac")

    def test_pushfold_pushes_short(self):
        from sng.field.common import situation
        short = shoves = 0
        for table in self.spies:
            for spy in table:
                if spy.name != "pushfold_icm":
                    continue
                for obs, a in spy.decisions:
                    sit = situation(obs)
                    if obs.street == 0 and sit.eff_bb <= 15 and a.kind == RAISE:
                        short += 1
                        shoves += a.amount == obs.legal.max_raise_to
        self.assertGreater(short, 20)
        self.assertEqual(shoves, short)                  # short: every raise is all-in

    def test_mixed_table_conserves_chips_and_points(self):
        rules = SngRules()
        for t in range(3):
            bots = [f() for _, f in draw_field(random.Random(t), 8)]
            r = play_table(bots, rules, seed=t)
            self.assertEqual(sum(r.final_stacks), 8 * rules.starting_stack)
            self.assertAlmostEqual(sum(r.points), sum(rules.payouts), places=6)
            for st in r.stats:
                self.assertEqual((st.errors, st.illegal), (0, 0), st.first_error)


if __name__ == "__main__":
    unittest.main()
