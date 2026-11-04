"""Plan B5 bot for practice kit 4 (Six-Plus hold'em, 36 cards).

Built from the Plan B prompts: preflop class table, postflop
(street, my category, board category, k) table, ICM-ish margins.
"""
import bisect
import math
import random
from collections import Counter

NAME = "PlanB5"

# ---- parameters (named constants) ----
OPEN_BAR = 1.07
OPEN_BAR_HU = 0.60
RAISER_K = 4.0
RAISER_K_HU = 2.0
CALLER_K = 0.8
TO_ACT_K = 0.2
PUSH_DEPTH = 9.0
RESHOVE_DEPTH = 28.0
RERAISE = 2.6
RERAISE_SHOVE_DEPTH = 24.0
CALL_MARGIN = 0.06
ICM_PREMIUM = 0.10
ICM_SLOPE = 0.15
PRE_BIG_CALL = 0.40
POST_BIG_CALL = 0.50
VALUE_BET_EQ = 0.62
VALUE_BET_FRAC = 0.65
CBET_FRAC = 0.50
CBET_FREQ = 0.55
STAB_FREQ = 0.40
LOCK_OPENS = 20
LOCK_RATE = 0.30
LOCK_P = (0.40, 0.33, 0.23, 0.17, 0.14, 0.12, 0.11)

DEBUG = False          # switched on by planb5/harness.py, never by env vars
DEBUG_PROBLEMS = []

RANKCH = "6789TJQKA"
RV = {r: i + 6 for i, r in enumerate(RANKCH)}
DECK = [r + s for r in RANKCH for s in "cdhs"]
STARTING_STACK = 2000
FULL_DECK = False      # attacked-opens lock only on a 52-card deck

#TABLES#

# ---- table helpers ----
_POST_AVG = {}
for _k, _v in POST.items():
    _a = (_k // 1000, (_k // 100) % 10, _k % 10)
    _e = _POST_AVG.setdefault(_a, [0, 0])
    _e[0] += _v
    _e[1] += 1
_POST_AVG = {k: v[0] / v[1] for k, v in _POST_AVG.items()}


def _cls(c1, c2):
    r1, r2 = RV[c1[0]], RV[c2[0]]
    if r1 < r2:
        r1, r2 = r2, r1
    a, b = RANKCH[r1 - 6], RANKCH[r2 - 6]
    if r1 == r2:
        return a + b + "p"
    return a + b + ("s" if c1[1] == c2[1] else "o")


def _pre_eq_int(c, k):
    row = PRE.get(c)
    if row is None:
        return 1.0 / (k + 1)
    return row[k - 1] / 1e4


def _pre_eq(c, k):
    """Preflop equity, linear interpolation between integer k."""
    if k <= 1:
        return _pre_eq_int(c, 1)
    if k >= 7:
        return _pre_eq_int(c, 7)
    lo = int(k)
    fr = k - lo
    e = _pre_eq_int(c, lo)
    if fr > 1e-9:
        e += fr * (_pre_eq_int(c, lo + 1) - e)
    return e


def _post_eq(street, cat, bcat, k):
    k = max(1, min(7, k))
    v = POST.get(street * 1000 + cat * 100 + bcat * 10 + k)
    if v is not None:
        return v / 1e4
    v = _POST_AVG.get((street, cat, k))
    if v is not None:
        return v / 1e4
    return 1.0 / (k + 1)


def _straight(vals):
    for hi in range(14, 9, -1):
        if all(v in vals for v in range(hi - 4, hi + 1)):
            return True
    return {14, 6, 7, 8, 9} <= vals


def category(cards):
    """Six-Plus category of 5-7 cards, numbered like the kit (0 high .. 8 SF)."""
    vals = [RV[c[0]] for c in cards]
    suits = Counter(c[1] for c in cards)
    fs = None
    for s, n in suits.items():
        if n >= 5:
            fs = s
    if fs is not None and _straight({RV[c[0]] for c in cards if c[1] == fs}):
        return 8
    cnt = sorted(Counter(vals).values(), reverse=True)
    if cnt[0] == 4:
        return 7
    if fs is not None:
        return 6
    if cnt[0] == 3:
        return 5 if len(cnt) > 1 and cnt[1] >= 2 else 4
    if _straight(set(vals)):
        return 3
    if cnt[0] == 2:
        return 2 if len(cnt) > 1 and cnt[1] == 2 else 1
    return 0


def board_category(board):
    if len(board) >= 5:
        return category(board)
    cnt = sorted(Counter(c[0] for c in board).values(), reverse=True)
    if cnt[0] == 4:
        return 7
    if cnt[0] == 3:
        return 4
    if cnt[0] == 2:
        return 2 if len(cnt) > 1 and cnt[1] == 2 else 1
    return 0


# percentile table: top share of each starting hand (fraction with higher equity)
TOP = {}


def _build_top():
    hands = [(DECK[i], DECK[j]) for i in range(len(DECK)) for j in range(i + 1, len(DECK))]
    eqs = sorted(_pre_eq_int(_cls(a, b), 1) for a, b in hands)
    n = len(eqs)

    for c in PRE:
        e = _pre_eq_int(c, 1)
        TOP[c] = (n - bisect.bisect_right(eqs, e)) / n


_build_top()


def setup(rules):
    global FULL_DECK
    try:
        FULL_DECK = len(rules.get("deck", ())) >= 52
    except Exception:
        pass


# ---- log parsing ----
def _tokens(log):
    """List of streets; each a list of (seat, code, amount)."""
    streets = [[]]
    for t in log.split():
        if t[0] == "|":
            streets.append([])
            continue
        if t[-1] == "!":
            t = t[:-1]
        amt = int(t[2:]) if len(t) > 2 else 0
        streets[-1].append((int(t[0]), t[1], amt))
    return streets


def _rate(d, seat, prior_a, prior_b):
    e = d.get(seat)
    if e is None:
        return prior_a / prior_b
    return (e[0] + prior_a) / (e[1] + prior_b)


def _bump(d, seat, hit):
    e = d.get(seat)
    if e is None:
        e = d[seat] = [0, 0]
    e[1] += 1
    if hit:
        e[0] += 1


def _process(memory, lh, me):
    """Update per-seat stats from the previous hand's public log."""
    streets = _tokens(lh.get("log") or "")
    pre = streets[0]
    dealt = memory["dealt"]
    for s in {x[0] for x in pre}:
        dealt[s] = dealt.get(s, 0) + 1
    raises = [i for i, x in enumerate(pre) if x[1] == "r"]
    if raises:
        i0 = raises[0]
        opener = pre[i0][0]
        memory["opens"][opener] = memory["opens"].get(opener, 0) + 1
        end = raises[1] if len(raises) > 1 else len(pre)
        seen = set()
        for s, c, a in pre[i0 + 1:end + 1 if len(raises) > 1 else end]:
            if s == opener or s in seen:
                continue
            seen.add(s)
            _bump(memory["fold_open"], s, c == "f")
            _bump(memory["rr_lone"], s, c == "r")
        if len(raises) > 1:
            for s, c, a in pre[raises[1] + 1:]:
                if s == opener:
                    _bump(memory["fold_3b"], opener, c == "f")
                    break
            if opener == me:
                memory["my_reraised"] += 1
        if opener == me:
            memory["my_opens"] += 1
    for st in streets[1:]:
        first = None
        seen = set()
        for i, (s, c, a) in enumerate(st):
            if first is None:
                if c == "r":
                    first = s
                continue
            if s == first or s in seen:
                continue
            seen.add(s)
            _bump(memory["fold_bet"], s, c == "f")


def _init(memory, view):
    memory["init"] = True
    memory["dealt"] = {}
    memory["opens"] = {}
    memory["fold_open"] = {}
    memory["rr_lone"] = {}
    memory["fold_3b"] = {}
    memory["fold_bet"] = {}
    memory["my_opens"] = 0
    memory["my_reraised"] = 0
    memory["locked"] = False
    memory["seen_hand"] = 0
    memory["rng"] = random.Random("planb5:%d:%d:%s" % (
        view["me"], view["button"], "".join(view["hole"])))


def _open_rate(memory, s):
    v = (memory["opens"].get(s, 0) + 0.96) / (memory["dealt"].get(s, 0) + 8)
    return min(0.7, max(0.04, v))


# ---- the decision ----
def _raise_to(view, to):
    """Chips to add to make the bet 'to' this street, within the kit's bounds."""
    me = view["seats"][view["me"] - 1]
    if view["min_add"] is None:
        return view["owe"]
    add = max(view["min_add"], int(to) - me["bet"])
    return min(add, view["max_add"])


def _add_bet(view, frac):
    if view["min_add"] is None:
        return 0
    add = max(view["min_add"], int(frac * view["pot"]))
    return min(add, view["max_add"])


def _premium(left):
    return ICM_PREMIUM * (1 + ICM_SLOPE * (8 - left))


def _decide(view, memory):
    if "init" not in memory:
        _init(memory, view)
    me = view["me"]
    lh = view.get("last_hand")
    if lh and lh.get("hand", 0) > memory["seen_hand"]:
        memory["seen_hand"] = lh["hand"]
        _process(memory, lh, me)
    seats = view["seats"]
    my = seats[me - 1]
    owe, bb, pot = view["owe"], view["bb"], view["pot"]
    stack = view["max_add"]
    rng = memory["rng"]
    opps = [x for x in seats if x["seat"] != me and x["status"] in ("in", "allin")]
    left = sum(1 for x in seats if x["status"] != "out")
    heads_up_table = left == 2
    big = max((x["stack"] + x["bet"] for x in opps), default=0)
    eff = min(stack + my["bet"], big) / bb
    streets = _tokens(view["log"])
    cur = streets[-1]
    acted = {s for s, c, a in cur if c in "fkcr"}
    to_act = [x["seat"] for x in opps if x["status"] == "in" and x["seat"] not in acted]
    call = min(owe, stack)
    street = view["street"]
    hole = view["hole"]

    if street == 0:
        c = _cls(hole[0], hole[1])
        raises = [i for i, x in enumerate(cur) if x[1] == "r"]
        if not raises:
            limpers = len({s for s, cc, a in cur if cc == "c" and s != me})
            k = max(1, min(7, len(to_act) + limpers))
            eq = _pre_eq(c, k)
            steal = 1.0
            if 1 <= len(to_act) <= 5 and limpers == 0:
                f = sum(_rate(memory["fold_open"], s, 1, 2) for s in to_act) / len(to_act)
                steal = 1 - 0.55 * max(0.0, 2 * f - 1)
            if eff <= PUSH_DEPTH:
                if eq >= (0.75 + 0.25 * eff / PUSH_DEPTH) / (k + 1) * (1 + 0.5 * (steal - 1)):
                    return stack
                return 0 if owe == 0 else -1
            if (not memory["locked"] and FULL_DECK and memory["my_opens"] >= LOCK_OPENS
                    and memory["my_reraised"] >= LOCK_RATE * memory["my_opens"]):
                memory["locked"] = True
            if memory["locked"]:
                kk = max(1, min(7, len(to_act) + limpers))
                ok = TOP.get(c, 1.0) <= 1.3 * LOCK_P[kk - 1] / steal
            else:
                bar = OPEN_BAR_HU if heads_up_table else OPEN_BAR
                ok = eq >= bar / (k + 1) * steal
            if ok:
                return _raise_to(view, (2 + limpers) * bb)
            return 0 if owe == 0 else -1
        # facing a raise
        i0 = raises[0]
        opener = cur[i0][0]
        after = cur[i0 + 1:]
        callers = [s for s, cc, a in after if cc == "c"]
        opener_st = seats[opener - 1]["status"]
        if (len(raises) == 1 and not callers and opener_st == "in"
                and eff <= RESHOVE_DEPTH and opener != me):
            f = _rate(memory["fold_3b"], opener, 3.9, 6)
            m = min(1.6, max(0.4, f / 0.65))
            if TOP.get(c, 1.0) <= max(0.03, _open_rate(memory, opener) * m):
                return stack
        last_raiser = cur[raises[-1]][0]
        base = RAISER_K_HU if heads_up_table else RAISER_K
        rk = base
        if (opener == me and len(raises) == 2 and not callers
                and seats[last_raiser - 1]["status"] == "allin"):
            r = _rate(memory["rr_lone"], last_raiser, 0.7, 10)
            cc = min(0.5, 2 * r)
            kc = max(1.0, min(7.0, 1 + 0.65 * math.log2(0.5 / cc)))
            rk = min(base, kc)
        others = {s for s, cc, a in cur if cc in "cr" and s != me and s != last_raiser
                  and seats[s - 1]["status"] in ("in", "allin")}
        kf = rk + CALLER_K * len(others) + TO_ACT_K * len(
            [s for s in to_act if s not in others and s != last_raiser])
        eq = _pre_eq(c, kf)
        if eq * (kf + 1) >= RERAISE and view["min_add"] is not None:
            if eff <= RERAISE_SHOVE_DEPTH:
                return stack
            curbet = max(x["bet"] for x in seats)
            return _raise_to(view, 3 * curbet)
        need = call / (pot + call) + CALL_MARGIN
        if call >= stack or call > PRE_BIG_CALL * stack:
            need += _premium(left)
        if eq >= need:
            return call
        return -1

    # ---- postflop ----
    key = (view["hand"], street)
    cache = memory.get("cat")
    if cache is None or cache[0] != key:
        board = view["board"]
        cache = memory["cat"] = (key, category(hole + board), board_category(board))
    k = max(1, min(7, len(opps)))
    eq = _post_eq(street, cache[1], cache[2], k)
    if owe > 0:
        nb = sum(1 for s, cc, a in cur if cc == "r")
        adj = eq * (0.5 ** nb)
        need = call / (pot + call) + CALL_MARGIN
        if call >= POST_BIG_CALL * stack:
            need += _premium(left)
        return call if adj >= need else -1
    if view["min_add"] is None:
        return 0
    if eq >= VALUE_BET_EQ:
        return _add_bet(view, VALUE_BET_FRAC)
    pre = streets[0]
    pre_raisers = [s for s, cc, a in pre if cc == "r"]
    if street == 1 and k == 1 and pre_raisers and pre_raisers[-1] == me:
        if rng.random() < CBET_FREQ:
            return _add_bet(view, CBET_FRAC)
        return 0
    if 1 <= k <= 2:
        f = sum(_rate(memory["fold_bet"], x["seat"], 1, 2) for x in opps) / k
        if rng.random() < STAB_FREQ * max(0.0, 2 * f - 1):
            return _add_bet(view, CBET_FRAC)
    return 0


def _check(view, memory, r):
    """Debug-mode invariants (prompt 4)."""
    seats = view["seats"]
    tot = sum(x["total"] for x in seats)
    if tot != view["pot"]:
        DEBUG_PROBLEMS.append("pot %d != sum totals %d" % (view["pot"], tot))
    chips = sum(x["stack"] + x["total"] for x in seats)
    if chips != STARTING_STACK * len(seats):
        DEBUG_PROBLEMS.append("chips %d != %d" % (chips, STARTING_STACK * len(seats)))
    log_sum = sum(a for st in _tokens(view["log"]) for s, c, a in st)
    if log_sum != view["pot"]:
        DEBUG_PROBLEMS.append("log sum %d != pot %d" % (log_sum, view["pot"]))
    owe, mn, mx = view["owe"], view["min_add"], view["max_add"]
    if type(r) is not int:
        DEBUG_PROBLEMS.append("non-int reply %r" % (r,))
    elif r > 0 and r != min(owe, mx) and r != owe:
        if mn is None and r != mx:
            DEBUG_PROBLEMS.append("raise %d when raising not allowed" % r)
        elif mn is not None and not (mn <= r <= mx) and r != mx:
            DEBUG_PROBLEMS.append("raise %d outside [%s, %d]" % (r, mn, mx))
    if r < 0 and owe == 0:
        DEBUG_PROBLEMS.append("fold when check is free")


def play(view, memory):
    try:
        r = int(_decide(view, memory))
        if r < 0 and view["owe"] == 0:
            r = 0
        if DEBUG:
            _check(view, memory, r)
        return r
    except Exception as e:
        if DEBUG:
            DEBUG_PROBLEMS.append("exception %r" % (e,))
        try:
            return 0 if view["owe"] == 0 else -1
        except Exception:
            return -1
