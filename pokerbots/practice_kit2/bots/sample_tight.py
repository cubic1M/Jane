"""Sample bot: tight-aggressive with a small hand reader.

Preflop: a Chen-style score.  Postflop: a rough made-hand strength from its
own little evaluator (the kit's evaluator is NOT importable on the grader).
Draw: throws away the hole card that does least for it.
"""

from collections import Counter

RANK_VALUE = {"2": 2, "3": 3, "4": 4, "5": 5, "6": 6, "7": 7, "8": 8, "9": 9,
              "10": 10, "J": 11, "Q": 12, "K": 13, "A": 14}

STATE = {"hands": 0}


def init(config):
    STATE["hands"] = 0
    STATE["bb_levels"] = [lv["big_blind"] for lv in config["blind_schedule"]]


def r(card):
    return RANK_VALUE[card[:-1]]


def chen(hole):
    a, b = sorted((r(c) for c in hole), reverse=True)
    base = {14: 10, 13: 8, 12: 7, 11: 6}.get(a, a / 2)
    if a == b:
        return max(5, base * 2)
    score = base
    gap = a - b - 1
    score -= [0, 1, 2, 4][gap] if gap < 4 else 5
    if hole[0][-1] == hole[1][-1]:
        score += 2
    if gap <= 1 and a < 12:
        score += 1
    return score


def made_strength(hole, board):
    """0 nothing, 1 weak pair, 2 top pair+, 3 two pair+, 4 straight/flush+."""
    cards = hole + board
    vals = [r(c) for c in cards]
    counts = Counter(vals)
    suits = Counter(c[-1] for c in cards)
    if max(suits.values()) >= 5:
        return 4
    s = set(vals) | ({1} if 14 in vals else set())
    if any(all(t - k in s for k in range(5)) for t in range(5, 15)):
        return 4
    top = sorted(counts.values(), reverse=True)
    if top[0] >= 3 or (len(top) > 1 and top[0] == 2 and top[1] == 2):
        # make sure we contribute
        hv = {r(c) for c in hole}
        if any(counts[v] >= 2 for v in hv):
            return 3
    board_top = max(r(c) for c in board) if board else 0
    for c in hole:
        if counts[r(c)] >= 2:
            return 2 if r(c) >= board_top else 1
    return 0


def get_action(state):
    hole = state["hole_cards"]          # re-read every time: the draw changes it
    board = state["board"]
    if state["type"] == "draw":
        board_vals = {r(c) for c in board}
        if r(hole[0]) == r(hole[1]):
            return {"discard": None}
        flush_suit = Counter(c[-1] for c in board + hole).most_common(1)[0]
        keep = [c for c in hole if r(c) in board_vals
                or (flush_suit[1] >= 4 and c[-1] == flush_suit[0])]
        junk = [c for c in hole if c not in keep]
        if len(junk) == 1 or (len(junk) == 2 and min(r(c) for c in junk) < 10):
            return {"discard": min(junk, key=r)}
        return {"discard": None}

    me = state["players"][state["my_seat"]]
    to_call = state["current_bet"] - me["chips_in_pot_this_round"]
    bb = state["big_blind"]
    behind = me["chips_total"] - me["chips_in_pot_this_round"]
    pot_now = state["pot"] + sum(p["chips_in_pot_this_round"]
                                 for p in state["players"])

    if state["street"] == "preflop":
        score = chen(hole)
        if score >= 10 and state["can_raise"]:
            return {"action": "raise", "amount": 3 * bb}
        if score >= 8 and to_call <= 4 * bb:
            return {"action": "call"}
        if to_call <= 0:
            return {"action": "check"}
        if score >= 7 and to_call <= bb:
            return {"action": "call"}
        return {"action": "fold"}

    strength = made_strength(hole, board)
    if strength >= 3 and state["can_raise"]:
        return {"action": "raise", "amount": max(state["min_raise_by"],
                                                 pot_now // 2)}
    if to_call <= 0:
        if strength >= 2 and state["can_raise"]:
            return {"action": "raise", "amount": max(state["min_raise_by"],
                                                     pot_now // 3)}
        return {"action": "check"}
    if strength >= 2 or (strength == 1 and to_call * 4 <= pot_now):
        return {"action": "call"}
    if to_call >= behind:
        return {"action": "fold"}
    return {"action": "fold"}


def on_hand_end(summary):
    STATE["hands"] += 1
