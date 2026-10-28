"""Card encoding shared by the whole codebase.

A card is an int 0..51: rank = card >> 2 (0 = '2' .. 12 = 'A'), suit = card & 3.
"""
from __future__ import annotations

RANK_CHARS = "23456789TJQKA"
SUIT_CHARS = "cdhs"
NUM_RANKS = 13


def rank_of(card: int) -> int:
    return card >> 2


def suit_of(card: int) -> int:
    return card & 3


def make_card(rank: int, suit: int) -> int:
    return (rank << 2) | suit


def parse_card(s: str) -> int:
    s = s.strip()
    if len(s) != 2:
        raise ValueError(f"bad card {s!r}")
    r = RANK_CHARS.index(s[0].upper())
    u = SUIT_CHARS.index(s[1].lower())
    return make_card(r, u)


def parse_cards(s: str) -> list[int]:
    """'AsKd 7h' -> [cards]. Accepts spaces or no separators."""
    s = s.replace(" ", "").replace(",", "")
    return [parse_card(s[i:i + 2]) for i in range(0, len(s), 2)]


def card_str(card: int) -> str:
    return RANK_CHARS[card >> 2] + SUIT_CHARS[card & 3]


def cards_str(cards) -> str:
    return " ".join(card_str(int(c)) for c in cards)


def full_deck(ranks=tuple(range(NUM_RANKS))) -> list[int]:
    return [make_card(r, s) for r in ranks for s in range(4)]
