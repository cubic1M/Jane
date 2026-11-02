"""Hand features shared by the field-4 bots: preflop class and postflop buckets.

Preflop class index (0..168) on a 13x13 grid: pair r -> r*13+r; suited (hi, lo) ->
hi*13+lo; offsuit (hi, lo) -> lo*13+hi.

Postflop key = (made, draw, texture), see `post_features`. The equity of each key
against k random hands was measured offline (build_tables.py).
"""
from __future__ import annotations

from .fasteval import CK, RBIT, STRAIGHT_TOP, score_key

RANKS = "23456789TJQKA"


def hand_class(hole) -> int:
    a, b = hole[0], hole[1]
    ra, rb = a >> 2, b >> 2
    if ra == rb:
        return ra * 13 + ra
    hi, lo = (ra, rb) if ra > rb else (rb, ra)
    if (a & 3) == (b & 3):
        return hi * 13 + lo
    return lo * 13 + hi


def class_info(cls: int):
    """(hi rank, lo rank, suited, pair)"""
    r, c = divmod(cls, 13)
    if r == c:
        return r, r, False, True
    if r > c:
        return r, c, True, False
    return c, r, False, False


def class_name(cls: int) -> str:
    hi, lo, s, p = class_info(cls)
    return RANKS[hi] + RANKS[lo] + ("" if p else ("s" if s else "o"))


def class_from_name(name: str) -> int:
    hi, lo = RANKS.index(name[0]), RANKS.index(name[1])
    if hi == lo:
        return hi * 13 + hi
    if hi < lo:
        hi, lo = lo, hi
    return hi * 13 + lo if name.endswith("s") else lo * 13 + hi


def combos_of(cls: int) -> int:
    hi, lo, s, p = class_info(cls)
    return 6 if p else (4 if s else 12)


# ---- postflop ---------------------------------------------------------------------------
N_MADE, N_DRAW, N_TEX = 19, 5, 12
MADE_NAMES = ("nothing", "one_over", "two_over", "pair_low", "pair_mid", "top_weak", "top_good",
              "overpair", "two_pair_bp_low", "two_pair", "two_pair_bp_high", "trips", "set",
              "straight1", "straight2", "flush_low", "flush_high", "full_house", "quads_plus")

# straight completion: ranks mask -> has straight (top >= 0)
_WINDOWS = []
for _top in range(4, 13):
    _WINDOWS.append(sum(1 << r for r in range(_top - 4, _top + 1)))
_WINDOWS.append((1 << 12) | 0b1111)  # wheel


def _straight_outs(mask: int, board_mask: int) -> int:
    """Number of ranks that complete a straight using the hole cards (not the board alone)."""
    n = 0
    for x in range(13):
        b = 1 << x
        if mask & b:
            continue
        if STRAIGHT_TOP[mask | b] >= 0 and STRAIGHT_TOP[board_mask | b] < 0:
            n += 1
    return n


def _connected3(board_mask: int) -> bool:
    for w in _WINDOWS:
        if bin(board_mask & w).count("1") >= 3:
            return True
    return False


def post_features(hole, board):
    """Returns (made, draw, tex, my_score)."""
    cards = list(hole) + list(board)
    key = 0
    for c in cards:
        key += CK[c]
    sc = score_key(key, cards)
    cat = sc >> 20
    nb = len(board)
    h1, h2 = hole[0] >> 2, hole[1] >> 2
    bcnt = [0] * 13
    bsuit = [0, 0, 0, 0]
    bmask = 0
    for c in board:
        bcnt[c >> 2] += 1
        bsuit[c & 3] += 1
        bmask |= RBIT[c]
    branks = sorted({c >> 2 for c in board}, reverse=True)
    top = branks[0]
    second = branks[1] if len(branks) > 1 else -1
    bmax = max(bcnt)
    bpairs = sum(1 for v in bcnt if v >= 2)
    if bmax >= 3:
        bcat = 3
    elif bpairs >= 2:
        bcat = 2
    elif bpairs == 1:
        bcat = 1
    else:
        bcat = 0
    overs = (h1 > top) + (h2 > top)

    def nothing():
        return overs if overs < 2 else 2

    def pair_class(pr, kicker):
        if h1 == h2 and pr > top:
            return 7
        if pr == top:
            return 6 if kicker >= 8 else 5
        if pr >= second:
            return 4
        return 3

    board_score = None
    if nb == 5:
        bkey = 0
        for c in board:
            bkey += CK[c]
        board_score = score_key(bkey, board)
    if board_score is not None and sc == board_score:
        made = nothing()
    elif cat == 1:
        made = nothing()
    elif cat == 2:
        if bcat >= 1:
            made = nothing()
        else:
            pr = h1 if h1 == h2 or bcnt[h1] else h2
            made = pair_class(pr, h2 if pr == h1 else h1)
    elif cat == 3:
        if bcat == 0:
            made = 9
        elif bcat == 1:
            # my pair (pocket pair or a hole card pairing an unpaired board rank)
            if h1 == h2:
                pr = h1
            elif bcnt[h1] == 1:
                pr = h1
            elif bcnt[h2] == 1:
                pr = h2
            else:
                pr = -1
            if pr < 0:
                made = nothing()
            else:
                unp = [r for r in branks if bcnt[r] == 1]
                made = 10 if (not unp or pr >= unp[0]) else 8
        else:
            made = nothing() if max(h1, h2) < 10 else 1
    elif cat == 4:
        if bcat == 3:
            made = nothing()
        elif h1 == h2:
            made = 12
        else:
            made = 11
    elif cat == 5:
        hm = RBIT[hole[0]] | RBIT[hole[1]]
        both = STRAIGHT_TOP[bmask | hm] >= 0 and STRAIGHT_TOP[bmask | RBIT[hole[0]]] < 0 \
            and STRAIGHT_TOP[bmask | RBIT[hole[1]]] < 0
        made = 14 if both else 13
    elif cat == 6:
        hi = max(h1 if (hole[0] & 3) == max(range(4), key=lambda u: bsuit[u]) else -1,
                 h2 if (hole[1] & 3) == max(range(4), key=lambda u: bsuit[u]) else -1)
        made = 16 if hi >= 10 else 15
    elif cat == 7:
        made = 17
    else:
        made = 18

    draw = 0
    if nb < 5 and cat < 5:
        fd = False
        for u in range(4):
            if bsuit[u] + ((hole[0] & 3) == u) + ((hole[1] & 3) == u) >= 4 and bsuit[u] < 4 and (
                    (hole[0] & 3) == u or (hole[1] & 3) == u):
                fd = True
        so = _straight_outs(bmask | RBIT[hole[0]] | RBIT[hole[1]], bmask)
        sd = 2 if so >= 2 else (1 if so == 1 else 0)
        if fd:
            draw = 4 if sd else 3
        else:
            draw = sd
    fs = max(bsuit)
    f = 2 if fs >= 3 else (1 if fs == 2 and nb < 5 else 0)
    tex = f * 4 + (2 if bcat >= 1 else 0) + (1 if _connected3(bmask) else 0)
    return made, draw, tex, sc


def post_index(street: int, made: int, draw: int, tex: int) -> int:
    return (((street - 1) * N_MADE + made) * N_DRAW + draw) * N_TEX + tex
