"""Independent Chip Model (Malmuth-Harville): a player's chance to finish in a place is
proportional to its stack among the players still unplaced. Exact by dynamic
programming over subsets (fast for up to ~10 players).
"""
from __future__ import annotations

from functools import lru_cache


def icm(stacks, payouts):
    """Expected points for each player given chip stacks and the points for places
    1..len(stacks) still to be paid (payouts[0] = 1st). Zero stacks get nothing from
    these places."""
    n = len(stacks)
    st = tuple(float(s) for s in stacks)
    pay = tuple(float(p) for p in payouts[:n]) + (0.0,) * max(0, n - len(payouts))

    @lru_cache(maxsize=None)
    def ev(mask: int):
        # expected payout per player for places k.. where k = number of players already
        # placed (outside mask); mask = players not yet placed
        k = n - bin(mask).count("1")
        out = [0.0] * n
        if mask == 0 or k >= len(pay):
            return tuple(out)
        alive = [i for i in range(n) if mask >> i & 1 and st[i] > 0]
        tot = sum(st[i] for i in alive)
        if tot <= 0:
            return tuple(out)
        for i in alive:
            p = st[i] / tot
            out[i] += p * pay[k]
            rest = ev(mask & ~(1 << i))
            for j in range(n):
                out[j] += p * rest[j]
        return tuple(out)

    return list(ev((1 << n) - 1))
