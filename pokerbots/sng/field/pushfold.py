"""pushfold_icm: the team that studied sit-and-go strategy: tight early, then
Nash-style push/fold once short, and ICM-aware (calls all-ins tighter than it pushes).

  * Deep (> 15bb effective): a tighter chen_tag (opens ~6-12%, 3-bets ~3%).
  * <= 15bb, unopened (limpers allowed): all-in with the top push_range(bb, behind),
    roughly Nash 8-max: at 10bb ~14% UTG, ~40% on the button, ~55% in the SB; ranges
    widen as the stack shrinks ((10/bb)^0.8) and as fewer players are left to act.
  * <= 15bb facing a raise or an all-in: shove / call only with the top
    pusher_range * factor, where the pusher's range is estimated with the same model
    from the raiser's stack and position, and factor shrinks with ICM pressure (more
    players left, a bigger part of my stack at risk) and grows with a good price.
  * Short postflop: shove top pair+ or a strong draw, else check / fold.
"""
from __future__ import annotations

from .common import TOP_PAIR, acting_order, bet_pot, fold, passive, shove
from .tag import ChenTag

_BASE_BY_BEHIND = {0: 0.70, 1: 0.55, 2: 0.40, 3: 0.30, 4: 0.23, 5: 0.19, 6: 0.16}


def push_range(bb: float, behind: int) -> float:
    """Fraction of hands to shove unopened with `bb` big blinds and `behind` players
    still to act (incl. the blinds)."""
    base = _BASE_BY_BEHIND.get(behind, 0.14)
    return min(1.0, base * (10.0 / max(1.0, bb)) ** 0.8)


class PushFoldIcm(ChenTag):
    name = "pushfold_icm"
    open_top = {"early": 0.06, "middle": 0.08, "late": 0.12, "blind": 0.10}
    threebet_top = 0.03
    call_top = 0.05
    push_bb = 15

    def preflop(self, obs, sit, top):
        if sit.eff_bb > self.push_bb:
            return super().preflop(obs, sit, top)
        if sit.raises == 0:
            rng = push_range(sit.eff_bb, sit.behind) * (0.7 if sit.limpers else 1.0)
            if top <= rng:
                return shove(obs)
            return passive(obs) if sit.to_call == 0 else fold(obs)
        return shove(obs) if top <= self.allin_call_range(obs, sit) else fold(obs)

    def allin_call_range(self, obs, sit) -> float:
        raiser = obs.seats[sit.last_raiser]
        raiser_bb = (raiser.stack + raiser.committed) / sit.bb
        order = acting_order(obs)                       # preflop: UTG .. big blind
        behind = len(order) - 1 - order.index(sit.last_raiser)   # left to act behind the raiser
        their = push_range(min(raiser_bb, sit.my_bb), behind)
        factor = 0.5 if obs.players_left <= 2 else 0.4 if obs.players_left <= 3 else 0.3
        if sit.to_call < 0.5 * obs.my_stack:          # less of my stack at risk
            factor *= 1.3
        if sit.price <= 0.30:                          # e.g. the big blind vs a small shove
            factor *= 1.6
        return min(0.5, their * factor)

    def postflop(self, obs, sit, tier, draw):
        if sit.eff_bb > self.push_bb:
            return super().postflop(obs, sit, tier, draw)
        if tier >= TOP_PAIR or draw >= 2:
            return shove(obs)
        if sit.to_call == 0 and sit.pf_raiser == obs.seat and sit.opps == 1 and obs.street == 1:
            return bet_pot(obs, 0.5, commit_frac=0.6)
        return fold(obs)
