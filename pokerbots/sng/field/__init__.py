"""Opponent field for the sit-and-go simulator: archetypes of the bots student teams
write in 60 minutes with an AI assistant. Independent of our own bots (sng/ours, bots/).

    from sng.field import BOTS, field_mix, draw_field
    bots = [factory() for _name, factory in draw_field(random.Random(1), 7)]
"""
from __future__ import annotations

from .adaptive import Adaptive
from .lag import Lag
from .maniac import Maniac
from .mc import McEquityBot, McFastBot
from .nit import Nit
from .pushfold import PushFoldIcm
from .station import Station
from .tag import ChenTag

# one factory per archetype (all with their default parameters)
BOTS = {
    "mc_equity": McEquityBot,
    "mc_fast": McFastBot,
    "chen_tag": ChenTag,
    "lag": Lag,
    "nit": Nit,
    "station": Station,
    "maniac": Maniac,
    "pushfold_icm": PushFoldIcm,
    "adaptive": Adaptive,
}

# Suggested weights for a believable regional student field. Codex's default answer to
# "write a poker bot" is Monte Carlo equity, so MC bots are the biggest group, and many
# of them ignore the 1 ms clock (mc_slow: 1000 samples, auto-folded almost always).
# Rule-based TAGs are next; a few teams know SNG push/fold or track opponents.
FIELD_WEIGHTS = {
    "mc_equity": 12,
    "mc_slow": 6,
    "mc_fast": 12,
    "chen_tag": 18,
    "lag": 8,
    "nit": 8,
    "station": 8,
    "maniac": 6,
    "pushfold_icm": 10,
    "adaptive": 6,
}


def field_mix():
    """(name, factory) pairs for the field, incl. the deliberately slow mc_slow.
    Pair with FIELD_WEIGHTS[name] for sampling."""
    pairs = list(BOTS.items())
    pairs.insert(1, ("mc_slow", lambda: McEquityBot(samples=1000)))
    return pairs


def draw_field(rng, k):
    """k (name, factory) pairs drawn with replacement by FIELD_WEIGHTS."""
    pairs = field_mix()
    return rng.choices(pairs, weights=[FIELD_WEIGHTS[n] for n, _ in pairs], k=k)


__all__ = ["BOTS", "FIELD_WEIGHTS", "field_mix", "draw_field", "Adaptive", "ChenTag", "Lag",
           "Maniac", "McEquityBot", "McFastBot", "Nit", "PushFoldIcm", "Station"]
