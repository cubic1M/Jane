"""Rules of the rehearsal event: heads-up Pot-Limit Irish Hold'em.

This module is the organisers' source of truth. It has no I/O: a hand asks a
`decide(seat, message) -> str | None` callback for every decision.

Seats are numbered per hand: seat 0 = big blind, seat 1 = dealer (small blind).
"""
from __future__ import annotations

from collections import Counter
from itertools import combinations

import numpy as np

SMALL_BLIND = 5
BIG_BLIND = 10
STACK = 1500            # chips each player starts every hand with (150 big blinds)
HOLE_CARDS = 4
DISCARD_COUNT = 2       # each player discards 2 face up to the muck after the flop is dealt
HANDS_PER_MATCH = 1000
ACTION_TIMEOUT = 1.0    # seconds per decision
TIME_BANK = 120.0       # seconds per bot per match
STREETS = ("preflop", "flop", "turn", "river")
BOARD_PER_STREET = (0, 3, 1, 1)

RANKS = ("2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A")
SUITS = ("s", "h", "d", "c")
CATEGORIES = ("high card", "pair", "two pair", "three of a kind", "straight", "flush",
              "full house", "four of a kind", "straight flush")


# ---- cards: internal int = suit * 13 + rank (rank 0 = '2' .. 12 = 'A') -------------
def card_str(c: int) -> str:
    return RANKS[c % 13] + SUITS[c // 13]


CARD_OF = {card_str(c): c for c in range(52)}


def parse_card(s: str) -> int:
    """Exact protocol spelling only, e.g. 'Ah', '10d', '7c'. Raises KeyError otherwise."""
    return CARD_OF[s]


def strs(cards) -> list[str]:
    return [card_str(c) for c in cards]


def shuffled_deck(seed: int, hand_no: int) -> list[int]:
    return [int(c) for c in np.random.default_rng([seed, hand_no]).permutation(52)]


# ---- hand evaluation ----------------------------------------------------------------
def rank5(cards) -> tuple:
    """Comparable value of exactly five cards; higher is better."""
    rs = sorted((c % 13 for c in cards), reverse=True)
    flush = len({c // 13 for c in cards}) == 1
    uniq = sorted(set(rs), reverse=True)
    high = -1
    if len(uniq) == 5:
        if uniq[0] - uniq[4] == 4:
            high = uniq[0]
        elif uniq == [12, 3, 2, 1, 0]:  # A-2-3-4-5: the ace plays low
            high = 3
    if high >= 0:
        return (8 if flush else 4, high)
    if flush:
        return (5, *rs)
    groups = sorted(Counter(rs).items(), key=lambda kv: (kv[1], kv[0]), reverse=True)
    shape = tuple(n for _, n in groups)
    cat = {(4, 1): 7, (3, 2): 6, (3, 1, 1): 3, (2, 2, 1): 2, (2, 1, 1, 1): 1,
           (1, 1, 1, 1, 1): 0}[shape]
    return (cat, *(r for r, _ in groups))


def best_hand(cards) -> tuple:
    """Best five of any number (>= 5) of cards."""
    return max(rank5(c) for c in combinations(cards, 5))


# ---- one hand -----------------------------------------------------------------------
class Hand:
    def __init__(self, hand_no: int, deck: list[int]):
        self.hand_no = hand_no
        self.hole = [deck[0:4], deck[4:8]]          # by seat
        self.runout = deck[8:13]
        self.board: list[int] = []
        self.discards: list[list[int]] = [[], []]
        self.stacks = [STACK, STACK]                # behind
        self.committed = [0, 0]                     # this hand
        self.bets = [0, 0]                          # this street
        self.actions: list[list] = []               # [seat, "text"], visible to both
        self.street = 0
        self.folded: int | None = None
        self.illegal: list[tuple] = []              # (seat, reply) for the log
        self.showdown = False
        self.values = None

    # chips --------------------------------------------------------------------
    def _put(self, seat: int, amount: int) -> None:
        amount = min(amount, self.stacks[seat])
        self.stacks[seat] -= amount
        self.bets[seat] += amount
        self.committed[seat] += amount

    def legal(self, seat: int, last_inc: int) -> dict:
        opp = 1 - seat
        to_call = min(max(self.bets) - self.bets[seat], self.stacks[seat])
        acts = ["fold", "call"] if to_call > 0 else ["check"]
        max_by = min(self.stacks[seat] - to_call, self.stacks[opp],
                     sum(self.committed) + to_call)        # pot limit
        raise_by = None
        if max_by > 0:
            acts.append("raise")
            raise_by = [min(last_inc, max_by), max_by]
        return {"to_call": to_call, "legal": acts, "raise_by": raise_by}

    def message(self, seat: int, phase: str, extra: dict) -> dict:
        return {"type": "act", "hand": self.hand_no, "seat": seat,
                "street": STREETS[self.street], "phase": phase,
                "hole": strs(self.hole[seat]), "board": strs(self.board),
                "discards": [strs(d) for d in self.discards],
                "pot": sum(self.committed), "bets": list(self.bets),
                "stacks": list(self.stacks), "actions": [list(a) for a in self.actions],
                **extra}

    # play ---------------------------------------------------------------------
    def play(self, decide) -> list[int]:
        """Plays the hand; returns chip deltas by seat (they sum to zero)."""
        self._put(1, SMALL_BLIND)
        self.actions.append([1, f"post {SMALL_BLIND}"])
        self._put(0, BIG_BLIND)
        self.actions.append([0, f"post {BIG_BLIND}"])
        for street in range(len(STREETS)):
            self.street = street
            if street > 0:
                self.bets = [0, 0]
                n = BOARD_PER_STREET[street]
                self.board += self.runout[:n]
                self.runout = self.runout[n:]
            if street == 1:
                for seat in (1, 0):                  # the dealer discards first
                    self._discard(seat, decide)
                    if self.folded is not None:
                        return self._finish()
            self._betting(decide)
            if self.folded is not None:
                return self._finish()
        self.showdown = True
        return self._finish()

    def _fold(self, seat: int, reply) -> None:
        if reply is None or reply.strip().lower() != "fold":
            self.illegal.append((seat, reply))
        self.folded = seat
        self.actions.append([seat, "fold"])

    def _discard(self, seat: int, decide) -> None:
        msg = self.message(seat, "discard", {"to_call": 0, "legal": ["discard"],
                                             "raise_by": None, "discard_count": DISCARD_COUNT})
        reply = decide(seat, msg)
        parts = (reply or "").split()
        try:
            if len(parts) != 1 + DISCARD_COUNT or parts[0].lower() != "discard":
                raise ValueError
            cards = [parse_card(p) for p in parts[1:]]
            if len(set(cards)) != DISCARD_COUNT or any(c not in self.hole[seat] for c in cards):
                raise ValueError
        except (ValueError, KeyError):
            self._fold(seat, reply)
            return
        for c in cards:
            self.hole[seat].remove(c)
            self.discards[seat].append(c)
        self.actions.append([seat, "discard " + " ".join(strs(cards))])

    def _parse_bet(self, reply, lg) -> tuple | None:
        parts = (reply or "").strip().lower().split()
        if not parts or parts[0] not in lg["legal"]:
            return None
        if parts[0] == "raise":
            if len(parts) != 2 or not parts[1].isdigit():
                return None
            n = int(parts[1])
            lo, hi = lg["raise_by"]
            return ("raise", n) if lo <= n <= hi else None
        return (parts[0], 0) if len(parts) == 1 else None

    def _betting(self, decide) -> None:
        seat = 1 if self.street == 0 else 0          # dealer first preflop, BB first after
        acted = [False, False]
        last_inc = BIG_BLIND

        def settled(q):
            return self.stacks[q] == 0 or (acted[q] and self.bets[q] == max(self.bets))

        while not (settled(0) and settled(1)):
            opp = 1 - seat
            if self.stacks[seat] == 0 or (self.stacks[opp] == 0 and self.bets[seat] >= self.bets[opp]):
                acted[seat] = True
                seat = opp
                continue
            lg = self.legal(seat, last_inc)
            reply = decide(seat, self.message(seat, "bet", lg))
            act = self._parse_bet(reply, lg)
            acted[seat] = True
            if act is None or act[0] == "fold":
                self._fold(seat, reply)
                return
            kind, n = act
            if kind == "check":
                self.actions.append([seat, "check"])
            elif kind == "call":
                self._put(seat, lg["to_call"])
                self.actions.append([seat, "call"])
            else:
                self._put(seat, lg["to_call"] + n)
                last_inc = max(last_inc, n)
                acted[opp] = False
                self.actions.append([seat, f"raise {n}"])
            seat = opp

    def _finish(self) -> list[int]:
        if self.folded is not None:
            # the folder loses what they put in; any uncalled raise goes back to the raiser
            w, won = 1 - self.folded, self.committed[self.folded]
        else:
            won = min(self.committed)   # equal stacks every hand: no side pots
            self.values = [best_hand(self.hole[s] + self.board) for s in (0, 1)]
            if self.values[0] == self.values[1]:
                return [0, 0]
            w = 0 if self.values[0] > self.values[1] else 1
        d = [0, 0]
        d[w], d[1 - w] = won, -won
        return d

    def end_message(self, seat: int, deltas: list[int]) -> dict:
        return {"type": "hand_end", "hand": self.hand_no, "seat": seat, "result": deltas[seat],
                "showdown": self.showdown, "folded": self.folded,
                "board": strs(self.board), "discards": [strs(d) for d in self.discards],
                "shown": [strs(h) for h in self.hole] if self.showdown else None,
                "actions": [list(a) for a in self.actions]}
