"""Runtime access to the offline tables in sng/field9/data (built by build_tables.py).

One Tables object per deck ("std" = 52 cards, "six" = short deck), loaded once per process;
lookups inside act() are a few list / numpy-scalar indexings.
"""
from __future__ import annotations

import bisect
import gc
import os

import numpy as np

_DIR = os.path.join(os.path.dirname(__file__), "data")
_CACHE: dict = {}

THR = [round(0.20 + 0.01 * i, 2) for i in range(61)]      # call_width thresholds 0.20 .. 0.80


def _bracket(grid, x):
    if x <= grid[0]:
        return 0, 0, 0.0
    if x >= grid[-1]:
        n = len(grid) - 1
        return n, n, 0.0
    j = bisect.bisect_left(grid, x)
    i = j - 1
    return i, j, (x - grid[i]) / (grid[j] - grid[i])


def _near(grid, x):
    i = bisect.bisect_left(grid, x)
    if i <= 0:
        return 0
    if i >= len(grid):
        return len(grid) - 1
    return i if grid[i] - x < x - grid[i - 1] else i - 1


class Tables:
    def __init__(self, deck="std"):
        self.deck = deck
        e = np.load(os.path.join(_DIR, f"eq9_{deck}.npz"))
        self.EQ = e["eq"].astype(np.float64)
        nc = e["ncomb"].astype(np.float64)
        self.W = nc / nc.sum()
        self.PCT = [float(x) for x in e["pct"]]
        eqt = e["eqt"].astype(np.float64)
        self.EQT = eqt.tolist()
        self.EQ_RAND = [float(x) for x in e["eq_rand"]]
        self.CALLW = [[float(((eqt[k] >= t) * self.W).sum()) for t in THR] for k in range(100)]
        p = np.load(os.path.join(_DIR, f"pf9_{deck}.npz"))
        self.PF_PUSH = p["push"].astype(np.float32) / 255.0       # [nb-1, S, BFp, BFc, 169]
        self.PF_EQ = p["eqpush"].astype(np.float32) / 255.0
        self.PF_CF = p["callfrac"].astype(np.float32)              # [nb-1, S, BFp, BFc, 3]
        self.PF_W = (self.PF_PUSH * self.W.astype(np.float32)).sum(axis=-1)
        self.PF_S = [float(x) for x in p["s_grid"]]
        self.PF_BF = [float(x) for x in p["bf_grid"]]
        self.PF_SMAX = self.PF_S[-1]
        q = np.load(os.path.join(_DIR, f"post9_{deck}.npz"))
        self.POST = [tuple(float(x) for x in row) for row in q["eq"]]
        self.POST_N = [int(x) for x in q["n"]]

    # ---- preflop equities -------------------------------------------------------------
    def eq_top(self, frac: float, h: int) -> float:
        """Equity of class h against the top `frac` of hands."""
        k = int(frac * 100 + 0.5) - 1
        k = 0 if k < 0 else 99 if k > 99 else k
        return self.EQT[k][h]

    def call_width(self, range_frac: float, need: float) -> float:
        """Fraction of all hands with at least `need` equity against the top `range_frac`."""
        k = int(range_frac * 100 + 0.5) - 1
        k = 0 if k < 0 else 99 if k > 99 else k
        t = (need - 0.20) / 0.01
        row = self.CALLW[k]
        if t <= 0:
            return row[0]
        if t >= 60:
            return row[60]
        i = int(t)
        f = t - i
        return row[i] * (1 - f) + row[i + 1] * f

    # ---- push / fold ------------------------------------------------------------------
    def _idx(self, nb, S, bfp, bfc):
        nb = 1 if nb < 1 else 7 if nb > 7 else nb
        i, j, f = _bracket(self.PF_S, S)
        return nb - 1, i, j, f, _near(self.PF_BF, bfp), _near(self.PF_BF, bfc)

    def pf_push(self, nb, S, bfp, bfc, h) -> float:
        n, i, j, f, b, c = self._idx(nb, S, bfp, bfc)
        t = self.PF_PUSH
        return float(t[n, i, b, c, h]) * (1 - f) + float(t[n, j, b, c, h]) * f

    def pf_eq(self, nb, S, bfp, bfc, h) -> float:
        """Equity of class h against the equilibrium push range."""
        n, i, j, f, b, c = self._idx(nb, S, bfp, bfc)
        t = self.PF_EQ
        return float(t[n, i, b, c, h]) * (1 - f) + float(t[n, j, b, c, h]) * f

    def pf_width(self, nb, S, bfp, bfc) -> float:
        n, i, j, f, b, c = self._idx(nb, S, bfp, bfc)
        t = self.PF_W
        return float(t[n, i, b, c]) * (1 - f) + float(t[n, j, b, c]) * f

    def pf_callfrac(self, nb, S, bfp, bfc, kind) -> float:
        """kind: 0 unposted caller, 1 small blind, 2 big blind."""
        n, i, j, f, b, c = self._idx(nb, S, bfp, bfc)
        t = self.PF_CF
        return float(t[n, i, b, c, kind]) * (1 - f) + float(t[n, j, b, c, kind]) * f


def get(deck="std") -> Tables:
    t = _CACHE.get(deck)
    if t is None:
        t = _CACHE[deck] = Tables(deck)
        # the tables live for the whole process: keep them (and everything loaded so far) out of
        # the cyclic collector's full scans, which would otherwise stall a decision now and then
        gc.freeze()
    return t


def available(deck) -> bool:
    return all(os.path.exists(os.path.join(_DIR, f"{k}9_{deck}.npz")) for k in ("eq", "pf", "post"))


# postflop columns
C_RAND, C_50, C_25, C_12, C_CONT, C_VALUE, C_STRONG, C_TWO = range(8)
