"""Shared machinery for the field5 bots: preflop tables, a fast hand classifier, bubble
factors from ICM, an opponent tracker and a parameterised base bot.

Everything heavy is loaded at import (data/pf.npz from build_tables.py) or computed in
new_table / end_hand, so act() only does table lookups and a little arithmetic.
"""
from __future__ import annotations

import os
import random

import numpy as np

from engine.game import Call, Check, Fold, RaiseTo

DEBUG = bool(os.environ.get("FIELD5_DEBUG"))

# ---------------------------------------------------------------------------- tables
_D = np.load(os.path.join(os.path.dirname(__file__), "data", "pf.npz"))
_W = _D["ncomb"].astype(float) / 1326.0
PCT = [float(x) for x in _D["pct"]]                      # top-x fraction where a class enters
EQR = [float(x) for x in _D["eq_rand"]]                  # equity vs a random hand
_PUSH = _D["push"]
MAX_S = _PUSH.shape[1] - 1
MAX_NB = _PUSH.shape[0] - 1
PUSH = [[[bool(v >= 0.5) for v in _PUSH[nb, s]] for s in range(MAX_S + 1)] for nb in range(MAX_NB + 1)]
PUSHFRAC = [[float((_PUSH[nb, s] * _W).sum()) for s in range(MAX_S + 1)] for nb in range(MAX_NB + 1)]
PFOLD = _D["pfold"].tolist()
EQC = _D["eqc"].tolist()          # [nb][S][h] equity when the shove is called
EQVS = _D["eqvs"].tolist()        # [nb][S][h] equity vs the Nash shove range

_order = np.argsort(_D["pct"])
_eq = _D["eq"].astype(float)
TOPK = 50                          # ranges top 2%, 4%, ..., 100%
_eqtop = np.zeros((TOPK, 169))
for _k in range(TOPK):
    _m = (_D["pct"] <= 0.02 * (_k + 1) + 1e-9).astype(float)
    _m[_order[0]] = 1.0
    _eqtop[_k] = _eq @ (_m * _W) / (_m * _W).sum()
EQTOP = _eqtop.tolist()
del _eqtop, _eq


def eq_vs_top(frac: float, h: int) -> float:
    k = int(round(frac / 0.02)) - 1
    return EQTOP[0 if k < 0 else TOPK - 1 if k >= TOPK else k][h]


def class_of(c1: int, c2: int) -> int:
    r1, r2 = c1 >> 2, c2 >> 2
    hi, lo = (r1, r2) if r1 >= r2 else (r2, r1)
    if hi == lo:
        return hi * 13 + hi
    if (c1 & 3) == (c2 & 3):
        return hi * 13 + lo
    return lo * 13 + hi


def class_parts(h: int):
    """(hi rank, lo rank, suited, pair)"""
    a, b = divmod(h, 13)
    if a == b:
        return a, a, False, True
    if a > b:
        return a, b, True, False
    return b, a, False, False


# ------------------------------------------------------------------- hand classifier
_STRAIGHTS = [(0x1F << i, i + 4) for i in range(9)] + [(0x100F, 3)]   # (rank mask, top), wheel last


def _straight_top(mask: int) -> int:
    best = -1
    for m, top in _STRAIGHTS:
        if mask & m == m and top > best:
            best = top
    return best


def _cat(ranks, suits):
    """Coarse category of a card set: 0 high, 1 pair, 2 two pair, 3 trips, 4 straight,
    5 flush, 6 full house, 7 quads, 8 straight flush."""
    cnt = [0] * 13
    for r in ranks:
        cnt[r] += 1
    sc = [0, 0, 0, 0]
    for s in suits:
        sc[s] += 1
    fs = max(range(4), key=lambda u: sc[u])
    mask = 0
    for r in ranks:
        mask |= 1 << r
    if sc[fs] >= 5:
        fm = 0
        for r, s in zip(ranks, suits):
            if s == fs:
                fm |= 1 << r
        if _straight_top(fm) >= 0:
            return 8
    mx = max(cnt)
    pairs = sum(1 for c in cnt if c >= 2)
    if mx == 4:
        return 7
    if mx == 3 and pairs >= 2:
        return 6
    if sc[fs] >= 5:
        return 5
    if _straight_top(mask) >= 0:
        return 4
    if mx == 3:
        return 3
    if pairs >= 2:
        return 2
    if pairs == 1:
        return 1
    return 0


class Hand:
    """Postflop read of my hand: made level 0..8, draws and board texture."""
    __slots__ = ("level", "fd", "nfd", "oesd", "gut", "overs", "wet", "paired", "street", "board_top")

    def __init__(self, hole, board):
        hr = [c >> 2 for c in hole]
        hs = [c & 3 for c in hole]
        br = [c >> 2 for c in board]
        bs = [c & 3 for c in board]
        self.street = len(board) - 2
        allr, alls = hr + br, hs + bs
        ca, cb = _cat(allr, alls), _cat(br, bs)
        bsorted = sorted(set(br), reverse=True)
        top = bsorted[0]
        self.board_top = top
        bcnt = [0] * 13
        for r in br:
            bcnt[r] += 1
        self.paired = max(bcnt) >= 2
        bsc = [0, 0, 0, 0]
        for s in bs:
            bsc[s] += 1
        bmask = 0
        for r in br:
            bmask |= 1 << r
        flushy = max(bsc) >= 3
        # straighty: some 5-window holds >= 3 board ranks
        straighty = any(bin(bmask & m).count("1") >= 3 for m, _ in _STRAIGHTS)
        self.wet = (max(bsc) >= 2 and self.street == 1) or flushy or straighty
        hi, lo = max(hr), min(hr)
        lvl = 0
        if ca >= 4 and ca > cb:
            if ca >= 6:
                lvl = 8 if not (ca == 6 and cb == 3 and hi != lo and bcnt[hi] == 0 and bcnt[lo] == 0) else 5
            elif ca == 5:
                fsuit = max(range(4), key=lambda u: bsc[u] + hs.count(u))
                myf = max((r for r, s in zip(hr, hs) if s == fsuit), default=-1)
                lvl = 8 if myf >= 11 and not self.paired else 7 if not self.paired else 6
            else:  # straight
                lvl = 7 if not flushy and not self.paired else 6
        elif ca >= 4:      # the board plays
            lvl = 1
        elif ca == 3:
            if hi == lo and bcnt[hi] == 1:          # set
                lvl = 7 if not (flushy or straighty) else 6
            elif cb == 3:                           # trips on board
                lvl = 2 if hi >= 11 else 0
            else:                                   # trips with one card
                lvl = 6 if not flushy else 5
        elif ca == 2:
            pair_hole = [r for r in set(hr) if bcnt[r] >= 1]
            if hi != lo and len(pair_hole) == 2:
                lvl = 6 if not (flushy and self.street >= 2) else 5
            elif hi == lo and bcnt[hi] == 0:        # pocket pair + board pair
                lvl = 5 if hi > top else 2
            elif cb == 2:                           # two pair on board
                lvl = 2 if hi >= 12 else 0
            else:                                   # one hole card pairs + board pair
                r = pair_hole[0] if pair_hole else hi
                lvl = 4 if r == top else 2
        elif ca == 1:
            if cb == 1:                              # board pair, I have nothing
                lvl = 0
            elif hi == lo:
                if hi > top:
                    lvl = 5 if hi >= 10 else 4
                elif len(bsorted) > 1 and hi > bsorted[1]:
                    lvl = 2
                else:
                    lvl = 1
            else:
                r = hi if bcnt[hi] else lo
                kicker = lo if r == hi else hi
                if r == top:
                    lvl = 4 if (kicker >= 9 or (r == 12 and kicker >= 8)) else 3
                elif len(bsorted) > 1 and r == bsorted[1]:
                    lvl = 2
                else:
                    lvl = 1
        self.level = lvl
        # draws (flop/turn only)
        self.fd = self.nfd = self.oesd = self.gut = self.overs = False
        if self.street < 3:
            for u in range(4):
                if bsc[u] + hs.count(u) == 4 and hs.count(u) >= 1 and bsc[u] < 4:
                    self.fd = True
                    self.nfd = any(r == 12 and s == u for r, s in zip(hr, hs)) or \
                        (hs.count(u) == 2 and hi >= 11)
            if lvl < 7:
                amask = bmask
                for r in hr:
                    amask |= 1 << r
                outs = 0
                for r in range(13):
                    if not amask >> r & 1 and _straight_top(amask | 1 << r) >= 0 \
                            and _straight_top(bmask | 1 << r) < 0:
                        outs += 1
                self.oesd = outs >= 2
                self.gut = outs == 1
            self.overs = lvl == 0 and lo > top

    def equity(self, nopp: int) -> float:
        e = (0.12, 0.33, 0.45, 0.56, 0.66, 0.76, 0.85, 0.92, 0.97)[self.level]
        if self.street < 3:
            fl = self.street == 1
            d = 0.0
            if self.fd:
                d += 0.20 if fl else 0.12
                if self.nfd:
                    d += 0.03
            if self.oesd:
                d += 0.15 if fl else 0.09
            elif self.gut:
                d += 0.08 if fl else 0.045
            if self.overs:
                d += 0.07 if fl else 0.035
            if self.level >= 3:
                d *= 0.5
            e = min(0.95, e + d)
        if nopp > 1:
            e = e ** (1.0 + 0.55 * (nopp - 1))
        return e

    @property
    def draw(self) -> bool:
        return self.fd or self.oesd

    @property
    def any_draw(self) -> bool:
        return self.fd or self.oesd or self.gut


# --------------------------------------------------------------------------------- ICM
def my_icm(stacks, me: int, pays) -> float:
    """Malmuth-Harville equity of seat index `me` (within `stacks`, all > 0)."""
    others = [s for i, s in enumerate(stacks) if i != me]
    m = len(others)
    T = float(sum(stacks))
    sm = stacks[me]
    size = 1 << m
    f = [0.0] * size
    sumA = [0.0] * size
    f[0] = 1.0
    res = f[0] * sm / T * pays[0]
    for mask in range(1, size):
        low = mask & -mask
        i = low.bit_length() - 1
        sumA[mask] = sumA[mask ^ low] + others[i]
        acc = 0.0
        mm = mask
        while mm:
            b = mm & -mm
            j = b.bit_length() - 1
            prev = mask ^ b
            acc += f[prev] * others[j] / (T - sumA[prev])
            mm ^= b
        f[mask] = acc
        k = bin(mask).count("1")
        if k < len(pays):
            res += acc * sm / (T - sumA[mask]) * pays[k]
    return res


def bubble_factors(stacks, me: int, payouts):
    """Bubble factor of seat `me` against every other live seat (1.0 for dead seats)."""
    n = len(stacks)
    out = [1.0] * n
    alive = [j for j in range(n) if stacks[j] > 0]
    if stacks[me] <= 0:
        return out
    k = len(alive)
    pays = list(payouts[:k])
    idx = {j: i for i, j in enumerate(alive)}
    base = [stacks[j] for j in alive]
    now = my_icm(base, idx[me], pays)
    for j in alive:
        if j == me:
            continue
        x = min(stacks[me], stacks[j])
        win = list(base)
        win[idx[me]] += x
        win[idx[j]] -= x
        if win[idx[j]] <= 0:
            al = [i for i in range(k) if i != idx[j]]
            st = [win[i] for i in al]
            q_win = my_icm(st, al.index(idx[me]), pays[:k - 1]) if len(al) > 1 else pays[0]
        else:
            q_win = my_icm(win, idx[me], pays)
        lose = list(base)
        lose[idx[me]] -= x
        lose[idx[j]] += x
        if lose[idx[me]] <= 0:
            q_lose = payouts[k - 1]
        else:
            q_lose = my_icm(lose, idx[me], pays)
        gain, loss = q_win - now, now - q_lose
        out[j] = min(3.0, max(1.0, loss / gain)) if gain > 1e-9 else 3.0
    return out


# ---------------------------------------------------------------------------- tracker
class Tracker:
    """Per-seat statistics from end_hand histories."""

    def __init__(self, n: int):
        self.n = n
        z = lambda: [0] * n  # noqa: E731
        self.hands, self.vpip, self.pfr = z(), z(), z()
        self.pf_face, self.pf_fold = z(), z()            # facing a raise preflop / folded
        self.agg, self.passive = z(), z()                 # postflop bets+raises / calls
        self.post_acts = z()
        self.face_bet, self.fold_bet = z(), z()           # postflop facing a bet / folded
        self.saw_flop, self.showdowns = z(), z()
        self.shoves = z()

    def update(self, info):
        hist = info["history"]
        seen = set()
        vp, pr, ff = set(), set(), set()
        cur, street = 0, -1
        flop = set()
        for s, st, k, amt in hist:
            if st != street:
                street, cur = st, 0
            seen.add(s)
            if k == "post":
                cur = max(cur, amt)
                continue
            if st == 0:
                if k == "raise":
                    vp.add(s)
                    pr.add(s)
                elif k == "call":
                    vp.add(s)
                if s not in ff and self._raised_before(hist, s):
                    ff.add(s)
                    self.pf_face[s] += 1
                    if k == "fold":
                        self.pf_fold[s] += 1
            else:
                flop.add(s)
                self.post_acts[s] += 1
                if cur > 0 and k in ("fold", "call", "raise"):
                    self.face_bet[s] += 1
                    if k == "fold":
                        self.fold_bet[s] += 1
                if k == "raise":
                    self.agg[s] += 1
                elif k == "call":
                    self.passive[s] += 1
            if k == "raise":
                cur = max(cur, amt)
        for s in seen:
            self.hands[s] += 1
        for s in vp:
            self.vpip[s] += 1
        for s in pr:
            self.pfr[s] += 1
        for s in flop:
            self.saw_flop[s] += 1
        if info.get("showdown"):
            for s in info["showdown"]:
                self.showdowns[s] += 1

    @staticmethod
    def _raised_before(hist, s):
        # True once a voluntary raise by another seat precedes s's first preflop action
        for t, st, k, _ in hist:
            if st != 0:
                break
            if t == s and k != "post":
                return False
            if k == "raise" and t != s:
                return True
        return False

    # smoothed rates (priors of a typical TAG-ish player)
    def vpip_r(self, s):
        return (self.vpip[s] + 2.5) / (self.hands[s] + 10)

    def pfr_r(self, s):
        return (self.pfr[s] + 1.8) / (self.hands[s] + 10)

    def aggfreq(self, s):
        return (self.agg[s] + 2) / (self.agg[s] + self.passive[s] + 5)

    def fold_to_bet(self, s):
        return (self.fold_bet[s] + 2.5) / (self.face_bet[s] + 5)

    def pf_fold_r(self, s):
        return (self.pf_fold[s] + 3) / (self.pf_face[s] + 5)


# ---------------------------------------------------------------------------- context
OPEN = {1: 0.42, 2: 0.33, 3: 0.24, 4: 0.18, 5: 0.15, 6: 0.13, 7: 0.11}


class Ctx:
    """What a decision needs, parsed once from the observation."""

    def __init__(self, obs):
        self.obs = obs
        lg = obs.legal
        self.lg = lg
        self.bb = max(1, obs.big_blind)
        self.me = obs.seat
        n = len(obs.seats)
        self.n = n
        self.hole = obs.hole
        self.h = class_of(obs.hole[0], obs.hole[1])
        self.pct = PCT[self.h]
        seats = obs.seats
        # chips at the start of the hand
        self.start = [sv.stack + sv.committed if sv.in_hand else 0 for sv in seats]
        self.my_total = self.start[self.me]
        # preflop action order (last = big blind)
        order = []
        j = obs.bb_seat
        for _ in range(n):
            j = (j + 1) % n
            if seats[j].in_hand:
                order.append(j)
        self.order = order
        self.alive = order
        self.pos = order.index(self.me) if self.me in order else 0
        self.nb = len(order) - 1 - self.pos         # players after me preflop
        self.contenders = [s.seat for s in seats if s.in_hand and not s.folded]
        self.opps = [s for s in self.contenders if s != self.me]
        self.live_opps = [s for s in self.opps if not seats[s].all_in]
        # preflop parse
        raises, limpers, callers = [], [], []
        self.pf_raiser = None
        for s, st, k, amt in obs.history:
            if st != 0:
                continue
            if k == "raise":
                raises.append((s, amt))
                callers = []
            elif k == "call":
                (callers if raises else limpers).append(s)
        self.pf_raises = raises
        self.limpers = limpers
        self.callers = callers
        if raises:
            self.pf_raiser = raises[-1][0]
        # this street
        st_r = [(s, amt) for s, st, k, amt in obs.history if st == obs.street and k == "raise"]
        self.street_raises = st_r
        self.checked_this_street = any(s == self.me and k == "check" and st == obs.street
                                       for s, st, k, _ in obs.history)
        self.i_bet_streets = {st for s, st, k, _ in obs.history if s == self.me and k == "raise"}
        # postflop order: in position = last to act among contenders
        post = [((s - obs.button - 1) % n, s) for s in self.contenders]
        post.sort()
        self.ip = bool(post) and post[-1][1] == self.me
        # effective stack vs live opponents (start-of-hand chips)
        others = [self.start[s] for s in self.opps] or [0]
        self.eff = min(self.my_total, max(others))
        self.eff_bb = self.eff / self.bb
        self.pot = obs.pot
        self.to_call = lg.call_amount if lg.can_call else 0

    def nb_of(self, seat):
        return len(self.order) - 1 - self.order.index(seat) if seat in self.order else 0

    def behind(self):
        """Seats after me preflop that are still in the hand."""
        return [s for s in self.order[self.pos + 1:] if not self.obs.seats[s].folded]


# ---------------------------------------------------------------------------- the bot
class Base:
    """Solid TAG with Nash push/fold when short. Subclasses tune P and override hooks."""

    P = dict(
        pf_depth=15.0,        # push/fold at or below this effective stack (bb)
        open_mult=1.0,        # multiplier on OPEN ranges
        open_size=2.25,       # open raise-to in bb
        tb_value=0.035,       # 3-bet for value: top fraction
        tb_light=0.0,         # light 3-bet band width above value (0 = off)
        tb_light_late_only=True,
        call_k=0.55,          # flat-call range = call_k * opener range (deep)
        fb_value=0.025,       # 4-bet / continue vs 3-bet
        call_3b=0.06,
        call_4b=0.012,
        cbet_freq=0.65,
        cbet_size=0.5,
        cbet_max_opp=1,
        barrel_freq=0.35,
        vb_thresh=0.64,       # bet for value at or above this equity
        raise_thresh=0.84,
        semibluff=0.45,
        pressure=0.10,        # equity discount vs a bet (opponent ranges are stronger)
        value_size=0.66,
        bf_scale=1.0,         # ICM caution multiplier
        call_icm_margin=0.0,
    )

    def __init__(self, **kw):
        self.p = dict(self.P)
        self.p.update(kw)

    # ---- engine hooks -------------------------------------------------------------------
    def new_table(self, rules, seat, seed):
        self.rules = rules
        self.seat = seat
        self.rng = random.Random(seed)
        self.payouts = tuple(rules.payouts)
        n = rules.num_players
        self.stacks = [rules.starting_stack] * n
        self.tracker = Tracker(n)
        self.bf = bubble_factors(self.stacks, seat, self.payouts)

    def end_hand(self, info):
        self.tracker.update(info)
        self.stacks = list(info["stacks"])
        if self.stacks[self.seat] > 0:
            self.bf = bubble_factors(self.stacks, self.seat, self.payouts)

    def act(self, obs):
        lg = obs.legal
        try:
            a = self.decide(Ctx(obs))
        except Exception:  # noqa: BLE001 - never lose a decision to a bug
            if DEBUG:
                raise
            a = None
        if a is None or not lg.is_legal(a):
            if a is not None and a.kind == "raise" and lg.can_raise:
                return RaiseTo(lg.clamp(a.amount))
            if a is not None and a.kind == "raise" and lg.can_call:
                return Call()
            return Check() if lg.can_check else Fold()
        return a

    # ---- helpers ------------------------------------------------------------------------
    def rand(self):
        return self.rng.random()

    def fold(self, c):
        return Check() if c.lg.can_check else Fold()

    def passive(self, c):
        return Check() if c.lg.can_check else Call()

    def shove(self, c):
        lg = c.lg
        if lg.can_raise:
            return RaiseTo(lg.max_raise_to)
        return Call() if lg.can_call else Check()

    def raise_to(self, c, amount):
        lg = c.lg
        if not lg.can_raise:
            return self.passive(c)
        total = c.obs.my_bet + c.obs.my_stack
        if amount >= 0.45 * total:
            return RaiseTo(lg.max_raise_to)
        return RaiseTo(lg.clamp(amount))

    def bet_pot(self, c, frac):
        """Bet (or raise) a fraction of the pot after calling."""
        obs = c.obs
        cur = obs.my_bet + c.to_call
        amt = cur + frac * (obs.pot + c.to_call)
        if c.to_call > 0:
            amt = max(amt, cur + 2 * c.to_call)
        return self.raise_to(c, amt)

    def bf_vs(self, seat):
        return 1.0 + (self.bf[seat] - 1.0) * self.p["bf_scale"]

    def bf_behind(self, c):
        b = c.behind()
        if not b:
            return 1.0
        return sum(self.bf_vs(s) for s in b) / len(b)

    # ---- the decision -------------------------------------------------------------------
    def decide(self, c):
        if c.obs.street == 0:
            return self.preflop(c)
        return self.postflop(c)

    # ---- preflop ------------------------------------------------------------------------
    def open_range(self, c):
        return min(0.85, OPEN.get(c.nb, 0.11) * self.p["open_mult"])

    def opener_range(self, c, seat):
        return OPEN.get(c.nb_of(seat), 0.15)

    def shove_range_eq(self, c, seat, nraises):
        """Equity of my hand against seat's all-in range."""
        s_bb = int(min(MAX_S, max(1, round(c.start[seat] / c.bb))))
        nb = max(1, min(MAX_NB, c.nb_of(seat)))
        if nraises <= 1 and c.start[seat] / c.bb <= MAX_S:
            return EQVS[nb][s_bb][c.h]
        frac = PUSHFRAC[nb][min(MAX_S, s_bb)] * (0.45 if nraises >= 2 else 0.6)
        return eq_vs_top(max(0.025, min(frac, 0.3)), c.h)

    def preflop(self, c):
        obs, lg = c.obs, c.lg
        nr = len(c.pf_raises)
        # a big bet relative to my stack: all-in decision
        if c.to_call > 0 and (c.to_call >= 0.4 * obs.my_stack or
                              (nr and obs.seats[c.pf_raiser].all_in and c.to_call >= 0.25 * obs.my_stack)):
            return self.vs_allin(c)
        if nr == 0:
            if c.eff_bb <= self.p["pf_depth"]:
                return self.push_fold(c)
            return self.unopened(c)
        if c.eff_bb <= self.p["pf_depth"] + 3:
            return self.reshove_or_fold(c)
        if nr == 1:
            return self.vs_open(c)
        if nr == 2:
            return self.vs_3bet(c)
        return self.vs_4bet(c)

    def push_ev(self, c, bf):
        """ICM-adjusted EV (bb) of open-shoving relative to folding."""
        S = int(min(MAX_S, max(1, round(c.eff_bb))))
        nb = max(1, min(MAX_NB, c.nb))
        pot = c.pot / c.bb
        pf = PFOLD[nb][S]
        e = EQC[nb][S][c.h]
        risk = c.obs.my_stack / c.bb
        risk = min(risk, c.eff_bb)
        return pf * pot + (1 - pf) * (e * (pot + c.eff_bb - 0.75) - (1 - e) * risk * bf)

    def push_fold(self, c):
        if self.push_ev(c, self.bf_behind(c)) > 0:
            return self.shove(c)
        if c.lg.can_check:
            return Check()
        return Fold()

    def unopened(self, c):
        rng = self.open_range(c)
        if c.limpers:
            rng *= 0.7
        if c.pct <= rng:
            size = self.p["open_size"] + len(c.limpers)
            if c.nb == 1:
                size += 0.5
            return self.raise_to(c, size * c.bb)
        if c.lg.can_check:
            return Check()
        if c.nb == 1 and not c.limpers and c.pct <= rng * 1.5:   # SB completes a bit
            return Call()
        return Fold()

    def reshove_or_fold(self, c):
        """Short stack facing a raise that is not (yet) all-in."""
        nr = len(c.pf_raises)
        r = c.pf_raiser
        frac = self.opener_range(c, r) * (0.5 if nr >= 2 else 1.0)
        call_frac = max(0.03, frac * 0.45)
        e = eq_vs_top(call_frac, c.h)
        pot = c.pot / c.bb
        risk = c.obs.my_stack / c.bb
        opp_more = min(c.obs.seats[r].stack, c.obs.my_stack + c.obs.my_bet - c.obs.seats[r].bet) / c.bb
        pf = 1 - call_frac / max(frac, 1e-9)
        pf *= 0.92 ** len(c.behind())
        bf = self.bf_vs(r)
        ev = pf * pot + (1 - pf) * (e * (pot + max(0.0, opp_more)) - (1 - e) * risk * bf)
        if ev > 0.0:
            return self.shove(c)
        return self.fold(c)

    def vs_open(self, c):
        p = self.p
        r = c.pf_raiser
        frac = self.opener_range(c, r)
        late = c.nb_of(r) <= 3
        if c.pct <= min(p["tb_value"], 0.4 * frac + 0.01):
            return self.three_bet(c)
        if p["tb_light"] > 0 and (late or not p["tb_light_late_only"]):
            lo = min(p["tb_value"], 0.4 * frac + 0.01)
            if lo < c.pct <= lo + p["tb_light"] and self.light_ok(c) and self.rand() < 0.7:
                return self.three_bet(c)
        k = p["call_k"] + (0.25 if c.obs.seat == c.obs.bb_seat else 0.0)
        price = c.to_call / max(1, c.pot + c.to_call)
        if c.pct <= k * frac and price < 0.36 and c.eff_bb >= 20:
            return Call()
        return self.fold(c)

    def light_ok(self, c):
        hi, lo, suited, pair = class_parts(c.h)
        return suited or pair or hi >= 11

    def three_bet(self, c):
        cur = c.pf_raises[-1][1]
        mult = 3.0 if c.ip else 3.6
        if c.eff_bb <= 28:
            return self.shove(c)
        return self.raise_to(c, cur * mult + c.bb * len(c.callers))

    def vs_3bet(self, c):
        p = self.p
        cur = c.pf_raises[-1][1]
        if c.pct <= p["fb_value"]:
            if c.eff_bb <= 45:
                return self.shove(c)
            return self.raise_to(c, cur * 2.3)
        price = c.to_call / max(1, c.pot + c.to_call)
        if c.pct <= p["call_3b"] and price < 0.38 and c.eff_bb >= 30:
            return Call()
        return self.fold(c)

    def vs_4bet(self, c):
        if c.pct <= self.p["call_4b"]:
            return self.shove(c)
        return self.fold(c)

    def vs_allin(self, c):
        """Call (or shove over) a bet that commits most of my stack."""
        obs = c.obs
        nr = len(c.pf_raises)
        r = c.pf_raiser if c.pf_raiser is not None else c.opps[0]
        e = self.allin_equity(c, r, nr)
        n_allin = sum(1 for s in c.opps if obs.seats[s].all_in or obs.seats[s].bet >= obs.my_bet + c.to_call)
        if n_allin >= 2:
            e *= 0.72
        behind = [s for s in c.behind() if not obs.seats[s].all_in]
        e *= 0.97 ** len(behind)
        risk = c.to_call
        bf = self.bf_vs(r)
        pot = obs.pot
        ev = e * pot - (1 - e) * risk * bf - self.p["call_icm_margin"] * risk
        if ev > 0:
            if c.lg.can_raise and c.lg.max_raise_to <= obs.my_bet + obs.my_stack and \
                    c.to_call < obs.my_stack:
                return self.shove(c)
            return Call()
        return self.fold(c)

    def allin_equity(self, c, seat, nr):
        return self.shove_range_eq(c, seat, nr)

    # ---- postflop -----------------------------------------------------------------------
    def postflop(self, c):
        obs = c.obs
        hand = Hand(obs.hole, obs.board)
        nopp = max(1, len(c.opps))
        e = hand.equity(nopp)
        c.hand, c.e = hand, e
        spr = obs.my_stack / max(1, obs.pot)
        if c.to_call == 0:
            return self.post_unbet(c, hand, e, spr)
        return self.post_facing(c, hand, e, spr)

    def post_unbet(self, c, hand, e, spr):
        p = self.p
        obs = c.obs
        st = obs.street
        if not c.lg.can_raise:
            return Check()
        if e >= p["vb_thresh"]:
            if spr < 1.3:
                return self.shove(c)
            return self.bet_pot(c, p["value_size"] if hand.wet or st >= 2 else p["value_size"] * 0.75)
        pfa = c.pf_raiser == c.me
        if pfa and st == 1 and len(c.opps) <= p["cbet_max_opp"] and self.rand() < p["cbet_freq"]:
            return self.bet_pot(c, p["cbet_size"])
        if pfa and st == 2 and (st - 1) in c.i_bet_streets and len(c.opps) == 1 and \
                (hand.any_draw or e >= 0.5) and self.rand() < p["barrel_freq"] + 0.3:
            return self.bet_pot(c, 0.6)
        if hand.draw and st < 3 and len(c.opps) <= 2 and self.rand() < p["semibluff"] * 0.6:
            return self.bet_pot(c, 0.55)
        return Check()

    def pressure(self, c):
        """Discount on my equity estimate when facing a bet."""
        obs = c.obs
        frac = c.to_call / max(1, obs.pot - c.to_call)
        nr = len(c.street_raises)
        return self.p["pressure"] * (0.6 + 0.6 * min(frac, 1.5)) + 0.05 * (nr - 1) + 0.03 * (obs.street - 1)

    def post_facing(self, c, hand, e, spr):
        p = self.p
        obs = c.obs
        req = c.to_call / (obs.pot + c.to_call)
        ea = e - self.pressure(c)
        if e >= p["raise_thresh"] and c.lg.can_raise:
            if spr < 2.5:
                return self.shove(c)
            return self.bet_pot(c, 0.8)
        if c.to_call >= obs.my_stack and ea >= req:
            return Call()
        if ea >= req:
            return Call()
        if hand.draw and obs.street == 1 and c.lg.can_raise and len(c.opps) == 1 and \
                len(c.street_raises) == 1 and self.rand() < p["semibluff"] * 0.35:
            return self.bet_pot(c, 0.8)
        return Fold()
