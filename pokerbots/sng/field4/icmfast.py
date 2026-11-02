"""My-only ICM equity (Malmuth-Harville), fast enough to call inside act().

equity(me, others, pay) = expected points for a player with stack `me` when the other
unplaced players hold `others`, and pay[0..] are the points for the places still open
(pay[0] = best). Zero stacks are placed last. Exact DP over subsets of the others; with
more than MAX_EXACT others the smallest ones are merged pairwise first (an
approximation that keeps the cost bounded).
"""
from __future__ import annotations

MAX_EXACT = 6
_TRANS = {}


def _trans(m):
    t = _TRANS.get(m)
    if t is None:
        masks = sorted(range(1, 1 << m), key=lambda x: bin(x).count("1"))
        t = [(mask, bin(mask).count("1"), [(i, mask ^ (1 << i)) for i in range(m) if mask >> i & 1])
             for mask in masks]
        _TRANS[m] = t
    return t


def equity(me: float, others, pay, max_exact: int = MAX_EXACT) -> float:
    if me <= 0:
        n = 1 + sum(1 for o in others if o > 0)
        # busted now: the worst of the places among the live players and me
        return pay[n - 1] if n - 1 < len(pay) else 0.0
    st = [float(o) for o in others if o > 0]
    m = len(st)
    if m == 0:
        return pay[0]
    pay = list(pay[:m + 1]) + [0.0] * max(0, m + 1 - len(pay))
    while m > max_exact:
        st.sort()
        a = st.pop(0)
        b = st.pop(0)
        st.append(a + b)
        m -= 1
        pay = _merge_pay(pay, m)
    sums = [0.0] * (1 << m)
    for mask in range(1, 1 << m):
        low = mask & -mask
        sums[mask] = sums[mask ^ low] + st[low.bit_length() - 1]
    V = [0.0] * (1 << m)
    V[0] = pay[m]
    for mask, d, tr in _trans(m):
        acc = me * pay[m - d]
        for i, ch in tr:
            acc += st[i] * V[ch]
        V[mask] = acc / (me + sums[mask])
    return V[(1 << m) - 1]


def _merge_pay(pay, m):
    # after merging, m+1 players hold m+1 places: approximate by averaging the two lowest
    lo = (pay[m] + pay[m + 1]) / 2.0
    return pay[:m] + [lo]


def chip_points(stacks, pay):
    """Full ICM for every player (for tests / offline use)."""
    return [equity(s, [t for j, t in enumerate(stacks) if j != i], pay) for i, s in enumerate(stacks)]


# ---- batched exact version (all scenarios of one decision in one numpy pass) -------------
import numpy as _np  # noqa: E402

_LAYERS = {}


def _layers(m):
    t = _LAYERS.get(m)
    if t is None:
        t = []
        for d in range(1, m + 1):
            masks = [x for x in range(1, 1 << m) if bin(x).count("1") == d]
            mem = [[i for i in range(m) if x >> i & 1] for x in masks]
            ch = [[x ^ (1 << i) for i in row] for x, row in zip(masks, mem)]
            t.append((d, _np.array(masks), _np.array(mem), _np.array(ch)))
        _LAYERS[m] = t
    return t


def equity_batch(mes, others, pay):
    """mes: list of my stacks per scenario; others: list (per scenario) of the other
    players' stacks, all the same length (0 = busted in that scenario). Returns a list
    of my expected points per scenario. Exact Harville."""
    S = len(mes)
    m = len(others[0])
    if m == 0:
        return [pay[0] if x > 0 else 0.0 for x in mes]
    if m <= 4 or S == 1:
        return [_exact_padded(mes[i], others[i], pay) for i in range(S)]
    pay = list(pay[:m + 1]) + [0.0] * max(0, m + 1 - len(pay))
    me = _np.array([max(float(x), 1e-9) for x in mes])
    st = _np.array(others, dtype=float).T            # (m, S)
    V = _np.empty((1 << m, S))
    V[0] = pay[m]
    for d, masks, mem, ch in _layers(m):
        sm = st[mem]                                  # (L, d, S)
        V[masks] = (me * pay[m - d] + (sm * V[ch]).sum(axis=1)) / (me + sm.sum(axis=1))
    out = V[(1 << m) - 1].tolist()
    for i, x in enumerate(mes):
        if x <= 0:
            out[i] = _bust_value(others[i], pay)
    return out


def _bust_value(others, pay):
    n = 1 + sum(1 for o in others if o > 0)
    return pay[n - 1] if n - 1 < len(pay) else 0.0


def _exact_padded(me, others, pay):
    if me <= 0:
        return _bust_value(others, pay)
    # zero-stack others are placed below me: drop them and keep the places above
    live = [o for o in others if o > 0]
    return equity(me, live, pay[:len(live) + 1], max_exact=8)


# ---- quadrature version -----------------------------------------------------------------
# Harville = independent exponential clocks with rates equal to the stacks (first clock
# to ring takes first place). With u = exp(-me * t) uniform on (0, 1), another player i
# rings before me with probability 1 - u ** (s_i / me), independently given u, so
#   my equity = integral over u of sum_p pay[p] * P(exactly p others ring before me | u).
_GL = {}


def _nodes(n):
    t = _GL.get(n)
    if t is None:
        x, w = _np.polynomial.legendre.leggauss(n)
        # map to (0,1) and cluster points near 0 with u = v**3 (u ** r is steep there for small r)
        v = (x + 1) / 2
        wv = w / 2
        u = v ** 3
        wu = wv * 3 * v ** 2
        t = (u, wu)
        _GL[n] = t
    return t


def equity_quad(mes, others, pay, nodes=28):
    """Same contract as equity_batch; error well under 0.1 point, cost ~40-80 us."""
    S = len(mes)
    m = len(others[0])
    payv = _np.array(list(pay[:m + 1]) + [0.0] * max(0, m + 1 - len(pay)))
    u, w = _nodes(nodes)
    me = _np.array([max(float(x), 1e-9) for x in mes])
    st = _np.array(others, dtype=float)                       # (S, m)
    r = st / me[:, None]                                      # (S, m)
    q = 1.0 - u[None, None, :] ** r[:, :, None]               # (S, m, N): i ahead of me
    dist = _np.zeros((S, nodes, m + 1))
    dist[:, :, 0] = 1.0
    for i in range(m):
        qi = q[:, i, :, None]                                 # (S, N, 1)
        nd = dist * (1.0 - qi)
        nd[:, :, 1:] += dist[:, :, :-1] * qi
        dist = nd
    out = ((dist @ payv) * w).sum(axis=1).tolist()
    for i, x in enumerate(mes):
        if x <= 0:
            out[i] = _bust_value(others[i], pay)
    return out



_CHEB = {}


def _cheb(m, payv_key):
    t = _CHEB.get((m, payv_key))
    if t is None:
        Z = m + 1
        x = 0.5 - 0.5 * _np.cos(_np.pi * (_np.arange(Z) + 0.5) / Z)
        V = _np.vander(x, Z, increasing=True)          # G(x_k) = sum_p dist[p] x_k^p
        c = _np.linalg.solve(V.T, _np.array(payv_key))  # pay . dist = c . G
        t = (x - 1.0, c)
        _CHEB[(m, payv_key)] = t
    return t


def equity_fast(mes, others, pay, nodes=28):
    """Same contract and accuracy as equity_quad, with a closed-form place distribution:
    the generating function prod_i (1 - q_i + q_i x) at m+1 Chebyshev points, then one
    dot product with the payouts mapped through the inverse Vandermonde matrix."""
    m = len(others[0])
    if m == 0:
        return [pay[0] if x > 0 else 0.0 for x in mes]
    payv = tuple(float(v) for v in list(pay[:m + 1]) + [0.0] * max(0, m + 1 - len(pay)))
    xm1, c = _cheb(m, payv)
    lu, w = _lnodes(nodes)
    me = _np.array([max(float(x), 1e-9) for x in mes])
    r = _np.array(others, dtype=float) / me[:, None]          # (S, m)
    q = 1.0 - _np.exp(r[:, :, None] * lu)                     # (S, m, N): i finishes ahead of me
    G = (1.0 + q[..., None] * xm1).prod(axis=1)               # (S, N, Z)
    out = ((G @ c) @ w).tolist()
    for i, x in enumerate(mes):
        if x <= 0:
            out[i] = _bust_value(others[i], pay)
    return out


def _lnodes(n):
    u, w = _nodes(n)
    return _np.log(u), w


def equity1(me, others, pay):
    """Single-scenario convenience wrapper."""
    return equity_fast([me], [list(others)], pay)[0]
