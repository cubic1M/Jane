"""Bot interface (FROZEN). Every bot subclasses Bot.

Lifecycle per match:
    bot.new_match(spec, seed)      # spec = the rules; seed = for the bot's own RNG
    for each hand:
        bot.act(obs) -> Action     # called at each decision (bet or discard)
        bot.end_hand(result)       # HandResult: own delta, opponent cards if shown
    bot.end_match()

Rules for bots:
  * Never return an illegal action (it is treated as a fold). Use obs.legal.
  * Read the rules only from the spec passed to new_match (never hard-code them)
    and the position from obs.position.
  * Respect spec.time_per_decision / spec.time_per_match (timeout = fold).
  * No access to hidden cards or the opponent object: use only obs/result.
"""
from __future__ import annotations

import random

from .game import Action, HandResult, Observation
from .spec import GameSpec


class Bot:
    name = "bot"

    def new_match(self, spec: GameSpec, seed: int = 0) -> None:
        self.spec = spec
        self.rng = random.Random(seed)

    def act(self, obs: Observation) -> Action:  # pragma: no cover - abstract
        raise NotImplementedError

    def end_hand(self, result: HandResult) -> None:
        pass

    def end_match(self) -> None:
        pass
