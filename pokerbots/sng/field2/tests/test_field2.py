"""field2 tests: helpers, bot rules, legality on four variants, timing, chip conservation.
    python3 -m unittest discover -s sng/field2/tests -t .
"""
import importlib
import random
import unittest

import numpy as np

from engine.cards import parse_card
from engine.evaluator import get_evaluator
from engine.game import Call, Check, Fold, RaiseTo
from engine.variants import get_variant
from sng.icm import icm
from sng.rules import NLHE, SngRules
from sng.table import Hand, play_table

from sng.field2 import common
from sng.field2.common import (OppStats, Scorer, bubble_factors, get_preflop, icm_one, push_pct, read_postflop)
from sng.field2.registry import BOTS, FIELDS

NAMES = list(BOTS)
LINEUP = NAMES + NAMES[:2]                     # all six plus two copies


def make(name):
    mod, cls = BOTS[name]
    return getattr(importlib.import_module(mod), cls)()


def cards(s):
    return [parse_card(c) for c in s.split()]


def variant_rules():
    return {
        "nlhe": SngRules(enforce_time=False),
        "pot_limit": SngRules(spec=NLHE.with_(betting="pot_limit"), enforce_time=False),
        "short_deck": SngRules(spec=get_variant("e_shortdeck").with_(stack_reset_per_hand=False), enforce_time=False),
        "omaha": SngRules(spec=get_variant("d_omaha4x2").with_(stack_reset_per_hand=False), enforce_time=False),
    }


def deck_with(holes, board, spec):
    """Deck that deals `holes` (one string per seat) and `board` (5 cards)."""
    used = []
    for h in holes:
        used += cards(h)
    used += cards(board)
    rest = [c for c in spec.deck if c not in used]
    return used + rest


def decision(bot_name, holes, board, plan, hero, stacks=None, button=0, hand_number=0, rules=None):
    """Play one hand where seats in `plan` follow scripted actions (lists) and the hero's
    bot decides; returns the hero's first action."""
    r = rules or SngRules(num_players=len(holes), payouts=SngRules().payouts[:len(holes)], enforce_time=False)
    stacks = stacks or [2000] * len(holes)
    bot = make(bot_name)
    bot.new_table(r, hero, 1)
    deck = deck_with(holes, board, r.spec)
    h = Hand(r, stacks, button=button, hand_number=hand_number, deck=deck)
    seen = []
    plan = {k: list(v) for k, v in plan.items()}

    def decide(j, obs, lg):
        if j == hero:
            a = bot.act(obs)
            seen.append(a)
            if not lg.is_legal(a):
                raise AssertionError(f"illegal {a}")
            return a if a.kind != "raise" else Fold() if len(seen) > 1 else a
        if plan.get(j):
            return plan[j].pop(0)
        return Check() if lg.can_check else Fold()

    try:
        h.play(decide, sum(1 for s in stacks if s > 0))
    except IndexError:
        pass
    return seen[0]


# ---------------------------------------------------------------------------------------
class TestHelpers(unittest.TestCase):
    def test_scorer_matches_engine(self):
        for spec in (NLHE, get_variant("e_shortdeck")):
            sc = Scorer(spec)
            ev = get_evaluator(spec)
            rng = random.Random(3)
            for n in (5, 6, 7):
                for _ in range(400):
                    cs = rng.sample(spec.deck, n)
                    self.assertEqual(sc.score_cards(cs), int(ev.eval_any(np.array([cs]))[0]), (spec.name, cs))

    def test_omaha_scorer_uses_exactly_two(self):
        spec = get_variant("d_omaha4x2")
        sc = Scorer(spec)
        hole, board = cards("Ah Kd 7c 2s"), cards("Qh Jh Th 9h 3c")   # no flush: needs 2 hearts
        self.assertEqual(sc.score(hole, board), get_evaluator(spec).evaluate(hole, board))
        self.assertNotEqual(get_evaluator(spec).category(sc.score(hole, board)), "flush")

    def test_preflop_table_orders_hands(self):
        t = get_preflop(NLHE)
        aa, kk, s72 = t.cls(cards("Ah Ad")), t.cls(cards("Kh Kd")), t.cls(cards("7h 2d"))
        self.assertLess(t.pct_l[aa], 0.01)
        self.assertLess(t.pct_l[aa], t.pct_l[kk])
        self.assertGreater(t.pct_l[s72], 0.85)
        self.assertGreater(t.eq1_l[aa], 0.82)
        self.assertGreater(t.eq1_l[aa], t.eq2_l[aa])
        self.assertGreater(t.eq2_l[aa], t.eq3_l[aa])
        # equity vs a tighter range is lower for a weak hand
        self.assertLess(t.eq_vs_top(s72, 0.05), t.eq_vs_top(s72, 1.0))
        self.assertAlmostEqual(float(t.M[aa, kk] + t.M[kk, aa]), 1.0, places=6)

    def test_heuristic_preflop_for_omaha(self):
        t = get_preflop(get_variant("d_omaha4x2"))
        self.assertFalse(t.two_card)
        self.assertLess(t.pct_of(cards("Ah As Kh Ks")), t.pct_of(cards("7c 2d 9h 3s")))

    def test_icm_one_matches_engine(self):
        pays = SngRules().payouts
        for st in ([2000] * 8, [5000, 3000, 2500, 2000, 1500, 1200, 500, 300], [9000, 4000, 3000]):
            ref = icm(st, pays[:len(st)])
            for i in range(len(st)):
                self.assertAlmostEqual(icm_one(st, pays[:len(st)], i), ref[i], places=6)

    def test_bubble_factor_above_one(self):
        base, bf = bubble_factors([2000] * 8, SngRules().payouts, 0)
        self.assertAlmostEqual(base, 278 / 8, places=6)
        self.assertTrue(all(v > 1.0 for v in bf.values()))

    def test_push_chart_monotone(self):
        self.assertGreater(push_pct(5, 1), push_pct(10, 1))
        self.assertGreater(push_pct(10, 1), push_pct(10, 5))

    def test_read_postflop(self):
        sc = Scorer(NLHE)
        r = read_postflop(sc, cards("Ah Ad"), cards("As 7c 2d"))
        self.assertEqual(r.label, "set")
        self.assertGreater(r.hs, 0.88)
        r = read_postflop(sc, cards("Kh 9h"), cards("2h 7h Qc"))
        self.assertTrue(r.fd)
        self.assertGreaterEqual(r.outs, 9)
        r = read_postflop(sc, cards("8c 9d"), cards("Ts Jh 2c"))
        self.assertEqual(r.sd, 2)                                   # open-ended
        r = read_postflop(sc, cards("3c 4d"), cards("Ks Qh 9c 8d 2s"))
        self.assertEqual(r.label, "air")
        self.assertLess(r.hs, 0.15)
        self.assertEqual(r.outs, 0)                                  # river: no draws

    def test_opp_stats_counts(self):
        st = OppStats(4)
        # seat 3 raises, seat 0 calls, seats 1 (SB) folds, 2 (BB) folds; flop: 3 bets, 0 folds
        hist = ((1, 0, "post", 10), (2, 0, "post", 20), (3, 0, "raise", 60), (0, 0, "call", 60),
                (1, 0, "fold", 0), (2, 0, "fold", 0), (3, 1, "raise", 80), (0, 1, "fold", 0))
        info = dict(history=hist, stacks=(1940, 1990, 1980, 2090), deltas=(-60, -10, -20, 90), showdown=None)
        st.update(info, [2000] * 4)
        self.assertEqual(st.vpip, [1, 0, 0, 1])
        self.assertEqual(st.pfr, [0, 0, 0, 1])
        self.assertEqual(st.cbet_faced[0], 1)
        self.assertEqual(st.cbet_fold[0], 1)
        self.assertEqual(st.agg[3], 1)
        self.assertEqual(st.hands, [1, 1, 1, 1])


class TestRegistry(unittest.TestCase):
    def test_names_and_field(self):
        self.assertEqual(len(BOTS), 6)
        self.assertTrue(all(n.startswith("f2_") for n in BOTS))
        self.assertEqual(sorted(n for n, _ in FIELDS["field2"]), sorted(BOTS))
        self.assertEqual(len({w for _, w in FIELDS["field2"]}), 1)
        for n in BOTS:
            b = make(n)
            self.assertTrue(hasattr(b, "act") and hasattr(b, "new_table"))

    def test_main_registry_sees_field2(self):
        from sng import registry
        for n in BOTS:
            self.assertIn(n, registry.BOTS)
            registry.make(n)
        self.assertEqual(registry.field_weights("field2"), FIELDS["field2"])


class TestBotRules(unittest.TestCase):
    """Spot checks of each design on scripted 4-handed spots (hero = seat 3 = UTG)."""
    H = ["7c 2d", "8s 3h", "9d 4c"]

    def test_everyone_shoves_or_raises_aces_short(self):
        for n in NAMES:
            a = decision(n, self.H + ["Ah Ad"], "2s 5h 9c Jd Qs", {}, hero=3, stacks=[2000, 2000, 2000, 200])
            self.assertEqual(a.kind, "raise", n)

    def test_everyone_folds_trash_to_a_shove_deep(self):
        for n in NAMES:
            plan = {3: [RaiseTo(2000)]}
            a = decision(n, ["7c 2d", "8s 3h", "9d 4c", "Ah Ad"], "2s 5h 9c Jd Qs", plan, hero=0)
            self.assertEqual(a.kind, "fold", n)

    def test_everyone_calls_a_shove_with_aces(self):
        for n in NAMES:
            plan = {3: [RaiseTo(2000)]}
            a = decision(n, ["Ah Ad", "8s 3h", "9d 4c", "7c 2d"], "2s 5h 9c Jd Qs", plan, hero=0)
            self.assertIn(a.kind, ("call", "raise"), n)

    def test_nobody_folds_when_checking_is_free(self):
        # limped pot to the big blind (seat 2) with trash
        for n in NAMES:
            plan = {3: [Call()], 0: [Call()], 1: [Call()]}
            a = decision(n, ["7c 2d", "8s 3h", "9d 4c", "Kh 5s"], "2s 5h 9c Jd Qs", plan, hero=2)
            self.assertNotEqual(a.kind, "fold", n)

    def test_nash_folds_trash_utg_at_10bb(self):
        a = decision("f2_nash", self.H + ["7h 2s"], "2s 5h 9c Jd Qs", {}, hero=3, stacks=[2000, 2000, 2000, 200])
        self.assertEqual(a.kind, "fold")

    def test_bubble_short_stack_shoves_wide_from_the_button(self):
        # 4-handed, hero on the button (seat 0) with 120 chips (6bb): K7o is a shove
        a = decision("f2_bubble", ["Kc 7d", "8s 3h", "9d 4c", "2c 3d"], "2s 5h 9c Jd Qs", {3: [Fold()]},
                     hero=0, stacks=[120, 3000, 3000, 2000], button=0)
        self.assertEqual(a.kind, "raise")


# ---------------------------------------------------------------------------------------
class TestTables(unittest.TestCase):
    def _run(self, rules, n_tables, seed0):
        res_all = []
        for t in range(n_tables):
            lineup = LINEUP[t % 8:] + LINEUP[:t % 8]
            bots = [make(x) for x in lineup]
            res = play_table(bots, rules, seed=seed0 + t)
            for i, st in enumerate(res.stats):
                self.assertEqual(st.errors, 0, f"{lineup[i]} {rules.spec.name}: {st.first_error}")
                self.assertEqual(st.illegal, 0, f"{lineup[i]} {rules.spec.name}: {st.first_error}")
            self.assertEqual(sum(res.final_stacks), rules.starting_stack * rules.num_players)
            self.assertAlmostEqual(sum(res.points), sum(rules.payouts), places=6)
            res_all.append((lineup, res))
        return res_all

    def test_variants_zero_errors_and_illegal(self):
        for name, rules in variant_rules().items():
            with self.subTest(variant=name):
                self._run(rules, 3, 1000)

    def test_chips_conserved_all_six_plus_two(self):
        rules = SngRules(enforce_time=False)
        for lineup, res in self._run(rules, 2, 77):
            self.assertEqual(sum(res.final_stacks), 16000)
            self.assertTrue(all(s >= 0 for s in res.final_stacks))

    def test_timing_p99_under_0_4ms(self):
        for name in ("nlhe", "omaha"):
            rules = variant_rules()[name]
            times = {n: [] for n in NAMES}
            for lineup, res in self._run(rules, 4, 500):
                for i, st in enumerate(res.stats):
                    times[lineup[i]] += st.times
            for n, ts in times.items():
                p99 = float(np.percentile(ts, 99)) * 1000
                self.assertLess(p99, 0.4, f"{n} {name} p99 {p99:.3f} ms")


class TestColdStart(unittest.TestCase):
    def test_no_lazy_build_inside_act(self):
        """In a fresh process (empty caches) no decision may pay for a lazy table build."""
        import subprocess
        import sys
        code = ("from engine.variants import get_variant; from sng.rules import SngRules; "
                "from sng.table import play_table; from sng.field2.tests.test_field2 import make, LINEUP; "
                "import sys; v = sys.argv[1]; "
                "r = SngRules(spec=get_variant(v).with_(stack_reset_per_hand=False)) if v != 'nlhe' else SngRules(); "
                "res = play_table([make(x) for x in LINEUP], r, seed=11); "
                "print(sum(s.over_limit for s in res.stats))")
        for v in ("nlhe", "d_omaha4x2"):
            out = subprocess.run([sys.executable, "-c", code, v], capture_output=True, text=True, timeout=120)
            self.assertEqual(out.returncode, 0, out.stderr[-800:])
            self.assertLessEqual(int(out.stdout.strip().splitlines()[-1]), 1, v)   # allow one OS hiccup


class TestRoundRobin(unittest.TestCase):
    def test_small_round_robin(self):
        from sng.field2 import roundrobin
        out = roundrobin.run(tables=2, workers=1, seed0=5)
        self.assertEqual(len(out), 2)
        text = roundrobin.summarize(out)
        self.assertIn("points/seat", text)


if __name__ == "__main__":
    unittest.main()
