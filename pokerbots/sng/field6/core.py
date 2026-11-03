"""Shared machinery for the field6 bots.

  * preflop tables (data/pf6.npz from build_tables.py): a strength percentile per hand
    class and the equity of every class against the top x% of hands;
  * Read: a fast postflop read of a 2-card hand (made-hand strength, draws, texture)
    that turns into a heads-up equity estimate without any sampling;
  * Stats: per-seat counters from the end_hand histories (open rate, flop c-bet rate,
    turn give-up after a c-bet, fold to big bets, river calls, showdowns ...);
  * ICM bubble factors (computed in end_hand, never inside act);
  * Base: a tight-aggressive sit-and-go bot (push/fold when short) with postflop hooks
    the five bots override, plus a simple legal fallback for any other card game.

act() only does table lookups and a little arithmetic: well under 0.3 ms.
"""
from __future__ import annotations

import os
import random

import numpy as np

from engine.game import Call, Check, Discard, Fold, RaiseTo

DEBUG = bool(os.environ.get("FIELD6_DEBUG"))

# ------------------------------------------------------------------------------ tables
_D = np.load(os.path.join(os.path.dirname(__file__), "data", "pf6.npz"))
PCT = [float(x) for x in _D["pct"]]
EQTOP = _D["eqtop"].astype(float).tolist()
EQR = [float(x) for x in _D["eq_rand"]]
del _D


def hclass(c1: int, c2: int) -> int:
    r1, r2 = c1 >> 2, c2 >> 2
    hi, lo = (r1, r2) if r1 >= r2 else (r2, r1)
    if hi == lo:
        return hi * 14
    return hi * 13 + lo if (c1 & 3) == (c2 & 3) else lo * 13 + hi


def class_info(h: int):
    """(hi rank, lo rank, suited, pair)"""
    a, b = divmod(h, 13)
    if a == b:
        return a, a, False, True
    return (a, b, True, False) if a > b else (b, a, False, False)


def eq_vs(frac: float, h: int) -> float:
    """Equity of class h against the top `frac` of hands."""
    k = int(frac * 50.0 + 0.5) - 1
    return EQTOP[0 if k < 0 else 49 if k > 49 else k][h]


def best_pct(hole) -> float:
    """Strength percentile of the best two-card class inside any hole (smaller = better)."""
    best = 1.0
    n = len(hole)
    for i in range(n):
        for j in range(i + 1, n):
            p = PCT[hclass(hole[i], hole[j])]
            if p < best:
                best = p
    return best


# ------------------------------------------------------------------------- hand reader
def _straight_hi_table():
    t = [-1] * 8192
    wins = [(0x1F << (top - 4), top) for top in range(12, 3, -1)] + [(0x100F, 3)]
    for m in range(8192):
        for w, top in wins:
            if m & w == w:
                t[m] = top
                break
    return t


SHI = _straight_hi_table()        # highest straight in a rank mask (-1 none; wheel = 3)


def _category(cnt, mask, suitmask):
    """0 high .. 8 straight flush from rank counts, rank mask and per-suit rank masks."""
    flush = False
    for sm in suitmask:
        if sm.bit_count() >= 5:
            if SHI[sm] >= 0:
                return 8
            flush = True
    mx = max(cnt)
    if mx == 4:
        return 7
    if _full(cnt):
        return 6
    if flush:
        return 5
    if SHI[mask] >= 0:
        return 4
    if mx == 3:
        return 3
    pairs = sum(1 for x in cnt if x >= 2)
    return 2 if pairs >= 2 else 1 if pairs == 1 else 0


def _full(cnt):
    t = p = 0
    for x in cnt:
        if x >= 3:
            t += 1
        elif x == 2:
            p += 1
    return t >= 2 or (t >= 1 and p >= 1)


class Read:
    """Postflop read of a two-card hand on a board of 3+ cards."""
    __slots__ = ("cat", "made", "e", "fd", "nfd", "oesd", "gut", "overs", "p_improve",
                 "flush_board", "paired", "straighty", "wet", "board_top", "nutted", "pair_kind")

    def __init__(self, hole, board, to_come: int):
        h0, h1 = hole[0], hole[1]
        r0, r1 = h0 >> 2, h1 >> 2
        s0, s1 = h0 & 3, h1 & 3
        hi, lo = (r0, r1) if r0 >= r1 else (r1, r0)
        bcnt = [0] * 13
        bsm = [0, 0, 0, 0]
        bmask = 0
        for c in board:
            r = c >> 2
            bcnt[r] += 1
            bsm[c & 3] |= 1 << r
            bmask |= 1 << r
        cnt = list(bcnt)
        cnt[r0] += 1
        cnt[r1] += 1
        sm = list(bsm)
        sm[s0] |= 1 << r0
        sm[s1] |= 1 << r1
        amask = bmask | (1 << r0) | (1 << r1)
        cat = _category(cnt, amask, sm)
        catb = _category(bcnt, bmask, bsm)
        bsuit = [x.bit_count() for x in bsm]
        maxbs = max(bsuit)
        branks = sorted({c >> 2 for c in board}, reverse=True)
        top = branks[0]
        second = branks[1] if len(branks) > 1 else -1
        self.board_top = top
        self.paired = max(bcnt) >= 2
        self.flush_board = maxbs >= 3
        self.straighty = any((bmask & (0x1F << i)).bit_count() >= 3 for i in range(9)) or \
            (bmask & 0x100F).bit_count() >= 3
        self.wet = self.flush_board or self.straighty or (maxbs >= 2 and len(board) == 3)
        self.cat = cat
        self.pair_kind = ""
        pocket = r0 == r1
        e = 0.12
        if cat == 8:
            e = 0.99 if catb < 8 else 0.5
        elif cat == 7:
            e = 0.99 if max(bcnt) < 4 else 0.45 + 0.04 * (hi >= 11)
        elif cat == 6:
            if catb >= 6:
                e = 0.5 if bcnt[r0] == 0 and bcnt[r1] == 0 else 0.8
            elif pocket and bcnt[r0] >= 1:
                e = 0.96
            elif max(bcnt) >= 3:                 # trips on board, my pair fills it
                e = 0.86 if hi >= branks[-1] else 0.8
            else:
                e = 0.94
        elif cat == 5:
            fs = max(range(4), key=lambda u: sm[u].bit_count())
            mine = [r for r, s in ((r0, s0), (r1, s1)) if s == fs]
            if not mine or (catb == 5 and max(mine) < _lowest_bit(bsm[fs]) and bsuit[fs] >= 5):
                e = 0.3 if catb == 5 else 0.12
            else:
                myhi = max(mine)
                better = sum(1 for r in range(myhi + 1, 13) if not bsm[fs] >> r & 1)
                e = (0.97, 0.92, 0.87, 0.82)[min(better, 3)]
                if bsuit[fs] >= 4 and better > 0:
                    e -= 0.08
                if self.paired:
                    e -= 0.07
        elif cat == 4:
            mine_hi = SHI[amask]
            if catb == 4 and SHI[bmask] >= mine_hi:
                e = 0.35
            else:
                e = 0.88
                if mine_hi < 12 and SHI[amask | (1 << (mine_hi + 1))] > mine_hi and \
                        (bmask >> (mine_hi + 1)) & 1 == 0:
                    e -= 0.03                     # the low end
                if maxbs >= 4:
                    e -= 0.25
                elif maxbs >= 3:
                    e -= 0.13
                if self.paired:
                    e -= 0.07
        elif cat == 3:
            if pocket and bcnt[r0] == 1:
                e = 0.91
            elif max(bcnt) >= 3:                  # trips on the board
                e = 0.3 + 0.03 * (hi >= 11) + 0.04 * (hi == 12)
            else:
                k = lo if bcnt[hi] else hi
                e = 0.79 + (0.04 if k >= 10 else 0.0)
            if e > 0.6:
                if maxbs >= 3:
                    e -= 0.1
                if self.straighty:
                    e -= 0.04
        elif cat == 2:
            if not pocket and bcnt[r0] and bcnt[r1] and not (bcnt[r0] >= 2 or bcnt[r1] >= 2):
                e = 0.85 if hi == top and lo == second else 0.8 if hi == top else 0.74
                if maxbs >= 3:
                    e -= 0.08
                if self.straighty:
                    e -= 0.04
                self.pair_kind = "two"
            elif pocket:
                e = self._pair_strength(hi, top, second, True, -1)
            elif bcnt[r0] or bcnt[r1]:           # one hole card pairs + a board pair
                r = hi if bcnt[hi] == 1 else lo if bcnt[lo] == 1 else hi
                k = lo if r == hi else hi
                e = self._pair_strength(r, top, second, False, k) + 0.02
            else:                                 # two pair on the board
                e = 0.14 + 0.05 * (hi >= 11) + 0.06 * (hi == 12)
        elif cat == 1:
            if catb >= 1:                         # the board pair only
                e = self._high(hi, lo, top)
            elif pocket:
                e = self._pair_strength(hi, top, second, True, -1)
            else:
                r = hi if bcnt[hi] else lo
                k = lo if r == hi else hi
                e = self._pair_strength(r, top, second, False, k)
        else:
            e = self._high(hi, lo, top)
        if cat in (1, 2) and e < 0.8 and to_come <= 1:
            if maxbs >= 3:
                e -= 0.04 if to_come == 0 else 0.02
            if self.straighty:
                e -= 0.03 if to_come == 0 else 0.015
        self.made = e
        # draws
        self.fd = self.nfd = self.oesd = self.gut = self.overs = False
        p = 0.0
        if to_come > 0 and cat < 4:
            for u in range(4):
                n_all = sm[u].bit_count()
                if n_all == 4 and (s0 == u or s1 == u):
                    self.fd = True
                    myr = max(r for r, s in ((r0, s0), (r1, s1)) if s == u)
                    self.nfd = all(bsm[u] >> r & 1 for r in range(myr + 1, 13))
            outs_r = 0
            sb = SHI[bmask]
            for r in range(13):
                if not amask >> r & 1:
                    t = SHI[amask | (1 << r)]
                    if t >= 0 and t > SHI[bmask | (1 << r)] and t > sb:
                        outs_r += 1
            self.oesd = outs_r >= 2
            self.gut = outs_r == 1
            self.overs = cat == 0 and lo > top
            outs = 0.0
            if self.fd:
                outs += 9 if not self.paired else 7
            if self.oesd:
                outs += 8 if not self.fd else 6
            elif self.gut:
                outs += 4 if not self.fd else 3
            if self.overs:
                outs += 3
            elif cat == 0 and hi > top:
                outs += 1.5
            if maxbs >= 3 and not self.fd:
                outs *= 0.75                      # straight outs that also make a flush
            p = outs * (0.04 if to_come >= 2 else 0.0217)
            if p > 0.6:
                p = 0.6
        self.p_improve = p
        self.e = e + (1.0 - e) * p * 0.92 if e < 0.75 else e
        self.nutted = e >= 0.9

    @staticmethod
    def _high(hi, lo, top):
        e = 0.08 + 0.025 * (hi > top) + 0.025 * (lo > top) + 0.05 * (hi == 12)
        return min(0.24, e)

    def _pair_strength(self, r, top, second, pocket, kicker):
        if pocket:
            if r > top:
                self.pair_kind = "over"
                return max(0.68, min(0.8, 0.70 + 0.012 * (r - 8)))
            if r > second:
                self.pair_kind = "mid"
                return 0.5
            self.pair_kind = "low"
            return 0.36
        if r == top:
            self.pair_kind = "top"
            if kicker >= 11 or (r == 12 and kicker >= 9):
                return 0.67
            return 0.62 if kicker >= 8 else 0.57
        if r == second:
            self.pair_kind = "mid"
            return 0.46
        self.pair_kind = "low"
        return 0.36

    @property
    def draw(self) -> bool:
        return self.fd or self.oesd

    @property
    def any_draw(self) -> bool:
        return self.fd or self.oesd or self.gut

    @property
    def strong_draw(self) -> bool:
        return (self.fd and (self.oesd or self.gut or self.overs)) or self.nfd or self.p_improve >= 0.33


def _lowest_bit(m):
    return (m & -m).bit_length() - 1 if m else 13


def multiway(e: float, nopp: int) -> float:
    return e if nopp <= 1 else e ** (1.0 + 0.6 * (nopp - 1))


# ------------------------------------------------------------------- simple fallback read
def simple_strength(hole, board, ev):
    """Rough strength 0..1 for any card game (category of the best hand)."""
    cat = -1
    if ev is not None and len(hole) + len(board) >= 5:
        try:
            cat = (int(ev.evaluate(list(hole), list(board))) >> 20) - 1
            name = ev.order[cat]
            cat = ("high_card", "pair", "two_pair", "trips", "straight", "flush",
                   "full_house", "quads", "straight_flush").index(name)
        except Exception:  # noqa: BLE001
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
    e = (0.15, 0.42, 0.62, 0.72, 0.8, 0.85, 0.92, 0.97, 0.99)[cat]
    if cat <= 3 and cat <= bcat:
        e = 0.2
    return e


# ------------------------------------------------------------------------------- ICM
def icm_one(stacks, me: int, pays) -> float:
    """Malmuth-Harville expected points of index `me` (all stacks > 0)."""
    others = [s for i, s in enumerate(stacks) if i != me]
    m = len(others)
    total = float(sum(stacks))
    mine = stacks[me]
    npay = len(pays)
    size = 1 << m
    prob = [0.0] * size          # prob[S] = the players in S took the top |S| places
    used = [0.0] * size
    prob[0] = 1.0
    res = mine / total * pays[0]
    pc = [0] * size
    for S in range(1, size):
        low = S & -S
        i = low.bit_length() - 1
        used[S] = used[S ^ low] + others[i]
        pc[S] = pc[S ^ low] + 1
        k = pc[S]
        if k >= npay:
            continue
        acc = 0.0
        T = S
        while T:
            b = T & -T
            prev = S ^ b
            acc += prob[prev] * others[b.bit_length() - 1] / (total - used[prev])
            T ^= b
        prob[S] = acc
        res += acc * mine / (total - used[S]) * pays[k]
    return res


def bubble_factor(stacks, me: int, opp_stack: float, payouts) -> float:
    """Risk premium for a coin-flip-sized confrontation of seat `me` with a stack of
    `opp_stack` chips: (ICM lost when losing) / (ICM gained when winning)."""
    alive = [s for s in stacks if s > 0]
    k = len(alive)
    if k <= 2:
        return 1.0
    pays = list(payouts[:k])
    if max(pays) - min(pays) <= 1e-9:
        return 1.0
    my = stacks[me]
    idx = sum(1 for j, s in enumerate(stacks) if s > 0 and j < me)
    x = min(my, opp_stack)
    # the opponent is modelled as a seat with opp_stack chips; put it in place of the
    # closest stack among the others
    oth = [i for i in range(k) if i != idx]
    if not oth:
        return 1.0
    j = min(oth, key=lambda i: abs(alive[i] - opp_stack))
    base = list(alive)
    base[j] = max(1.0, float(opp_stack))
    now = icm_one(base, idx, pays)
    win = list(base)
    win[idx] += x
    win[j] -= x
    if win[j] <= 0:
        rest = [i for i in range(k) if i != j]
        w_st = [win[i] for i in rest]
        q_win = icm_one(w_st, rest.index(idx), pays[:k - 1]) if len(rest) > 1 else pays[0]
    else:
        q_win = icm_one(win, idx, pays)
    lose = list(base)
    lose[idx] -= x
    lose[j] += x
    q_lose = pays[k - 1] if lose[idx] <= 0 else icm_one(lose, idx, pays)
    gain, loss = q_win - now, now - q_lose
    if gain <= 1e-9:
        return 2.5
    return max(1.0, min(2.5, loss / gain))


# ------------------------------------------------------------------------------ stats
class Stats:
    """Per-seat counters from end_hand histories, with smoothed rates."""

    FIELDS = ("hands", "vpip", "pfr", "open_opp", "opens", "tb_opp", "tbs", "cb_opp", "cbs",
              "tc_opp", "tcs", "face", "face_fold", "big_opp", "big_fold", "rv_opp", "rv_call",
              "saw_flop", "sd", "agg", "pas")

    def __init__(self, n: int, last_street: int):
        self.n = n
        self.last = last_street
        for f in self.FIELDS:
            setattr(self, f, [0] * n)

    def update(self, hist, showdown, dead: int = 0):
        n = self.n
        pot = dead
        street = -1
        bets = [0] * n
        cur = 0
        pf_raises = 0
        pfa = None
        first_pf = set()
        first_st = set()
        bet_on_street = False
        cbettor = None
        cb_called = False
        seen, vp, pr, flop = set(), set(), set(), set()
        for s, st, k, amt in hist:
            if not 0 <= s < n:
                continue
            if st != street:
                street = st
                bets = [0] * n
                cur = 0
                bet_on_street = False
                first_st = set()
            seen.add(s)
            if k == "post":
                bets[s] += amt
                pot += amt
                if bets[s] > cur:
                    cur = bets[s]
                continue
            if k == "discard":
                continue
            to_call = cur - bets[s]
            if st == 0:
                if s not in first_pf:
                    first_pf.add(s)
                    if pf_raises == 0:
                        self.open_opp[s] += 1
                        if k == "raise":
                            self.opens[s] += 1
                    elif pf_raises == 1:
                        self.tb_opp[s] += 1
                        if k == "raise":
                            self.tbs[s] += 1
                if k == "raise":
                    vp.add(s)
                    pr.add(s)
                    pf_raises += 1
                    pfa = s
                elif k == "call":
                    vp.add(s)
            else:
                flop.add(s)
                if s not in first_st:
                    first_st.add(s)
                    if to_call == 0 and not bet_on_street:
                        if st == 1 and s == pfa:
                            self.cb_opp[s] += 1
                            if k == "raise":
                                self.cbs[s] += 1
                                cbettor = s
                        elif st == 2 and s == cbettor and cb_called:
                            self.tc_opp[s] += 1
                            if k == "check":
                                self.tcs[s] += 1
                if to_call > 0:
                    self.face[s] += 1
                    fold = k == "fold"
                    if fold:
                        self.face_fold[s] += 1
                    if to_call >= 0.75 * max(1, pot - to_call):
                        self.big_opp[s] += 1
                        if fold:
                            self.big_fold[s] += 1
                    if st == self.last:
                        self.rv_opp[s] += 1
                        if not fold:
                            self.rv_call[s] += 1
                    if st == 1 and k == "call" and cbettor is not None and s != cbettor:
                        cb_called = True
                if k == "raise":
                    self.agg[s] += 1
                    bet_on_street = True
                elif k == "call":
                    self.pas[s] += 1
            if k == "call":
                bets[s] += amt
                pot += amt
            elif k == "raise":
                pot += max(0, amt - bets[s])
                bets[s] = amt
                if amt > cur:
                    cur = amt
                bet_on_street = True
        for s in seen:
            self.hands[s] += 1
        for s in vp:
            self.vpip[s] += 1
        for s in pr:
            self.pfr[s] += 1
        for s in flop:
            self.saw_flop[s] += 1
        if showdown:
            for s in showdown:
                if 0 <= s < n:
                    self.sd[s] += 1

    # smoothed rates; the priors are a typical tight-aggressive regular
    def open_rate(self, s):
        return (self.opens[s] + 2.0) / (self.open_opp[s] + 10.0)

    def pfr_rate(self, s):
        return (self.pfr[s] + 1.8) / (self.hands[s] + 10.0)

    def vpip_rate(self, s):
        return (self.vpip[s] + 2.4) / (self.hands[s] + 10.0)

    def threebet_rate(self, s):
        return (self.tbs[s] + 0.5) / (self.tb_opp[s] + 8.0)

    def cbet_rate(self, s):
        return (self.cbs[s] + 3.0) / (self.cb_opp[s] + 5.0)

    def turn_giveup(self, s):
        return (self.tcs[s] + 2.0) / (self.tc_opp[s] + 5.0)

    def fold_to_bet(self, s):
        return (self.face_fold[s] + 2.0) / (self.face[s] + 5.0)

    def fold_big(self, s):
        return (self.big_fold[s] + 2.5) / (self.big_opp[s] + 5.0)

    def river_call(self, s):
        return (self.rv_call[s] + 2.0) / (self.rv_opp[s] + 5.0)

    def wtsd(self, s):
        return (self.sd[s] + 1.5) / (self.saw_flop[s] + 5.0)

    def aggression(self, s):
        return (self.agg[s] + 2.0) / (self.agg[s] + self.pas[s] + 5.0)


# ---------------------------------------------------------------------------- context
OPEN_BY_BEHIND = {0: 1.0, 1: 0.50, 2: 0.42, 3: 0.30, 4: 0.22, 5: 0.17, 6: 0.14, 7: 0.12}


class Ctx:
    """Everything a decision needs, parsed once from the observation."""

    def __init__(self, obs, last_street: int):
        self.obs = obs
        lg = obs.legal
        self.lg = lg
        self.bb = max(1, obs.big_blind)
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
        self.contenders = [sv.seat for sv in seats if sv.in_hand and not sv.folded]
        self.opps = [s for s in self.contenders if s != me]
        self.live_opps = [s for s in self.opps if not seats[s].all_in]
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
        self.eff_bb = self.eff / self.bb
        self.pot = obs.pot
        self.to_call = lg.call_amount if lg.can_call else 0
        self.my_bet = obs.my_bet
        self.my_stack = obs.my_stack
        self.spr = obs.my_stack / max(1, obs.pot)

    def street_acts(self, st):
        return self.acts.get(st, ())

    def bet_on(self, st):
        """Seats that raised (bet) on street st, in order."""
        return [s for s, k, _ in self.acts.get(st, ()) if k == "raise"]

    def checked_on(self, st, seat):
        return any(s == seat and k == "check" for s, k, _ in self.acts.get(st, ()))

    def called_on(self, st, seat):
        return any(s == seat and k == "call" for s, k, _ in self.acts.get(st, ()))

    def nb_of(self, seat):
        return len(self.order) - 1 - self.order.index(seat) if seat in self.order else 0

    def behind(self):
        seats = self.obs.seats
        return [s for s in self.order[self.pos + 1:] if not seats[s].folded]

    def bet_ratio(self):
        return self.to_call / max(1, self.pot - self.to_call)


# ---------------------------------------------------------------------------- the bot
class Base:
    """Tight-aggressive sit-and-go bot with ICM push/fold when short."""

    name = "f6_base"
    P = dict(
        pf_bb=10.0,          # push/fold at or below this effective stack
        open_mult=1.0,
        open_size=2.3,
        tb_value=0.03,       # 3-bet for value: top fraction of hands
        call_k=0.5,          # flat range = call_k * opener's range
        fb_value=0.02,       # 4-bet / jam over a 3-bet
        call_3b=0.05,
        jam_4b=0.012,        # continue vs a 4-bet
        bf_scale=1.0,
        cbet=0.55,
        cbet_size=0.45,
        barrel=0.45,
        vb=0.70,             # bet for value at or above this equity
        value_size=0.62,
        raise_value=0.90,
        semibluff=0.3,
        discount=0.06,       # base equity discount vs a bet
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
        bcs = tuple(self.spec.board_cards_per_street)
        self.bcs = bcs
        self.last_street = len(bcs) - 1
        self.stats = Stats(self.n, self.last_street)
        self.any_usage = self.spec.hole_usage == "any"
        self.ev = None
        try:
            from engine.evaluator import get_evaluator
            self.ev = get_evaluator(self.spec)
            # warm the evaluator's lazy tables here, not inside a timed act()
            deck = list(self.spec.deck)
            h = self.spec.hole_cards
            tot = 0
            for k in self.spec.board_cards_per_street:
                tot += k
                try:
                    if h + tot >= 5 and h + tot <= len(deck):
                        self.ev.evaluate(deck[:h], deck[h:h + tot])
                except Exception:  # noqa: BLE001 - exact usage may not allow this many
                    pass
        except Exception:  # noqa: BLE001
            self.ev = None
        self.stacks = [rules.starting_stack] * self.n
        self.bf_med = self.bf_big = 1.0
        self.dead = 0

    def end_hand(self, info):
        try:
            self.stats.update(info.get("history", ()), info.get("showdown"), self.dead)
        except Exception:  # noqa: BLE001
            if DEBUG:
                raise
        try:
            self.stacks = list(info["stacks"])
            self._update_bf()
        except Exception:  # noqa: BLE001
            if DEBUG:
                raise
            self.bf_med = self.bf_big = 1.0

    def _update_bf(self):
        st = self.stacks
        me = self.seat
        if st[me] <= 0:
            return
        others = sorted(s for j, s in enumerate(st) if s > 0 and j != me)
        if len(others) <= 1:
            self.bf_med = self.bf_big = 1.0
            return
        med = others[len(others) // 2]
        self.bf_med = bubble_factor(st, me, med, self.payouts)
        self.bf_big = bubble_factor(st, me, others[-1], self.payouts) if others[-1] != med else self.bf_med

    def act(self, obs):
        lg = obs.legal
        a = None
        try:
            if lg.discard_count:
                a = self.discard(obs)
            else:
                self.dead = obs.ante * sum(1 for sv in obs.seats if sv.in_hand)
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
            if a.kind != "discard" or set(a.cards) <= set(obs.hole):
                return a
        if lg.discard_count:
            k = lg.discard_min
            return Discard(sorted(obs.hole, key=lambda c: (c >> 2, c & 3))[:k])
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
        if amount >= 0.5 * (c.my_bet + c.my_stack):
            return RaiseTo(lg.max_raise_to)
        return RaiseTo(lg.clamp(amount))

    def bet(self, c, frac):
        """Bet (or raise) `frac` of the pot after calling."""
        cur = c.my_bet + c.to_call
        amt = cur + frac * (c.pot + c.to_call)
        return self.raise_to(c, amt)

    def raise_x(self, c, mult):
        """Raise to `mult` times the current bet (plus one bet per caller)."""
        cur = c.my_bet + c.to_call
        ncall = sum(1 for s, k, _ in c.here if k == "call" and c.bettor is not None)
        return self.raise_to(c, cur * mult + ncall * c.to_call)

    def bf_vs(self, c, seat):
        b = self.bf_big if seat is not None and c.start[seat] >= c.my_total else self.bf_med
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
        keep_n = len(hole) - lo
        board = list(obs.board)
        if keep_n == 2 and len(board) >= 3 and len(hole) <= 5:
            to_come = sum(self.bcs[obs.street + 1:])
            best, best_e = None, -1.0
            for i in range(len(hole)):
                for j in range(i + 1, len(hole)):
                    e = Read((hole[i], hole[j]), board, to_come).e
                    if e > best_e:
                        best, best_e = (hole[i], hole[j]), e
            return Discard([c for c in hole if c not in best])
        # keep paired ranks and high cards; drop the lowest singletons
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
                return self.preflop(c)
            return self.simple_preflop(c)
        if len(obs.hole) == 2 and self.any_usage and len(obs.board) >= 3:
            return self.postflop(c)
        return self.simple_postflop(c)

    # ---- preflop (two hole cards) --------------------------------------------------------
    def preflop(self, c):
        obs = c.obs
        c.h = hclass(obs.hole[0], obs.hole[1])
        c.pct = PCT[c.h]
        nr = len(c.pf_raises)
        if c.to_call > 0 and nr and (c.to_call >= 0.35 * c.my_stack or
                                     (obs.seats[c.pfa].all_in and c.to_call >= 0.2 * c.my_stack)):
            return self.vs_allin(c)
        if nr == 0:
            if c.eff_bb <= self.p["pf_bb"]:
                return self.push_fold(c)
            return self.unopened(c)
        if c.eff_bb <= 2 * self.p["pf_bb"]:
            return self.resteal(c)
        if c.me in [s for s, _ in c.pf_raises]:
            mine = max(i for i, (s, _) in enumerate(c.pf_raises) if s == c.me)
            if nr - mine - 1 >= 2 or nr >= 3:
                return self.vs_4bet(c)
            return self.vs_3bet(c)
        if nr == 1:
            return self.vs_open(c)
        return self.vs_4bet(c) if c.pct <= self.p["jam_4b"] else self.fold(c)

    def open_range(self, c):
        return min(0.9, OPEN_BY_BEHIND.get(c.nb, 0.12) * self.p["open_mult"])

    def caller_range(self, S):
        return max(0.07, min(0.5, 2.2 / max(1.0, S)))

    def push_ev(self, c):
        """EV in bb of open-shoving (vs folding), ICM-weighted losses."""
        behind = c.behind()
        S = c.eff_bb
        cr = self.caller_range(S)
        pf = 1.0
        for s in behind:
            w = cr if s == c.obs.bb_seat else cr * 0.7
            pf *= 1.0 - w
        e = eq_vs(cr, c.h)
        pot = c.pot / c.bb
        risk = min(c.my_stack / c.bb, S)
        bf = 1.0
        if behind:
            bf = sum(self.bf_vs(c, s) for s in behind) / len(behind)
        return pf * pot + (1 - pf) * (e * (pot + risk) - (1 - e) * risk * bf)

    def push_fold(self, c):
        if self.push_ev(c) > 0.0:
            return self.shove(c)
        return self.fold(c)

    def unopened(self, c):
        rng = self.open_range(c)
        if c.limpers:
            rng *= 0.7
        if c.pct <= rng:
            size = self.p["open_size"] + len(c.limpers)
            if c.eff_bb <= 20:
                size = 2.0 + len(c.limpers)
            if c.nb == 1:
                size += 0.5
            return self.raise_to(c, size * c.bb)
        if c.lg.can_check:
            return Check()
        if c.nb == 1 and not c.limpers and c.pct <= rng * 1.4:
            return Call()
        return Fold()

    def shove_range(self, c, seat):
        """Estimated range of an all-in (or a big raise) by `seat`."""
        S = max(1.0, c.start[seat] / c.bb)
        base = max(0.05, min(0.6, 3.0 / S))
        agg = max(0.6, min(2.0, self.stats.pfr_rate(seat) / 0.18))
        nr = len(c.pf_raises)
        r = base * agg
        if nr >= 2:
            r *= 0.4
        return max(0.03, min(0.7, r))

    def vs_allin(self, c):
        obs = c.obs
        r_seat = c.pfa if c.pfa is not None else (c.opps[0] if c.opps else c.me)
        e = eq_vs(self.shove_range(c, r_seat), c.h)
        big = [s for s in c.opps if obs.seats[s].bet > obs.big_blind]
        if len(big) >= 2:
            e *= 0.72
        e *= 0.97 ** len([s for s in c.behind() if not obs.seats[s].all_in])
        bf = self.bf_vs(c, r_seat)
        risk = c.to_call
        req = risk * bf / (risk * bf + obs.pot)
        if e >= req:
            if c.lg.can_raise and not obs.seats[r_seat].all_in:
                return self.shove(c)
            return Call()
        return self.fold(c)

    def resteal(self, c):
        """Short-ish stack facing a raise: reshove or fold."""
        if len(c.pf_raises) >= 2 and c.pct > 0.03:
            return self.fold(c)
        r = c.pfa
        fr = min(0.6, max(0.06, self.stats.open_rate(r) * OPEN_BY_BEHIND.get(c.nb_of(r), 0.12) / 0.2))
        cont = max(0.03, fr * 0.4)
        e = eq_vs(cont, c.h)
        pot = c.pot / c.bb
        risk = c.my_stack / c.bb
        pfold = 1.0 - cont / fr
        pfold *= 0.9 ** len(c.behind())
        bf = self.bf_vs(c, r)
        ev = pfold * pot + (1 - pfold) * (e * (pot + risk) - (1 - e) * risk * bf)
        if ev > 0.0:
            return self.shove(c)
        if c.lg.can_check:
            return Check()
        return Fold()

    def opener_range(self, c, seat):
        rate = self.stats.open_rate(seat)
        return max(0.05, min(0.8, OPEN_BY_BEHIND.get(c.nb_of(seat), 0.15) * rate / 0.2))

    def three_bet(self, c):
        cur = c.pf_raises[-1][1]
        if c.eff_bb <= 28:
            return self.shove(c)
        mult = 3.0 if c.ip else 3.7
        return self.raise_to(c, cur * mult + c.bb * len(c.callers))

    def light_3bet(self, c, fr):
        return False

    def vs_open(self, c):
        p = self.p
        fr = self.opener_range(c, c.pfa)
        if c.pct <= max(p["tb_value"], min(0.06, 0.3 * fr)):
            return self.three_bet(c)
        if self.light_3bet(c, fr):
            return self.three_bet(c)
        k = p["call_k"] + (0.2 if c.me == c.obs.bb_seat else 0.0)
        price = c.to_call / max(1, c.pot + c.to_call)
        if c.pct <= k * fr and price < 0.36 and c.eff_bb >= 20:
            return Call()
        return self.fold(c)

    def vs_3bet(self, c):
        p = self.p
        cur = c.pf_raises[-1][1]
        if c.pct <= p["fb_value"]:
            if c.eff_bb <= 45:
                return self.shove(c)
            return self.raise_to(c, cur * 2.3)
        price = c.to_call / max(1, c.pot + c.to_call)
        if c.pct <= p["call_3b"] and price < 0.4 and c.eff_bb >= 30:
            return Call()
        return self.fold(c)

    def vs_4bet(self, c):
        if c.pct <= self.p["jam_4b"]:
            return self.shove(c)
        return self.fold(c)

    # ---- simple fallback (other card games) ---------------------------------------------
    def simple_preflop(self, c):
        pct = best_pct(c.obs.hole) * (1.0 + 0.15 * max(0, len(c.obs.hole) - 2))
        price = c.to_call / max(1, c.pot + c.to_call)
        if c.eff_bb <= self.p["pf_bb"]:
            if c.to_call == 0 or not c.pf_raises:
                return self.shove(c) if pct <= 0.18 else self.fold(c)
            return self.shove(c) if pct <= 0.08 else self.fold(c)
        if pct <= 0.05 and len(c.pf_raises) <= 2:
            return self.bet(c, 1.0)
        if pct <= 0.12 and not c.pf_raises:
            return self.bet(c, 0.8)
        if c.to_call == 0:
            return Check()
        if pct <= 0.25 and price <= 0.3 and c.to_call <= 0.15 * c.my_stack:
            return Call()
        return Fold()

    def simple_postflop(self, c):
        obs = c.obs
        e = simple_strength(obs.hole, obs.board, self.ev if len(obs.board) + min(len(obs.hole), 5) <= 9 else None)
        e = multiway(e, len(c.opps))
        if c.to_call == 0:
            if e >= 0.6 and c.lg.can_raise:
                return self.bet(c, 0.5)
            return Check()
        req = c.to_call / (c.pot + c.to_call)
        if e >= 0.85 and c.lg.can_raise:
            return self.bet(c, 0.8)
        if e - 0.08 >= req:
            return Call()
        return Fold()

    # ---- postflop (two hole cards, 'any' usage) ---------------------------------------
    def postflop(self, c):
        obs = c.obs
        to_come = sum(self.bcs[obs.street + 1:])
        rd = Read(obs.hole, obs.board, to_come)
        c.rd = rd
        c.to_come = to_come
        c.e = multiway(rd.e, len(c.opps))
        if c.to_call == 0:
            if not c.lg.can_raise:
                return Check()
            return self.unbet(c, rd, c.e)
        return self.facing(c, rd, c.e)

    def value_bet(self, c, rd, size=None):
        if c.spr < 1.2:
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
        if c.pfa == c.me and st == 1 and len(c.opps) <= 1 and self.rand() < p["cbet"]:
            return self.bet(c, p["cbet_size"])
        if c.pfa == c.me and st == 2 and c.me in c.bet_on(1) and hu and \
                (rd.any_draw or e >= 0.55) and not c.river and self.rand() < p["barrel"]:
            return self.bet(c, 0.6)
        if rd.draw and not c.river and len(c.opps) <= 2 and self.rand() < p["semibluff"]:
            return self.bet(c, 0.55)
        return Check()

    def discount(self, c):
        ratio = c.bet_ratio()
        nr = len(c.raises)
        d = self.p["discount"] + 0.06 * min(1.5, ratio) + 0.05 * max(0, nr - 1) + 0.015 * c.street
        return d

    def facing(self, c, rd, e):
        p = self.p
        req = c.to_call / (c.pot + c.to_call)
        ea = e - self.discount(c)
        rv = p["raise_value"] + (0.03 if c.river else 0.0) + 0.04 * max(0, len(c.raises) - 1)
        if e >= rv and c.lg.can_raise:
            if c.spr < 2.5:
                return self.shove(c)
            return self.raise_x(c, 3.0)
        if ea >= req:
            return Call()
        # implied odds for a real draw against a small bet
        if rd.draw and not c.river and req <= 0.3 and c.spr > 3 and rd.p_improve + 0.05 >= req:
            return Call()
        return Fold()
