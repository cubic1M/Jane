"""Plan B bot for practice kit 3 (Pitch Hold'em). Safe version (prompt 1)."""
import random


def _r(c):
    return c % 13


def raise_str(chips, bb):
    """'r x' with x in bb, rounded UP to a 0.5 bb step (so all-in really is all-in)."""
    half = -(-int(chips) * 2 // bb)
    return "r %.1f" % (half / 2.0)


def keep_score(a, b):
    ra, rb = a % 13, b % 13
    hi, lo = (ra, rb) if ra >= rb else (rb, ra)
    s = hi * 2 + lo
    if ra == rb:
        s += 40 + ra * 2
    if a // 13 == b // 13:
        s += 4
    if 0 < hi - lo <= 2:
        s += 2
    return s


def best_discard(cards):
    best, out = None, cards[0]
    for i in range(len(cards)):
        keep = [c for j, c in enumerate(cards) if j != i]
        sc = keep_score(keep[0], keep[1])
        if best is None or sc > best:
            best, out = sc, cards[i]
    return out


def push_hand(cards):
    """77+, AK, AQ, AJs among any two of the hole cards."""
    n = len(cards)
    for i in range(n):
        for j in range(i + 1, n):
            a, b = cards[i], cards[j]
            ra, rb = a % 13, b % 13
            if ra == rb and ra >= 5:
                return True
            hi, lo = max(ra, rb), min(ra, rb)
            if hi == 12 and (lo >= 10 or (lo == 9 and a // 13 == b // 13)):
                return True
    return False


class Agent:
    def __init__(self):
        self.rng = random.Random(12345)
        self.me = None

    def on_table_start(self, info):
        self.me = info.get("your_id")
        self.rng = random.Random(sum(ord(ch) * 31 ** i for i, ch in enumerate(str(info.get("table_id", "")) + str(self.me))))

    def on_discard_request(self, state):
        hole = state["hole_cards"]
        try:
            c = best_discard(hole)
            if c in hole:
                return c
        except Exception:
            pass
        return hole[0]

    def on_action_request(self, state):
        try:
            return self.decide(state)
        except Exception:
            return "c" if state.get("to_call", 1) == 0 else "f"

    def decide(self, st):
        bb = st["bb"]
        free = st["to_call"] == 0
        if st["street"] == "preflop" and st["can_raise"]:
            depth = (st["stack"] + st["your_bet"]) / bb
            if depth <= 10 and st["current_bet"] <= bb and push_hand(st["hole_cards"]):
                return raise_str(st["max_raise_to"], bb)
        return "c" if free else "f"
