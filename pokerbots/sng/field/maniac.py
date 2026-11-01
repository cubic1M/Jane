"""maniac: raises and shoves very often (the "aggression + randomness" team, or a
bot whose sizing bug always picks big raises).

Preflop: shoves 12% of all hands outright; otherwise raises 4-5bb with the top 65%;
re-raises a raise 3x with 45% of the top 60%; calls up to 25% of its stack with the
top 80%. Postflop: bets the pot 75% of the time when checked to; facing a bet raises
40%, shoves any top pair+, calls any pair/draw. Once >= 40% of its stack is in the
pot it never folds.
"""
from __future__ import annotations

from .common import TOP_PAIR, WEAK_PAIR, FieldBot, bet_pot, fold, open_size, passive, reraise, shove


class Maniac(FieldBot):
    name = "maniac"

    def act(self, obs):
        start = obs.my_stack + obs.seats[obs.seat].committed
        if obs.seats[obs.seat].committed >= 0.4 * start and obs.legal.can_call:
            return shove(obs) if self.rng.random() < 0.5 else passive(obs)
        return super().act(obs)

    def preflop(self, obs, sit, top):
        r = self.rng.random()
        if r < 0.12:
            return shove(obs)
        if sit.raises == 0:
            if top <= 0.65:
                return open_size(obs, sit, 4 + self.rng.random())
            return passive(obs) if sit.to_call == 0 else fold(obs)
        if top <= 0.60 and self.rng.random() < 0.45:
            return reraise(obs, sit, 3)
        if top <= 0.80 and sit.to_call <= 0.25 * sit.my_bb * sit.bb:
            return passive(obs)
        return fold(obs)

    def postflop(self, obs, sit, tier, draw):
        r = self.rng.random()
        if sit.to_call == 0:
            return bet_pot(obs, 1.0) if r < 0.75 or tier >= TOP_PAIR else passive(obs)
        if tier >= TOP_PAIR:
            return shove(obs)
        if r < 0.40:
            return bet_pot(obs, 1.0)
        if tier >= WEAK_PAIR or draw >= 1:
            return passive(obs)
        return fold(obs)
