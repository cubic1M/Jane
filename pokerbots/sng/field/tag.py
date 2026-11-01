"""chen_tag: the "solid" tight-aggressive bot a good team writes from a poker primer.

Preflop (ranges are Chen-formula ranks as a top-% of starting hands, see common.py):
  * unopened: open-raise by position (early ~7%: 99+/AQ+, middle ~10%, late ~18%,
    blinds ~14%) to 3bb early / 2.5bb late, +1bb per limper; never open-limps;
  * facing one raise: 3-bet ~3.5% (JJ+/AK) to 3x, call ~8% if it costs <= 6bb and
    <= 12% of the stack, else fold; facing a 3-bet or more: shove ~2% (QQ+/AKs), else fold;
  * short (<= 10bb effective): shove ~15% unopened, call all-ins with ~6%.
Postflop (made-hand tier from the evaluator, draws from rank/suit counts):
  * two pair or better: bet / raise 2/3 pot; top pair: bet 2/3 pot, call up to a pot-
    sized bet but fold to a raise war; weak pair: check, call small flop bets only;
  * strong draws: call when the price is <= 30%; semi-bluff as the aggressor;
  * c-bet 2/3 pot on the flop as the preflop raiser 60% of the time vs <= 2 opponents.
"""
from __future__ import annotations

from .common import (STRONG, TOP_PAIR, TWO_PAIR, WEAK_PAIR, FieldBot, bet_pot, fold, open_size,
                     passive, reraise, shove)


class ChenTag(FieldBot):
    name = "chen_tag"
    open_top = {"early": 0.07, "middle": 0.10, "late": 0.18, "blind": 0.14}
    open_bb = {"early": 3.0, "middle": 3.0, "late": 2.5, "blind": 3.0}
    threebet_top = 0.035
    call_top = 0.08
    fourbet_top = 0.02
    short_bb = 10
    short_push_top = 0.15
    short_call_top = 0.06
    cbet_freq = 0.6
    bet_frac = 0.67

    # ---- preflop ---------------------------------------------------------------------
    def preflop(self, obs, sit, top):
        if sit.eff_bb <= self.short_bb:
            return self.short_stack(obs, sit, top)
        if sit.raises == 0:
            return self.unopened(obs, sit, top)
        if sit.raises == 1:
            return self.vs_raise(obs, sit, top)
        return self.vs_3bet(obs, sit, top)

    def open_range(self, obs, sit):
        return self.open_top[sit.position]

    def unopened(self, obs, sit, top):
        if top <= self.open_range(obs, sit):
            return open_size(obs, sit, self.open_bb[sit.position])
        return fold(obs)

    def threebet_range(self, obs, sit):
        return self.threebet_top

    def call_range(self, obs, sit):
        return self.call_top

    def vs_raise(self, obs, sit, top):
        if top <= self.threebet_range(obs, sit):
            return reraise(obs, sit, 3)
        cheap = sit.to_call <= 6 * sit.bb and sit.to_call <= 0.12 * sit.my_bb * sit.bb
        if top <= self.call_range(obs, sit) and cheap:
            return passive(obs)
        return fold(obs)

    def vs_3bet(self, obs, sit, top):
        if top <= self.fourbet_top:
            return shove(obs)
        return fold(obs)

    def short_stack(self, obs, sit, top):
        if sit.raises == 0 and sit.limpers == 0:
            return shove(obs) if top <= self.short_push_top else fold(obs)
        if top <= self.short_call_top:
            return shove(obs)
        return fold(obs)

    # ---- postflop --------------------------------------------------------------------
    def postflop(self, obs, sit, tier, draw):
        if sit.to_call == 0:
            return self.checked_to(obs, sit, tier, draw)
        return self.facing_bet(obs, sit, tier, draw)

    def checked_to(self, obs, sit, tier, draw):
        if tier >= TOP_PAIR:
            return bet_pot(obs, self.bet_frac)
        aggressor = sit.pf_raiser == obs.seat
        if aggressor and obs.street == 1 and sit.opps <= 2:
            if draw >= 2 or self.rng.random() < self.cbet_freq:
                return bet_pot(obs, self.bet_frac)
        return passive(obs)

    def facing_bet(self, obs, sit, tier, draw):
        pot_before = max(1, sit.pot - sit.to_call - obs.my_bet)     # pot before this bet
        if tier >= TWO_PAIR:
            if tier >= STRONG or sit.raises <= 1:          # two pair calls a raise war
                return bet_pot(obs, 0.75)
            return passive(obs)
        if tier == TOP_PAIR:
            if sit.raises >= 2 or sit.to_call > pot_before:
                return fold(obs)
            return passive(obs)
        if tier == WEAK_PAIR and obs.street == 1 and sit.to_call <= 0.5 * pot_before:
            return passive(obs)
        if draw >= 2 and sit.price <= 0.3:
            return passive(obs)
        return fold(obs)
