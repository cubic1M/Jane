"""f5_nash: Nash push/fold (precomputed equilibrium, ICM bubble factors) at or below 15 bb,
solid tight-aggressive deeper. Keeps no opponent reads."""
from __future__ import annotations

from .core import Base, bubble_factors


class NashBot(Base):
    P = dict(Base.P, pf_depth=15.0)

    def end_hand(self, info):
        # no reads: only the stacks (for ICM) are kept
        self.stacks = list(info["stacks"])
        if self.stacks[self.seat] > 0:
            self.bf = bubble_factors(self.stacks, self.seat, self.payouts)
