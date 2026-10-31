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

from functools import lru_cache
from itertools import combinations, combinations_with_replacement

import numpy as np

from engine.evaluator import get_evaluator
from engine.spec import GameSpec

_P5 = (5 ** np.arange(13, dtype=np.int64)).astype(np.int64)
# per card: rank code in the low 32 bits (5**12 * 12 < 2**32), a 4-bit suit counter above
_CARD = np.array([int(_P5[c >> 2]) | (1 << (32 + 4 * (c & 3))) for c in range(52)], dtype=np.int64)
_LO = (1 << 32) - 1


def _rep_cards(ranks) -> list[int]:
    """Representative cards for a rank multiset with no suit holding 5+ cards (no flush)."""
    load = [0, 0, 0, 0]
    out = []
    i = 0
    rs = list(ranks)
    while i < len(rs):
        r = rs[i]
        j = i
        while j < len(rs) and rs[j] == r:
            j += 1
        suits = sorted(range(4), key=lambda u: (load[u], u))[: j - i]
        for u in suits:
            load[u] += 1
            out.append((r << 2) | u)
        i = j
    return out


@lru_cache(maxsize=None)
def _rank_table(spec_key, n: int):
    """Sorted codes (sum 5**rank) of all valid n-rank multisets and their non-flush scores."""
    spec = spec_key
    ev = get_evaluator(spec)
    ranks = sorted(spec.deck_ranks)
    ms = [c for c in combinations_with_replacement(ranks, n)
          if max((c.count(r) for r in set(c)), default=0) <= 4]
    codes = np.array([int(_P5[list(c)].sum()) if c else 0 for c in ms], dtype=np.int64)
    if n >= 5:
        reps = np.array([_rep_cards(c) for c in ms], dtype=np.int64)
        scores = ev.eval_any(reps)
    else:
        scores = np.zeros(len(ms), dtype=np.int64)
    order = np.argsort(codes)
    return codes[order], scores[order], [ms[i] for i in order]


@lru_cache(maxsize=None)
def _exact_table(spec_key, k: int):
    """2-D non-flush score table for exactly k hole + (5-k) board ranks."""
    spec = spec_key
    ev = get_evaluator(spec)
    hc, _, hms = _rank_table(spec, k)
    bc, _, bms = _rank_table(spec, 5 - k)
    T = np.zeros((len(hc), len(bc)), dtype=np.int64)
    rows, ii, jj = [], [], []
    for i, h in enumerate(hms):
        for j, b in enumerate(bms):
            c = tuple(sorted(h + b))
            if max(c.count(r) for r in set(c)) <= 4:
                rows.append(_rep_cards(c))
                ii.append(i)
                jj.append(j)
    T[np.array(ii), np.array(jj)] = ev.eval_any(np.array(rows, dtype=np.int64))
    return hc, bc, T


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
            if 5 <= n <= 12:
                return self._eval_any(np.concatenate([holes, boards], axis=1))
        elif holes.shape[1] >= self.k and boards.shape[1] >= 5 - self.k:
            return self._eval_exact(holes, boards)
        return self.ev.evaluate_batch(holes, boards)
