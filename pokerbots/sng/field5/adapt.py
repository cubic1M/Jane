"""f5_adapt: profiles each opponent (nit, TAG, LAG, station, maniac) from VPIP, PFR and
postflop aggression, and switches exploits per opponent: steals from nits, value-bets
stations, traps maniacs, and re-steals against LAGs."""
from __future__ import annotations

from engine.game import Call, Check

from .core import OPEN, Base, eq_vs_top

MIN_HANDS = 15


def profile(t, s) -> str:
    if t.hands[s] < MIN_HANDS:
        return "unk"
    v, pr, af = t.vpip_r(s), t.pfr_r(s), t.aggfreq(s)
    if (v > 0.45 and pr > 0.28) or (af > 0.62 and pr > 0.25):
        return "maniac"
    if v > 0.36 and pr < 0.14:
        return "station"
    if v > 0.27 and pr > 0.17:
        return "lag"
    if v < 0.16:
        return "nit"
    return "tag"


OVR = {
    "nit": dict(cbet_freq=0.9, barrel_freq=0.6, pressure=0.18, semibluff=0.6, value_size=0.5),
    "station": dict(cbet_freq=0.25, barrel_freq=0.0, semibluff=0.1, vb_thresh=0.56,
                    value_size=0.85, pressure=0.15),
    "maniac": dict(cbet_freq=0.4, pressure=0.0, vb_thresh=0.62, raise_thresh=0.9),
    "lag": dict(pressure=0.06, semibluff=0.55, cbet_freq=0.6),
    "tag": dict(),
    "unk": dict(),
}


class AdaptBot(Base):
    P = dict(Base.P)

    def prof(self, s):
        return profile(self.tracker, s)

    def main_opp(self, c):
        if c.street_raises:
            return c.street_raises[-1][0]
        if c.obs.street == 0 and c.pf_raiser is not None and c.pf_raiser != c.me:
            return c.pf_raiser
        if len(c.opps) == 1:
            return c.opps[0]
        return None

    def decide(self, c):
        o = self.main_opp(c)
        c.target = o
        c.tprof = self.prof(o) if o is not None else "unk"
        self.p = dict(self.P, **OVR[c.tprof]) if c.tprof in OVR else self.P
        return super().decide(c)

    # ---- preflop --------------------------------------------------------------------------
    def opener_range(self, c, seat):
        base = OPEN.get(c.nb_of(seat), 0.15)
        t = self.tracker
        if t.hands[seat] < MIN_HANDS:
            return base
        return max(0.03, min(0.8, base * t.pfr_r(seat) / 0.17))

    def open_range(self, c):
        rng = super().open_range(c)
        behind = c.behind()
        if behind:
            profs = [self.prof(s) for s in behind]
            if all(p == "nit" for p in profs):
                rng = min(0.8, rng * 2.0)                  # steal from nits
            elif all(p in ("nit", "tag") for p in profs) and c.nb <= 3:
                rng = min(0.7, rng * 1.35)
            if any(p == "maniac" for p in profs):
                rng *= 0.85
        return rng

    def unopened(self, c):
        behind = c.behind()
        if behind and c.pct <= 0.03 and any(self.prof(s) == "maniac" for s in behind) \
                and self.rand() < 0.5 and not c.limpers:
            return Call()                                  # trap a maniac: limp-reraise
        if behind and all(self.prof(s) == "station" for s in behind) and c.pct <= super().open_range(c):
            return self.raise_to(c, (3.0 + len(c.limpers)) * c.bb)   # stations pay: bigger opens
        return super().unopened(c)

    def vs_open(self, c):
        r = c.pf_raiser
        pr = self.prof(r)
        if c.me in c.limpers and c.pct <= 0.04:
            return self.three_bet(c)
        if pr == "lag" and c.nb_of(r) <= 3:
            frac = self.opener_range(c, r)
            if c.pct <= max(0.06, 0.35 * frac) or (c.pct <= 0.45 * frac and self.light_ok(c)
                                                    and self.rand() < 0.75):
                return self.three_bet(c)                   # re-steal
        if pr == "maniac" and c.pct <= 0.02 and c.eff_bb >= 25 and self.rand() < 0.5:
            return Call()                                  # trap
        if pr == "nit" and c.pct > 0.02:
            return self.fold(c) if c.pct > 0.04 else Call()
        return super().vs_open(c)

    def allin_equity(self, c, seat, nr):
        e = super().allin_equity(c, seat, nr)
        t = self.tracker
        if t.hands[seat] >= MIN_HANDS:
            pr = self.prof(seat)
            if pr in ("maniac", "lag"):
                e = max(e, eq_vs_top(min(0.6, t.pfr_r(seat) * (1.6 if pr == "maniac" else 1.1)), c.h))
            elif pr == "nit":
                e = min(e, eq_vs_top(0.06, c.h))
        return e

    def reshove_or_fold(self, c):
        if self.prof(c.pf_raiser) == "nit" and c.pct > 0.03:
            return self.fold(c)
        return super().reshove_or_fold(c)

    # ---- postflop -------------------------------------------------------------------------
    def post_unbet(self, c, hand, e, spr):
        if c.tprof == "maniac" and e >= 0.7 and spr > 1.3 and c.obs.street < 3 and self.rand() < 0.75:
            return Check()                                 # let the maniac bet
        if c.tprof == "station" and e < 0.45:
            return Check()                                 # never bluff a station
        if c.tprof == "nit" and c.lg.can_raise and len(c.opps) == 1 and c.obs.street >= 2 \
                and self.tracker.fold_to_bet(c.target) > 0.5 and self.rand() < 0.4:
            return self.bet_pot(c, 0.6)                    # nits fold: keep stabbing
        return super().post_unbet(c, hand, e, spr)

    def post_facing(self, c, hand, e, spr):
        if c.tprof == "maniac":
            req = c.to_call / (c.obs.pot + c.to_call)
            if e >= 0.8 and c.obs.street == 3 and c.lg.can_raise:
                return self.shove(c)
            if e >= 0.8 and c.obs.street < 3:
                return Call()                              # let him keep firing
            if e >= req + 0.02:
                return Call()
        if c.tprof == "lag" and hand.draw and c.lg.can_raise and c.obs.street == 1 and self.rand() < 0.35:
            return self.bet_pot(c, 0.8)
        return super().post_facing(c, hand, e, spr)
