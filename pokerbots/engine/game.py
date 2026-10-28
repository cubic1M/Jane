"""Actions, observations and the single-hand state machine.

FROZEN INTERFACE (bots depend on it):
  * Action(kind, amount=0, cards=()) with kind in fold/check/call/raise/discard.
    For 'raise', amount is the total this player will have committed ON THIS
    STREET after the raise ("raise to"), as in most pokerbot engines.
    For 'discard', cards is a tuple of card ints taken from obs.my_cards.
  * Observation: what one player may see at a decision point.
  * Positions: 0 = small blind / button (acts first preflop, last postflop),
    1 = big blind.
An illegal action is treated as a fold.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable, Optional

import numpy as np

from .evaluator import get_evaluator
from .spec import GameSpec

FOLD, CHECK, CALL, RAISE, DISCARD = "fold", "check", "call", "raise", "discard"


@dataclass(frozen=True)
class Action:
    kind: str
    amount: int = 0
    cards: tuple = ()

    def __str__(self):
        if self.kind == RAISE:
            return f"raise {self.amount}"
        if self.kind == DISCARD:
            from .cards import cards_str
            return f"discard {cards_str(self.cards)}"
        return self.kind


def Fold() -> Action:
    return Action(FOLD)


def Check() -> Action:
    return Action(CHECK)


def Call() -> Action:
    return Action(CALL)


def RaiseTo(amount: int) -> Action:
    return Action(RAISE, int(amount))


def Discard(cards) -> Action:
    return Action(DISCARD, 0, tuple(int(c) for c in cards))


@dataclass(frozen=True)
class LegalActions:
    can_fold: bool = False
    can_check: bool = False
    can_call: bool = False
    call_amount: int = 0          # chips needed to call (0 if check)
    can_raise: bool = False
    min_raise_to: int = 0
    max_raise_to: int = 0
    discard_count: int = 0        # > 0 only in a discard phase

    def clamp_raise(self, amount: float) -> int:
        """Round and clamp a desired raise-to amount into the legal range."""
        return int(min(self.max_raise_to, max(self.min_raise_to, int(round(amount)))))

    def passive(self) -> Action:
        """Check if possible, else call (never folds when checking is free)."""
        return Check() if self.can_check else Call()

    def is_legal(self, a: Action, my_cards=()) -> bool:
        if not isinstance(a, Action):
            return False
        if self.discard_count:
            return (a.kind == DISCARD and len(a.cards) == self.discard_count
                    and len(set(a.cards)) == len(a.cards)
                    and all(c in my_cards for c in a.cards))
        if a.kind == FOLD:
            return self.can_fold
        if a.kind == CHECK:
            return self.can_check
        if a.kind == CALL:
            return self.can_call
        if a.kind == RAISE:
            return (self.can_raise and isinstance(a.amount, (int, np.integer))
                    and self.min_raise_to <= a.amount <= self.max_raise_to)
        return False


@dataclass(frozen=True)
class ActionRecord:
    position: int
    street: int
    kind: str
    amount: int = 0          # raise-to for raises, chips added for calls
    cards: tuple = ()        # discards visible to the observer (face-up or own)


@dataclass(frozen=True)
class Observation:
    hand_index: int            # 0-based index in the match
    hands_in_match: int
    position: int              # 0 = SB/button, 1 = BB
    street: int                # 0 = preflop, 1 = flop, 2 = turn, 3 = river (spec-dependent)
    phase: str                 # 'bet' or 'discard'
    my_cards: tuple
    board: tuple               # shared cards incl. face-up discards sent to the board
    my_discards: tuple         # my discarded cards so far (wherever they went)
    opp_discards: tuple        # opponent's discards I can see (face up)
    opp_num_cards: int         # how many hole cards the opponent holds now
    pot: int                   # all chips committed by both players this hand
    my_pip: int                # committed by me on this street
    opp_pip: int
    my_stack: int              # chips behind
    opp_stack: int
    my_committed: int          # total committed this hand
    opp_committed: int
    legal: LegalActions
    history: tuple             # ActionRecord, this hand, observer view
    board_cards_to_come: int   # future dealt board cards
    my_discards_left: int      # future discards (cards) for me, incl. a pending one
    opp_discards_left: int
    bankroll: int              # my cumulative chips in this match before this hand
    time_left: Optional[float] # match clock remaining (s), None if unlimited
    big_blind: int


@dataclass
class HandResult:
    position: int
    delta: int                 # my chips won (+) or lost (-)
    showdown: bool
    my_cards: tuple
    opp_cards: Optional[tuple] # revealed at showdown only
    board: tuple
    history: tuple
    folded_by: Optional[int]   # position that folded, if any


# A decision function: (position, observation) -> Action (already validated by caller)
DecideFn = Callable[[int, Observation], Action]


class HandState:
    """Runs one hand. Deals by position from the given deck order."""

    def __init__(self, spec: GameSpec, deck_order, stacks=None, hand_index=0,
                 bankrolls=(0, 0), time_left=(None, None)):
        self.spec = spec
        self.ev = get_evaluator(spec)
        d = [int(c) for c in deck_order]
        h = spec.hole_cards
        self.hole = [d[0:h], d[h:2 * h]]
        self.deck_rest = d[2 * h:]
        self.board: list[int] = []
        self.discards: list[list[int]] = [[], []]
        self.start_stacks = list(stacks) if stacks else [spec.starting_stack] * 2
        self.stacks = list(self.start_stacks)
        self.committed = [0, 0]
        self.pips = [0, 0]
        self.street = 0
        self.history: list[tuple] = []  # (pos, street, kind, amount, cards, face_up)
        self.folded: Optional[int] = None
        self.hand_index = hand_index
        self.bankrolls = bankrolls
        self.time_left = list(time_left)
        self.done = False
        self.deltas = [0, 0]
        self.showdown = False

    # ---- helpers -------------------------------------------------------------------
    def _put(self, p: int, amount: int) -> int:
        amount = min(amount, self.stacks[p])
        self.stacks[p] -= amount
        self.pips[p] += amount
        self.committed[p] += amount
        return amount

    def _future_discards(self, p: int, street: int, include_current: bool) -> int:
        n = 0
        for d in self.spec.discards:
            if d.street > street or (include_current and d.street == street):
                n += d.count
        return n

    def _board_to_come(self) -> int:
        return sum(self.spec.board_cards_per_street[self.street + 1:])

    def legal(self, p: int, last_raise: int) -> LegalActions:
        o = 1 - p
        bb = self.spec.big_blind
        max_pip = max(self.pips)
        call_amt = min(max_pip - self.pips[p], self.stacks[p])
        can_raise = self.stacks[p] > call_amt and self.stacks[o] > 0
        lo = hi = 0
        if can_raise:
            hi = min(self.pips[p] + self.stacks[p], self.pips[o] + self.stacks[o])
            if self.spec.betting == "pot_limit":
                pot_after_call = sum(self.committed) + call_amt
                hi = min(hi, max_pip + pot_after_call)
            lo = min(max_pip + max(last_raise, bb), hi)
            if hi <= max_pip:
                can_raise = False
                lo = hi = 0
        return LegalActions(can_fold=True, can_check=call_amt == 0, can_call=call_amt > 0,
                            call_amount=call_amt, can_raise=can_raise,
                            min_raise_to=lo, max_raise_to=hi)

    def observe(self, p: int, phase: str, legal: LegalActions) -> Observation:
        o = 1 - p
        hist = []
        for (pos, st, kind, amt, cards, face_up) in self.history:
            vis = cards if (pos == p or face_up) else ()
            hist.append(ActionRecord(pos, st, kind, amt, tuple(vis)))
        opp_vis = []
        for (pos, st, kind, amt, cards, face_up) in self.history:
            if pos == o and kind == DISCARD and face_up:
                opp_vis.extend(cards)
        pending = phase == "discard"
        return Observation(
            hand_index=self.hand_index, hands_in_match=self.spec.hands_per_match,
            position=p, street=self.street, phase=phase,
            my_cards=tuple(self.hole[p]), board=tuple(self.board),
            my_discards=tuple(self.discards[p]), opp_discards=tuple(opp_vis),
            opp_num_cards=len(self.hole[o]), pot=sum(self.committed),
            my_pip=self.pips[p], opp_pip=self.pips[o],
            my_stack=self.stacks[p], opp_stack=self.stacks[o],
            my_committed=self.committed[p], opp_committed=self.committed[o],
            legal=legal, history=tuple(hist),
            board_cards_to_come=self._board_to_come(),
            my_discards_left=self._future_discards(p, self.street, pending and self._pending_discard[p]),
            opp_discards_left=self._future_discards(o, self.street, pending and self._pending_discard[o]),
            bankroll=self.bankrolls[p], time_left=self.time_left[p],
            big_blind=self.spec.big_blind)

    # ---- the hand --------------------------------------------------------------------
    def play(self, decide: DecideFn) -> list[int]:
        spec = self.spec
        self._pending_discard = [False, False]
        # antes and blinds
        if spec.ante:
            for p in (0, 1):
                self._put(p, spec.ante)
                self.pips[p] = 0
        self._put(0, spec.small_blind)
        self._put(1, spec.big_blind)
        for street in range(spec.num_streets):
            self.street = street
            if street > 0:
                self.pips = [0, 0]
            n = spec.board_cards_per_street[street]
            self.board.extend(self.deck_rest[:n])
            self.deck_rest = self.deck_rest[n:]
            for rule in spec.discards_on_street(street):
                order = (1, 0) if rule.order == "oop_first" else (0, 1)
                self._pending_discard = [True, True]
                for p in order:
                    if self.folded is None:
                        self._discard(p, rule, decide)
                    self._pending_discard[p] = False
            if self.folded is not None:
                return self._finish()
            self._betting_round(decide)
            if self.folded is not None:
                return self._finish()
        self.showdown = True
        return self._finish()

    def _discard(self, p: int, rule, decide: DecideFn) -> None:
        legal = LegalActions(discard_count=rule.count)
        obs = self.observe(p, "discard", legal)
        a = decide(p, obs)
        if not legal.is_legal(a, self.hole[p]):
            self.folded = p
            self.history.append((p, self.street, FOLD, 0, (), True))
            return
        for c in a.cards:
            self.hole[p].remove(c)
            self.discards[p].append(c)
            if rule.to_board:
                self.board.append(c)
        self.history.append((p, self.street, DISCARD, 0, tuple(a.cards), rule.face_up))

    def _betting_round(self, decide: DecideFn) -> None:
        first = 0 if self.street == 0 else 1
        acted = [False, False]
        last_raise = self.spec.big_blind
        p = first
        while True:
            o = 1 - p
            # round end: both acted (or all-in) and pips matched (or the short one is all-in)
            def settled(q):
                return self.stacks[q] == 0 or (acted[q] and self.pips[q] == max(self.pips))
            if settled(0) and settled(1):
                break
            if self.stacks[p] == 0 or (self.stacks[o] == 0 and self.pips[p] >= self.pips[o]):
                acted[p] = True
                if settled(0) and settled(1):
                    break
                p = o
                continue
            legal = self.legal(p, last_raise)
            obs = self.observe(p, "bet", legal)
            a = decide(p, obs)
            if not legal.is_legal(a):
                a = Fold()
            acted[p] = True
            if a.kind == FOLD:
                self.folded = p
                self.history.append((p, self.street, FOLD, 0, (), True))
                return
            if a.kind == CHECK:
                self.history.append((p, self.street, CHECK, 0, (), True))
            elif a.kind == CALL:
                put = self._put(p, legal.call_amount)
                self.history.append((p, self.street, CALL, put, (), True))
            else:  # raise
                prev_max = max(self.pips)
                self._put(p, a.amount - self.pips[p])
                last_raise = max(last_raise, a.amount - prev_max)
                acted[o] = False
                self.history.append((p, self.street, RAISE, a.amount, (), True))
            p = o
        # refund any uncalled excess (only possible with short blinds / non-reset stacks)
        hi = 0 if self.pips[0] > self.pips[1] else 1
        lo = 1 - hi
        excess = self.pips[hi] - self.pips[lo]
        if excess > 0 and self.stacks[lo] == 0:
            self.pips[hi] -= excess
            self.committed[hi] -= excess
            self.stacks[hi] += excess

    def _finish(self) -> list[int]:
        self.done = True
        c = self.committed
        if self.folded is not None:
            w = 1 - self.folded
            self.deltas = [0, 0]
            self.deltas[w] = c[self.folded]
            self.deltas[self.folded] = -c[self.folded]
            return self.deltas
        # showdown; refund unequal commitments first (all-in for less)
        m = min(c)
        s0 = self.ev.evaluate(self.hole[0], self.board)
        s1 = self.ev.evaluate(self.hole[1], self.board)
        self.scores = (s0, s1)
        if s0 > s1:
            self.deltas = [m, -m]
        elif s1 > s0:
            self.deltas = [-m, m]
        else:
            self.deltas = [0, 0]
        return self.deltas

    def result_for(self, p: int) -> HandResult:
        o = 1 - p
        hist = tuple(
            ActionRecord(pos, st, kind, amt, tuple(cards if (pos == p or fu or self.showdown) else ()))
            for (pos, st, kind, amt, cards, fu) in self.history)
        return HandResult(position=p, delta=self.deltas[p], showdown=self.showdown,
                          my_cards=tuple(self.hole[p]),
                          opp_cards=tuple(self.hole[o]) if self.showdown else None,
                          board=tuple(self.board), history=hist, folded_by=self.folded)
