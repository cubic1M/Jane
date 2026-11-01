"""Cards and hand evaluation.

Cards are strings: rank then suit.  Ranks 2-9, '10', 'J', 'Q', 'K', 'A';
suits 'C', 'D', 'H', 'S' (upper case).  Examples: '10H', 'AS', '7C'.
"""

from collections import Counter

RANKS = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"]
SUITS = ["C", "D", "H", "S"]
RANK_VALUE = {r: i + 2 for i, r in enumerate(RANKS)}

HAND_NAMES = [
    "high card", "pair", "two pair", "three of a kind", "straight",
    "flush", "full house", "four of a kind", "straight flush",
]


def full_deck():
    return [r + s for r in RANKS for s in SUITS]


def is_card(card):
    return (isinstance(card, str) and len(card) in (2, 3)
            and card[:-1] in RANK_VALUE and card[-1] in SUITS)


def parse(card):
    """'10H' -> (10, 'H').  Raises ValueError on anything else."""
    if not is_card(card):
        raise ValueError(f"not a card: {card!r}")
    return RANK_VALUE[card[:-1]], card[-1]


def _straight_high(values):
    """Highest straight top card in a set of rank values, or 0."""
    vals = set(values)
    if 14 in vals:
        vals.add(1)
    for top in range(14, 4, -1):
        if all((top - k) in vals for k in range(5)):
            return top
    return 0


def evaluate(cards):
    """Score the best 5-card hand from 5-7 cards; larger tuples win."""
    parsed = [parse(c) for c in cards]
    values = [v for v, _ in parsed]
    suits = Counter(s for _, s in parsed)
    flush_suit = next((s for s, n in suits.items() if n >= 5), None)
    if flush_suit is not None:
        fvals = sorted((v for v, s in parsed if s == flush_suit), reverse=True)
        sf = _straight_high(fvals)
        if sf:
            return (8, sf)
    counts = Counter(values)
    groups = sorted(counts.items(), key=lambda kv: (kv[1], kv[0]), reverse=True)
    quads = [v for v, n in groups if n == 4]
    trips = sorted((v for v, n in groups if n == 3), reverse=True)
    pairs = sorted((v for v, n in groups if n == 2), reverse=True)
    if quads:
        q = quads[0]
        kicker = max(v for v in values if v != q)
        return (7, q, kicker)
    if trips and (len(trips) >= 2 or pairs):
        t = trips[0]
        p = max(trips[1:] + pairs)
        return (6, t, p)
    if flush_suit is not None:
        return (5, *fvals[:5])
    st = _straight_high(values)
    if st:
        return (4, st)
    distinct = sorted(counts, reverse=True)
    if trips:
        t = trips[0]
        return (3, t, *[v for v in distinct if v != t][:2])
    if len(pairs) >= 2:
        p1, p2 = pairs[0], pairs[1]
        kick = [v for v in distinct if v not in (p1, p2)][:1]
        return (2, p1, p2, *kick)
    if pairs:
        p = pairs[0]
        return (1, p, *[v for v in distinct if v != p][:3])
    return (0, *distinct[:5])


def hand_name(score):
    return HAND_NAMES[score[0]]
