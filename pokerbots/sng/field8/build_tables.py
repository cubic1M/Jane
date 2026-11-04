"""Offline builder for sng/field8/data (run once; never imported by act()).

    python3 -m sng.field8.build_tables eq        # data/eq8.npz   (~1-2 min, 4 processes)
    python3 -m sng.field8.build_tables pushfold  # data/pf8.npz   (needs eq8)
    python3 -m sng.field8.build_tables solver    # data/pre8.npz  (needs eq8)
    python3 -m sng.field8.build_tables post      # data/post8.npz (needs eq8; ~5 min)
    python3 -m sng.field8.build_tables all

eq8:  EQ[a, b] heads-up all-in equity of class a vs class b (Monte Carlo, the engine's numpy
      evaluator), NCOMB, a strength ranking PCT (fraction of combos at least as strong) and
      EQT[k, h] = equity of h against the top (k+1)% of hands.
pf8:  ICM-aware push/fold equilibria (see pushfold()).
pre8: a simplified preflop equilibrium for deeper stacks (see solver()).
post8: calibrated postflop equities per hands.post_key (see post()).
"""
from __future__ import annotations

import multiprocessing as mp
import os
import sys
import time

import numpy as np

from engine.evaluator import get_evaluator
from sng.field8.hands import N_KEYS, hclass, key_of, made_and_draw
from sng.rules import NLHE

DATA = os.path.join(os.path.dirname(__file__), "data")


def _combos():
    combos = [[] for _ in range(169)]
    for a in range(52):
        for b in range(a + 1, 52):
            combos[hclass(a, b)].append((a, b))
    return combos


# ------------------------------------------------------------------------------ equity
def _eq_chunk(args):
    pairs, trials, seed = args
    ev = get_evaluator(NLHE)
    rng = np.random.default_rng(seed)
    combos = _combos()
    ncomb = np.array([len(c) for c in combos])
    tab = np.zeros((169, 12, 2), np.int64)
    for k, c in enumerate(combos):
        tab[k, :len(c)] = c
    win = np.zeros((169, 169))
    cnt = np.zeros((169, 169))
    for s in range(0, len(pairs), 200):
        pp = pairs[s:s + 200]
        A = np.repeat(pp[:, 0], trials)
        B = np.repeat(pp[:, 1], trials)
        ha = tab[A, rng.integers(0, 1 << 30, len(A)) % ncomb[A]]
        hb = tab[B, rng.integers(0, 1 << 30, len(B)) % ncomb[B]]
        ok = (ha[:, :, None] != hb[:, None, :]).all(axis=(1, 2))
        A, B, ha, hb = A[ok], B[ok], ha[ok], hb[ok]
        keys = rng.random((len(A), 52))
        rows = np.arange(len(A))[:, None]
        keys[rows, ha] = 2.0
        keys[rows, hb] = 2.0
        board = np.argpartition(keys, 5, axis=1)[:, :5]
        sa = ev.eval_any(np.concatenate([ha, board], axis=1))
        sb = ev.eval_any(np.concatenate([hb, board], axis=1))
        res = (sa > sb) + 0.5 * (sa == sb)
        np.add.at(win, (A, B), res)
        np.add.at(cnt, (A, B), 1)
    return win, cnt


def build_eq(trials=2500, seed=81, workers=4):
    pairs = np.array([(a, b) for a in range(169) for b in range(a, 169)])
    chunks = np.array_split(pairs, workers * 8)
    t0 = time.time()
    with mp.Pool(workers) as pool:
        parts = pool.map(_eq_chunk, [(c, trials, seed + i) for i, c in enumerate(chunks)])
    win = sum(p[0] for p in parts)
    cnt = sum(p[1] for p in parts)
    eq = np.where(cnt > 0, win / np.maximum(cnt, 1), 0.5)
    # symmetric completion
    full = np.zeros((169, 169))
    for a in range(169):
        for b in range(a, 169):
            if a == b:
                full[a, b] = 0.5
            else:
                full[a, b] = eq[a, b]
                full[b, a] = 1.0 - eq[a, b]
    ncomb = np.array([len(c) for c in _combos()], float)
    w = ncomb / ncomb.sum()
    eq_rand = full @ w

    def pct_of(score):
        order = np.argsort(-score, kind="stable")
        pct = np.zeros(169)
        pct[order] = np.cumsum(w[order])
        return pct, order

    # ranking: equity against a strong-ish continuing range, iterated to a fixed point
    sc = eq_rand.copy()
    for _ in range(6):
        pct, _ = pct_of(sc)
        strong = (pct <= 0.25) * w
        sc = 0.5 * eq_rand + 0.5 * (full @ strong) / strong.sum()
    pct, order = pct_of(sc)
    eqt = np.zeros((100, 169))
    for k in range(100):
        m = ((pct <= 0.01 * (k + 1) + 1e-9) | (np.arange(169) == order[0])) * w
        eqt[k] = full @ m / m.sum()
    os.makedirs(DATA, exist_ok=True)
    np.savez_compressed(os.path.join(DATA, "eq8.npz"), eq=full.astype(np.float32), ncomb=ncomb.astype(np.int16),
                        pct=pct, order=order.astype(np.int16), eqt=eqt.astype(np.float32), eq_rand=eq_rand)
    print(f"eq8 built in {time.time() - t0:.0f}s")


def load_eq():
    d = np.load(os.path.join(DATA, "eq8.npz"))
    return d["eq"].astype(float), d["ncomb"].astype(float), d["pct"], d["order"], d["eqt"].astype(float)


# --------------------------------------------------------------------------- push/fold
PF_S = np.round(np.arange(1.0, 20.01, 0.5), 2)          # effective stack in big blinds
PF_BF = np.array([1.0, 1.15, 1.3, 1.5, 1.75, 2.1, 2.6])  # ICM bubble factors (risk premium)


def _pf_solve(nb, eq, w, iters=700):
    """Push-or-fold game, first in with nb players behind, all stacks S (bb), blinds 0.5/1.
    Utility of a chip change x is x when x > 0 and BF * x when x < 0 (the linearised ICM
    risk premium: losing a chip costs BF times what winning one gains). The pusher has BF_p,
    every caller BF_c. Solved for all (S, BF_p, BF_c) at once by fictitious play.
    Callers act in order; the first caller plays the pusher heads-up (overcalls ignored).
    Returns push[G,169], callfrac[G,nb], eqpush[G,169] (each hand's equity vs the push range)."""
    S = PF_S[:, None, None]
    BFp = PF_BF[None, :, None]
    BFc = PF_BF[None, None, :]
    shape = (len(PF_S), len(PF_BF), len(PF_BF))
    S, BFp, BFc = (np.broadcast_to(x, shape).reshape(-1, 1) for x in (S, BFp, BFc))
    G = S.shape[0]
    posted = np.zeros(nb)
    pp = 0.0
    if nb >= 2:
        posted[nb - 2], posted[nb - 1] = 0.5, 1.0
    else:
        pp, posted[0] = 0.5, 1.0
    dead = 1.5 - pp - posted                         # dead money when caller k is the one in
    push = np.full((G, 169), 0.5)
    call = np.full((nb, G, 169), 0.3)
    for t in range(iters):
        step = 1.0 / (t + 2) if t > 20 else 0.3
        # callers' best responses to the push range
        pr = push * w
        eqp = (pr @ eq.T) / pr.sum(axis=1, keepdims=True)          # [G,169] my equity vs push range
        for k in range(nb):
            u_call = eqp * (S + dead[k]) - (1 - eqp) * BFc * S
            u_fold = -BFc * posted[k]
            br = (u_call > u_fold).astype(float)
            call[k] += step * (br - call[k])
        # pusher's best response
        u = np.zeros((G, 169))
        reach = np.ones((G, 1))
        for k in range(nb):
            cr = call[k] * w                                        # [G,169]
            c = cr.sum(axis=1, keepdims=True)
            eqc = cr @ eq.T                                         # [G,169] = sum_j eq*cr (unnormalised)
            u += reach * ((S + dead[k]) * eqc - BFp * S * (c - eqc))
            reach = reach * (1 - c)
        u += reach * (1.5 - pp)
        br = (u > -BFp * pp).astype(float)
        push += step * (br - push)
    pr = push * w
    eqp = (pr @ eq.T) / pr.sum(axis=1, keepdims=True)
    cf = np.stack([(call[k] * w).sum(axis=1) for k in range(nb)], axis=1)
    return push, cf, eqp


def pushfold():
    eq, ncomb, pct, order, eqt = load_eq()
    w = ncomb / ncomb.sum()
    t0 = time.time()
    shape = (len(PF_S), len(PF_BF), len(PF_BF))
    P = np.zeros((8,) + shape + (169,), np.float32)
    E = np.zeros((8,) + shape + (169,), np.float32)
    CF = np.zeros((8,) + shape + (7,), np.float32)
    for nb in range(1, 8):
        push, cf, eqp = _pf_solve(nb, eq, w)
        P[nb] = push.reshape(shape + (169,))
        E[nb] = eqp.reshape(shape + (169,))
        CF[nb, ..., :nb] = cf.reshape(shape + (nb,))
        si = list(PF_S).index(10.0)
        print(f"nb={nb}: push@10bb chipEV {np.sum(push.reshape(shape + (169,))[si, 0, 0] * w):.3f}"
              f" BF2.1 {np.sum(push.reshape(shape + (169,))[si, 5, 5] * w):.3f};"
              f" callers {np.round(cf.reshape(shape + (nb,))[si, 0, 0], 3)} ({time.time() - t0:.0f}s)", flush=True)
    P[0] = P[1]          # heads-up: the button is the small blind with one player behind
    E[0] = E[1]
    CF[0] = CF[1]
    # probabilities and equities as uint8 (1/255 resolution) keep the file small
    np.savez_compressed(os.path.join(DATA, "pf8.npz"), push=np.rint(P * 255).astype(np.uint8),
                        eqpush=np.rint(E * 255).astype(np.uint8),
                        callfrac=CF, s_grid=PF_S, bf_grid=PF_BF)
    print(f"pf8 built in {time.time() - t0:.0f}s")


# ------------------------------------------------------------------------ preflop solver
SV_S = np.array([12, 16, 20, 25, 30, 40, 55, 75, 100], float)
SV_NB = 8          # nb 0 = heads-up button vs BB (BB out of position), 1 = SB vs BB (BB in position)


def _realization(S):
    """R[pos][169]: share of the pot a hand realises postflop relative to its raw equity
    (pos 1 = in position). Suited / connected / pairs (set value grows with depth) realise
    more; offsuit gappers less."""
    R = np.zeros((2, 169))
    for h in range(169):
        a, b = divmod(h, 13)
        if a == b:
            hi = lo = a
            kind = 0
        elif a > b:
            hi, lo, kind = a, b, 1
        else:
            hi, lo, kind = b, a, 2
        bonus = 0.0
        if kind == 1:
            bonus += 0.05
        if kind != 0:
            gap = hi - lo
            bonus += 0.03 if gap == 1 else 0.015 if gap == 2 else 0.0
            if kind == 2 and gap >= 4 and hi < 10:
                bonus -= 0.07
            if lo >= 8:
                bonus += 0.02
        else:
            bonus += 0.07 * min(1.0, S / 60.0) * (1 - hi / 12.0)
        R[1, h] = 0.97 + bonus
        R[0, h] = 0.80 + bonus
    return R


def _sv_solve(nb, S, eq, nc, iters=3000, init=None, pct=None):
    """Simplified preflop game at stack S (bb): the opener (nb players behind; nb 0 = heads-up)
    raises to o or folds; the first player behind who does not fold calls or 3-bets to t (all-in
    when t is over a third of the stack); the opener folds, calls or 4-bets all-in; the 3-bettor
    calls or folds the 4-bet. Calls go to a flop worth pot * equity * realisation (by position
    and hand). Later players after a call or a 3-bet fold (no squeezes or overcalls). Chip EV.
    Fictitious play with averaged strategies; all strategies are per hand class."""
    nr = max(1, nb)
    pO = 0.5 if nb <= 1 else 0.0
    posted = np.zeros(nr)
    if nb <= 1:
        posted[0] = 1.0
    else:
        posted[nr - 2], posted[nr - 1] = 0.5, 1.0
    o = 2.75 if nb <= 1 else (2.2 if S <= 25 else 2.4)
    if nb == 0 and S > 25:
        o = 2.5
    ip_r = np.ones(nr, bool)                   # responder in position vs the opener?
    if nb == 0:
        ip_r[0] = False
    elif nb == 1:
        ip_r[0] = True
    else:
        ip_r[nr - 2:] = False
    t = np.array([o * (3.0 if ip_r[k] else 3.8) for k in range(nr)])
    if nb == 0:
        t[:] = o * 3.4
    jam3 = t > S / 3.0
    t = np.where(jam3, S, t)
    if o >= S * 0.45:
        o = S                                     # open-jam territory
        jam3[:] = True
        t[:] = S
    dead = 1.5 - pO - posted
    R = _realization(S)
    w = nc / nc.sum()

    def eqv(rng):                                  # equity of each class vs range weights
        s = rng.sum()
        return eq @ rng / s if s > 1e-12 else np.full(169, 0.5)

    def r3(Rv):                                    # realisation in a 3-bet pot (lower SPR)
        return 0.5 * (Rv + 1.0)

    if init is not None:
        open_, rc, rb, r4c, oc, o4 = (init[k].copy() for k in ("open", "rc", "rb", "r4c", "oc", "o4"))
        t0 = 60
    else:
        top = (lambda x: (pct <= x).astype(float)) if pct is not None else (lambda x: np.full(169, x))
        open_ = top(0.15 + 0.05 * (7 - nb))
        rc = np.stack([top(0.12) - top(0.04)] * nr)
        rb = np.stack([top(0.04)] * nr)
        r4c = np.stack([top(0.03)] * nr)
        oc = np.stack([top(0.08) - top(0.025)] * nr)
        o4 = np.stack([top(0.025)] * nr)
        t0 = 20
    allin = 2 * S
    for it in range(iters):
        step = 1.0 / (it + t0)
        ro = open_ * nc
        # --- opener facing each responder's 3-bet
        cont = np.zeros((nr, 169))                # opener's best value when k 3-bets
        for k in range(nr):
            r3rng = rb[k] * nc
            e3 = eqv(r3rng)
            v_fold = np.full(169, -o)
            Rop = R[0] if ip_r[k] else R[1]
            if jam3[k]:
                v_call = e3 * (allin + dead[k]) - S
                v_4 = np.full(169, -1e9)
            else:
                v_call = r3(Rop) * e3 * (2 * t[k] + dead[k]) - t[k]
                cr = r4c[k] * r3rng
                q = cr.sum() / max(r3rng.sum(), 1e-12)
                e4 = eqv(cr)
                v_4 = (1 - q) * (t[k] + dead[k]) + q * (e4 * (allin + dead[k]) - S)
            V = np.stack([v_fold, v_call, v_4])
            best = V.argmax(axis=0)
            cont[k] = V.max(axis=0)
            oc[k] += step * ((best == 1) - oc[k])
            o4[k] += step * ((best == 2) - o4[k])
        # --- responders
        eo = eqv(ro)
        for k in range(nr):
            Rr = R[1] if ip_r[k] else R[0]
            v_fold = -posted[k]
            if o >= S:                              # facing an open jam: call or fold
                v_call = eo * (allin + dead[k]) - S
                v_3 = np.full(169, -1e9)
            else:
                v_call = Rr * eo * (2 * o + dead[k]) - o
                F = ((1 - oc[k] - o4[k]) * ro).sum() / ro.sum()
                cm = oc[k] * ro
                Cm = cm.sum() / ro.sum()
                if jam3[k]:
                    if Cm > 0:
                        v_3 = F * (o + dead[k]) + Cm * (eqv(cm) * (allin + dead[k]) - S)
                    else:
                        v_3 = np.full(169, F * (o + dead[k]))
                else:
                    qm = o4[k] * ro
                    Q = qm.sum() / ro.sum()
                    v_3 = np.full(169, F * (o + dead[k]))
                    if Cm > 0:
                        v_3 = v_3 + Cm * (r3(Rr) * eqv(cm) * (2 * t[k] + dead[k]) - t[k])
                    if Q > 0:
                        e4 = eqv(qm)
                        c4 = e4 * (allin + dead[k]) - S
                        r4c[k] += step * ((c4 > -t[k]) - r4c[k])
                        v_3 = v_3 + Q * np.maximum(c4, -t[k])
            V = np.stack([np.full(169, v_fold) if np.isscalar(v_fold) else v_fold, v_call, v_3])
            best = V.argmax(axis=0)
            rc[k] += step * ((best == 1) - rc[k])
            rb[k] += step * ((best == 2) - rb[k])
        # --- opener's open decision
        u = np.zeros(169)
        reach = 1.0
        for k in range(nr):
            f = ((1 - rc[k] - rb[k]) * nc).sum() / nc.sum()
            c = (rc[k] * nc).sum() / nc.sum()
            b = (rb[k] * nc).sum() / nc.sum()
            Rop = R[0] if ip_r[k] else R[1]
            if o >= S:
                ec = eqv(rc[k] * nc)
                u += reach * c * (ec * (allin + dead[k]) - S)
            else:
                ec = eqv(rc[k] * nc)
                u += reach * (c * (Rop * ec * (2 * o + dead[k]) - o) + b * cont[k])
            reach *= f
        u += reach * (1.5 - pO)
        open_ += step * ((u > -pO) - open_)
    return dict(open=open_, rc=rc, rb=rb, r4c=r4c, oc=oc, o4=o4, o=o, t=t)


def solver():
    eq, ncomb, pct, order, eqt = load_eq()
    t0 = time.time()
    nS = len(SV_S)
    OPEN = np.zeros((SV_NB, nS, 169), np.float32)
    TAB = {k: np.zeros((SV_NB, nS, 7, 169), np.float32) for k in ("rc", "rb", "r4c", "oc", "o4")}
    OSZ = np.zeros((SV_NB, nS), np.float32)
    TSZ = np.zeros((SV_NB, nS, 7), np.float32)
    w = ncomb / ncomb.sum()
    for nb in range(SV_NB):
        prev = None
        for si in range(len(SV_S) - 1, -1, -1):
            S = SV_S[si]
            r = _sv_solve(nb, S, eq, ncomb, init=prev, pct=pct)
            prev = r
            OPEN[nb, si] = r["open"]
            for k in TAB:
                TAB[k][nb, si, :r[k].shape[0]] = r[k]
            OSZ[nb, si] = r["o"]
            TSZ[nb, si, :len(r["t"])] = r["t"]
            rb = [float((r['rb'][k] * w).sum()) for k in range(r['rb'].shape[0])]
            rc = [float((r['rc'][k] * w).sum()) for k in range(r['rc'].shape[0])]
            print(f"nb={nb} S={S:.0f}: open {np.sum(r['open'] * w):.3f}  3bet {np.round(rb, 3)}"
                  f" call {np.round(rc, 3)} ({time.time() - t0:.0f}s)", flush=True)
    np.savez_compressed(os.path.join(DATA, "pre8.npz"), open=OPEN.astype(np.float16),
                        **{k: v.astype(np.float16) for k, v in TAB.items()}, osz=OSZ, tsz=TSZ, s_grid=SV_S)
    print(f"pre8 built in {time.time() - t0:.0f}s")


# ------------------------------------------------------------------------------ postflop
# columns of the postflop equity table: what the opponent holds
POST_COLS = ("random", "top45", "top20", "continue", "bettor", "strong", "two_top45")


def _cond(col, made, draw):
    if col == 3:
        return made >= 3 or draw >= 1
    if col == 4:
        return made >= 6 or draw >= 2
    if col == 5:
        return made >= 8 or draw >= 5
    return True


def _post_chunk(args):
    n, seed, pct = args
    import random as _r
    rng = _r.Random(seed)
    combos = [(a, b) for a in range(52) for b in range(a + 1, 52)]
    top = {x: [c for c in combos if pct[hclass(*c)] <= x + 1e-9] for x in (0.20, 0.30, 0.45, 0.50)}
    col_range = {0: combos, 1: top[0.45], 2: top[0.20], 3: top[0.50], 4: top[0.45], 5: top[0.30]}
    keys = np.zeros(n, np.int32)
    hero = np.zeros((n, 2), np.int64)
    boards = np.zeros((n, 5), np.int64)
    opp = np.zeros((n, 8, 2), np.int64)          # 7 columns + the second opponent of column 6
    ok = np.zeros((n, 7), bool)
    for i in range(n):
        street = rng.choices((1, 2, 3), (0.4, 0.3, 0.3))[0]
        nb = 3 if street == 1 else 4 if street == 2 else 5
        while True:
            h = rng.choice(top[0.50]) if rng.random() < 0.6 else rng.choice(combos)
            deck = [c for c in range(52) if c != h[0] and c != h[1]]
            bd = rng.sample(deck, nb)
            break
        made, draw, ftex, stex, paired = made_and_draw(h[0], h[1], bd)
        keys[i] = key_of(street, made, draw, ftex, stex, paired)
        used = set(h) | set(bd)
        oc = []
        for col in range(7):
            src = col_range[1] if col == 6 else col_range[col]
            got = None
            for _ in range(40):
                o = rng.choice(src)
                if o[0] in used or o[1] in used:
                    continue
                if col in (3, 4, 5):
                    m2, d2, *_ = made_and_draw(o[0], o[1], bd)
                    if not _cond(col, m2, d2):
                        continue
                got = o
                break
            if got is None:
                oc.append((0, 1))
                continue
            ok[i, col] = True
            oc.append(got)
        # second opponent for column 6 (avoid the first)
        got = (0, 1)
        if ok[i, 6]:
            u2 = used | set(oc[6])
            for _ in range(40):
                o = rng.choice(col_range[1])
                if o[0] not in u2 and o[1] not in u2:
                    got = o
                    break
            else:
                ok[i, 6] = False
        oc.append(got)
        opp[i] = oc
        hero[i] = h
        # runout: board completion avoiding every card of every column's opponent is not
        # possible for all at once; complete per column below in numpy instead
        boards[i, :nb] = bd
        boards[i, nb:] = -1
    # complete the boards per column with cards not used by the hero, the board or that
    # column's opponent(s)
    ev = get_evaluator(NLHE)
    nrng = np.random.default_rng(seed + 1)
    res = np.zeros((n, 7))
    for col in range(7):
        keys52 = nrng.random((n, 52))
        rows = np.arange(n)[:, None]
        keys52[rows, hero] = 9
        keys52[rows, opp[:, col]] = 9
        if col == 6:
            keys52[rows, opp[:, 7]] = 9
        bmask = boards >= 0
        for p_ in range(5):
            m_ = bmask[:, p_]
            keys52[np.nonzero(m_)[0], boards[m_, p_]] = 9
        fill = np.argsort(keys52, axis=1)[:, :5]
        cnt_known = bmask.sum(axis=1)
        # build the full 5-card boards
        fb = np.zeros((n, 5), np.int64)
        for i in range(n):
            k = cnt_known[i]
            fb[i, :k] = boards[i, :k]
            fb[i, k:] = fill[i, :5 - k]
        sh = ev.eval_any(np.concatenate([hero, fb], axis=1))
        so = ev.eval_any(np.concatenate([opp[:, col], fb], axis=1))
        if col == 6:
            so2 = ev.eval_any(np.concatenate([opp[:, 7], fb], axis=1))
            best = np.maximum(so, so2)
            ties = 1 + (so == sh) + (so2 == sh)
            r = np.where(sh > best, 1.0, np.where(sh == best, 1.0 / ties, 0.0))
        else:
            r = (sh > so) + 0.5 * (sh == so)
        res[:, col] = r
    return keys, res, ok


def post(n_total=1_600_000, workers=4, seed=880):
    eq, ncomb, pct, order, eqt = load_eq()
    t0 = time.time()
    per = 20000
    jobs = [(per, seed + i, pct) for i in range(n_total // per)]
    S = np.zeros((N_KEYS, 7))
    C = np.zeros((N_KEYS, 7))
    with mp.Pool(workers) as pool:
        for j, (keys, res, ok) in enumerate(pool.imap_unordered(_post_chunk, jobs)):
            for col in range(7):
                m = ok[:, col]
                np.add.at(S[:, col], keys[m], res[m, col])
                np.add.at(C[:, col], keys[m], 1)
            if j % 10 == 0:
                print(f"{(j + 1) * per} samples ({time.time() - t0:.0f}s)", flush=True)
    # hierarchical shrinkage: full key -> drop straightness -> drop texture -> (street, made)
    from sng.field8.hands import N_DRAW, N_MADE
    idx = np.arange(N_KEYS)
    paired = idx % 2
    stex = (idx // 2) % 3
    ftex = (idx // 6) % 3
    draw = (idx // 18) % N_DRAW
    made = (idx // (18 * N_DRAW)) % N_MADE
    street = idx // (18 * N_DRAW * N_MADE)
    levels = [street * 100 + made,
              (street * 100 + made) * 10 + draw,
              ((street * 100 + made) * 10 + draw) * 10 + ftex * 2 + paired]
    est = None
    k = 25.0
    for lv in levels:
        uniq, inv = np.unique(lv, return_inverse=True)
        s = np.zeros((len(uniq), 7))
        c = np.zeros((len(uniq), 7))
        np.add.at(s, inv, S)
        np.add.at(c, inv, C)
        if est is None:
            # coarsest level: fall back to a street-wide average where empty
            glob = S.sum(axis=0) / np.maximum(C.sum(axis=0), 1)
            m = (s + k * glob) / (c + k)
        else:
            prior = np.zeros((len(uniq), 7))
            np.add.at(prior, inv, est)
            cntp = np.bincount(inv, minlength=len(uniq))[:, None]
            prior /= cntp
            m = (s + k * prior) / (c + k)
        est = m[inv]
    final = (S + k * est) / (C + k)
    np.savez_compressed(os.path.join(DATA, "post8.npz"), eq=final.astype(np.float32), n=C[:, 0].astype(np.int32),
                        cols=np.array(POST_COLS))
    print(f"post8 built in {time.time() - t0:.0f}s; keys with >= 50 samples: {(C[:, 0] >= 50).sum()}")


if __name__ == "__main__":
    what = sys.argv[1] if len(sys.argv) > 1 else "all"
    if what in ("eq", "all"):
        build_eq()
    if what in ("pushfold", "all"):
        from sng.field8.build_tables import pushfold
        pushfold()
    if what in ("solver", "all"):
        from sng.field8.build_tables import solver
        solver()
    if what in ("post", "all"):
        from sng.field8.build_tables import post
        post()
