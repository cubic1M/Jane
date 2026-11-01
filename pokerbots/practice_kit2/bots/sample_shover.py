"""Sample bot: push/fold.  Goes all-in preflop with a decent hand when short,
otherwise plays fit-or-fold.  Never draws."""

RANK_VALUE = {"2": 2, "3": 3, "4": 4, "5": 5, "6": 6, "7": 7, "8": 8, "9": 9,
              "10": 10, "J": 11, "Q": 12, "K": 13, "A": 14}


def get_action(state):
    if state["type"] == "draw":
        return {"discard": None}

    me = state["players"][state["my_seat"]]
    bb = state["big_blind"]
    to_call = state["current_bet"] - me["chips_in_pot_this_round"]
    hi, lo = sorted((RANK_VALUE[c[:-1]] for c in state["hole_cards"]),
                    reverse=True)
    suited = state["hole_cards"][0][-1] == state["hole_cards"][1][-1]
    big_blinds = me["chips_total"] / bb

    if state["street"] == "preflop":
        good = hi == lo or hi == 14 or (hi >= 11 and lo >= 10) or \
            (suited and hi >= 12 and lo >= 8)
        if good and (big_blinds <= 15 or hi == lo >= 11):
            if state["can_raise"]:
                # all-in expressed as raise-BY: everything above the current bet
                return {"action": "raise",
                        "amount": me["chips_total"] - state["current_bet"]}
            return {"action": "call"}
        return {"action": "check"} if to_call <= 0 else {"action": "fold"}

    board_vals = {RANK_VALUE[c[:-1]] for c in state["board"]}
    hit = hi in board_vals or lo in board_vals or hi == lo
    if to_call <= 0:
        return {"action": "check"}
    return {"action": "call"} if hit else {"action": "fold"}
