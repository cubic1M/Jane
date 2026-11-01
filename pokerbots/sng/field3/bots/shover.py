"""(3) Shove-heavy: open-jam a wide range, re-jam over raises, call jams tight-ish.
Postflop (rare) jam any pair or good draw."""
from __future__ import annotations

from engine.game import Call, Check, Fold

from ..common import F3Bot, Spot, allin
from ..postflop import hand_info
from ..pushfold import interp


class ShoverBot(F3Bot):
    name = "f3_shover"

    def decide(self, obs):
        sp = Spot(obs)
        lg = obs.legal
        if obs.street == 0:
            p = self.pf.pct(obs.hole)
            if sp.unopened:
                x = interp(sp.eff_bb, (6, 10, 15, 25, 40), (0.55, 0.40, 0.30, 0.20, 0.12))
                if sp.n_behind <= 2:
                    x *= 1.3
                if p <= x:
                    return allin(obs)
                return Check() if lg.can_check else Fold()
            x = 0.07 if sp.facing_allin else 0.10
            if sp.pot_odds >= 0.4:
                x += 0.10
            if sp.stack_bb < 10:
                x += 0.08
            if p <= x:
                return allin(obs)
            return Fold()
        hi = hand_info(obs.hole, obs.board, self.ev, self.spec)
        if hi.level >= 2 or hi.outs >= 8:
            return allin(obs)
        if lg.can_check:
            return Check()
        if hi.level >= 1 and sp.pot_odds < 0.3:
            return Call()
        return Fold()
