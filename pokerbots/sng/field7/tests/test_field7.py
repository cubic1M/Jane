"""Tests for the field7 bots: legality on many tables and card games, determinism, timing,
the shared machinery, ICM sanity when short, and one signature spot per bot."""
from __future__ import annotations

import importlib
import os
import random
import unittest

import numpy as np

from engine.cards import parse_cards
from engine.evaluator import get_evaluator
from engine.game import Call, Check, Fold, RaiseTo
from engine.variants import ALL_VARIANTS
from sng.field7.core import (PCT, Post, Stats, bubble_factors, call_frac, eq_top, hclass, icm_one,
                             score_cards)
from sng.field7.registry import BOTS, FIELDS
from sng.icm import icm
from sng.presets import PRESETS
from sng.rules import NLHE, SngRules
from sng.table import Hand, play_table
from sng.timescale import factor

NAMES = list(BOTS)


def make(name, **kw):
    mod, cls = BOTS[name]
    return getattr(importlib.import_module(mod), cls)(**kw)


def check_stats(tc, res, lineup, label=""):
    for i, n in enumerate(lineup):
        st = res.stats[i]
        tc.assertEqual(st.errors + st.illegal, 0, f"{label} {n}: {st.first_error}")
        tc.assertGreater(st.decisions, 0, n)


# ----------------------------------------------------------------------------- spots
class _Stop(Exception):
    pass


def spot(bot, hole, stacks, button, seat, script=(), board="", seed=1, hand_number=0, prepare=None,
         rules=None):
    """Play the real hand engine up to `seat`'s first unscripted decision. `script` is a
    list of (seat, action) taken in order (including the hero's scripted actions); other
    seats fold to a bet and check otherwise. Returns (obs, the bot's action)."""
    rules = rules or SngRules()
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


def is_shove(obs, a):
    return is_raise(a) and a.amount == obs.legal.max_raise_to


def count(fn, seeds=40):
    return sum(1 for s in range(seeds) if fn(s))


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
            res = play_table([make(n) for n in lineup], rules, seed=900 + t)
            check_stats(self, res, lineup)

    def test_with_other_bots(self):
        from sng.registry import make as reg_make
        lineup = NAMES + ["random", "push", "station0"]
        for t in range(3):
            res = play_table([reg_make(n) for n in lineup], SngRules(), seed=910 + t)
            for i, n in enumerate(lineup[:5]):
                st = res.stats[i]
                self.assertEqual(st.errors + st.illegal, 0, f"{n}: {st.first_error}")

    def test_with_field6(self):
        from sng.registry import make as reg_make
        lineup = NAMES[:4] + ["f6_raiser", "f6_floater", "f6_overbettor", "f6_checkraiser"]
        res = play_table([reg_make(n) for n in lineup], SngRules(), seed=920)
        check_stats(self, res, lineup[:4])

    def test_variants_and_discards(self):
        # discard presets and non-hold'em card games: always legal, never an error
        specs = {k: PRESETS[k]["spec"] for k in ("discard_to_board", "draw_holdem", "draw_after_flop",
                                                  "omaha_discard2", "five_draw")}
        for k in ("d_omaha4x2", "h_plo5", "j_3street", "e_shortdeck", "i_double_discard", "k_irish",
                  "g_pineapple", "c_discard3", "n_plo4"):
            specs[k] = ALL_VARIANTS[k]
        specs["pl_nlhe"] = NLHE.with_(betting="pot_limit")
        for name, spec in specs.items():
            spec = spec.with_(stack_reset_per_hand=False, starting_stack=2000, small_blind=10,
                              big_blind=20, ante=0)
            n = 8
            while spec.hole_cards * n + spec.total_board_dealt > len(spec.deck):
                n -= 1
            rules = SngRules(spec=spec, num_players=n, payouts=SngRules().payouts[:n], max_hands=80)
            lineup = [NAMES[i % 5] for i in range(n)]
            res = play_table([make(x) for x in lineup], rules, seed=11)
            check_stats(self, res, lineup, name)

    def test_rehearsal_preset_with_antes(self):
        rules = SngRules(**PRESETS["rehearsal_sixplus"])
        lineup = NAMES + NAMES[:3]
        res = play_table([make(x) for x in lineup], rules, seed=5)
        check_stats(self, res, lineup)

    def test_random_rules(self):
        from sng.bughunt import random_rules
        for seed in range(1, 31):
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
        c = play_table([make(n) for n in lineup], rules, seed=43)
        self.assertNotEqual((a.points, a.hands), (c.points, c.hands))

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
        self.assertEqual(set(NAMES), {"f7_balanced", "f7_bully", "f7_trickster", "f7_hackathon",
                                      "f7_profiler"})
        self.assertEqual({w for _, w in FIELDS["field7"]}, {1.0})
        from sng.registry import BOTS as ALL
        from sng.registry import field_weights
        for n in NAMES:
            self.assertIn(n, ALL)
        self.assertEqual({n for n, _ in field_weights("field7")}, set(NAMES))

    def test_survives_broken_end_hand_input(self):
        for n in NAMES:
            b = make(n)
            b.new_table(SngRules(), 0, 1)
            b.end_hand({})                              # missing keys: no exception
            b.end_hand(dict(history=((99, 0, "raise", 5),), showdown={99: (1, 2)}, stacks=(0,) * 8))


# ------------------------------------------------------------------------------- core
class TestCore(unittest.TestCase):
    def test_icm_matches_reference(self):
        st = [3000, 2500, 2000, 1500, 1000, 800, 500, 4700]
        pays = SngRules().payouts
        ref = icm(st, pays)
        for i in range(8):
            self.assertAlmostEqual(icm_one(st, i, pays), ref[i], places=6)

    def test_bubble_factors(self):
        pays = SngRules().payouts
        st = [3000, 2500, 2000, 1500, 1000, 800, 500, 4700]
        mine, theirs = bubble_factors(st, 7, 6, pays, True)    # big stack vs the shortest
        self.assertGreaterEqual(mine, 1.0)
        self.assertGreater(theirs, mine)                       # the covered stack risks more
        a, _ = bubble_factors(st, 0, 7, pays, False)
        self.assertGreater(a, 1.0)
        self.assertEqual(bubble_factors(st, 0, 7, (100,) + (0,) * 7, True), (1.0, 1.0))  # winner takes all

    def test_score_matches_engine(self):
        ev = get_evaluator(NLHE)
        rng = np.random.default_rng(5)
        for k in (5, 6, 7):
            cs = [[int(x) for x in rng.permutation(52)[:k]] for _ in range(1500)]
            ref = ev.eval_any(np.array(cs))
            mine = np.array([score_cards(c) for c in cs])
            self.assertTrue((np.sign(ref[:-1] - ref[1:]) == np.sign(mine[:-1] - mine[1:])).all())
            self.assertTrue(((ref >> 20) - 1 == mine >> 20).all())

    def test_preflop_tables(self):
        self.assertLess(PCT[hclass(*parse_cards("AsAd"))], PCT[hclass(*parse_cards("KsKd"))])
        self.assertLess(PCT[hclass(*parse_cards("AsKs"))], PCT[hclass(*parse_cards("AsKd"))])
        self.assertGreater(PCT[hclass(*parse_cards("7c2d"))], 0.95)
        aa = hclass(*parse_cards("AsAd"))
        self.assertGreater(eq_top(0.5, aa), 0.8)
        # a caller continues wider against a wider shove and at a better price
        self.assertGreater(call_frac(0.5, 0.45), call_frac(0.1, 0.45))
        self.assertGreater(call_frac(0.3, 0.35), call_frac(0.3, 0.5))

    def test_reads(self):
        def r(h, b, tc=2):
            return Post(parse_cards(h), parse_cards(b), tc)
        self.assertGreaterEqual(r("7s7d", "7cKd2h").made, 0.9)               # set
        self.assertGreater(r("AsAd", "Kh7c2d").e, r("AdKc", "Ks7h2d").e)     # overpair > top pair
        self.assertGreater(r("AdKc", "Ks7h2d").e, r("Kc5d", "Ks7h2d").e)     # kicker
        x = r("Ah5h", "Kh9h4c")
        self.assertTrue(x.fd and x.nfd and x.strong_draw)
        self.assertTrue(r("9c8c", "7d6s2h").oesd)
        self.assertLess(r("6s5s", "AcAd9h9s2c", 0).e, 0.3)                    # board plays
        self.assertGreater(r("AhKh", "Qh7h2h", 1).e, 0.95)                    # nut flush
        self.assertLess(r("6h5d", "8c7d9s", 2).e, r("Jh Td", "8c7d9s", 2).e)  # low end straight
        self.assertLess(r("Ad4c", "Ks7h2d").e, 0.35)

    def test_stats(self):
        st = Stats(8, 3)
        # UTG (3) limps, CO (7) opens, BB (2) 3-bets, CO folds;
        hist = ((1, 0, "post", 10), (2, 0, "post", 20), (3, 0, "call", 20), (4, 0, "fold", 0),
                (5, 0, "fold", 0), (6, 0, "fold", 0), (7, 0, "raise", 60), (0, 0, "fold", 0),
                (1, 0, "fold", 0), (2, 0, "raise", 200), (3, 0, "fold", 0), (7, 0, "fold", 0))
        st.update(hist, None)
        self.assertEqual((st.limps[3], st.open_opp[3]), (1, 1))
        self.assertEqual((st.opens[7], st.open_opp[7], st.limp_opp[7]), (0, 0, 1))  # an iso-raise is not an open
        self.assertEqual((st.tbs[2], st.tb_opp[2]), (1, 1))
        # BTN (0) opens, BB (2) calls; BB checks, BTN c-bets, BB folds; showdown hand recorded
        st2 = Stats(8, 3)
        hist = ((1, 0, "post", 10), (2, 0, "post", 20), (3, 0, "fold", 0), (4, 0, "fold", 0),
                (5, 0, "fold", 0), (6, 0, "fold", 0), (7, 0, "fold", 0), (0, 0, "raise", 50),
                (1, 0, "fold", 0), (2, 0, "call", 30), (2, 1, "check", 0), (0, 1, "raise", 40),
                (2, 1, "fold", 0))
        st2.update(hist, None)
        self.assertEqual((st2.opens[0], st2.cbs[0], st2.cb_opp[0]), (1, 1, 1))
        self.assertEqual((st2.fcb[2], st2.fcb_opp[2]), (1, 1))
        # opener faces a 3-bet and folds
        st3 = Stats(8, 3)
        hist = ((1, 0, "post", 10), (2, 0, "post", 20), (0, 0, "raise", 50), (1, 0, "raise", 160),
                (2, 0, "fold", 0), (0, 0, "fold", 0))
        st3.update(hist, None)
        self.assertEqual((st3.f3[0], st3.f3_opp[0]), (1, 1))
        st3.update(((1, 0, "post", 10), (2, 0, "post", 20), (0, 0, "raise", 50), (1, 0, "call", 40),
                    (2, 0, "fold", 0)), {0: tuple(parse_cards("7c6c")), 1: tuple(parse_cards("AsKd"))})
        self.assertAlmostEqual(st3.shown_open[0], PCT[hclass(*parse_cards("7c6c"))])
        self.assertEqual(st3.sd[1], 1)


# ------------------------------------------------------------------------- preflop
class TestPreflop(unittest.TestCase):
    def test_push_fold_when_short(self):
        st = [160] * 8                                   # 8 bb each
        for n in NAMES:
            _, a = spot(make(n), "7c2d", st, button=0, seat=3)
            self.assertEqual(a.kind, "fold", n)
            obs, a = spot(make(n), "AsAd", st, button=0, seat=3)
            self.assertTrue(is_shove(obs, a), n)
        hu = [200, 200] + [0] * 6                        # heads-up 10 bb: the SB shoves wide
        for n in ("f7_balanced", "f7_bully", "f7_profiler"):
            obs, a = spot(make(n), "Kh9c", hu, button=0, seat=0)
            self.assertTrue(is_shove(obs, a), n)

    def test_deep_open_is_a_raise_not_a_shove(self):
        for n in NAMES:
            _, a = spot(make(n), "AsKd", EIGHT, button=0, seat=3)
            self.assertTrue(is_raise(a) and a.amount <= 60, n)
            _, a = spot(make(n), "8c3d", EIGHT, button=0, seat=3)
            self.assertEqual(a.kind, "fold", n)

    def test_icm_tightens_calls_on_the_bubble(self):
        # four left, a big stack shoves into a mid stack: with the paid ladder the mid stack
        # folds a hand it calls when only chips count (winner takes all)
        stacks = [6000, 1500, 0, 0, 0, 1500, 0, 3000]   # BTN 0 (big), SB 1, BB 5 (hero), CO 7
        script = [(7, Fold()), (0, RaiseTo(6000)), (1, Fold())]
        ladder = SngRules(payouts=(100, 65, 45, 30, 20, 12, 6, 0), blinds=((100, 200),))
        wta = SngRules(payouts=(100, 0, 0, 0, 0, 0, 0, 0), blinds=((100, 200),))
        for n in NAMES:
            _, a = spot(make(n), "Kc9d", stacks, button=0, seat=5, script=script, rules=ladder)
            self.assertEqual(a.kind, "fold", n)
            _, a = spot(make(n), "AsAd", stacks, button=0, seat=5, script=script, rules=ladder)
            self.assertNotEqual(a.kind, "fold", n)
            if n == "f7_hackathon":
                continue        # its shove-range model is cruder (shover's stack, not the effective one)
            _, a = spot(make(n), "Kc9d", stacks, button=0, seat=5, script=script, rules=wta)
            self.assertNotEqual(a.kind, "fold", n)


# --------------------------------------------------------------------------- the bots
class TestBalanced(unittest.TestCase):
    CO_OPEN = [(7, RaiseTo(50))]

    def test_bluff_3bets_suited_wheel_aces_at_a_mixed_frequency(self):
        def bluff(s):
            return is_raise(spot(make("f7_balanced"), "As5s", EIGHT, button=0, seat=0,
                                 script=self.CO_OPEN, seed=s)[1])
        n = count(bluff)
        self.assertGreater(n, 5)
        self.assertLess(n, 38)
        for s in range(10):
            _, a = spot(make("f7_balanced"), "AsAd", EIGHT, button=0, seat=0, script=self.CO_OPEN, seed=s)
            self.assertTrue(is_raise(a))                 # value 3-bet always
            _, a = spot(make("f7_balanced"), "Kd7c", EIGHT, button=0, seat=0, script=self.CO_OPEN, seed=s)
            self.assertEqual(a.kind, "fold")

    def test_calls_3bet_in_position_with_a_pair_when_deep(self):
        script = [(0, RaiseTo(50)), (2, RaiseTo(180))]  # BTN opens, BB 3-bets
        _, a = spot(make("f7_balanced"), "7s7d", EIGHT, button=0, seat=0, script=script)
        self.assertEqual(a.kind, "call")
        short = [600] * 8
        _, a = spot(make("f7_balanced"), "7s7d", short, button=0, seat=0, script=script)
        self.assertNotEqual(a.kind, "call")              # not at 30 bb

    def test_4bets_value_and_some_bluffs(self):
        script = [(0, RaiseTo(50)), (2, RaiseTo(180))]
        deep = [4000] * 8
        _, a = spot(make("f7_balanced"), "KsKd", deep, button=0, seat=0, script=script)
        self.assertTrue(is_raise(a))
        n = count(lambda s: is_raise(spot(make("f7_balanced"), "As5s", deep, button=0, seat=0,
                                          script=script, seed=s)[1]))
        self.assertGreater(n, 5)
        self.assertLess(n, 35)


class TestBully(unittest.TestCase):
    # level 5 (75/150): hero on the button covers everyone; two micro stacks keep the
    # medium stacks (both blinds) under ICM pressure
    BIG = [7000, 1500, 1400, 300, 250, 1600, 1500, 1350]
    HANDS = ["Qc4d", "Jd5c", "Ts3h", "9c4c", "Kd2s", "8h6c"]

    def test_bullies_medium_stacks_on_the_bubble(self):
        bully = sum(is_raise(spot(make("f7_bully"), h, self.BIG, button=0, seat=0, hand_number=100)[1])
                    for h in self.HANDS)
        tag = sum(is_raise(spot(make("f7_balanced"), h, self.BIG, button=0, seat=0, hand_number=100)[1])
                  for h in self.HANDS)
        self.assertGreaterEqual(bully, 5)
        self.assertLessEqual(tag, 1)

    def test_tightens_when_short_and_covered(self):
        short = [900, 1500, 1400, 7000, 1600, 1500, 1350, 1250]   # hero BTN with 6 bb
        _, a = spot(make("f7_bully"), "Qc4d", short, button=0, seat=0, hand_number=100)
        self.assertEqual(a.kind, "fold")
        obs, a = spot(make("f7_bully"), "Ah9d", short, button=0, seat=0, hand_number=100)
        self.assertTrue(is_shove(obs, a))


class TestTrickster(unittest.TestCase):
    def test_limps_or_min_raises_aces_early(self):
        def tricky(s):
            obs, a = spot(make("f7_trickster"), "AsAd", EIGHT, button=0, seat=3, seed=s)
            return a.kind == "call" or (is_raise(a) and a.amount <= 2 * obs.big_blind)
        self.assertGreater(count(tricky), 24)
        # an ordinary opener raises aces to a normal size
        _, a = spot(make("f7_balanced"), "AsAd", EIGHT, button=0, seat=3)
        self.assertTrue(is_raise(a) and a.amount > 40)

    def test_flats_aces_against_an_open_sometimes(self):
        n = count(lambda s: spot(make("f7_trickster"), "AsAd", EIGHT, button=0, seat=0,
                                 script=[(7, RaiseTo(50))], seed=s)[1].kind == "call")
        self.assertGreater(n, 8)
        self.assertLess(n, 34)

    def test_slow_plays_flop_and_check_raises_turn(self):
        # hero in the BB with a set after BTN open / BB call
        checks = count(lambda s: spot(make("f7_trickster"), "7s7d", EIGHT, button=0, seat=2,
                                      script=BTN_OPEN_BB_CALL, board="7cKd2h4s5d", seed=s)[1].kind == "check")
        self.assertGreater(checks, 14)
        turn = BTN_OPEN_BB_CALL + [(2, Check()), (0, RaiseTo(40)), (2, Call()), (2, Check()), (0, RaiseTo(100))]
        _, a = spot(make("f7_trickster"), "7s7d", EIGHT, button=0, seat=2, script=turn, board="7cKd2h4s5d")
        self.assertTrue(is_raise(a))


class TestHackathon(unittest.TestCase):
    def test_monte_carlo_equity(self):
        bot = make("f7_hackathon")
        obs, a = spot(bot, "AsAd", EIGHT, button=0, seat=2, script=BTN_OPEN_BB_CALL, board="Kh7c2d4s5d")
        from sng.field7.core import Ctx
        c = Ctx(obs, 3)
        bot.p["samples"] = 200
        self.assertGreater(bot.mc_equity(c), 0.6)
        obs, _ = spot(bot, "8s3d", EIGHT, button=0, seat=2, script=BTN_OPEN_BB_CALL, board="Kh7c2dQsJd")
        self.assertLess(bot.mc_equity(Ctx(obs, 3)), 0.3)

    def test_time_guard_stops_sampling(self):
        bot = make("f7_hackathon", budget=0.0, samples=400)
        obs, _ = spot(bot, "AsAd", EIGHT, button=0, seat=2, script=BTN_OPEN_BB_CALL, board="Kh7c2d4s5d")
        from sng.field7.core import Ctx
        import time
        t0 = time.perf_counter()
        bot.mc_equity(Ctx(obs, 3))
        self.assertLess(time.perf_counter() - t0, 0.002)  # 4 samples, not 400

    def test_bets_in_proportion_to_equity(self):
        flop = BTN_OPEN_BB_CALL + [(2, Check())]
        obs, nuts = spot(make("f7_hackathon"), "KsKc", EIGHT, button=0, seat=0, script=flop,
                         board="Kh7c2d4s5d")
        _, mid = spot(make("f7_hackathon"), "Ah7d", EIGHT, button=0, seat=0, script=flop,
                      board="Kh7c2d4s5d")
        self.assertTrue(is_raise(nuts))
        self.assertTrue(not is_raise(mid) or mid.amount < nuts.amount)

    def test_pot_odds_call(self):
        # flush draw facing a quarter-pot bet calls, facing a 3x pot overbet folds
        small = BTN_OPEN_BB_CALL + [(2, Check()), (0, RaiseTo(30))]
        big = BTN_OPEN_BB_CALL + [(2, Check()), (0, RaiseTo(330))]
        board = "Kh7h2c4dQs"
        # (a couple of dozen Monte Carlo samples per decision: count over seeds; untimed so the
        # time guard does not cut the sampling short on a cold first call)
        untimed = SngRules(enforce_time=False)
        calls = count(lambda s: spot(make("f7_hackathon"), "9h8h", EIGHT, button=0, seat=2, script=small,
                                     board=board, seed=s, rules=untimed)[1].kind == "call", 20)
        folds = count(lambda s: spot(make("f7_hackathon"), "9h8h", EIGHT, button=0, seat=2, script=big,
                                     board=board, seed=s, rules=untimed)[1].kind == "fold", 20)
        self.assertGreaterEqual(calls, 17)
        self.assertGreaterEqual(folds, 14)


class TestProfiler(unittest.TestCase):
    @staticmethod
    def wide_folder(bot):
        st = bot.stats
        st.hands[0], st.open_opp[0], st.opens[0] = 100, 100, 50
        st.f3_opp[0], st.f3[0] = 20, 17
        st.vpip[0], st.pfr[0] = 55, 50

    @staticmethod
    def nit(bot):
        st = bot.stats
        st.hands[0], st.open_opp[0], st.opens[0] = 100, 100, 7
        st.vpip[0], st.pfr[0] = 8, 7

    @staticmethod
    def station(bot):
        st = bot.stats
        st.hands[2], st.vpip[2], st.pfr[2] = 80, 50, 6
        st.fcb_opp[2], st.fcb[2] = 30, 3
        st.rv_opp[2], st.rv_call[2] = 30, 27
        st.saw_flop[2], st.sd[2] = 45, 25

    def test_3bets_wide_opener_who_folds_to_3bets(self):
        for hole in ("Kd9c", "Qh8h", "Ac3d"):
            _, a = spot(make("f7_profiler"), hole, EIGHT, button=0, seat=2, script=[(0, RaiseTo(50))],
                        prepare=self.wide_folder)
            self.assertTrue(is_raise(a), hole)
            _, a = spot(make("f7_profiler"), hole, EIGHT, button=0, seat=2, script=[(0, RaiseTo(50))])
            self.assertFalse(is_raise(a), hole)

    def test_folds_to_a_nits_raise(self):
        _, a = spot(make("f7_profiler"), "AdJc", EIGHT, button=0, seat=2, script=[(0, RaiseTo(50))],
                    prepare=self.nit)
        self.assertEqual(a.kind, "fold")
        _, a = spot(make("f7_profiler"), "AdJc", EIGHT, button=0, seat=2, script=[(0, RaiseTo(50))])
        self.assertNotEqual(a.kind, "fold")

    def test_value_bets_thin_and_never_bluffs_a_station(self):
        river = BTN_OPEN_BB_CALL + [(2, Check()), (0, Check()), (2, Check()), (0, Check()), (2, Check())]
        _, a = spot(make("f7_profiler"), "Kc5d", EIGHT, button=0, seat=0, script=river,
                    board="Kh7h2c4dQs", prepare=self.station)
        self.assertTrue(is_raise(a))
        bluffs = count(lambda s: is_raise(spot(make("f7_profiler"), "6s5c", EIGHT, button=0, seat=0,
                                               script=river, board="KdQh9c2s2h", seed=s,
                                               prepare=self.station)[1]), 30)
        self.assertEqual(bluffs, 0)

    def test_iso_raises_limpers(self):
        def limper(bot):
            st = bot.stats
            st.hands[3], st.limp_opp[3], st.limps[3], st.vpip[3] = 60, 60, 30, 35
        _, a = spot(make("f7_profiler"), "Kd9c", EIGHT, button=0, seat=0, script=[(3, Call())],
                    prepare=limper)
        self.assertTrue(is_raise(a))


if __name__ == "__main__":
    unittest.main()
