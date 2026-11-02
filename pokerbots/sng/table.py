"""Multiway no-limit / pot-limit hand engine and the sit-and-go table loop.

Betting rules (standard tournament rules; the official kit may differ on edge cases):
  * blinds and antes are posted, partially if a stack is short (all-in); a short big
    blind still has to be called in full (the excess nobody matches comes back);
  * preflop the player after the big blind acts first; heads-up the button posts the
    small blind and acts first preflop, last after the flop;
  * minimum raise = the last full raise increment (at least the big blind); an
    all-in raise smaller than that does not reopen the betting for players who have
    already acted (they may only call or fold);
  * uncalled chips return to their owner; side pots go to the best eligible hand,
    odd chips to the first winner left of the button.
Table: the button moves to the next seat with chips each hand; players who bust in
the same hand are placed by their stack at the start of the hand (larger = better),
ties share the points of the places involved; at the hand cap the survivors share the
remaining places by ICM.
"""
from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Optional

import numpy as np

from engine.evaluator import get_evaluator
from engine.game import CALL, CHECK, DISCARD, FOLD, RAISE, Action, Call, Check, Discard, Fold

from .icm import icm
from .rules import SngRules


@dataclass(frozen=True)
class SeatView:
    seat: int
    stack: int          # chips behind
    bet: int            # chips put in on this street
    committed: int      # chips put in this hand (incl. antes and blinds)
    folded: bool
    all_in: bool
    in_hand: bool       # dealt into this hand (has chips at the table)


@dataclass(frozen=True)
class Legal:
    can_check: bool
    can_call: bool
    call_amount: int    # chips to call (all-in for less if the stack is short)
    can_raise: bool
    min_raise_to: int   # total bet on this street
    max_raise_to: int
    discard_count: int = 0   # > 0 only in a discard phase: discard up to this many cards
    discard_min: int = 0     # ... and at least this many (== discard_count unless variable)

    def passive(self) -> Action:
        return Check() if self.can_check else Call()

    def clamp(self, amount) -> int:
        return int(min(self.max_raise_to, max(self.min_raise_to, int(round(amount)))))

    def is_legal(self, a) -> bool:
        if not isinstance(a, Action):
            return False
        if self.discard_count and a.kind != DISCARD:
            return False
        if a.kind == FOLD:
            return True
        if a.kind == CHECK:
            return self.can_check
        if a.kind == CALL:
            return self.can_call
        if self.discard_count:
            return a.kind == DISCARD and self.discard_min <= len(a.cards) <= self.discard_count
        if a.kind == RAISE:
            return self.can_raise and self.min_raise_to <= a.amount <= self.max_raise_to
        return False


@dataclass(frozen=True)
class SngObservation:
    hand_number: int            # 0-based hand number at this table
    hands_left: int             # hands after this one before the cap
    level: int
    small_blind: int
    big_blind: int
    ante: int
    seat: int                   # my seat (0..num_players-1)
    button: int
    sb_seat: int
    bb_seat: int
    street: int                 # 0 preflop, 1 flop, ...
    hole: tuple
    board: tuple
    pot: int                    # all chips in the middle, incl. this street's bets
    my_stack: int
    my_bet: int
    legal: Legal
    seats: tuple                # SeatView per seat (all seats, busted ones have in_hand False)
    history: tuple              # (seat, street, kind, amount) this hand; raise amount = raise-to
    players_left: int           # players with chips at the table (incl. me)
    payouts: tuple              # points by finishing place
    places_paid: tuple          # (place, points) still to be awarded = 1..players_left
    phase: str = "bet"          # "bet" or "discard"
    my_discards: tuple = ()     # my discarded cards this hand
    visible_discards: tuple = ()  # per seat: that seat's discards I can see (face up / board)


@dataclass
class BotStats:
    decisions: int = 0
    total_time: float = 0.0
    max_time: float = 0.0
    over_limit: int = 0
    errors: int = 0
    illegal: int = 0
    first_error: Optional[str] = None
    times: list = field(default_factory=list)

    def add(self, dt: float, limit: float):
        self.times.append(dt)
        self.decisions += 1
        self.total_time += dt
        self.max_time = max(self.max_time, dt)
        if dt > limit:
            self.over_limit += 1


class Hand:
    """One hand among the seats with chips. stacks: list per seat (0 = busted)."""

    def __init__(self, rules: SngRules, stacks, button: int, hand_number: int, deck, evaluator=None):
        self.r = rules
        self.spec = rules.spec
        self.n = len(stacks)
        self.hand_number = hand_number
        self.start_stacks = list(stacks)
        self.stack = list(stacks)
        self.bet = [0] * self.n
        self.committed = [0] * self.n
        self.in_hand = [s > 0 for s in stacks]
        self.folded = [not x for x in self.in_hand]
        self.button = button
        self.sb, self.bb, self.ante = rules.blinds_for(hand_number)
        self.ev = evaluator or get_evaluator(self.spec)
        h = self.spec.hole_cards
        self.hole = [tuple(deck[i * h:(i + 1) * h]) if self.in_hand[i] else () for i in range(self.n)]
        self.board_deck = list(deck[self.n * h:])   # board cards and draw replacements, in order
        self.board = []
        self.discards = [[] for _ in range(self.n)]
        self.visible = [[] for _ in range(self.n)]     # discards everyone can see
        self.muck = []                                  # dead discards (reshuffled if a draw runs the stub out)
        self.street = 0
        self.history = []
        self.ended = False

    # ---- seat order helpers ---------------------------------------------------------
    def _next(self, s, pred):
        for k in range(1, self.n + 1):
            j = (s + k) % self.n
            if pred(j):
                return j
        return None

    def _live(self, j):        # can still act
        return self.in_hand[j] and not self.folded[j] and self.stack[j] > 0

    def _contending(self):
        return [j for j in range(self.n) if self.in_hand[j] and not self.folded[j]]

    # ---- posting ----------------------------------------------------------------------
    def _put(self, j, amt):
        amt = min(amt, self.stack[j])
        self.stack[j] -= amt
        self.bet[j] += amt
        self.committed[j] += amt
        return amt

    def post(self):
        players = [j for j in range(self.n) if self.in_hand[j]]
        if self.ante:
            for j in players:
                a = min(self.ante, self.stack[j])
                self.stack[j] -= a
                self.committed[j] += a          # dead money, not a bet
        if len(players) == 2:
            self.sb_seat = self.button if self.in_hand[self.button] else self._next(self.button, lambda j: self.in_hand[j])
            self.bb_seat = self._next(self.sb_seat, lambda j: self.in_hand[j])
        else:
            self.sb_seat = self._next(self.button, lambda j: self.in_hand[j])
            self.bb_seat = self._next(self.sb_seat, lambda j: self.in_hand[j])
        self._put(self.sb_seat, self.sb)
        self.history.append((self.sb_seat, 0, "post", self.bet[self.sb_seat]))
        self._put(self.bb_seat, self.bb)
        self.history.append((self.bb_seat, 0, "post", self.bet[self.bb_seat]))

    # ---- betting round --------------------------------------------------------------
    def _current_bet(self):
        # preflop the big blind is the bet to call even if the blind was posted short (all-in)
        return max(max(self.bet), self.bb) if self.street == 0 else max(self.bet)

    def _legal(self, j) -> Legal:
        cur = self._current_bet()
        to_call = cur - self.bet[j]
        call_amt = min(to_call, self.stack[j])
        others_can_act = any(self._live(k) for k in range(self.n) if k != j)
        can_raise = self.can_reraise[j] and self.stack[j] > to_call and others_can_act
        lo = hi = 0
        if can_raise:
            hi = self.bet[j] + self.stack[j]
            if self.spec.betting == "pot_limit":
                pot = sum(self.committed) + call_amt
                hi = min(hi, cur + pot)
            lo = min(cur + self.last_raise, hi)
            if hi <= cur:
                can_raise, lo, hi = False, 0, 0
        return Legal(can_check=to_call == 0, can_call=to_call > 0, call_amount=call_amt,
                     can_raise=can_raise, min_raise_to=lo, max_raise_to=hi)

    def observe(self, j, legal: Legal, players_left: int, phase: str = "bet") -> SngObservation:
        seats = tuple(SeatView(k, self.stack[k], self.bet[k], self.committed[k], self.folded[k],
                               self.in_hand[k] and not self.folded[k] and self.stack[k] == 0, self.in_hand[k])
                      for k in range(self.n))
        pays = tuple(self.r.payouts)
        return SngObservation(
            hand_number=self.hand_number, hands_left=self.r.max_hands - self.hand_number - 1,
            level=self.r.level(self.hand_number), small_blind=self.sb, big_blind=self.bb, ante=self.ante,
            seat=j, button=self.button, sb_seat=self.sb_seat, bb_seat=self.bb_seat, street=self.street,
            hole=self.hole[j], board=tuple(self.board), pot=sum(self.committed), my_stack=self.stack[j],
            my_bet=self.bet[j], legal=legal, seats=seats, history=tuple(self.history),
            players_left=players_left, payouts=pays,
            places_paid=tuple((p, pays[p - 1]) for p in range(1, players_left + 1)),
            phase=phase, my_discards=tuple(self.discards[j]),
            visible_discards=tuple(tuple(v) for v in self.visible))

    def betting_round(self, decide, players_left: int):
        n = self.n
        self.can_reraise = [True] * n
        need = [self._live(j) for j in range(n)]
        self.last_raise = self.bb
        if self.street == 0:
            first = self._next(self.bb_seat, self._live) if any(need) else None
        else:
            first = self._next(self.button, self._live)
        # nobody needs to act if at most one player can act and has nothing to call
        j = first
        while j is not None and any(need):
            if len(self._contending()) <= 1:
                break
            if not need[j]:
                j = self._next(j, lambda k: need[k])
                continue
            lg = self._legal(j)
            if not lg.can_raise and lg.can_check and sum(self._live(k) for k in range(n)) <= 1:
                need[j] = False
                j = self._next(j, lambda k: need[k])
                continue
            a = decide(j, self.observe(j, lg, players_left), lg)
            cur = self._current_bet()
            if a.kind == FOLD:
                self.folded[j] = True
                self.history.append((j, self.street, "fold", 0))
            elif a.kind == CHECK:
                self.history.append((j, self.street, "check", 0))
            elif a.kind == CALL:
                amt = self._put(j, lg.call_amount)
                self.history.append((j, self.street, "call", amt))
            else:
                to = a.amount
                inc = to - cur
                self._put(j, to - self.bet[j])
                self.history.append((j, self.street, "raise", self.bet[j]))
                if inc >= self.last_raise:          # full raise: reopens the betting
                    self.last_raise = inc
                    for k in range(n):
                        if k != j and self._live(k):
                            need[k] = True
                            self.can_reraise[k] = True
                else:                                # short all-in: call-or-fold for those who acted
                    for k in range(n):
                        if k != j and self._live(k) and not need[k]:
                            need[k] = True
                            self.can_reraise[k] = False
            need[j] = False
            j = self._next(j, lambda k: need[k])
        for k in range(n):
            self.bet[k] = 0

    # ---- discard / draw phase -----------------------------------------------------------
    def discard_round(self, rule, decide, players_left: int):
        """Every player still in the hand (all-in included) discards, in rule.order:
        'oop_first' = clockwise from the first seat after the button, 'ip_first' = the
        reverse (button first)."""
        cw = []
        j = self._next(self.button, lambda k: self.in_hand[k] and not self.folded[k])
        while j is not None and j not in cw:
            cw.append(j)
            j = self._next(j, lambda k: self.in_hand[k] and not self.folded[k])
        order = cw if rule.order == "oop_first" else list(reversed(cw))
        lo = rule.count if rule.min_count < 0 else rule.min_count
        for j in order:
            lg = Legal(False, False, 0, False, 0, 0, discard_count=min(rule.count, len(self.hole[j])),
                       discard_min=min(lo, len(self.hole[j])))
            a = decide(j, self.observe(j, lg, players_left, phase="discard"), lg)
            cards = tuple(a.cards)
            if (a.kind != DISCARD or len(set(cards)) != len(cards) or not set(cards) <= set(self.hole[j])
                    or not lg.discard_min <= len(cards) <= lg.discard_count):
                cards = lowest_cards(self.hole[j], lg.discard_min)
            self.hole[j] = tuple(c for c in self.hole[j] if c not in cards)
            self.discards[j] += cards
            if rule.to_board:
                self.board += cards
                self.visible[j] += cards
            elif rule.face_up:
                self.visible[j] += cards
            if rule.draw and cards:
                if len(self.board_deck) < len(cards) + self._board_still_due():
                    # stub ran out: shuffle the dead discards (not this player's own) back in
                    pool = sorted(self.muck)
                    np.random.default_rng([self.hand_number, len(self.history), 31]).shuffle(pool)
                    self.board_deck += pool
                    self.muck = []
                self.hole[j] = self.hole[j] + tuple(self.board_deck[:len(cards)])
                self.board_deck = self.board_deck[len(cards):]
            if not rule.to_board:
                self.muck += cards
            self.history.append((j, self.street, "discard", len(cards)))

    def _board_still_due(self):
        return sum(self.spec.board_cards_per_street[self.street + 1:])

    # ---- showdown / payout --------------------------------------------------------------
    def award(self):
        """Distribute the pot(s). Returns per-seat chip deltas for this hand."""
        cont = self._contending()
        levels = sorted({self.committed[j] for j in range(self.n) if self.committed[j] > 0})
        prev = 0
        win = [0] * self.n
        scores = None
        if len(cont) > 1:
            need = self.spec.total_board_dealt - self.dealt_board
            if need > 0:
                self.board += self.board_deck[:need]
                self.dealt_board += need
            if len({len(self.hole[j]) for j in cont}) == 1:
                holes = np.array([self.hole[j] for j in cont], dtype=np.int64)
                boards = np.array([self.board] * len(cont), dtype=np.int64)
                sc = self.ev.evaluate_batch(holes, boards)
                scores = {j: int(s) for j, s in zip(cont, sc)}
            else:
                scores = {j: int(self.ev.evaluate(list(self.hole[j]), list(self.board))) for j in cont}
        for lv in levels:
            contrib = [j for j in range(self.n) if self.committed[j] >= lv]
            pot = (lv - prev) * len(contrib)
            elig = [j for j in contrib if j in cont]
            if not elig:            # everyone at this level folded: goes to the best remaining contender
                elig = cont
            if len(elig) == 1:
                winners = elig
            else:
                best = max(scores[j] for j in elig)
                winners = [j for j in elig if scores[j] == best]
            share, odd = divmod(pot, len(winners))
            order = sorted(winners, key=lambda j: (j - self.button - 1) % self.n)
            for i, j in enumerate(order):
                win[j] += share + (1 if i < odd else 0)
            prev = lv
        for j in range(self.n):
            self.stack[j] += win[j]
        self.showdown = scores
        return [self.stack[j] - self.start_stacks[j] for j in range(self.n)]

    def play(self, decide, players_left: int):
        self.post()
        streets = self.spec.board_cards_per_street
        self.dealt_board = 0
        for st in range(len(streets)):
            self.street = st
            if st > 0:
                k = streets[st]
                self.board += self.board_deck[:k]
                self.board_deck = self.board_deck[k:]
                self.dealt_board += k
            if len(self._contending()) <= 1:
                break
            for rule in self.spec.discards_on_street(st):
                self.discard_round(rule, decide, players_left)
            if sum(self._live(j) for j in self._contending()) >= 1:
                self.betting_round(decide, players_left)
        return self.award()


def lowest_cards(hole, k):
    """The k lowest-ranked cards (the automatic discard on an error or timeout)."""
    return tuple(sorted(hole, key=lambda c: (c >> 2, c & 3))[:k])


@dataclass
class TableResult:
    points: list            # per seat
    places: list            # per seat (1 = winner; fractional when shared / ICM)
    hands: int
    stats: list             # BotStats per seat
    bust_hand: list         # hand number each seat busted (None = survived)
    final_stacks: list


def play_table(bots, rules: SngRules, seed: int, deal_seed: Optional[int] = None, verbose=False) -> TableResult:
    """bots: one per seat. Each has new_table(rules, seat, seed) and act(obs) -> Action;
    optional end_hand(info). The deck of hand h depends only on (deal_seed, h), dealt by
    absolute seat, so the same deal_seed with bots rotated across seats is a duplicate."""
    rules.validate()
    n = rules.num_players
    assert len(bots) == n
    deal_seed = seed if deal_seed is None else deal_seed
    ev = get_evaluator(rules.spec)
    stacks = [rules.starting_stack] * n
    stats = [BotStats() for _ in range(n)]
    broken = set()                 # a bot whose setup failed checks / folds / auto-discards all table
    for s, b in enumerate(bots):
        try:
            b.new_table(rules, s, seed * 1000 + s)
        except Exception:  # noqa: BLE001
            broken.add(s)
    rng = np.random.default_rng([deal_seed, 99])
    button = int(rng.integers(n))
    deck_all = np.array(rules.spec.deck, dtype=np.int64)
    places = [None] * n
    bust_hand = [None] * n
    points = [0.0] * n
    limit = rules.time_limit

    def decide(j, obs, lg):
        b = bots[j]
        st = stats[j]
        if j in broken:
            st.errors += 1
            if st.first_error is None:
                st.first_error = "new_table failed: the bot checks / folds / auto-discards all table"
            return Discard(lowest_cards(obs.hole, lg.discard_min)) if lg.discard_count else (
                Check() if lg.can_check else Fold())
        t0 = time.perf_counter()
        try:
            a = b.act(obs)
        except Exception as e:  # noqa: BLE001
            st.errors += 1
            if st.first_error is None:
                import traceback
                st.first_error = traceback.format_exc()[-1500:]
            a = None
        dt = time.perf_counter() - t0
        st.add(dt, limit)
        if a is not None and not lg.is_legal(a):
            st.illegal += 1
            if st.first_error is None:
                st.first_error = f"illegal {a} with {lg}"
            a = None
        if a is None or (rules.enforce_time and dt > limit):
            if lg.discard_count:
                a = Discard(lowest_cards(obs.hole, lg.discard_min))
            else:
                a = Check() if lg.can_check else Fold()
        return a

    hand_no = 0
    for hand_no in range(rules.max_hands):
        alive = [j for j in range(n) if stacks[j] > 0]
        if len(alive) <= 1:
            break
        hrng = np.random.default_rng([deal_seed, hand_no, 7919])
        deck = [int(c) for c in hrng.permutation(deck_all)]
        h = Hand(rules, stacks, button, hand_no, deck, ev)
        deltas = h.play(decide, len(alive))
        new = h.stack
        assert sum(new) == sum(stacks), "chips not conserved"
        busted = [j for j in alive if new[j] == 0]
        info = dict(hand_number=hand_no, deltas=deltas, board=tuple(h.board), history=tuple(h.history),
                    showdown=None if h.showdown is None else {j: h.hole[j] for j in h.showdown},
                    stacks=tuple(new))
        for b in bots:
            if hasattr(b, "end_hand"):
                try:
                    b.end_hand(info)
                except Exception:  # noqa: BLE001
                    pass
        if busted:
            # places len(alive) .. len(alive)-len(busted)+1, larger start stack = better place
            remaining = len(alive) - len(busted)
            groups = {}
            for j in busted:
                groups.setdefault(stacks[j], []).append(j)
            place = len(alive)
            for st_size in sorted(groups):                     # smallest start stack = worst place
                g = groups[st_size]
                ps = list(range(place - len(g) + 1, place + 1))
                pts = sum(rules.payouts[p - 1] for p in ps) / len(g)
                for j in g:
                    places[j] = sum(ps) / len(g)
                    points[j] = pts
                    bust_hand[j] = hand_no
                place -= len(g)
            assert place == remaining
        stacks = list(new)
        if sum(s > 0 for s in stacks) <= 1:
            break
        button = h._next(button, lambda j: stacks[j] > 0)
    alive = [j for j in range(n) if stacks[j] > 0]
    if len(alive) == 1:
        places[alive[0]] = 1
        points[alive[0]] = rules.payouts[0]
    else:
        ev_pts = icm([stacks[j] for j in alive], rules.payouts[:len(alive)])
        for j, e in zip(alive, ev_pts):
            points[j] = e
            places[j] = None  # survived to the cap (ICM share)
    return TableResult(points=points, places=places, hands=hand_no + 1, stats=stats,
                       bust_hand=bust_hand, final_stacks=stacks)
