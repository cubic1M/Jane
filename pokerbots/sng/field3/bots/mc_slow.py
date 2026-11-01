"""(2) The over-engineered team: Monte Carlo equity vs every opponent with a fixed
300 samples on every decision. Fine heads-up on their laptop; multiway it often
takes over 1 ms, and then the engine checks or folds for it."""
from __future__ import annotations

from engine.game import Call, Check, Fold, RaiseTo

from ..common import F3Bot, Spot, allin, raise_to_pot_frac
from ..postflop import mc_equity


class MonteCarloBot(F3Bot):
    name = "f3_mc_slow"
    N = 300

    def decide(self, obs):
        sp = Spot(obs)
        eq = mc_equity(obs.hole, obs.board, sp.n_opp, self.N, self.nrng, self.spec, self.ev)
        fair = 1.0 / (sp.n_opp + 1)
        lg = obs.legal
        if eq > max(0.55, 1.8 * fair) and lg.can_raise:
            to = raise_to_pot_frac(obs, 1.0)
            if to - obs.my_bet >= 0.5 * sp.my_total:
                return allin(obs)
            return RaiseTo(to)
        if sp.to_call == 0:
            if eq > 1.4 * fair and lg.can_raise:
                return RaiseTo(raise_to_pot_frac(obs, 0.6))
            return Check()
        if eq >= sp.pot_odds + 0.03:
            return Call()
        return Fold()
