"""f5_trapper: slow-plays strong hands (limps or flats premiums, checks sets and two pair),
check-raises, and calls down light against seats it has seen bet and raise a lot."""
from __future__ import annotations

from engine.game import Call, Check

from .core import Base, eq_vs_top

PREMIUM = 0.017          # AA, KK, QQ, AKs


class TrapperBot(Base):
    P = dict(Base.P, cbet_freq=0.45, semibluff=0.3, vb_thresh=0.62, pressure=0.10,
             raise_thresh=0.90)

    # ---- reads ----------------------------------------------------------------------------
    def aggression(self, seat):
        t = self.tracker
        return 0.6 * t.aggfreq(seat) + 0.4 * min(1.0, t.pfr_r(seat) / 0.35)

    def light_factor(self, seat):
        """< 1 calls lighter against aggressive seats, > 1 tighter against passive ones."""
        a = self.aggression(seat)
        return max(0.25, min(1.3, 1.6 - 2.0 * a))

    # ---- preflop --------------------------------------------------------------------------
    def unopened(self, c):
        if c.pct <= PREMIUM and c.nb >= 3 and not c.limpers and self.rand() < 0.35:
            return Call()                      # limp, planning to limp-reraise
        return super().unopened(c)

    def vs_open(self, c):
        if c.me in c.limpers or (c.pct <= PREMIUM and c.eff_bb >= 25 and self.rand() < 0.5):
            if c.pct <= 0.04:
                if c.me in c.limpers:
                    return self.three_bet(c)        # the limp-reraise
                return Call()                       # flat the premium
        return super().vs_open(c)

    def allin_equity(self, c, seat, nr):
        e = super().allin_equity(c, seat, nr)
        pfr = self.tracker.pfr_r(seat)
        if pfr > 0.25:          # a maniac's shoves are wide
            e = max(e, eq_vs_top(min(0.6, pfr * 1.4), c.h))
        return e

    # ---- postflop -------------------------------------------------------------------------
    def post_unbet(self, c, hand, e, spr):
        st = c.obs.street
        if hand.level >= 6 and c.lg.can_raise and spr > 1.3 and st < 3:
            slow = 0.65 if st == 1 else 0.35
            if not hand.wet:
                slow += 0.15
            if self.rand() < slow:
                return Check()                  # trap: let them bet
        return super().post_unbet(c, hand, e, spr)

    def pressure(self, c):
        aggr = [s for s, _ in c.street_raises]
        seat = aggr[-1] if aggr else (c.opps[0] if c.opps else c.me)
        return super().pressure(c) * self.light_factor(seat)

    def post_facing(self, c, hand, e, spr):
        st = c.obs.street
        if c.lg.can_raise and c.checked_this_street and e >= 0.72:
            return self.bet_pot(c, 0.9) if spr > 2.0 else self.shove(c)      # check-raise
        if hand.level >= 6 and st == 1 and spr > 2.0 and self.rand() < 0.6:
            return Call()                       # slow-play the flop, raise later
        return super().post_facing(c, hand, e, spr)
