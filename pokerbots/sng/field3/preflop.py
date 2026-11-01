"""Preflop hand strength shared by the field-3 bots.

For 2-card variants a table is built once per process and card spec by Monte Carlo
(several hands per deal share one board): heads-up equity of each starting-hand class
(169 for a full deck) vs every other class. From it:
  * pct(hole): fraction of starting hands at least as good (0 = best, 1 = worst);
  * eq_vs_top(hole, x): equity vs a hand drawn from the top x of hands.
Other variants (e.g. 4-card Omaha) fall back to a Chen-formula heuristic.
"""
from __future__ import annotations

import math
from itertools import combinations

import numpy as np

from engine.evaluator import get_evaluator

GRID = np.array([0.01, 0.02, 0.03, 0.045, 0.06, 0.08, 0.10, 0.125, 0.15, 0.20, 0.25, 0.30,
                 0.35, 0.40, 0.50, 0.60, 0.70, 0.80, 0.90, 1.0])


def chen(c1: int, c2: int) -> float:
    """Bill Chen's formula on two cards (ranks 0='2'..12='A')."""
    r1, r2 = c1 >> 2, c2 >> 2
    hi, lo = max(r1, r2), min(r1, r2)
    base = {12: 10.0, 11: 8.0, 10: 7.0, 9: 6.0}.get(hi, (hi + 2) / 2.0)
    if r1 == r2:
        return float(max(5.0, base * 2))
    s = base
    if (c1 & 3) == (c2 & 3):
        s += 2
    gap = hi - lo - 1
    s -= {0: 0, 1: 1, 2: 2, 3: 4}.get(gap, 5)
    if gap <= 1 and hi < 10:
        s += 1
    return float(math.ceil(s))


def chen_multi(hole) -> float:
    """Best 2-card Chen score of a hand with any number of hole cards, with a small
    bonus for extra coordinated pairs (multi-card games)."""
    if len(hole) == 2:
        return chen(hole[0], hole[1])
    sc = sorted((chen(a, b) for a, b in combinations(hole, 2)), reverse=True)
    return sc[0] + 0.25 * sc[1]


_CHEN_X = [-2, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 16, 20]
_CHEN_P = [1.0, 0.85, 0.70, 0.60, 0.47, 0.35, 0.25, 0.16, 0.10, 0.06, 0.025, 0.01, 0.003]


def chen_pct(score: float) -> float:
    return float(np.interp(score, _CHEN_X, _CHEN_P))


def hand_class(c1: int, c2: int) -> int:
    r1, r2 = c1 >> 2, c2 >> 2
    hi, lo = max(r1, r2), min(r1, r2)
    if hi == lo:
        return hi * 13 + lo
    if (c1 & 3) == (c2 & 3):
        return hi * 13 + lo          # suited: row hi, col lo
    return lo * 13 + hi              # offsuit: row lo, col hi


def _classes_np(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    ra, rb = a >> 2, b >> 2
    hi, lo = np.maximum(ra, rb), np.minimum(ra, rb)
    suited = (a & 3) == (b & 3)
    return np.where(hi == lo, hi * 13 + lo, np.where(suited, hi * 13 + lo, lo * 13 + hi))


def _combos_of(c: int) -> int:
    hi, lo = c // 13, c % 13
    if hi == lo:
        return 6
    return 4 if hi > lo else 12


class PreflopTable:
    def __init__(self, spec, deals: int = 160_000, per_deal: int = 8, seed: int = 20261101):
        self.spec = spec
        ev = get_evaluator(spec)
        deck = np.array(spec.deck, dtype=np.int64)
        D = len(deck)
        k = per_deal
        nb = spec.total_board_dealt
        need = 2 * k + nb
        rng = np.random.default_rng(seed)
        W = np.zeros(169 * 169)
        C = np.zeros(169 * 169)
        chunk = 20_000
        done = 0
        while done < deals:
            m = min(chunk, deals - done)
            done += m
            idx = np.argpartition(rng.random((m, D)), need - 1, axis=1)[:, :need]
            cards = deck[idx]
            board = cards[:, 2 * k:]
            scores = []
            cls = []
            for h in range(k):
                hole = cards[:, 2 * h:2 * h + 2]
                scores.append(ev.evaluate_batch(hole, board))
                cls.append(_classes_np(hole[:, 0], hole[:, 1]))
            for i in range(k):
                for j in range(i + 1, k):
                    e = (scores[i] > scores[j]) + 0.5 * (scores[i] == scores[j])
                    W += np.bincount(cls[i] * 169 + cls[j], weights=e, minlength=169 * 169)
                    W += np.bincount(cls[j] * 169 + cls[i], weights=1.0 - e, minlength=169 * 169)
                    C += np.bincount(cls[i] * 169 + cls[j], minlength=169 * 169)
                    C += np.bincount(cls[j] * 169 + cls[i], minlength=169 * 169)
        W = W.reshape(169, 169)
        C = C.reshape(169, 169)
        present = np.zeros(169, bool)
        ranks = set(spec.deck_ranks)
        for c in range(169):
            present[c] = (c // 13 in ranks) and (c % 13 in ranks)
        rows = np.maximum(C.sum(axis=1), 1)
        eq = np.where(present, W.sum(axis=1) / rows, np.nan)
        combos = np.array([_combos_of(c) if present[c] else 0 for c in range(169)], float)
        order = [c for c in np.argsort(-np.nan_to_num(eq, nan=-1.0)) if present[c]]
        tot = combos.sum()
        pct = np.ones(169)
        cum = 0.0
        for c in order:
            cum += combos[c]
            pct[c] = cum / tot
        self.eq_random = eq
        self.pct_table = pct
        # equity vs the top-x range, x on GRID
        eqr = np.full((169, len(GRID)), 0.5)
        best = pct[order[0]]
        for gi, x in enumerate(GRID):
            R = present & (pct <= max(x, best) + 1e-12)
            w = W[:, R].sum(axis=1)
            cnt = C[:, R].sum(axis=1)
            eqr[:, gi] = np.where(cnt > 0, w / np.maximum(cnt, 1), 0.5)
        self.eqr = eqr
        self.order = order

    def pct(self, hole) -> float:
        return float(self.pct_table[hand_class(hole[0], hole[1])])

    def eq_vs_top(self, hole, x: float) -> float:
        row = self.eqr[hand_class(hole[0], hole[1])]
        return float(np.interp(min(max(x, GRID[0]), 1.0), GRID, row))


class HeuristicPreflop:
    """Fallback for variants with more than two hole cards."""

    def __init__(self, spec):
        self.spec = spec

    def pct(self, hole) -> float:
        return chen_pct(chen_multi(hole))

    def eq_vs_top(self, hole, x: float) -> float:
        # multi-card hands run close together: a gentle slope around 50%
        return float(min(0.72, max(0.30, 0.5 + 0.28 * (x - self.pct(hole)))))


_TABLES: dict = {}


def get_preflop(spec):
    key = (tuple(spec.deck_ranks), spec.category_order, spec.hole_cards, spec.hole_usage,
           spec.hole_exact, spec.board_cards_per_street)
    t = _TABLES.get(key)
    if t is None:
        if spec.hole_cards == 2 and not spec.discards:
            t = PreflopTable(spec)
        else:
            t = HeuristicPreflop(spec)
        _TABLES[key] = t
    return t
