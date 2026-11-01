"""(7) The survival bot, built around the points table: every place survived pays,
so fold almost everything until short, play only premiums, then push/fold."""
from __future__ import annotations

from engine.game import Call, Check, Fold, RaiseTo

from ..common import F3Bot, Spot, allin, raise_to_pot_frac
from ..postflop import hand_info


class SurvivorBot(F3Bot):
    name = "f3_survivor"

    def decide(self, obs):
        sp = Spot(obs)
        lg = obs.legal
        if obs.street == 0:
            p = self.pf.pct(obs.hole)
            if sp.unopened:
                if sp.stack_bb <= 6:
                    return allin(obs) if p <= 0.35 else (Check() if lg.can_check else Fold())
                if sp.stack_bb <= 12:
                    return allin(obs) if p <= 0.15 else (Check() if lg.can_check else Fold())
                if p <= 0.025:
                    return RaiseTo(3 * sp.bb + sp.limpers * sp.bb)
                return Check() if lg.can_check else Fold()
            # facing a raise: only premiums; vs bigger stacks only the very top
            bigger = sp.opp_max > sp.my_total and obs.players_left >= 4
            top = 0.012 if bigger else 0.025
            if sp.stack_bb <= 8:
                top = 0.06
            if p <= 0.010:
                return allin(obs)
            if p <= top:
                return Call()
            return Fold()
        hi = hand_info(obs.hole, obs.board, self.ev, self.spec)
        if sp.to_call == 0:
            if hi.level >= 3:
                return RaiseTo(raise_to_pot_frac(obs, 0.75))
            return Check()
        if hi.level >= 4:
            return allin(obs)
        if hi.level == 3 and sp.pot_odds <= 0.35:
            return Call()
        return Fold()
