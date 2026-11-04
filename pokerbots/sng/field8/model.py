"""Per-seat opponent statistics from the end_hand histories, with Bayesian shrinkage.

Every rate is (count + a * prior) / (opportunities + a): a few hands move it a little, a lot
of hands move it to the observed value; it never jumps to an extreme on a small sample.
"""
from __future__ import annotations

from sng.field8 import tables as T
from sng.field8.tables import PCT

PRIORS = {
    "vpip": (0.26, 12), "pfr": (0.18, 12), "open": (0.22, 10), "limp": (0.06, 10),
    "tb": (0.07, 12), "cc": (0.12, 12), "f3": (0.55, 6), "cb": (0.6, 6), "fcb": (0.45, 6),
    "fb": (0.42, 10), "aggr": (0.45, 12), "wtsd": (0.30, 8), "shove": (0.25, 6),
    "callshove": (0.18, 6),
}


class Stats:
    def __init__(self, n: int):
        self.n = n
        z = lambda: [0] * n  # noqa: E731
        self.hands = z()
        self.vpip, self.pfr = z(), z()
        self.open_opp, self.opens, self.limps = z(), z(), z()
        self.tb_opp, self.tbs, self.ccs = z(), z(), z()
        self.f3_opp, self.f3 = z(), z()
        self.cb_opp, self.cbs = z(), z()
        self.fcb_opp, self.fcb = z(), z()
        self.fb_opp, self.fb = z(), z()
        self.bets, self.calls = z(), z()
        self.saw_flop, self.sd = z(), z()
        self.shove_opp, self.shoves = z(), z()
        self.vs_shove, self.call_shove = z(), z()
        self.shown_sum = [0.0] * n        # sum of shown hands' strength percentile (VPIP hands)
        self.shown_n = z()
        # expected counts under the equilibrium tables for the very spots each seat faced
        # (position and depth), so a ratio observed / expected is free of the position mix
        self.exp_open = [0.0] * n
        self.exp_shove = [0.0] * n
        self.exp_callshove = [0.0] * n

    def ratio(self, name: str, j: int) -> float:
        """Observed / expected frequency of opens, open-shoves or calls of shoves, shrunk
        towards 1 with a couple of expected events of pseudo-count."""
        x, e, a = {"open": (self.opens, self.exp_open, 3.0), "shove": (self.shoves, self.exp_shove, 2.0),
                   "callshove": (self.call_shove, self.exp_callshove, 2.0)}[name]
        return (x[j] + a) / (e[j] + a)

    # ---- rates -------------------------------------------------------------------------
    _RATE = {"vpip": ("vpip", "hands"), "pfr": ("pfr", "hands"), "open": ("opens", "open_opp"),
             "limp": ("limps", "open_opp"), "tb": ("tbs", "tb_opp"), "cc": ("ccs", "tb_opp"),
             "f3": ("f3", "f3_opp"), "cb": ("cbs", "cb_opp"), "fcb": ("fcb", "fcb_opp"), "fb": ("fb", "fb_opp"),
             "wtsd": ("sd", "saw_flop"), "shove": ("shoves", "shove_opp"), "callshove": ("call_shove", "vs_shove")}

    def rate(self, name: str, j: int) -> float:
        prior, a = PRIORS[name]
        if name == "aggr":
            xs = self.bets[j]
            return (xs + a * prior) / (xs + self.calls[j] + a)
        xa, na = self._RATE[name]
        return (getattr(self, xa)[j] + a * prior) / (getattr(self, na)[j] + a)

    def sample(self, name: str, j: int) -> int:
        return {"vpip": self.hands, "open": self.open_opp, "tb": self.tb_opp, "f3": self.f3_opp,
                "cb": self.cb_opp, "fcb": self.fcb_opp, "fb": self.fb_opp, "shove": self.shove_opp,
                "callshove": self.vs_shove, "wtsd": self.saw_flop}.get(name, self.hands)[j]

    def looseness(self, j: int) -> float:
        """Shown-hand looseness: mean strength percentile of hands shown (0.5 = random)."""
        prior, a = 0.22, 4
        return (self.shown_sum[j] + a * prior) / (self.shown_n[j] + a)

    # ---- update ------------------------------------------------------------------------
    def update(self, history, showdown, start=None, ante=0):
        n = self.n
        dealt = set()
        acted0 = set()
        vp, pr = set(), set()
        raises = 0
        opener = None
        aggressor = None
        limped = False
        flop_seen = set()
        cb_seat = None             # aggressor's c-bet on the flop
        street_bet = {}            # street -> someone has bet
        faced_cb = set()
        order0, bbv = self._order(history)
        pos0 = {s: i for i, s in enumerate(order0)}
        for item in history:
            try:
                seat, street, kind, amt = item
            except (TypeError, ValueError):
                continue
            if not (isinstance(seat, int) and 0 <= seat < n):
                continue
            if kind == "post":
                dealt.add(seat)
                continue
            if kind == "discard":
                continue
            dealt.add(seat)
            if street == 0:
                first = seat not in acted0
                acted0.add(seat)
                if first:
                    if raises == 0 and not limped:
                        self.open_opp[seat] += 1
                        if start is not None and bbv > 0 and seat in pos0:
                            nb = len(order0) - 1 - pos0[seat]
                            S = start[seat] / bbv
                            self.exp_open[seat] += (T.sv_open_width(nb, max(12.0, S)) if S > 15
                                                    else T.pf_width_fast(max(1, nb), S, 1.0, 1.0))
                    elif raises == 1 and seat != opener:
                        self.tb_opp[seat] += 1
                if raises == 2 and seat == opener and kind in ("fold", "call", "raise"):
                    self.f3_opp[seat] += 1
                    if kind == "fold":
                        self.f3[seat] += 1
                if kind == "raise":
                    if raises == 0 and not limped and first:
                        self.opens[seat] += 1
                    if raises == 1 and seat != opener and first:
                        self.tbs[seat] += 1
                    raises += 1
                    if raises == 1:
                        opener = seat
                    aggressor = seat
                    vp.add(seat)
                    pr.add(seat)
                elif kind == "call":
                    if amt and amt > 0:
                        vp.add(seat)
                    if raises == 0:
                        if first and not limped:
                            self.limps[seat] += 1
                        limped = True
                    elif raises == 1 and seat != opener and first:
                        self.ccs[seat] += 1
            else:
                flop_seen.add(seat)
                if kind == "raise":
                    self.bets[seat] += 1
                elif kind == "call":
                    self.calls[seat] += 1
                bet_before = street_bet.get(street, False)
                if street == 1 and seat == aggressor and not bet_before and cb_seat is None:
                    self.cb_opp[seat] += 1
                    if kind == "raise":
                        self.cbs[seat] += 1
                        cb_seat = seat
                elif street == 1 and cb_seat is not None and seat != cb_seat and seat not in faced_cb \
                        and kind in ("fold", "call", "raise"):
                    faced_cb.add(seat)
                    self.fcb_opp[seat] += 1
                    if kind == "fold":
                        self.fcb[seat] += 1
                if bet_before and kind in ("fold", "call", "raise"):
                    self.fb_opp[seat] += 1
                    if kind == "fold":
                        self.fb[seat] += 1
                if kind == "raise":
                    street_bet[street] = True
        for s in dealt:
            self.hands[s] += 1
        for s in vp:
            self.vpip[s] += 1
        for s in pr:
            self.pfr[s] += 1
        for s in flop_seen:
            self.saw_flop[s] += 1
        self._shoves(history, start, ante)
        if isinstance(showdown, dict):
            for s, cards in showdown.items():
                if not (isinstance(s, int) and 0 <= s < n):
                    continue
                if s in flop_seen:
                    self.sd[s] += 1
                if s in vp and cards is not None and len(cards) == 2:
                    from sng.field8.hands import hclass
                    try:
                        self.shown_sum[s] += PCT[hclass(int(cards[0]), int(cards[1]))]
                        self.shown_n[s] += 1
                    except (TypeError, ValueError, IndexError):
                        pass

    @staticmethod
    def _order(history):
        """Preflop acting order (first actions; blinds that never acted at the end) and the
        big blind."""
        order, seen, posts, bb = [], set(), [], 0
        for item in history:
            try:
                seat, street, kind, amt = item
            except (TypeError, ValueError):
                continue
            if street != 0:
                continue
            if kind == "post":
                posts.append(seat)
                bb = max(bb, amt or 0)
                continue
            if seat not in seen:
                seen.add(seat)
                order.append(seat)
        for s in posts:
            if s not in seen:
                seen.add(s)
                order.append(s)
        return order, bb

    def _shoves(self, history, start, ante):
        """Open-shove frequency when short and calls against shoves, with the equilibrium
        expectation of each."""
        if start is None:
            return
        n = self.n
        order0, bb = self._order(history)
        if bb <= 0:
            return
        pos0 = {s: i for i, s in enumerate(order0)}
        raises = 0
        limped = False
        shover = None
        k_resp = 0
        nb_s = 1
        seen = set()
        for item in history:
            try:
                seat, street, kind, amt = item
            except (TypeError, ValueError):
                continue
            if street != 0 or not (isinstance(seat, int) and 0 <= seat < n) or kind in ("post", "discard"):
                continue
            first = seat not in seen
            seen.add(seat)
            if first and raises == 0 and not limped and 0 < start[seat] <= 15 * bb and seat in pos0:
                self.shove_opp[seat] += 1
                nb = max(1, len(order0) - 1 - pos0[seat])
                self.exp_shove[seat] += T.pf_width_fast(nb, start[seat] / bb, 1.0, 1.0)
                if kind == "raise" and amt >= start[seat] - ante - 0.5:
                    self.shoves[seat] += 1
            if shover is not None and seat != shover and kind in ("call", "fold") and raises == 1:
                self.vs_shove[seat] += 1
                S = min(start[shover], start[seat]) / bb
                self.exp_callshove[seat] += T.pf_callfrac(nb_s, S, 1.0, 1.0, k_resp) if S <= T.PF_SMAX else 0.04
                k_resp += 1
                if kind == "call":
                    self.call_shove[seat] += 1
            if kind == "raise":
                raises += 1
                if raises == 1 and start[seat] > 0 and amt >= start[seat] - ante - 0.5 and seat in pos0:
                    shover = seat
                    nb_s = max(1, len(order0) - 1 - pos0[seat])
                    k_resp = 0
            elif kind == "call" and raises == 0:
                limped = True
