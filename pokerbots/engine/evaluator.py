"""Vectorised hand evaluator that honours a GameSpec.

Scores are int64, higher is better, and only comparable within one spec.
score = category_value << 20 | five 4-bit rank digits (most significant first).

Usage:
    ev = get_evaluator(spec)
    ev.evaluate(hole, board)            # one hand -> int
    ev.evaluate_batch(holes, boards)    # (B,h), (B,b) int arrays -> (B,) int64
    ev.category(score)                  # -> 'flush', ...
"""
from __future__ import annotations

from functools import lru_cache
from itertools import combinations

import numpy as np

from .spec import GameSpec

_NM = 1 << 13
_AR13 = np.arange(13, dtype=np.int64)
_P2 = (1 << _AR13).astype(np.int64)


def _bits_desc(m: int) -> list[int]:
    return [r for r in range(12, -1, -1) if m >> r & 1]


def _pack(digits) -> int:
    v = 0
    for d in digits:
        v = (v << 4) | d
    return v


@lru_cache(maxsize=None)
def _tables(order: tuple, deck_ranks: tuple, ace_low: bool):
    cat = {name: i + 1 for i, name in enumerate(order)}
    pop = np.zeros(_NM, np.int64)
    high = np.full(_NM, -1, np.int64)
    top2 = np.zeros(_NM, np.int64)
    top3 = np.zeros(_NM, np.int64)
    top5 = np.zeros(_NM, np.int64)
    straight_top = np.full(_NM, -1, np.int64)
    flush_tbl = np.zeros(_NM, np.int64)

    ranks = sorted(deck_ranks)
    windows = []  # (mask, top)
    for i in range(len(ranks) - 4):
        w = ranks[i:i + 5]
        if w[-1] - w[0] == 4:
            windows.append((sum(1 << r for r in w), w[-1]))
    if ace_low and 12 in ranks and len(ranks) >= 5:
        w = [12] + ranks[:4]
        windows.append((sum(1 << r for r in w), ranks[3]))

    for m in range(_NM):
        b = _bits_desc(m)
        pop[m] = len(b)
        if b:
            high[m] = b[0]
        top2[m] = _pack((b + [0, 0])[:2])
        top3[m] = _pack((b + [0, 0, 0])[:3])
        top5[m] = _pack((b + [0] * 5)[:5])
        st = -1
        for wm, top in windows:
            if m & wm == wm and top > st:
                st = top
        straight_top[m] = st
        if len(b) >= 5:
            fl = (cat["flush"] << 20) | int(top5[m])
            sf = (cat["straight_flush"] << 20) | (st << 16) if st >= 0 else 0
            flush_tbl[m] = max(fl, sf)
    return dict(cat=cat, pop=pop, high=high, top2=top2, top3=top3, top5=top5,
                straight_top=straight_top, flush=flush_tbl)


class Evaluator:
    def __init__(self, spec: GameSpec):
        self.spec = spec
        self.order = tuple(spec.category_order)
        self.t = _tables(self.order, tuple(sorted(spec.deck_ranks)), spec.ace_low_straight)
        self._combo_cache: dict = {}
        self._t5 = None

    # ---- fast path for exactly 5 cards (used by "exactly K" hole usage) -------------
    _W5 = np.array([13 ** 4, 13 ** 3, 13 ** 2, 13, 1], dtype=np.int64)

    def _build_t5(self):
        from itertools import combinations_with_replacement
        rows = []
        idxs = []
        for combo in combinations_with_replacement(range(13), 5):  # ascending ranks
            if max(combo.count(r) for r in set(combo)) > 4:
                continue
            rows.append([(r << 2) | (i % 4) for i, r in enumerate(combo)])
            idxs.append(int(np.dot(combo, self._W5)))
        t5 = np.zeros(13 ** 5, dtype=np.int64)
        t5[np.array(idxs)] = self.eval_any(np.array(rows, dtype=np.int64))
        self._t5 = t5

    def eval5(self, cards: np.ndarray) -> np.ndarray:
        """cards: (B, 5) -> scores; same results as eval_any, ~4x faster."""
        if self._t5 is None:
            self._build_t5()
        cards = np.asarray(cards, dtype=np.int64)
        r = cards >> 2
        s = cards & 3
        score = self._t5[np.sort(r, axis=1) @ self._W5]
        fl = (s == s[:, :1]).all(axis=1)
        if fl.any():
            m = np.bitwise_or.reduce(np.left_shift(1, r[fl]), axis=1)
            score[fl] = self.t["flush"][m]
        return score

    # ---- core: best 5 of any n >= 5 cards -------------------------------------
    def eval_any(self, cards: np.ndarray) -> np.ndarray:
        """cards: (B, n) int array, n >= 5. Best 5-card hand from all n cards."""
        t = self.t
        c = t["cat"]
        cards = np.asarray(cards, dtype=np.int64)
        r = cards >> 2
        s = cards & 3
        bits = np.left_shift(1, r)
        counts = (r[:, :, None] == _AR13).sum(axis=1)
        S = (counts >= 1).astype(np.int64) @ _P2
        P = (counts >= 2).astype(np.int64) @ _P2
        T = (counts >= 3).astype(np.int64) @ _P2
        Q = (counts >= 4).astype(np.int64) @ _P2
        fl = np.zeros(len(cards), np.int64)
        for u in range(4):
            sm = np.bitwise_or.reduce(np.where(s == u, bits, 0), axis=1)
            np.maximum(fl, t["flush"][sm], out=fl)
        high, top2, top3, top5 = t["high"], t["top2"], t["top3"], t["top5"]

        best = (c["high_card"] << 20) | top5[S]
        np.maximum(best, fl, out=best)

        st = t["straight_top"][S]
        np.maximum(best, np.where(st >= 0, (c["straight"] << 20) | (np.maximum(st, 0) << 16), 0),
                   out=best)

        pr = np.maximum(high[P], 0)
        Sx = S & ~np.left_shift(1, pr)
        np.maximum(best, np.where(P > 0, (c["pair"] << 20) | (pr << 16) | (top3[Sx] << 4), 0),
                   out=best)

        P2 = P & ~np.left_shift(1, pr)
        pr2 = np.maximum(high[P2], 0)
        rem = Sx & ~np.left_shift(1, pr2)
        np.maximum(best, np.where(P2 > 0, (c["two_pair"] << 20) | (pr << 16) | (pr2 << 12)
                                  | (np.maximum(high[rem], 0) << 8), 0), out=best)

        tr = np.maximum(high[T], 0)
        St = S & ~np.left_shift(1, tr)
        np.maximum(best, np.where(T > 0, (c["trips"] << 20) | (tr << 16) | (top2[St] << 8), 0),
                   out=best)
        Pt = P & ~np.left_shift(1, tr)
        np.maximum(best, np.where((T > 0) & (Pt > 0),
                                  (c["full_house"] << 20) | (tr << 16)
                                  | (np.maximum(high[Pt], 0) << 12), 0), out=best)

        qr = np.maximum(high[Q], 0)
        Sq = S & ~np.left_shift(1, qr)
        np.maximum(best, np.where(Q > 0, (c["quads"] << 20) | (qr << 16)
                                  | (np.maximum(high[Sq], 0) << 12), 0), out=best)
        return best

    # ---- spec-aware evaluation -----------------------------------------------
    def _combos(self, h: int, b: int):
        key = (h, b)
        if key not in self._combo_cache:
            k = self.spec.hole_exact
            hc = list(combinations(range(h), k))
            bc = list(combinations(range(b), 5 - k))
            if not hc or not bc:
                raise ValueError(f"cannot use exactly {k} of {h} hole with {b} board cards")
            self._combo_cache[key] = (np.array([x for x in hc for _ in bc], np.int64).reshape(len(hc) * len(bc), k),
                                      np.array([y for _ in hc for y in bc], np.int64).reshape(len(hc) * len(bc), 5 - k))
        return self._combo_cache[key]

    def evaluate_batch(self, holes, boards) -> np.ndarray:
        """holes (B,h), boards (B,b) -> (B,) scores following spec.hole_usage."""
        holes = np.asarray(holes, dtype=np.int64)
        boards = np.asarray(boards, dtype=np.int64)
        if boards.ndim == 1:
            boards = boards.reshape(len(holes), -1)
        B = holes.shape[0]
        if self.spec.hole_usage == "any":
            return self.eval_any(np.concatenate([holes, boards], axis=1))
        hi, bi = self._combos(holes.shape[1], boards.shape[1])
        nc = len(hi)
        five = np.concatenate([holes[:, hi], boards[:, bi]], axis=2).reshape(B * nc, 5)
        return self.eval5(five).reshape(B, nc).max(axis=1)

    def evaluate(self, hole, board) -> int:
        return int(self.evaluate_batch(np.asarray([list(hole)]), np.asarray([list(board)]))[0])

    def category(self, score: int) -> str:
        return self.order[(int(score) >> 20) - 1]


_EVALS: dict = {}


def get_evaluator(spec: GameSpec) -> Evaluator:
    key = (spec.category_order, tuple(spec.deck_ranks), spec.ace_low_straight,
           spec.hole_usage, spec.hole_exact)
    ev = _EVALS.get(key)
    if ev is None:
        ev = _EVALS[key] = Evaluator(spec)
    return ev
