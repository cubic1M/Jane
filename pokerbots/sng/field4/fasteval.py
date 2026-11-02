"""Fast pure-Python hand evaluation for 5 to 7 cards (hold'em), built at import time.

Scores are identical to engine.evaluator (category << 20 | rank digits), so higher is
better and `score >> 20` is the category (1 high card .. 9 straight flush).

A card c (0..51) maps to the integer key CK[c] = 5**rank + (1 << (32 + 4*suit)).
Summing the keys of a hand gives, in the low 32 bits, a unique id of the rank
multiset (no rank appears more than 4 times) and, in the high bits, four suit
counters. Non-flush scores come from a dict on the rank id; flushes from the
engine's 8192-entry flush table on the flush suit's rank mask.
"""
from __future__ import annotations

from itertools import combinations_with_replacement

import numpy as np

from engine.evaluator import get_evaluator
from sng.rules import SngRules

_EV = get_evaluator(SngRules().spec)
LOW32 = (1 << 32) - 1
CK = [5 ** (c >> 2) + (1 << (32 + 4 * (c & 3))) for c in range(52)]
RBIT = [1 << (c >> 2) for c in range(52)]
FLUSH_TBL = [int(x) for x in _EV.t["flush"]]
STRAIGHT_TOP = [int(x) for x in _EV.t["straight_top"]]
CAT_PAIR, CAT_TWO, CAT_TRIPS, CAT_STRAIGHT, CAT_FLUSH, CAT_FULL, CAT_QUADS = 2, 3, 4, 5, 6, 7, 8


def _build_nonflush():
    keys, rows = [], []
    for n in (5, 6, 7):
        for combo in combinations_with_replacement(range(13), n):
            if max(combo.count(r) for r in set(combo)) > 4:
                continue
            rows.append([(r << 2) | (i % 4) for i, r in enumerate(combo)] + [-1] * (7 - n))
            keys.append(sum(5 ** r for r in combo))
    out = {}
    arr = np.array(rows, dtype=np.int64)
    for n in (5, 6, 7):
        sel = (arr[:, n - 1] >= 0) & ((arr[:, n] < 0) if n < 7 else True)
        idx = np.nonzero(sel)[0]
        sc = _EV.eval_any(arr[idx, :n])
        for i, s in zip(idx, sc):
            out[keys[i]] = int(s)
    return out


NONFLUSH = _build_nonflush()


def score_key(key: int, cards) -> int:
    """Score of a hand given the sum of its card keys and the cards themselves."""
    s = NONFLUSH[key & LOW32]
    su = key >> 32
    fl = (su + 0x3333) & 0x8888
    if fl:
        u = (fl.bit_length() - 4) >> 2
        m = 0
        for c in cards:
            if c & 3 == u:
                m |= RBIT[c]
        f = FLUSH_TBL[m]
        if f > s:
            return f
    return s


def score(cards) -> int:
    k = 0
    for c in cards:
        k += CK[c]
    return score_key(k, cards)


def board_rank_cat(board) -> int:
    """Category the board's ranks alone make (pairs etc., no straights/flushes):
    0 nothing, 1 pair, 2 two pair, 3 trips, 4 full house / quads."""
    cnt = {}
    for c in board:
        r = c >> 2
        cnt[r] = cnt.get(r, 0) + 1
    v = sorted(cnt.values(), reverse=True)
    if v[0] >= 4 or (v[0] == 3 and len(v) > 1 and v[1] >= 2):
        return 4
    if v[0] == 3:
        return 3
    if v[0] == 2:
        return 2 if len(v) > 1 and v[1] == 2 else 1
    return 0
