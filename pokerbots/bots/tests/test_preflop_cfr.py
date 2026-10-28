"""Tests for approach #4, preflop CFR + balanced postflop (bots/cfr_preflop, bots/preflop_cfr.py).

    python3 -m unittest bots.tests.test_preflop_cfr      (from pokerbots/)
"""
from __future__ import annotations

import io
import os
import random
import shutil
import tempfile
import unittest
from contextlib import redirect_stderr
from types import SimpleNamespace

import numpy as np

from engine.game import Call, Check, Discard, Fold, HandState, RaiseTo
from engine.match import deal_order, play_match
from engine.variants import VARIANTS

from bots.cfr_preflop.abstraction import (Universe, build_class_abstraction, canon_keys,
                                          class_key)
from bots.cfr_preflop.evaluate import best_response_value, exploitability
from bots.cfr_preflop.game import (CALL, CHECK, DECISION, FOLD, RAISE, TERM_FLOP, TERM_FOLD,
                                   TERM_SHOWDOWN, BetState, Node, PreflopGame, Tree, TreeConfig,
                                   map_raise, pseudo_harmonic)
from bots.cfr_preflop.policy import load_policy
from bots.cfr_preflop.train import DCFR, TrainConfig, policy_path, train
from bots.preflop_cfr import PreflopCFRBot, make_bot
from bots.random_legal import RandomLegalBot

A, F = VARIANTS["a_nlhe100"], VARIANTS["f_nlhe20"]
PL = A.with_(name="pl_test", betting="pot_limit")


class _Stop(Exception):
    pass


def _paths(tree):
    """Every root-to-terminal sequence of (node, action index)."""
    out = []

    def rec(nid, acc):
        n = tree.nodes[nid]
        if n.is_terminal:
            out.append((acc, n))
            return
        for a, c in enumerate(n.children):
            rec(c, acc + [(n, a)])
    rec(tree.root, [])
    return out


def _to_action(kind, amount):
    return {FOLD: Fold(), CHECK: Check(), CALL: Call()}.get(kind) or RaiseTo(amount)


def obs_after(spec, script, seed=0):
    """The observation at the first decision after the scripted preflop actions."""
    script = list(script)
    hs = HandState(spec, deal_order(spec, seed, 0))
    seen = {}

    def decide(pos, obs):
        if not script:
            seen["obs"] = obs
            raise _Stop
        return script.pop(0)
    try:
        hs.play(decide)
    except _Stop:
        return seen["obs"]
    raise AssertionError("hand ended before the script ran out")


class TestTreeLegality(unittest.TestCase):
    """Drive the real engine along every path of the abstract tree."""

    def _check(self, spec):
        tree = Tree(spec)
        for path, leaf in _paths(tree):
            steps = list(path)
            hs = HandState(spec, deal_order(spec, 1, 0))
            postflop = {}

            def decide(pos, obs):
                if obs.phase == "discard":
                    return Discard(obs.my_cards[:obs.legal.discard_count])
                if obs.street > 0:
                    postflop.setdefault("pips", (obs.my_committed, obs.opp_committed, pos))
                    return obs.legal.passive()
                node, a = steps.pop(0)
                st = node.state
                self.assertEqual(node.player, pos)
                self.assertEqual((obs.my_pip, obs.opp_pip), (st.pips[pos], st.pips[1 - pos]))
                self.assertEqual((obs.my_stack, obs.opp_stack), (st.stacks[pos], st.stacks[1 - pos]))
                lg = obs.legal
                # the abstract action set: fold only when facing a bet, raises legal
                self.assertEqual("f" in node.labels, lg.call_amount > 0)
                self.assertEqual("k" in node.labels, lg.can_check)
                raises = [x for x, k in zip(node.amounts, node.kinds) if k == RAISE]
                self.assertEqual(len(raises), len(set(raises)))
                if raises:
                    self.assertTrue(lg.can_raise)
                    self.assertLessEqual(st.nraises, tree.cfg.max_raises - 1)
                act = _to_action(node.kinds[a], node.amounts[a])
                self.assertTrue(lg.is_legal(act), f"{node.path}: {act} not legal under {lg}")
                return act
            hs.play(decide)
            self.assertEqual(steps, [])
            if leaf.kind == TERM_FOLD:
                self.assertEqual(hs.folded, leaf.state.folder)
            else:
                self.assertIsNone(hs.folded)
                c = tuple(hs.committed)
                self.assertEqual(c, tuple(leaf.state.committed))
                if leaf.kind == TERM_SHOWDOWN:
                    self.assertTrue(min(hs.stacks) == 0 or spec.num_streets == 1)
                else:
                    self.assertGreater(min(leaf.state.stacks), 0)
        return tree

    def test_100bb(self):
        tree = self._check(A)
        self.assertEqual(tree.nodes[tree.root].labels, ["f", "c", "r5", "r6", "r200"])

    def test_20bb_sizes_collapse(self):
        tree = self._check(F)
        for n in tree.decision_nodes:
            self.assertTrue(all(x <= 40 for x in n.amounts))
        # the 4-bet (2.3x of a 3-bet to 15) commits > 45% of the stack: only all-in remains
        n = next(n for n in tree.decision_nodes if n.path == "r5-r15")
        self.assertEqual(n.labels, ["f", "c", "r40"])

    def test_pot_limit(self):
        tree = self._check(PL)
        for n in tree.decision_nodes:
            st = n.state
            p = st.to_act
            call = max(st.pips) - st.pips[p]
            for x, k in zip(n.amounts, n.kinds):
                if k == RAISE:
                    self.assertLessEqual(x, max(st.pips) + st.pot + call)

    def test_ante_and_short_variants(self):
        self._check(A.with_(name="ante", ante=1))
        self._check(F.with_(name="tiny", starting_stack=5))


def tiny_game():
    """SB folds (loses 1) or shoves to 10; BB folds (loses 2) or calls. Two buckets,
    strong always beats weak, independent and equally likely."""
    spec = SimpleNamespace(big_blind=2)
    st = lambda c, folder=-1: SimpleNamespace(committed=[*c], folder=folder)
    nodes = [
        Node(0, DECISION, None, player=0, labels=["f", "r10"], kinds=[FOLD, RAISE], children=[1, 2]),
        Node(1, TERM_FOLD, st((1, 2), 0)),
        Node(2, DECISION, None, player=1, labels=["f", "c"], kinds=[FOLD, CALL], children=[3, 4]),
        Node(3, TERM_FOLD, st((10, 2), 1)),
        Node(4, TERM_SHOWDOWN, st((10, 10))),
    ]
    tree = SimpleNamespace(nodes=nodes, root=0, spec=spec, cfg=TreeConfig(),
                           decision_nodes=[nodes[0], nodes[2]])
    W = np.full((2, 2), 0.25)
    E = np.array([[0.5, 1.0], [0.0, 0.5]])    # bucket 0 = strong
    return PreflopGame(tree, W, E, TreeConfig())


class TestExploitability(unittest.TestCase):
    def test_hand_checkable(self):
        g = tiny_game()
        # SB always shoves; BB calls with the strong bucket only
        strat = {0: np.array([[0.0, 1.0], [0.0, 1.0]]), 2: np.array([[0.0, 1.0], [1.0, 0.0]])}
        # BB best response vs always-shove: strong calls 20*0.75-10 = +5, weak folds -2 -> 1.5
        self.assertAlmostEqual(best_response_value(g, strat, 1), 1.5)
        # SB best response: strong shoves (0.5*2 + 0.5*0 = +1), weak folds (-1) -> 0
        self.assertAlmostEqual(best_response_value(g, strat, 0), 0.0)
        ex = exploitability(g, strat)
        self.assertAlmostEqual(ex["chips"], 0.75)
        self.assertAlmostEqual(ex["mbb"], 375.0)
        # SB value: strong +1, weak: 0.5*2 + 0.5*(-10) = -4 -> -1.5
        self.assertAlmostEqual(ex["value_sb"], -1.5)

    def test_cfr_reduces_exploitability(self):
        tree = Tree(F)
        K = 8
        s = np.linspace(0, 1, K)
        E = np.clip(0.5 + 0.6 * (s[:, None] - s[None, :]), 0, 1)
        g = PreflopGame(tree, np.full((K, K), 1.0 / K ** 2), E)
        solver = DCFR(g)
        solver.iterate()
        e1 = exploitability(g, solver.average())["mbb"]
        for _ in range(300):
            solver.iterate()
        e2 = exploitability(g, solver.average())["mbb"]
        self.assertLess(e2, 0.02 * e1)
        self.assertLess(e2, 5.0)
        # regression: nodes the opponent never reaches must still enter the average
        # (after a restart of the average, one iteration's average = the current strategy
        # wherever it matters, so the exploitabilities are equal)
        solver.reset_average()
        cur = {k: solver.current(k) for k in solver.reg}   # what this iteration averages
        solver.iterate()
        self.assertAlmostEqual(exploitability(g, solver.average())["mbb"],
                               exploitability(g, cur)["mbb"], delta=1e-3)
        # the tiny game: CFR finds the equilibrium (exploitability -> 0)
        tg = tiny_game()
        sol = DCFR(tg)
        for _ in range(500):
            sol.iterate()
        self.assertLess(exploitability(tg, sol.average())["chips"], 1e-2)


class TestTranslation(unittest.TestCase):
    def test_pseudo_harmonic(self):
        self.assertAlmostEqual(pseudo_harmonic(0.5, 0.5, 1.0), 1.0)
        self.assertAlmostEqual(pseudo_harmonic(1.0, 0.5, 1.0), 0.0)
        xs = np.linspace(0.5, 1.0, 11)
        ps = [pseudo_harmonic(x, 0.5, 1.0) for x in xs]
        self.assertTrue(all(a >= b for a, b in zip(ps, ps[1:])))
        # known value: x=0.75 between 0.5 and 1 -> (0.25*1.5)/(0.5*1.75) = 3/7
        self.assertAlmostEqual(pseudo_harmonic(0.75, 0.5, 1.0), 3 / 7)

    def test_map_raise(self):
        fr = np.array([0.75, 1.0, 49.5])
        self.assertEqual(map_raise(fr, 0.2, 0.5), 0)
        self.assertEqual(map_raise(fr, 80.0, 0.5), 2)
        self.assertEqual(map_raise(fr, 3.0, 0.5, allin_index=2, is_allin=True), 2)
        self.assertEqual(map_raise(fr, 0.8, 0.0), 0)
        self.assertEqual(map_raise(fr, 0.8, 0.999), 1)

    def test_locate_off_tree(self):
        tree = Tree(A)
        K = 4
        pol = SimpleNamespace()  # a policy over a synthetic game, built through the real class
        from bots.cfr_preflop.policy import PreflopPolicy, rules_spec
        from bots.cfr_preflop.abstraction import CardAbstraction
        ab = CardAbstraction("bucket", K, 2, {}, np.full(K, 0.25), ["b"] * K)
        strat = {n.id: np.full((K, n.num_actions), 1.0 / n.num_actions) for n in tree.decision_nodes}
        pol = PreflopPolicy(dict(spec_name=A.name, spec=rules_spec(A), tree_config=tree.cfg.to_dict(),
                                 fingerprint=tree.fingerprint(), abstraction=ab, strategy=strat,
                                 W=np.full((K, K), 1 / K ** 2), E=np.full((K, K), 0.5), meta={}))
        rng = random.Random(0)
        # SB raises to 7 (pot fraction 1.25 > pot raise 1.0 < all-in): BB is at r6 or r200
        obs = obs_after(A, [RaiseTo(7)])
        node, real = pol.locate(obs, {}, rng)
        self.assertIn(node.path, ("r6", "r200"))
        self.assertEqual(real.pips, [7, 2])
        # an all-in maps to the abstract all-in
        node, _ = pol.locate(obs_after(A, [RaiseTo(200)]), {}, rng)
        self.assertEqual(node.path, "r200")
        # a min-raise maps to the smallest open
        node, _ = pol.locate(obs_after(A, [RaiseTo(4)]), {}, rng)
        self.assertEqual(node.path, "r5")
        # a randomised translation is remembered for the rest of the hand
        obs = obs_after(A, [RaiseTo(7)])
        memo = {}
        first = pol.locate(obs, memo, rng)[0].path
        self.assertEqual(set(memo), {0})
        self.assertTrue(all(pol.locate(obs, memo, rng)[0].path == first for _ in range(30)))
        # off-tree raise sequence: we act at the translated node and our action is legal
        obs = obs_after(A, [RaiseTo(6), RaiseTo(30)])
        node, real = pol.locate(obs, {}, rng)
        self.assertEqual(node.player, 0)
        self.assertEqual(real.pips, [6, 30])
        for _ in range(20):
            act, a = pol.act(obs, rng, {}, 1)
            self.assertTrue(obs.legal.is_legal(act))
        # more raises than the abstraction allows: off tree (the bot falls back)
        obs = obs_after(A, [RaiseTo(4), RaiseTo(6), RaiseTo(8), RaiseTo(10), RaiseTo(12)])
        self.assertIsNone(pol.locate(obs, {}, rng))
        # stacks far from the trained depth: off tree
        self.assertIsNone(pol.locate(obs_after(A.with_(starting_stack=600), []), {}, rng))


class TestAbstraction(unittest.TestCase):
    def test_canonical_keys_match_engine(self):
        rng = np.random.default_rng(0)
        for h in (2, 3, 4):
            hands = np.array([rng.choice(52, h, replace=False) for _ in range(200)])
            keys = canon_keys(hands)
            self.assertEqual(keys.tolist(), [class_key(tuple(int(c) for c in x)) for x in hands])

    def test_class_counts(self):
        u = Universe(A)
        ab = build_class_abstraction(A, u)
        self.assertEqual(ab.K, 169)
        self.assertAlmostEqual(float(ab.freq.sum()), 1.0)
        self.assertEqual(Universe(VARIANTS["e_shortdeck"]).C, 81)


class _PolicyFixture(unittest.TestCase):
    """Trains tiny policies once (a few seconds each) into a temp dir."""
    tmp = None
    VARS = (F, A, VARIANTS["d_omaha4x2"], PL)

    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.mkdtemp(prefix="pfcfr_")
        cls.paths = {}
        cfg = TrainConfig(pool_size=300, pair_batch=4000)
        for spec in cls.VARS:
            cls.paths[spec.name] = train(spec, 0.04, seed=1, out_dir=cls.tmp, cfg=cfg,
                                         log=lambda s: None)[0]

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.tmp, ignore_errors=True)


class TestPolicyAndBot(_PolicyFixture):
    def test_save_load_roundtrip(self):
        path = self.paths[F.name]
        self.assertEqual(path, policy_path(self.tmp, F.name, 0.04))
        pol = load_policy(path)
        self.assertTrue(pol.matches(F))
        self.assertTrue(pol.matches(F.with_(time_per_decision=1.0)))
        self.assertFalse(pol.matches(A))
        pol2 = load_policy(path)
        self.assertEqual(set(pol.strategy), {n.id for n in pol.tree.decision_nodes})
        for k, v in pol.strategy.items():
            np.testing.assert_array_equal(v, pol2.strategy[k])
            np.testing.assert_allclose(v.sum(1), 1.0, atol=1e-5)
        self.assertEqual(pol.tree.fingerprint(), pol2.tree.fingerprint())
        self.assertEqual(pol.abstraction.key_to_bucket, pol2.abstraction.key_to_bucket)
        ex = exploitability(pol.game(), pol.strategy)
        self.assertAlmostEqual(ex["mbb"], pol.meta["exploitability_mbb"], delta=0.05 + 0.01 * ex["mbb"])
        # 3+ hole cards: every class maps to a bucket
        om = load_policy(self.paths["d_omaha4x2"])
        self.assertEqual(om.abstraction.kind, "bucket")
        self.assertEqual(len(om.abstraction.key_to_bucket), 16432)
        rng = np.random.default_rng(3)
        for _ in range(20):
            b = om.abstraction.bucket_of(tuple(int(c) for c in rng.choice(52, 4, replace=False)))
            self.assertTrue(0 <= b < om.abstraction.K)

    def _play(self, spec, factory, hands=40):
        for opp in (RandomLegalBot, factory):
            for seat in (0, 1):
                bot = factory()
                pair = (bot, opp()) if seat == 0 else (opp(), bot)
                r = play_match(pair[0], pair[1], spec, deal_seed=11 + seat, hands=hands)
                for s in (0, 1):
                    st = r.stats[s].summary()
                    self.assertEqual(st["illegal"], 0, st["first_error"])
                    self.assertEqual(st["errors"], 0, st["first_error"])
                    if isinstance(pair[s], PreflopCFRBot):
                        self.assertEqual(pair[s].errors, 0, pair[s].last_error)
                        self.assertLess(st["max_ms"], 1000)
        return bot

    def test_legal_with_policy(self):
        for spec in self.VARS:
            bot = self._play(spec, lambda: make_bot(policy_path=self.paths[spec.name]))
            self.assertFalse(bot.using_fallback)
            self.assertGreater(bot.cfr_decisions, 0)

    def test_legal_without_policy(self):
        buf = io.StringIO()
        with redirect_stderr(buf):
            for spec in (F, VARIANTS["c_discard3"]):
                bot = self._play(spec, lambda: make_bot(budget="none", cache_dir=self.tmp), hands=30)
                self.assertTrue(bot.using_fallback)
        self.assertEqual(buf.getvalue().count("preflop_cfr"), 2)   # one warning per path

    def test_wrong_rules_fall_back(self):
        buf = io.StringIO()
        with redirect_stderr(buf):
            bot = make_bot(policy_path=self.paths[F.name])
            bot.new_match(A, 0)
        self.assertTrue(bot.using_fallback)
        self.assertIn("different rules", buf.getvalue())


if __name__ == "__main__":
    unittest.main()
