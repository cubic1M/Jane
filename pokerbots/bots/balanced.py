"""Balanced heuristic bot (registry name "balanced").

An equity-driven, spec-generic heuristic with mixed (randomised) actions,
semi-bluffs, a small set of bet sizes, and an opponent range that narrows as the
opponent bets and raises. Every rule comes from the GameSpec given to
new_match(); nothing is hard-coded per variant.

API CONTRACT (stable; subclasses rely on it)
--------------------------------------------
    DEFAULT_PARAMS: dict      every threshold, frequency and size (see the comments there)
    ADJUSTABLE: dict          param -> (min, max): knobs an opponent-modelling subclass may move
    class BalancedBot(Bot):
        name = "balanced"
        __init__(params=None)            overrides DEFAULT_PARAMS keys (unknown keys raise)
        new_match(spec, seed=0)          seeds self.rng / self.np_rng, builds the per-spec profile
        act(obs) -> Action               dispatches below; always returns a legal action
        preflop_action(obs) -> Action    street 0 betting
        postflop_action(obs) -> Action   street >= 1 betting; works for any preflop line
        discard_action(obs) -> Action    discard phases
        strength(obs) -> float           equity vs the opponent's action-implied range
        analyse(obs) -> dict             everything behind strength(), cached per decision:
                                         equity, made (current made-hand share vs the range),
                                         draw, percentile (preflop), f_pre, post_keep, n
    self.params is read at every decision, so a subclass may change it between hands.
    A subclass that overrides strength() changes the equity every decision uses.

Design
------
Preflop strength is normalised per spec. On first use of a spec (cached at module
level) we sample ~500 random hands, estimate each one's equity vs a random hand
with a small Monte Carlo budget, and fit a least-squares model on cheap card
features (sorted ranks, pairs, suitedness, connectedness). The model is near the
noise ceiling (holdout correlation ~0.99 for hold'em, ~0.92 for Omaha) and gives:
  * my percentile: my MC preflop equity, shrunk towards the model's prediction
    by inverse variance, mapped onto the de-noised equity distribution of the spec;
  * a vectorised scorer for opponent ranges ("top f% of hands").
Opening, isolation and short-stack shoving use percentile ranges; facing a raise
we compute equity against the raise-implied range and compare it with pot odds.

Opponent range (why a sampler, not discount factors): a fixed discount ignores
the board, so a flush-completing river bet would be discounted like a dry-board
bet. Instead an `opp_sampler` draws candidate opponent hands from the live cards
and keeps (1) the top f_pre of them by the preflop model when the opponent raised
preflop and (2) the top `post_keep` of those by made-hand strength on the current
board, where every postflop bet/raise multiplies post_keep by a size-dependent
factor. A `post_mix` share of rows is drawn from the wider preflop range so
bluffs and draws stay represented. The same rows give "made" (my share of the
range I beat right now); draw = equity - made measures drawing potential and
drives semi-bluffs. Cost: one equity call plus one batched evaluation.

Decisions use soft gates: P(act) = logistic((x - threshold) / temperature), so
hands near a threshold mix between actions, plus explicit bluff/semi-bluff/
slowplay frequencies. Bet sizes are `bet_small`/`bet_big` pot fractions, a
pot-fraction raise, and all-in when the bet would commit `commit_frac` of the
stack or the stack-to-pot ratio is below `commit_spr`. Monte Carlo sample counts
come from EquityModel.ms_per_sample() and a per-decision time budget that shrinks
with spec.time_per_decision and obs.time_left.
"""
from __future__ import annotations

import math
import traceback
from itertools import combinations

import numpy as np

from engine.bot import Bot
from engine.equity import canonical, get_equity_model
from engine.evaluator import get_evaluator
from engine.game import Call, Check, Discard, Fold, RaiseTo

# --------------------------------------------------------------------------------------
# Parameters
# --------------------------------------------------------------------------------------
DEFAULT_PARAMS = {
    # ---- compute budget -----------------------------------------------------------
    "budget_ms": 4.0,            # MC sampling time per betting decision (ms)
    "discard_budget_ms": 10.0,   # MC time for a discard decision (all options together)
    "n_min": 32,                 # MC samples, lower bound
    "n_max": 1024,               # MC samples, upper bound
    "profile_ms": 400.0,         # one-off per-spec preflop profile build (ms of sampling)
    # ---- preflop: ranges as fractions of all hands (percentile gates) --------------
    "open_frac": 0.80,           # SB opens (raises) the top 80% when deep
    "limp_frac": 0.07,           # next 7% limps; the rest folds
    "open_bb": 2.5,              # SB open size, raise-to in big blinds
    "iso_frac": 0.35,            # BB raises the top 35% after an SB limp
    "iso_bb": 3.5,               # BB raise-to vs a limp, in big blinds
    "threebet_mult": 3.2,        # first re-raise: raise to this x the opponent's raise-to
    "fourbet_mult": 2.3,         # later re-raises
    "shove_max_bb": 12.0,        # effective stack (bb) at or below which we play push/fold
    "shove_k": 7.5,              # push/fold: shove the top min(1, shove_k / eff_bb) of hands
    "shove_frac_min": 0.08,
    "pct_temp": 0.02,            # softness of percentile gates (mixing near the edge)
    # ---- preflop: facing a raise (equity vs the raise-implied range) ----------------
    "pre_range_k": 1.6,          # opponent range after raising to R bb: top k / R**exp
    "pre_range_exp": 0.6,        #   (2.5bb -> 92%, 8bb -> 46%, 20bb -> 27%, 100bb -> 10%)
    "pre_range_min": 0.10,
    "pre_call_keep": 0.80,       # opponent called our raise: drop his bottom 20%
    "pre_mix": 0.08,             # share of uniformly random hands in a raise range ...
    "pre_polar": 0.5,            # ... plus pre_polar * B/(P+2B) for a raise of B into P
                                 #   (big overbets are polarised: more bluffs)
    "pre_raise_eq": 0.60,        # re-raise for value with equity >= this vs the range
    "pre_call_margin_oop": 0.03, # extra equity needed to call out of position (BB)
    "pre_call_margin_ip": 0.00,  # ... in position (SB)
    "pre_allin_margin": 0.00,    # ... when the call is for all the chips
    "pre_bluff_raise_freq": 0.06,# light re-raise frequency with hands just below calling
    "mdf_scale": 1.0,            # facing a raise, continue with at least the top
                                 #   mdf_scale * pot/(pot+bet) of my own range (anti-overbet floor)
    # ---- postflop opponent range model ----------------------------------------------
    "post_bet_keep": 0.55,       # opponent bets: keep the top 55% of made hands ...
    "post_raise_keep": 0.35,     # opponent raises our bet: keep the top 35% ...
    "post_call_keep": 0.85,      # opponent calls our bet postflop
    "post_keep_min": 0.08,
    "post_mix": 0.25,            # share of the range kept as bluffs/draws (wider range)
    "size_factor_min": 0.75,     # keep ** clip(0.5 + bet/pot, min, max): bigger bets narrow more
    "size_factor_max": 1.75,
    # ---- postflop decisions (equity is vs the narrowed range) ------------------------
    "value_bet_eq": 0.60,        # bet for value at or above this
    "strong_eq": 0.80,           # strong value: bigger sizes, commit when SPR is low
    "value_bet_freq": 0.85,      # medium-strength value hands bet this often
    "slowplay_freq": 0.10,       # strong hands check this often before the river
    "big_freq_strong": 0.60,     # strong hands use bet_big this often (else bet_small)
    "big_freq_value": 0.25,      # medium value hands use bet_big this often
    "semibluff_draw": 0.12,      # draw = equity - made share at or above this is a draw
    "semibluff_freq": 0.50,      # bet a draw when checked to (or first to act)
    "semibluff_raise_freq": 0.20,# raise a draw facing a bet
    "bluff_max_eq": 0.35,        # pure bluffs only below this equity
    "bluff_freq": 0.12,          # flop/turn bluff frequency (in position, checked to)
    "bluff_freq_river": 0.15,    # river bluff frequency
    "cbet_freq": 0.40,           # flop bluff frequency as the preflop aggressor
    "oop_bluff_mult": 0.6,       # bluff frequencies are scaled by this out of position
    "bluff_raise_freq": 0.03,    # raise air facing a bet
    "raise_eq": 0.78,            # raise for value facing a bet at or above this
    "call_margin": 0.00,         # call if equity >= pot odds + call_margin - implied
    "implied_k": 0.35,           # implied-odds credit = implied_k * draw (cards to come)
    "implied_max": 0.08,
    "eq_temp": 0.02,             # softness of equity gates
    # ---- sizes --------------------------------------------------------------------
    "bet_small": 0.50,           # pot fraction
    "bet_big": 1.00,             # pot fraction
    "raise_size": 1.00,          # raise by this fraction of the pot after calling
    "commit_frac": 0.40,         # a bet/raise using >= this share of my stack becomes all-in
    "commit_spr": 1.3,           # value hands shove when stack-to-pot ratio is below this
}

# Knobs an opponent-modelling subclass may move, with sane bounds.
ADJUSTABLE = {
    "bluff_freq": (0.0, 0.45),
    "bluff_freq_river": (0.0, 0.45),
    "cbet_freq": (0.0, 0.85),
    "semibluff_freq": (0.0, 0.9),
    "bluff_raise_freq": (0.0, 0.15),
    "pre_bluff_raise_freq": (0.0, 0.25),
    "mdf_scale": (0.0, 1.5),
    "call_margin": (-0.10, 0.15),          # defence looseness postflop (lower = calls more)
    "pre_call_margin_oop": (-0.08, 0.12),
    "pre_call_margin_ip": (-0.08, 0.12),
    "value_bet_eq": (0.50, 0.75),          # thinner (lower) or tighter value betting
    "raise_eq": (0.65, 0.92),
    "pre_raise_eq": (0.52, 0.75),
    "open_frac": (0.30, 1.0),
    "iso_frac": (0.10, 0.70),
    "shove_k": (3.0, 14.0),
    "pre_range_k": (0.8, 4.0),             # how wide we think the opponent raises preflop
    "pre_polar": (0.0, 1.0),
    "post_bet_keep": (0.25, 1.0),          # how much an opponent bet means (1 = nothing)
    "post_raise_keep": (0.15, 1.0),
    "post_mix": (0.05, 0.8),
    "bet_small": (0.25, 0.8),
    "bet_big": (0.6, 2.0),
    "raise_size": (0.5, 1.5),
}

# --------------------------------------------------------------------------------------
# Per-spec preflop profile (module-level cache)
# --------------------------------------------------------------------------------------
_PROFILES: dict = {}
_PRE_EQ: dict = {}   # (rules spec, canonical hand) -> (equity, n)


def _rules_key(spec):
    """The spec without fields that do not change hand values (time limits, names)."""
    return spec.with_(name="", notes="", time_per_decision=None, time_per_match=None,
                      hands_per_match=1)


def hand_features(hole: np.ndarray, deck_ranks) -> np.ndarray:
    """Vectorised preflop features for an (m, k) array of hole cards."""
    hole = np.asarray(hole, dtype=np.int64)
    m, k = hole.shape
    lo, hi = min(deck_ranks), max(deck_ranks)
    span = max(1, hi - lo)
    r = ((hole >> 2) - lo) / span
    s = hole & 3
    rs = -np.sort(-r, axis=1)
    cols = [np.ones(m)] + [rs[:, i] for i in range(k)] + [rs[:, i] ** 2 for i in range(k)]
    if k >= 2:
        cols.append(rs[:, 0] * rs[:, 1])
    pair = np.zeros(m); pair_hi = np.zeros(m); suited = np.zeros(m); suit_hi = np.zeros(m)
    c1 = np.zeros(m); c2 = np.zeros(m); c3 = np.zeros(m)
    for i, j in combinations(range(k), 2):
        eq = r[:, i] == r[:, j]
        pair += eq
        pair_hi = np.maximum(pair_hi, eq * r[:, i])
        sm = s[:, i] == s[:, j]
        suited += sm
        suit_hi = np.maximum(suit_hi, sm * np.maximum(r[:, i], r[:, j]))
        d = np.rint(np.abs(r[:, i] - r[:, j]) * span)
        c1 += d == 1; c2 += d == 2; c3 += d == 3
    sc = np.stack([(s == u).sum(1) for u in range(4)], 1)
    cols += [pair, pair_hi, pair_hi ** 2, suited, suit_hi, (sc >= 2).sum(1), (sc >= 3).sum(1),
             c1, c2, c3]
    return np.stack(cols, 1)


class PreflopProfile:
    """Preflop equity model for one spec: a linear model on card features fitted to
    sampled equities vs a random hand, and the spec's equity distribution."""

    def __init__(self, spec, profile_ms: float = 400.0, hands: int = 500, seed: int = 20261028):
        self.spec = spec
        self.k = spec.hole_cards
        m = get_equity_model(spec)
        rng = np.random.default_rng(seed)
        deck = np.array(spec.deck, dtype=np.int64)
        n_each = int(np.clip(profile_ms / max(1e-4, m.ms_per_sample()) / hands, 40, 400))
        self.hands = np.array([rng.choice(deck, self.k, replace=False) for _ in range(hands)])
        eqs = np.array([self._mc(m, tuple(int(c) for c in h), n_each, rng) for h in self.hands])
        X = hand_features(self.hands, spec.deck_ranks)
        A = X.T @ X + 1e-3 * np.eye(X.shape[1])
        self.coef = np.linalg.solve(A, X.T @ eqs)
        pred = X @ self.coef
        noise_var = float(np.mean(eqs * (1 - eqs))) / n_each
        self.resid_var = max(float(np.var(eqs - pred)) - noise_var, 2.5e-5)
        z = np.random.default_rng(seed + 1).standard_normal((20, hands))
        self.dist = np.sort((pred[None, :] + math.sqrt(self.resid_var) * z).ravel())

    @staticmethod
    def _mc(model, cards, n, rng) -> float:
        sp = model.spec
        d = sum(x.count for x in sp.discards)
        return model.equity(cards, (), opp_num_cards=sp.hole_cards,
                            board_to_come=sp.total_board_dealt, my_discards_left=d,
                            opp_discards_left=d, discard_to_board=model._future_to_board(0),
                            n=n, rng=rng)

    def predict(self, holes: np.ndarray) -> np.ndarray:
        return hand_features(holes, self.spec.deck_ranks) @ self.coef

    def percentile(self, equity: float) -> float:
        """Share of random hands with a lower preflop equity (0 = worst, 1 = best)."""
        return float(np.searchsorted(self.dist, equity)) / len(self.dist)

    def hand_equity(self, cards, n: int) -> float:
        """Preflop equity vs a random hand: MC (cached by suit class) shrunk towards
        the model prediction by inverse variance."""
        cards = tuple(int(c) for c in cards)
        pred = float(self.predict(np.array([cards]))[0])
        if n <= 0:
            return pred
        key = (self.spec, canonical(cards))   # self.spec is already a rules key
        hit = _PRE_EQ.get(key)
        if hit is None or hit[1] < n:
            rng = np.random.default_rng(abs(hash(key[1])) & 0xFFFFFFFF)
            hit = _PRE_EQ[key] = (self._mc(get_equity_model(self.spec), key[1], n, rng), n)
        mc, n_mc = hit
        var_mc = max(mc * (1 - mc), 0.05) / n_mc
        w = self.resid_var / (self.resid_var + var_mc)
        return pred + w * (mc - pred)


def get_profile(spec, profile_ms: float = 400.0) -> PreflopProfile:
    key = _rules_key(spec)
    prof = _PROFILES.get(key)
    if prof is None:
        prof = _PROFILES[key] = PreflopProfile(key, profile_ms=profile_ms)
    return prof


# --------------------------------------------------------------------------------------
# Opponent range sampler
# --------------------------------------------------------------------------------------
def _draw_rows(m: int, avail: np.ndarray, k: int, rng) -> np.ndarray:
    """m rows of k distinct cards from avail (rows with repeats are redrawn)."""
    A = len(avail)
    if k == 0:
        return np.zeros((m, 0), dtype=np.int64)
    out = np.empty((0, k), dtype=np.int64)
    while len(out) < m:
        idx = rng.integers(0, A, size=(int((m - len(out)) * 1.25) + 8, k))
        srt = np.sort(idx, axis=1)
        ok = np.all(np.diff(srt, axis=1) > 0, axis=1) if k > 1 else np.ones(len(idx), bool)
        out = np.concatenate([out, avail[idx[ok]]])
    return out[:m]


def _top(scores: np.ndarray, frac: float, rng) -> np.ndarray:
    """Indices of the top `frac` share of scores (random tie-break), at least 8."""
    m = len(scores)
    keep = int(min(m, max(8, math.ceil(frac * m))))
    if keep >= m:
        return np.arange(m)
    jitter = rng.random(m) * 1e-9 * (1 + np.abs(scores).max())
    return np.argpartition(-(scores + jitter), keep - 1)[:keep]


class RangeSampler:
    """opp_sampler for EquityModel.equity: draws opponent hands from a range that is
    (a) the top f_pre of hands by the preflop model, then (b) the top post_keep of
    those by made-hand strength on the board, mixed with a share of the wider range.
    After a call, `made` holds my share of the sampled range I beat right now."""

    def __init__(self, profile, evaluator, k: int, my_cards, board, f_pre: float,
                 pre_mix: float, post_keep: float, post_mix: float, can_eval: bool):
        self.profile, self.ev, self.k = profile, evaluator, k
        self.my_cards, self.board = tuple(my_cards), tuple(board)
        self.f_pre, self.pre_mix = f_pre, pre_mix
        self.post_keep, self.post_mix = post_keep, post_mix
        self.can_eval = can_eval
        self.made = None

    def __call__(self, n, avail, rng):
        use_pre = self.f_pre < 0.999 and self.profile is not None and self.k == self.profile.k
        filt = (self.f_pre if use_pre else 1.0) * (self.post_keep if self.can_eval else 1.0)
        # candidates cost about one evaluation each: cap them at a few times n so a
        # narrow range never blows the time budget (top rows are then reused)
        m = int(np.clip(n * 1.5 / max(filt, 1e-3), n, 4 * n))
        cand = _draw_rows(m, avail, self.k, rng)
        wide = cand
        if use_pre:
            wide = cand[_top(self.profile.predict(cand), self.f_pre, rng)]
        opp_scores = None
        if self.can_eval:
            bd = np.broadcast_to(np.array(self.board, dtype=np.int64), (len(wide), len(self.board)))
            wide_scores = self.ev.evaluate_batch(wide, bd)
            if self.post_keep < 0.999:
                sel = _top(wide_scores.astype(np.float64), self.post_keep, rng)
                strong, strong_scores = wide[sel], wide_scores[sel]
            else:
                strong, strong_scores = wide, wide_scores
        else:
            strong = wide
        # mixture: strong range, a post_mix share from the wider preflop range, and a
        # pre_mix share of any hand (only when a preflop range was applied)
        u = rng.random(n)
        src_any = u < (self.pre_mix if use_pre else 0.0)
        src_wide = (~src_any) & (u < (self.pre_mix if use_pre else 0.0) +
                                 (self.post_mix if strong is not wide else 0.0))
        i_strong = rng.integers(0, len(strong), n)
        i_wide = rng.integers(0, len(wide), n)
        i_any = rng.integers(0, len(cand), n)
        rows = strong[i_strong].copy()
        rows[src_wide] = wide[i_wide[src_wide]]
        rows[src_any] = cand[i_any[src_any]]
        if self.can_eval:
            my = self.ev.evaluate(self.my_cards, self.board)
            sc = strong_scores[i_strong].copy()
            sc[src_wide] = wide_scores[i_wide[src_wide]]
            if src_any.any():
                bd = np.broadcast_to(np.array(self.board, dtype=np.int64), (int(src_any.sum()), len(self.board)))
                sc[src_any] = self.ev.evaluate_batch(rows[src_any], bd)
            self.made = float(np.mean((my > sc) + 0.5 * (my == sc)))
        return rows


# --------------------------------------------------------------------------------------
# History replay
# --------------------------------------------------------------------------------------
def replay(obs, spec):
    """Rebuild bet sizes from the history. Returns a list of dicts with keys
    pos, street, kind, amount, pip_before (actor's pip on this street before the
    action), pot_before, frac (raise size / pot after calling), is_bet
    (first bet of a postflop street), facing_raise (a call of a raise above the blind)."""
    sb, bb, ante = spec.small_blind, spec.big_blind, spec.ante
    committed = [ante + sb, ante + bb]
    pips = [sb, bb]
    street = 0
    out = []
    for rec in obs.history:
        if rec.street != street:
            street, pips = rec.street, [0, 0]
        p = rec.position
        ev = {"pos": p, "street": street, "kind": rec.kind, "amount": rec.amount,
              "pip_before": pips[p], "pot_before": sum(committed), "frac": 0.0, "is_bet": False, "facing_raise": False}
        if rec.kind == "raise":
            prev_max = max(pips)
            to_call = prev_max - pips[p]
            ev["frac"] = (rec.amount - prev_max) / max(1, sum(committed) + to_call)
            ev["is_bet"] = street > 0 and prev_max == 0
            committed[p] += rec.amount - pips[p]
            pips[p] = rec.amount
        elif rec.kind == "call":
            ev["facing_raise"] = max(pips) > (bb if street == 0 else 0)
            committed[p] += rec.amount
            pips[p] += rec.amount
        out.append(ev)
    return out


def _logistic(x: float) -> float:
    if x > 40:
        return 1.0
    if x < -40:
        return 0.0
    return 1.0 / (1.0 + math.exp(-x))


# --------------------------------------------------------------------------------------
# The bot
# --------------------------------------------------------------------------------------
class BalancedBot(Bot):
    name = "balanced"

    def __init__(self, params: dict | None = None):
        params = dict(params or {})
        unknown = set(params) - set(DEFAULT_PARAMS)
        if unknown:
            raise KeyError(f"unknown params: {sorted(unknown)}")
        self.params = {**DEFAULT_PARAMS, **params}
        self.errors = 0
        self.last_error = None

    # ---- lifecycle -------------------------------------------------------------------
    def new_match(self, spec, seed=0):
        super().new_match(spec, seed)
        self.np_rng = np.random.default_rng(seed)
        self.model = get_equity_model(spec)
        self.ev = get_evaluator(spec)
        prof_ms = self.params["profile_ms"]
        if spec.time_per_match:
            prof_ms = min(prof_ms, 20.0 * spec.time_per_match)  # <= 2% of the match clock
        self.profile = get_profile(spec, prof_ms)
        self.ms_sample = self.model.ms_per_sample()
        self._an_key = None
        self._an = None
        self._decisions = 0
        self._hands_seen = 0

    def end_hand(self, result):
        self._hands_seen += 1

    # ---- dispatch -------------------------------------------------------------------
    def act(self, obs):
        lg = obs.legal
        try:
            self._decisions += 1
            if obs.phase == "discard" or lg.discard_count:
                a = self.discard_action(obs)
                ok = lg.is_legal(a, obs.my_cards)
            elif obs.street == 0:
                a = self.preflop_action(obs)
                ok = lg.is_legal(a)
            else:
                a = self.postflop_action(obs)
                ok = lg.is_legal(a)
            if ok:
                return a
            self.errors += 1
            self.last_error = f"illegal {a!r} with {lg}"
        except Exception:  # never fold to our own bug: fall back to a safe action
            self.errors += 1
            self.last_error = traceback.format_exc()
        if lg.discard_count:
            return Discard(obs.my_cards[:lg.discard_count])
        return Check() if lg.can_check else Fold()

    # ---- budget -----------------------------------------------------------------------
    def _budget_ms(self, obs, base: float) -> float:
        b = base
        tpd = self.spec.time_per_decision
        if tpd:
            b = min(b, 150.0 * tpd)  # 15% of the per-decision limit
        if obs.time_left is not None:
            hands_left = max(1, obs.hands_in_match - obs.hand_index)
            per_hand = max(2.0, self._decisions / max(1, self._hands_seen + 1))
            b = min(b, 0.4 * 1000.0 * obs.time_left / (hands_left * per_hand))
        return max(0.0, b)

    def _n(self, budget_ms: float, cost_mult: float = 1.0) -> int:
        p = self.params
        raw = budget_ms / max(1e-5, self.ms_sample * cost_mult)
        if raw < p["n_min"]:
            return int(p["n_min"]) if raw >= p["n_min"] / 4 else 0
        n = 1 << int(math.log2(raw))   # power-of-two buckets: stable across machines
        return int(min(p["n_max"], n))

    # ---- opponent model from the action history --------------------------------------
    def opponent_range(self, obs):
        """(f_pre, post_keep, pre_mix): preflop range share, postflop made-hand keep
        share, and the share of random hands mixed into the preflop range."""
        p = self.params
        bb = self.spec.big_blind
        opp = 1 - obs.position
        f_pre, keep, mix = 1.0, 1.0, p["pre_mix"]
        for e in replay(obs, self.spec):
            if e["pos"] != opp:
                continue
            if e["street"] == 0:
                if e["kind"] == "raise":
                    r_bb = max(1.0, e["amount"] / bb)
                    f = p["pre_range_k"] / r_bb ** p["pre_range_exp"]
                    f_pre = min(f_pre, max(p["pre_range_min"], f))
                    r = (e["amount"] - e["pip_before"]) / max(1, e["pot_before"])
                    mix = p["pre_mix"] + p["pre_polar"] * r / (1 + 2 * r)
                elif e["kind"] == "call" and e["facing_raise"]:
                    f_pre *= p["pre_call_keep"]
            else:
                if e["kind"] == "raise":
                    base = p["post_bet_keep"] if e["is_bet"] else p["post_raise_keep"]
                    sf = min(p["size_factor_max"], max(p["size_factor_min"], 0.5 + e["frac"]))
                    keep *= base ** sf
                elif e["kind"] == "call" and e["amount"] > 0:
                    keep *= p["post_call_keep"]
        return min(1.0, f_pre), max(p["post_keep_min"], keep), min(0.9, mix)

    def _can_eval(self, n_hole: int, n_board: int) -> bool:
        sp = self.spec
        if sp.hole_usage == "exactly":
            return n_board >= 5 - sp.hole_exact and n_hole >= sp.hole_exact
        return n_hole + n_board >= 5

    # ---- strength ---------------------------------------------------------------------
    def analyse(self, obs) -> dict:
        key = (obs.hand_index, obs.street, obs.phase, len(obs.history), tuple(obs.my_cards))
        if self._an_key == key:
            return self._an
        p = self.params
        f_pre, keep, pre_mix = self.opponent_range(obs)
        n = self._n(self._budget_ms(obs, p["budget_ms"]))
        info = {"f_pre": f_pre, "post_keep": keep, "n": n, "percentile": None,
                "made": None, "draw": 0.0}
        if obs.street == 0:
            if len(obs.my_cards) == self.profile.k:
                own = self.profile.hand_equity(obs.my_cards, n)
            else:  # after a preflop discard the card model (fitted on full hands) does not apply
                own = self.model.equity_obs(obs, n=n, rng=self.np_rng) if n else 0.5
            info["pre_equity"] = own
            info["percentile"] = self.profile.percentile(own)
        if obs.street == 0 and f_pre >= 0.999:
            info["equity"] = info["pre_equity"]
        elif n == 0:  # out of time: crude fallback
            base = info.get("pre_equity", 0.5)
            info["equity"] = 0.5 + (base - 0.5) * 0.5 - 0.15 * (1 - keep) - 0.1 * (1 - f_pre)
        else:
            can_eval = obs.street > 0 and self._can_eval(len(obs.my_cards), len(obs.board))
            sampler = RangeSampler(
                self.profile, self.ev, obs.opp_num_cards, obs.my_cards, obs.board,
                f_pre=f_pre, pre_mix=pre_mix,
                post_keep=keep if obs.street > 0 else 1.0, post_mix=p["post_mix"],
                can_eval=can_eval)
            info["equity"] = self.model.equity_obs(obs, n=n, rng=self.np_rng, opp_sampler=sampler)
            if sampler.made is not None:
                info["made"] = sampler.made
                if obs.board_cards_to_come > 0:
                    info["draw"] = max(0.0, info["equity"] - sampler.made)
        self._an_key, self._an = key, info
        return info

    def strength(self, obs) -> float:
        """Equity vs the opponent's action-implied range (preflop: vs a random hand
        until the opponent raises)."""
        return float(self.analyse(obs)["equity"])

    # ---- helpers -------------------------------------------------------------------
    def _gate(self, x: float, thr: float, temp: float) -> bool:
        """Soft threshold: True with probability logistic((x - thr) / temp)."""
        return self.rng.random() < _logistic((x - thr) / max(1e-6, temp))

    def _chance(self, prob: float) -> bool:
        return self.rng.random() < prob

    def _raise_to(self, obs, frac_pot: float):
        """Raise to opp_pip + frac_pot * (pot after calling); all-in if that commits
        commit_frac of my stack. Returns a legal RaiseTo or None if raising is illegal."""
        lg = obs.legal
        if not lg.can_raise:
            return None
        to_call = lg.call_amount
        target = obs.opp_pip + frac_pot * (obs.pot + to_call)
        if target - obs.my_pip >= self.params["commit_frac"] * obs.my_stack:
            target = lg.max_raise_to
        return RaiseTo(lg.clamp_raise(target))

    def _allin(self, obs):
        return RaiseTo(obs.legal.max_raise_to) if obs.legal.can_raise else None

    def _eff_bb(self, obs) -> float:
        eff = min(obs.my_stack + obs.my_committed, obs.opp_stack + obs.opp_committed)
        return eff / self.spec.big_blind

    # ---- preflop ---------------------------------------------------------------------
    def preflop_action(self, obs):
        p = self.params
        lg = obs.legal
        bb = self.spec.big_blind
        info = self.analyse(obs)
        pct = info["percentile"]
        eff_bb = self._eff_bb(obs)
        short = eff_bb <= p["shove_max_bb"]
        opp_raised = any(e["pos"] != obs.position and e["kind"] == "raise"
                         for e in replay(obs, self.spec) if e["street"] == 0)
        t = p["pct_temp"]

        if not opp_raised and obs.position == 0 and lg.can_call and obs.opp_pip <= bb:
            # SB, first action: open / limp / fold, or push/fold when short
            if short:
                frac = min(1.0, max(p["shove_frac_min"], p["shove_k"] / max(1.0, eff_bb)))
                if lg.can_raise and self._gate(pct, 1 - frac, t):
                    return self._allin(obs)
                return Fold()
            if lg.can_raise and self._gate(pct, 1 - p["open_frac"], t):
                return self._raise_to_bb(obs, p["open_bb"])
            if self._gate(pct, 1 - p["open_frac"] - p["limp_frac"], t):
                return Call()
            return Fold()

        if lg.can_check:
            # BB after an SB limp (or any free option): raise or check
            frac = p["iso_frac"]
            if short:
                frac = min(frac, max(p["shove_frac_min"], 0.6 * p["shove_k"] / max(1.0, eff_bb)))
            if lg.can_raise and self._gate(pct, 1 - frac, t):
                return self._allin(obs) if short else self._raise_to_bb(obs, p["iso_bb"])
            return Check()

        # facing a raise: equity vs the raise-implied range against pot odds
        eq = self.strength(obs)
        to_call = lg.call_amount
        req = to_call / (obs.pot + to_call)
        all_in_call = to_call >= obs.my_stack or obs.opp_stack == 0
        if all_in_call:
            margin = p["pre_allin_margin"]
        else:
            margin = p["pre_call_margin_oop"] if obs.position == 1 else p["pre_call_margin_ip"]
        et = p["eq_temp"]
        if lg.can_raise and not all_in_call and self._gate(eq, p["pre_raise_eq"], et):
            return self._reraise(obs, short)
        if self._gate(eq, req + margin, et):
            return Call()
        floor = self._mdf_floor(obs)
        if floor > 0 and self._gate(pct, 1 - floor, t):
            return Call()
        if (lg.can_raise and not short and not all_in_call and eq > req + margin - 0.08
                and self._chance(p["pre_bluff_raise_freq"])):
            return self._reraise(obs, short)
        return Fold()

    def _my_preflop_share(self, obs) -> float:
        """Rough share of all hands that reach this node with my preflop line."""
        p = self.params
        share = 1.0
        for e in replay(obs, self.spec):
            if e["street"] != 0 or e["pos"] != obs.position:
                continue
            if e["kind"] == "raise":
                share *= p["open_frac"] if (obs.position == 0 and share == 1.0) else 0.3
            elif e["kind"] == "call" and obs.position == 0 and share == 1.0:
                share = p["limp_frac"]
            elif e["kind"] == "check":
                share *= 1 - p["iso_frac"]
        return share

    def _mdf_floor(self, obs) -> float:
        """Minimum share of ALL hands to continue with facing the last raise, so that
        raising any two cards (e.g. always shoving) cannot profit from our folds."""
        evs = replay(obs, self.spec)
        last = next((e for e in reversed(evs) if e["kind"] == "raise"), None)
        if last is None or last["pos"] == obs.position:
            return 0.0
        pot_before = obs.pot - (last["amount"] - last["pip_before"])
        mdf = pot_before / max(1, obs.pot)
        return self.params["mdf_scale"] * mdf * self._my_preflop_share(obs)

    def _raise_to_bb(self, obs, size_bb: float):
        target = size_bb * self.spec.big_blind
        lg = obs.legal
        if target - obs.my_pip >= self.params["commit_frac"] * obs.my_stack:
            target = lg.max_raise_to
        return RaiseTo(lg.clamp_raise(target))

    def _reraise(self, obs, short: bool):
        p = self.params
        lg = obs.legal
        if short:
            return self._allin(obs)
        n_raises = sum(1 for e in replay(obs, self.spec) if e["street"] == 0 and e["kind"] == "raise")
        mult = p["threebet_mult"] if n_raises <= 1 else p["fourbet_mult"]
        target = mult * obs.opp_pip
        if target - obs.my_pip >= p["commit_frac"] * obs.my_stack:
            target = lg.max_raise_to
        return RaiseTo(lg.clamp_raise(target))

    # ---- postflop --------------------------------------------------------------------
    def postflop_action(self, obs):
        p = self.params
        lg = obs.legal
        eq = self.strength(obs)
        info = self.analyse(obs)
        draw = info["draw"]
        river = obs.board_cards_to_come == 0
        ip = obs.position == 0
        spr = min(obs.my_stack, obs.opp_stack) / max(1, obs.pot)
        et = p["eq_temp"]

        if lg.can_check:
            return self._unopened(obs, eq, draw, river, ip, spr)

        # facing a bet or raise
        to_call = lg.call_amount
        req = to_call / (obs.pot + to_call)
        implied = 0.0 if river else min(p["implied_max"], p["implied_k"] * draw)
        need = req + p["call_margin"] - implied
        if lg.can_raise and self._gate(eq, p["raise_eq"], et):
            return self._raise_to(obs, p["raise_size"])
        if (lg.can_raise and not river and draw >= p["semibluff_draw"] and eq > need - 0.1
                and spr > 0.5 and self._chance(p["semibluff_raise_freq"])):
            return self._raise_to(obs, p["raise_size"])
        if self._gate(eq, need, et):
            return Call()
        if lg.can_raise and eq < p["bluff_max_eq"] and self._chance(p["bluff_raise_freq"]):
            return self._raise_to(obs, p["raise_size"])
        return Fold()

    def _unopened(self, obs, eq, draw, river, ip, spr):
        """No bet to face: value bet, semi-bluff, bluff or check."""
        p = self.params
        lg = obs.legal
        et = p["eq_temp"]
        if not lg.can_raise:
            return Check()
        if self._gate(eq, p["strong_eq"], et):
            if not river and self._chance(p["slowplay_freq"]):
                return Check()
            if spr <= p["commit_spr"]:
                return self._allin(obs)
            big = self._chance(p["big_freq_strong"])
            return self._raise_to(obs, p["bet_big"] if big else p["bet_small"])
        if self._gate(eq, p["value_bet_eq"], et):
            if self._chance(p["value_bet_freq"]):
                if spr <= p["commit_spr"] * 0.6:
                    return self._allin(obs)
                big = self._chance(p["big_freq_value"])
                return self._raise_to(obs, p["bet_big"] if big else p["bet_small"])
            return Check()
        if not river and draw >= p["semibluff_draw"]:
            if self._chance(p["semibluff_freq"] * (1.0 if ip else 0.8)):
                big = self._chance(0.5)
                return self._raise_to(obs, p["bet_big"] if big else p["bet_small"])
            return Check()
        if eq < p["bluff_max_eq"]:
            if river:
                freq = p["bluff_freq_river"]
            elif obs.street == 1 and self._was_preflop_aggressor(obs):
                freq = p["cbet_freq"]
            else:
                freq = p["bluff_freq"]
            if not ip:
                freq *= p["oop_bluff_mult"]
            if self._chance(freq):
                # bluffs use the value-bet size mix so sizes do not reveal strength
                big = self._chance(0.5 * (p["big_freq_strong"] + p["big_freq_value"]))
                return self._raise_to(obs, p["bet_big"] if big else p["bet_small"])
        return Check()

    def _was_preflop_aggressor(self, obs) -> bool:
        last = None
        for e in replay(obs, self.spec):
            if e["street"] == 0 and e["kind"] == "raise":
                last = e["pos"]
        return last == obs.position

    # ---- discards --------------------------------------------------------------------
    def discard_action(self, obs):
        k = obs.legal.discard_count
        n_opts = math.comb(len(obs.my_cards), k)
        n = self._n(self._budget_ms(obs, self.params["discard_budget_ms"]), cost_mult=n_opts)
        if n == 0:
            # no time: keep the highest ranks
            ranked = sorted(obs.my_cards, key=lambda c: c >> 2)
            return Discard(ranked[:k])
        opts = self.model.discard_options(obs, n=n, rng=self.np_rng)
        return Discard(opts[0][0])


def make_bot(**kwargs):
    return BalancedBot(**kwargs)
