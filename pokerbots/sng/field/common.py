"""Shared pieces for the opponent field: preflop hand ranking, postflop hand tiers,
the betting situation read from an observation, and legal-by-construction actions.

Everything here is spec-aware (deck, hole card count, hand ranking via the evaluator,
pot-limit via legal.max_raise_to), so every bot stays legal on any variant.
"""
from __future__ import annotations

import bisect
import math
import random
from collections import Counter
from dataclasses import dataclass
from itertools import combinations

import numpy as np

from engine.evaluator import get_evaluator
from engine.game import Fold, RaiseTo

# ---- preflop ---------------------------------------------------------------------------
_CHEN_HIGH = {12: 10.0, 11: 8.0, 10: 7.0, 9: 6.0}      # A K Q J; lower ranks = (rank+2)/2


def chen(c1: int, c2: int) -> int:
    """Bill Chen's formula for two hole cards (AA = 20, 72o = -1)."""
    r1, r2 = c1 >> 2, c2 >> 2
    hi, lo = max(r1, r2), min(r1, r2)
    pts = _CHEN_HIGH.get(hi, (hi + 2) / 2)
    if r1 == r2:
        return math.ceil(max(5.0, 2 * pts))
    if (c1 & 3) == (c2 & 3):
        pts += 2
    gap = hi - lo - 1
    pts -= (0, 1, 2, 4)[gap] if gap < 4 else 5
    if gap <= 1 and hi < 10:                              # both cards below a queen
        pts += 1
    return math.ceil(pts)


def hand_score(hole) -> float:
    """Chen for 2 cards; for more hole cards the best 2-card Chen plus a bit of the second."""
    if len(hole) == 2:
        return chen(hole[0], hole[1])
    vals = sorted((chen(a, b) for a, b in combinations(hole, 2)), reverse=True)
    return vals[0] + 0.3 * vals[1]


class PreflopRanker:
    """Maps hole cards to `top`: the fraction of starting hands at least as good
    (AA ~ 0.005, the worst hand = 1.0), so ranges are written as percentages and
    mean the same thing on any deck / hole-card count."""

    def __init__(self, spec):
        deck = spec.deck
        h = spec.hole_cards
        if h == 2:
            scores = [hand_score(c) for c in combinations(deck, 2)]
        else:
            rng = random.Random(12345)
            scores = [hand_score(rng.sample(deck, h)) for _ in range(4000)]
        self.sorted = sorted(scores)
        self.n = len(scores)

    def top(self, hole) -> float:
        s = hand_score(hole)
        return (self.n - bisect.bisect_left(self.sorted, s)) / self.n


_RANKERS: dict = {}


def ranker_for(spec) -> PreflopRanker:
    key = (tuple(spec.deck_ranks), spec.hole_cards)
    r = _RANKERS.get(key)
    if r is None:
        r = _RANKERS[key] = PreflopRanker(spec)
    return r


def warm_evaluator(spec):
    """Build the evaluator tables outside the timed act() (first use can take a second)."""
    ev = get_evaluator(spec)
    h = spec.hole_cards
    deck = spec.deck
    cards = np.array([deck[:h + 5]] * 2, dtype=np.int64)
    ev.evaluate_batch(cards[:, :h], cards[:, h:])
    ev.evaluate_batch(cards[:, :h], cards[:, h:h + 4])
    ev.evaluate_batch(cards[:, :h], cards[:, h:h + 3])
    return ev


# ---- postflop --------------------------------------------------------------------------
NOTHING, WEAK_PAIR, TOP_PAIR, TWO_PAIR, STRONG, MONSTER = range(6)
_BASE = {"high_card": NOTHING, "pair": WEAK_PAIR, "two_pair": TWO_PAIR, "trips": STRONG,
         "straight": STRONG, "flush": STRONG, "full_house": MONSTER, "quads": MONSTER,
         "straight_flush": MONSTER}


def made_tier(ev, hole, board) -> int:
    """0 nothing .. 5 monster, discounting made hands that are mostly on the board."""
    score = ev.evaluate(hole, board)
    cat = ev.category(score)
    hr = [c >> 2 for c in hole]
    bc = Counter(c >> 2 for c in board)
    top_board = max(bc)
    pocket = {r for r in hr if hr.count(r) >= 2}
    hits = {r for r in hr if r in bc}
    if cat == "high_card":
        return NOTHING
    if cat == "pair":
        pr = (score >> 16) & 15
        if pr not in hits and pr not in pocket:
            return NOTHING                                   # the pair is the board's
        return TOP_PAIR if pr >= top_board else WEAK_PAIR
    if cat == "two_pair":
        if not any(n >= 2 for n in bc.values()):
            return TWO_PAIR
        mine = hits | pocket
        if not mine:
            return NOTHING
        return TOP_PAIR if max(mine) >= top_board else WEAK_PAIR
    if cat == "trips":
        tr = (score >> 16) & 15
        if bc.get(tr, 0) >= 3:
            return NOTHING
        return STRONG if bc.get(tr, 0) <= 1 else TWO_PAIR    # set > trips with a board pair
    return _BASE[cat]


def draw_strength(spec, hole, board) -> int:
    """0 none, 1 gutshot, 2 flush draw or open-ended, 3 both. 0 on the last street."""
    if not board or len(board) >= spec.total_board_dealt:
        return 0
    need_hole = spec.hole_exact if spec.hole_usage == "exactly" else 1
    fd = False
    for s in range(4):
        n_hole = sum(1 for c in hole if c & 3 == s)
        n_board = sum(1 for c in board if c & 3 == s)
        if n_hole >= need_hole and n_hole + n_board == 4 and n_board <= 3:
            fd = True
    ranks = {c >> 2 for c in hole} | {c >> 2 for c in board}
    hole_r = {c >> 2 for c in hole}
    lo = min(spec.deck_ranks) - 1                    # the ace also plays below the lowest rank
    if 12 in ranks:
        ranks.add(lo)
        if 12 in hole_r:
            hole_r.add(lo)
    windows = 0
    for start in range(lo, 9):
        w = set(range(start, start + 5))
        have = w & ranks
        if len(have) == 4 and have & hole_r:
            windows += 1
    sd = 2 if windows >= 2 else windows
    if fd and sd:
        return 3
    return 2 if fd else sd


# ---- the betting situation ------------------------------------------------------------
@dataclass
class Situation:
    bb: int
    to_call: int
    cur: int                 # highest bet on this street
    pot: int
    opps: int                # opponents still in the hand (incl. all-in)
    behind: int              # opponents who still act after me this street
    after_static: int        # dealt seats acting after me preflop (position, ignores folds)
    is_blind: bool
    raises: int              # raises this street (posts excluded)
    limpers: int             # preflop calls before the first raise
    last_raiser: int         # seat of the last raise this street (-1 = none)
    pf_raiser: int           # seat of the last preflop raise (-1 = none)
    my_bb: float             # my chips (stack + street bet) in big blinds
    eff_bb: float            # effective stack vs the biggest other contender
    facing_allin: bool

    @property
    def price(self) -> float:   # pot odds needed to call
        return self.to_call / (self.pot + self.to_call) if self.to_call else 0.0

    @property
    def position(self) -> str:
        if self.is_blind:
            return "blind"
        if self.after_static <= 3:
            return "late"
        return "middle" if self.after_static <= 5 else "early"


def acting_order(obs) -> list:
    """Dealt seats in this street's acting order (preflop: UTG .. big blind)."""
    n = len(obs.seats)
    start = (obs.bb_seat + 1) if obs.street == 0 else (obs.button + 1)
    return [(start + k) % n for k in range(n) if obs.seats[(start + k) % n].in_hand]


def situation(obs) -> Situation:
    lg = obs.legal
    bb = max(1, obs.big_blind)
    seats = obs.seats
    me = obs.seat
    cur = max(s.bet for s in seats)
    contenders = [s for s in seats if s.in_hand and not s.folded and s.seat != me]
    order = acting_order(obs)
    idx = order.index(me) if me in order else 0
    behind = sum(1 for j in order[idx + 1:] if not seats[j].folded and not seats[j].all_in)
    raises = limpers = 0
    last_raiser = pf_raiser = -1
    for seat, street, kind, _amt in obs.history:
        if kind == "raise":
            if street == 0:
                pf_raiser = seat
            if street == obs.street:
                raises += 1
                last_raiser = seat
        elif kind == "call" and street == 0 and pf_raiser < 0:
            limpers += 1
    mine = obs.my_stack + obs.my_bet
    other = max((s.stack + s.bet for s in contenders), default=0)
    facing_allin = any(s.all_in and s.bet > obs.my_bet for s in contenders) or \
        (lg.call_amount > 0 and lg.call_amount >= obs.my_stack)
    return Situation(bb=bb, to_call=lg.call_amount, cur=cur, pot=obs.pot, opps=len(contenders),
                     behind=behind, after_static=len(order) - 1 - idx,
                     is_blind=me in (obs.sb_seat, obs.bb_seat) and len(order) > 2,
                     raises=raises, limpers=limpers, last_raiser=last_raiser, pf_raiser=pf_raiser,
                     my_bb=mine / bb, eff_bb=min(mine, other) / bb,
                     facing_allin=facing_allin)


# ---- actions (legal by construction) --------------------------------------------------
def fold(obs):
    return obs.legal.passive() if obs.legal.can_check else Fold()


def passive(obs):
    return obs.legal.passive()


def raise_to(obs, amount, commit_frac=0.45):
    """Raise to `amount` (clamped to the legal range); if that would leave less than
    `commit_frac` of the stack behind, just go all-in. No raise allowed -> call/check."""
    lg = obs.legal
    if not lg.can_raise:
        return lg.passive()
    amt = lg.clamp(amount)
    total = obs.my_stack + obs.my_bet
    if total - amt < commit_frac * total:
        amt = lg.max_raise_to
    return RaiseTo(amt)


def bet_pot(obs, frac, commit_frac=0.45):
    """Bet / raise `frac` of the pot (after calling)."""
    cur = max(s.bet for s in obs.seats)
    to_call = cur - obs.my_bet
    return raise_to(obs, cur + frac * (obs.pot + to_call), commit_frac)


def shove(obs):
    lg = obs.legal
    return RaiseTo(lg.max_raise_to) if lg.can_raise else lg.passive()


def open_size(obs, sit, bbs, per_limper=1.0):
    """Preflop open / iso-raise to `bbs` big blinds plus `per_limper` per limper."""
    return raise_to(obs, sit.bb * (bbs + per_limper * sit.limpers))


def reraise(obs, sit, mult):
    """Re-raise to `mult` times the current bet."""
    return raise_to(obs, sit.cur * mult)


class FieldBot:
    """Base class: the SngBot protocol plus cached spec helpers."""
    name = "field"

    def new_table(self, rules, seat, seed=0):
        self.rules, self.spec, self.seat = rules, rules.spec, seat
        self.rng = random.Random(seed)
        self.ev = warm_evaluator(self.spec)
        self.ranker = ranker_for(self.spec)
        self.reset()

    def reset(self):
        pass

    def act(self, obs):
        sit = situation(obs)
        if obs.street == 0:
            return self.preflop(obs, sit, self.ranker.top(obs.hole))
        tier = made_tier(self.ev, obs.hole, obs.board)
        return self.postflop(obs, sit, tier, draw_strength(self.spec, obs.hole, obs.board))

    def preflop(self, obs, sit, top):
        return passive(obs)

    def postflop(self, obs, sit, tier, draw):
        return passive(obs)

    def end_hand(self, info):
        pass
