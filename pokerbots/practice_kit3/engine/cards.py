"""Card encoding: card = suit * 13 + rank.

rank: 0='2', 1='3', ..., 8='T', 9='J', 10='Q', 11='K', 12='A'
suit: 0='s' (spades), 1='h' (hearts), 2='d' (diamonds), 3='c' (clubs)

So 0 = 2s, 12 = As, 13 = 2h, 25 = Ah, 26 = 2d, 39 = 2c, 51 = Ac.
"""

RANKS = "23456789TJQKA"
SUITS = "shdc"


def rank_of(card):
    return card % 13


def suit_of(card):
    return card // 13


def make_card(rank, suit):
    return suit * 13 + rank


def card_str(card):
    return RANKS[card % 13] + SUITS[card // 13]


def cards_str(cards):
    return " ".join(card_str(c) for c in cards)


def parse_card(text):
    """'As' -> 12. Rank char is case-insensitive, suit char lower-case s/h/d/c."""
    r = RANKS.index(text[0].upper())
    s = SUITS.index(text[1].lower())
    return make_card(r, s)


def parse_cards(text):
    return [parse_card(t) for t in text.split()]


def full_deck():
    return list(range(52))
