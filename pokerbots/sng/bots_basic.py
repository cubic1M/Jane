"""Minimal sit-and-go bots for testing the engine (random legal, calling station)."""
from __future__ import annotations

import random

from engine.game import Call, Check, Discard, Fold, RaiseTo


def random_discard(obs, rng):
    """A legal random discard for a discard/draw phase."""
    lg = obs.legal
    k = rng.randint(lg.discard_min, lg.discard_count)
    return Discard(rng.sample(list(obs.hole), k))


class SngBot:
    name = "base"

    def new_table(self, rules, seat, seed=0):
        self.rules, self.seat = rules, seat
        self.rng = random.Random(seed)

    def act(self, obs):
        if getattr(obs.legal, "discard_count", 0):
            return random_discard(obs, self.rng)
        return self.decide(obs)

    def decide(self, obs):
        return obs.legal.passive()


class RandomSng(SngBot):
    name = "random"

    def decide(self, obs):
        lg = obs.legal
        r = self.rng.random()
        if lg.can_raise and r < 0.25:
            return RaiseTo(self.rng.choice([lg.min_raise_to, lg.max_raise_to,
                                            self.rng.randint(lg.min_raise_to, lg.max_raise_to)]))
        if r < 0.45 and not lg.can_check:
            return Fold()
        return lg.passive()


class StationSng(SngBot):
    name = "station"


class PushSng(SngBot):
    name = "push"

    def decide(self, obs):
        lg = obs.legal
        return RaiseTo(lg.max_raise_to) if lg.can_raise else lg.passive()
