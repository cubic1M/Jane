"""Card-level helpers for the field9 bots (pure Python, safe inside act()).

  * hclass: the 169 two-card classes (pair r*13+r, suited hi*13+lo, offsuit lo*13+hi);
  * Scorer(spec): best five-card hand of any number of cards under the spec's deck (straight
    windows, the short-deck wheel) and category order; higher is better;
  * features(): a postflop description of a two-card hand (made class, draw class, board
    texture) whose key indexes the offline equity table (build_tables.py);
  * pre_generic / post_generic / choose_discard: strengths for any other card game.
"""
from __future__ import annotations

from itertools import combinations

STD = ("high_card", "pair", "two_pair", "trips", "straight", "flush", "full_house", "quads", "straight_flush")
HC, PAIR, TWOP, TRIPS, STRT, FLUSH, FULL, QUADS, SFL = range(9)


def hclass(c1: int, c2: int) -> int:
    r1, r2 = c1 >> 2, c2 >> 2
    if r1 == r2:
        return r1 * 13 + r1
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


def _hi5_table():
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


HI5 = _hi5_table()
_STRAIGHT_CACHE: dict = {}


def straight_table(deck_ranks=tuple(range(13)), ace_low=True):
    """top rank of the best straight in a rank mask (-1 = none) for this deck."""
    key = (tuple(sorted(deck_ranks)), ace_low)
    t = _STRAIGHT_CACHE.get(key)
    if t is not None:
        return t
    ranks = sorted(deck_ranks)
    wins = []
    for i in range(len(ranks) - 4):
        w = ranks[i:i + 5]
        if w[-1] - w[0] == 4:
            wins.append((sum(1 << r for r in w), w[-1]))
    if ace_low and 12 in ranks and len(ranks) >= 5:
        wins.append((sum(1 << r for r in [12] + ranks[:4]), ranks[3]))
    wins.sort(key=lambda x: -x[1])
    t = [-1] * 8192
    for m in range(8192):
        for wm, top in wins:
            if m & wm == wm:
                t[m] = top
                break
    _STRAIGHT_CACHE[key] = (t, wins)
    return t, wins


def _window_table():
    wins = [0x1F << s for s in range(9)] + [0x100F]
    return [max((m & w).bit_count() for w in wins) for m in range(8192)]


WINDOW = _window_table()


class Scorer:
    """Best five-card hand of any number of cards for a spec (deck straights, category order)."""

    def __init__(self, spec=None):
        ranks = tuple(spec.deck_ranks) if spec is not None else tuple(range(13))
        ace_low = spec.ace_low_straight if spec is not None else True
        order = tuple(spec.category_order) if spec is not None else STD
        self.st, self.wins = straight_table(ranks, ace_low)
        self.remap = [order.index(name) for name in STD]       # std category -> spec value
        self.inv = [STD.index(name) for name in order]          # spec value -> std category

    def score(self, cards) -> int:
        """(spec category value << 20) | kickers."""
        cnt = [0] * 13
        suit = [0, 0, 0, 0]
        for c in cards:
            cnt[c >> 2] += 1
            suit[c & 3] |= 1 << (c >> 2)
        allm = suit[0] | suit[1] | suit[2] | suit[3]
        cands = []
        st = self.st
        for m in suit:
            if m.bit_count() >= 5:
                t = st[m]
                if t >= 0:
                    cands.append((SFL, t << 16))
                cands.append((FLUSH, HI5[m]))
        quad = trip = -1
        pairs = []
        trips2 = []
        for r in range(12, -1, -1):
            k = cnt[r]
            if k >= 4 and quad < 0:
                quad = r
            elif k >= 3:
                if trip < 0:
                    trip = r
                else:
                    trips2.append(r)
            elif k >= 2:
                pairs.append(r)
        if quad >= 0:
            cands.append((QUADS, (quad << 16) | ((HI5[allm & ~(1 << quad)] >> 16) << 12)))
        if trip >= 0:
            second = max(pairs[0] if pairs else -1, trips2[0] if trips2 else -1)
            if second >= 0:
                cands.append((FULL, (trip << 16) | (second << 12)))
            cands.append((TRIPS, (trip << 16) | ((HI5[allm & ~(1 << trip)] >> 12) << 8)))
        t = st[allm]
        if t >= 0:
            cands.append((STRT, t << 16))
        if len(pairs) >= 2:
            p1, p2 = pairs[0], pairs[1]
            cands.append((TWOP, (p1 << 16) | (p2 << 12) | ((HI5[allm & ~(1 << p1) & ~(1 << p2)] >> 16) << 8)))
        if pairs:
            p1 = pairs[0]
            cands.append((PAIR, (p1 << 16) | ((HI5[allm & ~(1 << p1)] >> 8) << 4)))
        cands.append((HC, HI5[allm]))
        rm = self.remap
        best = 0
        for cat, low in cands:
            v = (rm[cat] << 20) | low
            if v > best:
                best = v
        return best

    def std_cat(self, cards) -> int:
        """Standard category (0 high card .. 8 straight flush) of the best hand."""
        return self.inv[self.score(cards) >> 20]


STD_SCORER = Scorer()

# ----------------------------------------------------------------------- postflop features
N_MADE = 20
N_DRAW = 6
(AIR0, AIR1, AIR2, LOWPAIR, MIDPAIR, TPWEAK, TPGOOD, TPTOP, OVERPAIR, OVERBIG, TWOPAIR, TOPTWO, TRIPS_,
 SET, STRAIGHT, NUTSTRAIGHT, FLUSH_, FLUSHHI, NUTFLUSH, BOAT) = range(N_MADE)
MADE_NAMES = ("air0", "air1", "air2", "low_pair", "mid_pair", "tp_weak", "tp_good", "tp_top", "overpair",
              "overpair_big", "two_pair", "top_two", "trips", "set", "straight", "nut_straight", "flush",
              "flush_high", "nut_flush", "boat_plus")
DRAW_NAMES = ("none", "gutshot", "oesd", "flush_draw", "nut_flush_draw", "combo")
N_KEYS = 3 * N_MADE * N_DRAW * 3 * 3 * 2


def features(h1: int, h2: int, board, sc: Scorer = STD_SCORER, to_come: int = None):
    """(made, draw, ftex, stex, paired) of hole cards h1, h2 on the board."""
    r1, r2 = h1 >> 2, h2 >> 2
    if r1 < r2:
        h1, h2, r1, r2 = h2, h1, r2, r1
    s1, s2 = h1 & 3, h2 & 3
    cntb = [0] * 13
    bsuit = [0, 0, 0, 0]
    bsm = [0, 0, 0, 0]
    bmask = 0
    for c in board:
        r = c >> 2
        cntb[r] += 1
        bsuit[c & 3] += 1
        bsm[c & 3] |= 1 << r
        bmask |= 1 << r
    ub = [r for r in range(12, -1, -1) if cntb[r]]
    s_all = sc.score(list(board) + [h1, h2])
    s_b = sc.score(board)
    ca = sc.inv[s_all >> 20]
    cb = sc.inv[s_b >> 20]
    improves = s_all > s_b
    made = -1
    if ca >= FULL:
        if improves:
            made = BOAT
    elif ca == FLUSH:
        if improves or cb != FLUSH:
            fs = max(range(4), key=lambda u: bsuit[u] + (s1 == u) + (s2 == u))
            mine = max([h >> 2 for h in (h1, h2) if h & 3 == fs], default=-1)
            higher = sum(1 for r in range(mine + 1, 13) if not bsm[fs] >> r & 1)
            made = NUTFLUSH if higher == 0 else FLUSHHI if higher <= 2 else FLUSH_
    elif ca == STRT:
        if improves or cb != STRT:
            top = (s_all >> 16) & 15
            nut = True
            for wm, t in sc.wins:
                if t <= top:
                    break
                if (bmask & wm).bit_count() >= 3:
                    nut = False
                    break
            made = NUTSTRAIGHT if nut else STRAIGHT
    if made == -1:
        if not ub:
            made = AIR2 if r1 >= 10 else AIR1 if r1 >= 8 else AIR0
        elif r1 == r2:
            k = cntb[r1]
            if k == 1:
                made = SET
            elif k >= 2:
                made = BOAT
            elif r1 > ub[0]:
                made = OVERBIG if r1 >= 10 else OVERPAIR
            elif len(ub) > 1 and r1 > ub[1]:
                made = MIDPAIR
            else:
                made = LOWPAIR
        else:
            m1, m2 = cntb[r1], cntb[r2]
            if m1 >= 2 or m2 >= 2:
                made = TRIPS_
            elif m1 and m2:
                made = TOPTWO if (r1 == ub[0] and len(ub) > 1 and r2 == ub[1]) else TWOPAIR
            elif m1 or m2:
                r, k = (r1, r2) if m1 else (r2, r1)
                if r == ub[0]:
                    best = 12
                    while best == r or cntb[best]:
                        best -= 1
                    made = TPTOP if k >= best else TPGOOD if k >= 8 else TPWEAK
                elif len(ub) > 1 and r == ub[1]:
                    made = MIDPAIR
                else:
                    made = LOWPAIR
            else:
                made = (r1 > ub[0]) + (r2 > ub[0])
    # draws (only while cards are to come)
    draw = 0
    more = (len(board) < 5) if to_come is None else to_come > 0
    if more and made < STRAIGHT:
        fd = nfd = False
        for u in range(4):
            have = (s1 == u) + (s2 == u)
            if have and bsuit[u] + have == 4 and (have == 2 or max(r1, r2) >= 9):
                fd = True
                mine = max(h >> 2 for h in (h1, h2) if h & 3 == u)
                nfd = all(bsm[u] >> r & 1 for r in range(mine + 1, 13))
        st = sc.st
        allm = bmask | (1 << r1) | (1 << r2)
        outs = 0
        if st[allm] < 0:
            for r in range(13):
                if not allm >> r & 1 and st[allm | (1 << r)] >= 0 and st[bmask | (1 << r)] < 0:
                    outs += 1
        sd = 2 if outs >= 2 else outs
        if fd and sd:
            draw = 5
        elif nfd:
            draw = 4
        elif fd:
            draw = 3
        else:
            draw = sd
    mx = max(bsuit)
    ftex = 0 if mx <= 1 else 1 if mx == 2 else 2
    w = WINDOW[bmask]
    stex = 2 if w >= 4 else 1 if w == 3 else 0
    return made, draw, ftex, stex, int(len(ub) < len(board))


def key_of(sk: int, made: int, draw: int, ftex: int, stex: int, paired: int) -> int:
    """sk: 0 flop, 1 turn, 2 river (board cards still to come: 2, 1, 0)."""
    return ((((sk * N_MADE + made) * N_DRAW + draw) * 3 + ftex) * 3 + stex) * 2 + paired


def street_key(board_len: int, to_come: int = None) -> int:
    if to_come is not None:
        return 2 if to_come <= 0 else 1 if to_come == 1 else 0
    return 0 if board_len <= 3 else 1 if board_len == 4 else 2


# --------------------------------------------------------------------- any other game
def pre_generic(hole) -> float:
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
        if k == 2:
            v += 0.20 + 0.03 * r
        elif k >= 3:
            v += 0.12 + 0.01 * r
    v += 0.022 * ranks[0] + (0.014 * ranks[1] if len(ranks) > 1 else 0.0)
    dbl_suit = sum(1 for k in suits.values() if k >= 2)
    v += 0.06 * min(2, dbl_suit)
    uniq = sorted(set(ranks))
    v += 0.03 * sum(1 for a, b in zip(uniq, uniq[1:]) if b - a <= 2)
    v -= 0.06 * max(0, len(hole) - 2)
    return max(0.0, min(1.0, v / 0.9))


CAT_STRENGTH = (0.10, 0.40, 0.62, 0.72, 0.80, 0.86, 0.93, 0.97, 0.995)


def post_generic(hole, board, sc: Scorer, exact: int = 0) -> float:
    """Rough showdown strength 0..1: the category of the best hand (exactly `exact` hole cards
    when > 0), less when the board alone makes as much."""
    if not board:
        return pre_generic(hole)
    if exact and len(hole) > exact:
        best = -1
        for hc in combinations(hole, exact):
            if len(board) > 5 - exact:
                for bc in combinations(board, 5 - exact):
                    s = sc.score(list(hc) + list(bc))
                    best = s if s > best else best
            else:
                s = sc.score(list(hc) + list(board))
                best = s if s > best else best
        s_all = best
    elif len(hole) > 3:
        s_all = max(sc.score(list(board) + [a, b]) for a, b in combinations(hole, 2))
    else:
        s_all = sc.score(list(hole) + list(board))
    s_b = sc.score(board)
    cat = sc.inv[s_all >> 20]
    e = CAT_STRENGTH[cat]
    if s_all >> 20 <= s_b >> 20 and cat <= TRIPS:
        e = 0.18                                     # the board plays
    elif cat in (PAIR, TWOP):
        top = (s_all >> 16) & 15
        e += 0.012 * (top - 6)
    if len(hole) > 2:
        e -= 0.05 * (len(hole) - 2)
    return max(0.02, min(0.99, e))


def choose_discard(hole, board, lo: int, hi: int, sc: Scorer = STD_SCORER, keep_value=None, draw=False):
    """Discard between lo and hi cards, keeping what looks best with the board.
    keep_value(keep) -> float overrides the default heuristic (e.g. the equity table)."""
    hole = list(hole)
    n = len(hole)
    best, best_v = None, None
    for k in range(lo, min(hi, n) + 1):
        for drop in combinations(range(n), k):
            keep = [hole[i] for i in range(n) if i not in drop]
            if keep_value is not None:
                v = keep_value(keep, [hole[i] for i in drop])
            else:
                v = _keep_value(keep, board, sc)
            if draw and k:
                # a drawn card replaces the discard: dropping low cards costs little
                v += 0.0005 * sum(12 - (hole[i] >> 2) for i in drop) - 0.004 * k
            if best_v is None or v > best_v:
                best, best_v = drop, v
    if best is None:
        best = tuple(range(min(lo, n)))
    return tuple(hole[i] for i in best)


def _keep_value(keep, board, sc) -> float:
    if not keep:
        return 0.0
    if len(keep) + len(board) >= 5:
        s = sc.score(list(keep) + list(board))
        return sc.inv[s >> 20] + ((s >> 16) & 15) / 16.0 + 0.002 * sum(c >> 2 for c in keep)
    return pre_generic(keep) * 2.0 + 0.002 * sum(c >> 2 for c in keep)
