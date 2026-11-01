"""Sample bot: plays random legal actions."""

import random

from table_api import CHECK, RAISE, Action, Agent, Observation


class Bot(Agent):
    def __init__(self) -> None:
        self.rng = random.Random()

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
