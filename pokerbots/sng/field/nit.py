"""nit: plays only premiums but plays them hard (the "just wait for aces" team).

Preflop: opens / calls only the top ~3.5% (JJ+, AK, AQs), raising to 4bb (+1 per
limper); 3-bets them to 4x; facing a 3-bet or an all-in, shoves the top ~2% (QQ+, AKs)
and folds the rest. Even short it keeps the same range (it blinds down: a nit's flaw).
Postflop: top pair+ bets the pot; two pair+ shoves over a raise; top pair calls one bet
but folds to a raise; anything weaker checks and folds. Never bluffs.
"""
from __future__ import annotations

from .common import TOP_PAIR, TWO_PAIR, FieldBot, bet_pot, fold, open_size, passive, reraise, shove


class Nit(FieldBot):
    name = "nit"
    play_top = 0.035
    stackoff_top = 0.02

    def preflop(self, obs, sit, top):
        if top > self.play_top:
            return fold(obs)
        if sit.raises == 0:
            return open_size(obs, sit, 4)
        if sit.raises == 1 and not sit.facing_allin:
            return reraise(obs, sit, 4)
        if top <= self.stackoff_top:
            return shove(obs)
        return passive(obs) if sit.to_call <= 0.25 * sit.my_bb * sit.bb else fold(obs)

    def postflop(self, obs, sit, tier, draw):
        if sit.to_call == 0:
            return bet_pot(obs, 1.0) if tier >= TOP_PAIR else passive(obs)
        if tier >= TWO_PAIR:
            return shove(obs) if sit.raises >= 2 else bet_pot(obs, 1.0)
        if tier == TOP_PAIR and sit.raises <= 1:
            return passive(obs)
        return fold(obs)
