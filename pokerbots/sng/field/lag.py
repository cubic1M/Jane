"""lag: loose-aggressive, the team that read "aggression wins" and coded it.

Preflop: opens ~25% early to ~45% late / 40% from the blinds to 3bb (+1 per limper);
facing one raise: 3-bets ~7% for value plus 30% of the time light with the top 30%, to
3.2x; calls ~25%; facing a 3-bet: shoves ~3%, calls ~8% if cheap; <= 12bb: shoves ~35%.
Postflop: c-bets 80% (3/4 pot), barrels the turn 55% and the river 35% as the last
aggressor; raises two pair+ and strong draws (35%), bluff-raises 10%; calls any pair or
draw up to a pot-sized bet.
"""
from __future__ import annotations

from .common import (TOP_PAIR, TWO_PAIR, WEAK_PAIR, FieldBot, bet_pot, fold, open_size, passive,
                     reraise, shove)


class Lag(FieldBot):
    name = "lag"
    open_top = {"early": 0.25, "middle": 0.32, "late": 0.45, "blind": 0.40}

    def reset(self):
        self.last_aggressor = False     # was I the last to bet/raise on the previous street?

    def preflop(self, obs, sit, top):
        self.last_aggressor = False
        if sit.eff_bb <= 12:
            if sit.raises == 0:
                return shove(obs) if top <= 0.35 else fold(obs)
            return shove(obs) if top <= 0.12 else fold(obs)
        if sit.raises == 0:
            if top <= self.open_top[sit.position]:
                return open_size(obs, sit, 3)
            return passive(obs) if sit.to_call == 0 else fold(obs)
        if sit.raises == 1:
            if top <= 0.07 or (top <= 0.30 and self.rng.random() < 0.30):
                return reraise(obs, sit, 3.2)
            if top <= 0.25 and sit.to_call <= 0.15 * sit.my_bb * sit.bb:
                return passive(obs)
            return fold(obs)
        if top <= 0.03:
            return shove(obs)
        if top <= 0.08 and sit.to_call <= 0.2 * sit.my_bb * sit.bb:
            return passive(obs)
        return fold(obs)

    def postflop(self, obs, sit, tier, draw):
        was_aggr = self.last_aggressor or (obs.street == 1 and sit.pf_raiser == obs.seat)
        a = self._postflop(obs, sit, tier, draw, was_aggr)
        self.last_aggressor = a.kind == "raise"
        return a

    def _postflop(self, obs, sit, tier, draw, was_aggr):
        r = self.rng.random()
        if sit.to_call == 0:
            if tier >= TOP_PAIR or draw >= 2:
                return bet_pot(obs, 0.75)
            barrel = {1: 0.80, 2: 0.55}.get(obs.street, 0.35)
            if was_aggr and r < barrel:
                return bet_pot(obs, 0.75)
            if sit.opps == 1 and r < 0.25:                   # stab when checked to heads-up
                return bet_pot(obs, 0.5)
            return passive(obs)
        pot_before = max(1, sit.pot - sit.to_call - obs.my_bet)
        if tier >= TWO_PAIR or (draw >= 2 and r < 0.35 and sit.raises <= 1):
            return bet_pot(obs, 0.8)
        if sit.raises <= 1 and sit.opps == 1 and r < 0.10:
            return bet_pot(obs, 0.8)
        if (tier >= WEAK_PAIR or draw >= 1) and sit.to_call <= pot_before:
            return passive(obs)
        return fold(obs)
