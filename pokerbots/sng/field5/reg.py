"""f5_reg: tight regular. Light 3-bets against late-position opens, folds to 4-bets without
AA/KK, small c-bets, barrels good turns and gives up otherwise."""
from __future__ import annotations

from engine.game import Check

from .core import Base

PREMIUM_4B = 0.0095      # AA, KK


class RegBot(Base):
    P = dict(Base.P, open_mult=0.9, tb_light=0.13, tb_light_late_only=True, call_k=0.45,
             call_3b=0.045, call_4b=PREMIUM_4B, cbet_freq=0.8, cbet_size=0.33, cbet_max_opp=1,
             vb_thresh=0.66, pressure=0.12, semibluff=0.35)

    def light_ok(self, c):
        from .core import class_parts
        hi, lo, suited, pair = class_parts(c.h)
        return suited or (hi == 12 and lo >= 8) or (pair and hi >= 4)

    def vs_4bet(self, c):
        if c.pct <= PREMIUM_4B:
            return self.shove(c)
        return self.fold(c)

    @staticmethod
    def good_turn(c, hand):
        """A turn that helps the flop c-bettor: an overcard to the flop, or my hand/draw
        is real."""
        b = c.obs.board
        turn = b[3] >> 2
        flop_top = max(x >> 2 for x in b[:3])
        return turn > flop_top and turn >= 10 or hand.level >= 4 or hand.draw

    def post_unbet(self, c, hand, e, spr):
        p = self.p
        st = c.obs.street
        pfa = c.pf_raiser == c.me
        if not c.lg.can_raise:
            return Check()
        if e >= p["vb_thresh"]:
            if spr < 1.3:
                return self.shove(c)
            return self.bet_pot(c, 0.6 if st >= 2 else 0.4)
        if pfa and st == 1 and len(c.opps) == 1 and self.rand() < p["cbet_freq"]:
            return self.bet_pot(c, p["cbet_size"])
        if pfa and st == 2 and 1 in c.i_bet_streets and len(c.opps) == 1:
            if self.good_turn(c, hand) and self.rand() < 0.75:
                return self.bet_pot(c, 0.6)
            return Check()                       # give up
        if pfa and st == 3 and 2 in c.i_bet_streets and len(c.opps) == 1 and e >= 0.55:
            return self.bet_pot(c, 0.55)
        return Check()
