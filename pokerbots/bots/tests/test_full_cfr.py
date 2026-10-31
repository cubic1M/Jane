"""Tests for approach #5, full-game abstracted CFR (bots/cfr_full, bots/full_cfr.py).

    python3 -m unittest bots.tests.test_full_cfr      (from pokerbots/)
"""
from __future__ import annotations

import os
import random
import shutil
import tempfile
import unittest

import numpy as np

from engine.equity import get_equity_model
from engine.game import Call, Check, Discard, Fold, HandState, RaiseTo
from engine.match import deal_order, play_match
from engine.spec import DiscardRule, GameSpec
from engine.variants import VARIANTS

from bots.cfr_full.abstraction import AbstractionConfig, BatchEquity, CardAbstraction, canon_keys
from bots.cfr_full.evaluate import exploitability
from bots.cfr_full.policy import load_policy, load_policy_data
from bots.cfr_full.train import CFRTrainer, train
from bots.cfr_full.tree import (A_CALL, A_CHECK, A_FOLD, A_RAISE, DECISION, Tree, TreeConfig,
                                map_raise, pseudo_harmonic)
from bots.full_cfr import FullCFRBot, make_bot
from bots.random_legal import RandomLegalBot

KUHN = GameSpec("kuhn", small_blind=1, big_blind=1, starting_stack=2, board_cards_per_street=(5,))


def kuhn_deals():
    deals = [(a, b) for a in range(3) for b in range(3) if a != b]
    bk = np.array([[[a for a, _ in deals], [b for _, b in deals]]], dtype=np.int16)
    out = np.array([np.sign(a - b) for a, b in deals], dtype=np.int8)
    return bk, out, np.full(6, 1 / 6)


class TestTreeLegality(unittest.TestCase):
    """Walk random abstract lines through the REAL engine and check every abstract
    action is legal and the tree's pot/pips/stacks match the engine's observation."""

    SPECS = [VARIANTS["a_nlhe100"], VARIANTS["f_nlhe20"], VARIANTS["b_nlhe200"],
             VARIANTS["a_nlhe100"].with_(name="pl", betting="pot_limit"),
             VARIANTS["f_nlhe20"].with_(name="pl20", betting="pot_limit"),
             VARIANTS["c_discard3"],
             GameSpec("ante", ante=1, small_blind=1, big_blind=2, starting_stack=60),
             GameSpec("odd", small_blind=2, big_blind=5, starting_stack=137,
                      board_cards_per_street=(0, 3, 2))]

    def _walk(self, spec, seed):
        tree = Tree(spec)
        rnd = random.Random(seed)
        state = {"node": 0}
        checks = {"n": 0}

        def decide(pos, obs):
            lg = obs.legal
            if obs.phase == "discard":
                return Discard(rnd.sample(list(obs.my_cards), lg.discard_count))
            n = state["node"]
            self.assertEqual(tree.kind[n], DECISION)
            self.assertEqual(tree.player[n], pos)
            self.assertEqual(tree.street[n], obs.street)
            self.assertEqual(tree.pot[n], obs.pot)
            self.assertEqual(tree.pips[n][pos], obs.my_pip)
            self.assertEqual(tree.pips[n][1 - pos], obs.opp_pip)
            self.assertEqual(tree.stacks[n][pos], obs.my_stack)
            self.assertEqual(tree.facing[n], lg.call_amount > 0)
            acts = tree.actions[n]
            kinds = [a[0] for a in acts]
            self.assertEqual(A_FOLD in kinds, lg.call_amount > 0)
            raises = [a for a in acts if a[0] == A_RAISE]
            if raises:
                self.assertTrue(lg.can_raise)
                self.assertEqual(max(a[1] for a in raises), lg.max_raise_to)  # all-in / pot max
                for a in raises:
                    self.assertTrue(lg.min_raise_to <= a[1] <= lg.max_raise_to)
                self.assertEqual(len(set(a[1] for a in raises)), len(raises))
                cap = tree.cfg.cap(obs.street)
                self.assertLess(tree.depth[n], cap)
            i = rnd.randrange(len(acts))
            k, amt, _ = acts[i]
            a = {A_FOLD: Fold, A_CHECK: Check, A_CALL: Call, A_RAISE: lambda: RaiseTo(amt)}[k]()
            self.assertTrue(lg.is_legal(a), f"{a} illegal under {lg}")
            state["node"] = tree.children[n][i]
            checks["n"] += 1
            return a

        hs = HandState(spec, deal_order(spec, seed, 0))
        deltas = hs.play(decide)
        leaf = state["node"]
        self.assertNotEqual(tree.kind[leaf], DECISION)
        if hs.showdown:
            self.assertEqual(tree.u0[leaf], min(hs.committed))
        else:
            self.assertEqual(tree.u0[leaf], deltas[0])
        return checks["n"]

    def test_random_lines_are_legal(self):
        for spec in self.SPECS:
            for seed in range(60):
                self._walk(spec, seed)

    def test_pot_limit_caps_raises(self):
        spec = VARIANTS["a_nlhe100"].with_(name="pl", betting="pot_limit")
        tree = Tree(spec)
        # SB first action: pot-limit max raise-to = 2 + (3 + 1) = 6
        self.assertEqual(max(a[1] for a in tree.actions[0] if a[0] == A_RAISE), 6)

    def test_short_stack_tree_is_small_and_has_allin(self):
        tree = Tree(VARIANTS["f_nlhe20"])
        self.assertIn((A_RAISE, 40, -1.0), tree.actions[0])
        self.assertLess(tree.n_nodes, Tree(VARIANTS["a_nlhe100"]).n_nodes)


class TestTranslation(unittest.TestCase):
    def test_pseudo_harmonic(self):
        self.assertAlmostEqual(pseudo_harmonic(0.5, 0.5, 1.0), 1.0)
        self.assertAlmostEqual(pseudo_harmonic(1.0, 0.5, 1.0), 0.0)
        p = pseudo_harmonic(0.75, 0.5, 1.0)
        self.assertTrue(0.0 < p < 1.0)

    def test_map_raise(self):
        fr = [(2, 0.5, False), (3, 1.0, False), (4, 5.0, True)]
        self.assertEqual(map_raise(fr, 0.2, False, 0.5), 2)
        self.assertEqual(map_raise(fr, 9.0, False, 0.5), 4)
        self.assertEqual(map_raise(fr, 3.0, True, 0.99), 4)
        self.assertIn(map_raise(fr, 0.7, False, 0.5), (2, 3))
        self.assertIsNone(map_raise([], 1.0, False, 0.5))


class TestRegretMatching(unittest.TestCase):
    def test_distribution_is_valid(self):
        tree = Tree(VARIANTS["f_nlhe20"])
        tr = CFRTrainer(tree, [5, 4, 4, 4])
        rng = np.random.default_rng(0)
        tr.R[:] = rng.normal(size=tr.R.shape)
        tr.R[:7] = -1.0  # all-negative rows -> uniform
        for n in tree.decision_nodes[:200]:
            tab = tr.current_table(n)
            na = len(tree.actions[n])
            self.assertEqual(tab.shape[1], na)
            self.assertTrue(np.all(tab >= 0))
            np.testing.assert_allclose(tab.sum(axis=1), 1.0)
        np.testing.assert_allclose(tr.current_table(0)[0], 1.0 / len(tree.actions[0]))
        avg = tr.average_strategy()
        for n in tree.decision_nodes[:50]:
            b = tr.base[n]
            np.testing.assert_allclose(avg[b:b + tr.K[tree.street[n]], :len(tree.actions[n])].sum(axis=1), 1.0)


class TestConvergence(unittest.TestCase):
    """The tree built from a stripped spec (1 street, ante-like blinds 1/1, stack 2) is
    exactly Kuhn poker; with a 3-bucket 'deck' the trainer must find its equilibrium
    (first player's value -1/18) and exploitability must fall."""

    def test_kuhn_tree_shape(self):
        tree = Tree(KUHN)
        self.assertEqual(len(tree.decision_nodes), 4)

    def test_kuhn_exact_batches(self):
        tree = Tree(KUHN)
        bk, out, w = kuhn_deals()
        tr = CFRTrainer(tree, [3])
        ex = []
        for i in range(1, 1001):
            tr.iterate(bk, out, w)
            if i in (10, 100, 1000):
                r = exploitability(tree, [3], tr.average_strategy(), (bk, out, w), (bk, out, w), 1.0)
                ex.append(r["expl_in"] / 1000)
        self.assertGreater(ex[0], ex[1])
        self.assertGreater(ex[1], ex[2])
        self.assertLess(ex[2], 0.01)
        self.assertAlmostEqual(r["value0"] / 1000, -1 / 18, delta=0.003)

    def test_kuhn_sampled_batches(self):
        tree = Tree(KUHN)
        bk, out, w = kuhn_deals()
        tr = CFRTrainer(tree, [3])
        rng = np.random.default_rng(1)
        first = None
        for i in range(1, 1501):
            idx = rng.integers(0, 6, 32)
            tr.iterate(bk[:, :, idx], out[idx])
            if i == 5:
                first = exploitability(tree, [3], tr.average_strategy(), (bk, out, w), (bk, out, w), 1.0)
        last = exploitability(tree, [3], tr.average_strategy(), (bk, out, w), (bk, out, w), 1.0)
        self.assertLess(last["expl_in"], first["expl_in"])
        self.assertLess(last["expl_in"] / 1000, 0.02)

    def test_small_poker_exploitability_falls(self):
        """A short-stack hold'em abstract game: exploitability (evaluated on a fixed deal set)
        must drop as iterations accumulate."""
        spec = VARIANTS["f_nlhe20"].with_(name="tiny", starting_stack=12)
        ab = CardAbstraction(spec, AbstractionConfig(buckets=(5, 4, 4, 4), n_fit=400, table_seconds=0.3,
                                                     n_post=24, n_disc=8))
        rng = np.random.default_rng(0)
        ab.fit(rng, log=None)
        tree = Tree(spec)
        evset = ab.sample(3000, rng)
        tr = CFRTrainer(tree, ab.K)
        ex = []
        for i in range(1, 121):
            bk, o = ab.sample(256, rng) if i % 4 == 1 or i < 4 else (bk, o)
            tr.iterate(bk, o)
            if i in (3, 120):
                ex.append(exploitability(tree, ab.K, tr.average_strategy(), evset, evset, 2)["expl_in"])
        self.assertLess(ex[1], 0.7 * ex[0])


class TestAbstraction(unittest.TestCase):
    def test_canon_keys_suit_isomorphic(self):
        from engine.cards import parse_cards
        a = canon_keys(np.array([parse_cards("AsKs"), parse_cards("AhKh"), parse_cards("AsKh")]))
        self.assertEqual(a[0], a[1])
        self.assertNotEqual(a[0], a[2])
        deck = VARIANTS["a_nlhe100"].deck
        from itertools import combinations
        allk = canon_keys(np.array(list(combinations(deck, 2))))
        self.assertEqual(len(np.unique(allk)), 169)

    def test_batch_equity_matches_engine(self):
        """BatchEquity reimplements EquityModel.equity vectorised; they must agree within MC noise."""
        from engine.cards import parse_cards
        cases = [
            (VARIANTS["a_nlhe100"], "AhKh", "Qh7h2c", (), 2, 2, 0, 0, True),
            (VARIANTS["a_nlhe100"], "7c7d", "", (), 2, 5, 0, 0, True),
            (VARIANTS["c_discard3"], "AhKhQd", "", (), 3, 5, 1, 1, True),
            (VARIANTS["g_pineapple"], "AhKh2c", "", (), 3, 5, 1, 1, False),
            (VARIANTS["g_pineapple"], "AhKh", "Qh7h2c", parse_cards("3c"), 2, 2, 0, 0, True),
            (VARIANTS["d_omaha4x2"], "AhKhQdJd", "Th9c2s", (), 4, 2, 0, 0, True),
            (VARIANTS["e_shortdeck"], "AhKh", "QhJh6c", (), 2, 2, 0, 0, True),
        ]
        rng = np.random.default_rng(3)
        for spec, my, bd, dead, onum, btc, ml, ol, tb in cases:
            m = get_equity_model(spec)
            be = BatchEquity(spec)
            myc, bdc = parse_cards(my), parse_cards(bd) if bd else []
            n = 3000 if spec.hole_usage == "any" else 1200
            e1 = m.equity(myc, bdc, opp_num_cards=onum, board_to_come=btc, my_discards_left=ml,
                          opp_discards_left=ol, discard_to_board=tb, dead=dead, n=n, rng=rng)
            e2 = be.equity(np.array([myc]), np.array([bdc], dtype=np.int64).reshape(1, -1),
                           np.array([list(dead)], dtype=np.int64).reshape(1, -1), opp_num=onum,
                           board_to_come=btc, my_left=ml, opp_left=ol, to_board=tb, n=n, rng=rng)[0]
            self.assertLess(abs(e1 - e2), 4 * 0.5 / np.sqrt(n), f"{spec.name} {my} {bd}: {e1} vs {e2}")

    def test_fit_and_sample_all_variants(self):
        rng = np.random.default_rng(0)
        for spec in VARIANTS.values():
            ab = CardAbstraction(spec, AbstractionConfig(n_fit=200, table_seconds=0.2, n_post=16, n_disc=8))
            ab.fit(rng, log=None)
            bk, out = ab.sample(64, rng)
            self.assertEqual(bk.shape, (spec.num_streets, 2, 64))
            for s in range(spec.num_streets):
                self.assertTrue(np.all(np.diff(ab.bounds[s]) > 0))
                self.assertTrue(bk[s].min() >= 0 and bk[s].max() < ab.K[s])
            self.assertTrue(set(np.unique(out)) <= {-1, 0, 1})


class TestPolicyAndBot(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.mkdtemp(prefix="full_cfr_test_")
        cfg = AbstractionConfig(n_fit=300, table_seconds=0.3, n_post=16, n_disc=8)
        cls.paths = {}
        for v in ("f_nlhe20", "c_discard3"):
            written, tr, ab, tree = train(VARIANTS[v], minutes=0.04, checkpoints=(), seed=0, out_dir=cls.tmp,
                                          abs_cfg=cfg, batch=128, log=lambda s: None)
            cls.paths[v] = (written[0], tr, ab, tree)

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.tmp, ignore_errors=True)

    def test_save_load_roundtrip(self):
        path, tr, ab, tree = self.paths["f_nlhe20"]
        self.assertTrue(os.path.basename(path).startswith("full_f_nlhe20_"))
        pol = load_policy(path, VARIANTS["f_nlhe20"])
        np.testing.assert_allclose(pol.strategy, tr.average_strategy().astype(np.float32))
        self.assertEqual(pol.abs.K, ab.K)
        for s in range(len(ab.bounds)):
            np.testing.assert_array_equal(pol.abs.bounds[s], ab.bounds[s])
        np.testing.assert_array_equal(pol.abs.table_vals, ab.table_vals)
        self.assertEqual(pol.tree.n_nodes, tree.n_nodes)
        for n in pol.tree.decision_nodes[:100]:
            p = pol.probs(n, 0)
            self.assertAlmostEqual(float(p.sum()), 1.0, places=5)
        self.assertGreater(load_policy_data(path)["meta"]["iterations"], 0)
        with self.assertRaises(ValueError):
            load_policy(path, VARIANTS["a_nlhe100"])

    def _check_play(self, bot_factory, spec, hands=40):
        for seat in (0, 1):
            bot = bot_factory()
            pair = (bot, RandomLegalBot()) if seat == 0 else (RandomLegalBot(), bot)
            r = play_match(pair[0], pair[1], spec, deal_seed=5 + seat, hands=hands)
            st = r.stats[seat].summary()
            self.assertEqual(st["illegal"], 0, st["first_error"])
            self.assertEqual(st["errors"], 0, st["first_error"])
        return bot

    def test_bot_with_policy_is_legal(self):
        for v in ("f_nlhe20", "c_discard3"):
            path = self.paths[v][0]
            bot = self._check_play(lambda: make_bot(policy_path=path), VARIANTS[v])
            self.assertFalse(bot.using_fallback)
            self.assertGreater(bot.stats["decisions"], 0)
        # self-play, both seats driven by the policy (exercises tracking both ways)
        path = self.paths["f_nlhe20"][0]
        r = play_match(make_bot(policy_path=path), make_bot(policy_path=path), VARIANTS["f_nlhe20"],
                       deal_seed=9, hands=40)
        for s in (0, 1):
            self.assertEqual(r.stats[s].illegal + r.stats[s].errors, 0)

    def test_bot_budget_lookup_uses_cache_dir(self):
        path = self.paths["f_nlhe20"][0]
        budget = os.path.basename(path)[len("full_f_nlhe20_"):-len(".pkl")]
        bot = make_bot(budget=budget, cache_dir=self.tmp)
        bot.new_match(VARIANTS["f_nlhe20"], 0)
        self.assertFalse(bot.using_fallback)

    def test_bot_without_policy_falls_back(self):
        for v in ("a_nlhe100", "c_discard3", "d_omaha4x2", "g_pineapple"):
            bot = self._check_play(lambda: make_bot(budget="no_such_budget", verbose=False), VARIANTS[v],
                                   hands=16)
            self.assertTrue(bot.using_fallback)
        self.assertIsInstance(make_bot(), FullCFRBot)


class TestFastEval(unittest.TestCase):
    """fasteval.FastEvaluator must return exactly the engine evaluator's scores."""

    def test_matches_engine_all_variants(self):
        from bots.cfr_full.fasteval import FastEvaluator
        from engine.evaluator import get_evaluator
        from engine.variants import ALL_VARIANTS
        rng = np.random.default_rng(4)
        for spec in ALL_VARIANTS.values():
            ev, fe = get_evaluator(spec), FastEvaluator(spec)
            deck = np.array(spec.deck)
            suited = deck[deck % 4 == 1]
            if spec.hole_usage == "any":
                shapes = [(h, b) for h in range(0, 5) for b in range(0, 8) if 5 <= h + b <= 9]
            else:
                shapes = [(h, b) for h in range(spec.hole_exact, 6) for b in range(5 - spec.hole_exact, 8)]
            for h, b in shapes:
                c = deck[np.argsort(rng.random((3000, len(deck))), axis=1)[:, :h + b]]
                if h + b <= len(suited):  # plenty of flushes / straight flushes too
                    c2 = np.array([rng.choice(suited, h + b, replace=False) for _ in range(200)])
                    c = np.concatenate([c, c2])
                np.testing.assert_array_equal(fe.evaluate_batch(c[:, :h], c[:, h:]),
                                              ev.evaluate_batch(c[:, :h], c[:, h:]), f"{spec.name} {h}+{b}")

    def test_simulate_unchanged(self):
        """Deals, features and outcomes are bit-identical with the engine evaluator."""
        for v in ("a_nlhe100", "c_discard3", "d_omaha4x2", "g_pineapple"):
            spec = VARIANTS[v]
            ab = CardAbstraction(spec, AbstractionConfig(n_fit=100, table_seconds=0.1, n_post=12, n_disc=6))
            ab.fit(np.random.default_rng(0), log=None)
            f1, o1 = ab.simulate(64, np.random.default_rng(5))
            ab.be = BatchEquity(spec, fast=False)
            f2, o2 = ab.simulate(64, np.random.default_rng(5))
            np.testing.assert_array_equal(f1, f2)
            np.testing.assert_array_equal(o1, o2)


def _small_setup(seed=0, spec=None):
    spec = spec or VARIANTS["f_nlhe20"]
    ab = CardAbstraction(spec, AbstractionConfig(buckets=(6, 5, 5, 5), n_fit=300, table_seconds=1e4,
                                                 n_post=16, n_disc=8))
    rng = np.random.default_rng(seed)
    ab.fit(rng, log=None)
    return spec, ab, Tree(spec), rng


class TestParallel(unittest.TestCase):
    """--workers N: the split (top + frontier subtrees) iteration must be exactly the
    single-process iteration on the same batch; runs must be deterministic per seed."""

    def test_collect_finish_equals_iterate(self):
        spec, ab, tree, rng = _small_setup()
        batches = [ab.sample(256, rng) for _ in range(4)]
        a, b = CFRTrainer(tree, ab.K), CFRTrainer(tree, ab.K)
        for split in (1, 2, 3):
            front = b.frontier(split)
            self.assertTrue(front)
            for bk, o in batches:
                va = a.iterate(bk, o)
                b.begin(bk, o)
                tasks = b.collect(front)
                vals = {n: b._walk(n, *tasks[n]) for n in reversed(list(tasks))}  # any order
                vb = b.finish(vals)
                self.assertAlmostEqual(va, vb, places=12)
            np.testing.assert_array_equal(a.R, b.R)
            np.testing.assert_array_equal(a.S, b.S)
            np.testing.assert_array_equal(a.visits, b.visits)

    def test_parallel_cfr_matches_single_process(self):
        from bots.cfr_full.parallel import ParallelCFR
        spec, ab, tree, rng = _small_setup()
        batches = [ab.sample(256, rng) for _ in range(4)]
        a = CFRTrainer(tree, ab.K)
        with ParallelCFR(spec, tree, ab, ab.K, workers=3, seed=0) as par:
            for bk, o in batches:
                va = a.iterate(bk, o)
                vb, fresh = par.iterate(bk, o, n_sample=50)
                self.assertAlmostEqual(va, vb, places=12)
                self.assertEqual(fresh[0].shape, (spec.num_streets, 2, 50))
                self.assertTrue(fresh[0].max() < max(ab.K))
            np.testing.assert_array_equal(a.R, par.tr.R)
            np.testing.assert_array_equal(a.S, par.tr.S)
            np.testing.assert_array_equal(a.visits, par.tr.visits)
            self.assertEqual(par.tr.t, 4)

    def test_train_deterministic_and_loadable(self):
        tmp = tempfile.mkdtemp(prefix="full_cfr_par_")
        try:
            cfg = AbstractionConfig(buckets=(6, 5, 5, 5), n_fit=300, table_seconds=1e4, n_post=16, n_disc=8)
            spec = VARIANTS["f_nlhe20"]
            strat = {}
            for w in (1, 1, 2, 2):
                written, tr, ab, tree = train(spec, minutes=5, seed=3, out_dir=tmp, abs_cfg=cfg, batch=128,
                                              workers=w, suffix=f"w{w}", max_iters=5, log=lambda s: None)
                self.assertEqual(tr.t, 5)
                self.assertTrue(written[0].endswith(f"full_f_nlhe20_5m_w{w}.pkl"))
                data = load_policy_data(written[0])
                self.assertEqual(data["meta"]["workers"], w)
                if w in strat:  # same seed, same worker count -> same policy
                    np.testing.assert_array_equal(strat[w], data["strategy"])
                strat[w] = data["strategy"]
            bot = make_bot(budget="5m_w2", cache_dir=tmp)
            r = play_match(bot, RandomLegalBot(), spec, deal_seed=2, hands=30)
            self.assertFalse(bot.using_fallback)
            self.assertEqual(r.stats[0].illegal + r.stats[0].errors, 0)
        finally:
            shutil.rmtree(tmp, ignore_errors=True)


class TestRicherAbstraction(unittest.TestCase):
    def test_ehs2_feature(self):
        from engine.cards import parse_cards
        be = BatchEquity(VARIANTS["a_nlhe100"])
        rng = np.random.default_rng(0)
        z = np.zeros((1, 0), np.int64)
        res = {}
        for h, b in (("AhKh", "Qh7h2c"), ("7c7d", "Kh8s2c")):
            my, bd = np.array([parse_cards(h)]), np.array([parse_cards(b)])
            e = be.equity(my, bd, z, opp_num=2, board_to_come=2, n=6000, rng=rng)[0]
            e2 = be.ehs2(my, bd, z, opp_num=2, board_to_come=2, n=6000, rng=rng)[0]
            self.assertTrue(0 <= e2 <= 1)
            self.assertGreater(e2, e * e - 0.03)  # Jensen: E[HS^2] >= E[HS]^2
            res[h] = (e, e2)
        # the flush draw has more potential than the made pair: much larger E[HS^2] - EHS^2
        self.assertGreater(res["AhKh"][1] - res["AhKh"][0] ** 2, res["7c7d"][1] - res["7c7d"][0] ** 2 + 0.02)

    def test_cli_flags_and_policy(self):
        from bots.cfr_full.train import main
        tmp = tempfile.mkdtemp(prefix="full_cfr_cli_")
        try:
            main(["--variant", "f_nlhe20", "--minutes", "3", "--max-iters", "3", "--workers", "2",
                  "--suffix", "rich", "--buckets", "7,6,6,6", "--feature", "ehs2",
                  "--postflop-sizes", "0.33,0.75;1.0", "--out", tmp, "--batch", "128", "--log-every", "1000"])
            path = os.path.join(tmp, "full_f_nlhe20_3m_rich.pkl")
            pol = load_policy(path, VARIANTS["f_nlhe20"])
            self.assertEqual(pol.abs.cfg.feature, "ehs2")
            self.assertEqual(pol.abs.cfg.buckets, (7, 6, 6, 6))
            self.assertEqual(pol.tree.cfg.postflop, ((0.33, 0.75), (1.0,)))
            fr = {round(a[2], 2) for n in pol.tree.decision_nodes if pol.tree.street[n] > 0
                  for a in pol.tree.actions[n] if a[0] == A_RAISE}
            self.assertIn(0.33, fr)
            bot = self._play(path)
            self.assertGreater(bot.stats["decisions"], 0)
        finally:
            shutil.rmtree(tmp, ignore_errors=True)

    def _play(self, path):
        bot = make_bot(policy_path=path)
        r = play_match(bot, RandomLegalBot(), VARIANTS["f_nlhe20"], deal_seed=4, hands=30)
        self.assertFalse(bot.using_fallback)
        self.assertEqual(r.stats[0].illegal + r.stats[0].errors, 0)
        return bot

    def test_old_policy_files_still_load(self):
        path = os.path.join(os.path.dirname(__file__), "..", "..", "cache", "cfr", "full_a_nlhe100_15m.pkl")
        if not os.path.exists(path):
            self.skipTest("no saved policy")
        pol = load_policy(path, VARIANTS["a_nlhe100"])
        self.assertEqual(pol.abs.cfg.feature, "ehs")   # files without the field = the original feature
        self.assertEqual(pol.abs.K, [16, 10, 10, 10])


class TestDecisionLatency(unittest.TestCase):
    """Lazy evaluator tables (fasteval) must be built in new_match, not inside the first
    timed decision: after new_match no decision may take more than 100 ms."""

    def test_no_slow_first_decision(self):
        from bots.cfr_full import fasteval
        from bots import full_cfr
        from engine.variants import ALL_VARIANTS
        tmp = tempfile.mkdtemp(prefix="full_cfr_lat_")
        try:
            cfg = AbstractionConfig(n_fit=200, table_seconds=0.3, n_post=16, n_disc=8)
            for v in ("a_nlhe100", "k_irish"):
                spec = ALL_VARIANTS[v]
                written, *_ = train(spec, minutes=0.03, seed=0, out_dir=tmp, abs_cfg=cfg, batch=64,
                                    log=lambda s: None)
                fasteval._CACHE.clear()          # as in a fresh process
                full_cfr._POLICY_CACHE.clear()
                for seat in (0, 1):
                    bot = make_bot(policy_path=written[0])
                    bot.new_match(spec, 0)
                    built = len(fasteval._CACHE)
                    pair = (bot, RandomLegalBot()) if seat == 0 else (RandomLegalBot(), bot)
                    r = play_match(pair[0], pair[1], spec, deal_seed=11 + seat, hands=100)
                    st = r.stats[seat].summary()
                    self.assertFalse(bot.using_fallback)
                    # nothing lazily built during play (the robust check: timing is noisy)
                    self.assertEqual(len(fasteval._CACHE), built, f"{v}: tables built during play")
                    self.assertEqual(st["illegal"] + st["errors"], 0, st["first_error"])
                    self.assertLess(st["max_ms"], 100.0, f"{v} seat {seat}: {st}")
        finally:
            shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    unittest.main()
