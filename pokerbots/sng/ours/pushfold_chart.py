"""Runtime lookup of the ICM push/fold charts (built by sng/ours/pushfold.py).

Applies to 2-card hold'em on a full deck with the standard ranking (the charts' equity
matrix). decide() returns an action for a first-in shove/fold or for a lone all-in call,
else None (the caller's own logic plays the spot).
"""
from __future__ import annotations

import json
from pathlib import Path

from engine.game import Call, Check, Fold, RaiseTo
from engine.spec import STANDARD_ORDER

from sng.ours.pushfold import CACHE, class_of

_CACHE = {}


def load_chart(rules):
    sp = rules.spec
    if sp.hole_cards != 2 or len(sp.deck) != 52 or tuple(sp.category_order) != STANDARD_ORDER or sp.discards:
        return None
    name = None
    for f in sorted(CACHE.glob("pushfold_*.json")):
        try:
            d = json.loads(f.read_text()) if f not in _CACHE else _CACHE[f].raw
        except Exception:
            continue
        if tuple(d.get("pay", ()))[:rules.num_players] == tuple(rules.payouts)[:rules.num_players]:
            name = f
            break
    if name is None:
        name = CACHE / "pushfold_synthetic.json"
        if not name.exists():
            return None
    if name not in _CACHE:
        _CACHE[name] = Chart(json.loads(name.read_text()))
    return _CACHE[name]


class Chart:
    def __init__(self, raw):
        self.raw = raw
        self.depths = raw["depths"]
        self.shove = {k: [c == "1" for c in v] for k, v in raw["shove"].items()}
        self.call = {k: [c == "1" for c in v] for k, v in raw["call"].items()}

    def _depth(self, eff_bb):
        return min(self.depths, key=lambda d: abs(d - eff_bb))

    @staticmethod
    def _order(obs):
        """Seats in preflop action order (UTG .. SB, BB); heads-up: SB (button), BB."""
        seats = obs.seats
        n = len(seats)
        live = [s for s in range(n) if seats[s].in_hand]
        if len(live) == 2:
            return [obs.sb_seat, obs.bb_seat]
        start = obs.bb_seat
        order = []
        j = start
        for _ in range(n):
            j = (j + 1) % n
            if seats[j].in_hand:
                order.append(j)
        return order                      # ends with SB, BB

    def decide(self, obs, raises, eff_bb):
        lg = obs.legal
        if not obs.history:                                   # no action history: cannot tell first-in spots
            return None
        order = self._order(obs)
        n = len(order)
        if n < 2 or n > 8 or obs.seat not in order:
            return None
        d = self._depth(eff_bb)
        me = order.index(obs.seat)
        cls = class_of(obs.hole)
        vol = [h for h in obs.history if h[1] == 0 and h[2] in ("call", "raise")]
        if not vol:                                           # first in
            if me == n - 1:
                return None                                   # the BB with a walk: own logic
            key = f"{n},{d},{me}"
            if key in self.shove and lg.can_raise:
                return RaiseTo(lg.max_raise_to) if self.shove[key][cls] else (Check() if lg.can_check else Fold())
            return None
        if len(vol) == 1 and vol[0][2] == "raise":           # a lone raise: chart only if it is an all-in shove
            r = vol[0][0]
            sv = obs.seats[r]
            if not (sv.all_in or lg.call_amount >= obs.my_stack) or r not in order:
                return None
            key = f"{n},{d},{me},{order.index(r)}"
            if key in self.call:
                return (Call() if lg.can_call else Check()) if self.call[key][cls] else Fold()
        return None
