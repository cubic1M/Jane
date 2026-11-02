"""Best-five-card hold'em evaluator for 5 to 7 cards (cards encoded as in cards.py).

evaluate() returns a tuple; a larger tuple is a better hand. The first element
is the category: 0 high card ... 8 straight flush.
"""

CATEGORY_NAMES = [
    "High Card", "Pair", "Two Pair", "Three of a Kind", "Straight",
    "Flush", "Full House", "Four of a Kind", "Straight Flush",
]
_RANK_NAMES = ["Twos", "Threes", "Fours", "Fives", "Sixes", "Sevens", "Eights",
               "Nines", "Tens", "Jacks", "Queens", "Kings", "Aces"]
_HIGH_NAMES = ["Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
               "Ten", "Jack", "Queen", "King", "Ace"]


def _straight_high(rank_set):
    """Highest straight top rank in a set of ranks, or -1. Wheel (A2345) -> 3."""
    for high in range(12, 3, -1):
        if (high in rank_set and high - 1 in rank_set and high - 2 in rank_set
                and high - 3 in rank_set and high - 4 in rank_set):
            return high
    if 12 in rank_set and 0 in rank_set and 1 in rank_set and 2 in rank_set and 3 in rank_set:
        return 3
    return -1


def evaluate(cards):
    if not 5 <= len(cards) <= 7:
        raise ValueError("evaluate needs 5..7 cards")
    counts = [0] * 13
    by_suit = ([], [], [], [])
    for c in cards:
        r = c % 13
        counts[r] += 1
        by_suit[c // 13].append(r)

    flush_ranks = None
    for ranks in by_suit:
        if len(ranks) >= 5:
            flush_ranks = sorted(ranks, reverse=True)
    if flush_ranks is not None:
        sf = _straight_high(set(flush_ranks))
        if sf >= 0:
            return (8, sf)

    quads, trips, pairs, singles = [], [], [], []
    for r in range(12, -1, -1):
        n = counts[r]
        if n == 4:
            quads.append(r)
        elif n == 3:
            trips.append(r)
        elif n == 2:
            pairs.append(r)
        elif n == 1:
            singles.append(r)

    if quads:
        q = quads[0]
        kicker = max(r for r in range(13) if counts[r] and r != q)
        return (7, q, kicker)
    if trips and (len(trips) >= 2 or pairs):
        t = trips[0]
        second = max(trips[1:] + pairs)
        return (6, t, second)
    if flush_ranks is not None:
        return (5,) + tuple(flush_ranks[:5])
    st = _straight_high({r for r in range(13) if counts[r]})
    if st >= 0:
        return (4, st)
    if trips:
        t = trips[0]
        kick = sorted([r for r in range(13) if counts[r] and r != t], reverse=True)[:2]
        return (3, t) + tuple(kick)
    if len(pairs) >= 2:
        p1, p2 = pairs[0], pairs[1]
        kick = max(r for r in range(13) if counts[r] and r != p1 and r != p2)
        return (2, p1, p2, kick)
    if pairs:
        p = pairs[0]
        kick = sorted([r for r in range(13) if counts[r] and r != p], reverse=True)[:3]
        return (1, p) + tuple(kick)
    return (0,) + tuple(singles[:5])


def hand_name(value):
    cat = value[0]
    if cat == 8:
        return "Royal Flush" if value[1] == 12 else "Straight Flush, %s high" % _HIGH_NAMES[value[1]]
    if cat == 7:
        return "Four of a Kind, %s" % _RANK_NAMES[value[1]]
    if cat == 6:
        return "Full House, %s full of %s" % (_RANK_NAMES[value[1]], _RANK_NAMES[value[2]])
    if cat == 5:
        return "Flush, %s high" % _HIGH_NAMES[value[1]]
    if cat == 4:
        return "Straight, %s high" % _HIGH_NAMES[value[1]]
    if cat == 3:
        return "Three of a Kind, %s" % _RANK_NAMES[value[1]]
    if cat == 2:
        return "Two Pair, %s and %s" % (_RANK_NAMES[value[1]], _RANK_NAMES[value[2]])
    if cat == 1:
        return "Pair of %s" % _RANK_NAMES[value[1]]
    return "High Card, %s" % _HIGH_NAMES[value[1]]
