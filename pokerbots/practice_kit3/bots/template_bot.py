"""Template bot for practice kit 3 (single file; copy it and edit).

The engine creates a fresh Agent for every table and calls the methods below.
Only on_discard_request and on_action_request must return something; the other
callbacks are notifications. Read README.md for every field.

Cards are ints 0..51:  card = suit * 13 + rank
    rank = card % 13  -> 0='2' ... 8='T', 9='J', 10='Q', 11='K', 12='A'
    suit = card // 13 -> 0='s', 1='h', 2='d', 3='c'

Amounts the engine SENDS you are in chips. Raise amounts you RETURN are
"r <x>": raise TO x big blinds (street total), rounded to 0.5 bb.
"""

RANKS = "23456789TJQKA"
SUITS = "shdc"


def rank(c):
    return c % 13


def suit(c):
    return c // 13


def show(c):
    return RANKS[c % 13] + SUITS[c // 13]


def raise_to(chips, bb):
    """Action string for a raise to `chips` (street total) at big blind `bb`."""
    return "r %.1f" % (round(chips * 2 / bb) / 2)


def two_card_score(a, b):
    ra, rb = rank(a), rank(b)
    hi, lo = max(ra, rb), min(ra, rb)
    score = hi + lo / 2.0
    if ra == rb:
        score += 10 + ra
    if suit(a) == suit(b):
        score += 2
    if hi - lo == 1:
        score += 1
    return score


def best_keep(cards):
    """Best two cards to keep out of three; returns (score, discard_card)."""
    best = None
    for i in range(len(cards)):
        keep = [c for j, c in enumerate(cards) if j != i]
        sc = two_card_score(keep[0], keep[1])
        if best is None or sc > best[0]:
            best = (sc, cards[i])
    return best


class Agent:
    def __init__(self):
        self.me = None

    def on_table_start(self, info):
        self.me = info["your_id"]

    def on_hand_start(self, hand):
        pass

    def on_event(self, event):
        pass

    def on_discard_request(self, state):
        # Return the CARD INT to throw away (it is shown to everyone).
        return best_keep(state["hole_cards"])[1]

    def on_action_request(self, state):
        bb = state["bb"]
        to_call = state["to_call"]
        if state["street"] == "preflop":
            score = best_keep(state["hole_cards"])[0]
            if score >= 22 and state["can_raise"]:
                return raise_to(max(state["current_bet"] * 3, 2.5 * bb), bb)
            if score >= 15 and to_call <= 2 * bb:
                return "c"
            return "c" if to_call == 0 else "f"

        hole_ranks = [rank(c) for c in state["hole_cards"]]
        board_ranks = [rank(c) for c in state["board"]]
        made = hole_ranks[0] == hole_ranks[1] or any(r in board_ranks for r in hole_ranks)
        if made:
            if to_call == 0 and state["can_raise"]:
                return raise_to(state["pot"] * 0.5, bb)
            return "c" if to_call <= state["pot"] else "f"
        if to_call == 0:
            return "c"
        return "c" if to_call <= state["pot"] * 0.2 else "f"

    def on_showdown(self, result):
        pass

    def on_hand_end(self, result):
        pass
