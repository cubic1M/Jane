"""Naive equity baseline (registry name "equity").

Monte Carlo equity + pot odds + FIXED thresholds. No randomisation, no mixing,
no opponent modelling, no adaptation. It is meant to be an honest baseline:
it value-bets, calls when the price is right and folds when it is not.

Strength
--------
* Preflop: ``e = EquityModel.preflop_equity(cards)`` (vs a uniformly random hand,
  cached by suit class). Raw preflop equities are not comparable across variants
  (Omaha squeezes them into ~0.40-0.60, 3-card variants are inflated), so the
  RAISE decisions use the percentile ``pct`` of ``e`` within this spec's
  distribution of preflop equities. That distribution is sampled once per spec
  per process (``preflop_distribution``, called from ``new_match``): ``dist_hands``
  random hands with ``m`` MC samples each, ``m`` sized from
  ``EquityModel.ms_per_sample()`` to a ~``dist_budget_ms`` total. MC noise widens
  the sampled distribution, so the samples are shrunk toward their mean by
  ``sqrt(1 - noise_var / sample_var)`` (noise_var = mean(x(1-x))/m).
  CALL decisions compare the raw equity with the pot odds (pot odds are in
  equity units, so no normalisation is wanted there).
* Postflop: ``e = equity_obs(obs, n)`` vs a random opponent hand, honouring
  future board cards and discards.

Bet-phase rules (all thresholds in PARAMS)
------------------------------------------
Let ``odds = call / (pot + call)`` and
``need = odds + call_margin + call_margin_stack * call / my_chips_this_hand``.

Preflop, nobody has raised beyond the big blind (SB first in, or BB after a limp):
    pct >= pre_open_pot   -> raise pot
    pct >= pre_open_half  -> raise half pot
    else                  -> check if free, call if e >= need, else fold
Preflop, facing a raise:
    pct >= pre_reraise    -> raise pot
    e >= need             -> call, else fold
Postflop, checked to / first to act:
    e >= post_bet_pot     -> bet pot
    e >= post_bet_half    -> bet half pot
    else                  -> check
Postflop, facing a bet:
    e >= post_raise       -> raise pot
    e >= need             -> call, else fold
Raise sizes are "call then add frac * (pot after the call)", clamped to the legal
range; if a raise would put more than ``commit_frac`` of the remaining stack in,
the bot shoves instead.

Discard phase: the best option from ``EquityModel.discard_options``.

Time: n = (budget - overhead) / ms_per_sample, capped. The budget is
``budget_ms`` (``preflop_budget_ms`` preflop, where a value is computed once per
suit class and then cached), shrunk to ``decision_share * time_per_decision`` and
to ``clock_share * time_left / (hands_left * decisions_per_hand)``. If fewer than
``n_floor`` samples fit, the bot plays a no-MC fallback (check, else fold;
discard the lowest ranks).

Determinism: given (spec, seed) and this process's timing calibration
(ms_per_sample), decisions are deterministic; all MC draws come from a numpy
Generator seeded in new_match.
"""
from __future__ import annotations

import numpy as np

from engine.bot import Bot
from engine.equity import get_equity_model
from engine.game import Call, Check, Discard, Fold, RaiseTo

PARAMS = dict(
    # preflop raise thresholds, in percentile of this spec's preflop-equity distribution
    pre_open_pot=0.85,
    pre_open_half=0.55,
    pre_reraise=0.92,
    # postflop thresholds, in equity vs a random hand
    post_bet_pot=0.80,
    post_bet_half=0.65,
    post_raise=0.86,
    # call if equity >= pot odds + call_margin + call_margin_stack * (call / my chips this hand)
    call_margin=0.02,
    call_margin_stack=0.10,
    commit_frac=0.5,
    # time budget (ms) and sample caps
    budget_ms=4.0,
    preflop_budget_ms=12.0,
    overhead_ms=0.2,
    n_max=1000,
    n_pre_max=1500,
    n_floor=20,
    decision_share=0.25,
    clock_share=0.5,
    decisions_per_hand=4.0,
    # preflop distribution (once per spec per process)
    dist_hands=150,
    dist_budget_ms=400.0,
    dist_n_min=60,
    dist_n_max=400,
    dist_seed=20261028,
)

_DIST: dict = {}


def _future_to_board(spec, street: int = 0) -> bool:
    for d in spec.discards:
        if d.street >= street:
            return d.to_board
    return True


def preflop_distribution(spec, params=PARAMS) -> np.ndarray:
    """Sorted, noise-corrected sample of preflop equities of random hands for spec.
    Cached at module level keyed by spec."""
    d = _DIST.get(spec)
    if d is not None:
        return d
    m = get_equity_model(spec)
    ms = m.ms_per_sample()
    k = int(params["dist_hands"])
    n = int(params["dist_budget_ms"] / max(1e-6, k * ms))
    n = int(np.clip(n // 20 * 20, params["dist_n_min"], params["dist_n_max"]))
    rng = np.random.default_rng(params["dist_seed"])
    deck = np.array(spec.deck, dtype=np.int64)
    nd = sum(x.count for x in spec.discards)
    xs = np.empty(k)
    for i in range(k):
        cards = tuple(int(c) for c in rng.choice(deck, spec.hole_cards, replace=False))
        xs[i] = m.equity(cards, (), opp_num_cards=spec.hole_cards,
                         board_to_come=spec.total_board_dealt, my_discards_left=nd,
                         opp_discards_left=nd, discard_to_board=_future_to_board(spec),
                         n=n, rng=rng)
    mu, var = xs.mean(), xs.var()
    noise = float(np.mean(xs * (1 - xs))) / n
    shrink = np.sqrt(max(0.05, 1.0 - noise / var)) if var > 0 else 1.0
    d = np.sort(mu + (xs - mu) * shrink)
    _DIST[spec] = d
    return d


def percentile(spec, equity: float) -> float:
    d = preflop_distribution(spec)
    k = len(d)
    return float(np.interp(equity, d, (np.arange(k) + 0.5) / k, left=0.0, right=1.0))


def time_budget_ms(spec, obs, base: float, params=PARAMS) -> float:
    """base, shrunk by the per-decision limit and the match clock."""
    b = base
    if spec.time_per_decision:
        b = min(b, 1000.0 * spec.time_per_decision * params["decision_share"])
    if obs.time_left is not None:
        hands_left = max(1, obs.hands_in_match - obs.hand_index)
        b = min(b, 1000.0 * max(0.0, obs.time_left) * params["clock_share"]
                / (hands_left * params["decisions_per_hand"]))
    return b


def n_samples(budget_ms: float, ms_per_sample: float, cap: int, params=PARAMS) -> int:
    """MC samples that fit in the budget; 0 means 'too little time, use the fallback'."""
    n = int((budget_ms - params["overhead_ms"]) / max(1e-6, ms_per_sample))
    n = min(cap, n)
    return n if n >= params["n_floor"] else 0


def lowest_discard(obs):
    """Legal cheap discard: the lowest-ranked card(s)."""
    k = obs.legal.discard_count
    return Discard(sorted(obs.my_cards, key=lambda c: (c >> 2, c & 3))[:k])


def raise_action(obs, frac: float, commit_frac: float):
    """Call, then raise frac * (pot after the call); shove if that commits most of the stack."""
    lg = obs.legal
    call = lg.call_amount
    amt = lg.clamp_raise(obs.my_pip + call + frac * (obs.pot + call))
    if amt - obs.my_pip >= commit_frac * obs.my_stack:
        amt = lg.max_raise_to
    return RaiseTo(amt)


class EquityHeuristicBot(Bot):
    name = "equity"

    def __init__(self, params=None):
        self.params = dict(PARAMS, **(params or {}))

    def new_match(self, spec, seed=0):
        super().new_match(spec, seed)
        self.np_rng = np.random.default_rng(seed)
        self.model = get_equity_model(spec)
        self.ms = self.model.ms_per_sample()
        preflop_distribution(spec)

    # ---- strength ---------------------------------------------------------------
    def _budget(self, obs, base):
        return time_budget_ms(self.spec, obs, base, self.params)

    def preflop_strength(self, obs):
        """(equity, percentile) or None if there is no time."""
        n = n_samples(self._budget(obs, self.params["preflop_budget_ms"]), self.ms,
                      self.params["n_pre_max"], self.params)
        if not n:
            return None
        e = self.model.preflop_equity(obs.my_cards, n=n)
        return e, percentile(self.spec, e)

    def postflop_equity(self, obs):
        n = n_samples(self._budget(obs, self.params["budget_ms"]), self.ms,
                      self.params["n_max"], self.params)
        if not n:
            return None
        return self.model.equity_obs(obs, n=n, rng=self.np_rng)

    # ---- decisions ---------------------------------------------------------------
    def act(self, obs):
        lg = obs.legal
        if lg.discard_count:
            return self._discard(obs)
        P = self.params
        if obs.street == 0:
            s = self.preflop_strength(obs)
            if s is None:
                return Check() if lg.can_check else Fold()
            e, pct = s
            unopened = obs.opp_pip <= obs.big_blind
            if unopened:
                tiers = ((P["pre_open_pot"], 1.0), (P["pre_open_half"], 0.5))
            else:
                tiers = ((P["pre_reraise"], 1.0),)
            for thr, frac in tiers:
                if pct >= thr and lg.can_raise:
                    return raise_action(obs, frac, P["commit_frac"])
            return self._passive(obs, e)
        e = self.postflop_equity(obs)
        if e is None:
            return Check() if lg.can_check else Fold()
        if lg.can_check:
            tiers = ((P["post_bet_pot"], 1.0), (P["post_bet_half"], 0.5))
        else:
            tiers = ((P["post_raise"], 1.0),)
        for thr, frac in tiers:
            if e >= thr and lg.can_raise:
                return raise_action(obs, frac, P["commit_frac"])
        return self._passive(obs, e)

    def _passive(self, obs, e):
        lg = obs.legal
        if lg.can_check:
            return Check()
        call = lg.call_amount
        P = self.params
        chips = max(1, obs.my_stack + obs.my_committed)
        need = call / (obs.pot + call) + P["call_margin"] + P["call_margin_stack"] * call / chips
        return Call() if e >= need else Fold()

    def _discard(self, obs):
        k = obs.legal.discard_count
        n_opts = 1
        h = len(obs.my_cards)
        for i in range(k):  # C(h, k)
            n_opts = n_opts * (h - i) // (i + 1)
        n = n_samples(self._budget(obs, self.params["budget_ms"]) / n_opts, self.ms,
                      self.params["n_max"], self.params)
        if not n:
            return lowest_discard(obs)
        opts = self.model.discard_options(obs, n=n, rng=self.np_rng)
        return Discard(opts[0][0])


def make_bot(**kw):
    return EquityHeuristicBot(params=kw.get("params"))
