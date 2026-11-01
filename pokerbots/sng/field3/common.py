"""Shared plumbing for the field-3 bots: discard phases, legality, a parsed view of
the decision ("Spot"), opponent statistics and the base class."""
from __future__ import annotations

import random

import numpy as np

from engine.evaluator import get_evaluator
from engine.game import CALL, CHECK, FOLD, RAISE, Action, Call, Check, Discard, Fold, RaiseTo

from .preflop import get_preflop


# ---- discard phases (engine extension) ------------------------------------------------
def discard_action(obs):
    """If the engine asks for a discard, throw the lowest-ranked cards; else None."""
    k = int(getattr(obs.legal, "discard_count", 0) or 0)
    if k <= 0:
        return None
    hole = sorted(obs.hole, key=lambda c: (c >> 2, c & 3))
    return Discard(hole[:k])


def sanitize(a, lg):
    """Turn any intended action into a legal one (raises clamped, impossible raises
    become a check/call, folds become checks when checking is free)."""
    if not isinstance(a, Action):
        return lg.passive()
    if a.kind == RAISE:
        if not lg.can_raise:
            return lg.passive()
        return RaiseTo(lg.clamp(a.amount))
    if a.kind == FOLD:
        return Check() if lg.can_check else Fold()
    if a.kind == CHECK and not lg.can_check:
        return Fold()
    if a.kind == CALL and not lg.can_call:
        return Check()
    return a if lg.is_legal(a) else lg.passive()


# ---- the decision, parsed -----------------------------------------------------------
def _cyclic_from(start, seats, n):
    return [(start + k) % n for k in range(1, n + 1) if (start + k) % n in seats]


class Spot:
    """Commonly needed facts about a decision, computed once."""

    def __init__(self, obs):
        lg = obs.legal
        seats = obs.seats
        n = len(seats)
        me = obs.seat
        self.n = n
        self.me = me
        self.street = obs.street
        self.bb = max(1, obs.big_blind)
        self.pot = obs.pot
        self.to_call = lg.call_amount if lg.can_call else 0
        self.my_stack = obs.my_stack
        self.my_total = obs.my_stack + obs.my_bet
        in_hand = {s.seat for s in seats if s.in_hand}
        self.active = [s.seat for s in seats if s.in_hand and not s.folded]
        self.opps = [j for j in self.active if j != me]
        self.n_opp = len(self.opps)
        self.opp_max = max((seats[j].stack + seats[j].bet for j in self.opps), default=0)
        self.eff = min(self.my_total, self.opp_max)
        self.eff_bb = self.eff / self.bb
        self.stack_bb = self.my_total / self.bb
        if obs.street == 0:
            order = _cyclic_from(obs.bb_seat, in_hand, n)
        else:
            order = _cyclic_from(obs.button, in_hand, n)
        self.order = order
        i = order.index(me) if me in order else 0
        self.behind = [j for j in order[i + 1:] if not seats[j].folded and seats[j].stack > 0]
        self.n_behind = len(self.behind)
        self.in_position = self.n_behind == 0
        self.blinds_behind = [j for j in self.behind if j in (obs.sb_seat, obs.bb_seat)]
        cur = [h for h in obs.history if h[1] == obs.street and h[2] != "post"]
        raises = [h for h in cur if h[2] == "raise"]
        self.n_raises = len(raises)
        self.unopened = not raises
        self.limpers = sum(1 for h in cur if h[2] == "call") if not raises else 0
        self.last_raiser = raises[-1][0] if raises else None
        self.last_raise_to = raises[-1][3] if raises else 0
        self.callers_after_raise = 0
        if raises:
            k = cur.index(raises[-1])
            self.callers_after_raise = sum(1 for h in cur[k + 1:] if h[2] == "call")
        pre = [h for h in obs.history if h[1] == 0 and h[2] == "raise"]
        self.pf_aggressor = pre[-1][0] if pre else None
        self.i_was_pf_aggressor = self.pf_aggressor == me
        lr = self.last_raiser
        self.facing_allin = bool(self.to_call > 0 and lr is not None and seats[lr].stack == 0)
        self.pot_odds = self.to_call / (self.pot + self.to_call) if self.to_call > 0 else 0.0
        self.spr = (self.my_stack / max(1, self.pot))
        self.players_left = obs.players_left


def raise_to_pot_frac(obs, frac: float) -> int:
    """Raise-to amount for 'call, then bet frac of the pot'."""
    lg = obs.legal
    call = lg.call_amount if lg.can_call else 0
    cur = obs.my_bet + call                      # the current highest bet on this street
    return int(cur + frac * (obs.pot + call))


def allin(obs) -> Action:
    return RaiseTo(obs.legal.max_raise_to) if obs.legal.can_raise else obs.legal.passive()


# ---- opponent statistics ------------------------------------------------------------
class OppStats:
    """Per-seat counts from hand histories (state resets per table)."""

    def __init__(self, rules, me):
        n = rules.num_players
        self.rules = rules
        self.me = me
        self.prev = [rules.starting_stack] * n
        z = lambda: [0] * n  # noqa: E731
        self.hands = z()
        self.vpip = z()
        self.pfr = z()
        self.open_opp = z()
        self.opens = z()
        self.shoves = z()
        self.faced = z()        # first preflop action came facing a raise
        self.faced_fold = z()
        self.faced_call = z()
        self.faced_shove = z()  # faced an all-in preflop
        self.call_shove = z()
        self.post_aggr = z()
        self.post_pass = z()
        self.post_fold = z()
        self.timeouts_like = z()  # folded when checking would have been free (impossible) / folds BB walk
        self.shown_pct = [[] for _ in range(n)]  # percentile of hands shown after a preflop shove

    def update(self, info, pf=None):
        hist = info["history"]
        start = self.prev
        n = len(start)
        hn = info["hand_number"]
        _, _, ante = self.rules.blinds_for(hn)
        for j in range(n):
            if start[j] > 0:
                self.hands[j] += 1
        raised = False
        allin_open = False
        first = {}
        shover = set()
        vp, pr = set(), set()
        for (s, st, k, a) in hist:
            if k == "post":
                continue
            if st != 0:
                if k == "raise":
                    self.post_aggr[s] += 1
                elif k in ("call", "check"):
                    self.post_pass[s] += 1
                elif k == "fold":
                    self.post_fold[s] += 1
                continue
            if s not in first:
                first[s] = k
                if not raised:
                    self.open_opp[s] += 1
                    if k == "raise":
                        self.opens[s] += 1
                else:
                    self.faced[s] += 1
                    if k == "fold":
                        self.faced_fold[s] += 1
                    elif k == "call":
                        self.faced_call[s] += 1
            if allin_open and s not in shover:
                self.faced_shove[s] += 1
                if k in ("call", "raise"):
                    self.call_shove[s] += 1
            if k in ("call", "raise"):
                vp.add(s)
            if k == "raise":
                pr.add(s)
                raised = True
                if a + ante >= start[s]:
                    shover.add(s)
                    if not allin_open:
                        self.shoves[s] += 1
                    allin_open = True
        for s in vp:
            self.vpip[s] += 1
        for s in pr:
            self.pfr[s] += 1
        sd = info.get("showdown")
        if sd and pf is not None:
            for s in shover:
                if s in sd and len(sd[s]) == 2:
                    try:
                        self.shown_pct[s].append(pf.pct(sd[s]))
                    except Exception:  # noqa: BLE001
                        pass
        self.prev = list(info["stacks"])

    @staticmethod
    def rate(num, den, prior, w=4.0):
        return (num + prior * w) / (den + w)

    def vpip_rate(self, j):
        return self.rate(self.vpip[j], self.hands[j], 0.3)

    def open_rate(self, j):
        return self.rate(self.opens[j], self.open_opp[j], 0.2)

    def shove_rate(self, j):
        return self.rate(self.shoves[j], self.open_opp[j], 0.08)

    def fold_to_raise(self, j):
        return self.rate(self.faced_fold[j], self.faced[j], 0.6)

    def call_shove_rate(self, j):
        return self.rate(self.call_shove[j], self.faced_shove[j], 0.15)

    def aggression(self, j):
        return self.rate(self.post_aggr[j], self.post_aggr[j] + self.post_pass[j], 0.35)


# ---- base class ---------------------------------------------------------------------
class F3Bot:
    name = "f3_base"

    def new_table(self, rules, seat, seed=0):
        self.rules = rules
        self.spec = rules.spec
        self.seat = seat
        self.rng = random.Random(seed)
        self.nrng = np.random.default_rng(seed)
        self.ev = get_evaluator(self.spec)
        self.pf = get_preflop(self.spec)
        h = self.spec.hole_cards
        warm = list(self.spec.deck[:h + 5])
        self.ev.evaluate(warm[:h], warm[h:h + 3])       # warm the evaluator tables (untimed here)
        self.ev.evaluate(warm[:h], warm[h:h + 5])
        self.setup()

    def setup(self):
        pass

    def act(self, obs):
        d = discard_action(obs)
        if d is not None:
            return d
        return sanitize(self.decide(obs), obs.legal)

    def decide(self, obs):
        return obs.legal.passive()
