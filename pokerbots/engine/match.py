"""Match runner: N hands between two bots with duplicate-friendly dealing.

Seats are fixed for the match; positions alternate: in hand i the bot in seat
(i % 2) is the small blind/button (position 0). Hand i's deck order depends only
on (deal_seed, i), so playing (A, B) and then (B, A) with the same deal_seed
gives each bot exactly the other's cards: duplicate poker.

Time limits: per-decision (spec.time_per_decision) is checked after the call
returns; a late answer is replaced by a fold. The match clock
(spec.time_per_match) is charged for act() and end_hand(); once it runs out the
bot folds every remaining decision without being called.
Exceptions and illegal actions are folds and are counted.
"""
from __future__ import annotations

import time
import traceback
from dataclasses import dataclass, field
from typing import Optional

import numpy as np

from .bot import Bot
from .cards import cards_str
from .game import Action, Fold, HandState
from .spec import GameSpec


def deal_order(spec: GameSpec, deal_seed: int, hand_index: int) -> list[int]:
    rng = np.random.default_rng([int(deal_seed), int(hand_index), 7919])
    deck = np.array(spec.deck, dtype=np.int64)
    return [int(c) for c in rng.permutation(deck)]


@dataclass
class SeatStats:
    decisions: int = 0
    total_time: float = 0.0
    max_time: float = 0.0
    timeouts: int = 0
    illegal: int = 0
    errors: int = 0
    clock_outs: int = 0
    times: list = field(default_factory=list)
    first_error: Optional[str] = None

    def summary(self) -> dict:
        t = np.array(self.times) if self.times else np.zeros(1)
        return dict(decisions=self.decisions, mean_ms=1e3 * self.total_time / max(1, self.decisions),
                    max_ms=1e3 * self.max_time, p99_ms=1e3 * float(np.percentile(t, 99)),
                    timeouts=self.timeouts, illegal=self.illegal, errors=self.errors,
                    clock_outs=self.clock_outs, first_error=self.first_error)


@dataclass
class MatchResult:
    spec_name: str
    deal_seed: int
    names: tuple                 # (seat0 bot name, seat1 bot name)
    deltas: np.ndarray           # (hands,) chips won by seat 0 per hand (seat 1 = -delta)
    stats: tuple                 # (SeatStats seat0, SeatStats seat1)
    big_blind: int
    logs: Optional[list] = None
    hands_played: int = 0

    @property
    def total(self) -> int:
        return int(self.deltas.sum())

    def bb_per_hand(self, seat: int = 0) -> float:
        v = self.deltas.sum() / self.big_blind / max(1, len(self.deltas))
        return float(v if seat == 0 else -v)


def play_match(bot0: Bot, bot1: Bot, spec: GameSpec, deal_seed: int, bot_seeds=(None, None),
               hands: Optional[int] = None, record: bool = False, keep_times: bool = True,
               decision_limit: Optional[float] = "spec") -> MatchResult:
    bots = (bot0, bot1)
    n_hands = spec.hands_per_match if hands is None else hands
    if decision_limit == "spec":
        decision_limit = spec.time_per_decision
    stats = (SeatStats(), SeatStats())
    clock = [spec.time_per_match, spec.time_per_match]
    for s, b in enumerate(bots):
        seed = bot_seeds[s] if bot_seeds[s] is not None else (deal_seed * 1000003 + 17 * s + 1)
        t0 = time.perf_counter()
        b.new_match(spec, seed)
        if clock[s] is not None:
            clock[s] -= time.perf_counter() - t0
    deltas = np.zeros(n_hands, dtype=np.int64)
    bankroll = [0, 0]
    stacks = [spec.starting_stack, spec.starting_stack]
    logs = [] if record else None
    played = 0
    for i in range(n_hands):
        if not spec.stack_reset_per_hand and min(stacks) < spec.big_blind + spec.ante:
            break  # someone is busted
        btn_seat = i % 2
        seat_of_pos = (btn_seat, 1 - btn_seat)
        pos_stacks = None if spec.stack_reset_per_hand else [stacks[seat_of_pos[0]], stacks[seat_of_pos[1]]]
        state = HandState(spec, deal_order(spec, deal_seed, i), stacks=pos_stacks, hand_index=i,
                          bankrolls=(bankroll[seat_of_pos[0]], bankroll[seat_of_pos[1]]),
                          time_left=(clock[seat_of_pos[0]], clock[seat_of_pos[1]]))

        def decide(pos: int, obs) -> Action:
            seat = seat_of_pos[pos]
            st = stats[seat]
            st.decisions += 1
            if clock[seat] is not None and clock[seat] <= 0:
                st.clock_outs += 1
                return Fold()
            t0 = time.perf_counter()
            try:
                a = bots[seat].act(obs)
            except Exception:  # bot bug = fold
                a = Fold()
                st.errors += 1
                if st.first_error is None:
                    st.first_error = traceback.format_exc()
            dt = time.perf_counter() - t0
            st.total_time += dt
            if dt > st.max_time:
                st.max_time = dt
            if keep_times:
                st.times.append(dt)
            if clock[seat] is not None:
                clock[seat] -= dt
                state.time_left[pos] = clock[seat]
            if decision_limit is not None and dt > decision_limit:
                st.timeouts += 1
                return Fold()
            if obs.phase == "discard":
                ok = obs.legal.is_legal(a, obs.my_cards)
            else:
                ok = obs.legal.is_legal(a)
            if not ok:
                st.illegal += 1
                if st.illegal <= 3 and st.first_error is None:
                    st.first_error = f"illegal action {a!r} with legal={obs.legal} phase={obs.phase}"
                return Fold()
            return a

        pos_deltas = state.play(decide)
        d0 = pos_deltas[0] if seat_of_pos[0] == 0 else pos_deltas[1]
        deltas[i] = d0
        bankroll[0] += d0
        bankroll[1] -= d0
        if not spec.stack_reset_per_hand:
            stacks[0] += d0
            stacks[1] -= d0
        for pos in (0, 1):
            seat = seat_of_pos[pos]
            t0 = time.perf_counter()
            try:
                bots[seat].end_hand(state.result_for(pos))
            except Exception:
                stats[seat].errors += 1
                if stats[seat].first_error is None:
                    stats[seat].first_error = traceback.format_exc()
            if clock[seat] is not None:
                clock[seat] -= time.perf_counter() - t0
        if record:
            logs.append(dict(hand=i, button_seat=btn_seat,
                             cards=[cards_str(state.hole[seat_of_pos.index(s)] + state.discards[seat_of_pos.index(s)]) for s in (0, 1)],
                             board=cards_str(state.board),
                             actions=[(seat_of_pos[pos], st, kind, amt, cards_str(c))
                                      for (pos, st, kind, amt, c, fu) in state.history],
                             delta_seat0=int(d0), showdown=state.showdown))
        played += 1
    for b in bots:
        try:
            b.end_match()
        except Exception:
            pass
    return MatchResult(spec_name=spec.name, deal_seed=deal_seed,
                       names=(getattr(bot0, "name", "bot0"), getattr(bot1, "name", "bot1")),
                       deltas=deltas, stats=stats, big_blind=spec.big_blind, logs=logs,
                       hands_played=played)
