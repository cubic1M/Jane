"""Find a pre-trained policy (the library in cache/cfr/) for a spec under any name.

On the day the announced variant gets a new spec name, so `full_<name>_<budget>.pkl`
does not exist even when the library holds a policy for exactly the same game. A
policy fits when the game tree is identical: everything in the spec except its name,
time limits, hands per match and notes.

    from bots.cfr_full.library import find_policy, nearest
"""
from __future__ import annotations

import glob
import os
import pickle

# fields that do not change the game tree
IGNORED = dict(name="", time_per_decision=None, time_per_match=None, hands_per_match=1, notes="")
_SCAN: dict = {}


def game_key(spec) -> str:
    return repr(spec.with_(**IGNORED))


def _spec_of(path):
    from bots.cfr_full.policy import _spec_from_repr
    key = (path, os.path.getmtime(path))
    if key not in _SCAN:
        try:
            with open(path, "rb") as f:
                _SCAN[key] = _spec_from_repr(pickle.load(f)["spec_repr"])
        except Exception:
            _SCAN[key] = None
    return _SCAN[key]


def library(budget: str, cache_dir: str):
    """[(path, spec)] for every readable policy file with this budget suffix."""
    out = []
    for p in sorted(glob.glob(os.path.join(cache_dir, f"full_*_{budget}.pkl"))):
        s = _spec_of(p)
        if s is not None:
            out.append((p, s))
    return out


def find_policy(spec, budget: str, cache_dir: str):
    """Path of a library policy trained for the same game as `spec`, else None."""
    k = game_key(spec)
    for p, s in library(budget, cache_dir):
        if game_key(s) == k:
            return p
    return None


def diff(a, b) -> list:
    """Game-tree fields where specs a and b differ."""
    da, db = a.with_(**IGNORED).__dict__, b.with_(**IGNORED).__dict__
    return [f for f in da if da[f] != db[f]]


def nearest(spec, budget: str, cache_dir: str, n: int = 3):
    """The n library games closest to `spec`: [(spec_name, path, differing fields)]."""
    rows = [(s.name, p, diff(spec, s)) for p, s in library(budget, cache_dir)]
    return sorted(rows, key=lambda r: len(r[2]))[:n]
