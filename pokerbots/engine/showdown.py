"""Pot-splitting rules: GameSpec.showdown names one of these.

split(spec, ev, holes, board, elig) -> [(fraction, winners), ...]: the fractions add up to 1;
each part of a pot is shared equally among its winners. The SNG table (sng/table.py) and the
any-variant table builder (sng/ours/anyvar.py) both use this, so a new rule is one function here
plus a name in VALID: the engine plays it, the arena and tuner measure it, icm_any learns it.

  high         best high hand takes the pot (the standard game)
  hilo8        half to the best high hand, half to the best ace-to-five low with five distinct ranks
               of 8 or lower (straights and flushes do not count against a low); no qualifying low:
               the high hand scoops. Omaha-style hole_usage="exactly" applies to the low too.
  double_board two boards dealt together (each street's cards alternate: the first half of a street's
               cards go to board A, the second half to board B); half the pot to the best high hand on
               each board. board_cards_per_street counts both boards, e.g. (0, 6, 2, 2).
"""
from __future__ import annotations

from itertools import combinations

VALID = ("high", "hilo8", "double_board")


def _low_value(cards, qualify=8):
    """Ace-to-five low of 5 cards: tuple of values high to low (smaller is better), or None."""
    vals = [1 if (c >> 2) == 12 else (c >> 2) + 2 for c in cards]
    if len(set(vals)) < 5 or max(vals) > qualify:
        return None
    return tuple(sorted(vals, reverse=True))


def best_low(spec, hole, board, qualify=8):
    """Best qualifying ace-to-five low from hole + board under spec.hole_usage, or None."""
    best = None
    if spec.hole_usage == "exactly":
        k = spec.hole_exact
        for hc in combinations(hole, k):
            for bc in combinations(board, 5 - k):
                v = _low_value(hc + bc, qualify)
                if v is not None and (best is None or v < best):
                    best = v
    else:
        for five in combinations(tuple(hole) + tuple(board), 5):
            v = _low_value(five, qualify)
            if v is not None and (best is None or v < best):
                best = v
    return best


def split_boards(spec, board):
    """double_board: the board list as dealt -> (board A, board B)."""
    a, b, i = [], [], 0
    for k in spec.board_cards_per_street[1:]:
        street = board[i:i + k]
        if not street:
            break
        half = k // 2
        a += street[:half]
        b += street[half:]
        i += k
    return a, b


def _best(scores, elig):
    top = max(scores[j] for j in elig)
    return [j for j in elig if scores[j] == top]


def split(spec, ev, holes, board, elig):
    rule = getattr(spec, "showdown", "high")
    if rule == "high":
        sc = {j: ev.evaluate(list(holes[j]), list(board)) for j in elig}
        return [(1.0, _best(sc, elig))]
    if rule == "hilo8":
        sc = {j: ev.evaluate(list(holes[j]), list(board)) for j in elig}
        hi = _best(sc, elig)
        lows = {j: best_low(spec, holes[j], board) for j in elig}
        q = [j for j in elig if lows[j] is not None]
        if not q:
            return [(1.0, hi)]
        top = min(lows[j] for j in q)
        return [(0.5, hi), (0.5, [j for j in q if lows[j] == top])]
    if rule == "double_board":
        a, b = split_boards(spec, list(board))
        sa = {j: ev.evaluate(list(holes[j]), a) for j in elig}
        sb = {j: ev.evaluate(list(holes[j]), b) for j in elig}
        return [(0.5, _best(sa, elig)), (0.5, _best(sb, elig))]
    raise ValueError(f"unknown showdown rule {rule!r}")


def share(spec, ev, holes, board, me, elig):
    """My fraction of a pot contested by elig (which includes me)."""
    return sum(f / len(w) for f, w in split(spec, ev, holes, board, elig) if me in w)


def part_keys(spec, ev, holes, board, seats):
    """Per deal, once: (fractions, {seat: [key per part]}); a bigger key wins its part, None = no
    qualifying hand for that part (its fraction then goes to part 0). share_keys() splits from these
    without re-evaluating, so the table builder stays fast."""
    rule = getattr(spec, "showdown", "high")
    if rule == "high":
        return (1.0,), {j: [ev.evaluate(list(holes[j]), list(board))] for j in seats}
    if rule == "hilo8":
        out = {}
        for j in seats:
            lo = best_low(spec, holes[j], board)
            out[j] = [ev.evaluate(list(holes[j]), list(board)), None if lo is None else tuple(-v for v in lo)]
        return (0.5, 0.5), out
    if rule == "double_board":
        a, b = split_boards(spec, list(board))
        return (0.5, 0.5), {j: [ev.evaluate(list(holes[j]), a), ev.evaluate(list(holes[j]), b)] for j in seats}
    raise ValueError(f"unknown showdown rule {rule!r}")


def share_keys(fracs, keys, me, elig):
    """My fraction of a pot contested by elig, from part_keys()."""
    got, carry = 0.0, 0.0
    for p in range(len(fracs) - 1, -1, -1):            # later parts first: an unclaimed part goes to part 0
        f = fracs[p] + (carry if p == 0 else 0.0)
        vals = [keys[j][p] for j in elig if keys[j][p] is not None]
        if not vals:
            carry += f
            continue
        top = max(vals)
        if keys[me][p] == top:
            got += f / vals.count(top)
    return got
