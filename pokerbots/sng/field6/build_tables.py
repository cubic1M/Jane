"""Builds sng/field6/data/pf6.npz (run once: python3 -m sng.field6.build_tables).

Monte Carlo heads-up all-in equity between the 169 starting-hand classes, reduced to:
  * strength: a percentile per class (fraction of combos at least as strong), from a
    blend of equity vs a random hand and vs a top-20% range;
  * eqtop[k, h]: equity of class h against the top (k+1)*2% of hands, k = 0..49.
Class index: pair r*13+r, suited hi*13+lo, offsuit lo*13+hi (rank 0 = '2').
"""
from __future__ import annotations

import os
import time

import numpy as np

from engine.evaluator import get_evaluator
from sng.rules import SngRules

OUT = os.path.join(os.path.dirname(__file__), "data", "pf6.npz")


def cls(c1: int, c2: int) -> int:
    r1, r2 = c1 >> 2, c2 >> 2
    hi, lo = max(r1, r2), min(r1, r2)
    if hi == lo:
        return hi * 14
    return hi * 13 + lo if (c1 & 3) == (c2 & 3) else lo * 13 + hi


def main(trials=1500, seed=11):
    ev = get_evaluator(SngRules().spec)
    rng = np.random.default_rng(seed)
    combos = [[] for _ in range(169)]
    for a in range(52):
        for b in range(a + 1, 52):
            combos[cls(a, b)].append((a, b))
    ncomb = np.array([len(c) for c in combos])
    tab = np.zeros((169, 12, 2), np.int64)
    for k, c in enumerate(combos):
        tab[k, :len(c)] = c
    pairs = np.array([(a, b) for a in range(169) for b in range(a, 169)])
    win = np.zeros((169, 169))
    cnt = np.zeros((169, 169))
    chunk = 400
    t0 = time.time()
    for s in range(0, len(pairs), chunk):
        pp = pairs[s:s + chunk]
        A = np.repeat(pp[:, 0], trials)
        B = np.repeat(pp[:, 1], trials)
        ha = tab[A, rng.integers(0, 1 << 30, len(A)) % ncomb[A]]
        hb = tab[B, rng.integers(0, 1 << 30, len(B)) % ncomb[B]]
        ok = (ha[:, 0] != hb[:, 0]) & (ha[:, 0] != hb[:, 1]) & (ha[:, 1] != hb[:, 0]) & (ha[:, 1] != hb[:, 1])
        A, B, ha, hb = A[ok], B[ok], ha[ok], hb[ok]
        keys = rng.random((len(A), 52), dtype=np.float32)
        rows = np.arange(len(A))[:, None]
        keys[rows, ha] = 2.0
        keys[rows, hb] = 2.0
        board = np.argpartition(keys, 5, axis=1)[:, :5]
        sa = ev.eval_any(np.concatenate([ha, board], axis=1))
        sb = ev.eval_any(np.concatenate([hb, board], axis=1))
        res = (sa > sb) + 0.5 * (sa == sb)
        np.add.at(win, (A, B), res)
        np.add.at(cnt, (A, B), 1)
        np.add.at(win, (B, A), 1 - res)
        np.add.at(cnt, (B, A), 1)
        if s % (chunk * 8) == 0:
            print(f"{s}/{len(pairs)} {time.time() - t0:.0f}s", flush=True)
    eq = win / np.maximum(cnt, 1)
    w = ncomb / ncomb.sum()
    eq_rand = eq @ w

    def top_mask(score, frac):
        order = np.argsort(-score)
        cum = np.cumsum(w[order])
        m = np.zeros(169)
        m[order[cum <= frac + 1e-9]] = 1
        m[order[0]] = 1
        return m

    score = eq_rand.copy()
    for _ in range(3):
        m = top_mask(score, 0.2)
        score = 0.5 * eq_rand + 0.5 * (eq @ (m * w)) / (m * w).sum()
    order = np.argsort(-score)
    pct = np.zeros(169)
    pct[order] = np.cumsum(w[order])
    eqtop = np.zeros((50, 169))
    for k in range(50):
        m = (pct <= 0.02 * (k + 1) + 1e-9).astype(float)
        m[order[0]] = 1
        eqtop[k] = eq @ (m * w) / (m * w).sum()
    np.savez_compressed(OUT, pct=pct, eqtop=eqtop.astype(np.float32), eq_rand=eq_rand, ncomb=ncomb)
    print("saved", OUT, f"{time.time() - t0:.0f}s")


if __name__ == "__main__":
    main()
