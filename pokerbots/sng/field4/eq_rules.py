"""f4_eqrule -- the design brief's equity-threshold rules, with this team's own parameters.

* Preflop: k = players still to act + limpers; equity of my class vs k random hands.
  Shove when effective stack <= PUSH_BB and equity >= (0.75 + 0.25 eff/PUSH_BB)/(k+1);
  otherwise open to (2 + limpers) bb when equity >= OPEN_BAR/(k+1) times a steal factor
  from the players-behind fold-to-open rate.
* Facing a raise: the raiser counts as 4 random hands (+0.8 per extra opponent); re-raise
  with roughly AA/KK, call on pot odds plus margin (plus an ICM premium when committing).
* Postflop: bucket equity vs the live opponents, discounted per bet faced; never raises
  a bet; value bets 65% pot, c-bets half pot heads-up, small bluffs vs over-folders.
"""
from __future__ import annotations

from engine.game import Call, Check, Fold

from .base import F4Bot, PRE_K_L



def pre_eq(cls, k):
    k = max(1.0, min(7.0, k))
    i = int(k)
    row = PRE_K_L[cls]
    if i >= 7:
        return row[7]
    f = k - i
    return row[i] * (1 - f) + row[i + 1] * f


class EqRules(F4Bot):
    PUSH_BB = 10.0
    OPEN_BAR = 1.12
    RERAISE = 2.5
    CALL_MARGIN = 0.05
    POST_DISCOUNT = 0.62
    name = "f4_eqrule"

    def premium(self, obs):
        return 0.10 * (1 + 0.15 * (8 - obs.players_left))

    def decide(self, obs, c):
        if obs.street == 0:
            return self.preflop(obs, c)
        return self.postflop(obs, c)

    def preflop(self, obs, c):
        lg = obs.legal
        T = self.tracker
        bb = c.bb
        cls = c.cls
        if c.n_raises == 0:
            k = len(c.behind) + c.limpers
            if k == 0:
                return Check() if lg.can_check else Call()
            eq = pre_eq(cls, k)
            if c.eff_bb <= self.PUSH_BB:
                if eq >= (0.75 + 0.25 * c.eff_bb / self.PUSH_BB) / (k + 1):
                    return self.allin(obs)
                return self.passive(obs)
            sf = 1.0
            if 1 <= len(c.behind) <= 5 and c.limpers == 0:
                f = sum(T.fold_to_open(j) for j in c.behind) / len(c.behind)
                sf = 1 - 0.55 * max(0.0, 2 * f - 1)
            if eq >= self.OPEN_BAR / (k + 1) * sf and lg.can_raise:
                return self.raise_to(obs, (2 + c.limpers) * bb, allin_frac=0.9)
            return self.passive(obs)
        others = len(c.opps) - 1
        kf = 4 + 0.8 * max(0, others)
        eq = pre_eq(cls, kf)
        call = lg.call_amount
        pot = obs.pot
        if eq * (kf + 1) >= self.RERAISE and lg.can_raise:
            if c.eff_bb <= 24:
                return self.allin(obs)
            return self.raise_to(obs, 3 * c.last_raise_to)
        need = call / (pot + call) + self.CALL_MARGIN
        if call >= obs.my_stack or call > 0.4 * obs.my_stack:
            need += self.premium(obs)
        if eq >= need:
            return Call()
        return self.passive(obs)

    def postflop(self, obs, c):
        lg = obs.legal
        T = self.tracker
        k = max(1, len(c.opps))
        eq = self.street_eq(obs, c, k)
        pot = obs.pot
        if c.to_call > 0:
            adj = eq * self.POST_DISCOUNT ** c.bets_faced
            call = c.to_call
            need = call / (pot + call) + self.CALL_MARGIN
            if call >= 0.5 * obs.my_stack:
                need += self.premium(obs)
            return Call() if adj >= need else Fold()
        if not lg.can_raise:
            return Check()
        if eq >= 0.62:
            return self.raise_to(obs, obs.my_bet + 0.65 * pot)
        if obs.street == 1 and c.pfr == obs.seat and k == 1:
            if self.rng.random() < 0.55:
                return self.raise_to(obs, 0.5 * pot)
            return Check()
        if k <= 2:
            f = sum(T.fold_to_bet(j) for j in c.opps) / k
            if self.rng.random() < 0.4 * max(0.0, 2 * f - 1):
                return self.raise_to(obs, 0.5 * pot)
        return Check()
