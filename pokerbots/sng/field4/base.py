"""Shared runtime pieces for the field-4 bots: tables, range math, observation parsing,
an opponent tracker and a safe base class. Everything heavy is done at import time."""
from __future__ import annotations

import os
import random

import numpy as np

from engine.game import Call, Check, Fold, RaiseTo

from .features import (N_DRAW, N_MADE, N_TEX, class_info, combos_of, hand_class, post_features,
                       post_index)

_DATA = np.load(os.path.join(os.path.dirname(__file__), "data", "f4_tables.npz"))
PRE_K = _DATA["pre_k"].astype(float)            # [169, 8], column k = vs k random hands
PF_MAT = _DATA["pf_mat"].astype(float)          # [169, 169]
_POST = _DATA["post"].astype(float)             # [3, made, draw, tex, 5]
POST_FLAT = [list(map(float, row)) for row in _POST.reshape(-1, 5)]
PRE_K_L = [list(map(float, row)) for row in PRE_K]
COMBOS = np.array([combos_of(c) for c in range(169)], float)


def post_eq(street: int, made: int, draw: int, tex: int, k: int) -> float:
    return POST_FLAT[post_index(street, made, draw, tex)][min(4, max(1, k))]


# ---- range orderings ----------------------------------------------------------------
def _order(score):
    order = sorted(range(169), key=lambda c: -score[c])
    pct = [0.0] * 169
    top = [0.0] * 169           # cumulative fraction of combos up to and including the class
    acc = 0.0
    for c in order:
        w = COMBOS[c] / 1326.0
        pct[c] = acc + w / 2
        acc += w
        top[c] = acc
    return order, pct, top


# heads-up all-in ordering (push / call ranges) and a multiway ordering (open ranges)
HU_ORDER, HU_PCT, HU_TOP = _order(PRE_K[:, 1])
MW_ORDER, MW_PCT, MW_TOP = _order(0.5 * PRE_K[:, 1] + 0.5 * PRE_K[:, 3] * 2.2)


def _blocker_weights():
    """W[i, j] = combos of class j left when I hold a representative combo of class i."""
    W = np.zeros((169, 169))
    allc = {}
    for j in range(169):
        hi, lo, s, p = class_info(j)
        cl = []
        for a in range(4):
            for b in range(4):
                if p and a < b or (not p and s and a == b) or (not p and not s and a != b):
                    cl.append((hi * 4 + a, lo * 4 + b))
        allc[j] = cl
    for i in range(169):
        hi, lo, s, p = class_info(i)
        mine = {hi * 4, lo * 4 + 1} if p else ({hi * 4, lo * 4} if s else {hi * 4, lo * 4 + 1})
        for j in range(169):
            W[i, j] = sum(1 for a, b in allc[j] if a not in mine and b not in mine)
    return W


BLOCK_W = _blocker_weights()


def _eq_vs_top():
    """EQ_TOP[i][p]: equity of class i vs the top p% (p = 0..100) of HU_ORDER, blockers in."""
    inc = np.zeros((101, 169))
    for p in range(101):
        lim = max(p, 0.5) / 100.0
        acc = 0.0
        for c in HU_ORDER:
            w = COMBOS[c] / 1326.0
            if acc >= lim:
                break
            inc[p, c] = min(1.0, (lim - acc) / w)
            acc += w
    wpf = BLOCK_W * PF_MAT
    num = inc @ wpf.T          # (101, 169)
    den = inc @ BLOCK_W.T
    return [list(map(float, row)) for row in (num / den).T]


EQ_TOP = _eq_vs_top()


def eq_vs_range(cls: int, pct: float) -> float:
    """Heads-up all-in equity of my class vs the top `pct` (0..1) of hands."""
    p = min(100.0, max(0.0, pct * 100.0))
    i = int(p)
    if i >= 100:
        return EQ_TOP[cls][100]
    f = p - i
    row = EQ_TOP[cls]
    return row[i] * (1 - f) + row[i + 1] * f


def multiway_eq(eqs) -> float:
    """Combine heads-up equities against several opponents (independence approximation)."""
    if not eqs:
        return 1.0
    if len(eqs) == 1:
        return eqs[0]
    s = 0.0
    for e in eqs:
        e = min(0.995, max(0.005, e))
        s += (1 - e) / e
    return 1.0 / (1.0 + s * 1.15)


# ---- observation parsing ------------------------------------------------------------
class Ctx:
    __slots__ = ("obs", "bb", "street", "pot", "to_call", "stack", "bet", "total", "me",
                 "opps", "live_opps", "eff", "eff_bb", "acts", "n_raises", "last_raiser",
                 "last_raise_to", "limpers", "callers", "pfr", "order", "my_idx", "behind",
                 "pos", "n_hand", "ip", "cls", "pre_acts", "i_raised", "bets_faced",
                 "allin_faced", "max_opp_total", "facing_allin")

    def __init__(self, obs):
        self.obs = obs
        self.bb = bb = max(1, obs.big_blind)
        self.street = obs.street
        self.pot = obs.pot
        lg = obs.legal
        self.to_call = lg.call_amount if lg.can_call else 0
        self.stack = obs.my_stack
        self.bet = obs.my_bet
        self.total = obs.my_stack + obs.my_bet
        me = self.me = obs.seat
        seats = obs.seats
        n = len(seats)
        self.opps = [s.seat for s in seats if s.in_hand and not s.folded and s.seat != me]
        self.live_opps = [j for j in self.opps if not seats[j].all_in]
        self.max_opp_total = max((seats[j].stack + seats[j].bet for j in self.opps), default=0)
        self.eff = min(self.total, self.max_opp_total)
        self.eff_bb = self.eff / bb
        self.n_hand = sum(1 for s in seats if s.in_hand)
        # preflop acting order: from the seat after the big blind
        in_hand = [s.seat for s in seats if s.in_hand]
        start = obs.bb_seat
        order = []
        for k in range(1, n + 1):
            j = (start + k) % n
            if seats[j].in_hand:
                order.append(j)
        self.order = order
        self.my_idx = order.index(me) if me in order else 0
        # position label by distance to the end of the preflop order
        from_end = len(order) - 1 - self.my_idx
        if len(in_hand) == 2:
            self.pos = "BB" if me == obs.bb_seat else "BTN"
        elif me == obs.bb_seat:
            self.pos = "BB"
        elif me == obs.sb_seat:
            self.pos = "SB"
        elif me == obs.button:
            self.pos = "BTN"
        elif from_end == 3:
            self.pos = "CO"
        elif from_end == 4:
            self.pos = "HJ"
        elif from_end == 5:
            self.pos = "MP"
        else:
            self.pos = "EP"
        # this street's actions and the whole preflop
        st = obs.street
        acts = []
        pre = []
        for (s, street, kind, amt) in obs.history:
            if kind == "post":
                continue
            if street == st:
                acts.append((s, kind, amt))
            if street == 0:
                pre.append((s, kind, amt))
        self.acts = acts
        self.pre_acts = pre
        nr = 0
        lr = -1
        lrt = 0
        limpers = 0
        callers = 0
        i_raised = False
        for (s, kind, amt) in acts:
            if kind == "raise":
                nr += 1
                lr = s
                lrt = amt
                callers = 0
                if s == me:
                    i_raised = True
            elif kind == "call":
                if nr == 0:
                    limpers += 1
                else:
                    callers += 1
        self.n_raises = nr
        self.last_raiser = lr
        self.last_raise_to = lrt
        self.limpers = limpers if st == 0 else 0
        self.callers = callers
        self.i_raised = i_raised
        self.bets_faced = nr
        pfr = -1
        for (s, kind, amt) in pre:
            if kind == "raise":
                pfr = s
        self.pfr = pfr
        # players still to act after me this street (preflop order; postflop from the button)
        if st == 0:
            later = order[self.my_idx + 1:]
        else:
            post_order = sorted(order, key=lambda j: (j - obs.button - 1) % n)
            i = post_order.index(me) if me in post_order else 0
            later = post_order[i + 1:]
            self.ip = all((j - obs.button - 1) % n < (me - obs.button - 1) % n for j in self.opps)
        if st == 0:
            self.ip = obs.button == me or (self.pos == "BTN")
        if st == 0:
            self.behind = [j for j in later if j in self.live_opps]
        else:
            acted = {s for (s, kind, amt) in acts}
            self.behind = [j for j in later if j in self.live_opps and j not in acted]
        self.allin_faced = lr >= 0 and seats[lr].all_in
        self.facing_allin = self.to_call > 0 and any(seats[j].all_in and seats[j].bet > self.bet for j in self.opps)
        self.cls = hand_class(obs.hole)


# ---- opponent tracker ------------------------------------------------------------------
STAT_KEYS = ("hands", "vpip", "pfr", "open_opp", "open", "steal_opp", "steal_fold", "f3_opp", "f3_fold",
             "three_opp", "three", "cbet_opp", "cbet", "fcb_opp", "fcb_fold", "fb_opp", "fb_fold",
             "agg", "pas", "fo_opp", "fo_fold", "push_opp", "push", "callai_opp", "callai", "sd", "sd_weak", "limp")


class Tracker:
    """Per-seat counters for one table, updated from end_hand(info)."""

    def __init__(self, n):
        self.n = n
        self.s = [dict.fromkeys(STAT_KEYS, 0) for _ in range(n)]
        self.button = 0
        self.bb = 20
        self.in_hand = ()

    def note(self, obs):
        self.button = obs.button
        self.bb = obs.big_blind
        self.sb_seat = obs.sb_seat
        self.bb_seat = obs.bb_seat
        self.in_hand = tuple(s.seat for s in obs.seats if s.in_hand)

    def rate(self, seat, num, den, prior, w=4.0):
        st = self.s[seat]
        return (st[num] + prior * w) / (st[den] + w)

    def vpip(self, seat):
        return self.rate(seat, "vpip", "hands", 0.25, 6)

    def pfr_rate(self, seat):
        return self.rate(seat, "pfr", "hands", 0.15, 6)

    def open_rate(self, seat):
        return self.rate(seat, "open", "open_opp", 0.2, 5)

    def fold_to_steal(self, seat):
        return self.rate(seat, "steal_fold", "steal_opp", 0.65, 4)

    def fold_to_3bet(self, seat):
        return self.rate(seat, "f3_fold", "f3_opp", 0.55, 3)

    def fold_to_open(self, seat):
        st = self.s[seat]
        return (st["fo_fold"] + 1.0) / (st["fo_opp"] + 2.0)

    def fold_to_cbet(self, seat):
        return self.rate(seat, "fcb_fold", "fcb_opp", 0.45, 4)

    def fold_to_bet(self, seat):
        return self.rate(seat, "fb_fold", "fb_opp", 0.45, 5)

    def push_rate(self, seat):
        return self.rate(seat, "push", "push_opp", 0.25, 4)

    def call_allin(self, seat):
        return self.rate(seat, "callai", "callai_opp", 0.2, 4)

    def aggression(self, seat):
        st = self.s[seat]
        return (st["agg"] + 1.0) / (st["pas"] + 1.5)

    def end_hand(self, info):
        hist = info["history"]
        stacks_end = info["stacks"]
        deltas = info["deltas"]
        n = self.n
        start = [stacks_end[j] - deltas[j] for j in range(n)]
        dealt = set(self.in_hand) if self.in_hand else {j for j in range(n) if start[j] > 0}
        bb = self.bb
        S = self.s
        for j in dealt:
            S[j]["hands"] += 1
        committed = [0] * n
        bet = [0] * n
        street = 0
        cur = 0
        nr = 0
        opener = -1
        three_bettor = -1
        limpers = 0
        vp = set()
        pf = set()
        pfr = -1
        late = self._late_seats()
        flop_bet_by_pfr = False
        bet_this_street = False
        checked_to = True
        for (s, stt, kind, amt) in hist:
            if stt != street:
                street = stt
                bet = [0] * n
                cur = 0
                nr = 0
                bet_this_street = False
                checked_to = True
            if kind == "post":
                committed[s] += amt
                bet[s] += amt
                cur = max(cur, bet[s])
                continue
            st = S[s]
            if street == 0:
                if kind in ("call", "raise"):
                    vp.add(s)
                if nr == 0 and limpers == 0:
                    st["open_opp"] += 1
                    if start[s] <= 15 * bb:
                        st["push_opp"] += 1
                if nr == 1 and s != opener:
                    st["three_opp"] += 1
                    st["fo_opp"] += 1
                    if kind == "fold":
                        st["fo_fold"] += 1
                    if s in (self.sb_seat, self.bb_seat) and opener in late and limpers == 0:
                        st["steal_opp"] += 1
                        if kind == "fold":
                            st["steal_fold"] += 1
                if nr == 2 and s == opener:
                    st["f3_opp"] += 1
                    if kind == "fold":
                        st["f3_fold"] += 1
                if kind == "raise":
                    if nr == 0 and limpers == 0:
                        st["open"] += 1
                        if committed[s] + amt - bet[s] >= 0.6 * start[s] and start[s] <= 15 * bb:
                            st["push"] += 1
                    if nr == 1 and s != opener:
                        st["three"] += 1
                        three_bettor = s
                    if nr == 0:
                        opener = s
                    pf.add(s)
                    pfr = s
                    nr += 1
                elif kind == "call" and nr == 0:
                    limpers += 1
                    st["limp"] += 1
                # facing an all-in
                if kind in ("call", "fold") and cur - bet[s] > 0:
                    ai = any(committed[j] >= start[j] and bet[j] >= cur for j in range(n) if j != s)
                    if ai and cur >= 4 * bb:
                        st["callai_opp"] += 1
                        if kind == "call":
                            st["callai"] += 1
            else:
                if kind in ("raise",):
                    st["agg"] += 1
                elif kind == "call":
                    st["pas"] += 1
                if street == 1 and s == pfr and not bet_this_street and checked_to:
                    st["cbet_opp"] += 1
                    if kind == "raise":
                        st["cbet"] += 1
                        flop_bet_by_pfr = True
                if bet_this_street and kind in ("call", "fold", "raise") and s != pfr:
                    st["fb_opp"] += 1
                    if kind == "fold":
                        st["fb_fold"] += 1
                    if street == 1 and flop_bet_by_pfr and nr == 1:
                        st["fcb_opp"] += 1
                        if kind == "fold":
                            st["fcb_fold"] += 1
                elif bet_this_street and kind in ("call", "fold", "raise"):
                    st["fb_opp"] += 1
                    if kind == "fold":
                        st["fb_fold"] += 1
                if kind == "check" and s == pfr:
                    pass
                if kind == "raise":
                    bet_this_street = True
                    nr += 1
            if kind == "call":
                committed[s] += amt
                bet[s] += amt
            elif kind == "raise":
                add = amt - bet[s]
                committed[s] += add
                bet[s] = amt
                cur = max(cur, amt)
        for s in vp:
            S[s]["vpip"] += 1
        for s in pf:
            S[s]["pfr"] += 1
        sd = info.get("showdown")
        if sd:
            for j, hole in sd.items():
                S[j]["sd"] += 1
        self.in_hand = ()

    def _late_seats(self):
        """CO, button and small blind of the last hand."""
        ih = [j for j in range(self.n) if j in self.in_hand] if self.in_hand else list(range(self.n))
        if not ih:
            return set()
        n = self.n
        out = {self.button, getattr(self, "sb_seat", -1)}
        # cutoff: the in-hand seat before the button
        for k in range(1, n):
            j = (self.button - k) % n
            if j in ih:
                out.add(j)
                break
        return out


# ---- base bot ------------------------------------------------------------------------------
class F4Bot:
    """Safe wrapper: decide() may return any Action; act() makes it legal and never raises."""

    name = "f4"
    track = True

    def __init__(self, **params):
        for k, v in params.items():
            if not hasattr(type(self), k):
                raise AttributeError(f"{type(self).__name__} has no parameter {k!r}")
            setattr(self, k, v)

    def new_table(self, rules, seat, seed):
        self.rules = rules
        self.seat = seat
        self.rng = random.Random(seed * 7919 + 17)
        self.tracker = Tracker(rules.num_players)
        self._cache_key = None
        self._cache_val = None
        self.setup()

    def setup(self):
        pass

    def end_hand(self, info):
        if self.track:
            self.tracker.end_hand(info)
        self.hand_done(info)

    def hand_done(self, info):
        pass

    def act(self, obs):
        lg = obs.legal
        try:
            if self.track:
                self.tracker.note(obs)
            a = self.decide(obs, Ctx(obs))
        except Exception:  # noqa: BLE001
            a = None
        return fix(a, lg)

    def decide(self, obs, c):
        return Check() if obs.legal.can_check else Fold()

    # helpers
    def raise_to(self, obs, amount, allin_frac=0.75):
        lg = obs.legal
        if not lg.can_raise:
            return Call() if lg.can_call else Check()
        amount = int(amount)
        if amount >= lg.max_raise_to * allin_frac + obs.my_bet * (1 - allin_frac):
            return RaiseTo(lg.max_raise_to)
        return RaiseTo(min(lg.max_raise_to, max(lg.min_raise_to, amount)))

    def allin(self, obs):
        lg = obs.legal
        if lg.can_raise:
            return RaiseTo(lg.max_raise_to)
        return Call() if lg.can_call else Check()

    def passive(self, obs):
        return Check() if obs.legal.can_check else Fold()

    def street_eq(self, obs, c, k):
        """Bucket equity vs k random hands, cached per street."""
        key = (obs.hand_number, obs.street, obs.hole, obs.board)
        if self._cache_key != key:
            self._cache_key = key
            self._cache_val = post_features(obs.hole, obs.board)
        m, d, t, _ = self._cache_val
        return post_eq(obs.street, m, d, t, k)

    def feats(self, obs):
        key = (obs.hand_number, obs.street, obs.hole, obs.board)
        if self._cache_key != key:
            self._cache_key = key
            self._cache_val = post_features(obs.hole, obs.board)
        return self._cache_val


def fix(a, lg):
    """Return a legal version of `a` (or the passive action)."""
    if a is not None:
        k = a.kind
        if k == "raise":
            if lg.can_raise:
                amt = min(lg.max_raise_to, max(lg.min_raise_to, int(a.amount)))
                return RaiseTo(amt)
            return Call() if lg.can_call else Check()
        if k == "call":
            return Call() if lg.can_call else Check()
        if k == "check":
            return Check() if lg.can_check else Fold()
        if k == "fold":
            return Check() if lg.can_check else Fold()
    return Check() if lg.can_check else Fold()


__all__ = ["PRE_K", "PRE_K_L", "PF_MAT", "post_eq", "HU_ORDER", "HU_PCT", "HU_TOP", "MW_ORDER", "MW_PCT",
           "MW_TOP", "eq_vs_range", "multiway_eq", "Ctx", "Tracker", "F4Bot", "fix", "N_MADE", "N_DRAW",
           "N_TEX", "hand_class"]


def _post_percentiles():
    """POST_PCT[index][k]: percentile of a bucket's equity vs k random hands among all
    random holdings on that street (bucket frequencies from the offline counts)."""
    n = _DATA["post_n"].astype(float)              # [3, made, draw, tex]
    out = np.zeros(_POST.shape)
    for s in range(3):
        cnt = n[s].reshape(-1)
        tot = cnt.sum()
        for k in range(1, 5):
            eq = _POST[s, ..., k].reshape(-1)
            order = np.argsort(eq, kind="stable")
            cum = np.cumsum(cnt[order])
            pct = np.empty_like(eq)
            pct[order] = (cum - cnt[order] / 2) / tot
            # equal equities share a percentile
            out[s, ..., k] = pct.reshape(_POST.shape[1:4])
    return [list(map(float, row)) for row in out.reshape(-1, 5)]


POST_PCT = _post_percentiles()


def post_pct(street: int, made: int, draw: int, tex: int, k: int) -> float:
    return POST_PCT[post_index(street, made, draw, tex)][min(4, max(1, k))]
