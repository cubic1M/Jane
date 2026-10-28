"""Uniformly random legal actions, including odd raise sizes. Used by the
conformance tests to push other bots into unusual spots."""
from __future__ import annotations

from engine.bot import Bot
from engine.game import Call, Check, Discard, Fold, RaiseTo


class RandomLegalBot(Bot):
    name = "random_legal"

    def act(self, obs):
        lg = obs.legal
        if lg.discard_count:
            return Discard(self.rng.sample(list(obs.my_cards), lg.discard_count))
        opts = []
        if lg.can_check:
            opts += ["check"] * 3
        if lg.can_call:
            opts += ["call"] * 3
            opts += ["fold"]
        if lg.can_raise:
            opts += ["min", "rand", "max"]
        c = self.rng.choice(opts)
        if c == "check":
            return Check()
        if c == "call":
            return Call()
        if c == "fold":
            return Fold()
        if c == "min":
            return RaiseTo(lg.min_raise_to)
        if c == "max":
            return RaiseTo(lg.max_raise_to)
        return RaiseTo(self.rng.randint(lg.min_raise_to, lg.max_raise_to))


def make_bot(**kw):
    return RandomLegalBot()
