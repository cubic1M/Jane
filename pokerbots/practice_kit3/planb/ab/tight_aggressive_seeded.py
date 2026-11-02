"""Sample bot: plays few hands, raises them, bets made hands, gives up otherwise."""

import random


def rank(c):
    return c % 13


def suit(c):
    return c // 13


def keep_value(a, b):
    ra, rb = rank(a), rank(b)
    v = max(ra, rb) * 2 + min(ra, rb)
    if ra == rb:
        v += 30 + ra * 2
    if suit(a) == suit(b):
        v += 4
    return v


def best_pair(cards):
    best = None
    for i in range(3):
        keep = [c for j, c in enumerate(cards) if j != i]
        v = keep_value(*keep)
        if best is None or v > best[0]:
            best = (v, cards[i])
    return best


def bb_str(chips, bb):
    return "r %.1f" % (round(chips * 2 / bb) / 2)


class Agent:
    def __init__(self):
        self.rng = random.Random()
        self.opp_discards = {}

    def on_table_start(self, info):
        s = 0
        for ch in str(info["table_id"]) + str(info["your_id"]):
            s = s * 131 + ord(ch)
        self.rng = random.Random(s)

    def on_hand_start(self, hand):
        self.opp_discards = {}

    def on_event(self, event):
        if event["type"] == "discard":
            self.opp_discards[event["player"]] = event["card"]

    def on_discard_request(self, state):
        return best_pair(state["hole_cards"])[1]

    def strength(self, state):
        hole, board = state["hole_cards"], state["board"]
        if state["street"] == "preflop":
            return best_pair(hole)[0] / 70.0
        hr = [rank(c) for c in hole]
        br = [rank(c) for c in board]
        s = 0.0
        if hr[0] == hr[1]:
            s = 0.55 + (0.3 if hr[0] > max(br) else 0.0)
        for r in hr:
            n = br.count(r)
            if n == 1:
                s = max(s, 0.5 + (0.3 if r == max(br) else 0.0))
            elif n >= 2:
                s = max(s, 0.95)
        suits = [suit(c) for c in hole + board]
        if max(suits.count(x) for x in range(4)) >= 5:
            s = max(s, 0.9)
        return s

    def on_action_request(self, state):
        bb, pot, to_call = state["bb"], state["pot"], state["to_call"]
        s = self.strength(state)
        if state["street"] == "preflop":
            if s >= 0.75 and state["can_raise"]:
                return bb_str(max(3 * state["current_bet"], 3 * bb), bb)
            if s >= 0.6 and to_call <= 3 * bb:
                return "c"
            return "c" if to_call == 0 else "f"
        if s >= 0.8 and state["can_raise"]:
            return bb_str(state["your_bet"] + to_call + 0.75 * (pot + to_call), bb)
        if s >= 0.5:
            return "c" if to_call <= 0.6 * pot else "f"
        if to_call == 0:
            if state["can_raise"] and self.rng.random() < 0.15:
                return bb_str(pot * 0.5, bb)
            return "c"
        return "f"
