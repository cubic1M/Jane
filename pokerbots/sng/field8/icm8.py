"""Fast Malmuth-Harville ICM for many stack configurations at once, and the per-opponent
all-in endpoints the bots use (computed in end_hand, never inside act()).

icm_batch(stacks[C, n], pays) -> ev[C, n]: subset dynamic programme over who has taken the
top places, vectorised across the C configurations. A zero stack has busted in this hand
and gets the last place still paid (the busted share it when several bust together).
"""
from __future__ import annotations

import numpy as np

_PLAN: dict = {}


def _plan(n):
    """Per popcount level: the masks, their member matrix, and for each player j the masks
    without j and the index of mask | j in the next level."""
    pl = _PLAN.get(n)
    if pl is None:
        levels = [[m for m in range(1 << n) if bin(m).count("1") == L] for L in range(n + 1)]
        pos = [{m: i for i, m in enumerate(lv)} for lv in levels]
        pl = []
        for L in range(n):
            lv = levels[L]
            bits = np.array([[(m >> j) & 1 for m in lv] for j in range(n)], np.int64)   # [n, m]
            sel, tgt = [], []
            for j in range(n):
                idx = [i for i, m in enumerate(lv) if not m >> j & 1]
                sel.append(np.array(idx, np.int64))
                tgt.append(np.array([pos[L + 1][lv[i] | (1 << j)] for i in idx], np.int64))
            pl.append((len(lv), bits, sel, tgt, len(levels[L + 1])))
        _PLAN[n] = pl
    return pl


def icm_batch(stacks, pays):
    st = np.asarray(stacks, dtype=float)
    if st.ndim == 1:
        st = st[None, :]
    C, n = st.shape
    pays = [float(p) for p in pays[:n]] + [0.0] * max(0, n - len(pays))
    ev = np.zeros((C, n))
    if n == 0:
        return ev
    zero = st <= 0
    nz = (~zero).sum(axis=1)
    for c in range(C):
        k = int(nz[c])
        if k < n:
            ev[c, zero[c]] = sum(pays[k:n]) / (n - k)
    last_paid = max((i for i, p in enumerate(pays) if p > 0), default=-1)
    total = st.sum(axis=1, keepdims=True)
    sti = np.rint(st).astype(np.int64)
    prob = np.ones((C, 1))
    for L, (m, bits, sel, tgt, m_next) in enumerate(_plan(n)):
        if L > last_paid:
            break
        # integer matmul: no BLAS threads (their spin-wait slows other processes' decisions)
        rem = total - (sti @ bits).astype(float)      # [C, m]
        inv = np.where(rem > 0, 1.0 / np.where(rem > 0, rem, 1.0), 0.0) * prob
        nxt = np.zeros((C, m_next)) if L < last_paid else None
        pay = pays[L]
        for j in range(n):
            q = inv[:, sel[j]] * st[:, j:j + 1]
            if pay:
                ev[:, j] += q.sum(axis=1) * pay
            if nxt is not None:
                nxt[:, tgt[j]] += q
        if nxt is None:
            break
        prob = nxt
    return ev


class IcmState:
    """ICM endpoints for one seat against each opponent, from the stacks at the start of a
    hand: base value, value after winning / losing an all-in against seat j for the effective
    stack, the opponent's matching values, and the two bubble factors."""

    def __init__(self, n):
        self.n = n
        self.base = 0.0
        self.win = [0.0] * n
        self.lose = [0.0] * n
        self.bf_me = [1.0] * n        # my risk premium against seat j
        self.bf_opp = [1.0] * n       # seat j's risk premium against me
        self.slope = [0.0] * n        # my points per chip around the current stacks vs seat j
        self.total_pts = 1.0
        self.ready = False

    def update(self, stacks, me: int, pays, players_left: int):
        n = self.n
        alive = [j for j in range(n) if stacks[j] > 0]
        if me not in alive or len(alive) < 2:
            self.ready = False
            return
        pays = tuple(pays[:players_left])
        idx = {s: i for i, s in enumerate(alive)}
        k = len(alive)
        rows = [[stacks[s] for s in alive]]
        opp = [s for s in alive if s != me]
        im = idx[me]
        for j in opp:
            eff = min(stacks[me], stacks[j])
            w = list(rows[0])
            w[im] += eff
            w[idx[j]] -= eff
            lo = list(rows[0])
            lo[im] -= eff
            lo[idx[j]] += eff
            rows.append(w)
            rows.append(lo)
        ev = icm_batch(np.array(rows, float), pays)
        self.total_pts = max(1e-9, float(sum(pays)))
        self.base = float(ev[0, im])
        for t, j in enumerate(opp):
            ij = idx[j]
            w, lo = ev[1 + 2 * t], ev[2 + 2 * t]
            eff = min(stacks[me], stacks[j])
            self.win[j] = float(w[im])
            self.lose[j] = float(lo[im])
            gain = self.win[j] - self.base
            loss = self.base - self.lose[j]
            self.bf_me[j] = _ratio(loss, gain)
            g2 = float(lo[ij] - ev[0, ij])          # j's gain when I lose
            l2 = float(ev[0, ij] - w[ij])           # j's loss when I win
            self.bf_opp[j] = _ratio(l2, g2)
            self.slope[j] = (gain + loss) / (2.0 * eff) if eff > 0 else 0.0
        for j in range(n):
            if j not in opp:
                self.win[j] = self.lose[j] = self.base
                self.bf_me[j] = self.bf_opp[j] = 1.0
                self.slope[j] = 0.0
        self.ready = True


def _ratio(loss, gain):
    if gain <= 1e-12:
        return 3.0 if loss > 1e-12 else 1.0
    return float(min(3.0, max(0.8, loss / gain)))
