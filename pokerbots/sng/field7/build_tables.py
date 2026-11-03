"""Builds sng/field7/data/pf7.npz (run once: python3 -m sng.field7.build_tables).

Heads-up all-in equity between the 169 starting-hand classes by Monte Carlo (numpy
evaluator), saved as:
  * eq_rand[h]   equity of class h against a random hand;
  * pct[h]       strength percentile (fraction of the 1326 combos ranked at least as
                 strong), ranking = equity against a strong range blended with equity
                 against a random hand, iterated to a fixed point;
  * eqtop[k, h]  equity of class h against the top (k+1)% of hands, k = 0..99;
  * ncomb[h]     combos per class (6 pairs, 4 suited, 12 offsuit).
Class index: pair r*13+r, suited hi*13+lo, offsuit lo*13+hi (rank 0 = '2').
"""
from __future__ import annotations

import os
import time

import numpy as np

from engine.evaluator import get_evaluator
from sng.rules import NLHE

OUT = os.path.join(os.path.dirname(__file__), "data", "pf7.npz")


def hclass(c1: int, c2: int) -> int:
    r1, r2 = c1 >> 2, c2 >> 2
    hi, lo = max(r1, r2), min(r1, r2)
    if hi == lo:
        return hi * 14
    return hi * 13 + lo if (c1 & 3) == (c2 & 3) else lo * 13 + hi


def equity_matrix(trials: int, seed: int):
    ev = get_evaluator(NLHE)
    rng = np.random.default_rng(seed)
    combos = [[] for _ in range(169)]
    for a in range(52):
        for b in range(a + 1, 52):
            combos[hclass(a, b)].append((a, b))
    ncomb = np.array([len(c) for c in combos])
    tab = np.zeros((169, 12, 2), np.int64)
    for k, c in enumerate(combos):
        tab[k, :len(c)] = c
    win = np.zeros((169, 169))
    cnt = np.zeros((169, 169))
    pairs = np.array([(a, b) for a in range(169) for b in range(a, 169)])
    t0 = time.time()
    step = 300
    for s in range(0, len(pairs), step):
        pp = pairs[s:s + step]
        A = np.repeat(pp[:, 0], trials)
        B = np.repeat(pp[:, 1], trials)
        ha = tab[A, rng.integers(0, 1 << 30, len(A)) % ncomb[A]]
        hb = tab[B, rng.integers(0, 1 << 30, len(B)) % ncomb[B]]
        ok = ((ha[:, :, None] != hb[:, None, :]).all(axis=(1, 2)))
        A, B, ha, hb = A[ok], B[ok], ha[ok], hb[ok]
        keys = rng.random((len(A), 52))
        rows = np.arange(len(A))[:, None]
        keys[rows, ha] = 9.0
        keys[rows, hb] = 9.0
        board = np.argpartition(keys, 5, axis=1)[:, :5]
        sa = ev.eval_any(np.concatenate([ha, board], axis=1))
        sb = ev.eval_any(np.concatenate([hb, board], axis=1))
        res = (sa > sb) + 0.5 * (sa == sb)
        np.add.at(win, (A, B), res)
        np.add.at(cnt, (A, B), 1)
        np.add.at(win, (B, A), 1 - res)
        np.add.at(cnt, (B, A), 1)
        if (s // step) % 10 == 0:
            print(f"{s}/{len(pairs)} pairs, {time.time() - t0:.0f}s", flush=True)
    return win / np.maximum(cnt, 1), ncomb


def main(trials=1200, seed=7):
    eq, ncomb = equity_matrix(trials, seed)
    w = ncomb / ncomb.sum()
    eq_rand = eq @ w

    def percentiles(score):
        order = np.argsort(-score, kind="stable")
        pct = np.zeros(169)
        pct[order] = np.cumsum(w[order])
        return pct, order

    score = eq_rand.copy()
    for _ in range(4):
        pct, _ = percentiles(score)
        strong = (pct <= 0.15).astype(float) * w
        score = 0.45 * eq_rand + 0.55 * (eq @ strong) / strong.sum()
    pct, order = percentiles(score)
    eqtop = np.zeros((100, 169))
    for k in range(100):
        m = (pct <= 0.01 * (k + 1) + 1e-9).astype(float)
        m[order[0]] = 1.0
        eqtop[k] = eq @ (m * w) / (m * w).sum()
    np.savez_compressed(OUT, pct=pct, eq_rand=eq_rand, eqtop=eqtop.astype(np.float32), ncomb=ncomb)
    print("saved", OUT)


if __name__ == "__main__":
    main()
