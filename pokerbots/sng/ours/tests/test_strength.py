"""Tests for the fast hand-strength layer (sng.ours.strength / features / build_tables).

    python3 -m unittest discover -s sng/ours/tests -t .

Table-based tests use the prebuilt cache/sng/strength_<variant>.npz files (built with
python3 -m sng.ours.build_tables --variant <name> --minutes 5 --workers 4) and are
skipped if a file is missing. The changed-category-order spec gets a small table built
inside the test (a few seconds).
"""
import gc
import random
import tempfile
import time
import os
import unittest
from pathlib import Path

import numpy as np

from engine.cards import parse_cards
from engine.evaluator import get_evaluator
from engine.spec import STANDARD_ORDER, DiscardRule
from engine.variants import get_variant
from sng.ours import build_tables as BT
from sng.ours import features as F
from sng.ours import strength as S

NLHE = get_variant("a_nlhe100")
SHORT = get_variant("e_shortdeck")
OMAHA = get_variant("d_omaha4x2")
_o = list(STANDARD_ORDER)
_i, _j = _o.index("flush"), _o.index("full_house")
_o[_i], _o[_j] = _o[_j], _o[_i]
FLUSH_OVER_FH = NLHE.with_(name="t_flush_over_fh", category_order=tuple(_o))
P99_LIMIT = 50e-6


def c(s):
    return parse_cards(s)


def table_file(spec):
    return S.CACHE_DIR / f"strength_{spec.name}.npz"


def needs_table(spec):
    return unittest.skipUnless(table_file(spec).exists(), f"no table for {spec.name}")


def p99_of_calls(fn, cases, repeats=2):
    """Best p99 (seconds) over `repeats` passes; the min guards against a busy machine."""
    best = None
    for _ in range(repeats):
        gc.collect()
        pc = time.perf_counter
        ts = []
        for args in cases:
            t0 = pc()
            fn(*args)
            ts.append(pc() - t0)
        ts.sort()
        p = ts[int(0.99 * len(ts))]
        best = p if best is None else min(best, p)
    return best


def random_cases(spec, nb, n, seed=0):
    rng = random.Random(seed)
    out = []
    for _ in range(n):
        d = rng.sample(spec.deck, spec.hole_cards + nb)
        out.append((d[:spec.hole_cards], d[spec.hole_cards:], rng.randint(1, 7), spec))
    return out


# ---- features: pure-Python evaluator and keys ---------------------------------------------
class TestFeatures(unittest.TestCase):
    def test_evaluator_matches_engine(self):
        """The pure-Python evaluator gives the engine's exact scores on every street size."""
        rng = random.Random(1)
        for spec in (NLHE, SHORT, OMAHA, FLUSH_OVER_FH, get_variant("j_3street"),
                     get_variant("h_plo5")):
            ctx, ev = F.get_ctx(spec), get_evaluator(spec)
            H, B, mine = [], [], []
            for _ in range(600):
                d = rng.sample(spec.deck, spec.hole_cards + 5)
                H.append(d[:spec.hole_cards])
                B.append(d[spec.hole_cards:])
                mine.append(F.evaluate(ctx, H[-1], B[-1])[0])
            ref = ev.evaluate_batch(np.array(H), np.array(B))
            self.assertEqual(mine, ref.tolist(), spec.name)

    def test_category_order_respected(self):
        """A flush vs a full house on the same board: the order decides (both evaluators)."""
        board = c("Kh Th 6h Ks 9c")
        fl, fh = c("Ah 8h"), c("Kd 9d")
        for spec, flush_wins in ((NLHE, False), (FLUSH_OVER_FH, True), (SHORT, True)):
            ctx, ev = F.get_ctx(spec), get_evaluator(spec)
            s_fl, s_fh = F.evaluate(ctx, fl, board)[0], F.evaluate(ctx, fh, board)[0]
            self.assertEqual(ctx.order[(s_fl >> 20) - 1], "flush")
            self.assertEqual(ctx.order[(s_fh >> 20) - 1], "full_house")
            self.assertEqual(s_fl > s_fh, flush_wins, spec.name)
            self.assertEqual((s_fl, s_fh), (ev.evaluate(fl, board), ev.evaluate(fh, board)))

    def test_short_deck_wheel(self):
        ctx = F.get_ctx(SHORT)                              # A-6-7-8-9 is a straight
        sc, _ = F.evaluate(ctx, c("As 6d"), c("7c 8h 9s Kd Kc"))
        self.assertIn(ctx.order[(sc >> 20) - 1], ("straight",))
        self.assertEqual(sc, get_evaluator(SHORT).evaluate(c("As 6d"), c("7c 8h 9s Kd Kc")))

    def test_preflop_classes(self):
        deck = NLHE.deck
        keys = {F.pre_key([a, b]) for i, a in enumerate(deck) for b in deck[i + 1:]}
        self.assertEqual(len(keys), 169)
        rng = random.Random(3)
        for _ in range(200):                                # suit relabelling invariance
            h = rng.sample(deck, 4)
            perm = rng.sample(range(4), 4)
            h2 = [(x & ~3) | perm[x & 3] for x in h]
            self.assertEqual(F.pre_key(h), F.pre_key(h2))
            self.assertEqual(F.pre_keys(F.get_ctx(OMAHA), h), F.pre_keys(F.get_ctx(OMAHA), h2))

    def test_levels_nest(self):
        """Each level key is its parent's refinement (parent_key of level i = level i+1)."""
        rng = random.Random(4)
        for spec in (NLHE, OMAHA):
            ctx = F.get_ctx(spec)
            for _ in range(200):
                nb = rng.choice((3, 4, 5))
                d = rng.sample(spec.deck, spec.hole_cards + nb)
                ks = F.post_keys(ctx, d[:spec.hole_cards], d[spec.hole_cards:])
                self.assertEqual(len(ks), F.NLEVELS)
                for a, b in zip(ks, ks[1:]):
                    self.assertEqual(F.parent_key(a), b)
                self.assertEqual(F.parent_key(ks[-1]), -1)

    def test_draw_features(self):
        ctx = F.get_ctx(NLHE)
        f = F.post_features(ctx, c("Ah 5h"), c("Kh 9h 2c"))      # nut flush draw
        self.assertEqual(f[5], 2)
        f = F.post_features(ctx, c("8h 7d"), c("9c 6s 2d"))      # open-ended: 5 or T
        self.assertEqual(f[6], 2)
        f = F.post_features(ctx, c("8h 7d"), c("9c 5s 2d"))      # gutshot: 6
        self.assertEqual(f[6], 1)
        f = F.post_features(ctx, c("Ah Kd"), c("Ac 7s 2d"))      # top pair, top kicker
        self.assertEqual((f[1], f[2], f[3]), (3, 0, 0))

    def test_hand_class(self):
        self.assertEqual(S.hand_class(c("As Kd"), NLHE), "AKo")
        self.assertEqual(S.hand_class(c("Kd As"), NLHE), "AKo")
        self.assertEqual(S.hand_class(c("As Ks"), NLHE), "AKs")
        self.assertEqual(S.hand_class(c("Qs Qd"), NLHE), "QQ")
        self.assertEqual(S.hand_class(c("As Ks Qd Jd"), OMAHA),
                         S.hand_class(c("Ah Kh Qc Jc"), OMAHA))


# ---- runtime API ---------------------------------------------------------------------------
class TableChecks:
    """Shared sanity checks on a loaded table for `spec`."""
    spec = None

    def check_sanity(self, spec, aa="As Ah", kk="Ks Kh", junk="7c 2d"):
        K = 7
        for k in range(1, K + 1):
            ea, ek, ej = (S.preflop_equity(c(x), k, spec) for x in (aa, kk, junk))
            self.assertGreater(ea, ek, f"{spec.name} k={k}")
            self.assertGreater(ek, ej, f"{spec.name} k={k}")
        rng = random.Random(5)
        for _ in range(100):                                # equity decreases with k
            nb = rng.choice((0, 3, 4, 5))
            d = rng.sample(spec.deck, spec.hole_cards + nb)
            es = [S.equity(d[:spec.hole_cards], d[spec.hole_cards:], k, spec) for k in range(1, 8)]
            for a, b in zip(es, es[1:]):
                self.assertGreaterEqual(a + 1e-9, b, f"{spec.name} {d} {es}")
            for e in es:
                self.assertTrue(0.0 <= e <= 1.0)

    def check_nuts(self, spec, hole, board, lo=0.97):
        for k in range(1, 8):
            self.assertGreater(S.postflop_equity(c(hole), c(board), k, spec), lo,
                               f"{spec.name} {hole} {board} k={k}")


class TestNlheTable(unittest.TestCase, TableChecks):
    @needs_table(NLHE)
    def test_sanity(self):
        self.assertTrue(S.preload(NLHE))
        self.check_sanity(NLHE)
        self.check_nuts(NLHE, "As Ks", "Qs Js Ts 2d 3c")    # royal flush
        self.check_nuts(NLHE, "7c 7d", "7h 7s 2c 9d Kd")    # quads, no straight flush possible
        # preflop AA vs 1 random hand ~ 0.852 (well-known), 72o ~ 0.35
        self.assertAlmostEqual(S.preflop_equity(c("As Ah"), 1, NLHE), 0.852, delta=0.01)
        self.assertAlmostEqual(S.preflop_equity(c("7c 2d"), 1, NLHE), 0.346, delta=0.015)

    @needs_table(NLHE)
    def test_dispatch_and_edges(self):
        h = c("Jc Td")
        self.assertEqual(S.equity(h, (), 3, NLHE), S.preflop_equity(h, 3, NLHE))
        b = c("9c 8d 2s")
        self.assertEqual(S.equity(h, b, 3, NLHE), S.postflop_equity(h, b, 3, NLHE))
        self.assertEqual(S.equity(h, b, 0, NLHE), 1.0)
        self.assertLessEqual(S.equity(h, b, 9, NLHE), S.equity(h, b, 7, NLHE))
        self.assertTrue(S.has_table(NLHE))

    @needs_table(NLHE)
    def test_sng_spec_uses_same_table(self):
        """Specs with the same card rules (stacks, blinds, name differ) share the table."""
        from sng.rules import NLHE as SNG_NLHE
        self.assertTrue(S.has_table(SNG_NLHE))
        h, b = c("Ah Qd"), c("Qs 7h 2c")
        self.assertEqual(S.equity(h, b, 4, SNG_NLHE), S.equity(h, b, 4, NLHE))

    @needs_table(NLHE)
    def test_timing(self):
        S.preload(NLHE)
        for nb in (0, 3, 4, 5):
            p = p99_of_calls(S.equity, random_cases(NLHE, nb, 4000, seed=nb))
            self.assertLess(p, P99_LIMIT, f"nlhe board {nb}: p99 {p * 1e6:.1f} us")

    @needs_table(NLHE)
    def test_accuracy_vs_fresh_mc(self):
        check_accuracy(self, NLHE, per_street=40, n_mc=2000)


class TestShortDeckTable(unittest.TestCase, TableChecks):
    @needs_table(SHORT)
    def test_sanity(self):
        self.assertTrue(S.has_table(SHORT))
        self.check_sanity(SHORT, junk="7c 6d")
        self.check_nuts(SHORT, "As Ks", "Qs Js Ts 6d 7c")
        # short deck: a flush beats a full house (nut flush ~ near the top on a paired board
        # that allows full houses, the full house is not)
        e_fl = S.postflop_equity(c("Ah 8h"), c("Kh Th 6h Ks 9c"), 1, SHORT)
        e_fh = S.postflop_equity(c("Kd 9d"), c("Kc Ts 6s Ks 9c"), 1, SHORT)
        self.assertGreater(e_fl, 0.9)
        self.assertGreater(e_fl, e_fh - 0.05)

    @needs_table(SHORT)
    def test_timing(self):
        S.preload(SHORT)
        for nb in (0, 3, 5):
            p = p99_of_calls(S.equity, random_cases(SHORT, nb, 3000, seed=nb))
            self.assertLess(p, P99_LIMIT, f"short deck board {nb}: p99 {p * 1e6:.1f} us")

    @needs_table(SHORT)
    def test_accuracy_vs_fresh_mc(self):
        check_accuracy(self, SHORT, per_street=25, n_mc=2000)


class TestOmahaTable(unittest.TestCase, TableChecks):
    @needs_table(OMAHA)
    def test_sanity(self):
        self.assertTrue(S.has_table(OMAHA))
        for k in range(1, 8):
            ea = S.preflop_equity(c("As Ah Ks Kh"), k, OMAHA)
            ej = S.preflop_equity(c("7c 2d 8h 3s"), k, OMAHA)
            self.assertGreater(ea, ej)
        self.check_sanity(OMAHA, aa="As Ah Ks Kh", kk="Qs Qh Js Jh", junk="7c 2d 8h 3s")
        self.check_nuts(OMAHA, "As Ks 2c 3d", "Qs Js Ts 4d 8c")   # royal flush (exactly 2)

    def test_omaha_needs_exactly_two(self):
        """Four spades on board + one spade in hand is NOT a flush in Omaha."""
        ctx = F.get_ctx(OMAHA)
        sc, _ = F.evaluate(ctx, c("As Kd 2c 3d"), c("Qs Js 9s 4s 8c"))
        self.assertNotEqual(ctx.order[(sc >> 20) - 1], "flush")

    @needs_table(OMAHA)
    def test_timing(self):
        S.preload(OMAHA)
        for nb in (0, 3, 4, 5):
            p = p99_of_calls(S.equity, random_cases(OMAHA, nb, 3000, seed=nb))
            self.assertLess(p, P99_LIMIT, f"omaha board {nb}: p99 {p * 1e6:.1f} us")

    @needs_table(OMAHA)
    def test_accuracy_vs_fresh_mc(self):
        check_accuracy(self, OMAHA, per_street=12, n_mc=600)


def check_accuracy(tc, spec, per_street, n_mc, ks=(1, 3, 7)):
    """Fresh MC on random situations vs the table: MAE within the build's reported band
    (x1.5 for the small test sample, + an allowance for this test's own MC noise)."""
    meta = S.table_meta(spec)
    tc.assertIsNotNone(meta)
    rep = meta["validation"]
    ev = get_evaluator(spec)
    deck = np.array(spec.deck, np.int64)
    K = meta["k_max"]
    rng = np.random.default_rng(12345)
    for nb in [0] + BT._streets(spec):
        errs = {k: [] for k in ks}
        ses = {k: [] for k in ks}
        for _ in range(per_street):
            d = rng.permutation(deck)[:spec.hole_cards + nb].tolist()
            hole, board = d[:spec.hole_cards], d[spec.hole_cards:]
            eq, se = BT.mc_truth(ev, deck, hole, board, K, spec.total_board_dealt, n_mc, rng)
            for k in ks:
                errs[k].append(abs(S.equity(hole, board, k, spec) - eq[k - 1]))
                ses[k].append(se[k - 1])
        for k in ks:
            reported = rep[str(nb)]["mae"][k - 1]
            mae = float(np.mean(errs[k]))
            band = 1.5 * reported + 0.8 * float(np.mean(ses[k])) + 0.005
            tc.assertLess(mae, band, f"{spec.name} board {nb} k={k}: mae {mae:.4f} "
                                     f"vs reported {reported:.4f}")


class TestChangedOrderBuild(unittest.TestCase, TableChecks):
    """A spec with flush above full house: build a small table from the spec object."""

    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.meta = BT.build(FLUSH_OVER_FH, cls.tmp.name, budget_s=180, workers=2, verbose=False,
                            max_deals=120_000)   # fixed sample size: the same table on a loaded machine
        S.use_table(FLUSH_OVER_FH, S.load_file(BT.table_path(FLUSH_OVER_FH, cls.tmp.name),
                                               FLUSH_OVER_FH))

    @classmethod
    def tearDownClass(cls):
        S.forget(FLUSH_OVER_FH)
        cls.tmp.cleanup()

    def test_file_and_meta(self):
        p = BT.table_path(FLUSH_OVER_FH, self.tmp.name)
        self.assertTrue(p.exists())
        self.assertEqual(p.name, "strength_t_flush_over_fh.npz")
        for key in ("spec", "signature", "deals", "build_seconds", "validation", "k_max"):
            self.assertIn(key, self.meta)
        self.assertEqual(self.meta["k_max"], 7)
        self.assertGreater(self.meta["deals"], 1000)
        if not os.environ.get("SNG_SKIP_TIMING"):
            self.assertLess(self.meta["build_seconds"], 120)
        # a table for one card rule set is refused for another
        with self.assertRaises(ValueError):
            S.load_file(p, NLHE)

    def test_sanity(self):
        self.assertTrue(S.has_table(FLUSH_OVER_FH))
        self.check_sanity(FLUSH_OVER_FH)
        self.check_nuts(FLUSH_OVER_FH, "As Ks", "Qs Js Ts 2d 3c", lo=0.95)

    def test_flush_beats_full_house(self):
        """Under this order a made flush on a paired board is worth more than the boat."""
        board = c("Kh Th 6h Ks 9c")
        e_fl = S.postflop_equity(c("Ah 8h"), board, 1, FLUSH_OVER_FH)
        e_fh = S.postflop_equity(c("Kd 9d"), board, 1, FLUSH_OVER_FH)
        self.assertGreater(e_fl, e_fh)


# ---- fallback --------------------------------------------------------------------------------
class TestFallback(unittest.TestCase):
    def setUp(self):
        # a deck nobody built a table for
        self.spec = NLHE.with_(name="t_no_table", deck_ranks=tuple(range(3, 13)))
        S.forget(self.spec)

    def test_no_table_heuristic(self):
        spec = self.spec
        self.assertFalse(S.has_table(spec))
        self.assertIsNone(S.table_meta(spec))
        for k in range(1, 8):
            self.assertGreater(S.preflop_equity(c("As Ah"), k, spec),
                               S.preflop_equity(c("7c 5d"), k, spec))
        rng = random.Random(9)
        for _ in range(300):
            nb = rng.choice((0, 3, 4, 5))
            d = rng.sample(spec.deck, 2 + nb)
            es = [S.equity(d[:2], d[2:], k, spec) for k in range(1, 8)]
            for e in es:
                self.assertTrue(0.0 <= e <= 1.0)
            for a, b in zip(es, es[1:]):
                self.assertGreaterEqual(a + 1e-9, b)
        for nb in (0, 3, 5):
            p = p99_of_calls(S.equity, random_cases(spec, nb, 2000, seed=nb))
            self.assertLess(p, P99_LIMIT, f"fallback board {nb}: p99 {p * 1e6:.1f} us")

    def test_never_crashes(self):
        spec = get_variant("c_discard3")                     # discard game: no table support
        self.assertFalse(S.has_table(spec))
        for hole, board in ((c("As Kd Qh"), ()), (c("As Kd"), c("2c 3c 4c 5d")),
                            (c("As"), c("2c 3c")), ((), ())):
            e = S.equity(hole, board, 3, spec)
            self.assertTrue(0.0 <= e <= 1.0)
        with self.assertRaises(ValueError):
            BT.build(spec, tempfile.gettempdir(), budget_s=1, workers=1, verbose=False)

    def test_bad_inputs_do_not_raise(self):
        self.assertTrue(0.0 <= S.equity([999, -5], [1, 2, 3], 2, NLHE) <= 1.0)
        self.assertTrue(0.0 <= S.equity(c("As Kd"), c("2c 3c 4c"), 7, OMAHA) <= 1.0)


if __name__ == "__main__":
    unittest.main()
