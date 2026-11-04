"""Malmuth-Harville ICM for all pairwise all-in outcomes at once (computed in end_hand, never
inside act()), shared by every field9 bot in the process through a small cache.

PairIcm(stacks, pays) holds, for the players with chips:
  base[i]        expected points now;
  win[i][j]      expected points of i after winning min(s_i, s_j) from j;
  lose[i][j]     ... after losing it to j;
  bf(i, j)       bubble factor of i against j = (base - lose) / (win - base).
"""
from __future__ import annotations

import numpy as np

_PLAN: dict = {}
_CACHE: dict = {}


def _plan(n):
    pl = _PLAN.get(n)
    if pl is None:
        levels = [[m for m in range(1 << n) if bin(m).count("1") == L] for L in range(n + 1)]
        pos = [{m: i for i, m in enumerate(lv)} for lv in levels]
        pl = []
        for L in range(n):
            lv = levels[L]
            bits = np.array([[(m >> j) & 1 for m in lv] for j in range(n)], np.int64)
            sel, tgt = [], []
            for j in range(n):
                idx = [i for i, m in enumerate(lv) if not m >> j & 1]
                sel.append(np.array(idx, np.int64))
                tgt.append(np.array([pos[L + 1][lv[i] | (1 << j)] for i in idx], np.int64))
            pl.append((bits, sel, tgt, len(levels[L + 1])))
        _PLAN[n] = pl
    return pl


def icm_batch(stacks, pays):
    """stacks [C, n] -> expected points [C, n]. A zero stack has busted: the zero stacks share the
    places below every surviving player."""
    st = np.asarray(stacks, dtype=np.float64)
    if st.ndim == 1:
        st = st[None, :]
    C, n = st.shape
    pay = [float(p) for p in pays[:n]] + [0.0] * max(0, n - len(pays))
    ev = np.zeros((C, n))
    zero = st <= 0
    nz = (~zero).sum(axis=1)
    for c in range(C):
        k = int(nz[c])
        if k < n:
            ev[c, zero[c]] = sum(pay[k:n]) / (n - k)
    last_paid = max((i for i, p in enumerate(pay) if p > 0), default=-1)
    total = st.sum(axis=1, keepdims=True)
    P = np.ones((C, 1))
    sti = np.rint(st).astype(np.int64)
    for L, (bits, sel, tgt, m_next) in enumerate(_plan(n)):
        if L > last_paid:
            break
        rem = total - (sti @ bits).astype(np.float64)
        q = np.where(rem > 0.5, P / np.where(rem > 0.5, rem, 1.0), 0.0)
        Pn = np.zeros((C, m_next))
        pl = pay[L]
        for j in range(n):
            s = sel[j]
            contrib = q[:, s] * st[:, j:j + 1]
            if pl:
                ev[:, j] += pl * contrib.sum(axis=1)
            Pn[:, tgt[j]] += contrib
        P = Pn
    return ev


_FAST: dict = {}


def _fast_plan(n):
    """Per level L: M [m_L, n] (1 if seat j is not yet placed in subset i) and T [m_L * n, m_{L+1}]
    (subset i plus seat j -> its index on the next level), so a level is a few array ops."""
    fp = _FAST.get(n)
    if fp is None:
        fp = []
        for bits, sel, tgt, m_next in _plan(n):
            m_l = bits.shape[1]
            M = np.zeros((m_l, n))
            T = np.zeros((m_l * n, m_next))
            for j in range(n):
                M[sel[j], j] = 1.0
                T[sel[j] * n + j, tgt[j]] = 1.0
            fp.append((bits, M, T))
        _FAST[n] = fp
    return fp


def icm_batch_fast(stacks, pays):
    """Same as icm_batch (Malmuth-Harville, exact), vectorised over seats: ~5x fewer numpy calls."""
    st = np.asarray(stacks, dtype=np.float64)
    if st.ndim == 1:
        st = st[None, :]
    C, n = st.shape
    pay = [float(p) for p in pays[:n]] + [0.0] * max(0, n - len(pays))
    ev = np.zeros((C, n))
    zero = st <= 0
    nz = (~zero).sum(axis=1)
    for c in range(C):
        k = int(nz[c])
        if k < n:
            ev[c, zero[c]] = sum(pay[k:n]) / (n - k)
    last_paid = max((i for i, p in enumerate(pay) if p > 0), default=-1)
    total = st.sum(axis=1, keepdims=True)
    P = np.ones((C, 1))
    sti = np.rint(st).astype(np.int64)
    for L, (bits, M, T) in enumerate(_fast_plan(n)):
        if L > last_paid:
            break
        rem = total - (sti @ bits).astype(np.float64)
        q = np.where(rem > 0.5, P / np.where(rem > 0.5, rem, 1.0), 0.0)        # [C, m_L]
        contrib = q[:, :, None] * M[None, :, :] * st[:, None, :]              # [C, m_L, n]
        if pay[L]:
            ev += pay[L] * contrib.sum(axis=1)
        P = contrib.reshape(C, -1) @ T
    return ev


class PairIcm:
    def __init__(self, stacks, pays, me=None):
        # me = a seat: only the all-ins involving that seat (2(L-1) rows instead of L(L-1)); every
        # value the bots read (base, win/lose[me][j], bf(me, j), bf(j, me)) is the same, ~4x faster
        self.n = len(stacks)
        alive = [i for i, s in enumerate(stacks) if s > 0]
        self.alive = alive
        L = len(alive)
        pays = tuple(pays[:L])
        self.total_pts = float(sum(pays))
        self.base = [0.0] * self.n
        self.win = [[0.0] * self.n for _ in range(self.n)]
        self.lose = [[0.0] * self.n for _ in range(self.n)]
        self.ready = L >= 2
        if not self.ready:
            return
        st = [float(stacks[i]) for i in alive]
        rows = [st]
        pairs = []
        for a in range(L):
            for b in range(L):
                if a == b or (me is not None and me not in (alive[a], alive[b])):
                    continue
                eff = min(st[a], st[b])
                r = list(st)
                r[a] += eff
                r[b] -= eff
                rows.append(r)
                pairs.append((a, b))
        ev = icm_batch_fast(np.array(rows), pays)
        for a in range(L):
            self.base[alive[a]] = float(ev[0, a])
        for k, (a, b) in enumerate(pairs):
            i, j = alive[a], alive[b]
            self.win[i][j] = float(ev[k + 1, a])         # i won from j
            self.lose[j][i] = float(ev[k + 1, b])        # j lost to i
        self.stacks = list(stacks)

    def bf(self, i, j) -> float:
        if not self.ready or self.stacks[i] <= 0 or self.stacks[j] <= 0:
            return 1.0
        up = self.win[i][j] - self.base[i]
        down = self.base[i] - self.lose[i][j]
        if up <= 1e-12:
            return 3.0
        return max(0.8, min(3.0, down / up))


def pair_icm(stacks, pays, me=None) -> PairIcm:
    key = (tuple(stacks), tuple(pays), me)
    p = _CACHE.get(key)
    if p is None:
        if len(_CACHE) > 64:
            _CACHE.clear()
        p = _CACHE[key] = PairIcm(list(stacks), tuple(pays), me)
    return p
