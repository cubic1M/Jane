"""Local A/B helper: the kit's random sample bot with a fixed seed (the kit's is unseeded)."""
import random

from table_api import CHECK, RAISE, Action, Agent


class Bot(Agent):
    _n = 0

    def __init__(self) -> None:
        Bot._n += 1
        self.rng = random.Random(Bot._n)

    def decide(self, obs):
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
