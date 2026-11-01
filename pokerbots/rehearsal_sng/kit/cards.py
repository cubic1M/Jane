"""Cards and hand evaluation for Six-Plus Hold'em (36-card deck).

Card strings are two characters: rank then suit, e.g. "As", "Td", "6c".
Ranks: 6 7 8 9 T J Q K A.  Suits: c d h s.

evaluate() returns a tuple; a larger tuple is a better hand, equal tuples tie.
The first element is the category (see the constants below).
"""

from itertools import combinations

RANKS = "6789TJQKA"
SUITS = "cdhs"
RANK_VALUE = {r: i + 6 for i, r in enumerate(RANKS)}
FULL_DECK = tuple(r + s for r in RANKS for s in SUITS)

# Category values, weakest to strongest, for this variant.
HIGH_CARD = 0
PAIR = 1
TWO_PAIR = 2
STRAIGHT = 3
THREE_OF_A_KIND = 4
FULL_HOUSE = 5
FLUSH = 6
FOUR_OF_A_KIND = 7
STRAIGHT_FLUSH = 8

CATEGORY_NAMES = (
    "high card", "pair", "two pair", "straight", "three of a kind",
    "full house", "flush", "four of a kind", "straight flush",
)

_LOW_STRAIGHT = [14, 9, 8, 7, 6]


def parse_card(card: str) -> tuple[int, str]:
    """Return (rank value 6-14, suit) or raise ValueError."""
    if (not isinstance(card, str) or len(card) != 2
            or card[0] not in RANK_VALUE or card[1] not in SUITS):
        raise ValueError(f"not a card in this deck: {card!r}")
    return RANK_VALUE[card[0]], card[1]


def score5(cards) -> tuple:
    """Score exactly five cards (no validation)."""
    vals = sorted((RANK_VALUE[c[0]] for c in cards), reverse=True)
    flush = cards[0][1] == cards[1][1] == cards[2][1] == cards[3][1] == cards[4][1]
    counts: dict[int, int] = {}
    for v in vals:
        counts[v] = counts.get(v, 0) + 1
    straight_high = 0
    if len(counts) == 5:
        if vals[0] - vals[4] == 4:
            straight_high = vals[0]
        elif vals == _LOW_STRAIGHT:
            straight_high = 9
    if straight_high and flush:
        return (STRAIGHT_FLUSH, straight_high)
    groups = sorted(counts.items(), key=lambda kv: (kv[1], kv[0]), reverse=True)
    shape = tuple(c for _, c in groups)
    ranks = tuple(v for v, _ in groups)
    if shape[0] == 4:
        return (FOUR_OF_A_KIND,) + ranks
    if flush:
        return (FLUSH,) + tuple(vals)
    if shape == (3, 2):
        return (FULL_HOUSE,) + ranks
    if shape[0] == 3:
        return (THREE_OF_A_KIND,) + ranks
    if straight_high:
        return (STRAIGHT, straight_high)
    if shape == (2, 2, 1):
        return (TWO_PAIR,) + ranks
    if shape[0] == 2:
        return (PAIR,) + ranks
    return (HIGH_CARD,) + tuple(vals)


def evaluate(cards, validate: bool = True) -> tuple:
    """Best five-card score from 5 to 7 cards."""
    cards = list(cards)
    if validate:
        if not 5 <= len(cards) <= 7:
            raise ValueError("evaluate() needs 5 to 7 cards")
        for c in cards:
            parse_card(c)
        if len(set(cards)) != len(cards):
            raise ValueError("duplicate cards")
    if len(cards) == 5:
        return score5(cards)
    return max(score5(combo) for combo in combinations(cards, 5))


def describe(score: tuple) -> str:
    """Human readable category name for a score from evaluate()."""
    return CATEGORY_NAMES[score[0]]
