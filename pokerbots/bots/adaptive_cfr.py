"""Combination bot (registry name "adaptive_cfr"): preflop CFR + adaptive postflop.

Designed after the first half of the round-robin showed that preflop_cfr is the
strongest against good bots while adaptive extracts far more from exploitable
ones (e.g. vs push at 100bb: adaptive +6.9 bb/hand, preflop_cfr +1.4).

  * Preflop: the CFR policy (as preflop_cfr), unless the opponent model is
    confident that the opponent is extreme preflop: max(|PF|, |PA|) >= gate, where
    PF = folds to our preflop raises and PA = preflop aggression are the adaptive
    bot's confidence-weighted exploit scores in [-1, 1] (0 before its minimum
    sample, < ~0.2 against balanced-like opponents). Then it plays the adaptive
    bot's (exploitative) preflop instead.
  * Postflop and discards: the adaptive bot (balanced with opponent-adjusted knobs).
  * Without a policy file it is exactly the adaptive bot (using_fallback = True).
MRO: AdaptiveCFRBot -> PreflopCFRBot -> AdaptiveBot -> BalancedBot.
"""
from __future__ import annotations

from bots.adaptive import AdaptiveBot
from bots.preflop_cfr import PreflopCFRBot


class AdaptiveCFRBot(PreflopCFRBot, AdaptiveBot):
    name = "adaptive_cfr"

    def __init__(self, budget: str = "15m", policy_path: str | None = None, gate: float = 0.35,
                 params: dict | None = None):
        super().__init__(budget=budget, policy_path=policy_path, params=params)
        self.gate = gate
        self.exploit_preflop = 0

    def preflop_gate_open(self) -> bool:
        d = self.dims
        return max(abs(d.get("PF", 0.0)), abs(d.get("PA", 0.0))) >= self.gate

    def preflop_action(self, obs):
        if not self.using_fallback and self.preflop_gate_open():
            self.exploit_preflop += 1
            return AdaptiveBot.preflop_action(self, obs)
        return super().preflop_action(obs)


def make_bot(**kwargs):
    return AdaptiveCFRBot(**kwargs)
