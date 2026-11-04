"""Offline builder for sng/field9/data (run once; never imported by act()).

    python3 -m sng.field9.build_tables eq   [--deck std|six]   # data/eq9_<deck>.npz
    python3 -m sng.field9.build_tables pf   [--deck std|six]   # data/pf9_<deck>.npz   (needs eq)
    python3 -m sng.field9.build_tables post [--deck std|six]   # data/post9_<deck>.npz (needs eq)
    python3 -m sng.field9.build_tables all  [--deck std|six] [--workers 2]

eq9:   EQ[a, b] all-in equity of class a vs class b (Monte Carlo with the engine's evaluator),
       NCOMB, a strength ranking PCT (fraction of combos at least as strong; ranked by a mix of
       equity vs a random hand and vs a strong range) and EQT[k, h] = equity of h against the
       top (k+1)% of hands.
pf9:   push/fold equilibria with linearised ICM (a lost chip costs BF times a won chip), first
       in with nb players behind, solved by smoothed fictitious play over a grid of effective
       stacks and pusher / caller bubble factors.
post9: postflop equity per cards9.key_of(street, made, draw, texture) against eight villain
       ranges (random, top 50/25/12%, the top-50% hands that continue / bet / raise on this
       board, and two top-50% opponents at once), hierarchically smoothed for rare keys.
"""
from __future__ import annotations

import argparse
import multiprocessing as mp
import os
import time

import numpy as np

from engine.evaluator import get_evaluator
from engine.spec import SHORT_DECK_ORDER, GameSpec
from sng.field9.cards9 import (AIR2, LOWPAIR, N_DRAW, N_KEYS, N_MADE, TPGOOD, TWOPAIR, Scorer, features, hclass,
                               key_of)

DATA = os.path.join(os.path.dirname(__file__), "data")


def deck_spec(deck: str) -> GameSpec:
    if deck == "six":
        return GameSpec(name="f9_six", deck_ranks=tuple(range(4, 13)), category_order=SHORT_DECK_ORDER)
    return GameSpec(name="f9_std")


def _combos(spec):
    combos = [[] for _ in range(169)]
    d = spec.deck
    for i, a in enumerate(d):
        for b in d[i + 1:]:
            combos[hclass(a, b)].append((a, b))
    return combos


# ------------------------------------------------------------------------------- equity
def _eq_chunk(args):
    deck, pairs, trials, seed = args
    spec = deck_spec(deck)
    ev = get_evaluator(spec)
    rng = np.random.default_rng(seed)
    combos = _combos(spec)
    ncomb = np.array([max(1, len(c)) for c in combos])
    tab = np.zeros((169, 12, 2), np.int64)
    for k, c in enumerate(combos):
        if c:
            tab[k, :len(c)] = c
    deck_arr = np.array(spec.deck)
    win = np.zeros((169, 169))
    cnt = np.zeros((169, 169))
    for s in range(0, len(pairs), 100):
        pp = pairs[s:s + 100]
        A = np.repeat(pp[:, 0], trials)
        B = np.repeat(pp[:, 1], trials)
        ha = tab[A, rng.integers(0, 1 << 30, len(A)) % ncomb[A]]
        hb = tab[B, rng.integers(0, 1 << 30, len(B)) % ncomb[B]]
        ok = (ha[:, :, None] != hb[:, None, :]).all(axis=(1, 2))
        A, B, ha, hb = A[ok], B[ok], ha[ok], hb[ok]
        keys = rng.random((len(A), 52))
        keys[:, [c for c in range(52) if c not in set(spec.deck)]] = 3.0
        rows = np.arange(len(A))[:, None]
        keys[rows, ha] = 2.0
        keys[rows, hb] = 2.0
        board = np.argpartition(keys, 5, axis=1)[:, :5]
        sa = ev.eval_any(np.concatenate([ha, board], axis=1))
        sb = ev.eval_any(np.concatenate([hb, board], axis=1))
        res = (sa > sb) + 0.5 * (sa == sb)
        np.add.at(win, (A, B), res)
        np.add.at(cnt, (A, B), 1)
    del deck_arr
    return win, cnt


def build_eq(deck="std", trials=1500, seed=91, workers=2):
    spec = deck_spec(deck)
    combos = _combos(spec)
    valid = [k for k in range(169) if combos[k]]
    pairs = np.array([(a, b) for i, a in enumerate(valid) for b in valid[i:]])
    chunks = np.array_split(pairs, workers * 6)
    t0 = time.time()
    with mp.Pool(workers) as pool:
        parts = pool.map(_eq_chunk, [(deck, c, trials, seed + i) for i, c in enumerate(chunks)])
    win = sum(p[0] for p in parts)
    cnt = sum(p[1] for p in parts)
    eq = np.where(cnt > 0, win / np.maximum(cnt, 1), 0.5)
    full = np.full((169, 169), 0.5)
    for a in valid:
        for b in valid:
            if a < b:
                full[a, b] = eq[a, b]
                full[b, a] = 1.0 - eq[a, b]
    ncomb = np.array([len(c) for c in combos], float)
    w = ncomb / ncomb.sum()
    eq_rand = full @ w

    def pct_of(score):
        score = np.where(ncomb > 0, score, -1.0)
        order = np.argsort(-score, kind="stable")
        pct = np.zeros(169)
        pct[order] = np.cumsum(w[order])
        pct[ncomb == 0] = 1.0
        return pct, order

    sc = eq_rand.copy()
    for _ in range(6):
        pct, _ = pct_of(sc)
        strong = (pct <= 0.2) * w
        sc = 0.55 * eq_rand + 0.45 * (full @ strong) / strong.sum()
    pct, order = pct_of(sc)
    eqt = np.zeros((100, 169))
    for k in range(100):
        m = ((pct <= 0.01 * (k + 1) + 1e-9) | (np.arange(169) == order[0])) * w
        eqt[k] = full @ m / m.sum()
    os.makedirs(DATA, exist_ok=True)
    np.savez_compressed(os.path.join(DATA, f"eq9_{deck}.npz"), eq=full.astype(np.float32),
                        ncomb=ncomb.astype(np.int16), pct=pct, order=order.astype(np.int16),
                        eqt=eqt.astype(np.float32), eq_rand=eq_rand)
    print(f"eq9_{deck} built in {time.time() - t0:.0f}s")


def load_eq(deck):
    d = np.load(os.path.join(DATA, f"eq9_{deck}.npz"))
    return d["eq"].astype(float), d["ncomb"].astype(float), d["pct"]


# ------------------------------------------------------------------------------ push/fold
PF_S = np.round(np.arange(1.0, 25.01, 0.5), 2)               # effective stack in big blinds
PF_BF = np.array([1.0, 1.15, 1.3, 1.5, 1.75, 2.1, 2.6])     # bubble factors


def _sig(x, t=0.004):
    return 1.0 / (1.0 + np.exp(-np.clip(x / t, -60, 60)))


def solve_pf(eq, w, nb, iters=500):
    """Shove-or-fold first in with nb players behind, all stacks S, blinds 0.5 / 1. Callers in
    order: nb-2 unposted players, the small blind (0.5 posted), the big blind (1 posted); nb = 1
    is the small blind against the big blind. A caller calls with every hand whose equity vs
    the push range clears its ICM price; the first caller plays the pusher heads-up."""
    G_S, G_P, G_C = np.meshgrid(PF_S, PF_BF, PF_BF, indexing="ij")
    S, BFp, BFc = (x.reshape(-1, 1) for x in (G_S, G_P, G_C))
    G = S.shape[0]
    types = [1.0] if nb == 1 else [0.0] * (nb - 2) + [0.5, 1.0]
    x0 = 0.5 if nb == 1 else 0.0
    uniq = sorted(set(types))
    eqT = eq.T.copy()
    valid = (w > 0)[None, :]
    p = np.where(valid, 0.3, 0.0) * np.ones((G, 169))
    for it in range(iters):
        pw = p * w
        tot = np.maximum(pw.sum(axis=1, keepdims=True), 1e-9)
        Ec = (pw @ eqT) / tot                                      # caller equity vs push range
        cr, cf, Ep = {}, {}, {}
        for x in uniq:
            Sx = np.maximum(S - x, 0.05)
            need = BFc * Sx / (S + 1.5 - x0 + BFc * Sx)
            c = _sig(Ec - need) * valid
            cw = c * w
            cfx = cw.sum(axis=1, keepdims=True)
            cr[x], cf[x] = c, cfx
            Ep[x] = (cw @ eqT) / np.maximum(cfx, 1e-9)
        U = np.zeros((G, 169))
        reach = np.ones((G, 1))
        loss = S - x0
        for x in types:
            e = Ep[x]
            u = e * (S + 1.5 - x) - BFp * (1 - e) * loss
            U += reach * cf[x] * u
            reach = reach * (1 - cf[x])
        U += reach * 1.5
        br = _sig(U, 0.01) * valid
        a = max(0.02, 1.0 / (it + 2))
        p = (1 - a) * p + a * br
    pw = p * w
    Ec = (pw @ eqT) / np.maximum(pw.sum(axis=1, keepdims=True), 1e-9)
    shp = (len(PF_S), len(PF_BF), len(PF_BF))
    zero = np.zeros(G)
    cfs = np.stack([cf[x][:, 0] if x in cf else zero for x in (0.0, 0.5, 1.0)], axis=1)   # unposted, SB, BB
    return p.reshape(*shp, 169), Ec.reshape(*shp, 169), cfs.reshape(*shp, 3)


def build_pf(deck="std", iters=500):
    eq, ncomb, _ = load_eq(deck)
    w = ncomb / ncomb.sum()
    t0 = time.time()
    push, eqp, cfs = [], [], []
    for nb in range(1, 8):
        p, e, c = solve_pf(eq, w, nb, iters)
        push.append(p)
        eqp.append(e)
        cfs.append(c)
        print(f"  nb={nb} done ({time.time() - t0:.0f}s)", flush=True)
    np.savez_compressed(os.path.join(DATA, f"pf9_{deck}.npz"),
                        push=np.rint(np.stack(push) * 255).astype(np.uint8),
                        eqpush=np.rint(np.stack(eqp) * 255).astype(np.uint8),
                        callfrac=np.stack(cfs).astype(np.float32), s_grid=PF_S, bf_grid=PF_BF)
    print(f"pf9_{deck} built in {time.time() - t0:.0f}s")


# ------------------------------------------------------------------------------- postflop
N_COLS = 8
K_VIL = 8


def _post_chunk(args):
    deck, sk, n, seed = args
    spec = deck_spec(deck)
    ev = get_evaluator(spec)
    scr = Scorer(spec)
    _, ncomb, pct = load_eq(deck)
    rng = np.random.default_rng(seed)
    nboard = 3 + sk
    dk = np.array(spec.deck)
    D = len(dk)
    sums = np.zeros((N_KEYS, N_COLS))
    cnts = np.zeros((N_KEYS, N_COLS))
    B = 2000
    for s in range(0, n, B):
        b = min(B, n - s)
        perm = np.argsort(rng.random((b, D)), axis=1)
        cards = dk[perm[:, :2 + 5 + 2 * K_VIL]]
        hero = cards[:, :2]
        board = cards[:, 2:2 + nboard]
        runout = cards[:, 2 + nboard:7]
        vil = cards[:, 7:7 + 2 * K_VIL].reshape(b, K_VIL, 2)
        full_board = np.concatenate([board, runout], axis=1)
        sh = ev.eval_any(np.concatenate([hero, full_board], axis=1))
        vb = np.repeat(full_board[:, None, :], K_VIL, axis=1).reshape(b * K_VIL, 5)
        sv = ev.eval_any(np.concatenate([vil.reshape(b * K_VIL, 2), vb], axis=1)).reshape(b, K_VIL)
        out = (sh[:, None] > sv) + 0.5 * (sh[:, None] == sv)
        r1 = vil[:, :, 0] >> 2
        r2 = vil[:, :, 1] >> 2
        hi = np.maximum(r1, r2)
        lo = np.minimum(r1, r2)
        suited = (vil[:, :, 0] & 3) == (vil[:, :, 1] & 3)
        vcls = np.where(r1 == r2, r1 * 13 + r1, np.where(suited, hi * 13 + lo, lo * 13 + hi))
        vp = pct[vcls]
        for i in range(b):
            bd = [int(x) for x in board[i]]
            k = key_of(sk, *features(int(hero[i, 0]), int(hero[i, 1]), bd, scr, 2 - sk))
            o = out[i]
            p = vp[i]
            sums[k, 0] += o.mean()
            cnts[k, 0] += 1
            top50 = []
            for j in range(K_VIL):
                pj = p[j]
                if pj <= 0.5:
                    top50.append(j)
                    sums[k, 1] += o[j]
                    cnts[k, 1] += 1
                    if pj <= 0.25:
                        sums[k, 2] += o[j]
                        cnts[k, 2] += 1
                        if pj <= 0.12:
                            sums[k, 3] += o[j]
                            cnts[k, 3] += 1
                    m, d, *_ = features(int(vil[i, j, 0]), int(vil[i, j, 1]), bd, scr, 2 - sk)
                    if m >= LOWPAIR or d >= 2 or (m == AIR2 and sk == 0):
                        sums[k, 4] += o[j]
                        cnts[k, 4] += 1
                    if m >= TPGOOD or (d >= 3 and sk < 2):
                        sums[k, 5] += o[j]
                        cnts[k, 5] += 1
                    if m >= TWOPAIR or (d >= 4 and sk == 0):
                        sums[k, 6] += o[j]
                        cnts[k, 6] += 1
            if len(top50) >= 2:
                a, c = top50[0], top50[1]
                both = 1.0 if (o[a] == 1.0 and o[c] == 1.0) else (0.5 if min(o[a], o[c]) >= 0.5 else 0.0)
                sums[k, 7] += both
                cnts[k, 7] += 1
    return sums, cnts


def build_post(deck="std", per_street=1_200_000, workers=2, seed=191):
    t0 = time.time()
    sums = np.zeros((N_KEYS, N_COLS))
    cnts = np.zeros((N_KEYS, N_COLS))
    jobs = []
    per = per_street // (workers * 4)
    for sk in range(3):
        for i in range(workers * 4):
            jobs.append((deck, sk, per, seed + 100 * sk + i))
    with mp.Pool(workers) as pool:
        for s, c in pool.imap_unordered(_post_chunk, jobs):
            sums += s
            cnts += c
    # hierarchical smoothing: key -> (street, made, draw) -> (street, made)
    eq = np.zeros((N_KEYS, N_COLS))
    shape = (3, N_MADE, N_DRAW, 3, 3, 2)
    S6 = sums.reshape(*shape, N_COLS)
    C6 = cnts.reshape(*shape, N_COLS)
    s2 = S6.sum(axis=(2, 3, 4, 5))
    c2 = C6.sum(axis=(2, 3, 4, 5))
    # columns with no data fall back to the random-hand column, shifted by the street average
    p2 = np.where(c2 > 0, s2 / np.maximum(c2, 1), np.nan)
    for col in range(N_COLS):
        bad = np.isnan(p2[:, :, col])
        p2[:, :, col][bad] = np.nan_to_num(p2[:, :, 0][bad], nan=0.5)
    s3 = S6.sum(axis=(3, 4, 5))
    c3 = C6.sum(axis=(3, 4, 5))
    M = 25.0
    p3 = (s3 + M * p2[:, :, None, :]) / (c3 + M)
    p6 = (S6 + M * p3[:, :, :, None, None, None, :]) / (C6 + M)
    eq = p6.reshape(N_KEYS, N_COLS)
    np.savez_compressed(os.path.join(DATA, f"post9_{deck}.npz"), eq=eq.astype(np.float32),
                        n=cnts[:, 0].astype(np.int32))
    print(f"post9_{deck} built in {time.time() - t0:.0f}s ({int(cnts[:, 0].sum())} deals)")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("what", choices=["eq", "pf", "post", "all"])
    ap.add_argument("--deck", default="std", choices=["std", "six"])
    ap.add_argument("--workers", type=int, default=2)
    ap.add_argument("--deals", type=int, default=1_200_000)
    a = ap.parse_args()
    if a.what in ("eq", "all"):
        build_eq(a.deck, workers=a.workers)
    if a.what in ("pf", "all"):
        build_pf(a.deck)
    if a.what in ("post", "all"):
        build_post(a.deck, per_street=a.deals, workers=a.workers)


if __name__ == "__main__":
    main()
