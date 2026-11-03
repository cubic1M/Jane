"""Tests for the field5 bots: full tables, timing, determinism and each bot's key rule."""
from __future__ import annotations

import importlib
import os
import unittest

import numpy as np

from engine.cards import parse_cards
from engine.game import Call, Fold, RaiseTo
from sng.field5.core import Hand as Read
from sng.field5.core import Tracker, bubble_factors, my_icm
from sng.field5.registry import BOTS, FIELDS
from sng.icm import icm
from sng.rules import SngRules
from sng.table import Hand, play_table
from sng.timescale import factor

NAMES = list(BOTS)


def make(name):
    mod, cls = BOTS[name]
    return getattr(importlib.import_module(mod), cls)()


class _Spot(Exception):
    pass


def spot(bot, hole, stacks, button, script=(), board="", seat=None, seed=1, hand_number=0,
         prepare=None):
    """Drive the real hand engine to `seat`'s first decision after the scripted actions of
    the other seats (a list of (seat, action)). Returns (obs, the bot's action)."""
    rules = SngRules()
    n = len(stacks)
    hole_c = parse_cards(hole)
    board_c = parse_cards(board) if board else []
    used = set(hole_c) | set(board_c)
    rest = [c for c in range(52) if c not in used]
    deck = []
    for j in range(n):
        if j == seat:
            deck += hole_c
        else:
            deck += [rest.pop(), rest.pop()]
    deck += board_c + rest
    bot.new_table(rules, seat, seed)
    bot.end_hand(dict(hand_number=-1, deltas=[0] * n, board=(), history=(), showdown=None,
                      stacks=tuple(stacks)))
    if prepare:
        prepare(bot)
    queue = list(script)
    out = {}

    def decide(j, obs, lg):
        if j == seat:
            if queue and queue[0][0] == seat:      # scripted action for the hero
                return queue.pop(0)[1]
            out["obs"], out["a"] = obs, bot.act(obs)
            raise _Spot
        if queue and queue[0][0] == j:
            return queue.pop(0)[1]
        return Fold() if lg.can_call else lg.passive()

    h = Hand(rules, list(stacks), button, hand_number, deck)
    try:
        h.play(decide, sum(1 for s in stacks if s > 0))
    except _Spot:
        pass
    assert "obs" in out, "hero never got to act"
    return out["obs"], out["a"]


def is_raise(a):
    return a.kind == "raise"


class TestFullTables(unittest.TestCase):
    def test_tables_no_errors(self):
        rules = SngRules()
        for t in range(4):
            rng = np.random.default_rng(t)
            lineup = NAMES + list(rng.choice(NAMES, 3))
            rng.shuffle(lineup)
            res = play_table([make(n) for n in lineup], rules, seed=500 + t)
            for i, n in enumerate(lineup):
                st = res.stats[i]
                self.assertEqual(st.errors, 0, f"{n}: {st.first_error}")
                self.assertEqual(st.illegal, 0, f"{n}: {st.first_error}")
                self.assertGreater(st.decisions, 0)

    def test_each_bot_full_table_alone(self):
        # each bot in a table of copies of itself, several tables
        rules = SngRules()
        for n in NAMES:
            for t in range(2):
                res = play_table([make(n) for _ in range(8)], rules, seed=900 + t)
                for st in res.stats:
                    self.assertEqual(st.errors + st.illegal, 0, f"{n}: {st.first_error}")

    @unittest.skipIf(os.environ.get("FIELD_SKIP_TIMING"), "timing skipped")
    def test_timing_p99(self):
        rules = SngRules()
        times = {n: [] for n in NAMES}
        for t in range(3):
            lineup = NAMES + NAMES[:3]
            lineup = lineup[t:] + lineup[:t]
            res = play_table([make(n) for n in lineup], rules, seed=300 + t)
            for i, n in enumerate(lineup):
                times[n] += res.stats[i].times
        for n, ts in times.items():
            p99 = float(np.percentile(ts, 99))
            self.assertLess(p99, 0.0005 * factor(), f"{n} p99 {p99 * 1e3:.3f} ms")

    def test_deterministic(self):
        rules = SngRules()
        lineup = NAMES + NAMES[:3]
        a = play_table([make(n) for n in lineup], rules, seed=42)
        b = play_table([make(n) for n in lineup], rules, seed=42)
        self.assertEqual(a.points, b.points)
        self.assertEqual(a.final_stacks, b.final_stacks)
        self.assertEqual(a.bust_hand, b.bust_hand)
        self.assertEqual(a.hands, b.hands)

    def test_registry(self):
        self.assertEqual(set(NAMES), {"f5_nash", "f5_reg", "f5_bully", "f5_trapper", "f5_adapt"})
        ws = {w for _, w in FIELDS["field5"]}
        self.assertEqual(len(ws), 1)
        self.assertEqual({n for n, _ in FIELDS["field5"]}, set(NAMES))


class TestCore(unittest.TestCase):
    def test_icm_matches_reference(self):
        st = [3000, 2500, 2000, 1500, 1000, 800, 500, 4700]
        pays = SngRules().payouts
        ref = icm(st, pays)
        for i in range(8):
            self.assertAlmostEqual(my_icm(st, i, pays), ref[i], places=6)

    def test_bubble_factor_covered(self):
        st = [3000, 2500, 2000, 1500, 1000, 800, 500, 4700]
        bf = bubble_factors(st, 0, SngRules().payouts)
        self.assertGreater(bf[7], bf[6])          # risking more against the big stack
        self.assertGreaterEqual(min(bf), 1.0)

    def test_hand_reads(self):
        self.assertEqual(Read(parse_cards("7s7d"), parse_cards("7cKd2h")).level, 7)   # set
        self.assertEqual(Read(parse_cards("AsAd"), parse_cards("Kh7c2d")).level, 5)   # overpair
        r = Read(parse_cards("Ah5h"), parse_cards("Kh9h4c"))
        self.assertTrue(r.fd and r.nfd)
        self.assertTrue(Read(parse_cards("9c8c"), parse_cards("7d6s2h")).oesd)
        self.assertEqual(Read(parse_cards("6s5s"), parse_cards("AcAd9h9s2c")).level, 0)


EIGHT = [2000] * 8


class TestNash(unittest.TestCase):
    def test_short_sb_shoves_wide_and_utg_folds_trash(self):
        # heads-up 10 bb (ICM is linear): the button / SB shoves the wide Nash range
        hu = [200, 200] + [0] * 6
        for hole in ("Kh9c", "Qc5c", "Ad2h", "8s7s"):
            obs, a = spot(make("f5_nash"), hole, hu, button=0, seat=0)
            self.assertEqual(obs.seat, obs.sb_seat)
            self.assertTrue(is_raise(a) and a.amount == obs.legal.max_raise_to, hole)
        _, a = spot(make("f5_nash"), "7c2d", hu, button=0, seat=0)
        self.assertNotEqual(a.kind, "raise")
        st = [200] * 8                      # 10 bb each, 8-handed: button 0, SB 1, BB 2, UTG 3
        _, a = spot(make("f5_nash"), "7c2d", st, button=0, seat=3)
        self.assertEqual(a.kind, "fold")
        _, a = spot(make("f5_nash"), "AsAd", st, button=0, seat=3)
        self.assertTrue(is_raise(a))

    def test_calls_shove_with_strong_folds_weak(self):
        st = [200] * 8
        script = [(3, RaiseTo(200))]        # UTG shoves 10 bb
        _, a = spot(make("f5_nash"), "QhQc", st, button=0, seat=2, script=script)
        self.assertIn(a.kind, ("call", "raise"))
        _, a = spot(make("f5_nash"), "Js4d", st, button=0, seat=2, script=script)
        self.assertEqual(a.kind, "fold")

    def test_deep_tag_open(self):
        _, a = spot(make("f5_nash"), "AsKd", EIGHT, button=0, seat=3)
        self.assertTrue(is_raise(a) and a.amount < 100)     # a normal open, not a shove
        _, a = spot(make("f5_nash"), "8c3d", EIGHT, button=0, seat=3)
        self.assertEqual(a.kind, "fold")


class TestReg(unittest.TestCase):
    def test_light_3bet_vs_late_open(self):
        # button 0 opens (late), hero in the BB (seat 2) with A5s: light 3-bets often
        n3 = 0
        for seed in range(30):
            script = [(0, RaiseTo(50))]
            _, a = spot(make("f5_reg"), "Ah5h", EIGHT, button=0, seat=2, script=script, seed=seed)
            n3 += is_raise(a)
        self.assertGreater(n3, 12)
        # vs an UTG open the same hand does not 3-bet
        for seed in range(10):
            _, a = spot(make("f5_reg"), "Ah5h", EIGHT, button=0, seat=2,
                        script=[(3, RaiseTo(50))], seed=seed)
            self.assertFalse(is_raise(a))

    def test_folds_to_4bet(self):
        # hero on the button (0) 3-bets a CO open (7), CO 4-bets
        for hole, want in (("AhKd", "fold"), ("QsQh", "fold"), ("AsAd", "raise")):
            script = [(7, RaiseTo(50)), (0, RaiseTo(150)), (7, RaiseTo(360))]
            _, a = spot(make("f5_reg"), hole, EIGHT, button=0, seat=0, script=script)
            self.assertEqual(a.kind, want, hole)

    def test_small_cbet(self):
        bets = []
        for seed in range(20):
            # hero opens on the button, BB calls, BB checks the flop
            script = [(0, RaiseTo(50)), (2, Call()), (2, lg_check())]
            obs, a = spot(make("f5_reg"), "9s8s", EIGHT, button=0, seat=0, script=script,
                          board="Kd7c2h4s5d", seed=seed)
            self.assertEqual(obs.street, 1)
            if is_raise(a):
                bets.append(a.amount / obs.pot)
        self.assertTrue(bets)
        self.assertLess(max(bets), 0.45)


def lg_check():
    from engine.game import Check
    return Check()


class TestBully(unittest.TestCase):
    def test_leader_attacks_medium_stacks(self):
        # level 3 (50/100), hero (seat 7, the CO) covers everyone; the rest are medium
        st = [1700, 1600, 1500, 0, 0, 1800, 1400, 8000]
        _, a = spot(make("f5_bully"), "Jc7d", st, button=0, seat=7, hand_number=80)
        self.assertTrue(is_raise(a))
        _, a = spot(make("f5_nash"), "Jc7d", st, button=0, seat=7, hand_number=80)
        self.assertEqual(a.kind, "fold")

    def test_short_is_tight(self):
        st = [3000, 3000, 3000, 0, 0, 3000, 3000, 700]     # hero 7 bb at 50/100
        _, a = spot(make("f5_bully"), "Kc6d", st, button=0, seat=7, hand_number=80)
        self.assertEqual(a.kind, "fold")


class TestTrapper(unittest.TestCase):
    def test_slowplays_flopped_set(self):
        checks = 0
        for seed in range(30):
            # hero BB (2) calls a button open, first to act on a dry flop with a set
            script = [(0, RaiseTo(50)), (2, Call())]
            _, a = spot(make("f5_trapper"), "7s7d", EIGHT, button=0, seat=2, script=script,
                        board="7cKd2h4s5d", seed=seed)
            checks += a.kind == "check"
        self.assertGreater(checks, 15)

    def test_check_raise(self):
        script = [(0, RaiseTo(50)), (2, Call()), (2, lg_check()), (0, RaiseTo(60))]
        _, a = spot(make("f5_trapper"), "7s7d", EIGHT, button=0, seat=2, script=script,
                    board="7cKd2h4s5d")
        self.assertTrue(is_raise(a))

    def test_calls_down_light_vs_aggressive(self):
        def maniac(bot):
            t = bot.tracker
            t.hands[0], t.pfr[0], t.vpip[0], t.agg[0], t.passive[0] = 100, 60, 70, 80, 5

        def passive(bot):
            t = bot.tracker
            t.hands[0], t.pfr[0], t.vpip[0], t.agg[0], t.passive[0] = 100, 8, 20, 3, 40
        # turn: hero (BB) has middle pair, the button bets 3/4 pot
        script = [(0, RaiseTo(50)), (2, Call()), (2, lg_check()), (0, lg_check()),
                  (2, lg_check()), (0, RaiseTo(80))]
        _, a = spot(make("f5_trapper"), "9c8d", EIGHT, button=0, seat=2, script=script,
                    board="Kd9h3s2c5d", prepare=maniac)
        self.assertEqual(a.kind, "call")
        _, a = spot(make("f5_trapper"), "9c8d", EIGHT, button=0, seat=2, script=script,
                    board="Kd9h3s2c5d", prepare=passive)
        self.assertEqual(a.kind, "fold")


class TestAdapt(unittest.TestCase):
    def _stats(self, t, s, hands, vpip, pfr, agg, passive):
        t.hands[s], t.vpip[s], t.pfr[s], t.agg[s], t.passive[s] = hands, vpip, pfr, agg, passive

    def test_profiles(self):
        from sng.field5.adapt import profile
        t = Tracker(8)
        self._stats(t, 0, 100, 10, 8, 5, 5)
        self._stats(t, 1, 100, 22, 18, 10, 8)
        self._stats(t, 2, 100, 35, 26, 20, 12)
        self._stats(t, 3, 100, 50, 6, 3, 40)
        self._stats(t, 4, 100, 70, 55, 60, 10)
        self.assertEqual([profile(t, s) for s in range(5)], ["nit", "tag", "lag", "station", "maniac"])
        self.assertEqual(profile(t, 5), "unk")

    def test_steals_from_nits(self):
        def nits(bot):
            for s in range(8):
                if s != 0:
                    self._stats(bot.tracker, s, 100, 10, 7, 4, 5)
        _, a = spot(make("f5_adapt"), "Qc5d", EIGHT, button=0, seat=0, prepare=nits)
        self.assertTrue(is_raise(a))
        _, a = spot(make("f5_adapt"), "Qc5d", EIGHT, button=0, seat=0)
        self.assertEqual(a.kind, "fold")

    def test_no_bluff_vs_station_and_resteal_vs_lag(self):
        def station(bot):
            self._stats(bot.tracker, 2, 100, 55, 6, 3, 45)
        for seed in range(10):
            script = [(0, RaiseTo(50)), (2, Call()), (2, lg_check())]
            _, a = spot(make("f5_adapt"), "6s5c", EIGHT, button=0, seat=0, script=script,
                        board="KdQcJh2s3d", seed=seed, prepare=station)
            self.assertEqual(a.kind, "check")

        def lag(bot):
            self._stats(bot.tracker, 0, 100, 38, 30, 20, 12)
        n3 = 0
        for seed in range(20):
            _, a = spot(make("f5_adapt"), "Kh9h", EIGHT, button=0, seat=2,
                        script=[(0, RaiseTo(50))], seed=seed, prepare=lag)
            n3 += is_raise(a)
        self.assertGreater(n3, 8)


if __name__ == "__main__":
    unittest.main()
