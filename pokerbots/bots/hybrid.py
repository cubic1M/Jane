"""Hybrid (registry name "hybrid"): full-game CFR by default, the adaptive bot vs
exploitable opponents.

Designed after the round-robin (see REPORT §5): full_cfr was best against the
strong field but extracted little from weak opponents, adaptive the reverse.
  * Both bots receive every new_match / end_hand, so the adaptive bot's opponent
    model keeps learning whichever bot played the hand.
  * At the first decision of each hand the gate picks who plays the whole hand:
    adaptive if max |dimension| of its opponent model >= gate (confidence-weighted
    exploit scores in [-1, 1]; 0 before the minimum sample, < ~0.2 vs balanced-like
    opponents), else full CFR.
  * Without a CFR policy file it is the adaptive bot (using_fallback = True).
"""
from __future__ import annotations

from bots.adaptive import AdaptiveBot
from bots.full_cfr import FullCFRBot
from engine.bot import Bot


class HybridBot(Bot):
    name = "hybrid"

    def __init__(self, budget: str = "30m", gate: float = 0.35, ad_params: dict | None = None,
                 ad_adapt: dict | None = None, gate_mode: str = "max", **cfr_kw):
        self.cfr = FullCFRBot(budget=budget, **cfr_kw)
        self.ad = AdaptiveBot(params=ad_params, adapt=ad_adapt)
        self.gate = gate
        # "max": any exploit score >= gate (original). "nofold": only an opponent that
        # (almost) never folds, postflop (F) or to our preflop raises (PF) - stations,
        # maniacs, pushers. Strong aggressive bots fold sometimes, so CFR keeps playing
        # them (the "max" gate was exploited by an adaptive opponent, REPORT §7).
        self.gate_mode = gate_mode
        self.using_fallback = False
        self._hand = None
        self._who = None
        self.hands_adaptive = 0
        self.hands_cfr = 0

    def new_match(self, spec, seed=0):
        super().new_match(spec, seed)
        self.cfr.new_match(spec, seed)
        self.ad.new_match(spec, seed + 7919)
        self.using_fallback = bool(getattr(self.cfr, "using_fallback", False))
        self._hand = None

    def gate_open(self) -> bool:
        dims = getattr(self.ad, "dims", {}) or {}
        if not dims:
            return False
        if self.gate_mode == "nofold":
            return min(dims.get("F", 0.0), dims.get("PF", 0.0)) <= -self.gate
        return max(abs(v) for v in dims.values()) >= self.gate

    def act(self, obs):
        if obs.hand_index != self._hand:
            self._hand = obs.hand_index
            use_ad = self.using_fallback or self.gate_open()
            self._who = self.ad if use_ad else self.cfr
            if use_ad:
                self.hands_adaptive += 1
            else:
                self.hands_cfr += 1
        return self._who.act(obs)

    def end_hand(self, result):
        self.cfr.end_hand(result)
        self.ad.end_hand(result)

    def end_match(self):
        self.cfr.end_match()
        self.ad.end_match()


def make_bot(**kwargs):
    return HybridBot(**kwargs)
