"""Tests for the field10 bots: legality on many tables and every preset / variant (discard,
split-pot, fixed- and pot-limit, short deck, Omaha), determinism, timing, the shared helpers
(Chen, percentiles, ranges, classifier, legalizer, the Monte Carlo lookup evaluator) and one
signature spot per bot (its intended style or its deliberate quirk)."""
from __future__ import annotations

import importlib
import os
import random
import unittest

import numpy as np

from engine.cards import parse_cards
from engine.evaluator import get_evaluator
from engine.game import Action, Call, Check, Discard, Fold, RaiseTo
from engine.variants import ALL_VARIANTS
from sng.field10.base10 import (MADE_NAMES, Ctx, chen, classify, legalize, parse_range, pre_pct, raw_category)
from sng.field10.bots import Fast7, MonteCarlo, PushFold
from sng.field10.registry import BOTS, FIELDS
from sng.presets import PRESETS
from sng.rules import NLHE, SngRules
from sng.table import Hand, Legal, play_table
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


EIGHT = [2000] * 8
# button 0, SB 1, BB 2, UTG 3 .. CO 7
HU = [2000, 2000]
# heads-up: button 0 = SB (acts first preflop), seat 1 = BB (acts first postflop)
HU_TO_RIVER = [(0, Call()), (1, Check()), (1, Check()), (0, Check()), (1, Check()), (0, Check()), (1, Check())]


# ------------------------------------------------------------------------------ tables
class TestTables(unittest.TestCase):
    def test_mixed_tables(self):
        rules = SngRules()
        for t in range(4):
            rng = np.random.default_rng(t)
            lineup = list(rng.choice(NAMES, 8))
            res = play_table([make(n) for n in lineup], rules, seed=900 + t)
            check_stats(self, res, lineup)
            self.assertEqual(sum(res.final_stacks), 8 * 2000)

    def test_all_eight(self):
        for t in range(4):
            lineup = NAMES[t:] + NAMES[:t]
            res = play_table([make(n) for n in lineup], SngRules(), seed=950 + t)
            check_stats(self, res, lineup)

    def test_with_other_bots(self):
        from sng.registry import make as reg_make
        lineup = NAMES[:5] + ["random", "push", "station0"]
        for t in range(3):
            res = play_table([reg_make(n) for n in lineup], SngRules(), seed=910 + t)
            check_stats(self, res, lineup[:5])

    def test_with_field9(self):
        from sng.registry import BOTS as ALL
        from sng.registry import make as reg_make
        others = [n for n in ("f9_threebet", "f9_gto", "f9_meta", "f9_bubble") if n in ALL]
        lineup = NAMES[3:7] + others
        res = play_table([reg_make(n) for n in lineup], SngRules(num_players=len(lineup),
                                                                  payouts=SngRules().payouts[:len(lineup)]),
                         seed=920)
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

    def test_every_variant(self):
        self._spec_tables(dict(ALL_VARIANTS))

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

    def test_rehearsal_and_kit_presets_with_antes(self):
        for p in ("rehearsal_sixplus", "kit4_sixplus", "bounty10"):
            rules = SngRules(**PRESETS[p])
            lineup = NAMES
            res = play_table([make(x) for x in lineup], rules, seed=5)
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
            for seed in range(3):
                lineup = [NAMES[(seed + i) % len(NAMES)] for i in range(n)]
                res = play_table([make(x) for x in lineup], rules, seed=60 + seed)
                check_stats(self, res, lineup, f"{n}-handed")

    def test_deterministic(self):
        rules = SngRules(enforce_time=False)
        lineup = NAMES
        a = play_table([make(n) for n in lineup], rules, seed=42)
        b = play_table([make(n) for n in lineup], rules, seed=42)
        self.assertEqual(a.points, b.points)
        self.assertEqual(a.final_stacks, b.final_stacks)
        self.assertEqual(a.bust_hand, b.bust_hand)
        self.assertEqual(a.hands, b.hands)
        c = play_table([make(n) for n in lineup], rules, seed=43)
        self.assertNotEqual((a.points, a.hands, a.final_stacks), (c.points, c.hands, c.final_stacks))

    @unittest.skipIf(os.environ.get("FIELD_SKIP_TIMING"), "timing skipped")
    def test_timing_p99(self):
        rules = SngRules()
        times = {n: [] for n in NAMES}
        for t in range(3):
            lineup = NAMES[t:] + NAMES[:t]
            res = play_table([make(n) for n in lineup], rules, seed=300 + t)
            for i, n in enumerate(lineup):
                times[n] += res.stats[i].times
        for n, ts in times.items():
            p99 = float(np.percentile(ts, 99))
            self.assertLess(p99, 0.0003 * factor(), f"{n} p99 {p99 * 1e3:.3f} ms")
            # max is not asserted: a GC pass or the OS can stall any decision by ~1-2 ms on a busy host

    def test_registry(self):
        self.assertEqual(set(NAMES), {"f10_chen", "f10_montecarlo", "f10_pushfold", "f10_llm_rules", "f10_aggro",
                                      "f10_passive", "f10_tag_simple", "f10_exploit_lite"})
        self.assertEqual({w for _, w in FIELDS["field10"]}, {1.0})
        from sng.registry import BOTS as ALL
        from sng.registry import field_weights
        for n in NAMES:
            self.assertIn(n, ALL)
        self.assertEqual({n for n, _ in field_weights("field10")}, set(NAMES))

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


# ------------------------------------------------------------------------------- helpers
class TestHelpers(unittest.TestCase):
    def test_chen(self):
        c = lambda s: chen(*parse_cards(s))  # noqa: E731
        self.assertEqual(c("AsAd"), 20)
        self.assertEqual(c("AsKs"), 12)
        self.assertEqual(c("2c2d"), 5)
        self.assertEqual(c("JsTs"), 9)
        self.assertEqual(c("7c2d"), -1)

    def test_percentiles(self):
        p = lambda s: pre_pct(parse_cards(s))  # noqa: E731
        self.assertLess(p("AsAd"), p("KsKd"))
        self.assertLess(p("AsKs"), p("AsKd"))
        self.assertGreater(p("7c2d"), 0.95)
        self.assertLess(p("AsAdKcQh"), 0.01)           # more cards: best pair, flattered

    def test_ranges(self):
        self.assertEqual(len(parse_range("22+")), 13)
        self.assertEqual(sorted(parse_range("A9s+")), [(12, r, True) for r in (7, 8, 9, 10, 11)])
        self.assertEqual(len(parse_range("K9+")), 8)
        self.assertEqual(parse_range("QJs"), {(10, 9, True)})

    def test_classify(self):
        def f(hole, board, draw=True):
            m, d = classify(parse_cards(hole), parse_cards(board), draw)
            return MADE_NAMES[m], d
        self.assertEqual(f("AsKd", "Kh7c2d")[0], "top")
        self.assertEqual(f("AsAd", "Kh7c2d")[0], "over")
        self.assertEqual(f("8c8d", "Ks7h2c")[0], "mid")
        self.assertEqual(f("7s7d", "7cKd2h")[0], "trips")
        self.assertEqual(f("KcQc", "KdQh2s")[0], "two")
        self.assertEqual(f("AhKh", "Qh7h2h")[0], "flush")
        self.assertEqual(f("Ac2d", "3h4s5c")[0], "straight")
        self.assertEqual(f("6s5s", "AcAd9h9s2c")[0], "board")
        self.assertEqual(f("5c5d", "Ah5s5h")[0], "boat")
        self.assertEqual(f("Ah5h", "Kh9h4c")[1], 2)       # flush draw
        self.assertEqual(f("9c8c", "7d6s2h")[1], 2)       # open-ender
        self.assertEqual(f("Ah5h", "Kh9h4c", False)[1], 0)
        self.assertEqual(raw_category(parse_cards("6s5s"), parse_cards("AcAd9h9s2c")), 2)   # board two pair

    def test_legalize(self):
        lg = Legal(can_check=False, can_call=True, call_amount=40, can_raise=True, min_raise_to=100,
                   max_raise_to=2000)

        class O:
            legal = lg
            hole = tuple(parse_cards("AsKd"))
        self.assertEqual(legalize(RaiseTo(10), O), RaiseTo(100))
        self.assertEqual(legalize(RaiseTo(99999), O), RaiseTo(2000))
        self.assertEqual(legalize(Check(), O), Fold())
        self.assertEqual(legalize(None, O), Fold())
        lg2 = Legal(can_check=True, can_call=False, call_amount=0, can_raise=False, min_raise_to=0, max_raise_to=0)
        O.legal = lg2
        self.assertEqual(legalize(Call(), O), Check())
        self.assertEqual(legalize(Fold(), O), Check())
        self.assertEqual(legalize(RaiseTo(500), O), Check())
        lg3 = Legal(False, False, 0, False, 0, 0, discard_count=1, discard_min=1)
        O.legal = lg3
        self.assertEqual(legalize(Discard(parse_cards("2c")), O), Discard((min(O.hole, key=lambda c: c >> 2),)))
        self.assertEqual(legalize(Action("raise", 5), O).kind, "discard")

    def test_fast7_matches_engine(self):
        for spec in (NLHE, PRESETS["kit4_sixplus"]["spec"]):
            ev = get_evaluator(spec)
            f = Fast7(spec)
            rng = np.random.default_rng(3)
            deck = np.array(spec.deck)
            x = np.array([rng.permutation(deck)[:7] for _ in range(5000)])
            self.assertTrue((f(x) == ev.eval_any(x)).all(), spec.name)

    def test_montecarlo_preflop_table(self):
        b = MonteCarlo()
        b.new_table(SngRules(), 0, 1)
        self.assertGreater(b.pre[(12, 12, False, 1)], 0.8)
        self.assertLess(b.pre[(5, 0, False, 1)], 0.4)
        self.assertGreater(b.pre[(12, 12, False, 1)], b.pre[(12, 12, False, 3)])

    def test_ctx_positions(self):
        b = make("f10_tag_simple")
        seen = {}
        for seat in (3, 5, 6, 7, 0, 1):
            obs, _ = spot(b, "2c7d", EIGHT, button=0, seat=seat)
            c = Ctx(obs)
            seen[seat] = (c.pos, c.behind)
        self.assertEqual(seen[3], ("ep", 7))
        self.assertEqual(seen[7], ("co", 3))
        self.assertEqual(seen[0], ("btn", 2))
        self.assertEqual(seen[1], ("sb", 1))


# ------------------------------------------------------------------------------- spots
class TestSignatureSpots(unittest.TestCase):
    def test_chen_ignores_position_and_uses_starting_stack(self):
        b = make("f10_chen")
        obs, a = spot(b, "9s8s", EIGHT, button=0, seat=3)            # UTG limps a 7-point hand
        self.assertEqual(a.kind, "call")
        stacks = [2000, 2000, 2000, 2000, 600, 2000, 2000, 2000]
        obs, a = spot(b, "AsKd", stacks, button=0, seat=4, script=[(3, RaiseTo(400))])
        self.assertEqual(a.kind, "call")                               # 400 of 600: "20% of 2000"

    def test_montecarlo_calls_a_shove_with_k7o(self):
        b = make("f10_montecarlo")
        obs, a = spot(b, "Ks7d", HU, button=0, seat=1, script=[(0, RaiseTo(2000))])
        self.assertEqual(a.kind, "call")
        t = make("f10_tag_simple")
        obs, a = spot(t, "Ks7d", HU, button=0, seat=1, script=[(0, RaiseTo(2000))])
        self.assertEqual(a.kind, "fold")

    def test_pushfold_shoves_short_and_nits_deep(self):
        b = make("f10_pushfold")
        short = [2000] * 8
        short[0] = 200                                                  # 10 bb on the button
        obs, a = spot(b, "AhJd", short, button=0, seat=0)
        self.assertTrue(is_shove(obs, a))
        obs, a = spot(b, "Js6d", short, button=0, seat=0)
        self.assertEqual(a.kind, "fold")
        obs, a = spot(b, "KhJd", EIGHT, button=0, seat=0)               # 100 bb: top 8% only
        self.assertEqual(a.kind, "fold")
        obs, a = spot(b, "AhJd", EIGHT, button=0, seat=3)
        self.assertTrue(is_raise(a) and a.amount == 60)

    def test_pushfold_bubble_is_off_by_one(self):
        b = PushFold()
        b.new_table(SngRules(), 0, 1)
        obs, _ = spot(b, "2c7d", EIGHT, button=0, seat=3)

        class C:
            pass
        c = C()
        c.obs = obs.__class__(**{**obs.__dict__, "players_left": 4})
        pay = SngRules().payouts
        self.assertAlmostEqual(b.bubble(c), 1 / (1 + 4 * (pay[4] - pay[5]) / pay[0]))

    def test_llm_rules_min_raises_aa_and_folds_a_set_on_the_river(self):
        b = make("f10_llm_rules")
        obs, a = spot(b, "AsAd", EIGHT, button=0, seat=4, script=[(3, RaiseTo(60))])
        self.assertTrue(is_raise(a))
        self.assertEqual(a.amount, obs.legal.min_raise_to)             # "raise 3x" = RaiseTo(3 * bb)
        obs, a = spot(b, "7s7d", HU, button=0, seat=1, board="7cKd2h9s3c",
                      script=HU_TO_RIVER + [(0, RaiseTo(40))])
        self.assertEqual(a.kind, "fold")                               # rule 9 before rule 12

    def test_aggro_opens_wide_and_three_bets_3x_the_call(self):
        b = make("f10_aggro")
        obs, a = spot(b, "Td8c", EIGHT, button=0, seat=3)
        self.assertTrue(is_raise(a))
        obs, a = spot(b, "AhJd", EIGHT, button=0, seat=4, script=[(3, RaiseTo(60))])
        self.assertTrue(is_raise(a))
        self.assertEqual(a.amount, 180)

    def test_passive_calls_with_a_board_pair_and_min_raises_aces(self):
        b = make("f10_passive")
        obs, a = spot(b, "4c3d", HU, button=0, seat=1, board="KhKs8c9dQs",
                      script=HU_TO_RIVER + [(0, RaiseTo(40))])
        self.assertEqual(a.kind, "call")
        obs, a = spot(b, "AsAd", EIGHT, button=0, seat=3)
        self.assertTrue(is_raise(a) and a.amount == obs.legal.min_raise_to)
        t = make("f10_tag_simple")
        obs, a = spot(t, "4c3d", HU, button=0, seat=1, board="KhKs8c9dQs",
                      script=HU_TO_RIVER + [(0, RaiseTo(40))])
        self.assertEqual(a.kind, "fold")

    def test_tag_position_ranges_and_short_stack(self):
        b = make("f10_tag_simple")
        obs, a = spot(b, "KhJd", EIGHT, button=0, seat=3)
        self.assertEqual(a.kind, "fold")
        obs, a = spot(b, "KhJd", EIGHT, button=0, seat=0)
        self.assertTrue(is_raise(a) and a.amount == 50)
        short = [2000] * 8
        short[0] = 160                                                  # 8 bb
        obs, a = spot(b, "Ah9d", short, button=0, seat=0)
        self.assertTrue(is_shove(obs, a))

    def test_exploit_lite_steals_wider_against_tight_blinds(self):
        b = make("f10_exploit_lite")
        obs, a = spot(b, "Kh8d", EIGHT, button=0, seat=0)
        self.assertEqual(a.kind, "fold")

        def tight(bot):
            for j in (1, 2):
                s = bot.stats_for(j)
                s.hands, s.vpip, s.pfr = 10, 1, 1
        obs, a = spot(b, "Kh8d", EIGHT, button=0, seat=0, prepare=tight)
        self.assertTrue(is_raise(a))

    def test_exploit_lite_calls_lighter_against_a_maniac(self):
        b = make("f10_exploit_lite")
        obs, a = spot(b, "KhJd", EIGHT, button=0, seat=4, script=[(3, RaiseTo(60))])
        self.assertEqual(a.kind, "fold")

        def maniac(bot):
            s = bot.stats_for(3)
            s.hands, s.vpip, s.pfr = 6, 5, 4
        obs, a = spot(b, "KhJd", EIGHT, button=0, seat=4, script=[(3, RaiseTo(60))], prepare=maniac)
        self.assertEqual(a.kind, "call")

    def test_exploit_lite_counts_stats_from_history(self):
        b = make("f10_exploit_lite")
        b.new_table(SngRules(), 0, 1)
        b.end_hand(dict(history=((1, 0, "post", 10), (2, 0, "post", 20), (3, 0, "raise", 60), (4, 0, "call", 60),
                                 (5, 0, "fold", 0), (3, 1, "raise", 80), (4, 1, "call", 80))))
        self.assertEqual(b.rates(3)[:2], (1.0, 1.0))
        self.assertEqual(b.rates(4)[:2], (1.0, 0.0))
        self.assertEqual(b.rates(5)[:2], (0.0, 0.0))
        self.assertEqual(b.rates(2)[:2], (0.25, 0.15))                 # never acted: prior


if __name__ == "__main__":
    unittest.main()
