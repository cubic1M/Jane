"""Builds sng/field5/data/pf.npz (run once: python3 -m sng.field5.build_tables).

1. eq[a, b]: heads-up all-in equity of hand class a against class b (169 classes),
   Monte Carlo with card removal between the two hands.
2. A strength ordering of the 169 classes (blend of equity vs random and vs a top range).
3. Push/fold equilibrium (chip EV) for a shover with n_behind players left to act and an
   effective stack of S big blinds: fictitious play between the shove range and each
   caller's call range, at most one caller (the first who calls).

Class index: pair hi*13+hi, suited hi*13+lo, offsuit lo*13+hi (hi > lo, rank 0 = '2').
"""
from __future__ import annotations

import os
import sys
import time

import numpy as np

from engine.evaluator import get_evaluator
from sng.rules import SngRules

OUT = os.path.join(os.path.dirname(__file__), "data", "pf.npz")
MAX_S = 30          # stacks 1..MAX_S big blinds
MAX_BEHIND = 7


def class_of(c1: int, c2: int) -> int:
    r1, r2 = c1 >> 2, c2 >> 2
    hi, lo = max(r1, r2), min(r1, r2)
    if hi == lo:
        return hi * 13 + hi
    if (c1 & 3) == (c2 & 3):
        return hi * 13 + lo
    return lo * 13 + hi


def combos_by_class():
    out = [[] for _ in range(169)]
    for a in range(52):
        for b in range(a + 1, 52):
            out[class_of(a, b)].append((a, b))
    return out


def equity_matrix(trials: int, seed: int = 5):
    ev = get_evaluator(SngRules().spec)
    rng = np.random.default_rng(seed)
    cb = combos_by_class()
    ncomb = np.array([len(c) for c in cb])
    tab = np.zeros((169, 12, 2), np.int64)
    for k, c in enumerate(cb):
        tab[k, :len(c)] = c
    pairs = [(a, b) for a in range(169) for b in range(a, 169)]
    wins = np.zeros((169, 169))
    chunk = max(1, 200_000 // trials)
    t0 = time.time()
    for s in range(0, len(pairs), chunk):
        pp = np.array(pairs[s:s + chunk])
        A = np.repeat(pp[:, 0], trials)
        B = np.repeat(pp[:, 1], trials)
        n = len(A)
        ha = tab[A, (rng.random(n) * ncomb[A]).astype(int)]
        hb = tab[B, (rng.random(n) * ncomb[B]).astype(int)]
        for _ in range(200):
            bad = ((ha[:, :, None] == hb[:, None, :]).any(axis=(1, 2)))
            if not bad.any():
                break
            idx = np.nonzero(bad)[0]
            hb[idx] = tab[B[idx], (rng.random(len(idx)) * ncomb[B[idx]]).astype(int)]
        keys = rng.random((n, 52))
        rows = np.arange(n)[:, None]
        keys[rows, ha] = 9.0
        keys[rows, hb] = 9.0
        board = np.argpartition(keys, 5, axis=1)[:, :5]
        sa = ev.eval_any(np.concatenate([ha, board], axis=1))
        sb = ev.eval_any(np.concatenate([hb, board], axis=1))
        res = (sa > sb) + 0.5 * (sa == sb)
        res = res.reshape(len(pp), trials).mean(axis=1)
        for (a, b), r in zip(pp, res):
            wins[a, b] = r
            wins[b, a] = 1.0 - r
        if s % (chunk * 20) == 0:
            print(f"  {s}/{len(pairs)} {time.time() - t0:.0f}s", flush=True)
    for a in range(169):
        wins[a, a] = 0.5
    return wins, ncomb


def solve_push(eq, w, n_behind: int, S: float, iters: int = 300):
    """Chip-EV push/fold with n_behind callers, effective stack S (bb), blinds .5/1.
    Returns push prob per class, call probs per caller (list), P(all fold), eq when called."""
    p0 = 0.5 if n_behind == 1 else 0.0
    posts = [0.0] * n_behind
    posts[-1] = 1.0
    if n_behind >= 2:
        posts[-2] = 0.5
    W = w / w.sum()
    push = np.ones(169)
    calls = [np.ones(169) * 0.3 for _ in range(n_behind)]
    for it in range(1, iters + 1):
        lr = 1.0 / (it + 1)
        # callers respond to the push range
        rw = push * W
        tot = rw.sum()
        eq_vs_push = eq @ rw / max(tot, 1e-12)
        new_calls = []
        for i in range(n_behind):
            pot = 2 * S + (1.5 - p0 - posts[i])
            ev_call = eq_vs_push * pot
            ev_fold = S - posts[i]
            new_calls.append((ev_call > ev_fold).astype(float))
        calls = [c + lr * (nc - c) for c, nc in zip(calls, new_calls)]
        # pusher responds to the call ranges
        surv = 1.0
        ev_push = np.zeros(169)
        pfold = 1.0
        for i in range(n_behind):
            cw = calls[i] * W
            q = cw.sum()
            if q > 1e-12:
                e = eq @ cw / q
                pot = 2 * S + (1.5 - p0 - posts[i])
                ev_push += surv * q * (e * pot)
            surv *= (1 - q)
        ev_push += surv * (S + 1.5 - p0)
        ev_fold = S - p0
        push = push + lr * ((ev_push > ev_fold).astype(float) - push)
    # summary for runtime: P(all fold) and equity when called (weighted over callers)
    surv = 1.0
    eqc = np.zeros(169)
    pc = 0.0
    for i in range(n_behind):
        cw = calls[i] * W
        q = cw.sum()
        if q > 1e-12:
            eqc += surv * q * (eq @ cw / q)
            pc += surv * q
        surv *= (1 - q)
    eqc = eqc / max(pc, 1e-12)
    rw = push * W
    eq_vs_push = eq @ rw / max(rw.sum(), 1e-12)
    return push, calls, surv, eqc, eq_vs_push


def main():
    trials = int(sys.argv[1]) if len(sys.argv) > 1 else 800
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    print("equity matrix", flush=True)
    eq, ncomb = equity_matrix(trials)
    w = ncomb.astype(float)
    W = w / w.sum()
    eq_rand = eq @ W
    # equity vs a top-20% range (by eq_rand) to balance pairs/suited vs offsuit aces
    order0 = np.argsort(-eq_rand)
    top = np.zeros(169)
    cum = np.cumsum(W[order0])
    top[order0[cum <= 0.2]] = 1
    eq_top = eq @ (top * W) / (top * W).sum()
    score = 0.5 * eq_rand + 0.5 * eq_top
    for k in range(169):          # playability bonus for suited and connected hands
        hi, lo = max(k // 13, k % 13), min(k // 13, k % 13)
        suited = k // 13 > k % 13
        if hi != lo:
            gap = hi - lo
            score[k] += (0.02 if suited else 0) + (0.012 if gap == 1 else 0.006 if gap == 2 else 0)
    order = np.argsort(-score)
    pct = np.zeros(169)      # top-x fraction of combos at which the class enters
    cum = 0.0
    for k in order:
        cum += W[k]
        pct[k] = cum
    print("push/fold", flush=True)
    push = np.zeros((MAX_BEHIND + 1, MAX_S + 1, 169))
    pfold = np.zeros((MAX_BEHIND + 1, MAX_S + 1))
    eqc = np.zeros((MAX_BEHIND + 1, MAX_S + 1, 169))
    eqvs = np.zeros((MAX_BEHIND + 1, MAX_S + 1, 169))
    for nb in range(1, MAX_BEHIND + 1):
        for S in range(1, MAX_S + 1):
            p, c, pf, e, ev = solve_push(eq, w, nb, float(S))
            push[nb, S], pfold[nb, S], eqc[nb, S], eqvs[nb, S] = p, pf, e, ev
        print(f"  nb={nb} push% at 10bb={float((push[nb, 10] * W).sum()):.3f}", flush=True)
    np.savez_compressed(OUT, eq=eq.astype(np.float32), ncomb=ncomb, eq_rand=eq_rand, pct=pct,
                        push=push.astype(np.float32), pfold=pfold, eqc=eqc.astype(np.float32),
                        eqvs=eqvs.astype(np.float32))
    print("wrote", OUT)


if __name__ == "__main__":
    main()
