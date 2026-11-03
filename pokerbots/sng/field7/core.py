"""Shared machinery for the field7 bots.

  * preflop tables (data/pf7.npz, build_tables.py): a strength percentile per hand class,
    equity against a random hand and against the top x% of hands, plus a derived table of
    how wide a rational caller continues against a shove range at a given price;
  * score_cards: a pure-Python best-five evaluator (standard ranking), about 3 us;
  * Post: a postflop read of a two-card hand (made hand, kicker, draws, outs, texture) that
    turns into a heads-up equity estimate without sampling;
  * Stats: per-seat counters from the end_hand histories (VPIP, PFR, open, limp, 3-bet,
    fold to 3-bet, c-bet, fold to c-bet, fold to bets, showdowns and shown hands);
  * ICM: per-opponent bubble factors (mine against each seat and each seat's against me),
    computed in end_hand with a change cache, never inside act;
  * Base: a solid sit-and-go bot (position opening ranges, ICM push/fold and all-in calls,
    resteals) with hooks the five bots override, and a legal fallback for any card game.

act() only does table lookups and a little arithmetic.
"""
from __future__ import annotations

import os
import random

import numpy as np

from engine.game import Call, Check, Discard, Fold, RaiseTo
from engine.spec import STANDARD_ORDER

DEBUG = bool(os.environ.get("FIELD7_DEBUG"))

# ------------------------------------------------------------------------------ tables
_D = np.load(os.path.join(os.path.dirname(__file__), "data", "pf7.npz"))
_PCT = _D["pct"].astype(float)
_EQTOP = _D["eqtop"].astype(float)
_NCOMB = _D["ncomb"].astype(float)
PCT = [float(x) for x in _PCT]
EQR = [float(x) for x in _D["eq_rand"]]
EQTOP = _EQTOP.tolist()
NCOMB = [int(x) for x in _NCOMB]
del _D

# CALLF[k][t]: fraction of all combos whose equity against the top (k+1)% is >= THR[t]
THR = np.round(np.arange(0.20, 0.801, 0.005), 3)
_W = _NCOMB / _NCOMB.sum()
CALLF = ((_EQTOP[:, :, None] >= THR[None, None, :]) * _W[None, :, None]).sum(axis=1).tolist()
THR0, THRN = 0.20, len(THR)


def hclass(c1: int, c2: int) -> int:
    r1, r2 = c1 >> 2, c2 >> 2
    hi, lo = (r1, r2) if r1 >= r2 else (r2, r1)
    if hi == lo:
        return hi * 14
    return hi * 13 + lo if (c1 & 3) == (c2 & 3) else lo * 13 + hi


def class_info(h: int):
    """(hi rank, lo rank, suited, pair) of a class index."""
    a, b = divmod(h, 13)
    if a == b:
        return a, a, False, True
    return (a, b, True, False) if a > b else (b, a, False, False)


def eq_top(frac: float, h: int) -> float:
    """Equity of class h against the top `frac` of hands."""
    k = int(frac * 100.0 + 0.5) - 1
    return EQTOP[0 if k < 0 else 99 if k > 99 else k][h]


def call_frac(shove_frac: float, req: float) -> float:
    """How wide a rational caller continues against a shove range of `shove_frac` when he
    needs `req` equity."""
    k = int(shove_frac * 100.0 + 0.5) - 1
    k = 0 if k < 0 else 99 if k > 99 else k
    t = int((req - THR0) / 0.005 + 0.5)
    t = 0 if t < 0 else THRN - 1 if t >= THRN else t
    return CALLF[k][t]


def best_pct(hole) -> float:
    """Percentile of the best two-card class inside any hole (smaller = better)."""
    best = 1.0
    n = len(hole)
    for i in range(n):
        for j in range(i + 1, n):
            p = PCT[hclass(hole[i], hole[j])]
            if p < best:
                best = p
    return best


def clip(x, lo, hi):
    return lo if x < lo else hi if x > hi else x


# ------------------------------------------------------------------- pure-Python scoring
def _straight_table():
    t = [-1] * 8192
    wins = [(0x1F << (top - 4), top) for top in range(12, 3, -1)] + [(0x100F, 3)]
    for m in range(8192):
        for w, top in wins:
            if m & w == w:
                t[m] = top
                break
    return t


def _top5_table():
    t = [0] * 8192
    for m in range(8192):
        v = k = 0
        for r in range(12, -1, -1):
            if m >> r & 1:
                v = (v << 4) | r
                k += 1
                if k == 5:
                    break
        while k < 5:
            v <<= 4
            k += 1
        t[m] = v
    return t


SHI = _straight_table()      # highest straight in a rank mask (-1 none; wheel = 3)
TOP5 = _top5_table()         # five highest ranks of a mask, packed 4 bits each


def score_cards(cards) -> int:
    """Best five-card hand of 5+ cards (standard 52-card ranking). Higher is better;
    category = score >> 20 (0 high card .. 8 straight flush)."""
    cnt = [0] * 13
    sm = [0, 0, 0, 0]
    for c in cards:
        r = c >> 2
        cnt[r] += 1
        sm[c & 3] |= 1 << r
    rm = sm[0] | sm[1] | sm[2] | sm[3]
    fl = -1
    for m in sm:
        if m.bit_count() >= 5:
            s = SHI[m]
            if s >= 0:
                return (8 << 20) | (s << 16)
            fl = (5 << 20) | TOP5[m]
    q = t = p1 = p2 = -1
    for r in range(12, -1, -1):
        x = cnt[r]
        if x < 2:
            continue
        if x == 4 and q < 0:
            q = r
        elif x >= 3 and t < 0:
            t = r
        elif p1 < 0:
            p1 = r
        elif p2 < 0:
            p2 = r
    if q >= 0:
        return (7 << 20) | (q << 16) | ((TOP5[rm & ~(1 << q)] >> 16) << 12)
    if t >= 0 and p1 >= 0:
        return (6 << 20) | (t << 16) | (p1 << 12)
    if fl >= 0:
        return fl
    s = SHI[rm]
    if s >= 0:
        return (4 << 20) | (s << 16)
    if t >= 0:
        return (3 << 20) | (t << 16) | (TOP5[rm & ~(1 << t)] >> 12)
    if p2 >= 0:
        return (2 << 20) | (p1 << 16) | (p2 << 12) | (TOP5[rm & ~(1 << p1) & ~(1 << p2)] >> 16)
    if p1 >= 0:
        return (1 << 20) | (p1 << 16) | (TOP5[rm & ~(1 << p1)] >> 8)
    return TOP5[rm]


# -------------------------------------------------------------------------- the reader
class Post:
    """Postflop read of a two-card hand on a board of 3+ cards: an equity estimate `e`
    heads-up against a typical continuing range, and the pieces behind it."""
    __slots__ = ("cat", "e", "made", "fd", "nfd", "oesd", "gut", "outs", "p_imp", "overs",
                 "wet", "paired", "flushy", "straighty", "top", "kind", "board_plays", "nut")

    def __init__(self, hole, board, to_come: int):
        h0, h1 = hole[0], hole[1]
        r0, r1, s0, s1 = h0 >> 2, h1 >> 2, h0 & 3, h1 & 3
        hi, lo = (r0, r1) if r0 >= r1 else (r1, r0)
        pocket = r0 == r1
        bcnt = [0] * 13
        bsm = [0, 0, 0, 0]
        for c in board:
            bcnt[c >> 2] += 1
            bsm[c & 3] |= 1 << (c >> 2)
        bmask = bsm[0] | bsm[1] | bsm[2] | bsm[3]
        amask = bmask | (1 << r0) | (1 << r1)
        branks = [r for r in range(12, -1, -1) if bmask >> r & 1]
        top = branks[0]
        second = branks[1] if len(branks) > 1 else -1
        self.top = top
        bsuit = [x.bit_count() for x in bsm]
        maxbs = max(bsuit)
        self.paired = max(bcnt) >= 2
        self.flushy = maxbs >= 3
        self.straighty = any((bmask & (0x1F << i)).bit_count() >= 3 for i in range(9)) or \
            (bmask & 0x100F).bit_count() >= 3
        self.wet = self.flushy or self.straighty or (maxbs == 2 and len(board) == 3)
        sc = score_cards(list(board) + [h0, h1])
        cat = sc >> 20
        self.cat = cat
        self.board_plays = len(board) >= 5 and score_cards(board) == sc
        kind = "air"
        if self.board_plays:
            e = 0.22 if cat >= 2 else 0.1
            kind = "board"
        elif cat == 8:
            e = 0.995
            kind = "nuts"
        elif cat == 7:
            e = 0.99 if max(bcnt) < 4 else 0.45 + 0.04 * (hi >= 11)
            kind = "nuts"
        elif cat == 6:
            e = 0.8 if max(bcnt) >= 3 else 0.95
            if pocket and bcnt[r0] == 1:
                e = 0.96
            kind = "monster"
        elif cat == 5:
            fs = max(range(4), key=lambda u: (bsm[u] | (1 << r0 if s0 == u else 0) |
                                               (1 << r1 if s1 == u else 0)).bit_count())
            mine = [r for r, s in ((r0, s0), (r1, s1)) if s == fs]
            if not mine:
                e = 0.3
                kind = "board"
            else:
                my = max(mine)
                held = bsm[fs] | (1 << r0 if s0 == fs else 0) | (1 << r1 if s1 == fs else 0)
                better = sum(1 for r in range(my + 1, 13) if not held >> r & 1)
                e = (0.975, 0.93, 0.88, 0.83, 0.8)[min(better, 4)]
                if self.paired:
                    e -= 0.07
                if bsuit[fs] >= 4 and better > 0:
                    e -= 0.08
                kind = "monster" if e >= 0.9 else "strong"
        elif cat == 4:
            mine_hi = SHI[amask]
            if SHI[bmask] >= mine_hi:
                e = 0.3
                kind = "board"
            else:
                e = 0.88
                if maxbs >= 4:
                    e -= 0.3
                elif maxbs >= 3:
                    e -= 0.14
                if self.paired:
                    e -= 0.08
                # one card straight with four to it on the board
                if SHI[bmask | (1 << r0)] == mine_hi or SHI[bmask | (1 << r1)] == mine_hi:
                    e -= 0.04
                if hi < top:                  # both hole cards below the board: the low end
                    e -= 0.06
                kind = "monster" if e >= 0.85 else "strong"
        elif cat == 3:
            if pocket and bcnt[r0] == 1:
                e = 0.92
                kind = "monster"
            elif max(bcnt) >= 3:            # trips on the board: my kicker
                e = 0.3 + 0.03 * max(0, hi - 8)
                kind = "weak"
            else:
                tr = r0 if bcnt[r0] == 2 else r1
                kick = r1 if tr == r0 else r0
                e = 0.78 + 0.012 * max(0, kick - 6)
                kind = "strong"
            if maxbs >= 3:
                e -= 0.07
            if self.straighty:
                e -= 0.04
        elif cat == 2:
            if not pocket and bcnt[r0] >= 1 and bcnt[r1] >= 1:
                e = 0.8 + (0.03 if hi == top and lo == second else 0.0)
                if maxbs >= 3:
                    e -= 0.06
                if self.straighty:
                    e -= 0.03
                kind = "strong"
            elif pocket:
                e = self._pair_e(r0, top, second, True, r0) - 0.04
                kind = "medium"
            elif bcnt[r0] >= 1 or bcnt[r1] >= 1:
                pr = r0 if bcnt[r0] >= 1 else r1
                kick = r1 if pr == r0 else r0
                e = self._pair_e(pr, top, second, False, kick) - 0.05
                kind = "medium" if e >= 0.5 else "weak"
            else:
                e = 0.18 + 0.025 * max(0, hi - 8)
                kind = "weak"
        elif cat == 1:
            if pocket:
                e = self._pair_e(r0, top, second, True, r0)
            elif bcnt[r0] >= 1 or bcnt[r1] >= 1:
                pr = r0 if bcnt[r0] >= 1 else r1
                kick = r1 if pr == r0 else r0
                e = self._pair_e(pr, top, second, False, kick)
            else:                         # the pair is on the board
                e = 0.1 + 0.025 * max(0, hi - 7)
            kind = "good" if e >= 0.66 else "medium" if e >= 0.45 else "weak"
            if self.wet and e > 0.4:
                e -= 0.03
        else:
            e = 0.06 + 0.028 * max(0, hi - 7) + 0.01 * max(0, lo - 8)
            kind = "air"
        # draws
        fd = nfd = False
        n_str = 0
        overs = 0
        outs = 0.0
        if to_come > 0 and cat < 5:
            for u in range(4):
                if bsuit[u] <= 3:
                    mine = [r for r, s in ((r0, s0), (r1, s1)) if s == u]
                    if mine and bsuit[u] + len(mine) == 4:
                        fd = True
                        held = bsm[u] | sum(1 << r for r in mine)
                        best_missing = next((r for r in range(12, -1, -1) if not held >> r & 1), -1)
                        nfd = max(mine) > best_missing
            if cat < 4:
                cur = max(SHI[amask], SHI[bmask])
                for r in range(13):
                    if not amask >> r & 1:
                        s = SHI[amask | (1 << r)]
                        if s > cur and s > SHI[bmask | (1 << r)]:
                            n_str += 1
            if cat == 0 or (cat == 1 and max(bcnt) >= 2):
                overs = (r0 > top) + (r1 > top)
            outs = 9.0 * fd + 4.0 * min(n_str, 2) - (2.0 if fd and n_str else 0.0) + 2.5 * overs
            if cat == 1 and not pocket and max(bcnt) < 2:
                outs += 2.5                  # two pair / trips
            if maxbs >= 3 and not fd:
                outs *= 0.8
        unseen = 50 - len(board)
        miss = 1.0
        for k in range(to_come):
            miss *= max(0.0, 1.0 - outs / max(1, unseen - k))
        p_imp = 1.0 - miss
        self.fd, self.nfd = fd, nfd
        self.oesd, self.gut = n_str >= 2, n_str == 1
        self.overs = overs
        self.outs = outs
        self.p_imp = p_imp
        self.made = e
        if p_imp > 0:
            e = e + (1.0 - e) * p_imp * 0.85
        self.e = clip(e, 0.0, 1.0)
        self.kind = kind
        self.nut = self.made >= 0.9

    @staticmethod
    def _pair_e(r, top, second, pocket, kick):
        if pocket:
            if r > top:
                return min(0.86, 0.75 + 0.02 * (r - top))
            if r > second:
                return 0.5
            return 0.34
        if r == top:
            return 0.59 + 0.012 * kick
        if r == second:
            return 0.45 + 0.006 * kick
        return 0.36 + 0.004 * kick

    @property
    def draw(self) -> bool:
        return self.fd or self.oesd

    @property
    def any_draw(self) -> bool:
        return self.fd or self.oesd or self.gut

    @property
    def strong_draw(self) -> bool:
        return (self.fd and (self.oesd or self.gut or self.overs)) or self.nfd or self.p_imp >= 0.32


def multiway(e: float, nopp: int) -> float:
    return e if nopp <= 1 else e ** (1.0 + 0.7 * (nopp - 1))


# ------------------------------------------------------------------- simple fallback read
CAT_NAMES = ("high_card", "pair", "two_pair", "trips", "straight", "flush", "full_house", "quads",
             "straight_flush")


def simple_strength(hole, board, ev):
    """Rough strength 0..1 for any card game: category of the best hand, discounted when
    the board alone already makes it."""
    cat = -1
    if ev is not None and len(hole) + len(board) >= 5:
        try:
            sc = int(ev.evaluate(list(hole), list(board)))
            cat = CAT_NAMES.index(ev.order[(sc >> 20) - 1])
        except Exception:  # noqa: BLE001 - usage rules may not allow this many cards yet
            cat = -1
    if cat < 0:
        cnt = [0] * 13
        for c in list(hole) + list(board):
            cnt[c >> 2] += 1
        mx = max(cnt)
        pairs = sum(1 for x in cnt if x >= 2)
        cat = 7 if mx >= 4 else 6 if mx == 3 and pairs >= 2 else 3 if mx == 3 else 2 if pairs >= 2 else pairs
    bcat = 0
    if board:
        bc = [0] * 13
        for c in board:
            bc[c >> 2] += 1
        bm = max(bc)
        bp = sum(1 for x in bc if x >= 2)
        bcat = 3 if bm >= 3 else 2 if bp >= 2 else bp
    e = (0.14, 0.4, 0.6, 0.7, 0.78, 0.84, 0.92, 0.97, 0.99)[cat]
    if cat <= 3 and cat <= bcat:
        e = 0.18
    return e


# ------------------------------------------------------------------------------- ICM
def icm_one(stacks, me: int, pays) -> float:
    """Malmuth-Harville expected points of index `me`; stacks all > 0, pays[0] = 1st."""
    others = [s for i, s in enumerate(stacks) if i != me]
    m = len(others)
    total = float(sum(stacks))
    mine = float(stacks[me])
    npay = min(len(pays), m + 1)
    while npay > 1 and pays[npay - 1] <= 0:
        npay -= 1
    size = 1 << m
    prob = [0.0] * size
    used = [0.0] * size
    cnt = [0] * size
    prob[0] = 1.0
    res = mine / total * pays[0]
    for S in range(1, size):
        low = S & -S
        p0 = S ^ low
        u = used[S] = used[p0] + others[low.bit_length() - 1]
        k = cnt[S] = cnt[p0] + 1
        if k >= npay:
            continue
        acc = 0.0
        T = S
        while T:
            b = T & -T
            p = S ^ b
            acc += prob[p] * others[b.bit_length() - 1] / (total - used[p])
            T ^= b
        prob[S] = acc
        res += acc * mine / (total - u) * pays[k]
    return res


def _icm_after(st, idx, pays, bust):
    """ICM of index idx after the seat at index `bust` (if any) lost all its chips."""
    if bust is None:
        return icm_one(st, idx, pays)
    rest = [s for i, s in enumerate(st) if i != bust]
    if len(rest) == 1:
        return pays[0]
    return icm_one(rest, idx - (1 if bust < idx else 0), pays[:len(rest)])


def bubble_factors(st, a: int, b: int, pays, both: bool):
    """(bf of a vs b, bf of b vs a) for an all-in for min(st[a], st[b]) between the two:
    ICM lost when losing / ICM gained when winning, clipped to 1..3."""
    k = len(st)
    x = min(st[a], st[b])
    win = list(st)
    win[a] += x
    win[b] -= x
    lose = list(st)
    lose[a] -= x
    lose[b] += x
    wb = b if win[b] <= 0 else None
    la = a if lose[a] <= 0 else None
    now_a = icm_one(st, a, pays)
    a_win = _icm_after(win, a, pays, wb)
    a_lose = pays[k - 1] if la is not None else _icm_after(lose, a, pays, None)
    bfa = _ratio(now_a - a_lose, a_win - now_a)
    bfb = 1.0
    if both:
        now_b = icm_one(st, b, pays)
        b_win = _icm_after(lose, b, pays, la)
        b_lose = pays[k - 1] if wb is not None else _icm_after(win, b, pays, None)
        bfb = _ratio(now_b - b_lose, b_win - now_b)
    return bfa, bfb


def _ratio(loss, gain):
    if gain <= 1e-9:
        return 3.0
    return clip(loss / gain, 1.0, 3.0)


# ------------------------------------------------------------------------------ stats
class Stats:
    """Per-seat counters from end_hand histories, with smoothed rates."""

    FIELDS = ("hands", "vpip", "pfr", "open_opp", "opens", "limp_opp", "limps", "tb_opp", "tbs", "f3_opp", "f3",
              "cb_opp", "cbs", "fcb_opp", "fcb", "face", "face_fold", "agg", "pas", "saw_flop", "sd",
              "rv_opp", "rv_call", "xr")

    def __init__(self, n: int, last_street: int):
        self.n = n
        self.last = last_street
        for f in self.FIELDS:
            setattr(self, f, [0] * n)
        self.shown_open = [0.0] * n      # widest class (percentile) shown after opening
        self.shown_call = [0.0] * n      # widest class shown after calling a raise preflop
        self.shown = [[] for _ in range(n)]

    def update(self, hist, showdown):
        n = self.n
        street = -1
        bets = [0] * n
        cur = 0
        nraise = 0
        opener = None
        opener_answered = False
        limped = False
        pfa = None
        acted_pf = set()
        st_first = set()
        bet_here = False
        cbet_live = False
        checked = set()
        faced_cb = set()
        seen, vp, pr, flop = set(), set(), set(), set()
        role = {}
        for s, st, k, amt in hist:
            if not 0 <= s < n:
                continue
            if st != street:
                street = st
                bets = [0] * n
                cur = 0
                bet_here = False
                cbet_live = False
                st_first = set()
                checked = set()
            seen.add(s)
            if k == "post":
                bets[s] += amt
                cur = max(cur, bets[s])
                continue
            if k == "discard":
                continue
            to_call = cur - bets[s]
            if st == 0:
                if s not in acted_pf:
                    acted_pf.add(s)
                    if nraise == 0:
                        self.limp_opp[s] += 1
                        if not limped:                 # first in: a raise here is an open
                            self.open_opp[s] += 1
                            if k == "raise":
                                self.opens[s] += 1
                                role[s] = "open"
                        if k == "call":
                            self.limps[s] += 1
                            limped = True
                    elif nraise == 1:
                        self.tb_opp[s] += 1
                        if k == "raise":
                            self.tbs[s] += 1
                        elif k == "call":
                            role.setdefault(s, "call")
                if s == opener and nraise == 2 and not opener_answered:
                    opener_answered = True
                    self.f3_opp[s] += 1
                    if k == "fold":
                        self.f3[s] += 1
                if k == "raise":
                    nraise += 1
                    vp.add(s)
                    pr.add(s)
                    pfa = s
                    if nraise == 1:
                        opener = s
                elif k == "call":
                    vp.add(s)
                    if nraise >= 1:
                        role.setdefault(s, "call")
            else:
                flop.add(s)
                first = s not in st_first
                st_first.add(s)
                if st == 1 and first and to_call == 0 and not bet_here and s == pfa:
                    self.cb_opp[s] += 1
                    if k == "raise":
                        self.cbs[s] += 1
                        cbet_live = True
                if to_call > 0:
                    self.face[s] += 1
                    if k == "fold":
                        self.face_fold[s] += 1
                    if st == 1 and cbet_live and s != pfa and s not in faced_cb:
                        faced_cb.add(s)
                        self.fcb_opp[s] += 1
                        if k == "fold":
                            self.fcb[s] += 1
                    if st == self.last:
                        self.rv_opp[s] += 1
                        if k != "fold":
                            self.rv_call[s] += 1
                    if k == "raise" and s in checked:
                        self.xr[s] += 1
                if k == "raise":
                    self.agg[s] += 1
                    if bet_here:
                        cbet_live = False      # a raise ends the plain c-bet spot
                    bet_here = True
                elif k == "call":
                    self.pas[s] += 1
                elif k == "check":
                    checked.add(s)
            if k == "call":
                bets[s] += amt
            elif k == "raise":
                bets[s] = amt
                cur = max(cur, amt)
        for s in seen:
            self.hands[s] += 1
        for s in vp:
            self.vpip[s] += 1
        for s in pr:
            self.pfr[s] += 1
        for s in flop:
            self.saw_flop[s] += 1
        if showdown:
            for s, hole in showdown.items():
                if not 0 <= s < n:
                    continue
                self.sd[s] += 1
                if hole is not None and len(hole) == 2:
                    p = PCT[hclass(hole[0], hole[1])]
                    self.shown[s].append(p)
                    if role.get(s) == "open":
                        self.shown_open[s] = max(self.shown_open[s], p)
                    elif role.get(s) == "call":
                        self.shown_call[s] = max(self.shown_call[s], p)

    # smoothed rates; the priors are a typical solid regular
    def vpip_rate(self, s):
        return (self.vpip[s] + 2.4) / (self.hands[s] + 10.0)

    def pfr_rate(self, s):
        return (self.pfr[s] + 1.8) / (self.hands[s] + 10.0)

    def open_rate(self, s):
        return (self.opens[s] + 2.0) / (self.open_opp[s] + 10.0)

    def limp_rate(self, s):
        return (self.limps[s] + 0.5) / (self.limp_opp[s] + 10.0)

    def threebet_rate(self, s):
        return (self.tbs[s] + 0.6) / (self.tb_opp[s] + 8.0)

    def fold_to_3bet(self, s):
        return (self.f3[s] + 3.0) / (self.f3_opp[s] + 5.0)

    def cbet_rate(self, s):
        return (self.cbs[s] + 3.0) / (self.cb_opp[s] + 5.0)

    def fold_to_cbet(self, s):
        return (self.fcb[s] + 2.2) / (self.fcb_opp[s] + 5.0)

    def fold_to_bet(self, s):
        return (self.face_fold[s] + 2.0) / (self.face[s] + 5.0)

    def wtsd(self, s):
        return (self.sd[s] + 1.5) / (self.saw_flop[s] + 5.0)

    def aggression(self, s):
        return (self.agg[s] + 2.0) / (self.agg[s] + self.pas[s] + 5.0)

    def river_call(self, s):
        return (self.rv_call[s] + 2.0) / (self.rv_opp[s] + 5.0)


# ---------------------------------------------------------------------------- context
# opening range by players left to act behind (7 = UTG at 8 handed, 2 = button, 1 = SB)
OPEN_BY_NB = {0: 1.0, 1: 0.40, 2: 0.44, 3: 0.28, 4: 0.21, 5: 0.18, 6: 0.15, 7: 0.13}
# Nash-like open-shove range at 10 bb by players behind
PUSH_BASE = {0: 1.0, 1: 0.58, 2: 0.37, 3: 0.28, 4: 0.22, 5: 0.18, 6: 0.15, 7: 0.13}


def push_range(S: float, nb: int) -> float:
    return clip(PUSH_BASE.get(nb, 0.12) * (10.0 / max(1.0, S)) ** 0.85, 0.03, 1.0)


class Ctx:
    """Everything a decision needs, parsed once from the observation."""

    def __init__(self, obs, last_street: int):
        self.obs = obs
        lg = obs.legal
        self.lg = lg
        bb = max(1, obs.big_blind)
        self.bb = bb
        me = obs.seat
        self.me = me
        seats = obs.seats
        n = len(seats)
        self.n = n
        self.street = obs.street
        self.river = obs.street >= last_street
        self.start = [sv.stack + sv.committed if sv.in_hand else 0 for sv in seats]
        self.my_total = self.start[me]
        order = []
        j = obs.bb_seat
        for _ in range(n):
            j = (j + 1) % n
            if seats[j].in_hand:
                order.append(j)
        self.order = order
        self.pos = order.index(me) if me in order else 0
        self.nb = len(order) - 1 - self.pos
        self.nplayers = len(order)
        self.contenders = [sv.seat for sv in seats if sv.in_hand and not sv.folded]
        self.opps = [s for s in self.contenders if s != me]
        acts = {}
        for s, st, k, amt in obs.history:
            if k == "post" or k == "discard":
                continue
            acts.setdefault(st, []).append((s, k, amt))
        self.acts = acts
        pf = acts.get(0, ())
        self.pf_raises = [(s, a) for s, k, a in pf if k == "raise"]
        self.pfa = self.pf_raises[-1][0] if self.pf_raises else None
        self.limpers = []
        self.callers = []
        seen_raise = False
        for s, k, a in pf:
            if k == "raise":
                seen_raise = True
                self.callers = []
            elif k == "call":
                (self.callers if seen_raise else self.limpers).append(s)
        self.i_limped = me in self.limpers
        here = acts.get(obs.street, ())
        self.here = here
        self.raises = [(s, a) for s, k, a in here if k == "raise"]
        self.bettor = self.raises[-1][0] if self.raises else None
        self.i_checked = any(s == me and k == "check" for s, k, _ in here)
        self.i_raised_here = any(s == me and k == "raise" for s, k, _ in here)
        post = sorted(((s - obs.button - 1) % n, s) for s in self.contenders)
        actors = [s for _, s in post if s == me or not seats[s].all_in]
        self.ip = bool(actors) and actors[-1] == me
        others = [self.start[s] for s in self.opps] or [0]
        self.eff = min(self.my_total, max(others))
        self.eff_bb = self.eff / bb
        self.pot = obs.pot
        self.to_call = lg.call_amount if lg.can_call else 0
        self.my_bet = obs.my_bet
        self.my_stack = obs.my_stack
        self.spr = obs.my_stack / max(1, obs.pot)
        self.price = self.to_call / max(1, self.pot + self.to_call)
        self.h = -1
        self.pct = 1.0

    def bet_on(self, st):
        return [s for s, k, _ in self.acts.get(st, ()) if k == "raise"]

    def checked_on(self, st, seat):
        return any(s == seat and k == "check" for s, k, _ in self.acts.get(st, ()))

    def nb_of(self, seat):
        return len(self.order) - 1 - self.order.index(seat) if seat in self.order else 0

    def behind(self):
        """Seats still to act after me preflop (not folded)."""
        seats = self.obs.seats
        return [s for s in self.order[self.pos + 1:] if not seats[s].folded and not seats[s].all_in]

    def bet_ratio(self):
        return self.to_call / max(1, self.pot - self.to_call)


# ---------------------------------------------------------------------------- the bot
class Base:
    """Solid sit-and-go bot: position opening ranges, ICM push/fold when short."""

    name = "f7_base"
    P = dict(
        pf_bb=12.0,          # open push/fold at or below this effective stack
        resteal_bb=24.0,     # reshove-or-fold against an open at or below this
        open_mult=1.0,
        open_size=2.3,
        tb_k=0.18,           # value 3-bet = top tb_k of the opener's range (min 2.5%)
        call_k=0.5,          # flat range = call_k * opener's range
        fb_value=0.02,       # 4-bet range over a 3-bet
        call_3b=0.045,
        jam_4b=0.012,
        bf_scale=1.0,        # weight on the ICM bubble factors
        cbet=0.6,
        cbet_size=0.45,
        barrel=0.45,
        vb=0.70,             # bet for value at or above this equity
        value_size=0.65,
        raise_value=0.88,
        semibluff=0.3,
        discount=0.05,
        commit=0.55,         # a raise of this share of the stack becomes a shove
    )

    def __init__(self, **kw):
        self.p = dict(self.P)
        self.p.update(kw)

    # ---- engine hooks ------------------------------------------------------------------
    def new_table(self, rules, seat, seed=0):
        self.rules = rules
        self.spec = rules.spec
        self.seat = seat
        self.rng = random.Random(seed)
        self.n = rules.num_players
        self.payouts = tuple(rules.payouts)
        self.bcs = tuple(self.spec.board_cards_per_street)
        self.last_street = len(self.bcs) - 1
        self.stats = Stats(self.n, self.last_street)
        sp = self.spec
        self.std = (sp.hole_usage == "any" and tuple(sp.category_order) == STANDARD_ORDER
                    and tuple(sp.deck_ranks) == tuple(range(13)))
        self.ev = None
        try:
            from engine.evaluator import get_evaluator
            self.ev = get_evaluator(sp)
            # warm the evaluator's lazy tables here, not inside a timed act()
            deck = list(sp.deck)
            h = sp.hole_cards
            tot = 0
            for k in sp.board_cards_per_street:
                tot += k
                for hh in range(2, h + 1):
                    try:
                        if hh + tot >= 5 and hh + tot <= len(deck):
                            self.ev.evaluate(deck[:hh], deck[hh:hh + tot])
                    except Exception:  # noqa: BLE001 - usage rules may not allow this many
                        pass
        except Exception:  # noqa: BLE001
            self.ev = None
        self.stacks = [rules.starting_stack] * self.n
        self.bf = [1.0] * self.n
        self.bfo = [1.0] * self.n
        self._icm_key = None
        self.setup()

    def setup(self):
        """Per-table state for subclasses."""

    def end_hand(self, info):
        try:
            self.stats.update(info.get("history", ()), info.get("showdown"))
        except Exception:  # noqa: BLE001
            if DEBUG:
                raise
        try:
            self.stacks = list(info["stacks"])
            self._update_icm()
        except Exception:  # noqa: BLE001
            if DEBUG:
                raise
            self.bf = [1.0] * self.n
            self.bfo = [1.0] * self.n
        try:
            self.after_hand(info)
        except Exception:  # noqa: BLE001
            if DEBUG:
                raise

    def after_hand(self, info):
        """Per-hand learning hook for subclasses."""

    need_bfo = False

    def _update_icm(self):
        st = self.stacks
        me = self.seat
        n = len(st)
        if me >= n or st[me] <= 0:
            return
        alive = [j for j in range(n) if st[j] > 0]
        k = len(alive)
        pays = self.payouts[:k]
        if k <= 2 or max(pays) - min(pays) <= 1e-9:
            self.bf = [1.0] * n
            self.bfo = [1.0] * n
            self._icm_key = None
            return
        # skip the work while nothing much changed since the last computation
        key = self._icm_key
        if key is not None and key[0] == tuple(alive):
            old = key[1]
            if all(abs(st[j] - old[j]) <= 0.06 * old[j] for j in alive):
                return
        self._icm_key = (tuple(alive), list(st))
        vals = [float(st[j]) for j in alive]
        mi = alive.index(me)
        tot = sum(vals)
        bb = self.rules.blinds_for(0)[1]
        deep = min(vals) >= 0.12 * tot and k >= 6 and min(vals) >= 30 * bb
        bf = [1.0] * n
        bfo = [1.0] * n
        if deep:
            # everyone deep: one representative opponent (the median stack)
            oth = sorted(range(k), key=lambda i: vals[i])
            oth = [i for i in oth if i != mi]
            med = oth[len(oth) // 2]
            a, b = bubble_factors(vals, mi, med, pays, self.need_bfo)
            for i, j in enumerate(alive):
                if j != me:
                    bf[j], bfo[j] = a, b
        else:
            for i, j in enumerate(alive):
                if j != me:
                    bf[j], bfo[j] = bubble_factors(vals, mi, i, pays, self.need_bfo)
        if not self.need_bfo:
            # without the exact numbers, a seat's pressure against me mirrors mine
            for j in alive:
                if j != me:
                    bfo[j] = 1.0 + 0.8 * (bf[j] - 1.0)
        self.bf, self.bfo = bf, bfo

    def act(self, obs):
        lg = obs.legal
        a = None
        try:
            if lg.discard_count:
                a = self.discard(obs)
            else:
                a = self.decide(obs)
        except Exception:  # noqa: BLE001
            if DEBUG:
                raise
            a = None
        return self.legalize(a, obs)

    @staticmethod
    def legalize(a, obs):
        lg = obs.legal
        if a is not None and lg.is_legal(a):
            if a.kind != "discard" or (set(a.cards) <= set(obs.hole) and len(set(a.cards)) == len(a.cards)):
                return a
        if lg.discard_count:
            return Discard(sorted(obs.hole, key=lambda c: (c >> 2, c & 3))[:lg.discard_min])
        if a is not None and a.kind == "raise":
            if lg.can_raise:
                return RaiseTo(lg.clamp(a.amount))
            if lg.can_call:
                return Call()
        return Check() if lg.can_check else Fold()

    # ---- helpers -----------------------------------------------------------------------
    def rand(self):
        return self.rng.random()

    @staticmethod
    def fold(c):
        return Check() if c.lg.can_check else Fold()

    @staticmethod
    def passive(c):
        return Check() if c.lg.can_check else Call()

    @staticmethod
    def shove(c):
        lg = c.lg
        if lg.can_raise:
            return RaiseTo(lg.max_raise_to)
        return Call() if lg.can_call else Check()

    def raise_to(self, c, amount):
        lg = c.lg
        if not lg.can_raise:
            return self.passive(c)
        if amount >= self.p["commit"] * (c.my_bet + c.my_stack):
            return RaiseTo(lg.max_raise_to)
        return RaiseTo(lg.clamp(amount))

    def bet(self, c, frac):
        """Bet (or raise) `frac` of the pot after calling."""
        cur = c.my_bet + c.to_call
        return self.raise_to(c, cur + frac * (c.pot + c.to_call))

    def raise_x(self, c, mult):
        """Raise to `mult` times the current bet."""
        cur = c.my_bet + c.to_call
        return self.raise_to(c, cur * mult)

    def bf_vs(self, c, seat):
        b = self.bf[seat] if seat is not None and 0 <= seat < len(self.bf) else 1.0
        return 1.0 + (b - 1.0) * self.p["bf_scale"]

    # ---- discards ------------------------------------------------------------------------
    def discard(self, obs):
        lg = obs.legal
        hole = list(obs.hole)
        lo, hi = lg.discard_min, lg.discard_count
        rule = None
        for r in self.spec.discards_on_street(obs.street):
            rule = r
            break
        board = list(obs.board)
        keep_n = len(hole) - lo
        if keep_n == 2 and len(board) >= 3 and self.std and len(hole) <= 5:
            to_come = sum(self.bcs[obs.street + 1:])
            best, best_e = None, -1.0
            for i in range(len(hole)):
                for j in range(i + 1, len(hole)):
                    e = Post((hole[i], hole[j]), board, to_come).e
                    if e > best_e:
                        best, best_e = (hole[i], hole[j]), e
            return Discard([c for c in hole if c not in best])
        if keep_n == 2 and not board and len(hole) <= 6:
            best = min(((hole[i], hole[j]) for i in range(len(hole)) for j in range(i + 1, len(hole))),
                       key=lambda x: PCT[hclass(x[0], x[1])])
            return Discard([c for c in hole if c not in best])
        # keep paired ranks, suited and high cards; drop the lowest singletons
        cnt = [0] * 13
        for c in hole:
            cnt[c >> 2] += 1
        order = sorted(hole, key=lambda c: (cnt[c >> 2] >= 2, c >> 2, c & 3))
        k = lo
        if rule is not None and rule.draw and hi > lo:
            junk = [c for c in order if cnt[c >> 2] < 2 and (c >> 2) < 9]
            k = max(lo, min(hi, len(junk)))
        return Discard(order[:k])

    # ---- the decision ----------------------------------------------------------------------
    def decide(self, obs):
        c = Ctx(obs, self.last_street)
        if obs.street == 0:
            if len(obs.hole) == 2:
                c.h = hclass(obs.hole[0], obs.hole[1])
                c.pct = PCT[c.h]
                return self.preflop(c)
            return self.simple_preflop(c)
        if len(obs.hole) == 2 and self.std and len(obs.board) >= 3:
            return self.postflop(c)
        return self.simple_postflop(c)

    # ---- preflop (two hole cards) --------------------------------------------------------
    def preflop(self, c):
        obs = c.obs
        nr = len(c.pf_raises)
        if c.to_call > 0 and nr and (c.to_call >= 0.4 * c.my_stack or
                                     (obs.seats[c.pfa].all_in and c.to_call >= 0.2 * c.my_stack)):
            return self.call_allin(c)
        if nr == 0:
            if c.eff_bb <= self.p["pf_bb"]:
                return self.push_fold(c)
            if c.limpers:
                return self.vs_limpers(c)
            return self.unopened(c)
        mine = [i for i, (s, _) in enumerate(c.pf_raises) if s == c.me]
        if not mine:
            if nr == 1:
                if c.eff_bb <= self.p["resteal_bb"]:
                    return self.resteal(c)
                return self.vs_open(c)
            if nr == 2:
                return self.vs_cold_3bet(c)
            return self.vs_4bet(c)
        after = nr - mine[-1] - 1
        if after == 1 and nr == 2:
            return self.vs_3bet(c)
        return self.vs_4bet(c)

    def open_range(self, c):
        if c.nplayers == 2:
            return min(1.0, 0.8 * self.p["open_mult"])
        return min(0.95, OPEN_BY_NB.get(c.nb, 0.12) * self.p["open_mult"])

    def open_amount(self, c):
        size = self.p["open_size"]
        if c.eff_bb <= 22:
            size = 2.0
        if c.me == c.obs.sb_seat and c.nplayers > 2:
            size += 0.5
        return size * c.bb + c.bb * len(c.limpers)

    def unopened(self, c):
        if c.pct <= self.open_range(c):
            return self.raise_to(c, self.open_amount(c))
        return self.fold(c)

    def vs_limpers(self, c):
        rng = self.open_range(c) * 0.6
        if c.pct <= rng:
            return self.raise_to(c, (3.5 + len(c.limpers)) * c.bb)
        if c.lg.can_check:
            return Check()
        info = class_info(c.h)
        if c.eff_bb >= 40 and c.nb <= 2 and (info[3] or (info[2] and info[0] - info[1] <= 2)) \
                and c.to_call <= c.bb:
            return Call()
        return Fold()

    # caller / shover range estimates ---------------------------------------------------
    def opener_range(self, c, seat):
        rate = self.stats.open_rate(seat)
        base = OPEN_BY_NB.get(c.nb_of(seat), 0.15) if c.nplayers > 2 else 0.8
        r = base * clip(rate / 0.22, 0.4, 3.0)
        shown = self.stats.shown_open[seat]
        if shown > r:
            r = 0.5 * (r + shown)
        return clip(r, 0.04, 0.9)

    def shove_range(self, c, seat):
        # depth that matters is the effective stack against the deepest player left behind
        deepest = max([c.start[j] for j in c.contenders if j != seat] or [c.start[seat]])
        S = max(1.0, min(c.start[seat], deepest) / c.bb)
        nr = len(c.pf_raises)
        agg = clip(self.stats.pfr_rate(seat) / 0.18, 0.6, 2.2)
        if nr <= 1:
            r = push_range(S, c.nb_of(seat)) * agg
        else:
            r = clip(3.0 / S, 0.04, 0.35) * agg
        return clip(r, 0.025, 0.85)

    # ICM push/fold -----------------------------------------------------------------------
    def push_ev(self, c, perceived=None, opp_bf=None):
        """Chip EV (in bb) of open-shoving vs folding, losses weighted by my bubble factor
        against each caller, callers modelled as rational at their own bubble factor."""
        obs = c.obs
        bb = c.bb
        behind = c.behind()
        if not behind:
            return 1.0
        my_all = c.my_bet + c.my_stack
        mine_in = obs.seats[c.me].committed
        rng = perceived if perceived is not None else push_range(c.eff_bb, c.nb)
        pot_others = (c.pot - mine_in) / bb
        p_none = 1.0
        ev = 0.0
        for j in behind:
            sv = obs.seats[j]
            their_all = sv.stack + sv.bet
            matched = min(my_all, their_all)
            cost_j = (matched - sv.bet) / bb
            win_j = (c.pot - sv.committed + matched - c.my_bet) / bb
            bfj = opp_bf[j] if opp_bf is not None else self.bfo[j]
            req = cost_j * bfj / (win_j + cost_j * bfj) if cost_j > 0 else 0.0
            cf = call_frac(rng, req)
            if j != obs.bb_seat:
                cf *= 0.9
            e = eq_top(max(cf, 0.01), c.h)
            risk = (matched - c.my_bet) / bb
            gain = pot_others + (matched - sv.bet) / bb
            ev += p_none * cf * (e * gain - (1 - e) * risk * self.bf_vs(c, j))
            p_none *= 1.0 - cf
        return ev + p_none * pot_others

    def push_fold(self, c):
        if self.push_ev(c) > 0.0:
            return self.shove(c)
        if c.lg.can_check:
            return Check()
        return Fold()

    def call_allin(self, c):
        obs = c.obs
        r_seat = c.pfa if c.pfa is not None else (c.opps[0] if c.opps else c.me)
        rng = self.shove_range(c, r_seat)
        if c.me in [s for s, _ in c.pf_raises]:
            rng = clip(rng * 1.3, 0.03, 0.6)      # a reshove over my raise is wider than a cold 4-bet
        e = eq_top(rng, c.h)
        big = [s for s in c.opps if obs.seats[s].bet > obs.big_blind and s != r_seat]
        if big:
            e *= 0.75 ** len(big)
        e *= 0.97 ** len(c.behind())
        bf = self.bf_vs(c, r_seat)
        r_bet = obs.seats[r_seat].bet
        excess = max(0, r_bet - (c.my_bet + c.my_stack))
        pot = c.pot - excess
        risk = c.to_call
        req = risk * bf / (risk * bf + pot)
        if e >= req + self.p.get("call_margin", 0.0):
            if c.lg.can_raise and c.behind() and e >= 0.6:
                return self.shove(c)
            return Call()
        return self.fold(c)

    def resteal(self, c):
        """Short-ish stack facing one raise: reshove or fold."""
        obs = c.obs
        r = c.pfa
        fr = self.opener_range(c, r)
        bb = c.bb
        my_all = c.my_bet + c.my_stack
        sv = obs.seats[r]
        r_all = sv.stack + sv.bet
        matched = min(my_all, r_all)
        cost = (matched - sv.bet) / bb
        mine_in = obs.seats[c.me].committed
        pot_others = (c.pot - mine_in) / bb
        perceived = clip(0.6 * fr, 0.06, 0.35)
        bfr = self.bfo[r]
        win = pot_others + (matched - c.my_bet) / bb
        req = cost * bfr / (win + cost * bfr) if cost > 0 else 0.0
        cont = min(fr, call_frac(perceived, req))
        p_cont = cont / fr
        behind = c.behind()
        p_fold = (1.0 - p_cont) * (0.93 ** len(behind)) * (0.85 ** len(c.callers))
        e = eq_top(max(0.01, cont), c.h)
        risk = (matched - c.my_bet) / bb
        ev = p_fold * pot_others + (1 - p_fold) * (e * (pot_others + cost) - (1 - e) * risk * self.bf_vs(c, r))
        if ev > 0.0 and c.pct <= 0.6:
            return self.shove(c)
        if c.lg.can_check:
            return Check()
        # the big blind closes the action against a min-raise: defend a little
        if c.me == obs.bb_seat and c.price <= 0.3 and c.pct <= 0.35 and not behind:
            return Call()
        return Fold()

    def three_bet_amount(self, c):
        cur = c.pf_raises[-1][1]
        mult = 3.0 if c.ip else 3.8
        return cur * mult + c.bb * len(c.callers)

    def three_bet(self, c):
        if c.eff_bb <= 30:
            return self.shove(c)
        return self.raise_to(c, self.three_bet_amount(c))

    def vs_open(self, c):
        p = self.p
        fr = self.opener_range(c, c.pfa)
        if c.pct <= max(0.025, p["tb_k"] * fr):
            return self.three_bet(c)
        k = p["call_k"] + (0.25 if c.me == c.obs.bb_seat else 0.0)
        if c.pct <= k * fr and c.price < 0.36 and c.eff_bb >= 22:
            return Call()
        return self.fold(c)

    def vs_cold_3bet(self, c):
        if c.pct <= 0.012 or (c.pct <= 0.02 and c.eff_bb <= 40):
            return self.shove(c) if c.eff_bb <= 45 else self.raise_x(c, 2.3)
        return self.fold(c)

    def vs_3bet(self, c):
        p = self.p
        if c.pct <= p["fb_value"]:
            if c.eff_bb <= 45:
                return self.shove(c)
            return self.raise_x(c, 2.3)
        if c.pct <= p["call_3b"] and c.price < 0.42 and c.eff_bb >= 30:
            return Call()
        return self.fold(c)

    def vs_4bet(self, c):
        if c.pct <= self.p["jam_4b"]:
            return self.shove(c)
        return self.fold(c)

    # ---- simple fallback (other card games) ---------------------------------------------
    def simple_preflop(self, c):
        pct = best_pct(c.obs.hole) * (1.0 + 0.15 * max(0, len(c.obs.hole) - 2))
        if c.eff_bb <= self.p["pf_bb"]:
            if not c.pf_raises:
                return self.shove(c) if pct <= 0.2 else self.fold(c)
            return self.shove(c) if pct <= 0.07 else self.fold(c)
        if pct <= 0.05 and len(c.pf_raises) <= 2:
            return self.bet(c, 1.0)
        if pct <= 0.14 and not c.pf_raises:
            return self.bet(c, 0.8)
        if c.to_call == 0:
            return Check()
        if pct <= 0.28 and c.price <= 0.3 and c.to_call <= 0.15 * c.my_stack:
            return Call()
        return Fold()

    def simple_postflop(self, c):
        obs = c.obs
        ev = self.ev if len(obs.board) + min(len(obs.hole), 5) <= 10 else None
        e = multiway(simple_strength(obs.hole, obs.board, ev), len(c.opps))
        if c.to_call == 0:
            if e >= 0.62 and c.lg.can_raise:
                return self.bet(c, 0.55)
            return Check()
        if e >= 0.86 and c.lg.can_raise:
            return self.bet(c, 0.8)
        if e - 0.08 >= c.price:
            return Call()
        return Fold()

    # ---- postflop (two hole cards, standard deck) ----------------------------------------
    def postflop(self, c):
        obs = c.obs
        to_come = sum(self.bcs[obs.street + 1:])
        rd = Post(obs.hole, obs.board, to_come)
        c.rd = rd
        c.to_come = to_come
        c.e = multiway(rd.e, len(c.opps))
        if c.to_call == 0:
            if not c.lg.can_raise:
                return Check()
            return self.unbet(c, rd, c.e)
        return self.facing(c, rd, c.e)

    def value_bet(self, c, rd, size=None):
        if c.spr < 1.3:
            return self.shove(c)
        if size is None:
            size = self.p["value_size"] if (rd.wet or c.street >= 2) else self.p["value_size"] * 0.8
        return self.bet(c, size)

    def unbet(self, c, rd, e):
        p = self.p
        st = c.street
        hu = len(c.opps) == 1
        if e >= p["vb"]:
            return self.value_bet(c, rd)
        if c.pfa == c.me and st == 1 and len(c.opps) <= 2:
            f = p["cbet"] * (0.75 if rd.wet else 1.1) * (0.7 if len(c.opps) == 2 else 1.0)
            if self.rand() < f:
                return self.bet(c, p["cbet_size"])
        if c.pfa == c.me and st == 2 and c.me in c.bet_on(1) and hu and \
                (rd.any_draw or e >= 0.5) and not c.river and self.rand() < p["barrel"]:
            return self.bet(c, 0.6)
        if rd.draw and not c.river and len(c.opps) <= 2 and self.rand() < p["semibluff"]:
            return self.bet(c, 0.55)
        return Check()

    def discount(self, c):
        return self.p["discount"] + 0.05 * min(1.5, c.bet_ratio()) + 0.05 * max(0, len(c.raises) - 1) \
            + 0.015 * c.street

    def facing(self, c, rd, e):
        p = self.p
        req = c.price
        ea = e - self.discount(c)
        rv = p["raise_value"] + (0.03 if c.river else 0.0) + 0.04 * max(0, len(c.raises) - 1)
        if e >= rv and c.lg.can_raise:
            if c.spr < 2.5:
                return self.shove(c)
            return self.raise_x(c, 2.8)
        if ea >= req:
            return Call()
        if rd.draw and not c.river and req <= 0.3 and c.spr > 3 and rd.p_imp + 0.06 >= req:
            return Call()
        return Fold()
