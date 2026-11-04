"""Runtime access to the offline tables in sng/field8/data (built by build_tables.py).

Everything heavy is loaded once per process at import; lookups inside act() are a few list or
numpy-scalar indexings.
"""
from __future__ import annotations

import bisect
import os

import numpy as np

_DIR = os.path.join(os.path.dirname(__file__), "data")


def _load(name):
    return np.load(os.path.join(_DIR, name))


# ---------------------------------------------------------------------------- equities
_E = _load("eq8.npz")
EQ = _E["eq"].astype(np.float64)                     # [169, 169] all-in equity, row vs column
NCOMB_A = _E["ncomb"].astype(np.float64)
NCOMB = [int(x) for x in NCOMB_A]
W_A = NCOMB_A / NCOMB_A.sum()
PCT = [float(x) for x in _E["pct"]]                   # strength percentile (0 = best)
ORDER = [int(x) for x in _E["order"]]
EQT = _E["eqt"].astype(np.float64).tolist()           # EQT[k][h]: vs the top (k+1)% of hands
EQ_RAND = [float(x) for x in _E["eq_rand"]]

# CALLW[k][t]: fraction of all hands whose equity vs the top (k+1)% is >= THR[t]
THR = [round(0.25 + 0.01 * i, 2) for i in range(51)]  # 0.25 .. 0.75
_eqt = _E["eqt"].astype(np.float64)
CALLW = [[float(((_eqt[k] >= t) * W_A).sum()) for t in THR] for k in range(100)]


def eq_top(frac: float, h: int) -> float:
    """Equity of class h against the top `frac` of hands."""
    k = int(round(frac * 100)) - 1
    k = 0 if k < 0 else 99 if k > 99 else k
    return EQT[k][h]


def call_width(range_frac: float, need: float) -> float:
    """How wide (fraction of all hands) a rational caller continues against a range of the
    top `range_frac` hands when it needs equity `need`."""
    k = int(round(range_frac * 100)) - 1
    k = 0 if k < 0 else 99 if k > 99 else k
    t = (need - 0.25) / 0.01
    if t <= 0:
        return CALLW[k][0]
    if t >= 50:
        return CALLW[k][50]
    i = int(t)
    f = t - i
    row = CALLW[k]
    return row[i] * (1 - f) + row[min(50, i + 1)] * f


def eq_vs_weights(h: int, weights) -> float:
    """Equity of class h against a range given as per-class weights (numpy, 169)."""
    s = float(weights.sum())
    if s <= 1e-12:
        return 0.5
    return float((EQ[h] * weights).sum()) / s


# ---------------------------------------------------------------------------- push / fold
_P = _load("pf8.npz")
PF_PUSH = _P["push"].astype(np.float32) / 255.0      # [nb 0..7, S, BFp, BFc, 169]
PF_EQ = _P["eqpush"].astype(np.float32) / 255.0      # equity of each hand vs that push range
PF_CF = _P["callfrac"].astype(np.float32)            # [nb, S, BFp, BFc, caller k]
PF_S = [float(x) for x in _P["s_grid"]]
PF_BF = [float(x) for x in _P["bf_grid"]]
PF_SMAX = PF_S[-1]


def _near(grid, x):
    i = bisect.bisect_left(grid, x)
    if i <= 0:
        return 0
    if i >= len(grid):
        return len(grid) - 1
    return i if grid[i] - x < x - grid[i - 1] else i - 1


def _bracket(grid, x):
    """(i, j, f): x lies between grid[i] and grid[j] at fraction f."""
    if x <= grid[0]:
        return 0, 0, 0.0
    if x >= grid[-1]:
        n = len(grid) - 1
        return n, n, 0.0
    j = bisect.bisect_left(grid, x)
    i = j - 1
    return i, j, (x - grid[i]) / (grid[j] - grid[i])


def pf_index(S: float, bfp: float, bfc: float):
    return _bracket(PF_S, S), _near(PF_BF, bfp), _near(PF_BF, bfc)


def pf_push(nb: int, S: float, bfp: float, bfc: float, h: int) -> float:
    """Equilibrium probability of shoving class h first in with nb players behind."""
    nb = 0 if nb < 0 else 7 if nb > 7 else nb
    (i, j, f), b, c = pf_index(S, bfp, bfc)
    return float(PF_PUSH[nb, i, b, c, h]) * (1 - f) + float(PF_PUSH[nb, j, b, c, h]) * f


def pf_push_eq(nb: int, S: float, bfp: float, bfc: float, h: int) -> float:
    """Equity of class h against the equilibrium shoving range of a player with nb behind."""
    nb = 0 if nb < 0 else 7 if nb > 7 else nb
    (i, j, f), b, c = pf_index(S, bfp, bfc)
    return float(PF_EQ[nb, i, b, c, h]) * (1 - f) + float(PF_EQ[nb, j, b, c, h]) * f


def pf_push_width(nb: int, S: float, bfp: float, bfc: float) -> float:
    nb = 0 if nb < 0 else 7 if nb > 7 else nb
    (i, j, f), b, c = pf_index(S, bfp, bfc)
    return float((PF_PUSH[nb, i, b, c] * W_A).sum()) * (1 - f) + float((PF_PUSH[nb, j, b, c] * W_A).sum()) * f


def pf_callfrac(nb: int, S: float, bfp: float, bfc: float, k: int) -> float:
    nb = 0 if nb < 0 else 7 if nb > 7 else nb
    (i, j, f), b, c = pf_index(S, bfp, bfc)
    k = min(k, 6)
    return float(PF_CF[nb, i, b, c, k]) * (1 - f) + float(PF_CF[nb, j, b, c, k]) * f


# precomputed push widths per (nb, S, BFp, BFc) for the range estimates of other players
PF_WIDTH = (PF_PUSH * W_A.astype(np.float32)).sum(axis=-1)          # [nb, S, BFp, BFc]


def pf_width_fast(nb: int, S: float, bfp: float, bfc: float) -> float:
    nb = 0 if nb < 0 else 7 if nb > 7 else nb
    (i, j, f), b, c = pf_index(S, bfp, bfc)
    return float(PF_WIDTH[nb, i, b, c]) * (1 - f) + float(PF_WIDTH[nb, j, b, c]) * f


# ---------------------------------------------------------------------------- preflop solver
_V = _load("pre8.npz")
SV_S = [float(x) for x in _V["s_grid"]]
SV_OPEN = _V["open"].astype(np.float32)               # [nb 0..7, S, 169]
SV = {k: _V[k].astype(np.float32) for k in ("rc", "rb", "r4c", "oc", "o4")}   # [nb, S, k, 169]
SV_OSZ = _V["osz"].astype(np.float32)                 # open size (bb) [nb, S]
SV_TSZ = _V["tsz"].astype(np.float32)                 # 3-bet size (bb) [nb, S, k]
SV_OPEN_W = (SV_OPEN * W_A.astype(np.float32)).sum(axis=-1)   # open width [nb, S]
SV_W = {k: (v * W_A.astype(np.float32)).sum(axis=-1) for k, v in SV.items()}   # [nb, S, k]
# the opener's continuing ranges against a 3-bet as fractions of ALL hands (oc / o4 are only
# meaningful for hands the opener opens)
_ow = (SV_OPEN * W_A.astype(np.float32))[:, :, None, :]
SV_W["oc_all"] = (SV["oc"] * _ow).sum(axis=-1)
SV_W["o4_all"] = (SV["o4"] * _ow).sum(axis=-1)


def sv_open(nb: int, S: float, h: int) -> float:
    nb = 0 if nb < 0 else 7 if nb > 7 else nb
    i, j, f = _bracket(SV_S, S)
    return float(SV_OPEN[nb, i, h]) * (1 - f) + float(SV_OPEN[nb, j, h]) * f


def sv_open_width(nb: int, S: float) -> float:
    nb = 0 if nb < 0 else 7 if nb > 7 else nb
    i, j, f = _bracket(SV_S, S)
    return float(SV_OPEN_W[nb, i]) * (1 - f) + float(SV_OPEN_W[nb, j]) * f


def sv(table: str, nb: int, S: float, k: int, h: int) -> float:
    nb = 0 if nb < 0 else 7 if nb > 7 else nb
    k = max(0, min(k, max(0, nb - 1) if nb > 0 else 0))
    i, j, f = _bracket(SV_S, S)
    t = SV[table]
    return float(t[nb, i, k, h]) * (1 - f) + float(t[nb, j, k, h]) * f


def sv_width(table: str, nb: int, S: float, k: int) -> float:
    nb = 0 if nb < 0 else 7 if nb > 7 else nb
    k = max(0, min(k, max(0, nb - 1) if nb > 0 else 0))
    i, j, f = _bracket(SV_S, S)
    t = SV_W[table]
    return float(t[nb, i, k]) * (1 - f) + float(t[nb, j, k]) * f


def sv_open_size(nb: int, S: float) -> float:
    nb = 0 if nb < 0 else 7 if nb > 7 else nb
    return float(SV_OSZ[nb, _near(SV_S, S)])


# ---------------------------------------------------------------------------- postflop
_Q = _load("post8.npz")
POST = [tuple(float(x) for x in row) for row in _Q["eq"]]       # POST[key] -> 7 columns
POST_N = [int(x) for x in _Q["n"]]
COL_RANDOM, COL_TOP45, COL_TOP20, COL_CONT, COL_BET, COL_STRONG, COL_TWO = range(7)
