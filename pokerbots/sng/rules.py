"""Sit-and-go rules (No Limit: A Bot Building Tournament, official rules §3-4).

Confirmed by the official rules page: 8 bots per table, 2,000 starting chips, blinds
start at 10/20 and rise every 25 hands, the table ends when one bot has all the chips
or after 200 hands, points by finishing position, survivors at the cap share the
remaining points by ICM, 1 ms per decision, an error or timeout checks if possible
else folds, bot state resets per table.

NOT published (labelled SYNTHETIC, replace on the day from the starter kit): the
blind amounts after level 1, antes, the point table, the poker variant itself.
"""
from __future__ import annotations

from dataclasses import dataclass, field, replace

from engine.spec import GameSpec

NLHE = GameSpec(name="sng_nlhe", starting_stack=2000, small_blind=10, big_blind=20,
                stack_reset_per_hand=False, notes="No-limit hold'em card rules for sit-and-gos")

# SYNTHETIC: a common turbo-like progression from the confirmed first level 10/20
SYNTHETIC_BLINDS = ((10, 20), (15, 30), (25, 50), (50, 100), (75, 150), (100, 200), (150, 300), (200, 400))
BLIND_SETS = {
    "synthetic": SYNTHETIC_BLINDS,
    # doubling every level: 10/20 .. 1280/2560 (very fast; lots of push/fold)
    "fast": tuple((10 * 2 ** i, 20 * 2 ** i) for i in range(8)),
    # +25% per level, rounded: a slow, deep structure
    "slow": ((10, 20), (15, 25), (15, 30), (20, 40), (25, 50), (30, 60), (40, 80), (50, 100)),
}
# SYNTHETIC: points by finishing place 1..8
SYNTHETIC_PAYOUTS = (100, 65, 45, 30, 20, 12, 6, 0)
PAYOUT_SETS = {
    "synthetic": SYNTHETIC_PAYOUTS,
    "top3": (50, 30, 20, 0, 0, 0, 0, 0),          # classic SNG
    "winner": (100, 0, 0, 0, 0, 0, 0, 0),
    "linear": (7, 6, 5, 4, 3, 2, 1, 0),
}


@dataclass(frozen=True)
class SngRules:
    spec: GameSpec = NLHE                 # card rules: deck, hole cards, board, ranking, limit
    num_players: int = 8
    starting_stack: int = 2000
    blinds: tuple = SYNTHETIC_BLINDS      # (small, big) per level; the last level repeats
    antes: tuple = ()                     # ante per level (empty = none)
    hands_per_level: int = 25
    max_hands: int = 200
    payouts: tuple = SYNTHETIC_PAYOUTS    # points for places 1..num_players
    time_limit: float = 0.001             # seconds per decision
    enforce_time: bool = True             # over the limit -> check if possible, else fold
    name: str = "sng_nlhe"

    def level(self, hand_number: int) -> int:
        return min(hand_number // self.hands_per_level, len(self.blinds) - 1)

    def blinds_for(self, hand_number: int):
        lv = self.level(hand_number)
        ante = self.antes[min(lv, len(self.antes) - 1)] if self.antes else 0
        sb, bb = self.blinds[lv]
        return sb, bb, ante

    def with_(self, **kw) -> "SngRules":
        return replace(self, **kw)

    def validate(self):
        if len(self.payouts) < self.num_players:
            raise ValueError("need one payout per finishing place")
        n, sp = self.num_players, self.spec
        if sp.hole_cards * n + sp.total_board_dealt > len(sp.deck):
            raise ValueError("deck too small for this many players")
        # draws beyond the stub reuse the dead discards (reshuffled), as in real draw games
