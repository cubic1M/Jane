"""Conformance check every bot must pass before it is used in experiments.

    python -m engine.conformance <registry-name> [--hands 60] [--limit 2.0]

Plays the bot against a random-legal opponent and against itself on every
variant (both seats) and fails on any illegal action, exception, timeout, or a
decision slower than the limit (default 2 s, the loosest budget we test).
"""
from __future__ import annotations

import argparse
import sys
from typing import Callable, Iterable

from .match import play_match
from .variants import VARIANTS


def check_bot(factory: Callable, specs: Iterable = None, hands: int = 60, limit: float = 2.0,
              seed: int = 1, verbose: bool = True) -> list[str]:
    from bots.random_legal import RandomLegalBot
    specs = list(specs) if specs is not None else list(VARIANTS.values())
    problems = []
    for spec in specs:
        spec = spec.with_(time_per_decision=None, time_per_match=None)
        for opp_name, opp_factory in (("random_legal", RandomLegalBot), ("self", factory)):
            for seat in (0, 1):
                bot = factory()
                opp = opp_factory()
                pair = (bot, opp) if seat == 0 else (opp, bot)
                r = play_match(pair[0], pair[1], spec, deal_seed=seed + seat, hands=hands)
                for s in (0, 1):
                    if pair[s] is not bot and not (opp_name == "self"):
                        continue
                    st = r.stats[s].summary()
                    tag = f"{spec.name} vs {opp_name} seat{s}"
                    if st["illegal"] or st["errors"]:
                        problems.append(f"{tag}: illegal={st['illegal']} errors={st['errors']}\n{st['first_error']}")
                    if st["max_ms"] > limit * 1000:
                        problems.append(f"{tag}: max decision {st['max_ms']:.0f} ms > {limit*1000:.0f} ms")
                if verbose:
                    s = 0 if seat == 0 else 1
                    st = r.stats[s].summary()
                    print(f"  {spec.name:14s} vs {opp_name:12s} seat{seat}: {r.bb_per_hand(s):+7.2f} bb/h  "
                          f"mean {st['mean_ms']:.1f} ms  max {st['max_ms']:.0f} ms  illegal {st['illegal']}  errors {st['errors']}")
    return problems


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("bot")
    ap.add_argument("--hands", type=int, default=60)
    ap.add_argument("--limit", type=float, default=2.0)
    ap.add_argument("--variants", default="")
    a = ap.parse_args(argv)
    from bots.registry import make
    specs = None
    if a.variants:
        from .variants import get_variant
        specs = [get_variant(v) for v in a.variants.split(",")]
    probs = check_bot(lambda: make(a.bot), specs=specs, hands=a.hands, limit=a.limit)
    if probs:
        print("CONFORMANCE FAILED")
        for p in probs:
            print(" -", p)
        sys.exit(1)
    print("CONFORMANCE OK")


if __name__ == "__main__":
    main()
