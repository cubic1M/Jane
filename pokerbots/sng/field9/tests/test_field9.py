"""Tests for the field9 bots: legality on many tables and card games (discard, split-pot,
fixed-limit and non-hold'em presets), determinism, timing, the shared machinery (scorer,
postflop features and table, ICM, opponent stats, push/fold tables) and one signature spot
per bot."""
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
from sng.field9 import tables9
from sng.field9.base9 import game_mode
from sng.field9.cards9 import DRAW_NAMES, MADE_NAMES, Scorer, choose_discard, features, hclass, key_of, street_key
from sng.field9.icm9 import PairIcm, icm_batch
from sng.field9.model9 import Stats
from sng.field9.registry import BOTS, FIELDS
from sng.icm import icm
from sng.presets import PRESETS
from sng.rules import NLHE, SngRules
from sng.table import Hand, play_table
from sng.timescale import factor

NAMES = list(BOTS)
T = tables9.get("std")


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


class _Stop(Exception):
    pass


def spot(bot, hole, stacks, button, seat, script=(), board="", seed=1, hand_number=0, prepare=None, rules=None):
    """Play the real hand engine up to `seat`'s first unscripted decision. `script` is a list of
    (seat, action) taken in order (the hero's scripted actions included); other seats fold to a
    bet and check otherwise. Returns (obs, the bot's action)."""
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
# button 0, SB 1, BB 2, UTG 3 .. CO 7


def set_rate(bot, key, seats, x, o):
    for j in seats:
        bot.stats.x[key][j], bot.stats.o[key][j] = x, o


# ------------------------------------------------------------------------------ tables
class TestTables(unittest.TestCase):
    def test_mixed_tables(self):
        rules = SngRules()
        for t in range(4):
            rng = np.random.default_rng(t)
            lineup = NAMES + list(rng.choice(NAMES, 2))
            rng.shuffle(lineup)
            res = play_table([make(n) for n in lineup], rules, seed=900 + t)
            check_stats(self, res, lineup)
            self.assertEqual(sum(res.final_stacks), 8 * 2000)

    def test_with_other_bots(self):
        from sng.registry import make as reg_make
        lineup = NAMES[:5] + ["random", "push", "station0"]
        for t in range(3):
            res = play_table([reg_make(n) for n in lineup], SngRules(), seed=910 + t)
            check_stats(self, res, lineup[:5])

    def test_with_field8_and_field7(self):
        from sng.registry import make as reg_make
        lineup = NAMES[:4] + ["f8_ensemble", "f8_nash", "f7_balanced", "f7_bully"]
        res = play_table([reg_make(n) for n in lineup], SngRules(), seed=920)
        check_stats(self, res, lineup[:4])

    def _spec_tables(self, specs, hands=80):
        for name, spec in specs.items():
            spec = spec.with_(stack_reset_per_hand=False, starting_stack=2000, small_blind=10, big_blind=20, ante=0)
            n = 8
            while spec.hole_cards * n + spec.total_board_dealt > len(spec.deck):
                n -= 1
            rules = SngRules(spec=spec, num_players=n, payouts=SngRules().payouts[:n], max_hands=hands)
            lineup = [NAMES[i % len(NAMES)] for i in range(n)]
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
            lineup = NAMES + NAMES[:2]
            res = play_table([make(x) for x in lineup], rules, seed=5)
            check_stats(self, res, lineup, p)

    def test_every_preset(self):
        for p, kw in PRESETS.items():
            rules = SngRules(**kw).with_(max_hands=60)
            n = rules.num_players
            while rules.spec.hole_cards * n + rules.spec.total_board_dealt > len(rules.spec.deck):
                n -= 1
            if n != rules.num_players:
                rules = rules.with_(num_players=n, payouts=rules.payouts[:n])
            lineup = [NAMES[(i + 1) % len(NAMES)] for i in range(n)]
            res = play_table([make(x) for x in lineup], rules, seed=17)
            check_stats(self, res, lineup, p)

    def test_random_rules(self):
        from sng.bughunt import random_rules
        for seed in range(1, 41):
            rng = random.Random(seed)
            rules, pick = random_rules(rng)
            rules = rules.with_(max_hands=min(rules.max_hands, 60))
            lineup = [NAMES[(seed + i) % len(NAMES)] for i in range(rules.num_players)]
            res = play_table([make(x) for x in lineup], rules, seed=seed)
            for i, x in enumerate(lineup):
                st = res.stats[i]
                self.assertEqual(st.errors + st.illegal, 0, f"{pick} {x}: {st.first_error}")

    def test_short_handed_and_heads_up_tables(self):
        for n in (2, 3, 5):
            rules = SngRules(num_players=n, payouts=SngRules().payouts[:n])
            lineup = [NAMES[i % len(NAMES)] for i in range(n)]
            for seed in range(3):
                res = play_table([make(x) for x in lineup], rules, seed=60 + seed)
                check_stats(self, res, lineup, f"{n}-handed")

    def test_deterministic(self):
        rules = SngRules(enforce_time=False)
        lineup = NAMES + NAMES[:2]
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
            lineup = NAMES + NAMES[:2]
            lineup = lineup[t:] + lineup[:t]
            res = play_table([make(n) for n in lineup], rules, seed=300 + t)
            for i, n in enumerate(lineup):
                times[n] += res.stats[i].times
        for n, ts in times.items():
            p99 = float(np.percentile(ts, 99))
            self.assertLess(p99, 0.0003 * factor(), f"{n} p99 {p99 * 1e3:.3f} ms")

    def test_registry(self):
        self.assertEqual(set(NAMES), {"f9_threebet", "f9_limptrap", "f9_bubble", "f9_float", "f9_gto", "f9_meta"})
        self.assertEqual({w for _, w in FIELDS["field9"]}, {1.0})
        from sng.registry import BOTS as ALL
        from sng.registry import field_weights
        for n in NAMES:
            self.assertIn(n, ALL)
        self.assertEqual({n for n, _ in field_weights("field9")}, set(NAMES))

    def test_survives_broken_end_hand_input(self):
        for n in NAMES:
            b = make(n)
            b.new_table(SngRules(), 0, 1)
            b.end_hand({})
            b.end_hand(None)
            b.end_hand(dict(history=((99, 0, "raise", 5), "junk"), showdown={99: (1, 2)}, stacks=(0,) * 8))
            obs, a = spot(b, "AsKd", EIGHT, button=0, seat=3)
            self.assertTrue(obs.legal.is_legal(a))

    def test_handles_discards_flag(self):
        for n in NAMES:
            self.assertTrue(getattr(make(n), "handles_discards", False))


# --------------------------------------------------------------------------------- core
class TestCore(unittest.TestCase):
    def test_scorer_matches_engine(self):
        for spec in (NLHE, PRESETS["kit4_sixplus"]["spec"]):
            ev = get_evaluator(spec)
            sc = Scorer(spec)
            deck = np.array(spec.deck)
            rng = np.random.default_rng(5)
            for k in (5, 6, 7):
                cs = [[int(x) for x in rng.permutation(deck)[:k]] for _ in range(1500)]
                ref = ev.eval_any(np.array(cs))
                mine = np.array([sc.score(c) for c in cs])
                self.assertTrue((np.sign(ref[:-1] - ref[1:]) == np.sign(mine[:-1] - mine[1:])).all(), spec.name)

    def test_features(self):
        def f(hole, board):
            m, d, *_ = features(*parse_cards(hole), parse_cards(board))
            return MADE_NAMES[m], DRAW_NAMES[d]
        self.assertEqual(f("AsKd", "Kh7c2d")[0], "tp_top")
        self.assertEqual(f("Kc5d", "Kh7c2d")[0], "tp_weak")
        self.assertEqual(f("AsAd", "Kh7c2d")[0], "overpair_big")
        self.assertEqual(f("7s7d", "7cKd2h")[0], "set")
        self.assertEqual(f("KcQc", "KdQh2s")[0], "top_two")
        self.assertEqual(f("AhKh", "Qh7h2h")[0], "nut_flush")
        self.assertEqual(f("6s5s", "AcAd9h9s2c")[0], "air0")            # the board plays
        self.assertEqual(f("Ah5h", "Kh9h4c")[1], "nut_flush_draw")
        self.assertEqual(f("9c8c", "7d6s2h")[1], "oesd")
        self.assertEqual(f("9c8c", "7d6s2h5h3c")[1], "none")            # no draws on the river

    def test_post_table_is_calibrated(self):
        def row(hole, board):
            hc, bc = parse_cards(hole), parse_cards(board)
            return T.POST[key_of(street_key(len(bc)), *features(*hc, bc))]
        self.assertGreater(row("7s7d", "7cKd2h")[0], 0.9)
        self.assertGreater(row("AsKd", "Kh7c2d")[0], row("Kc5d", "Kh7c2d")[0])
        self.assertLess(row("6s5c", "KdQh9c2s2h")[0], 0.3)
        r = row("AsKd", "Kh7c2d")
        self.assertGreater(r[0], r[3])          # random > top 12%
        self.assertGreater(r[4], r[6])          # continuing range > strong range
        self.assertLess(r[7], r[1])             # two opponents are harder than one

    def test_preflop_tables(self):
        self.assertLess(T.PCT[h("AsAd")], T.PCT[h("KsKd")])
        self.assertLess(T.PCT[h("AsKs")], T.PCT[h("AsKd")])
        self.assertGreater(T.PCT[h("7c2d")], 0.95)
        self.assertAlmostEqual(float(T.EQ[h("AsAd"), h("KsKd")]), 0.82, delta=0.02)
        self.assertGreater(T.call_width(0.5, 0.45), T.call_width(0.1, 0.45))

    def test_push_fold_equilibrium(self):
        self.assertAlmostEqual(T.pf_width(1, 10.0, 1.0, 1.0), 0.58, delta=0.04)        # heads-up Nash
        self.assertAlmostEqual(T.pf_callfrac(1, 10.0, 1.0, 1.0, 2), 0.37, delta=0.04)
        for nb in range(1, 7):
            self.assertGreater(T.pf_width(nb, 10.0, 1.0, 1.0), T.pf_width(nb + 1, 10.0, 1.0, 1.0))
        self.assertGreater(T.pf_width(4, 10.0, 1.0, 1.75), T.pf_width(4, 10.0, 1.0, 1.0))
        self.assertLess(T.pf_width(4, 10.0, 1.75, 1.0), T.pf_width(4, 10.0, 1.0, 1.0))
        self.assertEqual(T.pf_push(7, 10.0, 1.0, 1.0, h("AsAd")), 1.0)
        self.assertLess(T.pf_push(7, 10.0, 1.0, 1.0, h("7c2d")), 0.01)

    def test_short_deck_tables(self):
        self.assertTrue(tables9.available("six"))
        six = tables9.get("six")
        self.assertLess(six.PCT[h("AsAd")], six.PCT[h("6c7d")])
        self.assertEqual(game_mode(PRESETS["kit4_sixplus"]["spec"])[0], "holdem")
        self.assertEqual(game_mode(NLHE)[:2], ("holdem", "std"))
        self.assertEqual(game_mode(PRESETS["fixed_limit"]["spec"])[0], "limit")
        self.assertEqual(game_mode(PRESETS["omaha_hilo8"]["spec"])[0], "generic")

    def test_icm(self):
        pays = SngRules().payouts
        for st in ([3000, 2500, 2000, 1500, 1000, 800, 500, 4700], [5000, 3000, 1000], [100, 15900],
                   [3000, 0, 2000, 1500, 1000, 800, 500, 4700]):
            self.assertTrue(np.allclose(icm(st, pays[:len(st)]), icm_batch(np.array([st]), pays[:len(st)])[0]), st)
        p = PairIcm([7000, 1500, 1400, 300, 250, 1600, 1500, 1350], pays)
        self.assertLess(p.bf(0, 1), 1.25)          # the big stack risks little against a medium stack
        self.assertGreater(p.bf(1, 0), 1.8)        # the medium stack risks a lot against the big one
        self.assertAlmostEqual(PairIcm([2000, 2000], (100, 0)).bf(0, 1), 1.0, places=6)

    def test_discard_choice(self):
        self.assertEqual(choose_discard(parse_cards("AsAd7c"), parse_cards("Kh9c2d"), 1, 1),
                         (parse_cards("7c")[0],))
        cards = choose_discard(parse_cards("KsKd7c4h2s"), (), 0, 3, draw=True)
        self.assertNotIn(parse_cards("Ks")[0], cards)

    def test_stats(self):
        st = Stats(8, T.PCT)
        # UTG (3) limps, CO (7) raises, BB (2) 3-bets, CO folds
        hist = ((1, 0, "post", 10), (2, 0, "post", 20), (3, 0, "call", 20), (4, 0, "fold", 0),
                (5, 0, "fold", 0), (6, 0, "fold", 0), (7, 0, "raise", 60), (0, 0, "fold", 0),
                (1, 0, "fold", 0), (2, 0, "raise", 200), (3, 0, "fold", 0), (7, 0, "fold", 0))
        st.update(hist, None, [2000] * 8, 20)
        self.assertEqual((st.x["limp"][3], st.o["limp"][3]), (1, 1))
        self.assertEqual(st.o["open"][7], 0)                       # an iso-raise is not an open
        self.assertEqual((st.x["vpip"][2], st.x["pfr"][2]), (1, 1))
        # BTN opens, BB calls; BB checks, BTN c-bets, BB folds
        st2 = Stats(8, T.PCT)
        hist = ((1, 0, "post", 10), (2, 0, "post", 20), (3, 0, "fold", 0), (4, 0, "fold", 0),
                (5, 0, "fold", 0), (6, 0, "fold", 0), (7, 0, "fold", 0), (0, 0, "raise", 50),
                (1, 0, "fold", 0), (2, 0, "call", 30), (2, 1, "check", 0), (0, 1, "raise", 40),
                (2, 1, "fold", 0))
        st2.update(hist, None, [2000] * 8, 20)
        self.assertEqual((st2.x["steal"][0], st2.x["cb"][0], st2.o["cb"][0]), (1, 1, 1))
        self.assertEqual((st2.x["fcb"][2], st2.x["fb"][2]), (1, 1))
        self.assertEqual((st2.o["fts"][2], st2.x["fts"][2], st2.x["fts"][1]), (1, 0, 1))
        # the opener faces a 3-bet and folds
        st3 = Stats(8, T.PCT)
        st3.update(((1, 0, "post", 10), (2, 0, "post", 20), (0, 0, "raise", 50), (1, 0, "raise", 160),
                    (2, 0, "fold", 0), (0, 0, "fold", 0)), None, [2000] * 8, 20)
        self.assertEqual((st3.x["f3"][0], st3.o["f3"][0], st3.x["tb"][1]), (1, 1, 1))
        self.assertLess(abs(st3.rate("f3", 0) - 0.55), 0.1)       # shrinkage
        # an open shove from 10 bb (shown), called by the big blind
        st4 = Stats(8, T.PCT)
        start = [2000, 2000, 2000, 200, 2000, 2000, 2000, 2000]
        st4.update(((1, 0, "post", 10), (2, 0, "post", 20), (3, 0, "raise", 200), (4, 0, "fold", 0),
                    (5, 0, "fold", 0), (6, 0, "fold", 0), (7, 0, "fold", 0), (0, 0, "fold", 0),
                    (1, 0, "fold", 0), (2, 0, "call", 180)), {3: tuple(parse_cards("Kc9d")),
                                                              2: tuple(parse_cards("AsJd"))}, start, 20, hclass)
        self.assertEqual((st4.x["shove"][3], st4.o["shove"][3]), (1, 1))
        self.assertEqual((st4.x["cshove"][2], st4.o["cshove"][2], st4.o["cshove"][1]), (1, 1, 1))
        self.assertEqual(len(st4.shove_pct[3]), 1)


# --------------------------------------------------------------------------- preflop (all)
class TestPreflop(unittest.TestCase):
    def test_push_fold_when_short(self):
        st = [160] * 8                                   # 8 bb each
        for n in NAMES:
            _, a = spot(make(n), "7c2d", st, button=0, seat=3)
            self.assertEqual(a.kind, "fold", n)
            obs, a = spot(make(n), "KsKd", st, button=0, seat=7)
            self.assertTrue(is_shove(obs, a), n)
        hu = [200, 200] + [0] * 6
        for n in NAMES:
            obs, a = spot(make(n), "Kh9c", hu, button=0, seat=0)
            self.assertTrue(is_shove(obs, a), n)

    def test_deep_open_is_a_raise_not_a_shove(self):
        for n in NAMES:
            _, a = spot(make(n), "AsKd", EIGHT, button=0, seat=5)
            self.assertTrue(a.kind == "call" or (is_raise(a) and a.amount <= 60), n)
            _, a = spot(make(n), "8c3d", EIGHT, button=0, seat=3)
            self.assertEqual(a.kind, "fold", n)

    def test_premium_never_folds_to_a_small_open(self):
        for n in NAMES:
            for hole in ("AsAd", "KsKd", "AsKs"):
                _, a = spot(make(n), hole, [4000] * 8, button=0, seat=0, script=[(7, RaiseTo(450))],
                            hand_number=100)
                self.assertNotEqual(a.kind, "fold", f"{n} {hole}")

    def test_calls_a_short_shove_with_aces_and_folds_trash(self):
        stacks = [3000, 2000, 2000, 300, 2000, 2000, 2000, 2000]
        for n in NAMES:
            _, a = spot(make(n), "AcAd", stacks, button=0, seat=2, script=[(3, RaiseTo(300))])
            self.assertEqual(a.kind, "call", n)
            _, a = spot(make(n), "8c3d", stacks, button=0, seat=2, script=[(3, RaiseTo(300))])
            self.assertEqual(a.kind, "fold", n)


# ---------------------------------------------------------------------------- the bots
class TestThreeBet(unittest.TestCase):
    LIGHT = ["As4s", "7s6s", "KcJd", "Js9s", "Ah3h", "QcJd", "Ts8s", "9h8h"]

    def test_three_bets_light_against_a_button_steal(self):
        btn = sum(is_raise(spot(make("f9_threebet"), x, [6000] * 8, button=0, seat=2, seed=s,
                                script=[(0, RaiseTo(50)), (1, Fold())])[1]) for s in range(5) for x in self.LIGHT)
        utg = sum(is_raise(spot(make("f9_threebet"), x, [6000] * 8, button=0, seat=2, seed=s,
                                script=[(3, RaiseTo(50))])[1]) for s in range(5) for x in self.LIGHT)
        base = sum(is_raise(spot(make("f9_gto"), x, [6000] * 8, button=0, seat=2, seed=s,
                                 script=[(0, RaiseTo(50)), (1, Fold())])[1]) for s in range(5) for x in self.LIGHT)
        self.assertGreater(btn, utg + 5)
        self.assertGreater(btn, base)

    def test_reshoves_over_a_wide_button_steal(self):
        def stealer(bot):
            set_rate(bot, "steal", [0], 35, 50)
        st = [2250, 2500, 4000, 1800, 1500, 2600, 2300, 2700]       # 75/150: the button opens with 15 bb
        hands = ("Ac9d", "KcJd", "6s6d", "As5s", "QhJh", "Kh9h", "Ad7c")
        shoves = {}
        for name in ("f9_threebet", "f9_gto"):
            shoves[name] = sum(is_shove(*spot(make(name), x, st, button=0, seat=2, prepare=stealer,
                                              script=[(3, Fold()), (4, Fold()), (5, Fold()), (6, Fold()),
                                                      (7, Fold()), (0, RaiseTo(330)), (1, Fold())],
                                              hand_number=100)) for x in hands)
        self.assertGreaterEqual(shoves["f9_threebet"], 5)
        self.assertGreater(shoves["f9_threebet"], shoves["f9_gto"])

    def test_four_bet_shoves_wider_against_a_frequent_three_bettor(self):
        def maniac(bot):
            set_rate(bot, "tb", [2], 30, 100)
        stacks = [5200, 2400, 4800, 1800, 2600, 3000, 2200, 2400]   # 75/150: 32 bb between BTN and BB
        script = [(0, RaiseTo(330)), (1, Fold()), (2, RaiseTo(1200))]
        hands = ["AcTd", "9s9d", "KsQd", "AcJd", "8h8c", "KcJc"]
        wide = sum(is_shove(*spot(make("f9_threebet"), x, stacks, button=0, seat=0, script=script,
                                  hand_number=100, prepare=maniac)) for x in hands)
        tight = sum(is_shove(*spot(make("f9_threebet"), x, stacks, button=0, seat=0, script=script,
                                   hand_number=100)) for x in hands)
        self.assertGreater(wide, tight)
        self.assertGreaterEqual(wide, 2)


class TestLimpTrap(unittest.TestCase):
    def test_limps_aces_early_and_reraises_after_the_limp(self):
        limps = count(lambda s: spot(make("f9_limptrap"), "AsAd", EIGHT, button=0, seat=3, seed=s)[1].kind == "call",
                      20)
        self.assertGreaterEqual(limps, 10)
        obs, a = spot(make("f9_limptrap"), "AsAd", EIGHT, button=0, seat=3,
                      script=[(3, Call()), (7, RaiseTo(80))])
        self.assertTrue(is_raise(a))
        obs, a = spot(make("f9_limptrap"), "7c2d", EIGHT, button=0, seat=3)
        self.assertEqual(a.kind, "fold")

    def test_overlimps_and_bets_big_when_checked_to(self):
        _, a = spot(make("f9_limptrap"), "8s7s", EIGHT, button=0, seat=7, script=[(3, Call())])
        self.assertEqual(a.kind, "call")
        # the button over-limps; the big blind and the limper check the flop to it
        for hole, lo in (("AhKd", 28), ("6c5d", 6)):
            sizes = []
            for s in range(30):
                obs, a = spot(make("f9_limptrap"), hole, EIGHT, button=0, seat=0, seed=s, board="Kh8c4d",
                              script=[(3, Call()), (0, Call())])
                if is_raise(a):
                    sizes.append(a.amount / obs.pot)
            self.assertGreaterEqual(len(sizes), lo, hole)
            self.assertGreaterEqual(min(sizes), 0.85, hole)


class TestBubble(unittest.TestCase):
    # level 5 (75/150): hero on the button covers everyone behind, who are under ICM pressure
    BIG = [12000, 3600, 3400, 1200, 900, 3800, 3500, 3300]
    HANDS = ["Qc4d", "Jd5c", "Ts3h", "9c4c", "Kd2s", "8h6c", "Qs5d", "Jc7d", "Tc6d", "9s5s"]

    def test_bully_opens_wider_than_the_baseline_when_covering(self):
        bub = sum(is_raise(spot(make("f9_bubble"), x, self.BIG, button=0, seat=0, hand_number=100, seed=s)[1])
                  for s, x in enumerate(self.HANDS))
        gto = sum(is_raise(spot(make("f9_gto"), x, self.BIG, button=0, seat=0, hand_number=100, seed=s)[1])
                  for s, x in enumerate(self.HANDS))
        self.assertGreater(bub, gto)
        self.assertGreaterEqual(bub, 4)

    def test_calls_short_shoves_when_covering_and_tightens_when_covered(self):
        # hero big blind covers a 6 bb shove from the button
        stacks = [900, 2000, 6000, 2000, 2000, 1500, 1600, 0]
        rules = SngRules(blinds=((75, 150),))
        calls = {}
        for name in ("f9_bubble", "f9_gto"):
            calls[name] = sum(spot(make(name), x, stacks, button=0, seat=2, rules=rules,
                                   script=[(3, Fold()), (4, Fold()), (5, Fold()), (6, Fold()), (0, RaiseTo(900)),
                                           (1, Fold())])[1].kind == "call"
                              for x in ("Kc6d", "Qd8c", "Ts8d", "Ac3d", "5s5d", "Jc9d"))
        self.assertGreaterEqual(calls["f9_bubble"], 4)
        self.assertGreater(calls["f9_bubble"], calls["f9_gto"])
        # covered by a big stack's shove with a medium stack on the bubble: fold a hand it calls when covering
        stacks = [6000, 1500, 0, 0, 0, 1500, 0, 3000]
        _, a = spot(make("f9_bubble"), "Ac8d", stacks, button=0, seat=5, rules=SngRules(blinds=((100, 200),)),
                    script=[(7, Fold()), (0, RaiseTo(6000)), (1, Fold())])
        self.assertEqual(a.kind, "fold")


class TestFloat(unittest.TestCase):
    def test_flats_opens_in_position(self):
        hands = ["8s7s", "6s6d", "Jh9h", "Ac5c", "Kd9d", "Td9c", "5h5c", "Qs9s"]
        fl = sum(spot(make("f9_float"), x, [6000] * 8, button=0, seat=0, script=[(7, RaiseTo(50))])[1].kind == "call"
                 for x in hands)
        tb = sum(spot(make("f9_threebet"), x, [6000] * 8, button=0, seat=0,
                      script=[(7, RaiseTo(50))])[1].kind == "call" for x in hands)
        self.assertGreaterEqual(fl, 6)
        self.assertGreater(fl, tb)

    def test_floats_cbets_from_a_frequent_cbettor_and_bets_when_checked_to(self):
        def cbettor(bot):
            set_rate(bot, "cb", [7], 45, 50)
            set_rate(bot, "fb", [7], 30, 50)
        pre = [(7, RaiseTo(50)), (0, Call()), (1, Fold()), (2, Fold())]
        floats = count(lambda s: spot(make("f9_float"), "Qh9h", [6000] * 8, button=0, seat=0, seed=s,
                                      board="Kc7d2h5s", prepare=cbettor,
                                      script=pre + [(7, RaiseTo(50))])[1].kind == "call", 30)
        self.assertGreaterEqual(floats, 10)
        bets = count(lambda s: is_raise(spot(make("f9_float"), "Qh9h", [6000] * 8, button=0, seat=0, seed=s,
                                             board="Kc7d2h5s", prepare=cbettor,
                                             script=pre + [(7, RaiseTo(50)), (0, Call()), (7, Check())])[1]), 30)
        self.assertGreaterEqual(bets, 18)


class TestBalanced(unittest.TestCase):
    def test_mixes_at_the_border_and_ignores_stats(self):
        # a hand at the edge of the cut-off opening range is sometimes opened, sometimes folded
        bot = make("f9_gto")
        border = min(range(169), key=lambda k: abs(T.PCT[k] - 0.28) if T.W[k] > 0 else 9)
        hole = None
        for a in range(52):
            for b in range(a + 1, 52):
                if hclass(a, b) == border:
                    hole = a, b
                    break
            if hole:
                break
        from engine.cards import cards_str
        hs = cards_str(list(hole))
        acts = {spot(bot, hs, EIGHT, button=0, seat=7, seed=s)[1].kind for s in range(40)}
        self.assertEqual(acts, {"raise", "fold"})
        # no exploitation: stats do not change its decisions
        def folders(b):
            set_rate(b, "fts", [1, 2], 50, 50)
            set_rate(b, "cshove", range(8), 0, 80)
        for s in range(10):
            a1 = spot(make("f9_gto"), "Kc7d", [200] * 8, button=0, seat=3, seed=s)[1]
            a2 = spot(make("f9_gto"), "Kc7d", [200] * 8, button=0, seat=3, seed=s, prepare=folders)[1]
            self.assertEqual(a1, a2)

    def test_river_bluff_frequency_follows_the_bet_size(self):
        bot = make("f9_gto")
        bot.new_table(SngRules(), 0, 1)
        self.assertAlmostEqual(bot.rbluff_freq(type("C", (), dict(street=3))(), 2), 0.75 / 2.5 * 1.1, places=6)


class TestMeta(unittest.TestCase):
    def test_shoves_wider_into_players_who_never_call(self):
        def never(bot):
            set_rate(bot, "cshove", [4, 5, 6, 7, 0, 1, 2], 1, 60)

        def always(bot):
            set_rate(bot, "cshove", [4, 5, 6, 7, 0, 1, 2], 40, 60)
        st = [200] * 8
        hands = ["Kc7d", "Qh8c", "Ts8d", "Ac4d", "Js9c", "6s6d", "Kd5c", "Qc9d", "9s7s", "Ah2c"]
        wide = sum(is_raise(spot(make("f9_meta"), x, st, button=0, seat=3, prepare=never)[1]) for x in hands)
        tight = sum(is_raise(spot(make("f9_meta"), x, st, button=0, seat=3, prepare=always)[1]) for x in hands)
        self.assertGreater(wide, tight + 2)

    def test_steals_wider_against_folding_blinds_and_calls_down_maniacs(self):
        def folders(bot):
            set_rate(bot, "fts", [1, 2], 48, 50)

        def defenders(bot):
            set_rate(bot, "fts", [1, 2], 10, 50)
        hands = ["Qc5d", "Jd6c", "Ts5h", "9c5c", "Kd3s", "8h5c", "Qs4d", "Jc6d", "7s4s", "Tc4d"]
        wide = sum(is_raise(spot(make("f9_meta"), x, EIGHT, button=0, seat=0, prepare=folders)[1]) for x in hands)
        tight = sum(is_raise(spot(make("f9_meta"), x, EIGHT, button=0, seat=0, prepare=defenders)[1]) for x in hands)
        self.assertGreater(wide, tight + 2)
        bot = make("f9_meta")
        bot.new_table(SngRules(), 0, 1)
        set_rate(bot, "vpip", [3], 60, 100)
        set_rate(bot, "agg", [3], 80, 100)
        self.assertEqual(bot.profile(3), "maniac")
        self.assertGreater(bot.call_adj(None, 3), 0)
        self.assertEqual(bot.rbluff_freq(None, 3), 0.0)


if __name__ == "__main__":
    unittest.main()
