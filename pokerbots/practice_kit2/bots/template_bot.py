"""Template bot.  Copy this file, rename it, and make it better.

Your submission is THIS ONE FILE.  It may import only the modules listed in
README.md ("Allowed imports"); in particular it cannot import anything from
the kit (simkit) - copy what you need into this file.

Three functions, all module level:

    init(config)          optional; once per table, before the first hand
    get_action(state)     required; every decision (betting AND the draw)
    on_hand_end(summary)  optional; after every hand you were dealt into

Everything you receive has been through json.dumps/json.loads, and whatever
you return is too.  Return plain dicts with str / int / None values.
"""

import random

CONFIG = {}

RANK_VALUE = {"2": 2, "3": 3, "4": 4, "5": 5, "6": 6, "7": 7, "8": 8, "9": 9,
              "10": 10, "J": 11, "Q": 12, "K": 13, "A": 14}


def rank(card):
    """'10H' -> 10, 'AS' -> 14.  (The rank is everything but the last char.)"""
    return RANK_VALUE[card[:-1]]


def suit(card):
    return card[-1]


def init(config):
    """Called once per table.  Module globals are fresh at every table."""
    global CONFIG
    CONFIG = config


def get_action(state):
    if state["type"] == "draw":
        return choose_draw(state)

    me = state["players"][state["my_seat"]]
    to_call = state["current_bet"] - me["chips_in_pot_this_round"]
    bb = state["big_blind"]
    hole = state["hole_cards"]
    hi = max(rank(c) for c in hole)
    lo = min(rank(c) for c in hole)
    pair = hi == lo

    if to_call <= 0:
        # Nobody has bet.  Open premium hands for 2 big blinds MORE than the
        # current bet ("amount" is raise-BY, see README).
        if state["can_raise"] and (pair and hi >= 10 or (hi == 14 and lo >= 12)):
            return {"action": "raise", "amount": 2 * bb}
        return {"action": "check"}

    if pair or hi == 14 or to_call <= bb // 2:
        if to_call <= 3 * bb:
            return {"action": "call"}
    return {"action": "fold"}


def choose_draw(state):
    """Draw phase: return {"discard": <one of your hole cards>} or None."""
    hole = state["hole_cards"]
    board_ranks = {rank(c) for c in state["board"]}
    # keep anything that pairs the board or our other card
    useful = [c for c in hole if rank(c) in board_ranks]
    if hole[0][:-1] == hole[1][:-1] or useful:
        return {"discard": None}
    worst = min(hole, key=rank)
    if rank(worst) <= 8 and random.random() < 0.8:
        return {"discard": worst}
    return {"discard": None}


def on_hand_end(summary):
    pass
