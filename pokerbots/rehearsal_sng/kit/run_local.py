#!/usr/bin/env python3
"""Play N sit-and-go tables of your bot against the sample bots.

    python3 kit/run_local.py --bot submission/bot.py --tables 50

Each table seats your bot at a random seat with 7 opponents drawn in rotation
from --opponents. Prints your average points, errors, timeouts and slowest
decision, and writes a tab-separated hand log (see README, "Hand log").
"""

from __future__ import annotations

import argparse
import collections
import importlib.util
import os
import random
import sys
import time

KIT_DIR = os.path.dirname(os.path.abspath(__file__))
if KIT_DIR not in sys.path:
    sys.path.insert(0, KIT_DIR)

import config  # noqa: E402
from engine import HandLog, Table  # noqa: E402

SAMPLE_BOTS = {
    "caller": os.path.join(KIT_DIR, "agent_template.py"),
    "random": os.path.join(KIT_DIR, "sample_bots", "random_bot.py"),
    "tight": os.path.join(KIT_DIR, "sample_bots", "tight_bot.py"),
    "pusher": os.path.join(KIT_DIR, "sample_bots", "pusher_bot.py"),
}

_loaded = 0


def load_bot_class(path: str, class_name: str = "Bot"):
    """Import a bot file and return its Bot class."""
    global _loaded
    path = os.path.abspath(path)
    if not os.path.isfile(path):
        sys.exit(f"bot file not found: {path}")
    folder = os.path.dirname(path)
    if folder not in sys.path:
        sys.path.append(folder)
    _loaded += 1
    mod_name = f"_bot_{_loaded}_{os.path.splitext(os.path.basename(path))[0]}"
    spec = importlib.util.spec_from_file_location(mod_name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[mod_name] = module
    spec.loader.exec_module(module)
    cls = getattr(module, class_name, None)
    if cls is None:
        sys.exit(f"{path} does not define a class named {class_name!r}")
    return cls


def ordinal(n: int) -> str:
    return {1: "1st", 2: "2nd", 3: "3rd"}.get(n, f"{n}th")


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--bot", required=True, help="path to your bot file (defines class Bot)")
    ap.add_argument("--tables", type=int, default=20)
    ap.add_argument("--opponents", default="tight,random,pusher",
                    help=f"comma-separated, from: {', '.join(SAMPLE_BOTS)} "
                         "or paths to other bot files")
    ap.add_argument("--seed", type=int, default=None, help="seed for seats and cards")
    ap.add_argument("--log", default=os.path.join("logs", "hands.log"),
                    help="hand log path (default logs/hands.log)")
    ap.add_argument("--no-log", action="store_true")
    ap.add_argument("--time-limit-ms", type=float, default=config.TIME_LIMIT_MS,
                    help="per-decision limit (default: the tournament's)")
    ap.add_argument("--class-name", default="Bot")
    args = ap.parse_args(argv)

    hero_cls = load_bot_class(args.bot, args.class_name)
    opp_names = [o.strip() for o in args.opponents.split(",") if o.strip()]
    if not opp_names:
        sys.exit("need at least one opponent")
    opp_classes = {}
    for o in opp_names:
        if o not in opp_classes:
            opp_classes[o] = load_bot_class(SAMPLE_BOTS.get(o, o))

    seed = args.seed if args.seed is not None else random.randrange(2**31)
    rng = random.Random(seed)

    log_file = None
    log = None
    if not args.no_log:
        folder = os.path.dirname(args.log)
        if folder:
            os.makedirs(folder, exist_ok=True)
        log_file = open(args.log, "w", encoding="utf-8")
        log = HandLog(log_file)

    hero_points, hero_places = [], []
    opp_points = collections.defaultdict(list)
    totals = collections.Counter()
    slowest = 0.0
    slowest_where = ""
    total_ms = 0.0
    first_error = None
    hands = 0
    capped = 0
    started = time.perf_counter()

    for t in range(1, args.tables + 1):
        hero_seat = rng.randrange(config.NUM_SEATS)
        offset = rng.randrange(len(opp_names))
        factories, names, kinds = [], [], []
        k = 0
        for s in range(config.NUM_SEATS):
            if s == hero_seat:
                factories.append(hero_cls)
                names.append("you")
                kinds.append(None)
            else:
                o = opp_names[(offset + k) % len(opp_names)]
                k += 1
                factories.append(opp_classes[o])
                names.append(f"{os.path.splitext(os.path.basename(o))[0]}{s}")
                kinds.append(o)
        table = Table(factories, names, seed=rng.randrange(2**32), table_id=t,
                      button=rng.randrange(config.NUM_SEATS), log=log,
                      time_limit_ms=args.time_limit_ms)
        result = table.run()
        hands += result.hands_played
        capped += result.ended_by == "hand_cap"
        for sr in result.seats:
            if kinds[sr.seat] is None:
                hero_points.append(sr.points)
                hero_places.append(sr.place)
                st = sr.stats
                totals["decisions"] += st.decisions
                totals["errors"] += st.errors
                totals["timeouts"] += st.timeouts
                totals["hook_errors"] += st.hook_errors
                totals["hook_timeouts"] += st.hook_timeouts
                totals["init_failed"] += st.init_failed
                total_ms += st.total_ms
                if st.max_ms > slowest:
                    slowest, slowest_where = st.max_ms, f"table {t}"
                if first_error is None and st.first_error:
                    first_error = f"table {t}:\n{st.first_error}"
            else:
                opp_points[kinds[sr.seat]].append(sr.points)

    if log_file:
        log_file.close()

    n = len(hero_points)
    print(f"Tables: {n}   hands: {hands}   ended at the {config.MAX_HANDS}-hand cap: {capped}"
          f"   seed: {seed}   ({time.perf_counter() - started:.1f}s)")
    print(f"Your bot: {args.bot}")
    print(f"  average points : {sum(hero_points) / n:.2f}   (max {config.points_for_place(1)} per table)")
    print(f"  average place  : {sum(hero_places) / n:.2f}")
    hist = collections.Counter(hero_places)
    print("  places         : " + "  ".join(f"{ordinal(p)}:{hist[p]}" for p in range(1, config.NUM_SEATS + 1)))
    dec = totals["decisions"]
    print(f"  decisions      : {dec}")
    print(f"  errors         : {totals['errors']}   timeouts: {totals['timeouts']}"
          f"   (limit {args.time_limit_ms} ms)")
    print(f"  hand_over()    : errors {totals['hook_errors']}   over limit {totals['hook_timeouts']}")
    if totals["init_failed"]:
        print(f"  Bot() failed to start at {totals['init_failed']} tables")
    mean = total_ms / dec if dec else 0.0
    print(f"  slowest decision: {slowest:.3f} ms ({slowest_where or 'n/a'})   mean: {mean:.4f} ms")
    print("Opponents (average points per seat):")
    for o, pts in opp_points.items():
        print(f"  {o:<10} {sum(pts) / len(pts):7.2f}   ({len(pts)} seats)")
    if log_file:
        print(f"Hand log: {os.path.abspath(args.log)}")
    if first_error:
        print("\nFirst error from your bot:\n" + first_error.rstrip())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
