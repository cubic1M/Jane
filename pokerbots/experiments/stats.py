"""Small stats helpers (no scipy available): t-based CIs for duplicate pairs."""
from __future__ import annotations

import math

import numpy as np

# two-sided 95% t critical values by degrees of freedom
_T95 = {1: 12.706, 2: 4.303, 3: 3.182, 4: 2.776, 5: 2.571, 6: 2.447, 7: 2.365, 8: 2.306,
        9: 2.262, 10: 2.228, 11: 2.201, 12: 2.179, 13: 2.160, 14: 2.145, 15: 2.131,
        16: 2.120, 17: 2.110, 18: 2.101, 19: 2.093, 20: 2.086, 25: 2.060, 30: 2.042,
        40: 2.021, 60: 2.000, 120: 1.980}


def t95(df: int) -> float:
    if df <= 0:
        return float("inf")
    if df in _T95:
        return _T95[df]
    keys = sorted(_T95)
    for k in keys:
        if k > df:
            return _T95[k]
    return 1.96


def mean_ci(xs) -> tuple[float, float, int]:
    """(mean, 95% half-width, n) treating xs as iid units."""
    x = np.asarray(xs, dtype=float)
    n = len(x)
    if n == 0:
        return float("nan"), float("nan"), 0
    if n == 1:
        return float(x[0]), float("inf"), 1
    return float(x.mean()), t95(n - 1) * float(x.std(ddof=1)) / math.sqrt(n), n


def fmt_ci(m: float, h: float, digits: int = 2) -> str:
    if math.isnan(m):
        return "n/a"
    return f"{m:+.{digits}f} ± {h:.{digits}f}"


def significant(m: float, h: float) -> bool:
    return abs(m) > h
