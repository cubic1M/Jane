"""Card-level helpers for the field8 bots (pure Python, no numpy, safe inside act()).

  * hclass: the 169 starting-hand classes (pair r*14, suited hi*13+lo, offsuit lo*13+hi);
  * score: best five-card hand of any 1..7 cards, standard ranking (category = score >> 20);
  * post_key: a postflop description of a two-card hold'em hand on a 3-5 card board
    (made-hand class, draw class, board texture) that indexes the offline equity table
    built by build_tables.py;
  * generic_strength / preflop_generic: rough 0..1 strengths for any other card game.
"""
from __future__ import annotations

from itertools import combinations


def hclass(c1: int, c2: int) -> int:
    r1, r2 = c1 >> 2, c2 >> 2
    if r1 == r2:
        return r1 * 14
    hi, lo = (r1, r2) if r1 > r2 else (r2, r1)
    return hi * 13 + lo if (c1 & 3) == (c2 & 3) else lo * 13 + hi


def class_info(h: int):
    """(high rank, low rank, kind) with kind 0 pair, 1 suited, 2 offsuit."""
    a, b = divmod(h, 13)
    if a == b:
        return a, a, 0
    if a > b:
        return a, b, 1
    return b, a, 2


# ---------------------------------------------------------------------- rank-mask tables
def _build_straights():
    tops = [-1] * 8192
    windows = [((0x1F << (t - 4)), t) for t in range(12, 3, -1)] + [(0x100F, 3)]
    for m in range(8192):
        for w, t in windows:
            if m & w == w:
                tops[m] = t
                break
    return tops


def _build_hi5():
    out = [0] * 8192
    for m in range(8192):
        v = n = 0
        r = 12
        while r >= 0 and n < 5:
            if m >> r & 1:
                v = (v << 4) | r
                n += 1
            r -= 1
        out[m] = v << (4 * (5 - n))
    return out


def _build_window():
    """Most distinct ranks of the mask inside any straight window (wheel included)."""
    wins = [0x1F << s for s in range(9)] + [0x100F]
    return [max((m & w).bit_count() for w in wins) for m in range(8192)]


STRAIGHT_TOP = _build_straights()
HI5 = _build_hi5()
WINDOW = _build_window()


def score(cards) -> int:
    """Best five-card hand of the cards (1..7), standard order; higher is better.
    Categories: 0 high, 1 pair, 2 two pair, 3 trips, 4 straight, 5 flush, 6 full house,
    7 quads, 8 straight flush."""
    cnt = [0] * 13
    suit = [0, 0, 0, 0]
    for c in cards:
        r = c >> 2
        cnt[r] += 1
        suit[c & 3] |= 1 << r
    allm = suit[0] | suit[1] | suit[2] | suit[3]
    flush = -1
    for m in suit:
        if m.bit_count() >= 5:
            t = STRAIGHT_TOP[m]
            if t >= 0:
                return (8 << 20) | (t << 16)
            f = (5 << 20) | HI5[m]
            if f > flush:
                flush = f
    quad = trip = -1
    pairs = []
    for r in range(12, -1, -1):
        k = cnt[r]
        if k >= 4 and quad < 0:
            quad = r
        elif k >= 3 and trip < 0:
            trip = r
        elif k >= 2:
            pairs.append(r)
    if quad >= 0:
        return (7 << 20) | (quad << 16) | ((HI5[allm & ~(1 << quad)] >> 16) << 12)
    if trip >= 0:
        # a second set of trips plays as the pair of a full house
        second = -1
        for r in range(12, -1, -1):
            if r != trip and cnt[r] >= 2:
                second = r
                break
        if second >= 0:
            return (6 << 20) | (trip << 16) | (second << 12)
    if flush >= 0:
        return flush
    t = STRAIGHT_TOP[allm]
    if t >= 0:
        return (4 << 20) | (t << 16)
    if trip >= 0:
        return (3 << 20) | (trip << 16) | ((HI5[allm & ~(1 << trip)] >> 12) << 8)
    if len(pairs) >= 2:
        p1, p2 = pairs[0], pairs[1]
        rest = allm & ~(1 << p1) & ~(1 << p2)
        return (2 << 20) | (p1 << 16) | (p2 << 12) | ((HI5[rest] >> 16) << 8)
    if pairs:
        p1 = pairs[0]
        return (1 << 20) | (p1 << 16) | ((HI5[allm & ~(1 << p1)] >> 8) << 4)
    return HI5[allm]


# ------------------------------------------------------------------------ postflop key
N_MADE = 22
N_DRAW = 6
# made classes (roughly by strength)
MADE_NAMES = ("air_0over", "air_1over", "air_2over", "underpair", "low_pair", "mid_pair",
              "top_pair_weak", "top_pair_mid", "top_pair_top", "overpair", "overpair_big",
              "two_pair", "top_two", "trips_weak", "trips_good", "set", "straight", "nut_straight",
              "flush_low", "flush_high", "nut_flush", "boat_plus")
DRAW_NAMES = ("none", "gutshot", "oesd", "flush_draw", "nut_flush_draw", "combo_draw")
N_KEYS = 3 * N_MADE * N_DRAW * 3 * 3 * 2


def _pair_class(r, ub, other):
    """One hole card of rank r pairs the board (ub = distinct board ranks, high first)."""
    if r == ub[0]:
        kick = other
        best = 12
        while best in ub or best == r:
            best -= 1
        if kick >= best - 1 or kick == 12:
            return 8
        return 7 if kick >= 8 else 6
    if len(ub) > 1 and r == ub[1]:
        return 5
    return 4


def _pocket_class(r, ub):
    if r > ub[0]:
        return 10 if r >= 10 else 9
    if len(ub) > 1 and r > ub[1]:
        return 5
    if r > ub[-1]:
        return 4
    return 3


def made_and_draw(h1: int, h2: int, board):
    """(made class, draw class, board-suit max, board straightness, board paired)."""
    r1, r2 = h1 >> 2, h2 >> 2
    if r1 < r2:
        h1, h2, r1, r2 = h2, h1, r2, r1
    s1, s2 = h1 & 3, h2 & 3
    cntb = [0] * 13
    bsuit = [0, 0, 0, 0]
    bmask = 0
    for c in board:
        r = c >> 2
        cntb[r] += 1
        bsuit[c & 3] += 1
        bmask |= 1 << r
    ub = [r for r in range(12, -1, -1) if cntb[r]]
    bpaired = max(cntb) >= 2
    all_cards = list(board) + [h1, h2]
    s_all = score(all_cards)
    s_b = score(board)
    ca, cb = s_all >> 20, s_b >> 20
    made = -1
    if ca >= 6:
        made = 21 if ca > cb or s_all > s_b else -1
    elif ca == 5:
        if cb == 5 and s_all == s_b:
            made = -1
        else:
            # suit of the flush and my best card in it
            fs = max(range(4), key=lambda u: bsuit[u] + (s1 == u) + (s2 == u))
            mine = max([h >> 2 for h in (h1, h2) if h & 3 == fs], default=-1)
            on_board = 0
            for c in board:
                if c & 3 == fs:
                    on_board |= 1 << (c >> 2)
            higher = sum(1 for r in range(mine + 1, 13) if not on_board >> r & 1)
            made = 20 if higher == 0 else 19 if higher <= 2 else 18
    elif ca == 4:
        if cb == 4 and s_all == s_b:
            made = -1
        else:
            top = (s_all >> 16) & 15
            nut = True
            for t in range(12, top, -1):
                w = (0x1F << (t - 4)) if t >= 4 else 0x100F
                if (bmask & w).bit_count() >= 3:
                    nut = False
                    break
            made = 17 if nut else 16
    if made == -1 and ca < 4:
        if r1 == r2:
            if cntb[r1] == 1:
                made = 15
            elif cntb[r1] >= 2:
                made = 21
            else:
                made = _pocket_class(r1, ub)
        else:
            m1, m2 = cntb[r1], cntb[r2]
            if m1 >= 2 or m2 >= 2:
                kick = r2 if m1 >= 2 else r1
                made = 14 if kick >= 10 else 13
                if (m1 >= 2 and m2 >= 1) or (m2 >= 2 and m1 >= 1):
                    made = 21
            elif m1 and m2:
                made = 12 if (r1 == ub[0] and len(ub) > 1 and r2 == ub[1]) else 11
            elif m1:
                made = _pair_class(r1, ub, r2)
            elif m2:
                made = _pair_class(r2, ub, r1)
    if made == -1:
        made = (r1 > ub[0]) + (r2 > ub[0])
    # draws (flop and turn only)
    draw = 0
    if len(board) < 5 and made < 16:
        fd = nfd = False
        for u in range(4):
            have = (s1 == u) + (s2 == u)
            if have and bsuit[u] + have == 4 and (have == 2 or max(r for r in (r1, r2)) >= 10):
                fd = True
                on_board = 0
                for c in board:
                    if c & 3 == u:
                        on_board |= 1 << (c >> 2)
                mine = max([h >> 2 for h in (h1, h2) if h & 3 == u])
                nfd = all(on_board >> r & 1 for r in range(mine + 1, 13))
        allm = bmask | (1 << r1) | (1 << r2)
        outs = 0
        if STRAIGHT_TOP[allm] < 0:
            for r in range(13):
                if not allm >> r & 1 and STRAIGHT_TOP[allm | (1 << r)] >= 0 and STRAIGHT_TOP[bmask | (1 << r)] < 0:
                    outs += 1
        sd = 2 if outs >= 2 else 1 if outs == 1 else 0
        if fd and sd:
            draw = 5
        elif nfd:
            draw = 4
        elif fd:
            draw = 3
        else:
            draw = sd
    mx = max(bsuit)
    ftex = 0 if mx <= 2 else 1 if mx == 3 else 2
    w = WINDOW[bmask]
    stex = 2 if w >= 4 else 1 if w == 3 else 0
    return made, draw, ftex, stex, int(bpaired)


def key_of(street: int, made: int, draw: int, ftex: int, stex: int, paired: int) -> int:
    return ((((min(street, 3) - 1) * N_MADE + made) * N_DRAW + draw) * 3 + ftex) * 6 + stex * 2 + paired


def post_key(hole, board) -> int:
    made, draw, ftex, stex, paired = made_and_draw(hole[0], hole[1], board)
    street = 1 if len(board) <= 3 else 2 if len(board) == 4 else 3
    return key_of(street, made, draw, ftex, stex, paired)


# ------------------------------------------------------------------ any other card game
def preflop_generic(hole, n_ranks: int = 13) -> float:
    """0..1 strength of a starting hand of any size: pairs, high cards, suits, connectedness."""
    ranks = sorted((c >> 2 for c in hole), reverse=True)
    if not ranks:
        return 0.0
    cnt = {}
    for r in ranks:
        cnt[r] = cnt.get(r, 0) + 1
    suits = {}
    for c in hole:
        suits[c & 3] = suits.get(c & 3, 0) + 1
    v = 0.0
    for r, k in cnt.items():
        if k >= 2:
            v += 0.18 + 0.025 * r + (0.12 if k >= 3 else 0.0)
    v += 0.02 * ranks[0] + 0.012 * (ranks[1] if len(ranks) > 1 else 0)
    if max(suits.values()) >= 2:
        v += 0.06
    uniq = sorted(set(ranks))
    conn = sum(1 for a, b in zip(uniq, uniq[1:]) if b - a <= 2)
    v += 0.03 * conn
    extra = len(hole) - 2
    if extra > 0:          # more hole cards: everyone has more, so raise the bar
        v -= 0.07 * extra
    return max(0.0, min(1.0, v / 0.9))


GEN_CAT = (0.12, 0.42, 0.62, 0.72, 0.80, 0.85, 0.92, 0.97, 0.99)


def generic_strength(hole, board) -> float:
    """Rough showdown strength 0..1 for any card game: the standard-ranked category of the
    best hand from hole + board, discounted when the board alone makes as much."""
    if len(board) == 0:
        return preflop_generic(hole)
    cards = list(hole) + list(board)
    if len(hole) > 3:
        # many hole cards: the best two-card holding with the board (an approximation of
        # Omaha's exactly-two rule, cheap enough for act())
        best = -1
        for a, b in combinations(hole, 2):
            s = score(list(board) + [a, b])
            if s > best:
                best = s
        s_all = best
    else:
        s_all = score(cards)
    s_b = score(board)
    cat = s_all >> 20
    e = GEN_CAT[cat]
    if cat <= (s_b >> 20) and cat <= 3:
        e = 0.2
    if len(hole) > 2:
        e -= 0.05 * (len(hole) - 2)
    return max(0.02, min(0.99, e))


def choose_discard(hole, board, lo: int, hi: int):
    """Discard between lo and hi cards keeping the cards that look best with the board.
    Draw games (lo == 0) keep made pairs and high cards; returns a tuple of cards."""
    hole = list(hole)
    n = len(hole)
    best, best_v = None, None
    for k in range(lo, hi + 1):
        if k > n:
            break
        for drop in combinations(range(n), k):
            keep = [hole[i] for i in range(n) if i not in drop]
            v = _keep_value(keep, board)
            # draw games: a discarded card is replaced, so drop the weakest; add a little for
            # the redraw's value when what is dropped is low
            if lo == 0 and k:
                v += 0.0004 * sum(12 - (hole[i] >> 2) for i in drop) - 0.001 * k
            if best_v is None or v > best_v:
                best, best_v = drop, v
    if best is None:
        best = tuple(range(lo))
    return tuple(hole[i] for i in best)


def _keep_value(keep, board) -> float:
    if not keep:
        return 0.0
    if len(keep) + len(board) >= 5:
        s = score(list(keep) + list(board))
        return (s >> 20) + ((s >> 16) & 15) / 16.0 + 0.002 * sum(c >> 2 for c in keep)
    return preflop_generic(keep) * 2.0 + 0.002 * sum(c >> 2 for c in keep)
