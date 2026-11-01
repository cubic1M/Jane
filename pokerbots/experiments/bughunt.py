"""Continuous bug hunter: random rule variants x every bot, checking invariants.

Each round draws a random valid GameSpec (deck subset, 2-5 hole cards, any/exactly
usage, discards to board or muck, odd board layouts, pot-limit, antes, short and
deep stacks, non-reset stacks), then:
  * evaluator vs an independent brute-force reference on random hands
  * engine state machine with a spy: chips conserved, |delta| <= stack, no hidden
    card ever visible in an observation, legal actions consistent
  * every bot vs random_legal and vs another bot: no exception, no illegal action,
    no decision over the limit, new_match must not crash
Failures go to results/bughunt/failures.jsonl with everything needed to reproduce.

    python -m experiments.bughunt --minutes 60 [--bots ...] [--seed 1]
    python -m experiments.bughunt --replay results/bughunt/failures.jsonl   # re-check
"""
from __future__ import annotations

import argparse
import json
import random
import time
import traceback
from dataclasses import replace

import numpy as np

from experiments.common import RESULTS, make_bot

OUT = RESULTS / "bughunt"
DEFAULT_BOTS = ["equity", "balanced", "adaptive", "preflop_cfr@15m", "full_cfr@30m", "hybrid@30m",
                "adaptive_cfr@15m", "adaptive+lp", "push", "station", "maniac"]
DECISION_LIMIT = 2.0


def random_spec(rng: random.Random):
    from engine.spec import SHORT_DECK_ORDER, STANDARD_ORDER, DiscardRule, GameSpec
    for _ in range(200):
        lo = rng.choice([0, 0, 0, 4, 6, 8])
        ranks = tuple(range(lo, 13))
        hole = rng.choice([2, 2, 2, 3, 3, 4, 5])
        streets = rng.choice([(0, 3, 1, 1), (0, 3, 1, 1), (0, 4, 1), (0, 2, 2, 1), (0, 3, 2), (0, 5)])
        discards = ()
        if hole >= 3 and rng.random() < 0.6:
            n_rules = rng.choice([1, 1, 2]) if len(streets) > 2 else 1
            used = 0
            rules = []
            for st in sorted(rng.sample(range(1, len(streets)), min(n_rules, len(streets) - 1))):
                if hole - used - 1 < 1:
                    break
                to_board = rng.random() < 0.6
                rules.append(DiscardRule(street=st, count=1, to_board=to_board,
                                         face_up=True if to_board else rng.random() < 0.5,
                                         order=rng.choice(["oop_first", "ip_first"])))
                used += 1
            discards = tuple(rules)
        usage = "exactly" if rng.random() < 0.3 else "any"
        bb = rng.choice([2, 2, 2, 4, 10])
        sb = rng.choice([bb // 2, bb // 2, bb])
        try:
            spec = GameSpec(
                name=f"rnd{rng.randrange(10**6)}", deck_ranks=ranks, hole_cards=hole, hole_usage=usage,
                hole_exact=rng.choice([1, 2, 2]) if usage == "exactly" else 2,
                board_cards_per_street=streets, discards=discards,
                category_order=SHORT_DECK_ORDER if (lo >= 4 and rng.random() < 0.7) else STANDARD_ORDER,
                small_blind=sb, big_blind=bb, ante=rng.choice([0, 0, 0, 1]),
                starting_stack=bb * rng.choice([5, 10, 20, 50, 100, 250]),
                stack_reset_per_hand=rng.random() < 0.85, betting=rng.choice(["no_limit", "no_limit", "pot_limit"]),
                hands_per_match=200)
            return spec
        except ValueError:
            continue
    raise RuntimeError("could not draw a valid spec")


def check_evaluator(spec, rng, n=150):
    from engine.evaluator import get_evaluator
    from engine.tests.test_evaluator import ref_best
    ev = get_evaluator(spec)
    deck = list(spec.deck)
    h = spec.final_hole_cards
    b = spec.final_board_cards
    if h + b > 9 or len(deck) < 2 * h + b:
        return []
    fails = []
    for _ in range(n):
        cards = rng.sample(deck, 2 * h + b)
        x, y, board = cards[:h], cards[h:2 * h], cards[2 * h:]
        try:
            sx, sy = ev.evaluate(x, board), ev.evaluate(y, board)
            rx, ry = ref_best(x, board, spec)[0], ref_best(y, board, spec)[0]
        except ValueError:
            continue
        if (sx > sy) != (rx > ry) or (sx == sy) != (rx == ry):
            fails.append(dict(kind="evaluator", hole_a=x, hole_b=y, board=board, ours=[sx, sy]))
            break
    return fails


def check_engine(spec, seed):
    """Spy-driven hands: conservation, leaks, legality bookkeeping."""
    from bots.random_legal import RandomLegalBot
    from engine.game import HandState
    from engine.match import deal_order
    fails = []
    bots = [RandomLegalBot(), RandomLegalBot()]
    for i, bt in enumerate(bots):
        bt.new_match(spec, seed * 7 + i)
    for hand in range(40):
        st = HandState(spec, deal_order(spec, seed, hand))
        start_hole = [list(st.hole[0]), list(st.hole[1])]

        def decide(pos, obs):
            opp = 1 - pos
            hidden = set(start_hole[opp]) - set(obs.board) - set(obs.opp_discards)
            if hidden & (set(obs.my_cards) | set(obs.board) | {c for r in obs.history for c in r.cards}):
                fails.append(dict(kind="leak", hand=hand, pos=pos))
            if obs.pot != obs.my_committed + obs.opp_committed:
                fails.append(dict(kind="pot_mismatch", hand=hand))
            if obs.legal.can_raise and not (obs.legal.min_raise_to <= obs.legal.max_raise_to):
                fails.append(dict(kind="raise_bounds", hand=hand, legal=str(obs.legal)))
            return bots[pos].act(obs)

        d = st.play(decide)
        if d[0] + d[1] != 0:
            fails.append(dict(kind="not_zero_sum", hand=hand, deltas=d))
        if max(abs(d[0]), abs(d[1])) > spec.starting_stack:
            fails.append(dict(kind="delta_exceeds_stack", hand=hand, deltas=d))
        if fails:
            break
    return fails


LIBRARY_BOTS = ["champion@15m_w4", "champion@15m_w4+lp", "full_cfr@15m_w4"]


def library_spec(rng: random.Random):
    """A library game under a new name and new time limits / match length (the day-of
    situation): the CFR bots must find and play the library policy."""
    from engine.variants import ALL_VARIANTS
    from bots.full_cfr import DEFAULT_DIR
    import os
    names = sorted(v for v in ALL_VARIANTS if os.path.exists(os.path.join(DEFAULT_DIR, f"full_{v}_15m_w4.pkl")))
    if not names:
        return None
    base = ALL_VARIANTS[rng.choice(names)]
    if rng.random() < 0.5:   # the same game in other chips (library match up to scale)
        from fractions import Fraction
        ks = [k for k in (Fraction(1, 5), Fraction(1, 2), 5, 10, 25, 50, 100)
              if all((getattr(base, f) * k).denominator == 1 for f in ("small_blind", "big_blind", "ante", "starting_stack"))
              and base.small_blind * k >= 1]
        k = rng.choice(ks)
        base = base.with_(small_blind=int(base.small_blind * k), big_blind=int(base.big_blind * k),
                          ante=int(base.ante * k), starting_stack=int(base.starting_stack * k))
    return base.with_(name=f"day{rng.randrange(10**6)}", hands_per_match=rng.choice([200, 500, 1000]),
                      time_per_decision=rng.choice([None, 0.5, 1.0, 2.0]), notes="renamed library game")


def check_bot(bot_str, spec, seed, hands=60, expect_policy=False):
    from engine.match import play_match
    from experiments.common import _uses_fallback
    fails = []
    for opp in ("random_legal", bot_str):
        for seat in (0, 1):
            try:
                a, b = make_bot(bot_str), make_bot(opp)
                pair = (a, b) if seat == 0 else (b, a)
                r = play_match(pair[0], pair[1], spec, deal_seed=seed + seat, hands=hands)
            except Exception:
                fails.append(dict(kind="crash", bot=bot_str, opp=opp, seat=seat, tb=traceback.format_exc()[-3000:]))
                return fails
            if expect_policy and _uses_fallback(a):
                fails.append(dict(kind="library_policy_not_found", bot=bot_str, base=spec.notes))
                return fails
            for s in (0, 1):
                if pair[s] is not a and opp != bot_str:
                    continue
                st = r.stats[s].summary()
                if st["illegal"] or st["errors"]:
                    fails.append(dict(kind="bot_error", bot=bot_str, opp=opp, seat=s, illegal=st["illegal"],
                                      errors=st["errors"], first_error=(st["first_error"] or "")[-3000:]))
                if st["max_ms"] > DECISION_LIMIT * 1000:
                    fails.append(dict(kind="slow", bot=bot_str, opp=opp, max_ms=st["max_ms"]))
            if fails:
                return fails
    return fails


def record(fail, spec, seed):
    OUT.mkdir(parents=True, exist_ok=True)
    fail = dict(fail, spec=repr(spec), seed=seed, t=time.strftime("%Y-%m-%d %H:%M:%S"))
    with open(OUT / "failures.jsonl", "a") as f:
        f.write(json.dumps(fail, default=str) + "\n")
    print("FAIL", json.dumps({k: v for k, v in fail.items() if k not in ("tb", "first_error", "spec")}, default=str), flush=True)


def spec_from_repr(r: str):
    from engine.spec import DiscardRule, GameSpec  # noqa: F401  (used by eval)
    return eval(r, {"GameSpec": GameSpec, "DiscardRule": DiscardRule})


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--minutes", type=float, default=30)
    ap.add_argument("--bots", default=",".join(DEFAULT_BOTS))
    ap.add_argument("--seed", type=int, default=int(time.time()) % 100000)
    ap.add_argument("--hands", type=int, default=60)
    ap.add_argument("--library-share", type=float, default=0.35,
                    help="share of rounds on a renamed library game with a library CFR bot")
    a = ap.parse_args(argv)
    rng = random.Random(a.seed)
    bots = a.bots.split(",")
    t_end = time.time() + 60 * a.minutes
    rounds = n_fail = 0
    OUT.mkdir(parents=True, exist_ok=True)
    while time.time() < t_end:
        lib = rng.random() < a.library_share and library_spec(rng)
        spec = lib or random_spec(rng)
        seed = rng.randrange(10**6)
        fails = check_evaluator(spec, rng) + check_engine(spec, seed)
        for f in fails:
            record(f, spec, seed)
        picks = [rng.choice(LIBRARY_BOTS)] + rng.sample(bots, 2) if lib else rng.sample(bots, min(3, len(bots)))
        for b in picks:
            if time.time() > t_end:
                break
            for f in check_bot(b, spec, seed, a.hands, expect_policy=bool(lib) and b in LIBRARY_BOTS):
                record(f, spec, seed)
                n_fail += 1
        n_fail += len(fails)
        rounds += 1
        with open(OUT / "progress.json", "w") as f:
            json.dump(dict(rounds=rounds, failures=n_fail, seed=a.seed, last=time.strftime("%H:%M:%S")), f)
    print(f"bughunt done: {rounds} random variants, {n_fail} failures", flush=True)


if __name__ == "__main__":
    main()
