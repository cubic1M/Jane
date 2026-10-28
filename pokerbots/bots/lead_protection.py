"""Lead protection wrapper: ``LeadProtection(inner)``, name ``inner.name + "+lp"``.

Under "win" scoring (the match is won by finishing ahead), two match-level
overrides sit on top of any inner bot; everything else is delegated.

LOCK (fold out). Let
    lead      = obs.bankroll - obs.my_committed       (my total if I fold now)
    R         = hands_in_match - hand_index - 1        (hands after this one)
    max_loss  = sum over those hands of (my blind + ante), positions alternating
                from obs.position (the BB pays big_blind, the SB small_blind)
If ``lead - max_loss >= lock_margin_bb * big_blind`` (margin > 0) then even folding
every remaining hand finishes strictly ahead, so the bot checks when free,
otherwise folds, and discards the lowest card(s) (legal, costs nothing).

CATCH-UP (more variance when far behind late). With
    deficit = -obs.bankroll,  H = hands_in_match - hand_index (incl. this one),
    sigma   = min(hand_std_bb * big_blind, hand_std_stack_cap * starting_stack)
when ``hand_index >= late_frac * hands_in_match`` and
``deficit > k * sqrt(H) * sigma`` (the deficit is unlikely to be recovered by
normal play), every call or raise the inner bot makes becomes an all-in if my
strength clears a loosened threshold: preflop percentile >= catchup_pre_pct
(percentile from bots.equity_heuristic's per-spec distribution), postflop
equity vs a random hand >= catchup_post_eq. Folds and checks are left alone.

``scoring="chips"`` is a pure pass-through: under chip-total scoring folding
out only gives chips away. The default is ``"win"`` (active), which is what
``registry.make("x+lp")`` builds.
"""
from __future__ import annotations

import math

from engine.bot import Bot
from engine.equity import get_equity_model
from engine.game import CALL, RAISE, Check, Fold, RaiseTo

from bots.equity_heuristic import (PARAMS as EQ_PARAMS, lowest_discard, n_samples, percentile,
                                   preflop_distribution, time_budget_ms)

PARAMS = dict(
    lock_margin_bb=0.5,       # extra cushion (in big blinds) on top of the worst-case blind bleed
    k=1.0,                    # catch-up when deficit > k * sqrt(hands_left) * sigma
    hand_std_bb=10.0,         # typical per-hand std of results, in big blinds ...
    hand_std_stack_cap=0.25,  # ... capped at this fraction of the starting stack (short stacks)
    late_frac=0.5,            # catch-up only in the second half of the match
    catchup_pre_pct=0.35,     # loosened preflop percentile for shoving in catch-up mode
    catchup_post_eq=0.50,     # loosened postflop equity for shoving in catch-up mode
    catchup_budget_ms=2.0,    # MC budget for the postflop strength check (preflop uses the
                              # equity bot's preflop budget since values are cached)
)


class LeadProtection(Bot):
    def __init__(self, inner: Bot, scoring: str = "win", params=None):
        if scoring not in ("win", "chips"):
            raise ValueError("scoring must be 'win' or 'chips'")
        self.inner = inner
        self.scoring = scoring
        self.params = dict(PARAMS, **(params or {}))
        self.name = f"{getattr(inner, 'name', 'bot')}+lp"
        self.last_mode = "pass"   # 'pass' | 'lock' | 'catchup' (for tests/diagnostics)

    # ---- lifecycle ----------------------------------------------------------------
    def new_match(self, spec, seed=0):
        super().new_match(spec, seed)
        self.inner.new_match(spec, seed)
        if self.scoring == "win":
            import numpy as np
            self.np_rng = np.random.default_rng(seed + 7)
            self.model = get_equity_model(spec)
            self.ms = self.model.ms_per_sample()
            preflop_distribution(spec)

    def end_hand(self, result):
        self.inner.end_hand(result)

    def end_match(self):
        self.inner.end_match()

    # ---- match-state tests -----------------------------------------------------------
    def max_future_loss(self, obs) -> int:
        """Most I can lose folding every hand after this one (blinds + antes)."""
        spec = self.spec
        rest = max(0, obs.hands_in_match - obs.hand_index - 1)
        other = (rest + 1) // 2   # hands 1, 3, 5... after this one: the other position
        same = rest // 2

        def cost(pos):
            return (spec.small_blind if pos == 0 else spec.big_blind) + spec.ante
        return other * cost(1 - obs.position) + same * cost(obs.position)

    def locked(self, obs) -> bool:
        lead_if_fold = obs.bankroll - obs.my_committed
        margin = self.params["lock_margin_bb"] * self.spec.big_blind
        return lead_if_fold - self.max_future_loss(obs) >= max(1e-9, margin)

    def catching_up(self, obs) -> bool:
        P = self.params
        if obs.hand_index < P["late_frac"] * obs.hands_in_match:
            return False
        hands_left = max(1, obs.hands_in_match - obs.hand_index)
        sigma = min(P["hand_std_bb"] * self.spec.big_blind,
                    P["hand_std_stack_cap"] * self.spec.starting_stack)
        return -obs.bankroll > P["k"] * math.sqrt(hands_left) * sigma

    # ---- acting --------------------------------------------------------------------------
    def act(self, obs):
        if self.scoring != "win":
            self.last_mode = "pass"
            return self.inner.act(obs)
        lg = obs.legal
        if self.locked(obs):
            self.last_mode = "lock"
            if lg.discard_count:
                return lowest_discard(obs)
            return Check() if lg.can_check else Fold()
        a = self.inner.act(obs)
        self.last_mode = "pass"
        if (obs.phase == "bet" and a.kind in (CALL, RAISE) and lg.can_raise
                and self.catching_up(obs)):
            self.last_mode = "catchup"
            if self._strong_enough(obs):
                return RaiseTo(lg.max_raise_to)
        return a

    def _strong_enough(self, obs) -> bool:
        P = self.params
        if obs.street == 0:
            # preflop values are cached per suit class and shared, so use the full
            # preflop budget rather than storing a low-precision value
            budget = time_budget_ms(self.spec, obs, EQ_PARAMS["preflop_budget_ms"], EQ_PARAMS)
            n = n_samples(budget, self.ms, EQ_PARAMS["n_pre_max"], EQ_PARAMS)
            if not n:
                return False
            e = self.model.preflop_equity(obs.my_cards, n=n)
            return percentile(self.spec, e) >= P["catchup_pre_pct"]
        budget = time_budget_ms(self.spec, obs, P["catchup_budget_ms"], EQ_PARAMS)
        n = n_samples(budget, self.ms, EQ_PARAMS["n_max"], EQ_PARAMS)
        if not n:
            return False
        return self.model.equity_obs(obs, n=n, rng=self.np_rng) >= P["catchup_post_eq"]


def make_bot(inner=None, **kw):
    if inner is None:
        from bots.registry import make
        inner = make("equity")
    return LeadProtection(inner, **kw)
