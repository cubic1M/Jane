"""Exact ICM (Malmuth-Harville) for one player, fast enough for a 1 ms decision.

value(my, others, pays): expected points for a player with `my` chips against the
positive stacks `others`, with `pays` = points for places 1..n still to be awarded.
Subset DP over the opponents: O(2^k * k), k <= 7 at an 8-player table. The mask tables
for each k are built once, so the inner loop is plain list indexing.

allin_call_need(...): the equity at which calling an all-in breaks even in points:
    (U(fold) - U(lose)) / (U(win) - U(lose)),
from the exact stacks after each outcome (the shover's stack moves too).
"""
from __future__ import annotations

_MASKS: dict = {}


def _masks(k):
    t = _MASKS.get(k)
    if t is None:
        size = 1 << k
        bits = [[i for i in range(k) if m >> i & 1] for m in range(size)]
        low = [0] * size
        for m in range(1, size):
            low[m] = (m & -m).bit_length() - 1
        pop = [len(b) for b in bits]
        t = _MASKS[k] = (size, bits, low, pop)
    return t


def value(my: float, others, pays) -> float:
    others = [float(s) for s in others if s > 0]
    k = len(others)
    pays = list(pays) + [0.0] * max(0, k + 1 - len(pays))
    if my <= 0:
        return float(pays[k])
    if k == 0:
        return float(pays[0])
    size, bits, low, pop = _masks(k)
    sums = [0.0] * size
    for m in range(1, size):
        sums[m] = sums[m ^ (1 << low[m])] + others[low[m]]
    f = [0.0] * size
    f[0] = float(pays[k])
    for m in range(1, size):
        tot = my + sums[m]
        v = my * pays[k - pop[m]]
        for i in bits[m]:
            v += others[i] * f[m ^ (1 << i)]
        f[m] = v / tot
    return f[size - 1]


def allin_call_need(my_total: float, my_committed: float, shover: int, totals, committed, pays):
    """Break-even equity for calling the all-in of seat `shover`.

    my_total: my stack + my chips already in this hand; totals / committed: the same for every
    other seat (index = seat, my own entry ignored: pass None); dead money = everyone else's
    committed chips. Returns None when the call risks nothing (no decision to make)."""
    j_total = totals[shover]
    risk = min(my_total, j_total)
    dead = sum(c for s, c in enumerate(committed) if c and s != shover and totals[s] is not None)
    rest = [t - c for s, t in enumerate(totals) if t is not None and s != shover
            for c in (committed[s],)]
    rest = [x for x in rest if x > 0]
    win = value(my_total + risk + dead, rest + [j_total - risk], pays)
    lose = value(my_total - risk, rest + [j_total + risk + dead], pays)
    fold = value(my_total - my_committed, rest + [j_total + my_committed + dead], pays)
    if win - lose <= 1e-12:
        return None
    return (fold - lose) / (win - lose)
