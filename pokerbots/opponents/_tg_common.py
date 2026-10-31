"""Shared helpers for the opponent bots (opp_tag, opp_gtolite).

Everything here is spec-driven: it reads the rules only from the GameSpec and
uses only the engine (equity model, evaluator) plus what a bot may observe.

* SpecInfo: per-spec preflop percentiles from a seeded pool of random hands
  (Monte Carlo equity vs a random hand), cached per spec for the process.
* range_sampler: opponent hands drawn from the top r of the preflop pool (suits
  permuted), then narrowed on the board by "best of m" on current made strength,
  with an epsilon of unfiltered hands so draws and bluffs stay in the range.
* OppModel: per-match counters (preflop raise/continue frequencies per node,
  postflop aggression, fold-to-cbet, fold-to-bet, river bluffs shown down).
"""
from __future__ import annotations

from itertools import combinations, permutations
from math import comb

import numpy as np

from engine.equity import get_equity_model
from engine.evaluator import get_evaluator
from engine.game import Call, Check, Discard, Fold, RaiseTo

PERMS = np.array(list(permutations(range(4))), dtype=np.int64)  # (24, 4)

POOL_SIZE = 240
_INFOS: dict = {}


class SpecInfo:
    def __init__(self, spec):
        self.spec = spec
        self.model = get_equity_model(spec)
        self.ev = get_evaluator(spec)
        self.ms = max(1e-4, self.model.ms_per_sample())
        h = spec.hole_cards
        # preflop equity sample size: ~6 ms per new class, 150..1000 samples
        self.n_pre = int(np.clip(6.0 / self.ms, 150, 1000))
        rng = np.random.default_rng([7, h, len(spec.deck)])
        deck = np.array(spec.deck, dtype=np.int64)
        hands = np.array([rng.choice(deck, h, replace=False) for _ in range(POOL_SIZE)], dtype=np.int64)
        eqs = np.array([self.pre_eq(tuple(int(c) for c in x)) for x in hands])
        order = np.argsort(-eqs, kind="stable")
        self.pool = hands[order]              # strongest first
        self.pool_eq = eqs[order]
        self.sorted_eq = np.sort(eqs)         # ascending, for percentiles
        self.deck_mask_base = np.zeros(52, dtype=bool)

    def pre_eq(self, cards) -> float:
        return self.model.preflop_equity(tuple(cards), n=self.n_pre)

    def pct(self, cards) -> float:
        """Fraction of random hands with lower preflop equity (0 worst, 1 best)."""
        e = self.pre_eq(cards)
        lo = np.searchsorted(self.sorted_eq, e, side="left")
        hi = np.searchsorted(self.sorted_eq, e, side="right")
        return float((lo + hi) / 2 / len(self.sorted_eq))

    def n_post(self, budget_ms: float, m: float = 1.0) -> int:
        cost = self.ms * (1.0 + 0.35 * max(0.0, m - 1.0))
        return int(np.clip(budget_ms / cost, 60, 450))


def get_info(spec) -> SpecInfo:
    info = _INFOS.get(spec)
    if info is None:
        info = _INFOS[spec] = SpecInfo(spec)
    return info


# ---- ranges --------------------------------------------------------------------------
def _random_hands(k, h, avail, rng):
    keys = rng.random((k, len(avail)))
    idx = np.argpartition(keys, h - 1, axis=1)[:, :h] if h < len(avail) else np.tile(np.arange(len(avail)), (k, 1))
    return avail[idx]


def _pool_hands(info: SpecInfo, r: float, k: int, h: int, avail, rng):
    """k hands of h cards from the top r of the preflop pool, all cards in avail."""
    if r >= 0.95:
        return _random_hands(k, h, avail, rng)
    top = max(4, int(round(r * len(info.pool))))
    tries = 4
    idx = rng.integers(0, top, size=k * tries)
    perm = PERMS[rng.integers(0, 24, size=k * tries)]
    base = info.pool[idx]
    suits = np.take_along_axis(perm, base & 3, axis=1)
    cand = ((base >> 2) << 2) | suits                      # (k*tries, H)
    H = cand.shape[1]
    if h < H:  # opponent already discarded: keep a random subset
        sel = np.argsort(rng.random((k * tries, H)), axis=1)[:, :h]
        cand = np.take_along_axis(cand, sel, axis=1)
    ok = np.zeros(52, dtype=bool)
    ok[avail] = True
    valid = ok[cand].all(axis=1).reshape(k, tries)
    cand = cand.reshape(k, tries, h)
    first = np.argmax(valid, axis=1)
    out = cand[np.arange(k), first]
    bad = ~valid.any(axis=1)
    if bad.any():
        out[bad] = _random_hands(int(bad.sum()), h, avail, rng)
    return out


def scorable(spec, h: int, b: int) -> bool:
    if h + b < 5:
        return False
    if spec.hole_usage == "exactly":
        return h >= spec.hole_exact and b >= 5 - spec.hole_exact
    return True


def range_sampler(info: SpecInfo, board, r_pre: float, m_post: float, eps: float = 0.25):
    """opp_sampler for EquityModel.equity: preflop range = top r_pre of the pool;
    postflop narrowing = best of ~m_post candidates on the current board."""
    board = np.array(list(board), dtype=np.int64)
    m_post = float(np.clip(m_post, 1.0, 4.0))
    M = int(np.ceil(m_post))

    def sampler(n, avail, rng):
        h = sampler.h
        if M <= 1 or not scorable(info.spec, h, len(board)):
            return _pool_hands(info, r_pre, n, h, avail, rng)
        cand = _pool_hands(info, r_pre, n * M, h, avail, rng)
        sc = info.ev.evaluate_batch(cand, np.broadcast_to(board, (n * M, len(board)))).reshape(n, M)
        lo = int(np.floor(m_post))
        m_row = lo + (rng.random(n) < (m_post - lo))
        cols = np.arange(M)[None, :]
        sc = np.where(cols < m_row[:, None], sc, -1)
        pick = np.argmax(sc, axis=1)
        pick = np.where(rng.random(n) < eps, 0, pick)
        return cand.reshape(n, M, h)[np.arange(n), pick]

    sampler.h = 2
    return sampler


def equity_vs(info: SpecInfo, obs, rng, r_pre=1.0, m_post=1.0, budget_ms=4.0, eps=0.25):
    if r_pre >= 0.95 and m_post <= 1.0:
        sampler = None
    else:
        sampler = range_sampler(info, obs.board, r_pre, m_post, eps)
        sampler.h = obs.opp_num_cards
    n = info.n_post(budget_ms, m_post)
    return info.model.equity_obs(obs, n=n, rng=rng, opp_sampler=sampler)


def top_mean(info: SpecInfo, r: float) -> float:
    k = max(1, int(round(r * len(info.pool_eq))))
    return float(info.pool_eq[:k].mean())


# ---- hand history view ----------------------------------------------------------------
class HandView:
    """Facts about the current hand from obs.history (observer's view)."""

    def __init__(self, obs):
        me = obs.position
        opp = 1 - me
        st = obs.street
        bet = [r for r in obs.history if r.kind != "discard"]
        pf = [r for r in bet if r.street == 0]
        pf_raises = [r for r in pf if r.kind == "raise"]
        self.pf_raises = len(pf_raises)
        self.pf_aggr = pf_raises[-1].position if pf_raises else None
        self.i_am_pf_aggr = self.pf_aggr == me
        cur = [r for r in bet if r.street == st]
        self.cur = cur
        self.raises_street = sum(r.kind == "raise" for r in cur)
        self.opp_raises_street = sum(r.kind == "raise" and r.position == opp for r in cur)
        self.my_raises_street = sum(r.kind == "raise" and r.position == me for r in cur)
        self.i_checked_street = any(r.kind == "check" and r.position == me for r in cur)
        self.opp_checked_street = any(r.kind == "check" and r.position == opp for r in cur)
        post_prev = [r for r in bet if 0 < r.street < st]
        self.opp_raises_prev = sum(r.kind == "raise" and r.position == opp for r in post_prev)
        self.opp_calls_prev = sum(r.kind == "call" and r.position == opp for r in post_prev)
        prev = [r for r in bet if r.street == st - 1] if st > 0 else []
        self.i_bet_prev = any(r.kind == "raise" and r.position == me for r in prev)
        self.prev_last_raiser = next((r.position for r in reversed(prev) if r.kind == "raise"), None)
        self.is_last_street = obs.board_cards_to_come == 0 and obs.my_discards_left == 0


def opp_pre_range(obs, model) -> float:
    """Width of the opponent's preflop range implied by their preflop actions."""
    opp = 1 - obs.position
    level = 0
    r = 1.0
    for rec in obs.history:
        if rec.street != 0 or rec.kind == "discard":
            continue
        if rec.position == opp:
            if rec.kind == "raise":
                r *= model.pf_freq(opp, level, "raise")
            elif rec.kind == "call":
                if not (level == 0 and opp == 0):  # SB limp: range stays wide
                    r *= model.pf_freq(opp, level, "cont")
        if rec.kind == "raise":
            level += 1
    return float(max(0.03, min(1.0, r)))


# ---- opponent model ------------------------------------------------------------------
_PF_PRIOR = {  # (pos, level): (raise freq, continue freq = raise + call/check)
    (0, 0): (0.6, 0.85), (1, 0): (0.3, 1.0), (1, 1): (0.13, 0.6), (0, 1): (0.15, 0.55),
    (0, 2): (0.25, 0.5), (1, 2): (0.25, 0.5),
}


class OppModel:
    PRIOR_W = 8.0

    def __init__(self):
        self.pf = {}            # (pos, level) -> [opps, raises, continues]
        self.post_actions = 0
        self.post_aggr = 0
        self.cbet_faced = 0
        self.cbet_fold = 0
        self.bets_faced = 0
        self.bets_fold = 0
        self.checked_to = 0     # opp was checked to postflop
        self.bet_when_checked = 0
        self.river_bets_shown = 0
        self.river_bets_lost = 0
        self.hands = 0

    def pf_freq(self, pos, level, what) -> float:
        key = (pos, min(level, 2))
        pr = _PF_PRIOR.get(key, (0.3, 0.6))
        prior = pr[0] if what == "raise" else pr[1]
        o, ra, co = self.pf.get(key, (0, 0, 0))
        x = ra if what == "raise" else co
        return (x + self.PRIOR_W * prior) / (o + self.PRIOR_W)

    @staticmethod
    def _rate(num, den, prior, w=6.0):
        return (num + w * prior) / (den + w)

    @property
    def aggression(self) -> float:      # share of opp postflop actions that are bets/raises
        return self._rate(self.post_aggr, self.post_actions, 0.3, 10)

    @property
    def fold_to_cbet(self) -> float:
        return self._rate(self.cbet_fold, self.cbet_faced, 0.45)

    @property
    def fold_to_bet(self) -> float:
        return self._rate(self.bets_fold, self.bets_faced, 0.4)

    @property
    def stab_rate(self) -> float:
        return self._rate(self.bet_when_checked, self.checked_to, 0.4)

    @property
    def river_bluff_rate(self) -> float:
        return self._rate(self.river_bets_lost, self.river_bets_shown, 0.3, 4)

    def update(self, res):
        self.hands += 1
        me = res.position
        opp = 1 - me
        bet = [r for r in res.history if r.kind != "discard"]
        level = 0
        for rec in bet:
            if rec.street != 0:
                continue
            if rec.position == opp:
                key = (opp, min(level, 2))
                o = self.pf.setdefault(key, [0, 0, 0])
                o[0] += 1
                if rec.kind == "raise":
                    o[1] += 1
                if rec.kind != "fold":
                    o[2] += 1
            if rec.kind == "raise":
                level += 1
        pf_r = [r for r in bet if r.street == 0 and r.kind == "raise"]
        i_aggr = bool(pf_r) and pf_r[-1].position == me
        streets = sorted({r.street for r in bet if r.street > 0})
        last_street = max([r.street for r in bet], default=0)
        for st in streets:
            cur = [r for r in bet if r.street == st]
            for i, rec in enumerate(cur):
                if rec.position == opp:
                    self.post_actions += 1
                    if rec.kind == "raise":
                        self.post_aggr += 1
                    prev = cur[i - 1] if i > 0 else None
                    if prev is not None and prev.position == me:
                        if prev.kind == "check":
                            self.checked_to += 1
                            self.bet_when_checked += rec.kind == "raise"
                        elif prev.kind == "raise":
                            self.bets_faced += 1
                            self.bets_fold += rec.kind == "fold"
                            first_raise = next((r for r in cur if r.kind == "raise"), None)
                            if st == 1 and i_aggr and first_raise is prev:
                                self.cbet_faced += 1
                                self.cbet_fold += rec.kind == "fold"
        if res.showdown and res.opp_cards is not None:
            fin = [r for r in bet if r.street == last_street]
            last_raise = next((r for r in reversed(fin) if r.kind == "raise"), None)
            if last_raise is not None and last_raise.position == opp:
                self.river_bets_shown += 1
                self.river_bets_lost += res.delta > 0


# ---- actions ---------------------------------------------------------------------------
def raise_to(obs, target, allin_frac=0.6):
    """Raise to `target` chips (this street); go all-in when it commits most of the stack."""
    lg = obs.legal
    if not lg.can_raise:
        return lg.passive()
    if target >= allin_frac * (obs.my_pip + obs.my_stack):
        target = lg.max_raise_to
    return RaiseTo(lg.clamp_raise(target))


def bet_pot(obs, frac, allin_frac=0.6):
    """Bet or raise `frac` of the pot (after calling)."""
    lg = obs.legal
    target = max(obs.opp_pip, obs.my_pip) + frac * (obs.pot + lg.call_amount)
    return raise_to(obs, target, allin_frac)


def shove(obs):
    lg = obs.legal
    return RaiseTo(lg.max_raise_to) if lg.can_raise else lg.passive()


def fold_or_check(obs):
    return Check() if obs.legal.can_check else Fold()


def safe(obs, a):
    """Last line of defence: never return an illegal action."""
    lg = obs.legal
    if lg.discard_count:
        if lg.is_legal(a, obs.my_cards):
            return a
        return Discard(tuple(obs.my_cards[:lg.discard_count]))
    if lg.is_legal(a):
        return a
    if a.kind == "raise" and lg.can_raise:
        return RaiseTo(lg.clamp_raise(a.amount))
    if a.kind == "check" and lg.can_call:
        return Fold()
    return lg.passive() if lg.can_check else (Call() if a.kind == "call" and lg.can_call else Fold())


def eff_stack(obs) -> int:
    return min(obs.my_stack + obs.my_committed, obs.opp_stack + obs.opp_committed)


def choose_discard(info: SpecInfo, obs, rng, budget_ms=6.0):
    k = obs.legal.discard_count
    n_opt = comb(len(obs.my_cards), k)
    n = int(np.clip(budget_ms / (info.ms * n_opt * 1.3), 40, 250))
    opts = info.model.discard_options(obs, n=n, rng=rng)
    return Discard(opts[0][0])


def sigmoid(x):
    return 1.0 / (1.0 + np.exp(-x))
