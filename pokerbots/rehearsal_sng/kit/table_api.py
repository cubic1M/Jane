"""The Agent interface. Your submission subclasses Agent and returns Action objects.

See README.md, section "The Agent interface", for the meaning of every field.
"""

from dataclasses import dataclass
from typing import Mapping

# Action kinds
FOLD = "fold"
CHECK = "check"
CALL = "call"
RAISE = "raise"
ACTION_KINDS = frozenset({FOLD, CHECK, CALL, RAISE})

# Extra event kinds that appear in Observation.history
ANTE = "ante"
SMALL_BLIND = "sb"
BIG_BLIND = "bb"

# Streets
PREFLOP = "preflop"
FLOP = "flop"
TURN = "turn"
RIVER = "river"
STREETS = (PREFLOP, FLOP, TURN, RIVER)

# Player status values
ACTIVE = "active"    # in the hand and can still act
FOLDED = "folded"    # folded this hand
ALLIN = "allin"      # in the hand with no chips behind
OUT = "out"          # eliminated from the table (not dealt in)


@dataclass(frozen=True, slots=True)
class Action:
    """What decide() returns.

    kind is one of "fold", "check", "call", "raise".
    For "raise", amount is the total you will have put in during the current
    betting round once the raise is made (see README). It is ignored otherwise.
    "raise" is also how you make the first bet on a street.
    """
    kind: str
    amount: int = 0

    @classmethod
    def fold(cls) -> "Action":
        return cls(FOLD)

    @classmethod
    def check(cls) -> "Action":
        return cls(CHECK)

    @classmethod
    def call(cls) -> "Action":
        return cls(CALL)

    @classmethod
    def raise_(cls, amount: int) -> "Action":
        return cls(RAISE, amount)


@dataclass(frozen=True, slots=True)
class PlayerInfo:
    seat: int
    stack: int        # chips behind (not counting `committed`)
    committed: int    # chips put in during the current betting round
    status: str       # ACTIVE, FOLDED, ALLIN or OUT


@dataclass(frozen=True, slots=True)
class Event:
    street: str
    seat: int
    kind: str         # ante, sb, bb, fold, check, call, raise
    amount: int       # see README: depends on kind


@dataclass(frozen=True, slots=True)
class Observation:
    hand_number: int              # 1-based, counts hands at this table
    level: int                    # 1-based blind level
    small_blind: int
    big_blind: int
    ante: int
    seat: int                     # your seat
    button: int                   # seat of the dealer button
    small_blind_seat: int
    big_blind_seat: int
    street: str
    hole: tuple                   # your two cards
    board: tuple                  # 0, 3, 4 or 5 cards
    players: tuple                # PlayerInfo for every seat, indexed by seat
    pot: int                      # see README
    to_call: int
    min_raise_to: int             # 0 when raising is not allowed
    max_raise_to: int             # 0 when raising is not allowed
    legal_actions: frozenset
    history: tuple                # Event objects for this hand so far
    max_hands: int
    time_limit_ms: float

    @property
    def me(self) -> PlayerInfo:
        return self.players[self.seat]


@dataclass(frozen=True, slots=True)
class HandSummary:
    hand_number: int
    board: tuple
    shown: Mapping                # seat -> hole cards, for hands that reached showdown
    won: tuple                    # chips each seat collected from the pot this hand
    stacks: tuple                 # stacks after the hand, indexed by seat
    busted: tuple                 # seats eliminated in this hand
    history: tuple                # every Event of the hand


class Agent:
    """Base class for bots. A new instance is created for every table."""

    def decide(self, obs: Observation) -> Action:
        raise NotImplementedError

    def hand_over(self, summary: HandSummary) -> None:
        """Called after every hand you were dealt into. Optional."""
        return None
