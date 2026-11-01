"""GameSpec: everything about a poker variant that the engine and bots need.

A new variant on the day should be expressible by writing one GameSpec (see
variants.py). Bots must read rules from the spec they get in new_match(), never
hard-code them.
"""
from __future__ import annotations

from dataclasses import dataclass, field, replace
from typing import Optional

from .cards import full_deck

STANDARD_ORDER = ("high_card", "pair", "two_pair", "trips", "straight", "flush",
                  "full_house", "quads", "straight_flush")
# Short deck (Triton rules): flush beats full house, trips beat straight.
SHORT_DECK_ORDER = ("high_card", "pair", "two_pair", "straight", "trips", "full_house",
                    "flush", "quads", "straight_flush")
CATEGORY_NAMES = frozenset(STANDARD_ORDER)


@dataclass(frozen=True)
class DiscardRule:
    """Each player discards `count` hole cards at the start of `street`.

    The discard happens after that street's board cards are dealt and before its
    betting round. `to_board`: discarded cards become shared board cards (they are
    always face up then). Otherwise they go to the muck, face up or face down.
    `order`: 'oop_first' = the big blind (out of position postflop) discards first.
    """
    street: int
    count: int = 1
    to_board: bool = True
    face_up: bool = True
    order: str = "oop_first"  # or "ip_first"
    # draw: discarded cards are replaced from the deck (draw poker / "replace" twists)
    draw: bool = False
    # variable discards: a player may discard any number from min_count to count
    # (-1 = exactly count)
    min_count: int = -1


@dataclass(frozen=True)
class GameSpec:
    name: str
    # deck: which ranks are in the deck (0 = '2' .. 12 = 'A'); short deck = range(4, 13)
    deck_ranks: tuple = tuple(range(13))
    hole_cards: int = 2
    # showdown: "any" = best 5 of hole+board; "exactly" = exactly hole_exact hole cards
    hole_usage: str = "any"
    hole_exact: int = 2
    # cards dealt to the board at the start of each street; street 0 is preflop
    board_cards_per_street: tuple = (0, 3, 1, 1)
    discards: tuple = ()  # tuple[DiscardRule, ...]
    category_order: tuple = STANDARD_ORDER
    # straights: ace plays low below the lowest deck rank (A-2-3-4-5, short deck A-6-7-8-9)
    ace_low_straight: bool = True
    small_blind: int = 1
    big_blind: int = 2
    ante: int = 0
    starting_stack: int = 200
    stack_reset_per_hand: bool = True
    players_per_hand: int = 2
    hands_per_match: int = 1000
    betting: str = "no_limit"  # or "pot_limit"
    # time limits (seconds); None = unlimited. Timeout = fold.
    time_per_decision: Optional[float] = None
    time_per_match: Optional[float] = None
    notes: str = ""

    def __post_init__(self):
        self.validate()

    # ---- derived properties -------------------------------------------------
    @property
    def num_streets(self) -> int:
        return len(self.board_cards_per_street)

    @property
    def deck(self) -> list[int]:
        return full_deck(self.deck_ranks)

    @property
    def total_board_dealt(self) -> int:
        return sum(self.board_cards_per_street)

    def discards_on_street(self, street: int) -> list[DiscardRule]:
        return [d for d in self.discards if d.street == street]

    @property
    def final_hole_cards(self) -> int:
        """Hole cards at showdown (draws replace what they discard; a variable discard
        counts at its maximum)."""
        return self.hole_cards - sum(d.count for d in self.discards if not d.draw)

    @property
    def final_board_cards(self) -> int:
        return self.total_board_dealt + sum(
            self.players_per_hand * d.count for d in self.discards if d.to_board)

    @property
    def stack_bb(self) -> float:
        return self.starting_stack / self.big_blind

    def with_(self, **kw) -> "GameSpec":
        return replace(self, **kw)

    # ---- validation -----------------------------------------------------------
    def validate(self) -> None:
        if self.players_per_hand != 2:
            raise ValueError("this engine supports heads-up only (players_per_hand=2)")
        if self.hole_usage not in ("any", "exactly"):
            raise ValueError("hole_usage must be 'any' or 'exactly'")
        if self.betting not in ("no_limit", "pot_limit"):
            raise ValueError("betting must be 'no_limit' or 'pot_limit'")
        if set(self.category_order) != CATEGORY_NAMES or len(self.category_order) != 9:
            raise ValueError("category_order must be a permutation of the 9 categories")
        if not (0 < self.small_blind <= self.big_blind):
            raise ValueError("need 0 < small_blind <= big_blind")
        if self.starting_stack < self.big_blind + self.ante:
            raise ValueError("starting stack must cover the big blind")
        for d in self.discards:
            if not (0 <= d.street < self.num_streets):
                raise ValueError(f"discard street {d.street} out of range")
            if d.order not in ("oop_first", "ip_first"):
                raise ValueError("discard order must be oop_first or ip_first")
            if d.to_board and not d.face_up:
                raise ValueError("discards to the board are face up")
            if d.min_count > d.count:
                raise ValueError("discard min_count above count")
            if d.min_count >= 0 and not d.draw and d.min_count != d.count:
                raise ValueError("a variable discard without draw changes hole-card counts: use draw=True")
        fh = self.final_hole_cards
        if fh < 0:
            raise ValueError("more discards than hole cards")
        if self.hole_usage == "exactly":
            if not (0 <= self.hole_exact <= min(5, fh)):
                raise ValueError("hole_exact out of range")
            if self.final_board_cards < 5 - self.hole_exact:
                raise ValueError("not enough board cards for exact hole usage")
        if fh + self.final_board_cards < 5:
            raise ValueError("fewer than 5 cards at showdown")
        need = 2 * self.hole_cards + self.total_board_dealt
        if need > len(self.deck):
            raise ValueError("deck too small")
