"""station: loose-passive "see every flop, never fold a pair" bot.

Preflop: limps ~60% of hands, calls raises costing <= 8% of its stack with ~70% of
hands, calls big raises / all-ins with the top ~20%; min-raises only the top ~2%.
Postflop: calls any bet with any pair or draw (and floats the flop with nothing 40% of
the time against a half-pot bet or less); calls all-ins with top pair+; bets 1/3 pot
only with two pair+; raises only monsters.
"""
from __future__ import annotations

from .common import MONSTER, TOP_PAIR, TWO_PAIR, WEAK_PAIR, FieldBot, bet_pot, fold, passive, raise_to


class Station(FieldBot):
    name = "station"

    def preflop(self, obs, sit, top):
        lg = obs.legal
        if top <= 0.02 and lg.can_raise:
            return raise_to(obs, lg.min_raise_to)
        if sit.to_call == 0:
            return passive(obs)
        stack = sit.my_bb * sit.bb
        if sit.raises == 0:
            return passive(obs) if top <= 0.60 else fold(obs)
        if sit.to_call <= 0.08 * stack and top <= 0.70:
            return passive(obs)
        if top <= 0.20:
            return passive(obs)
        return fold(obs)

    def postflop(self, obs, sit, tier, draw):
        if sit.to_call == 0:
            return bet_pot(obs, 0.33, commit_frac=0.2) if tier >= TWO_PAIR else passive(obs)
        if tier >= MONSTER:
            return bet_pot(obs, 0.75)
        if sit.facing_allin or sit.to_call >= 0.5 * obs.my_stack:
            return passive(obs) if tier >= TOP_PAIR else fold(obs)
        if tier >= WEAK_PAIR or draw >= 1:
            return passive(obs)
        pot_before = max(1, sit.pot - sit.to_call - obs.my_bet)
        if obs.street == 1 and sit.to_call <= 0.5 * pot_before and self.rng.random() < 0.4:
            return passive(obs)
        return fold(obs)
