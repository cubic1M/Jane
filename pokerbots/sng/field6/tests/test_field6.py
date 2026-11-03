"""Tests for the field6 bots: legality on many tables and card games, determinism, timing,
the shared reads, and one spot per bot showing its signature postflop behaviour."""
from __future__ import annotations

import importlib
import os
import random
import unittest

import numpy as np

from engine.cards import parse_cards
from engine.game import Call, Check, Fold, RaiseTo
from engine.variants import ALL_VARIANTS
from sng.field6.core import PCT, Read, Stats, bubble_factor, hclass, icm_one
from sng.field6.registry import BOTS, FIELDS
from sng.icm import icm
from sng.presets import PRESETS
from sng.rules import SngRules
from sng.table import Hand, play_table
from sng.timescale import factor

NAMES = list(BOTS)


def make(name, **kw):
    mod, cls = BOTS[name]
    return getattr(importlib.import_module(mod), cls)(**kw)


def check_stats(tc, res, lineup):
    for i, n in enumerate(lineup):
        st = res.stats[i]
        tc.assertEqual(st.errors + st.illegal, 0, f"{n}: {st.first_error}")
        tc.assertGreater(st.decisions, 0, n)


# ----------------------------------------------------------------------------- spots
class _Stop(Exception):
    pass


def spot(bot, hole, stacks, button, seat, script=(), board="", seed=1, hand_number=0, prepare=None):
    """Play the real hand engine up to `seat`'s first unscripted decision. `script` is a
    list of (seat, action) taken in order (including the hero's scripted actions); other
    seats fold to a bet and check otherwise. Returns (obs, the bot's action)."""
    rules = SngRules()
    n = len(stacks)
    hc = parse_cards(hole)
    bc = parse_cards(board) if board else []
    rest = [c for c in range(52) if c not in set(hc) | set(bc)]
    deck = []
    for j in range(n):
        deck += hc if j == seat else [rest.pop(), rest.pop()]
    deck += bc + rest
    bot.new_table(rules, seat, seed)
    bot.end_hand(dict(hand_number=-1, deltas=[0] * n, board=(), history=(), showdown=None,
                      stacks=tuple(stacks)))
    if prepare:
        prepare(bot)
    queue = list(script)
    out = {}

    def decide(j, obs, lg):
        if queue and queue[0][0] == j:
            return queue.pop(0)[1]
        if j == seat:
            out["obs"], out["a"] = obs, bot.act(obs)
            raise _Stop
        return Fold() if lg.can_call else lg.passive()

    h = Hand(rules, list(stacks), button, hand_number, deck)
    try:
        h.play(decide, sum(1 for s in stacks if s > 0))
    except _Stop:
        pass
    assert "obs" in out, "the hero never got to act"
    return out["obs"], out["a"]


def is_raise(a):
    return a.kind == "raise"


EIGHT = [2000] * 8
# button 0, SB 1, BB 2, UTG 3 .. CO 7. Preflop pot after BTN opens to 50 and BB calls: 110.
BTN_OPEN_BB_CALL = [(0, RaiseTo(50)), (2, Call())]


# ----------------------------------------------------------------------------- tables
class TestTables(unittest.TestCase):
    def test_mixed_tables(self):
        rules = SngRules()
        for t in range(4):
            rng = np.random.default_rng(t)
            lineup = NAMES + list(rng.choice(NAMES, 3))
            rng.shuffle(lineup)
            res = play_table([make(n) for n in lineup], rules, seed=600 + t)
            check_stats(self, res, lineup)

    def test_with_other_bots(self):
        from sng.registry import make as reg_make
        lineup = NAMES + ["random", "push", "station0"]
        for t in range(3):
            res = play_table([reg_make(n) for n in lineup], SngRules(), seed=700 + t)
            for i, n in enumerate(lineup[:5]):
                st = res.stats[i]
                self.assertEqual(st.errors + st.illegal, 0, f"{n}: {st.first_error}")

    def test_variants_and_discards(self):
        # discard presets and non-hold'em card games: always legal, never an error
        from sng.rules import NLHE
        specs = {k: PRESETS[k]["spec"] for k in ("discard_to_board", "draw_holdem", "draw_after_flop",
                                                  "omaha_discard2", "five_draw")}
        for k in ("d_omaha4x2", "h_plo5", "j_3street", "e_shortdeck", "i_double_discard", "k_irish",
                  "g_pineapple", "c_discard3"):
            specs[k] = ALL_VARIANTS[k]
        specs["pl_nlhe"] = NLHE.with_(betting="pot_limit")
        for spec in specs.values():
            spec = spec.with_(stack_reset_per_hand=False, starting_stack=2000, small_blind=10,
                              big_blind=20, ante=0)
            n = 8
            while spec.hole_cards * n + spec.total_board_dealt > len(spec.deck):
                n -= 1
            rules = SngRules(spec=spec, num_players=n, payouts=SngRules().payouts[:n], max_hands=80)
            lineup = [NAMES[i % 5] for i in range(n)]
            res = play_table([make(x) for x in lineup], rules, seed=11)
            check_stats(self, res, lineup)

    def test_random_rules(self):
        from sng.bughunt import random_rules
        for seed in range(1, 26):
            rng = random.Random(seed)
            rules, pick = random_rules(rng)
            rules = rules.with_(max_hands=min(rules.max_hands, 60))
            lineup = [NAMES[(seed + i) % 5] for i in range(rules.num_players)]
            res = play_table([make(x) for x in lineup], rules, seed=seed)
            for i, x in enumerate(lineup):
                st = res.stats[i]
                self.assertEqual(st.errors + st.illegal, 0, f"{pick} {x}: {st.first_error}")

    def test_deterministic(self):
        rules = SngRules(enforce_time=False)
        lineup = NAMES + NAMES[:3]
        a = play_table([make(n) for n in lineup], rules, seed=42)
        b = play_table([make(n) for n in lineup], rules, seed=42)
        self.assertEqual(a.points, b.points)
        self.assertEqual(a.final_stacks, b.final_stacks)
        self.assertEqual(a.bust_hand, b.bust_hand)
        self.assertEqual(a.hands, b.hands)

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
            self.assertLess(p99, 0.0003 * factor(), f"{n} p99 {p99 * 1e3:.3f} ms")

    def test_registry(self):
        self.assertEqual(set(NAMES), {"f6_checkraiser", "f6_floater", "f6_overbettor",
                                      "f6_riverbluffer", "f6_raiser"})
        self.assertEqual({w for _, w in FIELDS["field6"]}, {1.0})
        from sng.registry import BOTS as ALL
        from sng.registry import field_weights
        for n in NAMES:
            self.assertIn(n, ALL)
        self.assertEqual({n for n, _ in field_weights("field6")}, set(NAMES))


# ------------------------------------------------------------------------------- core
class TestCore(unittest.TestCase):
    def test_icm_matches_reference(self):
        st = [3000, 2500, 2000, 1500, 1000, 800, 500, 4700]
        pays = SngRules().payouts
        ref = icm(st, pays)
        for i in range(8):
            self.assertAlmostEqual(icm_one(st, i, pays), ref[i], places=6)

    def test_bubble_factor(self):
        pays = SngRules().payouts
        st = [3000, 2500, 2000, 1500, 1000, 800, 500, 4700]
        self.assertGreater(bubble_factor(st, 0, 4700, pays), 1.0)
        self.assertEqual(bubble_factor([2000, 2000, 0, 0, 0, 0, 0, 0], 0, 2000, pays), 1.0)
        self.assertEqual(bubble_factor(st, 0, 4700, (100,) + (0,) * 7), 1.0)   # winner takes all

    def test_preflop_order(self):
        self.assertLess(PCT[hclass(*parse_cards("AsAd"))], PCT[hclass(*parse_cards("KsKd"))])
        self.assertLess(PCT[hclass(*parse_cards("AsKs"))], PCT[hclass(*parse_cards("AsKd"))])
        self.assertGreater(PCT[hclass(*parse_cards("7c2d"))], 0.95)

    def test_reads(self):
        def r(h, b, tc=2):
            return Read(parse_cards(h), parse_cards(b), tc)
        self.assertGreaterEqual(r("7s7d", "7cKd2h").made, 0.9)               # set
        self.assertEqual(r("AsAd", "Kh7c2d").pair_kind, "over")
        x = r("Ah5h", "Kh9h4c")
        self.assertTrue(x.fd and x.nfd and x.strong_draw)
        self.assertTrue(r("9c8c", "7d6s2h").oesd)
        self.assertLess(r("6s5s", "AcAd9h9s2c", 0).e, 0.3)                    # board plays
        self.assertGreater(r("AhKh", "Qh7h2h", 1).e, 0.95)                    # nut flush
        self.assertLess(r("6h5d", "8c7d9s", 2).e, 0.9)                        # low end straight
        self.assertLess(r("Tc9d", "8c7d6s4c4h", 0).made, 0.85)                # straight, paired board

    def test_stats_counts_cbet_and_giveup(self):
        st = Stats(8, 3)
        hist = ((1, 0, "post", 10), (2, 0, "post", 20), (3, 0, "fold", 0), (4, 0, "fold", 0),
                (5, 0, "fold", 0), (6, 0, "fold", 0), (7, 0, "raise", 50), (0, 0, "fold", 0),
                (1, 0, "fold", 0), (2, 0, "call", 30),
                (2, 1, "check", 0), (7, 1, "raise", 60), (2, 1, "call", 60),
                (2, 2, "check", 0), (7, 2, "check", 0),
                (2, 3, "raise", 300), (7, 3, "fold", 0))
        st.update(hist, None)
        self.assertEqual((st.opens[7], st.open_opp[7]), (1, 1))
        self.assertEqual((st.cbs[7], st.cb_opp[7]), (1, 1))
        self.assertEqual((st.tcs[7], st.tc_opp[7]), (1, 1))
        self.assertEqual((st.big_fold[7], st.big_opp[7]), (1, 1))          # 300 into 250
        self.assertEqual((st.rv_call[7], st.rv_opp[7]), (0, 1))
        self.assertEqual(st.open_opp[3], 1)
        self.assertEqual(st.opens[3], 0)


# ------------------------------------------------------------------------- preflop
class TestPreflop(unittest.TestCase):
    def test_push_fold_when_short(self):
        st = [160] * 8                                   # 8 bb each
        for n in NAMES:
            _, a = spot(make(n), "7c2d", st, button=0, seat=3)
            self.assertEqual(a.kind, "fold", n)
            obs, a = spot(make(n), "AsAd", st, button=0, seat=3)
            self.assertTrue(is_raise(a) and a.amount == obs.legal.max_raise_to, n)
        hu = [200, 200] + [0] * 6                        # heads-up 10 bb: the SB shoves wide
        obs, a = spot(make("f6_raiser"), "Kh9c", hu, button=0, seat=0)
        self.assertTrue(is_raise(a) and a.amount == obs.legal.max_raise_to)

    def test_deep_open_is_a_raise_not_a_shove(self):
        for n in NAMES:
            _, a = spot(make(n), "AsKd", EIGHT, button=0, seat=3)
            self.assertTrue(is_raise(a) and a.amount <= 60, n)
            _, a = spot(make(n), "8c3d", EIGHT, button=0, seat=3)
            self.assertEqual(a.kind, "fold", n)


def _cbetter(bot, seat=0, n=100, k=95):
    bot.stats.cb_opp[seat], bot.stats.cbs[seat] = n, k


# --------------------------------------------------------------------------- the bots
class TestCheckRaiser(unittest.TestCase):
    def test_checks_set_out_of_position(self):
        checks = sum(spot(make("f6_checkraiser"), "7s7d", EIGHT, button=0, seat=2,
                          script=BTN_OPEN_BB_CALL, board="7cKd2h4s5d", seed=s)[1].kind == "check"
                     for s in range(30))
        self.assertGreater(checks, 18)

    def test_check_raises_strong_hand(self):
        script = BTN_OPEN_BB_CALL + [(2, Check()), (0, RaiseTo(60))]
        _, a = spot(make("f6_checkraiser"), "7s7d", EIGHT, button=0, seat=2, script=script,
                    board="7cKd2h4s5d")
        self.assertTrue(is_raise(a))
        _, a = spot(make("f6_checkraiser"), "Ah5h", EIGHT, button=0, seat=2, script=script,
                    board="Kh9h4c2s5d")                  # nut flush draw
        self.assertTrue(is_raise(a))

    def test_bluff_check_raises_frequent_cbettor(self):
        script = BTN_OPEN_BB_CALL + [(2, Check()), (0, RaiseTo(50))]

        def count(prepare):
            return sum(is_raise(spot(make("f6_checkraiser"), "6s5c", EIGHT, button=0, seat=2,
                                     script=script, board="Kd9h2c8s3d", seed=s, prepare=prepare)[1])
                       for s in range(40))
        vs_cbettor, vs_unknown = count(_cbetter), count(None)
        self.assertGreater(vs_cbettor, 8)
        self.assertLess(vs_unknown, vs_cbettor)


class TestFloater(unittest.TestCase):
    # CO (7) opens, the hero calls on the button (0), the CO c-bets 60 into 130
    FLOP = [(7, RaiseTo(50)), (0, Call()), (7, RaiseTo(60))]

    def test_floats_cbet_in_position(self):
        _, a = spot(make("f6_floater"), "Ad4c", EIGHT, button=0, seat=0, script=self.FLOP,
                    board="Ks7h2d9c3s")
        self.assertEqual(a.kind, "call")
        _, a = spot(make("f6_raiser"), "Ad4c", EIGHT, button=0, seat=0, script=self.FLOP,
                    board="Ks7h2d9c3s")
        self.assertEqual(a.kind, "fold")                 # a normal bot folds ace-high

    def test_bets_turn_when_checked_to(self):
        script = self.FLOP + [(0, Call()), (7, Check())]
        bets = sum(is_raise(spot(make("f6_floater"), "Ad4c", EIGHT, button=0, seat=0, script=script,
                                 board="Ks7h2d9c3s", seed=s)[1]) for s in range(30))
        self.assertGreater(bets, 15)

        def giver(bot):
            bot.stats.tc_opp[7], bot.stats.tcs[7] = 50, 40
        bets_giver = sum(is_raise(spot(make("f6_floater"), "Ad4c", EIGHT, button=0, seat=0, script=script,
                                       board="Ks7h2d9c3s", seed=s, prepare=giver)[1]) for s in range(30))
        self.assertGreaterEqual(bets_giver, bets)


class TestOverbettor(unittest.TestCase):
    # BTN opens, BB calls, flop checks through, BB checks the turn
    TURN = BTN_OPEN_BB_CALL + [(2, Check()), (0, Check()), (2, Check())]

    def test_overbets_nuts_on_turn(self):
        obs, a = spot(make("f6_overbettor"), "7s7d", EIGHT, button=0, seat=0, script=self.TURN,
                      board="7cKd2h4s5d")
        self.assertEqual(obs.street, 2)
        self.assertTrue(is_raise(a))
        self.assertGreaterEqual(a.amount, 1.2 * obs.pot)

    def test_small_bets_medium_hands(self):
        for s in range(20):
            obs, a = spot(make("f6_overbettor"), "Kc9d", EIGHT, button=0, seat=0, script=self.TURN,
                          board="7cKd2h4s5d", seed=s)
            if is_raise(a):
                self.assertLessEqual(a.amount, 0.4 * obs.pot)

    def test_river_bluffs_track_fold_to_big_bets(self):
        river = self.TURN + [(0, Check()), (2, Check())]

        def folder(bot):
            bot.stats.big_opp[2], bot.stats.big_fold[2] = 40, 32

        def caller(bot):
            bot.stats.big_opp[2], bot.stats.big_fold[2] = 40, 4

        def count(prep):
            n = 0
            for s in range(40):
                obs, a = spot(make("f6_overbettor"), "6s5c", EIGHT, button=0, seat=0, script=river,
                              board="KdQh9c2s2h", seed=s, prepare=prep)
                if is_raise(a):
                    self.assertGreaterEqual(a.amount, 1.2 * obs.pot)
                    n += 1
            return n
        self.assertGreater(count(folder), count(caller) + 5)


class TestRiverBluffer(unittest.TestCase):
    # BTN opens, BB calls; BB checks, hero bets the flop, BB calls; turn checks through;
    # BB checks the river
    RIVER = BTN_OPEN_BB_CALL + [(2, Check()), (0, RaiseTo(60)), (2, Call()), (2, Check()), (0, Check()),
                                (2, Check())]

    @staticmethod
    def station(bot):
        bot.stats.rv_opp[2], bot.stats.rv_call[2] = 50, 45
        bot.stats.saw_flop[2], bot.stats.sd[2] = 60, 35

    def test_bluffs_missed_draw_after_turn_check(self):
        def count(prep):
            return sum(is_raise(spot(make("f6_riverbluffer"), "9h8h", EIGHT, button=0, seat=0,
                                     script=self.RIVER, board="Kh7h2c4dQs", seed=s, prepare=prep)[1])
                       for s in range(40))
        self.assertGreater(count(None), 15)
        self.assertEqual(count(self.station), 0)          # never bluff a calling station

    def test_thin_value_vs_station(self):
        _, a = spot(make("f6_riverbluffer"), "Kc5d", EIGHT, button=0, seat=0, script=self.RIVER,
                    board="Kh7h2c4dQs", prepare=self.station)
        self.assertTrue(is_raise(a))
        _, a = spot(make("f6_riverbluffer"), "Kc5d", EIGHT, button=0, seat=0, script=self.RIVER,
                    board="Kh7h2c4dQs")
        self.assertEqual(a.kind, "check")


class TestRaiser(unittest.TestCase):
    def test_raises_flop_bet_with_draws(self):
        script = BTN_OPEN_BB_CALL + [(2, Check()), (0, RaiseTo(60))]
        n = sum(is_raise(spot(make("f6_raiser"), "9h8h", EIGHT, button=0, seat=2, script=script,
                              board="Th7h2c4dQs", seed=s)[1]) for s in range(30))
        self.assertGreater(n, 18)
        base = sum(is_raise(spot(make("f6_floater"), "9h8h", EIGHT, button=0, seat=2, script=script,
                                 board="Th7h2c4dQs", seed=s)[1]) for s in range(30))
        self.assertLess(base, n)

    def test_light_3bets_frequent_opener(self):
        def opener(bot):
            bot.stats.open_opp[0], bot.stats.opens[0] = 100, 45

        def count(prep):
            return sum(is_raise(spot(make("f6_raiser"), "KhQh", EIGHT, button=0, seat=2,
                                     script=[(0, RaiseTo(50))], seed=s, prepare=prep)[1])
                       for s in range(30))
        self.assertGreater(count(opener), 18)
        self.assertEqual(count(None), 0)

    def test_folds_to_4bet(self):
        for hole, want in (("AhKd", "fold"), ("QsQh", "fold"), ("KsKd", "raise")):
            for four in (360, 2000):                     # a 4-bet and a 4-bet jam
                script = [(7, RaiseTo(50)), (0, RaiseTo(150)), (7, RaiseTo(four))]
                _, a = spot(make("f6_raiser"), hole, EIGHT, button=0, seat=0, script=script)
                got = "raise" if is_raise(a) or (four == 2000 and a.kind == "call") else a.kind
                self.assertEqual(got, want, (hole, four))


if __name__ == "__main__":
    unittest.main()
