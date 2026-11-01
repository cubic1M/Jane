"""Sample bot: a loose calling station.  Never raises, calls a lot,
draws at random.  Useful as easy opposition."""

import random

RANK_VALUE = {"2": 2, "3": 3, "4": 4, "5": 5, "6": 6, "7": 7, "8": 8, "9": 9,
              "10": 10, "J": 11, "Q": 12, "K": 13, "A": 14}


def get_action(state):
    if state["type"] == "draw":
        if random.random() < 0.5:
            worst = min(state["hole_cards"], key=lambda c: RANK_VALUE[c[:-1]])
            return {"discard": worst}
        return {"discard": None}

    me = state["players"][state["my_seat"]]
    to_call = state["current_bet"] - me["chips_in_pot_this_round"]
    if to_call <= 0:
        return {"action": "check"}
    behind = me["chips_total"] - me["chips_in_pot_this_round"]
    if to_call <= 0.25 * behind or random.random() < 0.15:
        return {"action": "call"}
    return {"action": "fold"}
