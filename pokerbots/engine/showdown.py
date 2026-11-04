"""Pot-splitting rules: GameSpec.showdown names one of these.

split(spec, ev, holes, board, elig) -> [(fraction, winners), ...]: the fractions add up to 1;
each part of a pot is shared equally among its winners. The SNG table (sng/table.py) and the
any-variant table builder (sng/ours/anyvar.py) both use this, so a new rule is one function here
plus a name in VALID: the engine plays it, the arena and tuner measure it, icm_any learns it.

  high         best high hand takes the pot (the standard game)
  hilo8        half to the best high hand, half to the best ace-to-five low with five distinct ranks
               of 8 or lower (straights and flushes do not count against a low); no qualifying low:
               the high hand scoops. Omaha-style hole_usage="exactly" applies to the low too.
  wild2        deuces wild, high hand: each 2 (in the hole or on the board) counts as any card that makes
               the best hand (five of a kind is not a category here: it plays as the best four of a kind)
  double_board two boards dealt together (each street's cards alternate: the first half of a street's
               cards go to board A, the second half to board B); half the pot to the best high hand on
               each board. board_cards_per_street counts both boards, e.g. (0, 6, 2, 2).
"""
from __future__ import annotations

from itertools import combinations, product

VALID = ("high", "hilo8", "double_board", "wild2")


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


def wild_high(spec, ev, hole, board, wild_rank=0):
    """Best high hand with every card of wild_rank (0 = deuces) standing in for any card. A wild only
    needs to try each rank in the hand's most common suit (flushes) and up to w free other suits (sets,
    quads, straights); with 3+ wilds, the other suits only for ranks already in the hand. Substitutes
    never duplicate a real card."""
    hole, board = list(hole), list(board)
    cards = hole + board
    wpos = [i for i, c in enumerate(cards) if (c >> 2) == wild_rank]
    if not wpos:
        return int(ev.evaluate(hole, board))
    real = [c for i, c in enumerate(cards) if i not in wpos]
    suits = [c & 3 for c in real] or [0]
    s1 = max(range(4), key=suits.count)
    ranks = list(spec.deck_ranks)                 # a wild may also play as a natural card of its own rank
    taken = set(real)
    w = len(wpos)
    cand = {(r << 2) | s1 for r in ranks}                          # flushes / straight flushes
    for r in (ranks if w <= 2 else {c >> 2 for c in real}):        # sets, quads, straights
        free = [(r << 2) | t for t in range(4) if t != s1 and ((r << 2) | t) not in taken]
        cand.update(free[:w])
    cand = sorted(cand - taken)
    rows = []
    for sub in product(cand, repeat=len(wpos)):
        if len(set(sub)) < len(sub) or taken.intersection(sub):
            continue
        row = cards[:]
        for i, c in zip(wpos, sub):
            row[i] = c
        rows.append(row)
    if not rows:
        return int(ev.evaluate(hole, board))
    import numpy as np                            # here, not at module level: the numpy-free bundle imports this file
    a = np.array(rows, dtype=np.int64)
    h = len(hole)
    return int(ev.evaluate_batch(a[:, :h], a[:, h:]).max())


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
    if rule == "wild2":
        sc = {j: wild_high(spec, ev, holes[j], board) for j in elig}
        return [(1.0, _best(sc, elig))]
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
    if rule == "wild2":
        return (1.0,), {j: [wild_high(spec, ev, holes[j], board)] for j in seats}
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
