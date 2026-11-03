"""Six-Plus deck (36 cards, 6 to ace) and a 5-7 card evaluator.

Ranking, best first: straight flush, four of a kind, FLUSH, FULL HOUSE,
THREE OF A KIND, STRAIGHT, two pair, pair, high card.
A-6-7-8-9 is the lowest straight (it plays as a 9-high straight).
"""
from collections import Counter

RANKS = "6789TJQKA"
SUITS = "cdhs"
RANK_VALUE = {r: i + 6 for i, r in enumerate(RANKS)}   # '6' -> 6 ... 'A' -> 14
DECK = tuple(r + s for r in RANKS for s in SUITS)

(HIGH_CARD, PAIR, TWO_PAIR, STRAIGHT, THREE_OF_A_KIND,
 FULL_HOUSE, FLUSH, FOUR_OF_A_KIND, STRAIGHT_FLUSH) = range(9)
CATEGORY_NAMES = ("high card", "pair", "two pair", "straight",
                  "three of a kind", "full house", "flush",
                  "four of a kind", "straight flush")

_WHEEL = frozenset({14, 6, 7, 8, 9})


def _straight_high(values):
    for hi in range(14, 9, -1):
        if all(v in values for v in range(hi - 4, hi + 1)):
            return hi
    if _WHEEL <= values:
        return 9
    return 0


def evaluate(cards):
    """Score 5-7 cards; a larger tuple is a better hand."""
    vals = [RANK_VALUE[c[0]] for c in cards]
    by_suit = {}
    for c, v in zip(cards, vals):
        by_suit.setdefault(c[1], []).append(v)
    flush = None
    for vs in by_suit.values():
        if len(vs) >= 5:
            flush = sorted(vs, reverse=True)
    if flush:
        sf = _straight_high(set(flush))
        if sf:
            return (STRAIGHT_FLUSH, sf)
    counts = Counter(vals)
    quads = [v for v, n in counts.items() if n == 4]
    if quads:
        q = quads[0]
        return (FOUR_OF_A_KIND, q, max(v for v in vals if v != q))
    if flush:
        return (FLUSH, *flush[:5])
    trips = sorted((v for v, n in counts.items() if n == 3), reverse=True)
    pairs = sorted((v for v, n in counts.items() if n == 2), reverse=True)
    if trips and (len(trips) > 1 or pairs):
        return (FULL_HOUSE, trips[0], max(trips[1:] + pairs))
    if trips:
        t = trips[0]
        kick = sorted((v for v in vals if v != t), reverse=True)[:2]
        return (THREE_OF_A_KIND, t, *kick)
    st = _straight_high(set(vals))
    if st:
        return (STRAIGHT, st)
    if len(pairs) >= 2:
        hi, lo = pairs[0], pairs[1]
        return (TWO_PAIR, hi, lo, max(v for v in vals if v != hi and v != lo))
    if pairs:
        p = pairs[0]
        return (PAIR, p, *sorted((v for v in vals if v != p), reverse=True)[:3])
    return (HIGH_CARD, *sorted(vals, reverse=True)[:5])


def hand_name(score):
    return CATEGORY_NAMES[score[0]]
