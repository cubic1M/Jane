"""Dummy opponents for sanity checks (registry names "push", "station", "maniac").

* push:    raise to the maximum (all-in, or the pot-limit cap) whenever raising is
           legal, else call, else check. Never folds.
* station: always check or call. Never folds, never raises.
* maniac:  raises with probability PARAMS["raise_prob"] whenever it can, to a
           uniformly random size between a pot-sized raise and the maximum;
           otherwise checks or calls. Never folds.
All three discard their lowest-ranked card(s).
"""
from __future__ import annotations

from engine.bot import Bot
from engine.game import Call, Check, Discard, RaiseTo

PARAMS = dict(raise_prob=0.7)


def _discard_lowest(obs):
    k = obs.legal.discard_count
    return Discard(sorted(obs.my_cards, key=lambda c: (c >> 2, c & 3))[:k])


class PushBot(Bot):
    name = "push"

    def act(self, obs):
        lg = obs.legal
        if lg.discard_count:
            return _discard_lowest(obs)
        if lg.can_raise:
            return RaiseTo(lg.max_raise_to)
        return lg.passive()


class StationBot(Bot):
    name = "station"

    def act(self, obs):
        lg = obs.legal
        if lg.discard_count:
            return _discard_lowest(obs)
        return lg.passive()


class ManiacBot(Bot):
    name = "maniac"

    def __init__(self, raise_prob=None):
        self.raise_prob = PARAMS["raise_prob"] if raise_prob is None else raise_prob

    def act(self, obs):
        lg = obs.legal
        if lg.discard_count:
            return _discard_lowest(obs)
        if lg.can_raise and self.rng.random() < self.raise_prob:
            call = lg.call_amount
            lo = lg.clamp_raise(obs.my_pip + call + obs.pot + call)  # pot-sized raise
            return RaiseTo(self.rng.randint(lo, lg.max_raise_to))
        return lg.passive()


KINDS = {"push": PushBot, "station": StationBot, "maniac": ManiacBot}


def make_bot(kind="station", **kw):
    if kind not in KINDS:
        raise ValueError(f"unknown dummy kind {kind!r}; choose from {sorted(KINDS)}")
    return KINDS[kind](**kw)
