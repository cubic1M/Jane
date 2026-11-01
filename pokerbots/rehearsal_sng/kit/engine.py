"""Local simulator for one sit-and-go table.

This is the same rules engine the tournament runs (minus sandboxing and
networking). Use run_local.py to play many tables; use Table directly in your
own tests.
"""

from __future__ import annotations

import random
import time
import traceback
from dataclasses import dataclass, field
from typing import Callable, Sequence, TextIO

import config
from cards import FULL_DECK, describe, evaluate, parse_card
from icm import icm_equity
from table_api import (
    ACTION_KINDS, ACTIVE, ALLIN, ANTE, BIG_BLIND, CALL, CHECK, FLOP, FOLD, FOLDED,
    OUT, PREFLOP, RAISE, RIVER, SMALL_BLIND, TURN, Action, Event, HandSummary,
    Observation, PlayerInfo,
)


@dataclass
class SeatStats:
    decisions: int = 0
    timeouts: int = 0
    errors: int = 0
    total_ms: float = 0.0
    max_ms: float = 0.0
    hook_calls: int = 0
    hook_timeouts: int = 0
    hook_errors: int = 0
    init_failed: bool = False
    first_error: str | None = None

    def note_error(self, text: str) -> None:
        if self.first_error is None:
            self.first_error = text


@dataclass
class SeatResult:
    seat: int
    name: str
    place: int
    points: float
    final_stack: int
    stats: SeatStats


@dataclass
class TableResult:
    table_id: int
    hands_played: int
    ended_by: str                 # "winner" or "hand_cap"
    seats: list[SeatResult]


class HandLog:
    """Tab-separated hand log, one line per event. '-' marks an empty field."""

    COLUMNS = ("table", "hand", "level", "street", "seat", "name", "event",
               "amount", "stack", "pot", "info")

    def __init__(self, stream: TextIO):
        self.stream = stream
        stream.write("#" + "\t".join(self.COLUMNS) + "\n")

    def write(self, *fields) -> None:
        self.stream.write("\t".join("-" if f is None or f == "" else str(f)
                                    for f in fields) + "\n")


def build_pots(contributions: Sequence[int], live: Sequence[int]) -> list[tuple[int, list[int]]]:
    """Split total contributions into (amount, eligible seats) pots, main pot first.

    contributions[s] is everything seat s put in this hand (antes included);
    live lists the seats that have not folded.
    """
    levels = sorted({c for c in contributions if c > 0})
    pots: list[tuple[int, list[int]]] = []
    prev = 0
    carry = 0
    for lv in levels:
        amount = carry + sum(min(c, lv) - min(c, prev) for c in contributions)
        eligible = [s for s in live if contributions[s] >= lv]
        prev = lv
        if not eligible:
            carry = amount
            continue
        carry = 0
        if pots and pots[-1][1] == eligible:
            pots[-1] = (pots[-1][0] + amount, eligible)
        else:
            pots.append((amount, eligible))
    if carry and pots:
        pots[-1] = (pots[-1][0] + carry, pots[-1][1])
    return pots


@dataclass
class _Hand:
    number: int
    level: int
    sb_amt: int
    bb_amt: int
    ante: int
    button: int
    sb: int
    bb: int
    in_hand: list[bool]
    folded: list[bool]
    committed: list[int]
    total: list[int]
    hole: dict[int, tuple[str, str]]
    board: list[str]
    deck: list[str]
    history: list[Event] = field(default_factory=list)
    street: str = PREFLOP
    current_bet: int = 0
    min_inc: int = 0
    reopen_level: int = 0
    acted: dict[int, int] = field(default_factory=dict)


class Table:
    """One sit-and-go table.

    agent_factories: one zero-argument callable per seat (usually a Bot class).
    A fresh agent is created from each factory when the Table is constructed.
    """

    def __init__(self, agent_factories: Sequence[Callable], names: Sequence[str] | None = None, *,
                 seed=None, table_id: int = 1, stacks: Sequence[int] | None = None,
                 button: int = 0, log: HandLog | None = None,
                 time_limit_ms: float = config.TIME_LIMIT_MS,
                 init_time_limit_ms: float = config.INIT_TIME_LIMIT_MS,
                 max_hands: int = config.MAX_HANDS,
                 blind_levels: Sequence[tuple[int, int, int]] = config.BLIND_LEVELS,
                 hands_per_level: int = config.HANDS_PER_LEVEL,
                 points_table: Sequence[float] = config.POINTS_BY_FINISH):
        n = len(agent_factories)
        if n < 2:
            raise ValueError("need at least two seats")
        if len(points_table) < n:
            raise ValueError("points table shorter than the number of seats")
        if 2 * n + 5 > len(FULL_DECK):
            raise ValueError("too many seats for the deck")
        self.n = n
        self.names = list(names) if names else [f"seat{i}" for i in range(n)]
        self.rng = random.Random(seed)
        self.table_id = table_id
        self.stacks = list(stacks) if stacks is not None else [config.STARTING_STACK] * n
        self.alive = [s > 0 for s in self.stacks]
        self.button: int | None = None
        self._initial_button = button % n
        self.hand_number = 0
        self.log = log
        self.time_limit = time_limit_ms / 1000.0
        self.time_limit_ms = time_limit_ms
        self.init_time_limit = init_time_limit_ms / 1000.0
        self.max_hands = max_hands
        self.blind_levels = tuple(blind_levels)
        self.hands_per_level = hands_per_level
        self.points_table = tuple(points_table)
        self.stats = [SeatStats() for _ in range(n)]
        self.places: list[int | None] = [None] * n
        self.points: list[float | None] = [None] * n
        self.finished = False
        self.ended_by = ""
        self.h: _Hand | None = None
        self.agents = [self._create(i, f) for i, f in enumerate(agent_factories)]
        for i in range(n):
            if not self.alive[i]:
                raise ValueError("every seat must start with chips")

    # ------------------------------------------------------------------ setup

    def _create(self, seat: int, factory: Callable):
        st = self.stats[seat]
        t0 = time.perf_counter()
        try:
            agent = factory()
        except Exception:
            st.init_failed = True
            st.note_error("Bot() raised:\n" + traceback.format_exc())
            return None
        elapsed = time.perf_counter() - t0
        if elapsed > self.init_time_limit:
            st.init_failed = True
            st.note_error(f"Bot() took {elapsed * 1000:.1f} ms (limit "
                          f"{self.init_time_limit * 1000:.0f} ms)")
            return None
        return agent

    def points_for_place(self, place: int) -> float:
        return self.points_table[len(self.points_table) - place]

    # ---------------------------------------------------------------- helpers

    def _next_alive(self, seat: int) -> int:
        for k in range(1, self.n + 1):
            s = (seat + k) % self.n
            if self.alive[s]:
                return s
        raise RuntimeError("no players left")

    def _status(self, s: int) -> str:
        h = self.h
        if not h.in_hand[s]:
            return OUT
        if h.folded[s]:
            return FOLDED
        if self.stacks[s] == 0:
            return ALLIN
        return ACTIVE

    def _can_act(self, s: int) -> bool:
        return self._status(s) == ACTIVE

    def _live(self) -> list[int]:
        h = self.h
        return [s for s in range(self.n) if h.in_hand[s] and not h.folded[s]]

    def _pot_all(self) -> int:
        return sum(self.h.total) + sum(self.h.committed)

    def _log(self, street, seat, event, amount=None, info=None) -> None:
        if self.log is None:
            return
        h = self.h
        if seat is None:
            name = stack = None
        else:
            name, stack = self.names[seat], self.stacks[seat]
        self.log.write(self.table_id, h.number if h else self.hand_number,
                       h.level if h else None, street, seat, name, event, amount,
                       stack, self._pot_all() if h else None, info)

    def _seat_order_from(self, first: int) -> list[int]:
        return [(first + k) % self.n for k in range(self.n)]

    # ------------------------------------------------------------------- hand

    def play_hand(self, deck: Sequence[str] | None = None,
                  hole: dict[int, Sequence[str]] | None = None,
                  board: Sequence[str] | None = None) -> None:
        """Play one hand.

        For tests you can fix the cards: either a full `deck` (dealt one card at
        a time starting left of the button, two rounds, then 3+1+1 board cards),
        or `hole` (seat -> two cards) and/or `board` (five cards); any missing
        cards are drawn at random from what is left.
        """
        if self.finished:
            raise RuntimeError("table is finished")
        n = self.n
        alive_seats = [s for s in range(n) if self.alive[s]]
        self.hand_number += 1
        hn = self.hand_number
        level = config.level_for_hand(hn, self.hands_per_level, len(self.blind_levels))
        sb_amt, bb_amt, ante = self.blind_levels[level - 1]

        if self.button is None:
            b = self._initial_button if self.alive[self._initial_button] \
                else self._next_alive(self._initial_button)
        else:
            b = self._next_alive(self.button)
        self.button = b
        if len(alive_seats) == 2:
            sb, bb = b, self._next_alive(b)
        else:
            sb = self._next_alive(b)
            bb = self._next_alive(sb)

        start_stacks = list(self.stacks)
        deal_order = [s for s in self._seat_order_from((b + 1) % n) if self.alive[s]]
        holes, board_cards = self._prepare_cards(deal_order, deck, hole, board)

        h = self.h = _Hand(
            number=hn, level=level, sb_amt=sb_amt, bb_amt=bb_amt, ante=ante,
            button=b, sb=sb, bb=bb, in_hand=list(self.alive), folded=[False] * n,
            committed=[0] * n, total=[0] * n, hole=holes, board=[], deck=board_cards,
        )
        self._log(PREFLOP, None, "HAND", None,
                  f"button={b} sb={sb} bb={bb} blinds={sb_amt}/{bb_amt} ante={ante}")

        # antes (dead money: not part of anyone's committed amount)
        if ante:
            for s in deal_order:
                amt = min(ante, self.stacks[s])
                if amt:
                    self.stacks[s] -= amt
                    h.total[s] += amt
                    h.history.append(Event(PREFLOP, s, ANTE, amt))
                    self._log(PREFLOP, s, "ANTE", amt, "allin" if self.stacks[s] == 0 else None)
        # blinds
        for seat, amt, kind, tag in ((sb, sb_amt, SMALL_BLIND, "SB"), (bb, bb_amt, BIG_BLIND, "BB")):
            amt = min(amt, self.stacks[seat])
            self.stacks[seat] -= amt
            h.committed[seat] += amt
            h.history.append(Event(PREFLOP, seat, kind, amt))
            self._log(PREFLOP, seat, tag, amt, "allin" if self.stacks[seat] == 0 else None)
        h.current_bet = bb_amt
        h.min_inc = bb_amt
        h.reopen_level = bb_amt

        for s in deal_order:
            self._log(PREFLOP, s, "HOLE", None, " ".join(holes[s]))

        self._betting_round((bb + 1) % n)
        for street, count in ((FLOP, 3), (TURN, 1), (RIVER, 1)):
            if len(self._live()) <= 1:
                break
            h.street = street
            new = [h.deck.pop(0) for _ in range(count)]
            h.board.extend(new)
            self._log(street, None, street.upper(), None, " ".join(h.board))
            h.current_bet = 0
            h.min_inc = bb_amt
            h.reopen_level = 0
            h.acted = {}
            self._betting_round((b + 1) % n)

        won, shown = self._award()
        self._finish_hand(alive_seats, start_stacks, won, shown)

    def _prepare_cards(self, deal_order, deck, hole, board):
        if deck is not None:
            cards = list(deck)
            need = 2 * len(deal_order) + 5
            if len(cards) < need:
                raise ValueError(f"preset deck needs at least {need} cards")
            holes = {s: [] for s in deal_order}
            for _ in range(2):
                for s in deal_order:
                    holes[s].append(cards.pop(0))
            holes = {s: tuple(v) for s, v in holes.items()}
            board_cards = cards[:5]
        else:
            hole = {s: tuple(c) for s, c in (hole or {}).items()}
            board = list(board or [])
            used = {c for cs in hole.values() for c in cs} | set(board)
            remaining = [c for c in FULL_DECK if c not in used]
            self.rng.shuffle(remaining)
            holes = {}
            for s in deal_order:
                holes[s] = hole[s] if s in hole else (remaining.pop(), remaining.pop())
            while len(board) < 5:
                board.append(remaining.pop())
            board_cards = board
        all_cards = [c for cs in holes.values() for c in cs] + list(board_cards)
        for c in all_cards:
            parse_card(c)
        if len(set(all_cards)) != len(all_cards):
            raise ValueError("duplicate cards in preset")
        return holes, list(board_cards)

    # ------------------------------------------------------------ betting

    def _betting_round(self, first: int) -> None:
        h = self.h
        n = self.n
        if len(self._live()) > 1:
            needs = {s for s in range(n) if self._can_act(s)}
            seat = first
            while needs:
                if len(self._live()) <= 1:
                    break
                if seat in needs:
                    if not self._can_act(seat):
                        needs.discard(seat)
                    else:
                        actors = [s for s in range(n) if self._can_act(s)]
                        if len(actors) == 1 and h.committed[seat] >= h.current_bet:
                            needs.discard(seat)
                        else:
                            raised = self._turn(seat)
                            needs.discard(seat)
                            if raised:
                                needs = {s for s in range(n) if self._can_act(s) and s != seat}
                seat = (seat + 1) % n
        self._return_uncalled()
        for s in range(n):
            h.total[s] += h.committed[s]
            h.committed[s] = 0

    def _return_uncalled(self) -> None:
        h = self.h
        order = sorted(range(self.n), key=lambda s: h.committed[s], reverse=True)
        top, second = order[0], h.committed[order[1]]
        excess = h.committed[top] - second
        if excess > 0:
            h.committed[top] -= excess
            self.stacks[top] += excess
            self._log(h.street, top, "RETURN", excess, "uncalled")

    def _turn(self, s: int) -> bool:
        """Ask seat s for an action and apply it. Returns True if the bet went up."""
        h = self.h
        stack = self.stacks[s]
        to_call = h.current_bet - h.committed[s]
        others_can_respond = any(self._can_act(o) for o in range(self.n) if o != s)
        reopened = s not in h.acted or h.reopen_level > h.acted[s]
        can_raise = stack > to_call and others_can_respond and reopened
        legal = {FOLD, CHECK if to_call <= 0 else CALL}
        if can_raise:
            legal.add(RAISE)
            min_to = h.current_bet + h.min_inc
            max_to = stack + h.committed[s]
            if max_to < min_to:
                min_to = max_to
        else:
            min_to = max_to = 0

        obs = self._observation(s, to_call, min_to, max_to, frozenset(legal))
        action, problem = self._ask(s, obs)
        if problem:
            self._log(h.street, s, problem[0], problem[1], problem[2])

        note = None
        if action is None:
            kind, amount = (CHECK if to_call <= 0 else FOLD), 0
        else:
            kind, amount = action.kind, action.amount
            if kind == CHECK and to_call > 0:
                kind, note = FOLD, "illegal check -> fold"
            elif kind == CALL and to_call <= 0:
                kind = CHECK
            elif kind == RAISE and not can_raise:
                kind, note = (CALL if to_call > 0 else CHECK), "raise not allowed"

        if kind == FOLD:
            h.folded[s] = True
            h.history.append(Event(h.street, s, FOLD, 0))
            self._log(h.street, s, "FOLD", None, note)
            return False
        if kind == CHECK:
            h.acted[s] = h.current_bet
            h.history.append(Event(h.street, s, CHECK, 0))
            self._log(h.street, s, "CHECK", None, note)
            return False
        if kind == CALL:
            add = min(to_call, stack)
            self.stacks[s] -= add
            h.committed[s] += add
            h.acted[s] = h.current_bet
            h.history.append(Event(h.street, s, CALL, add))
            info = "allin" if self.stacks[s] == 0 else None
            self._log(h.street, s, "CALL", add, ";".join(x for x in (note, info) if x) or None)
            return False

        # raise
        target = amount
        clamp = None
        if target < min_to:
            target, clamp = min_to, f"asked {amount}, raised to minimum"
        elif target > max_to:
            target, clamp = max_to, f"asked {amount}, capped at all-in"
        add = target - h.committed[s]
        self.stacks[s] -= add
        h.committed[s] = target
        inc = target - h.current_bet
        if inc >= h.min_inc:
            h.min_inc = inc
            h.reopen_level = target
        h.current_bet = target
        h.acted[s] = target
        h.history.append(Event(h.street, s, RAISE, target))
        info = [x for x in (clamp, "allin" if self.stacks[s] == 0 else None) if x]
        self._log(h.street, s, "RAISE", target, ";".join(info) or None)
        return True

    def _observation(self, s, to_call, min_to, max_to, legal) -> Observation:
        h = self.h
        players = tuple(PlayerInfo(i, self.stacks[i], h.committed[i], self._status(i))
                        for i in range(self.n))
        return Observation(
            hand_number=h.number, level=h.level, small_blind=h.sb_amt,
            big_blind=h.bb_amt, ante=h.ante, seat=s, button=h.button,
            small_blind_seat=h.sb, big_blind_seat=h.bb, street=h.street,
            hole=h.hole[s], board=tuple(h.board), players=players,
            pot=sum(h.total), to_call=to_call, min_raise_to=min_to,
            max_raise_to=max_to, legal_actions=legal, history=tuple(h.history),
            max_hands=self.max_hands, time_limit_ms=self.time_limit_ms,
        )

    def _ask(self, s: int, obs: Observation):
        """Call decide() under the time limit. Returns (Action or None, problem)."""
        st = self.stats[s]
        st.decisions += 1
        agent = self.agents[s]
        if agent is None:
            st.errors += 1
            return None, ("ERROR", None, "bot failed to start")
        exc = None
        t0 = time.perf_counter()
        try:
            result = agent.decide(obs)
        except Exception as e:  # noqa: BLE001 - any bot error folds
            result, exc = None, e
        elapsed = time.perf_counter() - t0
        ms = elapsed * 1000.0
        st.total_ms += ms
        st.max_ms = max(st.max_ms, ms)
        if elapsed > self.time_limit:
            st.timeouts += 1
            return None, ("TIMEOUT", None, f"{ms:.3f}ms")
        if exc is not None:
            st.errors += 1
            st.note_error("".join(traceback.format_exception(exc)))
            return None, ("ERROR", None, f"{type(exc).__name__}: {exc}"[:200])
        if not isinstance(result, Action) or result.kind not in ACTION_KINDS:
            st.errors += 1
            msg = f"decide() returned {result!r}"[:200]
            st.note_error(msg)
            return None, ("ERROR", None, msg)
        amount = 0
        if result.kind == RAISE:
            try:
                amount = int(result.amount)
            except (TypeError, ValueError, OverflowError):
                st.errors += 1
                msg = f"bad raise amount {result.amount!r}"[:200]
                st.note_error(msg)
                return None, ("ERROR", None, msg)
        return Action(result.kind, amount), None

    # ------------------------------------------------------------- showdown

    def _left_of_button_key(self, s: int) -> int:
        return (s - self.h.button - 1) % self.n

    def _award(self):
        h = self.h
        live = self._live()
        won = [0] * self.n
        shown: dict[int, tuple] = {}
        street = h.street
        if len(live) == 1:
            w = live[0]
            won[w] = sum(h.total)
            self.stacks[w] += won[w]
            self._log(street, w, "WIN", won[w], "pot=0")
            return won, shown
        street = "showdown"
        scores = {}
        for s in sorted(live, key=self._left_of_button_key):
            scores[s] = evaluate(list(h.hole[s]) + h.board, validate=False)
            shown[s] = h.hole[s]
            self._log(street, s, "SHOW", None,
                      f"{' '.join(h.hole[s])} {describe(scores[s])}")
        for i, (amount, eligible) in enumerate(build_pots(h.total, live)):
            best = max(scores[s] for s in eligible)
            winners = sorted((s for s in eligible if scores[s] == best),
                             key=self._left_of_button_key)
            share, rem = divmod(amount, len(winners))
            for k, w in enumerate(winners):
                got = share + (1 if k < rem else 0)
                won[w] += got
                self.stacks[w] += got
                self._log(street, w, "WIN", got, f"pot={i}")
        return won, shown

    def _finish_hand(self, alive_seats, start_stacks, won, shown) -> None:
        h = self.h
        busted = [s for s in alive_seats if self.stacks[s] == 0]
        remaining = len(alive_seats)
        if busted:
            # More chips at the start of the hand = better place; exact ties share.
            busted.sort(key=lambda s: start_stacks[s], reverse=True)
            place = remaining - len(busted) + 1
            i = 0
            while i < len(busted):
                group = [s for s in busted if start_stacks[s] == start_stacks[busted[i]]]
                places = range(place, place + len(group))
                pts = sum(self.points_for_place(p) for p in places) / len(group)
                for s in group:
                    self.places[s] = place
                    self.points[s] = pts
                    self.alive[s] = False
                    self._log("showdown", s, "BUST", None, f"place={place}")
                place += len(group)
                i += len(group)

        summary = HandSummary(
            hand_number=h.number, board=tuple(h.board), shown=dict(shown),
            won=tuple(won), stacks=tuple(self.stacks), busted=tuple(busted),
            history=tuple(h.history),
        )
        for s in alive_seats:
            self._hook(s, summary)

        alive = [s for s in range(self.n) if self.alive[s]]
        if len(alive) == 1:
            w = alive[0]
            self.places[w] = 1
            self.points[w] = self.points_for_place(1)
            self.finished, self.ended_by = True, "winner"
        elif self.hand_number >= self.max_hands:
            payouts = [self.points_for_place(p) for p in range(1, len(alive) + 1)]
            equity = icm_equity([self.stacks[s] for s in alive], payouts)
            for s, eq in zip(alive, equity):
                self.places[s] = 1 + sum(1 for o in alive if self.stacks[o] > self.stacks[s])
                self.points[s] = eq
            self.finished, self.ended_by = True, "hand_cap"
        if self.finished:
            for s in range(self.n):
                self._log("end", s, "FINISH", round(self.points[s], 3), f"place={self.places[s]}")

    def _hook(self, s: int, summary: HandSummary) -> None:
        agent = self.agents[s]
        fn = getattr(agent, "hand_over", None) if agent is not None else None
        if fn is None:
            return
        st = self.stats[s]
        st.hook_calls += 1
        t0 = time.perf_counter()
        exc = None
        try:
            fn(summary)
        except Exception as e:  # noqa: BLE001
            exc = e
        elapsed = time.perf_counter() - t0
        if elapsed > self.time_limit:
            st.hook_timeouts += 1
        elif exc is not None:
            st.hook_errors += 1
            st.note_error("hand_over() raised:\n" + "".join(traceback.format_exception(exc)))

    # ------------------------------------------------------------------ table

    def run(self) -> TableResult:
        while not self.finished:
            self.play_hand()
        return self.result()

    def result(self) -> TableResult:
        if not self.finished:
            raise RuntimeError("table not finished")
        return TableResult(
            table_id=self.table_id, hands_played=self.hand_number, ended_by=self.ended_by,
            seats=[SeatResult(s, self.names[s], self.places[s], self.points[s],
                              self.stacks[s], self.stats[s]) for s in range(self.n)],
        )
