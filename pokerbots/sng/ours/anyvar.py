"""Variant-agnostic strength model and discard/draw policy (any rules the engine can play).

For variants without a feature table (discard and draw games, or anything new) the
strength is learned by SIMULATING the actual variant: deal eight hands and the board,
play every discard/draw phase with the same policy the bot uses, and record each hand's
final pot share against 1..7 opponents, keyed by what the bot can see when it bets:
  * preflop:  a hole-card class (exact for 2 cards; coarse shape for 3+ cards);
  * later:    (street, my hand category now, the board's own category, flush-draw flag).
Runtime: one pure-Python evaluation (~12 us) plus dict lookups. Discards: enumerate the
options (at most a few dozen) and keep the best.

    python3 -m sng.ours.anyvar --spec <module:NAME> --seconds 120     # builds cache/sng/any_<sig>.json
"""
from __future__ import annotations

import argparse
import hashlib
import json
import random
import time
from itertools import combinations
from pathlib import Path

from sng.ours import features as F

ROOT = Path(__file__).resolve().parents[2]
CACHE = ROOT / "cache" / "sng"


def sig_hash(spec) -> str:
    return hashlib.sha1(repr(F.card_signature(spec)).encode()).hexdigest()[:12]


def table_path(spec) -> Path:
    return CACHE / f"any_{sig_hash(spec)}.json"


# ---- keys ------------------------------------------------------------------------------
def _cat(ctx, hole, board):
    return F.evaluate(ctx, hole, board)[0] >> 20 if (len(hole) + len(board)) else 0


def hole_key(hole) -> str:
    rs = sorted((c >> 2 for c in hole), reverse=True)
    if len(hole) == 2:
        a, b = sorted(hole, key=lambda c: -(c >> 2))
        t = "p" if rs[0] == rs[1] else ("s" if (a & 3) == (b & 3) else "o")
        return f"{rs[0]},{rs[1]},{t}"
    counts = sorted((rs.count(r) for r in set(rs)), reverse=True)
    suits = [0, 0, 0, 0]
    for c in hole:
        suits[c & 3] += 1
    distinct = sorted(set(rs), reverse=True)
    run = best = 1
    for x, y in zip(distinct, distinct[1:]):
        run = run + 1 if x - y == 1 else 1
        best = max(best, run)
    return f"{''.join(map(str, counts))},{rs[0]},{distinct[1] if len(distinct) > 1 else -1},{max(suits)},{best}"


def post_key(ctx, hole, board, street) -> str:
    cards = list(hole) + list(board)
    suits = [0, 0, 0, 0]
    for c in cards:
        suits[c & 3] += 1
    fd = int(max(suits) == 4)
    return f"{street},{_cat(ctx, hole, board)},{_cat(ctx, (), board) if board else 0},{fd}"


# ---- discard / draw policy (shared by the simulator and the bot) -----------------------
def _kept_value(ctx, kept, board, draw: bool):
    """Score a kept set. Without a draw: the full score of kept + board. With a draw:
    the category made now (kickers ignored), then four-to-a-flush / -straight, then
    high cards, so that drawing to a pair beats holding a weak kicker."""
    score = F.evaluate(ctx, kept, board)[0] if (len(kept) + len(board)) else 0
    if not draw:
        return (score,)
    cat = score >> 20
    cards = list(kept) + list(board)
    suits = [0, 0, 0, 0]
    for c in cards:
        suits[c & 3] += 1
    rs = sorted({c >> 2 for c in cards})
    run = best = 1
    for x, y in zip(rs, rs[1:]):
        run = run + 1 if y - x == 1 else 1
        best = max(best, run)
    drawish = 2 if max(suits) >= 4 else (1 if best >= 4 else 0)
    top = max((c >> 2 for c in kept), default=-1)
    # made pairs+ first; with nothing made, a strong draw; then the highest kept card;
    # prefer discarding more when otherwise equal (more chances to improve)
    return (cat if cat > 0 else 0, drawish if cat == 0 else 0, top if cat == 0 else 0, -len(kept))


def choose_discard(ctx, hole, board, n_min, n_max, draw, to_board):
    best, best_v = None, None
    hole = tuple(hole)
    for n in range(n_min, n_max + 1):
        for out in combinations(hole, n):
            kept = tuple(c for c in hole if c not in out)
            b = tuple(board) + (out if to_board else ())
            v = _kept_value(ctx, kept, b, draw)
            if best_v is None or v > best_v:
                best, best_v = out, v
    return best if best is not None else ()


# ---- simulation build ----------------------------------------------------------------------
def build(spec, seconds=120.0, seed=0, players=8):
    ctx = F.get_ctx(spec)
    rng = random.Random(seed)
    from engine.evaluator import get_evaluator
    ev = get_evaluator(spec)
    deck0 = list(spec.deck)
    h = spec.hole_cards
    streets = spec.board_cards_per_street
    pre, post = {}, {}
    t_end = time.time() + seconds
    deals = 0
    while time.time() < t_end:
        deck = deck0[:]
        rng.shuffle(deck)
        holes = [tuple(deck[i * h:(i + 1) * h]) for i in range(players)]
        stub = deck[players * h:]
        board = []
        muck = []
        keys = [[hole_key(holes[i])] for i in range(players)]
        for st in range(len(streets)):
            if st > 0:
                board += stub[:streets[st]]
                stub = stub[streets[st]:]
            for rule in spec.discards_on_street(st):
                lo = rule.count if rule.min_count < 0 else rule.min_count
                for i in range(players):
                    out = choose_discard(ctx, holes[i], board, min(lo, len(holes[i])),
                                         min(rule.count, len(holes[i])), rule.draw, rule.to_board)
                    kept = tuple(c for c in holes[i] if c not in out)
                    if rule.to_board:
                        board += out
                    if rule.draw and out:
                        if len(stub) < len(out):
                            stub += muck
                            rng.shuffle(stub)
                            muck = []
                        kept = kept + tuple(stub[:len(out)])
                        stub = stub[len(out):]
                    if not rule.to_board:
                        muck += out
                    holes[i] = kept
            if st > 0:
                for i in range(players):
                    keys[i].append(post_key(ctx, holes[i], board, st))
        scores = [int(ev.evaluate(list(holes[i]), list(board))) for i in range(players)]
        for i in range(players):
            for k in range(1, players):
                opp = [scores[(i + j) % players] for j in range(1, k + 1)]
                top = max(opp)
                me = scores[i]
                share = 1.0 if me > top else (1.0 / (1 + opp.count(me)) if me == top else 0.0)
                for si, key in enumerate(keys[i]):
                    d = pre if si == 0 else post
                    acc = d.setdefault(f"{key}|{k}", [0.0, 0])
                    acc[0] += share
                    acc[1] += 1
        deals += 1
    to = lambda d: {k: round(v[0] / v[1], 4) for k, v in d.items() if v[1] >= 15}
    return dict(pre=to(pre), post=to(post), deals=deals, seconds=seconds, sig=repr(F.card_signature(spec)))


class AnyStrength:
    def __init__(self, spec, table=None):
        self.ctx = F.get_ctx(spec)
        if table is None and table_path(spec).exists():
            table = json.loads(table_path(spec).read_text())
        self.pre = table["pre"] if table else {}
        self.post = table["post"] if table else {}
        self.ok = bool(table)

    def equity(self, hole, board, street, k):
        k = max(1, min(7, int(round(k))))
        if street == 0 or not board and street == 0:
            v = self.pre.get(f"{hole_key(hole)}|{k}")
        else:
            v = self.post.get(f"{post_key(self.ctx, hole, board, street)}|{k}")
        return v if v is not None else 1.0 / (k + 1)


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--spec", required=True, help="module:NAME of a GameSpec, e.g. sng.tests.test_discards:FIVE_DRAW")
    ap.add_argument("--seconds", type=float, default=120)
    a = ap.parse_args(argv)
    import importlib
    mod, name = a.spec.split(":")
    spec = getattr(importlib.import_module(mod), name)
    t0 = time.time()
    tab = build(spec, a.seconds)
    CACHE.mkdir(parents=True, exist_ok=True)
    table_path(spec).write_text(json.dumps(tab))
    print(f"{table_path(spec).name} ({spec.name}): {len(tab['pre'])} pre, {len(tab['post'])} post keys, "
          f"{tab['deals']} deals, {time.time() - t0:.0f}s")


if __name__ == "__main__":
    main()


# ---- the bot ---------------------------------------------------------------------------------
from sng.ours.icm_tag import IcmTag  # noqa: E402

_STRENGTH: dict = {}


class IcmAny(IcmTag):
    """icm_tag's betting rules on the simulated any-variant strength, plus a discard/draw
    policy. Use for discard/draw variants or any spec without a feature table."""
    name = "icm_any"
    handles_discards = True

    def new_table(self, rules, seat, seed=0):
        super().new_table(rules, seat, seed)
        sig = F.card_signature(rules.spec)
        if sig not in _STRENGTH:
            _STRENGTH[sig] = AnyStrength(rules.spec)
        self.A = _STRENGTH[sig]
        self.ctx = self.A.ctx

    def _eq(self, obs, k):
        return self.A.equity(obs.hole, obs.board, obs.street, k)

    def act(self, obs):
        lg = obs.legal
        if getattr(lg, "discard_count", 0):
            from engine.game import Discard
            rule = next((r for r in self.spec.discards_on_street(obs.street)), None)
            out = choose_discard(self.ctx, obs.hole, obs.board, lg.discard_min, lg.discard_count,
                                 bool(rule and rule.draw), bool(rule and rule.to_board))
            return Discard(out)
        return super().act(obs)
