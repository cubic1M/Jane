"""Preflop: all-in with a playable hand, fold the rest. Postflop: check/fold."""
NAME = "shove monkey"
VAL = {r: i for i, r in enumerate("6789TJQKA", 6)}


def play(view, memory):
    if view["street"] > 0:
        return 0 if view["owe"] == 0 else -1
    (a, sa), (b, sb) = view["hole"]
    hi, lo = sorted((VAL[a], VAL[b]), reverse=True)
    score = hi + lo + (12 if hi == lo else 0) + (2 if sa == sb else 0) - (hi - lo > 3) * 3
    stack_bb = view["max_add"] / view["bb"]
    need = 21 if stack_bb > 25 else 18 if stack_bb > 12 else 15
    if score >= need:
        return view["max_add"]
    return 0 if view["owe"] == 0 else -1
