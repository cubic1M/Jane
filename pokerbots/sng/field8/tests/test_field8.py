"""Tests for the field8 bots: legality on many tables and card games (discard, split-pot,
fixed-limit and non-hold'em presets), determinism, timing, the shared machinery (evaluator,
postflop key, ICM, opponent stats, offline tables) and one signature spot per bot."""
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
from sng.field8 import tables as T
from sng.field8.hands import MADE_NAMES, choose_discard, hclass, made_and_draw, post_key, score
from sng.field8.icm8 import IcmState, icm_batch
from sng.field8.model import Stats
from sng.field8.registry import BOTS, FIELDS
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
        tc.assertGreater(st.decisions, 0, f"{label} {n}")


def h(s):
    return hclass(*parse_cards(s))


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
    bot.end_hand(dict(hand_number=hand_number - 1, deltas=[0] * n, board=(), history=(), showdown=None,
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

    hd = Hand(rules, list(stacks), button, hand_number, deck)
    try:
        hd.play(decide, sum(1 for s in stacks if s > 0))
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
            res = play_table([make(n) for n in lineup], rules, seed=800 + t)
            check_stats(self, res, lineup)
            self.assertEqual(sum(res.final_stacks), 8 * 2000)

    def test_with_other_bots(self):
        from sng.registry import make as reg_make
        lineup = NAMES + ["random", "push", "station0"]
        for t in range(3):
            res = play_table([reg_make(n) for n in lineup], SngRules(), seed=810 + t)
            for i, n in enumerate(lineup[:5]):
                st = res.stats[i]
                self.assertEqual(st.errors + st.illegal, 0, f"{n}: {st.first_error}")

    def test_with_field7(self):
        from sng.registry import make as reg_make
        lineup = NAMES[:4] + ["f7_balanced", "f7_bully", "f7_trickster", "f7_profiler"]
        res = play_table([reg_make(n) for n in lineup], SngRules(), seed=820)
        check_stats(self, res, lineup[:4])

    def _spec_tables(self, specs, hands=80):
        for name, spec in specs.items():
            spec = spec.with_(stack_reset_per_hand=False, starting_stack=2000, small_blind=10,
                              big_blind=20, ante=0)
            n = 8
            while spec.hole_cards * n + spec.total_board_dealt > len(spec.deck):
                n -= 1
            rules = SngRules(spec=spec, num_players=n, payouts=SngRules().payouts[:n], max_hands=hands)
            lineup = [NAMES[i % 5] for i in range(n)]
            res = play_table([make(x) for x in lineup], rules, seed=11)
            check_stats(self, res, lineup, name)
            self.assertEqual(sum(res.final_stacks), n * 2000, name)

    def test_discard_presets(self):
        self._spec_tables({k: PRESETS[k]["spec"] for k in ("discard_to_board", "draw_holdem", "draw_after_flop",
                                                            "omaha_discard2", "five_draw")})

    def test_split_pot_presets(self):
        self._spec_tables({k: PRESETS[k]["spec"] for k in ("holdem_hilo8", "double_board", "omaha_hilo8",
                                                            "holdem_wild2")})

    def test_fixed_limit_and_pot_limit(self):
        self._spec_tables({"fixed_limit": PRESETS["fixed_limit"]["spec"],
                           "pl_nlhe": NLHE.with_(betting="pot_limit")}, hands=120)

    def test_other_variants(self):
        self._spec_tables({k: ALL_VARIANTS[k] for k in ("d_omaha4x2", "h_plo5", "j_3street", "e_shortdeck",
                                                        "i_double_discard", "k_irish", "g_pineapple",
                                                        "c_discard3", "n_plo4")})

    def test_rehearsal_and_kit_presets_with_antes(self):
        for p in ("rehearsal_sixplus", "kit4_sixplus", "bounty10"):
            rules = SngRules(**PRESETS[p])
            lineup = NAMES + NAMES[:3]
            res = play_table([make(x) for x in lineup], rules, seed=5)
            check_stats(self, res, lineup, p)

    def test_random_rules(self):
        from sng.bughunt import random_rules
        for seed in range(1, 41):
            rng = random.Random(seed)
            rules, pick = random_rules(rng)
            rules = rules.with_(max_hands=min(rules.max_hands, 60))
            lineup = [NAMES[(seed + i) % 5] for i in range(rules.num_players)]
            res = play_table([make(x) for x in lineup], rules, seed=seed)
            for i, x in enumerate(lineup):
                st = res.stats[i]
                self.assertEqual(st.errors + st.illegal, 0, f"{pick} {x}: {st.first_error}")

    def test_short_handed_and_heads_up_tables(self):
        for n in (2, 3, 5):
            rules = SngRules(num_players=n, payouts=SngRules().payouts[:n])
            lineup = [NAMES[i % 5] for i in range(n)]
            for seed in range(3):
                res = play_table([make(x) for x in lineup], rules, seed=60 + seed)
                check_stats(self, res, lineup, f"{n}-handed")

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
        self.assertEqual(set(NAMES), {"f8_nash", "f8_solver", "f8_adaptive", "f8_endgame", "f8_ensemble"})
        self.assertEqual({w for _, w in FIELDS["field8"]}, {1.0})
        from sng.registry import BOTS as ALL
        from sng.registry import field_weights
        for n in NAMES:
            self.assertIn(n, ALL)
        self.assertEqual({n for n, _ in field_weights("field8")}, set(NAMES))

    def test_survives_broken_end_hand_input(self):
        for n in NAMES:
            b = make(n)
            b.new_table(SngRules(), 0, 1)
            b.end_hand({})                              # missing keys: no exception
            b.end_hand(None)
            b.end_hand(dict(history=((99, 0, "raise", 5), "junk"), showdown={99: (1, 2)}, stacks=(0,) * 8))
            obs, a = spot(b, "AsKd", EIGHT, button=0, seat=3)
            self.assertTrue(obs.legal.is_legal(a))

    def test_handles_discards_flag(self):
        for n in NAMES:
            self.assertTrue(getattr(make(n), "handles_discards", False))


# ------------------------------------------------------------------------------- core
class TestCore(unittest.TestCase):
    def test_score_matches_engine(self):
        ev = get_evaluator(NLHE)
        rng = np.random.default_rng(5)
        for k in (5, 6, 7):
            cs = [[int(x) for x in rng.permutation(52)[:k]] for _ in range(3000)]
            ref = ev.eval_any(np.array(cs))
            mine = np.array([score(c) for c in cs])
            self.assertTrue((np.sign(ref[:-1] - ref[1:]) == np.sign(mine[:-1] - mine[1:])).all())
            self.assertTrue(((ref >> 20) - 1 == mine >> 20).all())

    def test_post_key_classes(self):
        def made(hole, board):
            return MADE_NAMES[made_and_draw(*parse_cards(hole), parse_cards(board))[0]]
        self.assertEqual(made("AsKd", "Kh7c2d"), "top_pair_top")
        self.assertEqual(made("AsAd", "Kh7c2d"), "overpair_big")
        self.assertEqual(made("7s7d", "7cKd2h"), "set")
        self.assertEqual(made("KcQc", "KdQh2s"), "top_two")
        self.assertEqual(made("AhKh", "Qh7h2h"), "nut_flush")
        self.assertEqual(made("6s5s", "AcAd9h9s2c"), "air_0over")        # the board plays
        _, draw, *_ = made_and_draw(*parse_cards("Ah5h"), parse_cards("Kh9h4c"))
        self.assertEqual(draw, 4)                                          # nut flush draw
        _, draw, *_ = made_and_draw(*parse_cards("9c8c"), parse_cards("7d6s2h"))
        self.assertEqual(draw, 2)                                          # open-ended

    def test_postflop_table_is_calibrated(self):
        def e(hole, board, col=0):
            return T.POST[post_key(parse_cards(hole), parse_cards(board))][col]
        self.assertGreater(e("7s7d", "7cKd2h"), 0.9)
        self.assertGreater(e("AsKd", "Kh7c2d"), e("Kc5d", "Kh7c2d"))
        self.assertGreater(e("AsAd", "Kh7c2d"), e("Ad4c", "Ks7h2d"))
        self.assertLess(e("6s5c", "KdQh9c2s2h"), 0.3)
        row = T.POST[post_key(parse_cards("AsKd"), parse_cards("Kh7c2d"))]
        self.assertGreater(row[0], row[2])          # random > top 20%
        self.assertGreater(row[3], row[5])          # continuing range > strong range

    def test_icm_matches_reference(self):
        pays = SngRules().payouts
        for st in ([3000, 2500, 2000, 1500, 1000, 800, 500, 4700], [5000, 3000, 1000], [100, 15900]):
            ref = icm(st, pays[:len(st)])
            mine = icm_batch(np.array([st]), pays[:len(st)])[0]
            self.assertTrue(np.allclose(ref, mine), st)
        # a zero stack has busted now: it gets the place below the survivors
        st = [3000, 0, 2000, 1500, 1000, 800, 500, 4700]
        self.assertTrue(np.allclose(icm_batch(np.array([st]), pays)[0], icm(st, pays)))

    def test_bubble_factors(self):
        s = IcmState(8)
        s.update([16000 - 900, 300, 300, 300, 0, 0, 0, 0], 0, (50, 30, 20, 0), 4)
        self.assertTrue(s.ready)
        self.assertLess(s.bf_me[1], 1.2)            # the big stack risks little
        self.assertGreater(s.bf_opp[1], 1.5)        # the short stacks risk a lot against it
        s.update([2000] * 8, 0, SngRules().payouts, 8)
        self.assertGreater(s.bf_me[3], 1.3)         # this point table punishes the first bust

    def test_preflop_tables(self):
        self.assertLess(T.PCT[h("AsAd")], T.PCT[h("KsKd")])
        self.assertLess(T.PCT[h("AsKs")], T.PCT[h("AsKd")])
        self.assertGreater(T.PCT[h("7c2d")], 0.95)
        self.assertAlmostEqual(float(T.EQ[h("AsAd"), h("KsKd")]), 0.82, delta=0.02)
        self.assertGreater(T.eq_top(0.5, h("AsAd")), 0.8)
        self.assertGreater(T.call_width(0.5, 0.45), T.call_width(0.1, 0.45))

    def test_push_fold_equilibrium(self):
        # heads-up chip-EV at 10 bb: the small blind shoves about 58%, the big blind calls about 37%
        self.assertAlmostEqual(T.pf_push_width(1, 10.0, 1.0, 1.0), 0.58, delta=0.04)
        self.assertAlmostEqual(T.pf_callfrac(1, 10.0, 1.0, 1.0, 0), 0.37, delta=0.04)
        # more players behind: tighter; deeper: tighter
        for nb in range(1, 7):
            self.assertGreater(T.pf_push_width(nb, 10.0, 1.0, 1.0), T.pf_push_width(nb + 1, 10.0, 1.0, 1.0))
        self.assertGreater(T.pf_push_width(4, 6.0, 1.0, 1.0), T.pf_push_width(4, 14.0, 1.0, 1.0))
        # ICM: a caller under pressure calls less, so the pusher shoves wider; a pusher under
        # pressure shoves tighter
        self.assertGreater(T.pf_push_width(4, 10.0, 1.0, 1.75), T.pf_push_width(4, 10.0, 1.0, 1.0))
        self.assertLess(T.pf_push_width(4, 10.0, 1.75, 1.0), T.pf_push_width(4, 10.0, 1.0, 1.0))
        self.assertLess(T.pf_callfrac(4, 10.0, 1.0, 1.75, 3), T.pf_callfrac(4, 10.0, 1.0, 1.0, 3))
        self.assertEqual(T.pf_push(7, 10.0, 1.0, 1.0, h("AsAd")), 1.0)
        self.assertLess(T.pf_push(7, 10.0, 1.0, 1.0, h("7c2d")), 0.01)

    def test_solver_tables(self):
        # opening widths grow towards the button; the big blind defends wide against the button
        ws = [T.sv_open_width(nb, 40.0) for nb in range(1, 8)]
        self.assertTrue(all(a > b for a, b in zip(ws[1:], ws[2:])), ws)
        self.assertLess(ws[-1], 0.18)
        self.assertGreater(T.sv_width("rc", 2, 40.0, 1) + T.sv_width("rb", 2, 40.0, 1), 0.55)
        self.assertGreater(T.sv_open(7, 40.0, h("AsKd")), 0.99)
        self.assertLess(T.sv_open(7, 40.0, h("8c3d")), 0.01)

    def test_discard_choice(self):
        hole = parse_cards("AsAd7c")
        self.assertEqual(choose_discard(hole, parse_cards("Kh9c2d"), 1, 1), (parse_cards("7c")[0],))
        cards = choose_discard(parse_cards("KsKd7c4h2s"), (), 0, 3)
        self.assertNotIn(parse_cards("Ks")[0], cards)
        self.assertNotIn(parse_cards("Kd")[0], cards)

    def test_stats(self):
        st = Stats(8)
        # UTG (3) limps, CO (7) raises, BB (2) 3-bets, CO folds
        hist = ((1, 0, "post", 10), (2, 0, "post", 20), (3, 0, "call", 20), (4, 0, "fold", 0),
                (5, 0, "fold", 0), (6, 0, "fold", 0), (7, 0, "raise", 60), (0, 0, "fold", 0),
                (1, 0, "fold", 0), (2, 0, "raise", 200), (3, 0, "fold", 0), (7, 0, "fold", 0))
        st.update(hist, None)
        self.assertEqual((st.limps[3], st.open_opp[3]), (1, 1))
        self.assertEqual((st.opens[7], st.open_opp[7]), (0, 0))      # an iso-raise is not an open
        self.assertEqual(st.vpip[2] + st.pfr[2], 2)
        # BTN opens, BB calls; BB checks, BTN c-bets, BB folds
        st2 = Stats(8)
        hist = ((1, 0, "post", 10), (2, 0, "post", 20), (3, 0, "fold", 0), (4, 0, "fold", 0),
                (5, 0, "fold", 0), (6, 0, "fold", 0), (7, 0, "fold", 0), (0, 0, "raise", 50),
                (1, 0, "fold", 0), (2, 0, "call", 30), (2, 1, "check", 0), (0, 1, "raise", 40),
                (2, 1, "fold", 0))
        st2.update(hist, None)
        self.assertEqual((st2.opens[0], st2.cbs[0], st2.cb_opp[0]), (1, 1, 1))
        self.assertEqual((st2.fcb[2], st2.fcb_opp[2], st2.fb[2]), (1, 1, 1))
        # the opener faces a 3-bet and folds
        st3 = Stats(8)
        st3.update(((1, 0, "post", 10), (2, 0, "post", 20), (0, 0, "raise", 50), (1, 0, "raise", 160),
                    (2, 0, "fold", 0), (0, 0, "fold", 0)), None)
        self.assertEqual((st3.f3[0], st3.f3_opp[0], st3.tbs[1]), (1, 1, 1))
        # shrinkage: one observation moves a rate only a little
        self.assertLess(abs(st3.rate("f3", 0) - 0.55), 0.1)
        # an open shove from 10 bb, called by the big blind
        st4 = Stats(8)
        start = [2000, 2000, 2000, 200, 2000, 2000, 2000, 2000]
        st4.update(((1, 0, "post", 10), (2, 0, "post", 20), (3, 0, "raise", 200), (4, 0, "fold", 0),
                    (5, 0, "fold", 0), (6, 0, "fold", 0), (7, 0, "fold", 0), (0, 0, "fold", 0),
                    (1, 0, "fold", 0), (2, 0, "call", 180)), None, start, 0)
        self.assertEqual((st4.shoves[3], st4.shove_opp[3]), (1, 1))
        self.assertEqual((st4.call_shove[2], st4.vs_shove[2], st4.vs_shove[1]), (1, 1, 1))
        # expectations from the equilibrium tables: the big blind (last to act) is expected to
        # call more often than the first player behind the shover
        self.assertGreater(st4.exp_callshove[2], st4.exp_callshove[4])
        self.assertAlmostEqual(st4.exp_shove[3], T.pf_width_fast(7, 10.0, 1.0, 1.0), places=6)
        self.assertGreater(st4.ratio("callshove", 2), 1.0)
        self.assertLess(st4.ratio("callshove", 4), 1.0)


# ------------------------------------------------------------------------- preflop (all)
class TestPreflop(unittest.TestCase):
    def test_push_fold_when_short(self):
        st = [160] * 8                                   # 8 bb each
        for n in NAMES:
            _, a = spot(make(n), "7c2d", st, button=0, seat=3)
            self.assertEqual(a.kind, "fold", n)
            obs, a = spot(make(n), "AsAd", st, button=0, seat=3)
            self.assertTrue(is_shove(obs, a), n)
        hu = [200, 200] + [0] * 6                        # heads-up 10 bb: the SB shoves wide
        for n in NAMES:
            obs, a = spot(make(n), "Kh9c", hu, button=0, seat=0)
            self.assertTrue(is_shove(obs, a), n)

    def test_deep_open_is_a_raise_not_a_shove(self):
        for n in NAMES:
            _, a = spot(make(n), "AsKd", EIGHT, button=0, seat=3)
            self.assertTrue(is_raise(a) and a.amount <= 60, n)
            _, a = spot(make(n), "8c3d", EIGHT, button=0, seat=3)
            self.assertEqual(a.kind, "fold", n)

    def test_calls_a_small_open_with_a_strong_hand(self):
        # the ICM premium must not make a 3 bb call with AK a fold (only the chips at risk count)
        for n in NAMES:
            _, a = spot(make(n), "AsKd", [4000] * 8, button=0, seat=0, script=[(7, RaiseTo(450))],
                        hand_number=100)
            self.assertNotEqual(a.kind, "fold", n)

    def test_icm_tightens_calls_on_the_bubble(self):
        stacks = [6000, 1500, 0, 0, 0, 1500, 0, 3000]   # BTN 0 (big), SB 1, BB 5 (hero), CO 7
        script = [(7, Fold()), (0, RaiseTo(6000)), (1, Fold())]
        ladder = SngRules(payouts=(100, 65, 45, 30, 20, 12, 6, 0), blinds=((100, 200),))
        wta = SngRules(payouts=(100, 0, 0, 0, 0, 0, 0, 0), blinds=((100, 200),))
        for n in NAMES:
            for hole in ("Kc9d", "Ac8d"):
                _, a = spot(make(n), hole, stacks, button=0, seat=5, script=script, rules=ladder)
                self.assertEqual(a.kind, "fold", f"{n} {hole}")
            _, a = spot(make(n), "AsAd", stacks, button=0, seat=5, script=script, rules=ladder)
            self.assertNotEqual(a.kind, "fold", n)
            _, a = spot(make(n), "Ac8d", stacks, button=0, seat=5, script=script, rules=wta)
            self.assertNotEqual(a.kind, "fold", n)

    def test_no_wide_reshove_over_an_open(self):
        # 26 bb behind a CO open: junk folds, a premium continues
        for n in NAMES:
            for hole in ("9c5s", "5s2d", "Tc7c"):
                _, a = spot(make(n), hole, [5200] * 8, button=0, seat=0, script=[(7, RaiseTo(400))],
                            hand_number=100)
                self.assertEqual(a.kind, "fold", f"{n} {hole}")
            _, a = spot(make(n), "QsQd", [5200] * 8, button=0, seat=0, script=[(7, RaiseTo(400))],
                        hand_number=100)
            self.assertNotEqual(a.kind, "fold", n)


# --------------------------------------------------------------------------- the bots
class TestNash(unittest.TestCase):
    def test_follows_the_equilibrium_table(self):
        # 8 bb under the gun: shove exactly the table's range (pure strategies at the edges)
        st = [160] * 8
        bot = make("f8_nash")
        for hole in ("AsKd", "8s8d", "KdQs", "9c6d", "Js4c"):
            obs, a = spot(bot, hole, st, button=0, seat=3)
            bp, bc = bot.push_bfs(__import__("sng.field8.base", fromlist=["Ctx"]).Ctx(obs), [4, 5, 6, 7, 0, 1, 2])
            p = T.pf_push(7, 8.0 * 1.5 / 1.5, bp, bc, h(hole))
            if p >= 0.999:
                self.assertTrue(is_shove(obs, a), hole)
            elif p <= 0.001:
                self.assertEqual(a.kind, "fold", hole)

    def test_icm_pressure_widens_the_small_blind_shove(self):
        # SB vs BB heads-up at 10 bb: under heavy bubble pressure on the caller the pusher
        # shoves a hand it folds at chip EV
        hand = None
        for hole in ("7c3d", "8c2d", "6c2d", "9c2d", "5c3d"):
            if T.pf_push(1, 10.0, 1.0, 1.0, h(hole)) < 0.01 and T.pf_push(1, 10.0, 1.0, 2.1, h(hole)) > 0.99:
                hand = hole
                break
        self.assertIsNotNone(hand)


class TestSolver(unittest.TestCase):
    def test_big_blind_defends_wide_against_the_button(self):
        defend = count(lambda s: spot(make("f8_solver"), "Kc7d", EIGHT, button=0, seat=2,
                                      script=[(0, RaiseTo(50)), (1, Fold())], seed=s)[1].kind != "fold", 20)
        self.assertGreater(defend, 12)
        _, a = spot(make("f8_solver"), "7c2d", EIGHT, button=0, seat=2, script=[(0, RaiseTo(50)), (1, Fold())])
        self.assertEqual(a.kind, "fold")

    def test_opens_by_position(self):
        # K9o: a button open, an under-the-gun fold
        btn = count(lambda s: is_raise(spot(make("f8_solver"), "Kc9d", EIGHT, button=0, seat=0, seed=s)[1]), 20)
        utg = count(lambda s: is_raise(spot(make("f8_solver"), "Kc9d", EIGHT, button=0, seat=3, seed=s)[1]), 20)
        self.assertGreater(btn, 15)
        self.assertLess(utg, 3)

    def test_range_widths_from_the_tables(self):
        bot = make("f8_solver")
        obs, _ = spot(bot, "AsAd", EIGHT, button=0, seat=2, script=BTN_OPEN_BB_CALL, board="Kh7c2d4s5d")
        from sng.field8.base import Ctx
        c = Ctx(obs)
        self.assertAlmostEqual(bot.range_width(c, 0), T.sv_open_width(2, 100.0), places=3)


class TestAdaptive(unittest.TestCase):
    @staticmethod
    def never_calls_shoves(bot):
        st = bot.stats
        for j in (4, 5, 6, 7, 0, 1, 2):
            st.vs_shove[j], st.call_shove[j], st.exp_callshove[j] = 60, 1, 12.0

    @staticmethod
    def always_calls_shoves(bot):
        st = bot.stats
        for j in (4, 5, 6, 7, 0, 1, 2):
            st.vs_shove[j], st.call_shove[j], st.exp_callshove[j] = 60, 40, 12.0

    def test_shoves_wider_against_folders(self):
        st = [200] * 8                                   # 10 bb, hero UTG
        hands = ["Kc7d", "Qh8c", "Ts8d", "Ac4d", "Js9c", "6s6d", "Kd5c", "Qc9d"]
        wide = sum(is_raise(spot(make("f8_adaptive"), x, st, button=0, seat=3, prepare=self.never_calls_shoves)[1])
                   for x in hands)
        tight = sum(is_raise(spot(make("f8_adaptive"), x, st, button=0, seat=3, prepare=self.always_calls_shoves)[1])
                    for x in hands)
        self.assertGreater(wide, tight + 2)

    def test_value_bets_thinner_against_a_station(self):
        def station(bot):
            st = bot.stats
            st.fb_opp[2], st.fb[2] = 60, 6
            st.saw_flop[2], st.sd[2] = 50, 30
        river = BTN_OPEN_BB_CALL + [(2, Check()), (0, Check()), (2, Check()), (0, Check()), (2, Check())]
        bot = make("f8_adaptive")
        _, a0 = spot(bot, "Qc5d", EIGHT, button=0, seat=0, script=river, board="Qh8h2c4dKs")
        bot = make("f8_adaptive")
        obs, a1 = spot(bot, "Qc5d", EIGHT, button=0, seat=0, script=river, board="Qh8h2c4dKs", prepare=station)
        from sng.field8.base import Ctx
        c = Ctx(obs)
        self.assertLess(bot.vthr_adj(c, 2), -0.02)
        self.assertTrue(is_raise(a1) or not is_raise(a0))


class TestEndgame(unittest.TestCase):
    # level 5 (75/150): hero on the button covers everyone behind, who are all under ICM pressure
    BIG = [7000, 1500, 1400, 300, 250, 1600, 1500, 1350]

    def test_big_stack_opens_wider_on_the_bubble(self):
        hands = ["Qc4d", "Jd5c", "Ts3h", "9c4c", "Kd2s", "8h6c", "Qs5d", "Jc7d"]
        eg = sum(is_raise(spot(make("f8_endgame"), x, self.BIG, button=0, seat=0, hand_number=100)[1])
                 for x in hands)
        self.assertGreaterEqual(eg, 4)

    def test_heads_up_button_opens_wide(self):
        hu = [4000, 4000] + [0] * 6                     # 100 bb heads-up
        opens = sum(is_raise(spot(make("f8_endgame"), x, hu, button=0, seat=0, seed=s)[1])
                    for s, x in enumerate(["Kc8d", "Qd9c", "Js8h", "Tc8d", "Ac2s", "9h7h"]))
        self.assertGreaterEqual(opens, 5)

    def test_covered_does_not_stack_off_marginally(self):
        # a covering stack shoves: with the covered-stack margin the hero folds hands it calls
        # without the margin, and never the other way round
        stacks = [6000, 1500, 0, 0, 0, 2400, 0, 3000]
        script = [(7, Fold()), (0, RaiseTo(6000)), (1, Fold())]
        rules = SngRules(blinds=((100, 200),))
        flips = 0
        for hole in ("Ad9c", "AcTd", "KcQd", "Ac8d", "KdJc", "9s9c", "8s8c", "AdJc", "Ac6d", "KcTd"):
            _, a = spot(make("f8_endgame"), hole, stacks, button=0, seat=5, script=script, rules=rules)
            _, b = spot(make("f8_endgame", covered_margin=0.0), hole, stacks, button=0, seat=5, script=script,
                        rules=rules)
            self.assertFalse(a.kind != "fold" and b.kind == "fold", hole)
            flips += a.kind == "fold" and b.kind != "fold"
        self.assertGreaterEqual(flips, 1)


class TestEnsemble(unittest.TestCase):
    def test_combines_position_ranges_and_adaptive_table_shoves(self):
        # deep: position ranges
        btn = count(lambda s: is_raise(spot(make("f8_ensemble"), "Kc9d", EIGHT, button=0, seat=0, seed=s)[1]), 20)
        utg = count(lambda s: is_raise(spot(make("f8_ensemble"), "Kc9d", EIGHT, button=0, seat=3, seed=s)[1]), 20)
        self.assertGreater(btn, 15)
        self.assertLess(utg, 3)
        # short: shoves wider against players who never call
        st = [200] * 8
        hands = ["Kc7d", "Qh8c", "Ts8d", "Ac4d", "Js9c", "6s6d", "Kd5c", "Qc9d"]
        wide = sum(is_raise(spot(make("f8_ensemble"), x, st, button=0, seat=3,
                                 prepare=TestAdaptive.never_calls_shoves)[1]) for x in hands)
        tight = sum(is_raise(spot(make("f8_ensemble"), x, st, button=0, seat=3,
                                  prepare=TestAdaptive.always_calls_shoves)[1]) for x in hands)
        self.assertGreater(wide, tight)

    def test_heads_up_uses_the_heads_up_ranges(self):
        hu = [4000, 4000] + [0] * 6
        opens = sum(is_raise(spot(make("f8_ensemble"), x, hu, button=0, seat=0, seed=s)[1])
                    for s, x in enumerate(["Kc8d", "Qd9c", "Js8h", "Tc8d", "Ac2s", "9h7h"]))
        self.assertGreaterEqual(opens, 5)


if __name__ == "__main__":
    unittest.main()
