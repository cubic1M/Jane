"""Shared plumbing for the field10 bots: the kind of helper file a team writes in the first
hour (Chen formula, a hand-percentile table, a made-hand / draw classifier, a range parser,
a decision context read from the observation, and a wrapper that turns whatever the
strategy returns into a legal action).

Everything here is pure Python and cheap (a decision is tens of microseconds); only the
Monte Carlo bot calls the numpy evaluator.
"""
from __future__ import annotations

import math
import random
from itertools import combinations

from engine.game import CALL, CHECK, DISCARD, FOLD, RAISE, Action, Call, Check, Discard, Fold, RaiseTo

# ---------------------------------------------------------------------------- preflop
_HIGH = {12: 10.0, 11: 8.0, 10: 7.0, 9: 6.0}


def chen_raw(c1: int, c2: int) -> float:
    """Bill Chen's formula, unrounded. Ace is always high (A2 counts as an 11-gap)."""
    r1, r2 = c1 >> 2, c2 >> 2
    hi, lo = (r1, r2) if r1 >= r2 else (r2, r1)
    s = _HIGH.get(hi, (hi + 2) / 2.0)
    if hi == lo:
        return max(5.0, 2 * s)
    if (c1 & 3) == (c2 & 3):
        s += 2
    gap = hi - lo - 1
    s -= (0, 1, 2, 4)[gap] if gap < 4 else 5
    if gap <= 1 and hi < 10:
        s += 1
    return s


def chen(c1: int, c2: int) -> int:
    return int(math.ceil(chen_raw(c1, c2)))


def best_pair(hole):
    """The best two-card sub-hand of a hand with more than two hole cards (by Chen)."""
    if len(hole) <= 2:
        return tuple(hole)
    return max(combinations(hole, 2), key=lambda p: chen_raw(*p))


def hand_key(c1: int, c2: int):
    r1, r2 = c1 >> 2, c2 >> 2
    if r1 < r2:
        r1, r2 = r2, r1
    return r1, r2, r1 != r2 and (c1 & 3) == (c2 & 3)


def _build_pct():
    """Percentile of each 169 class among the 1326 hold'em combos, ordered by Chen with high
    cards as tie-breaks (0 = best hand)."""
    deck = [(r << 2) | s for r in range(13) for s in range(4)]
    combos = {}
    for a, b in combinations(deck, 2):
        k = hand_key(a, b)
        if k not in combos:
            combos[k] = [chen_raw(a, b) + 0.02 * k[0] + 0.002 * k[1], 0]
        combos[k][1] += 1
    order = sorted(combos.items(), key=lambda kv: -kv[1][0])
    out, seen = {}, 0
    for k, (_, n) in order:
        out[k] = (seen + n / 2) / 1326.0
        seen += n
    return out


PCT = _build_pct()


def pre_pct(hole) -> float:
    """Hand percentile (0 = best). More than two hole cards: the best pair, flattered a bit
    (nobody had time to build an Omaha chart)."""
    if len(hole) < 2:
        return 1.0
    if len(hole) == 2:
        return PCT[hand_key(*hole)]
    return 0.75 * min(PCT[hand_key(a, b)] for a, b in combinations(hole, 2))


RANKS = "23456789TJQKA"


def parse_range(text: str) -> set:
    """'77+, A9s+, KTo+, QJs, T9s, K9+' -> {(hi, lo, suited)}; pairs have suited False."""
    out = set()
    for tok in text.replace(" ", "").split(","):
        if not tok:
            continue
        plus = tok.endswith("+")
        t = tok.rstrip("+")
        hi = RANKS.index(t[0])
        lo = RANKS.index(t[1])
        kind = t[2] if len(t) > 2 else ""
        if hi == lo:
            for r in range(hi, 13 if plus else hi + 1):
                out.add((r, r, False))
            continue
        suits = (True,) if kind == "s" else (False,) if kind == "o" else (True, False)
        for r in range(lo, hi if plus else lo + 1):
            for s in suits:
                out.add((hi, r, s))
    return out


def in_range(hole, rng_set) -> bool:
    if len(hole) == 2:
        return hand_key(*hole) in rng_set
    return any(hand_key(a, b) in rng_set for a, b in combinations(hole, 2))


# --------------------------------------------------------------------------- postflop
AIR, BOARD, WEAK, MID, TOP, OVER, TWO, TRIPS, STRAIGHT, FLUSH, BOAT = range(11)
MADE_NAMES = ("air", "board", "weak", "mid", "top", "over", "two", "trips", "straight", "flush", "boat")
NO_DRAW, GUTSHOT, DRAW, COMBO = range(4)

_WINDOWS = [sum(1 << r for r in range(lo, lo + 5)) for lo in range(9)] + [(1 << 12) | 0b1111]


def _straight(mask: int) -> bool:
    for w in _WINDOWS:
        if mask & w == w:
            return True
    return False


def classify(hole, board, can_draw=True):
    """(made, draw) of a hold'em-style hand: best five of any hole + board cards. Standard
    ranking only (short-deck / hi-lo rules are ignored, like most teams would)."""
    if not board:
        return AIR, NO_DRAW
    rc = [0] * 13
    sc = [0] * 4
    bc = [0] * 13
    bs = [0] * 4
    for c in board:
        bc[c >> 2] += 1
        bs[c & 3] += 1
        rc[c >> 2] += 1
        sc[c & 3] += 1
    hr = set()
    hs = set()
    for c in hole:
        rc[c >> 2] += 1
        sc[c & 3] += 1
        hr.add(c >> 2)
        hs.add(c & 3)
    mask = 0
    bmask = 0
    for r in range(13):
        if rc[r]:
            mask |= 1 << r
        if bc[r]:
            bmask |= 1 << r
    trips = [r for r in hr if rc[r] >= 3]
    pairs_h = sorted((r for r in hr if rc[r] >= 2), reverse=True)
    quads = any(rc[r] >= 4 for r in hr)
    board_has_boat = any(x >= 3 for x in bc) and sum(1 for x in bc if x >= 2) >= 2
    if quads or (trips and sum(1 for r in range(13) if rc[r] >= 2) >= 2 and not board_has_boat):
        return BOAT, NO_DRAW
    flush_suit = next((s for s in range(4) if sc[s] >= 5 and s in hs), -1)
    if flush_suit >= 0 and bs[flush_suit] < 5:
        return FLUSH, NO_DRAW
    if _straight(mask) and not _straight(bmask):
        made = STRAIGHT
    elif trips:
        made = TRIPS
    elif len(pairs_h) >= 2:
        made = TWO
    elif pairs_h:
        r = pairs_h[0]
        branks = sorted({c >> 2 for c in board}, reverse=True)
        pocket = sum(1 for c in hole if c >> 2 == r) >= 2 and bc[r] == 0
        if pocket:
            made = OVER if r > branks[0] else MID if len(branks) > 1 and r > branks[1] else WEAK
        else:
            made = TOP if r == branks[0] else MID if len(branks) > 1 and r == branks[1] else WEAK
    elif any(x >= 2 for x in bc):
        made = BOARD
    else:
        made = AIR
    draw = NO_DRAW
    if can_draw and made < STRAIGHT:
        fd = any(sc[s] == 4 and s in hs for s in range(4))
        outs4 = 0
        for w in _WINDOWS:
            hit = mask & w
            if bin(hit).count("1") == 4 and any((1 << r) & w for r in hr) and (bmask & w) != hit:
                outs4 += 1
        sd = DRAW if outs4 >= 2 else GUTSHOT if outs4 == 1 else NO_DRAW
        draw = COMBO if fd and sd else DRAW if fd else sd
    return made, draw


def raw_category(hole, board) -> int:
    """Count-based category of ALL cards, board included (0 high card, 1 pair, 2 two pair,
    3 trips, 4 straight, 5 flush, 6 full house+). A board pair counts as 'my' pair."""
    rc = [0] * 13
    sc = [0] * 4
    mask = 0
    for c in tuple(hole) + tuple(board):
        rc[c >> 2] += 1
        sc[c & 3] += 1
        mask |= 1 << (c >> 2)
    m = sorted(rc, reverse=True)
    if m[0] >= 4 or (m[0] >= 3 and m[1] >= 2):
        return 6
    if max(sc) >= 5:
        return 5
    if _straight(mask):
        return 4
    if m[0] >= 3:
        return 3
    if m[0] >= 2 and m[1] >= 2:
        return 2
    return 1 if m[0] >= 2 else 0


# ---------------------------------------------------------------------------- context
class Ctx:
    """Everything a strategy needs, read once from the observation."""

    def __init__(self, obs):
        lg = obs.legal
        self.obs = obs
        self.lg = lg
        self.street = obs.street
        self.hole = obs.hole
        self.board = obs.board
        self.bb = max(1, obs.big_blind)
        self.to_call = lg.call_amount
        self.pot = obs.pot
        self.stack = obs.my_stack
        self.my_bet = obs.my_bet
        self.S = (obs.my_stack + obs.my_bet) / self.bb
        seats = obs.seats
        n = len(seats)
        me = obs.seat
        self.others = [s for s in seats if s.seat != me and s.in_hand and not s.folded]
        self.n_active = len(self.others) + 1
        self.n_dealt = sum(1 for s in seats if s.in_hand)
        biggest = max((s.stack + s.bet for s in self.others), default=0)
        self.eff = min(obs.my_stack + obs.my_bet, biggest) / self.bb
        self.cur_bet = max((s.bet for s in seats), default=0)
        self.facing_allin = self.to_call > 0 and (
            self.to_call >= obs.my_stack or any(s.all_in and s.bet >= self.cur_bet for s in self.others))
        # history
        pre_raises = limpers = street_raises = street_calls = 0
        pfr = None
        last_aggr = None
        for item in obs.history:
            seat, st, kind = item[0], item[1], item[2]
            if st == 0:
                if kind == "raise":
                    pre_raises += 1
                    pfr = seat
                elif kind == "call" and pre_raises == 0:
                    limpers += 1
            if st == obs.street:
                if kind == "raise":
                    street_raises += 1
                    last_aggr = seat
                elif kind == "call":
                    street_calls += 1
        self.pre_raises = pre_raises
        self.limpers = limpers
        self.pfr = pfr
        self.i_am_pfr = pfr == me
        self.street_raises = street_raises
        self.street_calls = street_calls
        self.last_aggr = last_aggr
        # positions: in-hand seats clockwise from the seat after the button (SB first, button last)
        order = []
        for k in range(1, n + 1):
            s = (obs.button + k) % n
            if seats[s].in_hand:
                order.append(s)
        self.order = order
        if len(order) > 2:
            pre_order = order[2:] + order[:2]
        else:
            pre_order = [obs.sb_seat, obs.bb_seat]
        self.pre_order = pre_order
        idx = pre_order.index(me) if me in pre_order else 0
        self.behind = sum(1 for s in pre_order[idx + 1:] if not seats[s].folded)
        self.dist_btn = (len(order) - 1 - order.index(me)) if me in order else 0
        if me == obs.bb_seat:
            self.pos = "bb"
        elif me == obs.sb_seat and len(order) > 2:
            self.pos = "sb"
        elif self.dist_btn == 0:
            self.pos = "btn"
        elif self.dist_btn == 1:
            self.pos = "co"
        elif self.dist_btn <= 3:
            self.pos = "mp"
        else:
            self.pos = "ep"
        my_i = order.index(me) if me in order else 0
        self.ip = all(order.index(s.seat) < my_i for s in self.others if s.seat in order and not s.all_in)

    # --- helpers ---------------------------------------------------------------
    @property
    def unopened(self) -> bool:
        return self.pre_raises == 0

    def pot_odds(self) -> float:
        return self.to_call / (self.pot + self.to_call) if self.to_call > 0 else 0.0

    def pot_bet(self, frac: float) -> int:
        """Raise-to for a bet of frac x the pot after calling."""
        return int(self.my_bet + self.to_call + frac * (self.pot + self.to_call))

    def shove(self) -> Action:
        return RaiseTo(self.lg.max_raise_to) if self.lg.can_raise else self.lg.passive()

    def raise_to(self, amount) -> Action:
        return RaiseTo(self.lg.clamp(amount)) if self.lg.can_raise else self.lg.passive()

    def check_fold(self) -> Action:
        return Check() if self.lg.can_check else Fold()

    def check_call(self) -> Action:
        return self.lg.passive()


# ------------------------------------------------------------------------ legal output
def lowest(hole, k):
    return tuple(sorted(hole, key=lambda c: (c >> 2, c & 3))[:k])


def legalize(a, obs) -> Action:
    """Whatever the strategy said -> a legal action (clamped raise, check<->fold/call)."""
    lg = obs.legal
    if lg.discard_count:
        if isinstance(a, Action) and a.kind == DISCARD:
            cards = tuple(a.cards)
            if (len(set(cards)) == len(cards) and set(cards) <= set(obs.hole)
                    and lg.discard_min <= len(cards) <= lg.discard_count):
                return a
        return Discard(lowest(obs.hole, lg.discard_min))
    if not isinstance(a, Action):
        return Check() if lg.can_check else Fold()
    k = a.kind
    if k == RAISE:
        if lg.can_raise:
            return RaiseTo(lg.clamp(a.amount))
        return lg.passive()
    if k == CALL:
        return Call() if lg.can_call else Check()
    if k == CHECK:
        return Check() if lg.can_check else Fold()
    if k == FOLD:
        return Check() if lg.can_check else Fold()
    return Check() if lg.can_check else Fold()


def simple_discard(obs) -> Action:
    """Keep pairs, suited cards and high cards; dump the rest. For a variable draw, also throw
    away unpaired cards below a ten (up to the maximum)."""
    lg = obs.legal
    hole = list(obs.hole)
    board = list(obs.board)
    rc = [0] * 13
    sc = [0] * 4
    for c in hole + board:
        rc[c >> 2] += 1
        sc[c & 3] += 1

    def val(c):
        return (c >> 2) + 8 * (rc[c >> 2] - 1) + (3 if sc[c & 3] >= 3 else 0)

    order = sorted(hole, key=lambda c: (val(c), c))
    k = lg.discard_min
    extra = [c for c in order[k:lg.discard_count] if rc[c >> 2] == 1 and (c >> 2) < 8]
    return Discard(order[:k] + extra[:lg.discard_count - k])


class Bot10:
    """Base: per-table random.Random(seed), safe act(), end_hand hook, discard policy."""

    name = "f10_base"
    handles_discards = True

    def __init__(self, **kw):
        self.opts = kw

    def new_table(self, rules, seat, seed=0):
        self.rules = rules
        self.spec = rules.spec
        self.seat = seat
        self.rng = random.Random(seed)
        self.setup()

    def setup(self):
        pass

    def end_hand(self, info):
        try:
            if info:
                self.observe_hand(info)
        except Exception:  # noqa: BLE001
            pass

    def observe_hand(self, info):
        pass

    def discard(self, obs):
        return simple_discard(obs)

    def decide(self, c: Ctx) -> Action:
        return c.check_call()

    def act(self, obs):
        try:
            if obs.legal.discard_count:
                a = self.discard(obs)
            else:
                a = self.decide(Ctx(obs))
        except Exception:  # noqa: BLE001  - a team bot's try/except around everything
            a = None
        try:
            return legalize(a, obs)
        except Exception:  # noqa: BLE001
            lg = obs.legal
            if lg.discard_count:
                return Discard(lowest(obs.hole, lg.discard_min))
            return Check() if lg.can_check else Fold()
