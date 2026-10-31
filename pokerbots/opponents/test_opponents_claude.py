"""Tests for opponents/pushfold_solver.py (opp_solver) and opponents/quick.py (opp_quick).

Run from pokerbots/:  OMP_NUM_THREADS=1 python3 -m unittest opponents.test_opponents_claude
"""
from __future__ import annotations

import unittest

import numpy as np

from bots.random_legal import RandomLegalBot
from engine.bot import Bot
from engine.game import ActionRecord
from engine.match import play_match
from engine.variants import ALL_VARIANTS, get_variant
from opponents import pushfold_solver as ps
from opponents import quick

FAST = 3.0   # solve budget (s) used in tests


def solver(**kw):
    kw.setdefault("budget_s", FAST)
    return ps.make_bot(**kw)


class TestSolverParts(unittest.TestCase):
    def test_raise_amounts_respect_limits(self):
        for spec in ALL_VARIANTS.values():
            smax = spec.starting_stack - spec.ante
            pips = [spec.small_blind, spec.big_blind]
            for lab, amt in ps.raise_amounts(spec, pips, 0, 0, spec.big_blind, smax):
                self.assertGreaterEqual(amt, spec.big_blind * 2)
                self.assertLessEqual(amt, smax)
                if spec.betting == "pot_limit":
                    pot_after = 2 * spec.ante + sum(pips) + (pips[1] - pips[0])
                    self.assertLessEqual(amt, max(pips) + pot_after)

    def test_tree_terminals_zero_sum_and_fold_values(self):
        spec = get_variant("a")
        E = np.full((ps.B, ps.B), 0.5)
        root, nodes = ps.build_tree(spec, E)
        f = root.children[root.labels.index("f")]
        self.assertTrue(np.all(f.U == -spec.small_blind))   # SB folds its blind
        for n in nodes:
            if n.terminal is None:
                self.assertEqual(len(n.children), len(n.labels))
            else:
                self.assertEqual(n.U.shape, (ps.B, ps.B))

    def test_cfr_strategies_are_distributions_and_sensible(self):
        sol = ps.get_solution(get_variant("a"), budget_s=FAST)
        for sig in sol.avg.values():
            np.testing.assert_allclose(sig.sum(1), 1.0, atol=1e-6)
            self.assertTrue(np.all(sig >= 0))
        root = sol.avg[sol.root.id]
        fold = root[:, sol.root.labels.index("f")]
        self.assertGreater(fold[0], fold[-1])           # weakest bucket folds more than best
        self.assertLess(fold[-1], 0.05)

    def test_solution_cached_by_rules(self):
        spec = get_variant("f")
        a = ps.get_solution(spec, budget_s=FAST)
        b = ps.get_solution(spec.with_(time_per_decision=None, hands_per_match=7, name="x"))
        self.assertIs(a, b)

    def test_bucket_matrix_symmetric(self):
        sol = ps.get_solution(get_variant("a"), budget_s=FAST)
        np.testing.assert_allclose(sol.E + sol.E.T, 1.0, atol=1e-9)
        self.assertGreater(sol.E[-1, 0], 0.65)

    def test_replay_maps_open_raise(self):
        bot = solver()
        spec = get_variant("a")
        bot.new_match(spec, 0)
        hist = (ActionRecord(0, 0, "raise", 6),)

        class O:  # minimal observation stand-in
            history = hist
            my_stack, my_committed, opp_stack, opp_committed = 198, 2, 194, 6
        node, path = bot._replay(O)
        self.assertEqual(node.player, 1)
        self.assertEqual(sol_label(path[0]), "r")


def sol_label(step):
    node, a = step
    return node.labels[a]


class TestPlay(unittest.TestCase):
    def _play(self, factory, spec, hands=40):
        for seat in (0, 1):
            bots = [factory(), RandomLegalBot()]
            if seat:
                bots.reverse()
            r = play_match(bots[0], bots[1], spec, deal_seed=5 + seat, hands=hands)
            st = r.stats[seat].summary()
            self.assertEqual(st["illegal"], 0, (spec.name, st["first_error"]))
            self.assertEqual(st["errors"], 0, (spec.name, st["first_error"]))
            self.assertLess(st["max_ms"], 200, spec.name)   # loose: CI noise
        return r

    def test_bots_are_bots(self):
        self.assertIsInstance(solver(), Bot)
        self.assertIsInstance(quick.make_bot(), Bot)
        self.assertEqual(solver().name, "opp_solver")
        self.assertEqual(quick.make_bot().name, "opp_quick")

    def test_quick_all_variants_legal(self):
        for spec in ALL_VARIANTS.values():
            self._play(quick.make_bot, spec)

    def test_solver_fallback_all_variants_legal(self):
        for spec in ALL_VARIANTS.values():
            self._play(lambda: solver(solve=False), spec)

    def test_solver_with_solve_legal(self):
        for name in ("a", "c", "h", "i"):
            self._play(solver, get_variant(name), hands=30)

    def test_solver_odd_stack_depth_falls_back(self):
        spec = get_variant("a").with_(stack_reset_per_hand=False)
        self._play(solver, spec, hands=60)

    def test_match_clock_limits_solve(self):
        bot = solver()
        bot.new_match(get_variant("e").with_(time_per_match=2.0), 0)
        self.assertIsNone(bot.sol)   # 0.2 * 2 s < 1 s: no solve, fallback rules

    def test_quick_beats_station(self):
        from bots.dummies import make_bot as dummy
        spec = get_variant("a")
        tot = 0.0
        for seed in (1, 2):
            tot += play_match(quick.make_bot(), dummy("station"), spec, seed, hands=150).bb_per_hand(0)
            tot += play_match(dummy("station"), quick.make_bot(), spec, seed, hands=150).bb_per_hand(1)
        self.assertGreater(tot, 0)


if __name__ == "__main__":
    unittest.main()
