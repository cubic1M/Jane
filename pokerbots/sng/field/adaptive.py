"""adaptive: a chen_tag that keeps per-seat stats within the table (state resets per
table, opponents are anonymous) and exploits them. The "strong team" design.

Stats from every hand's history (end_hand), with a prior worth a few hands:
  VPIP (voluntarily called/raised preflop), PFR, fold-to-raise preflop, fold-to-bet
  postflop, and call-a-bet postflop.
Exploits:
  * steals: unopened in late position / the blinds, the open range scales with the
    average fold-to-raise of the players still to act (up to ~45% vs pure folders);
  * vs a loose opener (PFR > 25%): 3-bets up to ~10% and calls a bit wider;
  * postflop vs callers (call-a-bet > 55%): value-bets thinner (any pair) and bigger
    (0.9 pot with top pair+), never bluffs; vs folders (fold-to-bet > 55%): c-bets and
    stabs with any hand heads-up, barrels the turn.
"""
from __future__ import annotations

from collections import defaultdict

from .common import TOP_PAIR, WEAK_PAIR, bet_pot, passive
from .tag import ChenTag


class SeatStats:
    """Counters per seat; rates are smoothed towards a prior (rate, weight)."""

    def __init__(self):
        self.c = defaultdict(lambda: defaultdict(int))

    def rate(self, seat, hit, opp, prior=0.5, weight=4):
        d = self.c[seat]
        return (d[hit] + prior * weight) / (d[opp] + weight)

    def update(self, history):
        raised = False
        seen = set()
        postflop_bet = {}                     # street -> a bet is pending
        for seat, street, kind, _amt in history:
            d = self.c[seat]
            if kind == "post":
                continue
            if street == 0:
                if seat not in seen:
                    seen.add(seat)
                    d["hands"] += 1
                    if kind in ("call", "raise"):
                        d["vpip"] += 1
                    if kind == "raise":
                        d["pfr"] += 1
                if raised:
                    d["faced_raise"] += 1
                    d["fold_raise"] += kind == "fold"
                raised = raised or kind == "raise"
            else:
                if postflop_bet.get(street):
                    d["faced_bet"] += 1
                    d["fold_bet"] += kind == "fold"
                    d["call_bet"] += kind == "call"
                if kind == "raise":
                    postflop_bet[street] = True

    def vpip(self, s):
        return self.rate(s, "vpip", "hands", 0.3)

    def pfr(self, s):
        return self.rate(s, "pfr", "hands", 0.15)

    def fold_to_raise(self, s):
        return self.rate(s, "fold_raise", "faced_raise", 0.6)

    def fold_to_bet(self, s):
        return self.rate(s, "fold_bet", "faced_bet", 0.45)

    def call_bet(self, s):
        return self.rate(s, "call_bet", "faced_bet", 0.4)


class Adaptive(ChenTag):
    name = "adaptive"

    def reset(self):
        self.stats = SeatStats()

    def end_hand(self, info):
        self.stats.update(info["history"])

    def _opps(self, obs, live_only=True):
        return [s.seat for s in obs.seats if s.in_hand and s.seat != obs.seat
                and (not live_only or not s.folded)]

    # ---- preflop ---------------------------------------------------------------------
    def open_range(self, obs, sit):
        base = self.open_top[sit.position]
        if sit.position not in ("late", "blind") or sit.limpers:
            return base
        st = self.stats
        n = len(obs.seats)
        behind = [(obs.seat + k) % n for k in range(1, n)]
        behind = [j for j in behind if j in self._opps(obs)][:sit.behind]
        if not behind:
            return base
        folds = sum(st.fold_to_raise(j) for j in behind) / len(behind)
        return max(0.08, min(0.45, base * (1 + 3 * (folds - 0.6))))

    def _loose_raiser(self, sit):
        return sit.last_raiser >= 0 and self.stats.pfr(sit.last_raiser) > 0.25

    def threebet_range(self, obs, sit):
        return 0.10 if self._loose_raiser(sit) else self.threebet_top

    def call_range(self, obs, sit):
        return 0.12 if self._loose_raiser(sit) else self.call_top

    # ---- postflop --------------------------------------------------------------------
    def checked_to(self, obs, sit, tier, draw):
        opps = self._opps(obs)
        st = self.stats
        callers = sum(st.call_bet(j) for j in opps) / max(1, len(opps))
        folders = sum(st.fold_to_bet(j) for j in opps) / max(1, len(opps))
        if callers > 0.55:
            if tier >= TOP_PAIR:
                return bet_pot(obs, 0.9)
            if tier >= WEAK_PAIR:
                return bet_pot(obs, 0.5)
            return passive(obs)
        if folders > 0.55 and sit.opps == 1 and obs.street <= 2:
            return bet_pot(obs, 0.6)
        return super().checked_to(obs, sit, tier, draw)
