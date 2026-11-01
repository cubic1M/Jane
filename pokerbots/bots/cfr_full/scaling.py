"""Play a library policy in a game that differs from it only in chip scale.

Every chip amount in an Observation is divided by k (rounded to the library game's
chips), so the bot plays its library game; its raise is multiplied back by k and
clamped into the real legal range. Cards, streets and discards are unchanged.
"""
from __future__ import annotations

from dataclasses import replace

from engine.game import RAISE, LegalActions, RaiseTo


def _s(x, k) -> int:
    return int(round(x / k))


def scale_obs(obs, k, lib_spec):
    """The observation in library chips (k = real chips per library chip)."""
    my_c, opp_c = _s(obs.my_committed, k), _s(obs.opp_committed, k)
    my_pip, opp_pip = _s(obs.my_pip, k), _s(obs.opp_pip, k)
    lg = obs.legal
    lo, hi = _s(lg.min_raise_to, k), _s(lg.max_raise_to, k)
    legal = replace(lg, call_amount=max(0, opp_pip - my_pip) if lg.can_call else 0,
                    min_raise_to=min(lo, hi), max_raise_to=hi)
    hist = tuple(replace(r, amount=_s(r.amount, k)) for r in obs.history)
    return replace(obs, pot=my_c + opp_c, my_pip=my_pip, opp_pip=opp_pip,
                   my_stack=_s(obs.my_stack, k), opp_stack=_s(obs.opp_stack, k),
                   my_committed=my_c, opp_committed=opp_c, legal=legal, history=hist,
                   bankroll=_s(obs.bankroll, k), big_blind=lib_spec.big_blind)


def unscale_action(a, obs, k, scaled_legal: LegalActions):
    """The bot's action (in library chips) as a legal action in real chips."""
    if a.kind != RAISE or not obs.legal.can_raise:
        return a
    lg = obs.legal
    if a.amount >= scaled_legal.max_raise_to:
        return RaiseTo(lg.max_raise_to)
    if a.amount <= scaled_legal.min_raise_to:
        return RaiseTo(lg.min_raise_to)
    return RaiseTo(lg.clamp_raise(float(a.amount * k)))
