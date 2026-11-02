"""Offline builder for sng/field4/data/f4_tables.npz (run once; about 2 minutes on 2 cores).

    python3 -m sng.field4.build_tables

Tables:
  pre_k[169, 8]      equity of a starting-hand class vs k random hands (column k, 1..7)
  pf_mat[169, 169]   heads-up all-in equity of class i vs class j
  post[3, 19, 5, 12, 5]  equity of a postflop bucket vs k random hands (k = 1..4, index k)
  post_n[3, 19, 5, 12]   samples behind each bucket (before fallback filling)
"""
from __future__ import annotations

import sys
import time
from multiprocessing import Pool

import numpy as np

from engine.evaluator import get_evaluator
from sng.rules import SngRules

from .features import N_DRAW, N_MADE, N_TEX, class_info, post_features

EV = get_evaluator(SngRules().spec)


def class_combos(cls):
    hi, lo, s, p = class_info(cls)
    out = []
    for a in range(4):
        for b in range(4):
            if p and a < b:
                out.append((hi * 4 + a, lo * 4 + b))
            elif not p and s and a == b:
                out.append((hi * 4 + a, lo * 4 + b))
            elif not p and not s and a != b:
                out.append((hi * 4 + a, lo * 4 + b))
    return out


def shares(hero, opps):
    """hero (N,), opps (k, N) scores -> (N, k) share vs the first j+1 opponents."""
    N = hero.shape[0]
    k = opps.shape[0]
    out = np.zeros((N, k))
    best_opp = np.full(N, -1, np.int64)
    ties = np.zeros(N)
    for j in range(k):
        o = opps[j]
        better = o > best_opp
        ties = np.where(better, 0, ties)
        best_opp = np.maximum(best_opp, o)
        ties = ties + (o == best_opp)
        win = hero > best_opp
        tie = hero == best_opp
        out[:, j] = np.where(win, 1.0, np.where(tie, 1.0 / (ties + 1), 0.0))
    return out


def pre_k_job(args):
    cls, n, seed = args
    rng = np.random.default_rng(seed)
    combos = np.array(class_combos(cls))
    pick = combos[rng.integers(len(combos), size=n)]
    deck = np.arange(52)
    mask = np.ones((n, 52), bool)
    mask[np.arange(n), pick[:, 0]] = False
    mask[np.arange(n), pick[:, 1]] = False
    keys = rng.random((n, 52))
    keys[~mask] = 2.0
    perm = np.argsort(keys, axis=1)[:, :19]
    board = perm[:, 14:19]
    hero = EV.eval_any(np.concatenate([pick, board], axis=1))
    opps = np.stack([EV.eval_any(np.concatenate([perm[:, 2 * j:2 * j + 2], board], axis=1)) for j in range(7)])
    return cls, shares(hero, opps).mean(axis=0)


def mat_job(args):
    i, n, seed = args
    rng = np.random.default_rng(seed)
    ci = np.array(class_combos(i))
    row = np.zeros(169)
    for j in range(i, 169):
        cj = np.array(class_combos(j))
        a = ci[rng.integers(len(ci), size=n)]
        b = cj[rng.integers(len(cj), size=n)]
        for _ in range(50):
            bad = (a[:, 0] == b[:, 0]) | (a[:, 0] == b[:, 1]) | (a[:, 1] == b[:, 0]) | (a[:, 1] == b[:, 1])
            if not bad.any():
                break
            b[bad] = cj[rng.integers(len(cj), size=int(bad.sum()))]
        ok = ~((a[:, 0] == b[:, 0]) | (a[:, 0] == b[:, 1]) | (a[:, 1] == b[:, 0]) | (a[:, 1] == b[:, 1]))
        a, b = a[ok], b[ok]
        m = len(a)
        keys = rng.random((m, 52))
        r = np.arange(m)
        for c in (a[:, 0], a[:, 1], b[:, 0], b[:, 1]):
            keys[r, c] = 2.0
        board = np.argsort(keys, axis=1)[:, :5]
        sa = EV.eval_any(np.concatenate([a, board], axis=1))
        sb = EV.eval_any(np.concatenate([b, board], axis=1))
        row[j] = float(np.mean(np.where(sa > sb, 1.0, np.where(sa == sb, 0.5, 0.0))))
    return i, row


def post_job(args):
    street, n, seed = args
    rng = np.random.default_rng(seed)
    nb = (3, 4, 5)[street - 1]
    perm = np.argsort(rng.random((n, 52)), axis=1)[:, :15]
    hole = perm[:, :2]
    board = perm[:, 2:7]
    opp = perm[:, 7:15]
    hero = EV.eval_any(np.concatenate([hole, board], axis=1))
    opps = np.stack([EV.eval_any(np.concatenate([opp[:, 2 * j:2 * j + 2], board], axis=1)) for j in range(4)])
    sh = shares(hero, opps)
    sums = np.zeros((N_MADE, N_DRAW, N_TEX, 4))
    cnt = np.zeros((N_MADE, N_DRAW, N_TEX))
    hl = hole.tolist()
    bl = board[:, :nb].tolist()
    for i in range(n):
        m, d, t, _ = post_features(hl[i], bl[i])
        sums[m, d, t] += sh[i]
        cnt[m, d, t] += 1
    return street, sums, cnt


def main():
    t0 = time.time()
    n_pre = int(sys.argv[1]) if len(sys.argv) > 1 else 24000
    n_mat = int(sys.argv[2]) if len(sys.argv) > 2 else 500
    n_post = int(sys.argv[3]) if len(sys.argv) > 3 else 1200000
    pre_k = np.zeros((169, 8))
    pf = np.full((169, 169), 0.5)
    post_s = np.zeros((3, N_MADE, N_DRAW, N_TEX, 4))
    post_c = np.zeros((3, N_MADE, N_DRAW, N_TEX))
    with Pool(2) as pool:
        for cls, eq in pool.imap_unordered(pre_k_job, [(c, n_pre, 1000 + c) for c in range(169)]):
            pre_k[cls, 1:] = eq
        print("pre_k", time.time() - t0, flush=True)
        for i, row in pool.imap_unordered(mat_job, [(i, n_mat, 5000 + i) for i in range(169)]):
            pf[i, i:] = row[i:]
        print("mat", time.time() - t0, flush=True)
        chunks = 24
        jobs = [(s, n_post // chunks, 9000 + 100 * s + c) for s in (1, 2, 3) for c in range(chunks)]
        for street, sums, cnt in pool.imap_unordered(post_job, jobs):
            post_s[street - 1] += sums
            post_c[street - 1] += cnt
        print("post", time.time() - t0, flush=True)
    for i in range(169):
        pf[i, i] = 0.5
        for j in range(i + 1, 169):
            pf[j, i] = 1.0 - pf[i, j]
    # postflop: mean, then fill sparse buckets from coarser keys
    post = np.zeros((3, N_MADE, N_DRAW, N_TEX, 5))
    MIN = 40
    for s in range(3):
        c_md = post_c[s].sum(axis=2)
        s_md = post_s[s].sum(axis=2)
        c_m = c_md.sum(axis=1)
        s_m = s_md.sum(axis=1)
        for m in range(N_MADE):
            for d in range(N_DRAW):
                for t in range(N_TEX):
                    c = post_c[s, m, d, t]
                    if c >= MIN:
                        v = post_s[s, m, d, t] / c
                    elif c_md[m, d] >= MIN:
                        w = c / MIN
                        base = s_md[m, d] / c_md[m, d]
                        v = (post_s[s, m, d, t] + (MIN - c) * base) / MIN if c else base
                        del w
                    elif c_m[m] > 0:
                        v = s_m[m] / c_m[m]
                    else:
                        v = np.array([0.5, 0.33, 0.25, 0.2])
                    post[s, m, d, t, 1:] = v
    np.savez_compressed("sng/field4/data/f4_tables.npz", pre_k=pre_k.astype(np.float32),
                        pf_mat=pf.astype(np.float32), post=post.astype(np.float32),
                        post_n=post_c.astype(np.int32))
    print("done", time.time() - t0)


if __name__ == "__main__":
    main()
