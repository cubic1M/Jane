"""Adaptive bot (registry name "adaptive"): approach #3, Loki/Poki-style opponent modelling.

The balanced heuristic (bots/balanced.py) plus per-match opponent statistics that
move its ADJUSTABLE knobs, bounded and gradually, once enough has been seen.

Information used (no cheating)
------------------------------
Only HandResult.history (the action sequence both players saw) and
HandResult.opp_cards, which the engine fills only at showdown; the opponent's cards
are read only when `result.showdown` is True. Nothing is read in act() except the
Observation. All statistics are updated in end_hand() in O(actions) (plus one
fixed-size batched evaluation at a showdown) and the knobs are recomputed there, so
act() costs exactly what BalancedBot.act() costs.

Statistics (opponent only, reset in new_match)
----------------------------------------------
Every statistic is a `Rate`: exponentially decayed counts (k, n) (decay
ADAPT_PARAMS["decay"] per observation, so a style change is followed with a memory
of ~1/(1-decay) observations), read as a Beta posterior mean that is shrunk towards
the population prior with `prior_n` pseudo-observations.
  preflop  vpip        voluntarily put chips in (call or raise; a BB check is not)
           pfr         raised preflop (any time)
           pre_open    raised as SB on the first action (first-in raise / steal)
           pre_reraise raised when facing our preflop raise (3-bet, 4-bet ...)
           pre_fold    folded when facing our preflop raise
  postflop fold_bet    folded facing our bet/raise, overall, and by our size:
           fold_small  (< 0.75 pot) and fold_big (>= 0.75 pot)
           agg         (bets + raises) / (bets + raises + calls)
           stab        bet when it could check
           raise_bet   raised when facing our bet
           check_raise raised after checking earlier on the same street
  showdown (opp_cards revealed): hs = share of random hands the opponent's final
           hand beats on the final board (MC, own RNG), and the preflop percentile
           of its original hand (BalancedBot's preflop model), by the line taken:
           sd_bluff    hs < bluff_hs after betting/raising the last street
           sd_agg_hs   mean hs after betting/raising the last street (value-heaviness)
           sd_call_hs  mean hs after calling a bet on the last street (calling light)
           sd_pre_pct  mean preflop percentile of hands it raised preflop with

From statistics to knobs
------------------------
Each statistic becomes a signed score s in [-1, 1]: 0 at the population prior
(STATS: what BalancedBot itself does, measured in self-play), -1/+1 at an archetype
extreme, a dead zone (`deadzone`) cut out around 0, then multiplied by the
confidence conf = clip((n - min_sample) / ramp, 0, 1). So nothing moves before
`min_sample` relevant observations and the move then grows gradually.
Scores are averaged into exploit dimensions:
  F   postflop over-folding (+) / never folds (-)        fold_bet
  FS, FB  same for small and big bets                     fold_small, fold_big
  PF  preflop over-folding to raises                      pre_fold
  A   postflop aggression (+ maniac, - passive)           agg, stab, raise_bet
  PA  preflop aggression                                  pre_open, pre_reraise, pfr, weak sd_pre_pct
  B   bluffs more at showdown (+) / value-heavy (-)       sd_bluff, weak sd_agg_hs
  L   calls light at showdown                             weak sd_call_hs
  CR  check-raises more than the population              check_raise
For every knob (KNOB_MAP), t = clip(sum(weight * dimension), -1, 1); t > 0 moves the
knob from its default towards the ADJUSTABLE upper bound by t * reach_pos of the way,
t < 0 towards the lower bound by |t| * reach_neg. Knobs therefore never leave their
ADJUSTABLE bounds. Two knobs that are not in ADJUSTABLE are moved the same way within
EXTRA_ADJUSTABLE (slowplay_freq for trapping, value-bet frequency/size mix).
Range-reading floors (the Poki idea: an action's range is at least as wide as the
observed frequency of that action):
  * post_bet_keep  >= conf * P(opp bets when it can check)   (within its bounds)
  * post_raise_keep>= conf * P(opp raises facing a bet)
  * preflop: f_pre >= conf * product over the opponent's preflop raises of the
    observed frequency of that raise (first-in: pre_open, facing a raise:
    pre_reraise). This is applied in opponent_range() and is what lets the bot call
    an always-all-in opponent with the right (random-hand) range: pre_range_k alone
    is bounded at 4.0, i.e. a top-25% shoving range.

Intended exploits
-----------------
* calling station (never folds, never raises, calls light):
  F, PF, A, L -> bluff/cbet/semibluff/bluff-raise frequencies drop towards 0;
  value_bet_eq lower (thinner), value_bet_freq up, bet sizes and big-size share up;
  no slowplaying (A < 0); shove range tighter (no fold equity).
* maniac / pusher (raises most of the time, never folds, bluffs at showdown):
  A, PA, B high -> its bets and raises mean less (post_bet_keep, post_raise_keep,
  post_mix, pre_range_k, pre_polar up, range floors), call/defend wider
  (call_margin, pre_call_margins down, mdf_scale up), bluff less (F < 0), trap
  (slowplay_freq up), open less as SB vs a re-raiser (we only want hands that call a
  shove).
* nit (folds a lot, rarely bets):
  F, PF high -> steal and bluff more (open_frac, iso_frac, shove_k, bluff
  frequencies up), A < 0 -> its bets mean more (keeps down) and we fold more to them
  (call margins up, by half the range).
* balanced / equity-heuristic: statistics near the priors and inside the dead
  zone -> the knobs stay at (or very near) the defaults.
"""
from __future__ import annotations

import math

import numpy as np

from bots.balanced import ADJUSTABLE, DEFAULT_PARAMS, BalancedBot, _draw_rows

# --------------------------------------------------------------------------------------
# Adaptation parameters
# --------------------------------------------------------------------------------------
ADAPT_PARAMS = {
    "min_sample": 30,          # relevant observations before a statistic moves anything
    "min_sample_showdown": 20, # same for showdown statistics (they are rarer)
    "ramp": 70,                # observations from min_sample to full confidence
    "prior_n": 10.0,           # Beta pseudo-observations at the population prior
    "prior_n_showdown": 6.0,
    "decay": 0.997,            # per-observation decay of counts (memory ~333 observations)
    "deadzone": 0.15,          # |score| below this is ignored (noise vs a balanced opponent)
    "bluff_hs": 0.45,          # showdown hand beating < 45% of random hands = a bluff
    "hs_samples": 128,         # random hands used to score a revealed hand
    "big_bet_frac": 0.75,      # our bet >= this pot fraction counts as big
    "floor_max": 1.0,          # cap on the range floors
}

# stat -> (population prior, low extreme, high extreme). The prior is what
# BalancedBot does in self-play (variants a and c, see the tests); the extremes are
# where an archetype sits (score -1 / +1).
STATS = {
    "vpip": (0.70, 0.20, 1.00),
    "pfr": (0.45, 0.05, 0.95),
    "pre_open": (0.80, 0.20, 1.00),
    "pre_reraise": (0.20, 0.00, 0.90),
    "pre_fold": (0.40, 0.00, 0.85),
    "fold_bet": (0.40, 0.00, 0.80),
    "fold_small": (0.35, 0.00, 0.80),
    "fold_big": (0.45, 0.00, 0.85),
    "agg": (0.55, 0.10, 0.95),
    "stab": (0.30, 0.00, 0.80),
    "raise_bet": (0.10, 0.00, 0.60),
    "check_raise": (0.08, 0.00, 0.40),
    "sd_bluff": (0.10, 0.00, 0.50),
    "sd_agg_hs": (0.80, 0.95, 0.50),   # value-heaviness: low hs = weak (score +1 at 0.5)
    "sd_call_hs": (0.75, 0.90, 0.50),
    "sd_pre_pct": (0.62, 0.80, 0.50),
}
SHOWDOWN_STATS = ("sd_bluff", "sd_agg_hs", "sd_call_hs", "sd_pre_pct")

# exploit dimension -> [(stat, weight)]; the dimension is the weighted mean of scores
DIMENSIONS = {
    "F": [("fold_bet", 1.0)],
    "FS": [("fold_small", 1.0)],
    "FB": [("fold_big", 1.0)],
    "PF": [("pre_fold", 1.0)],
    "A": [("agg", 1.0), ("stab", 1.0), ("raise_bet", 1.0)],
    "PA": [("pre_open", 1.0), ("pre_reraise", 1.0), ("pfr", 0.5), ("sd_pre_pct", 0.5)],
    "B": [("sd_bluff", 1.0), ("sd_agg_hs", 0.5)],
    "L": [("sd_call_hs", 1.0)],
    "CR": [("check_raise", 1.0)],
}

# knobs that BalancedBot reads but ADJUSTABLE does not list, with our own bounds
EXTRA_ADJUSTABLE = {
    "slowplay_freq": (0.0, 0.50),      # trap aggressive opponents
    "value_bet_freq": (0.60, 1.00),    # bet medium value more often vs stations
    "big_freq_value": (0.10, 0.75),    # use the big size more often for value
}

# knob -> ([(dimension, weight)], reach_neg, reach_pos)
KNOB_MAP = {
    # bluffing: only where the opponent folds; less vs light callers
    "bluff_freq": ([("F", 1.0), ("L", -0.5)], 1.0, 0.8),
    "bluff_freq_river": ([("F", 1.0), ("L", -0.5), ("B", 0.2)], 1.0, 0.8),
    "cbet_freq": ([("F", 1.0), ("L", -0.5)], 1.0, 0.8),
    "semibluff_freq": ([("F", 0.6), ("L", -0.3)], 0.6, 0.6),
    "bluff_raise_freq": ([("F", 0.8), ("A", -0.3), ("L", -0.4)], 1.0, 0.6),
    "pre_bluff_raise_freq": ([("PF", 1.0), ("PA", -0.5)], 1.0, 0.6),
    # defence: wider vs aggression and showdown bluffs, tighter vs passive/value-heavy
    "mdf_scale": ([("PA", 1.0), ("A", 0.3)], 0.4, 1.0),
    "call_margin": ([("A", -0.8), ("B", -0.8), ("CR", 0.2)], 1.0, 0.5),
    "pre_call_margin_oop": ([("PA", -1.0), ("B", -0.3)], 1.0, 0.5),
    "pre_call_margin_ip": ([("PA", -1.0), ("B", -0.3)], 1.0, 0.5),
    # value: thinner vs light callers and non-folders, stricter vs check-raisers
    "value_bet_eq": ([("L", -0.8), ("F", -0.5), ("CR", 0.4)], 0.8, 0.6),
    "raise_eq": ([("A", -0.4), ("L", -0.3)], 0.6, 0.5),
    "pre_raise_eq": ([("PA", -0.5)], 0.6, 0.5),
    # preflop ranges: steal vs folders; vs a re-raiser open only hands that call a shove
    "open_frac": ([("PF", 1.0), ("PA", -0.6)], 0.5, 1.0),
    "iso_frac": ([("PF", 1.0), ("PA", -0.4)], 0.6, 0.8),
    "shove_k": ([("PF", 1.0)], 0.6, 0.8),
    # reading the opponent's range
    "pre_range_k": ([("PA", 1.0), ("B", 0.3)], 0.5, 1.0),
    "pre_polar": ([("PA", 0.6), ("B", 0.4)], 0.6, 1.0),
    "post_bet_keep": ([("A", 1.0), ("B", 0.6)], 0.8, 1.0),
    "post_raise_keep": ([("A", 1.0), ("B", 0.6)], 0.8, 1.0),
    "post_mix": ([("A", 0.6), ("B", 0.6)], 0.6, 1.0),
    # sizes: bigger vs light callers / players who do not fold to big bets
    "bet_small": ([("L", 0.5), ("FS", -0.5)], 0.5, 0.6),
    "bet_big": ([("L", 0.5), ("FB", -0.5)], 0.4, 0.5),
    "raise_size": ([("L", 0.4), ("A", -0.2)], 0.5, 0.5),
    # extras (EXTRA_ADJUSTABLE)
    "slowplay_freq": ([("A", 1.0), ("L", -0.5)], 1.0, 0.8),
    "value_bet_freq": ([("L", 0.6), ("F", -0.6)], 0.5, 1.0),
    "big_freq_value": ([("L", 0.6), ("FB", -0.5)], 0.6, 0.8),
}


def knob_bounds(name: str) -> tuple:
    return ADJUSTABLE[name] if name in ADJUSTABLE else EXTRA_ADJUSTABLE[name]


class Rate:
    """Exponentially decayed Beta counter: k successes (or a summed value in [0,1])
    out of n observations."""
    __slots__ = ("k", "n")

    def __init__(self):
        self.k = 0.0
        self.n = 0.0

    def add(self, x: float, decay: float) -> None:
        self.k = self.k * decay + float(x)
        self.n = self.n * decay + 1.0

    def mean(self, prior: float, prior_n: float) -> float:
        return (self.k + prior * prior_n) / (self.n + prior_n)


class OpponentStats:
    """Per-match opponent statistics, updated from HandResults only."""

    def __init__(self, ap: dict):
        self.ap = ap
        self.rates = {name: Rate() for name in STATS}
        self.hands = 0
        self.showdowns = 0

    def add(self, name: str, x: float) -> None:
        self.rates[name].add(x, self.ap["decay"])

    def n(self, name: str) -> float:
        return self.rates[name].n

    def rate(self, name: str) -> float:
        """Posterior mean, shrunk to the population prior."""
        prior = STATS[name][0]
        pn = self.ap["prior_n_showdown"] if name in SHOWDOWN_STATS else self.ap["prior_n"]
        return self.rates[name].mean(prior, pn)

    def conf(self, name: str) -> float:
        m = self.ap["min_sample_showdown"] if name in SHOWDOWN_STATS else self.ap["min_sample"]
        n = self.rates[name].n
        if n < m:
            return 0.0
        return min(1.0, (n - m) / max(1e-9, self.ap["ramp"]))

    def score(self, name: str) -> float:
        """Signed deviation from the population prior in [-1, 1] (+1 at the 'high'
        extreme), with the dead zone removed, times the confidence."""
        c = self.conf(name)
        if c <= 0.0:
            return 0.0
        prior, lo, hi = STATS[name]
        r = self.rate(name)
        # orientation: hi may be below the prior (weakness stats)
        if (r - prior) * (hi - prior) >= 0:
            s = (r - prior) / (hi - prior) if hi != prior else 0.0
        else:
            s = -(r - prior) / (lo - prior) if lo != prior else 0.0
        s = max(-1.0, min(1.0, s))
        dz = self.ap["deadzone"]
        s = math.copysign(max(0.0, abs(s) - dz) / (1.0 - dz), s)
        return c * s

    def dimensions(self) -> dict:
        out = {}
        for dim, parts in DIMENSIONS.items():
            tot = sum(w for _, w in parts)
            out[dim] = sum(w * self.score(s) for s, w in parts) / tot
        return out

    def summary(self) -> dict:
        return {k: (round(self.rate(k), 3), round(self.n(k), 1)) for k in STATS}


# --------------------------------------------------------------------------------------
# The bot
# --------------------------------------------------------------------------------------
class AdaptiveBot(BalancedBot):
    name = "adaptive"

    def __init__(self, params: dict | None = None, adapt: dict | None = None):
        super().__init__(params)
        adapt = dict(adapt or {})
        unknown = set(adapt) - set(ADAPT_PARAMS)
        if unknown:
            raise KeyError(f"unknown adapt params: {sorted(unknown)}")
        self.ap = {**ADAPT_PARAMS, **adapt}
        self.base_params = dict(self.params)
        self._reset_model()

    def _reset_model(self) -> None:
        self.params = dict(self.base_params)
        self.stats = OpponentStats(self.ap)
        self.dims = {d: 0.0 for d in DIMENSIONS}
        self.floors = {"pre_open": 0.0, "pre_reraise": 0.0}

    # ---- lifecycle -------------------------------------------------------------------
    def new_match(self, spec, seed=0):
        super().new_match(spec, seed)
        self._reset_model()                     # no memory across matches
        self._stat_rng = np.random.default_rng([int(seed) & 0xFFFFFFFF, 4242])

    def end_hand(self, result):
        super().end_hand(result)
        try:
            self.observe_hand(result)
            self.update_params()
        except Exception:   # a statistics bug must never break play
            import traceback
            self.errors += 1
            self.last_error = traceback.format_exc()

    # ---- statistics -----------------------------------------------------------------
    def observe_hand(self, res) -> None:
        """Update the opponent statistics from one finished hand (O(actions))."""
        spec = self.spec
        st = self.stats
        st.hands += 1
        me = res.position
        opp = 1 - me
        sb, bb, ante = spec.small_blind, spec.big_blind, spec.ante
        committed = [ante + sb, ante + bb]
        pips = [sb, bb]
        street = 0
        last = spec.num_streets - 1
        opp_acted_pre = vpip = pfr = False
        opp_checked = False         # opponent checked earlier on this street
        my_frac = 0.0               # size of our last bet/raise (pot fraction)
        last_raiser = None
        opp_raised_pre = opp_raised_last = opp_called_last = False
        for rec in res.history:
            if rec.street != street:
                street, pips, opp_checked, last_raiser = rec.street, [0, 0], False, None
            kind, p = rec.kind, rec.position
            if kind == "discard":
                continue
            to_call = max(pips) - pips[p]
            if p == opp and kind in ("fold", "check", "call", "raise"):
                if street == 0:
                    if not opp_acted_pre and opp == 0 and max(pips) <= bb:
                        st.add("pre_open", kind == "raise")
                    opp_acted_pre = True
                    if to_call > 0 and max(pips) > bb and last_raiser == me:
                        st.add("pre_fold", kind == "fold")
                        st.add("pre_reraise", kind == "raise")
                    if kind in ("call", "raise"):
                        vpip = True
                    if kind == "raise":
                        pfr = opp_raised_pre = True
                else:
                    if to_call == 0:
                        if kind in ("check", "raise"):
                            st.add("stab", kind == "raise")
                    elif last_raiser == me:
                        st.add("fold_bet", kind == "fold")
                        big = my_frac >= self.ap["big_bet_frac"]
                        st.add("fold_big" if big else "fold_small", kind == "fold")
                        st.add("raise_bet", kind == "raise")
                        if opp_checked:
                            st.add("check_raise", kind == "raise")
                    if kind == "raise":
                        st.add("agg", 1.0)
                    elif kind == "call":
                        st.add("agg", 0.0)
                    if kind == "check":
                        opp_checked = True
                    if street == last:
                        opp_raised_last |= kind == "raise"
                        opp_called_last |= kind == "call" and rec.amount > 0
            # chips (same bookkeeping as balanced.replay)
            if kind == "raise":
                prev_max = max(pips)
                if p == me:
                    my_frac = (rec.amount - prev_max) / max(1, sum(committed) + to_call)
                committed[p] += rec.amount - pips[p]
                pips[p] = rec.amount
                last_raiser = p
            elif kind == "call":
                committed[p] += rec.amount
                pips[p] += rec.amount
        if opp_acted_pre:
            st.add("vpip", vpip)
            st.add("pfr", pfr)
        # showdown: the opponent's cards exist only here
        if res.showdown and res.opp_cards:
            st.showdowns += 1
            self._observe_showdown(res, opp, opp_raised_pre, opp_raised_last, opp_called_last)

    def _observe_showdown(self, res, opp, raised_pre, raised_last, called_last) -> None:
        st = self.stats
        opp_cards = tuple(int(c) for c in res.opp_cards)
        board = tuple(int(c) for c in res.board)
        if raised_last or called_last:
            hs = self.showdown_strength(opp_cards, board, tuple(res.my_cards))
            if raised_last:
                st.add("sd_bluff", hs < self.ap["bluff_hs"])
                st.add("sd_agg_hs", hs)
            elif called_last:
                st.add("sd_call_hs", hs)
        if raised_pre:
            # original hand = final hole cards + the opponent's discards (revealed at showdown)
            disc = [c for r in res.history if r.position == opp and r.kind == "discard" for c in r.cards]
            orig = opp_cards + tuple(int(c) for c in disc)
            if len(orig) == self.spec.hole_cards and len(set(orig)) == len(orig):
                eq = float(self.profile.predict(np.array([orig], dtype=np.int64))[0])
                st.add("sd_pre_pct", self.profile.percentile(eq))

    def showdown_strength(self, opp_cards, board, my_cards) -> float:
        """Share of random hands (of the opponent's final size) that the revealed hand
        beats on the final board."""
        dead = set(opp_cards) | set(board) | set(my_cards)
        avail = np.array([c for c in self.spec.deck if c not in dead], dtype=np.int64)
        k = len(opp_cards)
        if len(avail) < k or not self._can_eval(k, len(board)):
            return 0.5
        m = int(self.ap["hs_samples"])
        rows = _draw_rows(m, avail, k, self._stat_rng)
        bd = np.broadcast_to(np.array(board, dtype=np.int64), (m, len(board)))
        sc = self.ev.evaluate_batch(rows, bd)
        mine = self.ev.evaluate(opp_cards, board)
        return float(np.mean((mine > sc) + 0.5 * (mine == sc)))

    # ---- statistics -> knobs ---------------------------------------------------------
    def update_params(self) -> None:
        st = self.stats
        dims = st.dimensions()
        self.dims = dims
        params = dict(self.base_params)
        for knob, (parts, reach_neg, reach_pos) in KNOB_MAP.items():
            t = sum(w * dims[d] for d, w in parts)
            t = max(-1.0, min(1.0, t))
            lo, hi = knob_bounds(knob)
            d0 = self.base_params[knob]
            if t >= 0:
                v = d0 + t * reach_pos * (hi - d0)
            else:
                v = d0 + t * reach_neg * (d0 - lo)
            params[knob] = min(hi, max(lo, v))
        # range floors (Poki): an action's range is at least as wide as its frequency
        fmax = self.ap["floor_max"]
        for knob, stat in (("post_bet_keep", "stab"), ("post_raise_keep", "raise_bet")):
            lo, hi = ADJUSTABLE[knob]
            floor = min(fmax, st.conf(stat) * st.rate(stat))
            params[knob] = min(hi, max(params[knob], floor))
        self.floors = {s: min(fmax, st.conf(s) * st.rate(s)) for s in ("pre_open", "pre_reraise")}
        self.params = params

    def opponent_range(self, obs):
        f_pre, keep, mix = super().opponent_range(obs)
        if obs.street >= 0 and (self.floors["pre_open"] > 0 or self.floors["pre_reraise"] > 0):
            opp = 1 - obs.position
            bb = self.spec.big_blind
            pips = [self.spec.small_blind, bb]
            floor, raised = 1.0, False
            for rec in obs.history:
                if rec.street != 0:
                    break
                if rec.kind == "raise":
                    if rec.position == opp:
                        floor *= self.floors["pre_open" if max(pips) <= bb else "pre_reraise"]
                        raised = True
                    pips[rec.position] = rec.amount
                elif rec.kind == "call":
                    pips[rec.position] += rec.amount
            if raised and floor > f_pre:
                f_pre = min(1.0, floor)
        return f_pre, keep, mix


def make_bot(**kwargs):
    return AdaptiveBot(**kwargs)
