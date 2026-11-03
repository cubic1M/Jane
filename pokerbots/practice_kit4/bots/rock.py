"""Tight and passive: premium hands only, rarely raises, folds to pressure."""
NAME = "rock"
VAL = {r: i for i, r in enumerate("6789TJQKA", 6)}


def play(view, memory):
    owe, bb, pot = view["owe"], view["bb"], view["pot"]
    hole, board = view["hole"], view["board"]
    h = sorted((VAL[c[0]] for c in hole), reverse=True)
    if view["street"] == 0:
        if h[0] == h[1] and h[0] >= 12 and view["min_add"] is not None:
            return max(view["min_add"], owe + 3 * bb)
        if (h[0] == h[1] and h[0] >= 9) or h == [14, 13] or h == [14, 12]:
            return owe if owe <= 8 * bb else -1
        return 0 if owe == 0 else -1
    bvals = [VAL[c[0]] for c in board]
    hits = sum(bvals.count(v) for v in set(h))
    pocket = h[0] == h[1]
    if hits >= 2 or (pocket and hits == 1):
        if owe == 0 and view["min_add"] is not None:
            return max(view["min_add"], pot // 2)
        return owe
    top = max(bvals)
    if (hits == 1 and top in h) or (pocket and h[0] > top):
        return owe if owe <= pot // 2 else -1
    return 0 if owe == 0 else -1
