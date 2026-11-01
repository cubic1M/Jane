"""Fast ICM for one player (Malmuth-Harville), O(2^k * k) over the k opponents,
and an ICM utility curve U(my chips) with the other stacks scaled to keep the total."""
from __future__ import annotations

from bisect import bisect_right


def my_icm(my: float, others, pays) -> float:
    """Expected points for a player with `my` chips vs positive stacks `others`;
    pays = points for places 1..len(others)+1 still to be awarded."""
    others = [float(s) for s in others if s > 0]
    k = len(others)
    pays = list(pays) + [0.0] * max(0, k + 1 - len(pays))
    if my <= 0:
        return float(pays[k])
    size = 1 << k
    sums = [0.0] * size
    for m in range(1, size):
        low = m & -m
        sums[m] = sums[m ^ low] + others[low.bit_length() - 1]
    f = [0.0] * size
    f[0] = float(pays[k])
    for m in range(1, size):
        tot = my + sums[m]
        placed = k - bin(m).count("1")
        v = my / tot * pays[placed]
        mm = m
        while mm:
            low = mm & -mm
            v += others[low.bit_length() - 1] / tot * f[m ^ low]
            mm ^= low
        f[m] = v
    return f[size - 1]


class IcmCurve:
    MULTS = (0.25, 0.5, 0.75, 1.0, 1.5, 2.0, 3.0)

    def __init__(self, my: float, others, pays):
        others = [float(s) for s in others if s > 0]
        k = len(others)
        pays = list(pays)
        bust = float(pays[k]) if k < len(pays) else 0.0
        T = my + sum(others)
        xs, ys = [0.0], [bust]
        if my <= 0 or k == 0:
            self.xs, self.ys = [0.0, max(T, 1.0)], [bust, float(pays[0])]
            return
        rest = T - my
        for mult in self.MULTS:
            g = my * mult
            if g >= T * 0.97:
                break
            sc = (T - g) / rest
            xs.append(g)
            ys.append(my_icm(g, [s * sc for s in others], pays))
        xs.append(float(T))
        ys.append(float(pays[0]))
        self.xs, self.ys = xs, ys

    def __call__(self, chips: float) -> float:
        xs, ys = self.xs, self.ys
        if chips <= 0:
            return ys[0]
        if chips >= xs[-1]:
            return ys[-1]
        i = bisect_right(xs, chips) - 1
        t = (chips - xs[i]) / (xs[i + 1] - xs[i])
        return ys[i] + t * (ys[i + 1] - ys[i])
