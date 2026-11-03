"""A decent house bot that knows the Six-Plus rules.

Push/fold when short, position-aware opens, hand-strength postflop play with
the short-deck ranking (flush > full house, trips > straight, A-6-7-8-9).
"""
NAME = "sixplus shark"
VAL = {r: i for i, r in enumerate("6789TJQKA", 6)}
# category order used by this bot, worst to best
ORDER = ["high", "pair", "two pair", "straight", "trips", "full house",
         "flush", "quads", "straight flush"]
RANK = {k: i for i, k in enumerate(ORDER)}
LOW_STRAIGHT = (14, 6, 7, 8, 9)          # A-6-7-8-9 plays as 9-high


def straight_high(vs):
    for hi in range(14, 9, -1):
        if all(v in vs for v in range(hi - 4, hi + 1)):
            return hi
    return 9 if all(v in vs for v in LOW_STRAIGHT) else 0


def category(cards):
    """Rank of the best category in 3-7 cards (no kickers; enough for us)."""
    vals = [VAL[c[0]] for c in cards]
    suits = {}
    for c in cards:
        suits.setdefault(c[1], []).append(VAL[c[0]])
    best = "high"
    counts = sorted((vals.count(v) for v in set(vals)), reverse=True)
    if counts[0] == 4:
        best = "quads"
    elif counts[0] == 3 and len(counts) > 1 and counts[1] >= 2:
        best = "full house"
    elif counts[0] == 3:
        best = "trips"
    elif counts[0] == 2 and len(counts) > 1 and counts[1] == 2:
        best = "two pair"
    elif counts[0] == 2:
        best = "pair"
    if straight_high(set(vals)) and RANK["straight"] > RANK[best]:
        best = "straight"
    for vs in suits.values():
        if len(vs) >= 5:
            cand = "straight flush" if straight_high(set(vs)) else "flush"
            if RANK[cand] > RANK[best]:
                best = cand
    return RANK[best]


def draws(hole, board):
    cards = hole + board
    flush = any(sum(c[1] == s for c in cards) == 4 and any(h[1] == s for h in hole)
                for s in "cdhs")
    vs = set(VAL[c[0]] for c in cards)
    if 14 in vs:
        vs.add(5)                         # ace below the six for A-6-7-8-9
    straight = any(sum(v in vs for v in range(lo, lo + 5)) == 4 for lo in range(5, 11))
    return flush, straight


def preflop_score(hole):
    (a, sa), (b, sb) = hole
    hi, lo = sorted((VAL[a], VAL[b]), reverse=True)
    if hi == lo:
        return 20 + 2 * hi
    gap = hi - lo - 1
    return hi * 1.2 + lo + (3 if sa == sb else 0) + (3, 2, 1, 0, 0, 0, 0, 0)[gap]


def raise_to(view, total, me):
    """Chips to add so that my street bet becomes `total` (or a shove)."""
    add = total - me["bet"]
    if view["min_add"] is None:
        return view["owe"]
    add = max(add, view["min_add"])
    if add * 2 >= view["max_add"]:
        add = view["max_add"]
    return add


def play(view, memory):
    me = view["seats"][view["me"] - 1]
    owe, bb, pot = view["owe"], view["bb"], view["pot"]
    live = [s for s in view["seats"] if s["status"] in ("in", "allin")]
    others = [s for s in live if s["seat"] != view["me"]]
    biggest = max((s["stack"] + s["bet"] for s in others), default=0)
    eff_bb = min(me["stack"] + me["bet"], biggest) / bb
    if view["street"] == 0:
        return preflop(view, memory, me, eff_bb)
    return postflop(view, memory, me, others)


def preflop(view, memory, me, eff_bb):
    owe, bb = view["owe"], view["bb"]
    score = preflop_score(view["hole"])
    dealt = [s["seat"] for s in view["seats"] if s["status"] != "out"]
    n = len(dealt)
    i = dealt.index(view["button"])
    clockwise = dealt[i + 1:] + dealt[:i + 1]
    late = clockwise.index(view["me"]) >= n - 3
    current = me["bet"] + owe
    raised = current > bb
    if eff_bb <= 12:
        need = 30 if raised else (22 if late else 26)
        if score >= need:
            return view["max_add"]
        return 0 if owe == 0 else -1
    if not raised:
        need = 26 if late else 30
        if score >= need:
            memory["aggr"] = view["hand"]
            return raise_to(view, int(2.5 * bb), me)
        return 0 if owe == 0 else (owe if score >= 24 and owe <= bb // 2 else -1)
    if score >= 40:
        memory["aggr"] = view["hand"]
        return raise_to(view, 3 * current, me)
    if score >= 32 and owe <= 0.12 * (me["stack"] + me["bet"]):
        return owe
    return 0 if owe == 0 else -1


def postflop(view, memory, me, others):
    owe, pot = view["owe"], view["pot"]
    hole, board = view["hole"], view["board"]
    mine, table = category(hole + board), category(board)
    improves = mine > table
    bvals = [VAL[c[0]] for c in board]
    hvals = [VAL[c[0]] for c in hole]
    top_pair = mine == RANK["pair"] and improves and (
        max(bvals) in hvals or (hvals[0] == hvals[1] and hvals[0] > max(bvals)))
    flush_d, straight_d = draws(hole, board) if view["street"] < 3 else (False, False)
    can_bet = view["min_add"] is not None
    if improves and mine >= RANK["straight"]:
        if can_bet:
            return raise_to(view, me["bet"] + owe + max(3 * owe, (pot * 3) // 4), me)
        return owe
    if improves and mine >= RANK["two pair"]:
        if owe == 0:
            return raise_to(view, (pot * 3) // 5, me) if can_bet else 0
        return owe if owe <= pot else -1
    if top_pair:
        if owe == 0:
            return raise_to(view, pot // 2, me) if can_bet and len(others) <= 2 else 0
        return owe if owe * 2 <= pot else -1
    if flush_d or straight_d:
        if owe == 0:
            semi = memory.get("aggr") == view["hand"] and view["street"] == 1
            return raise_to(view, pot // 2, me) if semi and can_bet else 0
        return owe if owe * 3 <= pot + owe else -1
    if owe == 0:
        cbet = (memory.get("aggr") == view["hand"] and view["street"] == 1
                and len(others) <= 2 and can_bet)
        return raise_to(view, pot // 3, me) if cbet else 0
    return -1
