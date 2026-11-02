"""Tests for the field-4 bots: full tables without errors, timing, determinism, key rules."""
from __future__ import annotations

import importlib
import os
import random
import unittest

import numpy as np

from engine.cards import parse_cards
from engine.game import CALL, CHECK, FOLD, RAISE, Call, Check, Fold, RaiseTo
from sng.icm import icm
from sng.rules import SngRules
from sng.table import Hand, play_table
from sng.field4 import registry
from sng.field4.base import HU_PCT, MW_PCT, PRE_K
from sng.field4.features import MADE_NAMES, class_from_name, post_features
from sng.field4.icmfast import equity_fast

RULES = SngRules()
FAST = SngRules(enforce_time=False)
NAMES = list(registry.BOTS)


def make(name):
    mod, cls = registry.BOTS[name]
    return getattr(importlib.import_module(mod), cls)()


def lineup(first, t):
    others = [n for n in NAMES if n != first]
    return [first if i % 3 == 0 else others[(i + t) % len(others)] for i in range(8)]


class _Stop(Exception):
    def __init__(self, obs):
        self.obs = obs


def capture(seat, hole, stacks, button, script=None, board="", mine=(), street=0, hand_number=0):
    """Play a real hand with scripted actions and return the observation at my decision.
    script: {seat: [actions]} for the others (default: check, else fold); mine: my
    actions before the captured decision; street: street of the captured decision."""
    script = {k: list(v) for k, v in (script or {}).items()}
    mine = list(mine)
    n = len(stacks)
    hc = parse_cards(hole)
    bc = parse_cards(board) if board else []
    rest = [c for c in range(52) if c not in hc and c not in bc]
    deck = []
    for j in range(n):
        if j == seat:
            deck += hc
        elif stacks[j] > 0:
            deck += [rest.pop(), rest.pop()]
        else:
            deck += [rest.pop(), rest.pop()]
    deck += bc + rest
    h = Hand(RULES, list(stacks), button, hand_number, deck)

    def decide(j, obs, lg):
        if j == seat:
            if mine:
                return mine.pop(0)
            if obs.street == street:
                raise _Stop(obs)
            return Check() if lg.can_check else Call()
        q = script.get(j)
        if q:
            return q.pop(0)
        return Check() if lg.can_check else Fold()

    try:
        h.play(decide, sum(1 for s in stacks if s > 0))
    except _Stop as e:
        return e.obs
    raise AssertionError("decision point not reached")


def decide_with(name, obs, seed=1):
    b = make(name)
    b.new_table(RULES, obs.seat, seed)
    return b, b.act(obs)


class TestRegistry(unittest.TestCase):
    def test_registry(self):
        self.assertGreaterEqual(len(registry.BOTS), 4)
        for name, (mod, cls) in registry.BOTS.items():
            self.assertTrue(name.startswith("f4_"))
            self.assertTrue(mod.startswith("sng.field4."))
            b = make(name)
            self.assertTrue(hasattr(b, "act") and hasattr(b, "new_table"))
        for f, mix in registry.FIELDS.items():
            for n, w in mix:
                self.assertIn(n, registry.BOTS)
                self.assertGreater(w, 0)


class TestTables(unittest.TestCase):
    def test_full_tables_no_errors(self):
        for name in NAMES:
            for t in range(3):
                names = lineup(name, t)
                res = play_table([make(n) for n in names], RULES, seed=100 + t)
                for i, n in enumerate(names):
                    st = res.stats[i]
                    self.assertEqual(st.errors, 0, f"{n}: {st.first_error}")
                    self.assertEqual(st.illegal, 0, f"{n}: {st.first_error}")
                self.assertAlmostEqual(sum(res.points), sum(RULES.payouts), places=6)

    def test_same_bot_table(self):
        for name in NAMES:
            res = play_table([make(name) for _ in range(8)], FAST, seed=7)
            for st in res.stats:
                self.assertEqual(st.errors + st.illegal, 0, f"{name}: {st.first_error}")

    @unittest.skipIf(os.environ.get("FIELD_SKIP_TIMING"), "FIELD_SKIP_TIMING set")
    def test_timing_p99(self):
        times = {n: [] for n in NAMES}
        for t in range(6):
            names = lineup(NAMES[t % len(NAMES)], t)
            res = play_table([make(n) for n in names], FAST, seed=300 + t)
            for i, n in enumerate(names):
                times[n] += res.stats[i].times
        for n, ts in times.items():
            self.assertGreater(len(ts), 200)
            p99 = float(np.percentile(ts, 99))
            self.assertLess(p99, 0.0005, f"{n} p99 {p99 * 1e6:.0f} us")

    def test_determinism(self):
        for name in NAMES:
            names = lineup(name, 1)
            a = play_table([make(n) for n in names], FAST, seed=42)
            b = play_table([make(n) for n in names], FAST, seed=42)
            self.assertEqual(a.points, b.points, name)
            self.assertEqual(a.final_stacks, b.final_stacks, name)
            self.assertEqual([s.decisions for s in a.stats], [s.decisions for s in b.stats], name)


class TestIcmAndTables(unittest.TestCase):
    def test_icm_matches_reference(self):
        rng = random.Random(3)
        pay = RULES.payouts
        for _ in range(40):
            n = rng.randint(2, 8)
            st = [rng.randint(50, 8000) for _ in range(n)]
            ref = icm(st, pay[:n])
            got = equity_fast([st[0]], [st[1:]], pay[:n])[0]
            self.assertAlmostEqual(got, ref[0], delta=0.1)

    def test_busted_opponents_take_last_places(self):
        pay = RULES.payouts[:4]
        got = equity_fast([3000], [[3000, 0, 0]], pay)[0]
        self.assertAlmostEqual(got, (pay[0] + pay[1]) / 2, delta=0.05)

    def test_tables_sane(self):
        self.assertAlmostEqual(PRE_K[class_from_name("AA"), 1], 0.85, delta=0.01)
        self.assertLess(HU_PCT[class_from_name("AA")], 0.01)
        self.assertGreater(HU_PCT[class_from_name("72o")], 0.9)
        for k in range(1, 7):
            self.assertGreater(PRE_K[class_from_name("AKs"), k], PRE_K[class_from_name("AKs"), k + 1])

    def test_features(self):
        def made(h, b):
            return MADE_NAMES[post_features(parse_cards(h), parse_cards(b))[0]]
        self.assertEqual(made("AhKd", "Ks7c2d"), "top_good")
        self.assertEqual(made("QhQd", "9s7c2d"), "overpair")
        self.assertEqual(made("9h8d", "Ks9c2d"), "pair_mid")
        self.assertEqual(made("AsAc", "AdKh7c"), "set")
        self.assertEqual(post_features(parse_cards("Ah5h"), parse_cards("Kh7h2d"))[1], 3)   # flush draw


# ---- key rules, one or two per bot ----------------------------------------------------------
EVEN = [2000] * 8
# button 0 -> SB 1, BB 2, first to act 3; seat 0 is the button


def folds_to(seat, upto):
    """script where every seat from 3 up to (not incl.) `upto` folds preflop."""
    return {j: [Fold()] for j in range(3, upto)}


class TestIcmShark(unittest.TestCase):
    def test_shoves_short_premium_and_folds_trash(self):
        stacks = [160, 2000, 2000, 2000, 2000, 2000, 2000, 2000]     # 8 bb on the button
        obs = capture(0, "AhKd", stacks, 0, folds_to(0, 8))
        _, a = decide_with("f4_icm", obs)
        self.assertEqual((a.kind, a.amount), (RAISE, obs.legal.max_raise_to))
        obs = capture(0, "7h2d", stacks, 0, folds_to(0, 8))
        _, a = decide_with("f4_icm", obs)
        self.assertEqual(a.kind, FOLD)

    def test_icm_tightens_calls_on_the_bubble(self):
        # 4 left at 100/200: seat 1 shoves 15 bb, I am the big blind with 30 bb and a 1 bb
        # stack sits on the button. Just above the chip-EV break-even equity, ICM says fold.
        from sng.field4.base import Ctx
        stacks = [6000, 3000, 0, 0, 0, 200, 0, 6800]
        obs = capture(0, "AhAd", stacks, 5, {1: [RaiseTo(3000)]}, hand_number=125)
        self.assertTrue(obs.legal.can_call and obs.big_blind == 200)
        b, a = decide_with("f4_icm", obs)
        self.assertNotEqual(a.kind, FOLD)
        c = Ctx(obs)
        need = obs.legal.call_amount / (obs.pot + obs.legal.call_amount)
        ev_c, ev_f = b.call_vs_fold(obs, c, need + 0.01)
        self.assertLess(ev_c, ev_f)
        ev_c, ev_f = b.call_vs_fold(obs, c, need + 0.10)
        self.assertGreater(ev_c, ev_f)
        obs = capture(0, "7h2d", stacks, 5, {1: [RaiseTo(3000)]}, hand_number=125)
        _, a = decide_with("f4_icm", obs)
        self.assertEqual(a.kind, FOLD)


class TestTagTracker(unittest.TestCase):
    def test_steals_wider_against_folding_blinds(self):
        # a hand between the tight and the widened button range
        hand = next(h for h in ("K7o", "Q8o", "J8o", "K5o", "T8o", "A4o", "Q7o")
                    if 0.25 < MW_PCT[class_from_name(h)] < 0.45)
        cards = {"K7o": "Kh7d", "Q8o": "Qh8d", "J8o": "Jh8d", "K5o": "Kh5d", "T8o": "Th8d",
                 "A4o": "Ah4d", "Q7o": "Qh7d"}[hand]
        obs = capture(0, cards, EVEN, 0, folds_to(0, 8))
        b = make("f4_tag")
        b.new_table(RULES, 0, 1)
        for j in (1, 2):
            b.tracker.s[j]["steal_opp"] = 40
            b.tracker.s[j]["steal_fold"] = 39
        self.assertEqual(b.act(obs).kind, RAISE)
        b = make("f4_tag")
        b.new_table(RULES, 0, 1)
        for j in (1, 2):
            b.tracker.s[j]["steal_opp"] = 40
            b.tracker.s[j]["steal_fold"] = 2
        self.assertEqual(b.act(obs).kind, FOLD)

    def test_tracker_counts_steal_folds(self):
        res_bot = make("f4_tag")
        names = ["f4_tag"] * 8
        bots = [res_bot] + [make(n) for n in names[1:]]
        play_table(bots, FAST, seed=5)
        tot = sum(res_bot.tracker.s[j]["steal_opp"] for j in range(8))
        self.assertGreater(tot, 0)


class TestPressureLag(unittest.TestCase):
    def test_wide_shove_at_15bb(self):
        stacks = [300, 2000, 2000, 2000, 2000, 2000, 2000, 2000]     # 15 bb on the button
        obs = capture(0, "Kh9d", stacks, 0, folds_to(0, 8))
        _, a = decide_with("f4_lag", obs)
        self.assertEqual((a.kind, a.amount), (RAISE, obs.legal.max_raise_to))
        _, a = decide_with("f4_tag", obs)          # the TAG raise-folds this spot instead
        self.assertLess(a.amount, obs.legal.max_raise_to)

    def test_cbets_most_flops(self):
        n_bet = 0
        for seed in range(30):
            obs = capture(0, "9h8d", EVEN, 0, {**folds_to(0, 8), 2: [Call()], 1: [Fold()]},
                          board="AsKc2d", mine=[RaiseTo(42)], street=1)
            _, a = decide_with("f4_lag", obs, seed=seed)
            n_bet += a.kind == RAISE
        self.assertGreaterEqual(n_bet, 18)


class TestMonteCarlo(unittest.TestCase):
    def test_mc_equity_orders_hands(self):
        obs_strong = capture(0, "AhAd", EVEN, 0, {**folds_to(0, 8), 2: [Call()], 1: [Fold()]},
                             board="Ks7c2d", mine=[RaiseTo(42)], street=1)
        obs_weak = capture(0, "4h3d", EVEN, 0, {**folds_to(0, 8), 2: [Call()], 1: [Fold()]},
                           board="Ks9cQd", mine=[RaiseTo(42)], street=1)
        from sng.field4.base import Ctx
        b = make("f4_mc")
        b.new_table(RULES, 0, 3)
        hi = b.mc_equity(obs_strong, Ctx(obs_strong))
        lo = b.mc_equity(obs_weak, Ctx(obs_weak))
        self.assertGreater(hi, 0.75)
        self.assertLess(lo, 0.25)

    def test_folds_air_to_a_big_bet(self):
        obs = capture(0, "4h3d", EVEN, 0, {**folds_to(0, 8), 2: [Call(), RaiseTo(60)], 1: [Fold()]},
                      board="KsQcJd", mine=[RaiseTo(42)], street=1)
        _, a = decide_with("f4_mc", obs)
        self.assertEqual(a.kind, FOLD)


class TestBalancedGto(unittest.TestCase):
    def test_boundary_hands_are_mixed(self):
        from sng.field4.balanced_gto import BalancedGto
        b = BalancedGto()
        b.new_table(RULES, 0, 9)
        outs = [b.mix(0.20, 0.20, 0.02) for _ in range(400)]
        self.assertTrue(150 < sum(outs) < 250)
        self.assertTrue(all(b.mix(0.10, 0.20, 0.02) for _ in range(50)))
        self.assertFalse(any(b.mix(0.30, 0.20, 0.02) for _ in range(50)))

    def test_keeps_no_reads_and_defends_bb_by_pot_odds(self):
        self.assertFalse(make("f4_gto").track)
        # min-raise from the button: the big blind defends a wide hand like K8o
        obs = capture(2, "Kh8d", EVEN, 0, {**folds_to(3, 8), 0: [RaiseTo(40)], 1: [Fold()]})
        _, a = decide_with("f4_gto", obs)
        self.assertNotEqual(a.kind, FOLD)


class TestEqRules(unittest.TestCase):
    def test_short_stack_formula(self):
        # SB vs BB only (k = 1) at 8 bb: shove if equity >= (0.75 + 0.25*8/10) / 2 = 0.475
        stacks = [2000, 160, 2000, 2000, 2000, 2000, 2000, 2000]
        script = {j: [Fold()] for j in (3, 4, 5, 6, 7, 0)}
        obs = capture(1, "Ah2d", stacks, 0, script)
        _, a = decide_with("f4_eqrule", obs)
        self.assertEqual(a.kind, RAISE)
        obs = capture(1, "7h2d", stacks, 0, script)
        _, a = decide_with("f4_eqrule", obs)
        self.assertEqual(a.kind, FOLD)

    def test_never_raises_a_postflop_bet(self):
        obs = capture(0, "AhAd", EVEN, 0, {**folds_to(0, 8), 2: [Call(), RaiseTo(30)], 1: [Fold()]},
                      board="As7c2d", mine=[RaiseTo(42)], street=1)
        _, a = decide_with("f4_eqrule", obs)
        self.assertEqual(a.kind, CALL)


class TestSafety(unittest.TestCase):
    def test_actions_always_legal(self):
        from sng.field4.base import fix
        from sng.table import Legal
        lg = Legal(can_check=False, can_call=True, call_amount=50, can_raise=False, min_raise_to=0,
                   max_raise_to=0)
        self.assertEqual(fix(RaiseTo(500), lg).kind, CALL)
        self.assertEqual(fix(Check(), lg).kind, FOLD)
        self.assertEqual(fix(None, lg).kind, FOLD)
        lg = Legal(True, False, 0, True, 40, 400)
        self.assertEqual(fix(RaiseTo(10), lg).amount, 40)
        self.assertEqual(fix(RaiseTo(10 ** 6), lg).amount, 400)
        self.assertEqual(fix(Fold(), lg).kind, CHECK)


if __name__ == "__main__":
    unittest.main()
