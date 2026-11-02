"""icm_lite: icm_tag's decision rules on a strength table simple enough to rebuild in
minutes on the day (plan B, report/sng_bot_spec.md).

Table (Monte Carlo with any evaluator that returns a hand category):
  * preflop: equity of each of the 169 hold'em classes vs k = 1..7 random hands;
  * postflop: equity keyed by (street, my best-hand category, the board's own category,
    k) where "the board's category" is what the board alone makes (a pair on the board
    is not my pair).
Runtime: two dict lookups and one category evaluation of my hand (pure Python).

    python3 -m sng.ours.lite --variant a_nlhe100 --seconds 120     # builds cache/sng/lite_<v>.json
"""
from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

import numpy as np

from sng.ours.icm_tag import IcmTag

ROOT = Path(__file__).resolve().parents[2]
CATS = ("high_card", "pair", "two_pair", "trips", "straight", "flush", "full_house", "quads", "straight_flush")


def pre_class(hole) -> str:
    a, b = sorted(hole, key=lambda c: -(c >> 2))
    ra, rb = a >> 2, b >> 2
    if ra == rb:
        return f"{ra},{rb},p"
    return f"{ra},{rb},{'s' if (a & 3) == (b & 3) else 'o'}"


def build(spec, seconds=120.0, seed=0):
    from engine.evaluator import get_evaluator
    ev = get_evaluator(spec)
    cat_of = ev.category
    rng = np.random.default_rng(seed)
    deck = np.array(spec.deck)
    h = spec.hole_cards
    streets = []           # number of board cards visible at each postflop street
    s = 0
    for n in spec.board_cards_per_street[1:]:
        s += n
        streets.append(s)
    nb = spec.total_board_dealt
    pre = {}               # (class, k) -> [sum, n]
    post = {}              # (street, cat, board_cat, k) -> [sum, n]
    t_end = time.time() + seconds
    batch = 2000
    deals = 0
    while time.time() < t_end:
        cards = np.array([rng.permutation(deck)[:8 * h + nb] for _ in range(batch)])
        holes = cards[:, :8 * h].reshape(batch, 8, h)
        board = cards[:, 8 * h:]
        final = np.stack([ev.evaluate_batch(holes[:, i], board) for i in range(8)], axis=1)   # (B, 8)
        for k in range(1, 8):
            best_opp = final[:, 1:k + 1].max(axis=1)
            me = final[:, 0]
            ties = (final[:, :k + 1] == me[:, None]).sum(axis=1)
            share = np.where(me > best_opp, 1.0, np.where(me == best_opp, 1.0 / ties, 0.0))
            for i in range(batch):
                key = (pre_class(holes[i, 0]), k)
                acc = pre.setdefault(key, [0.0, 0])
                acc[0] += share[i]
                acc[1] += 1
            for si, nvis in enumerate(streets[:-1] + [nb]):
                if nvis < 3:
                    continue
                vis = board[:, :nvis]
                mine = ev.eval_any(np.concatenate([holes[:, 0], vis], axis=1)) if nvis + h >= 5 else None
                bcat = ev.eval_any(vis) if nvis >= 5 else None
                for i in range(batch):
                    c = cat_of(int(mine[i])) if mine is not None else "high_card"
                    bc = cat_of(int(bcat[i])) if bcat is not None else _board_cat(vis[i])
                    key = (si + 1, c, bc, k)
                    acc = post.setdefault(key, [0.0, 0])
                    acc[0] += share[i]
                    acc[1] += 1
        deals += batch
    to = lambda d: {"|".join(map(str, k)): round(v[0] / v[1], 4) for k, v in d.items() if v[1] >= 20}
    return dict(pre=to(pre), post=to(post), deals=deals, seconds=seconds)


def _board_cat(cards):
    """Category of fewer than 5 board cards by rank counts only (pair/trips/quads)."""
    from collections import Counter
    m = max(Counter(int(c) >> 2 for c in cards).values())
    return {1: "high_card", 2: "pair", 3: "trips", 4: "quads"}[m]


class LiteStrength:
    def __init__(self, spec, table):
        from engine.evaluator import get_evaluator
        from sng.ours import features as F
        self.ev = get_evaluator(spec)
        self.F, self.ctx = F, F.get_ctx(spec)
        self.pre = table["pre"]
        self.post = table["post"]
        self._cache = {}

    def equity(self, hole, board, k):
        k = max(1, min(7, int(round(k))))
        if not board:
            return self.pre.get(f"{pre_class(hole)}|{k}", 1.0 / (k + 1))
        key = (tuple(hole), tuple(board))
        cats = self._cache.get(key)
        if cats is None:
            # pure-Python scores (identical to the engine's, ~12 us instead of ~100 us of numpy)
            c = self.ev.category(self.F.evaluate(self.ctx, hole, board)[0])
            bc = self.ev.category(self.F.evaluate(self.ctx, (), board)[0]) if len(board) >= 5 else _board_cat(board)
            st = {3: 1, 4: 2, 5: 3}.get(len(board), 3)
            cats = self._cache[key] = (st, c, bc)
        st, c, bc = cats
        return self.post.get(f"{st}|{c}|{bc}|{k}", 1.0 / (k + 1))


_TABLES = {}


class IcmLite(IcmTag):
    """icm_tag decisions, lite strength."""
    name = "icm_lite"

    def new_table(self, rules, seat, seed=0):
        super().new_table(rules, seat, seed)
        from engine.spec import STANDARD_ORDER
        sp = rules.spec
        self.L = None
        own = ROOT / "cache" / "sng" / f"lite_{sp.name}.json"
        holdem = (sp.hole_cards == 2 and len(sp.deck) == 52 and tuple(sp.category_order) == STANDARD_ORDER
                  and not sp.discards and tuple(sp.board_cards_per_street) == (0, 3, 1, 1))
        name = sp.name if own.exists() else ("a_nlhe100" if holdem else None)
        if name is None:
            return                     # no lite table for these card rules: icm_tag's own strength
        if name not in _TABLES:
            _TABLES[name] = LiteStrength(sp, json.loads((ROOT / "cache" / "sng" / f"lite_{name}.json").read_text()))
        self.L = _TABLES[name]

    def _eq(self, obs, k):
        if self.L is None:
            return super()._eq(obs, k)
        return self.L.equity(obs.hole, obs.board, k)


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--variant", default="a_nlhe100")
    ap.add_argument("--seconds", type=float, default=120)
    a = ap.parse_args(argv)
    from engine.variants import get_variant
    spec = get_variant(a.variant)
    t0 = time.time()
    tab = build(spec, a.seconds)
    out = ROOT / "cache" / "sng" / f"lite_{a.variant}.json"
    out.write_text(json.dumps(tab))
    print(f"{out}: {len(tab['pre'])} preflop keys, {len(tab['post'])} postflop keys, {tab['deals']} deals, "
          f"{time.time() - t0:.0f}s")


if __name__ == "__main__":
    main()
