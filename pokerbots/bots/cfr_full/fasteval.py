"""Faster, bit-identical replacement for engine Evaluator.evaluate_batch (training only).

The engine evaluator is generic numpy (rank histograms, ~0.7 us per 7-card hand; Omaha
evaluates 60 five-card combos through a sort, ~10-20 us per hand). Card bucketing spends
90%+ of its time there. This module returns exactly the same int64 scores, faster:

* hole_usage "any" (best 5 of n cards): the non-flush part of a score depends only on the
  multiset of ranks, so it is a table lookup keyed by sum(5**rank) (sorted codes +
  searchsorted). The flush part is engine's own flush table on the suit's rank mask, only
  for the few rows where some suit has 5+ cards. score = max(non-flush, flush), which is
  what Evaluator.eval_any computes. ~5x faster.
* hole_usage "exactly" (k hole + 5-k board, Omaha): every (hole subset, board subset)
  combo is a lookup in a 2-D table [hole-rank-multiset, board-rank-multiset], replaced by
  engine's flush table where both subsets are suited in the same suit (as Evaluator.eval5
  does). ~5-10x faster.

Tables are built from the engine's own evaluator (eval_any on representative non-flush
hands), so category orders, short decks and ace-low rules come out the same. Shapes the
fast path does not cover fall back to the engine. Unit tests compare against the engine on
random hands of every variant.
"""
from __future__ import annotations

from itertools import combinations

import numpy as np

from engine.evaluator import get_evaluator
from engine.spec import GameSpec

_P5 = (5 ** np.arange(13, dtype=np.int64)).astype(np.int64)
# per card: rank code in the low 32 bits (5**12 * 12 < 2**32), a 4-bit suit counter above
_CARD = np.array([int(_P5[c >> 2]) | (1 << (32 + 4 * (c & 3))) for c in range(52)], dtype=np.int64)
_LO = (1 << 32) - 1


_CACHE: dict = {}


def _rules_key(spec: GameSpec):
    return (tuple(sorted(spec.deck_ranks)), tuple(spec.category_order), bool(spec.ace_low_straight))


def _multisets(ranks, n: int) -> np.ndarray:
    """All rank-count vectors (M, 13) over `ranks` with total n and every count <= 4."""
    cnt = np.zeros((1, 13), dtype=np.int64)
    tot = np.zeros(1, dtype=np.int64)
    for r in ranks:
        c = np.arange(5)
        new_tot = (tot[:, None] + c[None, :]).ravel()
        keep = new_tot <= n
        rep = np.repeat(cnt, 5, axis=0)
        rep[:, r] = np.tile(c, len(cnt))
        cnt, tot = rep[keep], new_tot[keep]
    return cnt[tot == n]


def _rep_cards(counts: np.ndarray) -> np.ndarray:
    """Representative cards (M, n) for rank-count vectors, ranks ascending and card j in
    suit j % 4: equal ranks are adjacent (<= 4 of them) so they get distinct suits, and no
    suit gets 5+ cards for n <= 16, so the hand has no flush."""
    n = int(counts[0].sum())
    cs = np.cumsum(counts, axis=1)
    ranks = np.stack([(cs <= j).sum(axis=1) for j in range(n)], axis=1)
    return (ranks << 2) | (np.arange(n) % 4)


def _rank_table(spec: GameSpec, n: int):
    """Sorted codes (sum 5**rank) of all valid n-rank multisets, their non-flush scores
    and count vectors. Vectorised (well under 100 ms for n <= 9) and cached per rule set."""
    key = ("rank", _rules_key(spec), n)
    tab = _CACHE.get(key)
    if tab is None:
        counts = _multisets(sorted(spec.deck_ranks), n)
        codes = counts @ _P5
        scores = get_evaluator(spec).eval_any(_rep_cards(counts)) if n >= 5 else np.zeros(len(codes), np.int64)
        order = np.argsort(codes)
        tab = _CACHE[key] = (codes[order], scores[order], counts[order])
    return tab


def _exact_table(spec: GameSpec, k: int):
    """2-D non-flush score table for exactly k hole + (5-k) board ranks."""
    key = ("exact", _rules_key(spec), k)
    tab = _CACHE.get(key)
    if tab is None:
        hc, _, hcnt = _rank_table(spec, k)
        bc, _, bcnt = _rank_table(spec, 5 - k)
        comb = (hcnt[:, None, :] + bcnt[None, :, :]).reshape(-1, 13)
        ok = comb.max(axis=1) <= 4
        T = np.zeros(len(comb), dtype=np.int64)
        T[ok] = get_evaluator(spec).eval_any(_rep_cards(comb[ok]))
        tab = _CACHE[key] = (hc, bc, T.reshape(len(hc), len(bc)))
    return tab


class FastEvaluator:
    """evaluate_batch(holes (B,h), boards (B,b)) -> (B,) int64, identical to the engine's."""

    def __init__(self, spec: GameSpec):
        self.spec = spec
        self.ev = get_evaluator(spec)
        self.flush = np.asarray(self.ev.t["flush"], dtype=np.int64)
        self.any = spec.hole_usage == "any"
        self.k = int(spec.hole_exact)
        self._combo = {}
        self._tabs = {}

    # ---- "any": best 5 of all cards -------------------------------------------------
    def _eval_any(self, cards: np.ndarray) -> np.ndarray:
        B, n = cards.shape
        tab = self._tabs.get(n)
        if tab is None:
            tab = self._tabs[n] = _rank_table(self.spec, n)
        codes, scores, _ = tab
        g = _CARD[cards]
        x = g[:, 0].copy()
        for j in range(1, n):
            x += g[:, j]
        out = scores[np.searchsorted(codes, x & _LO)]
        nib = x >> 32                                        # 4-bit suit counters
        fl = np.flatnonzero((nib + 0x3333) & 0x8888)        # some suit has >= 5 cards
        if len(fl):
            cf = cards[fl]
            rf, sf = cf >> 2, cf & 3
            bits = np.left_shift(1, rf)
            best = np.zeros(len(fl), dtype=np.int64)
            for u in range(4):
                m = np.bitwise_or.reduce(np.where(sf == u, bits, 0), axis=1)
                np.maximum(best, self.flush[m], out=best)
            out[fl] = np.maximum(out[fl], best)
        return out

    # ---- "exactly": k hole + (5-k) board ---------------------------------------------
    def _subsets(self, h: int, b: int):
        key = (h, b)
        if key not in self._combo:
            k = self.k
            self._combo[key] = (np.array(list(combinations(range(h), k)), np.int64).reshape(-1, k),
                                np.array(list(combinations(range(b), 5 - k)), np.int64).reshape(-1, 5 - k))
        return self._combo[key]

    @staticmethod
    def _subset_codes(g, sub):
        """g = _CARD[cards] (B, n); sub (ns, m) -> (B, ns) summed codes per subset."""
        x = np.zeros((g.shape[0], sub.shape[0]), dtype=np.int64)
        for j in range(sub.shape[1]):
            x += g[:, sub[:, j]]
        return x

    def _eval_exact(self, holes, boards) -> np.ndarray:
        hs, bs = self._subsets(holes.shape[1], boards.shape[1])
        tab = self._tabs.get("exact")
        if tab is None:
            hc, bc, T = _exact_table(self.spec, self.k)
            tab = self._tabs["exact"] = (hc, bc, T.ravel(), len(bc))
        hc, bc, Tf, nbc = tab
        xh = self._subset_codes(_CARD[holes], hs)
        xb = self._subset_codes(_CARD[boards], bs)
        hi = np.searchsorted(hc, xh & _LO)
        bi = np.searchsorted(bc, xb & _LO)
        nh, nb = len(hs), len(bs)
        sc = Tf[(hi * nbc)[:, :, None] + bi[:, None, :]]     # (B, nh, nb) non-flush scores
        nib = (xh >> 32)[:, :, None] + (xb >> 32)[:, None, :]
        fl = np.flatnonzero((nib + 0x3333) & 0x8888)        # combos with 5 cards of one suit
        if len(fl):
            row, rem = np.divmod(fl, nh * nb)
            i, j = np.divmod(rem, nb)
            c5 = np.concatenate([holes[row[:, None], hs[i]], boards[row[:, None], bs[j]]], axis=1)
            m = np.bitwise_or.reduce(np.left_shift(1, c5 >> 2), axis=1)
            sc.reshape(-1)[fl] = self.flush[m]               # as Evaluator.eval5: flush replaces
        return sc.reshape(len(holes), -1).max(axis=1)

    def evaluate_batch(self, holes, boards) -> np.ndarray:
        holes = np.asarray(holes, dtype=np.int64)
        boards = np.asarray(boards, dtype=np.int64)
        if boards.ndim == 1:
            boards = boards.reshape(len(holes), -1)
        if self.any:
            n = holes.shape[1] + boards.shape[1]
            if 5 <= n <= 9:
                return self._eval_any(np.concatenate([holes, boards], axis=1))
        elif holes.shape[1] >= self.k and boards.shape[1] >= 5 - self.k:
            return self._eval_exact(holes, boards)
        return self.ev.evaluate_batch(holes, boards)
