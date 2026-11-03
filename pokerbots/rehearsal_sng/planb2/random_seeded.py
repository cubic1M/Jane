"""The kit's random bot, seeded per table (a module counter) for paired A/B runs."""
import random

from table_api import CHECK, RAISE, Action, Agent, Observation

_count = [0]


class Bot(Agent):
    def __init__(self) -> None:
        _count[0] += 1
        self.rng = random.Random(7919 * _count[0])

    def decide(self, obs: Observation) -> Action:
        r = self.rng.random()
        legal = obs.legal_actions
        if RAISE in legal and r < 0.15:
            lo, hi = obs.min_raise_to, obs.max_raise_to
            pot_now = obs.pot + sum(p.committed for p in obs.players)
            top = min(hi, lo + 2 * max(pot_now, obs.big_blind))
            return Action.raise_(self.rng.randint(lo, max(lo, top)))
        if CHECK in legal:
            return Action.check()
        if r < 0.6:
            return Action.call()
        return Action.fold()
