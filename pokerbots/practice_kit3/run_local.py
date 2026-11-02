#!/usr/bin/env python3
"""Local runner: play your bot in N practice tables and print a summary.

    python3 run_local.py --bot bots/template_bot.py --tables 20

Each table seats your bot once plus opponents drawn in turn from --opponents
(default: the three sample bots). Seats, button and player ids are random per
table. Hand logs go to logs/table_XXX.log unless --no-logs.
"""

import argparse
import os
import random
import statistics
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from engine import rules  # noqa: E402
from engine.loader import load_factory, bot_name  # noqa: E402
from engine.table import Table  # noqa: E402

DEFAULT_OPPONENTS = ["bots/calling_station.py", "bots/tight_aggressive.py", "bots/random_raiser.py"]


def resolve(path):
    if os.path.exists(path):
        return path
    alt = os.path.join(HERE, path)
    if os.path.exists(alt):
        return alt
    raise SystemExit("bot file not found: %s" % path)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--bot", required=True, help="your bot file")
    ap.add_argument("--tables", type=int, default=20)
    ap.add_argument("--opponents", nargs="+", default=None, help="opponent bot files (cycled)")
    ap.add_argument("--seats", type=int, default=rules.SEATS, help="bots per table, 2..8 (tournament: 8)")
    ap.add_argument("--seed", type=int, default=None, help="master seed (default: random)")
    ap.add_argument("--max-hands", type=int, default=rules.MAX_HANDS)
    ap.add_argument("--time-limit-ms", type=float, default=rules.DECISION_LIMIT_MS)
    ap.add_argument("--time-scale", type=float, default=1.0,
                    help="multiply every time limit (e.g. 2.0 on a slow laptop)")
    ap.add_argument("--no-timeouts", action="store_true",
                    help="measure time but never apply the timeout rule")
    ap.add_argument("--log-dir", default=os.path.join(HERE, "logs"))
    ap.add_argument("--no-logs", action="store_true")
    ap.add_argument("--quiet", action="store_true", help="no per-table lines")
    args = ap.parse_args(argv)

    if not 2 <= args.seats <= 8:
        raise SystemExit("--seats must be 2..8")
    seed = args.seed if args.seed is not None else random.randrange(1 << 30)
    master = random.Random(seed)
    me_path = resolve(args.bot)
    opp_paths = [resolve(p) for p in (args.opponents or DEFAULT_OPPONENTS)]
    me_name = "YOU:" + bot_name(me_path)
    factories = {me_path: load_factory(me_path)}
    for p in opp_paths:
        if p not in factories:
            factories[p] = load_factory(p)

    if not args.no_logs:
        os.makedirs(args.log_dir, exist_ok=True)

    print("practice kit 3 | bot %s | %d tables x %d seats | seed %d | limit %.3f ms%s"
          % (args.bot, args.tables, args.seats, seed, args.time_limit_ms * args.time_scale,
             " (not enforced)" if args.no_timeouts else ""))

    stats = {}   # name -> aggregated

    def agg(name):
        return stats.setdefault(name, {"points": [], "places": [], "survived": 0, "errors": 0,
                                       "timeouts": 0, "decisions": 0, "max_ms": 0.0,
                                       "max_raw_ms": 0.0, "where": "", "error_log": [],
                                       "disabled": 0, "seats": 0})

    t_start = time.time()
    opp_cycle = 0
    for t in range(args.tables):
        tid = "T%03d" % (t + 1)
        entrants = [(me_name, factories[me_path])]
        for _ in range(args.seats - 1):
            p = opp_paths[opp_cycle % len(opp_paths)]
            opp_cycle += 1
            entrants.append((bot_name(p), factories[p]))
        logf = None
        if not args.no_logs:
            logf = open(os.path.join(args.log_dir, "table_%03d.log" % (t + 1)), "w")
        try:
            table = Table(entrants, seed=master.randrange(1 << 30), table_id=tid,
                          time_limit_ms=args.time_limit_ms * args.time_scale,
                          setup_limit_ms=rules.SETUP_LIMIT_MS * args.time_scale,
                          enforce_time=not args.no_timeouts, max_hands=args.max_hands,
                          log=(lambda line, f=logf: f.write(line + "\n")) if logf else None)
            res = table.run()
        finally:
            if logf:
                logf.close()
        mine = None
        for p in res["players"]:
            a = agg(p["name"])
            a["seats"] += 1
            a["points"].append(p["points"])
            a["places"].append(p["place"])
            a["survived"] += 1 if p["survived"] else 0
            a["errors"] += p["errors"]
            a["timeouts"] += p["timeouts"]
            a["decisions"] += p["decisions"]
            a["disabled"] += 1 if p["disabled"] else 0
            if p["max_charged_ms"] > a["max_ms"]:
                a["max_ms"] = p["max_charged_ms"]
                a["where"] = p["slowest_where"]
            a["max_raw_ms"] = max(a["max_raw_ms"], p["max_raw_ms"])
            if len(a["error_log"]) < 8:
                a["error_log"].extend(p["error_log"][:8 - len(a["error_log"])])
            if p["name"] == me_name:
                mine = p
        if not args.quiet:
            place = ("survived (ICM)" if mine["survived"] else "place %s" % (mine["place"],))
            print("  %s  %3d hands  you: %-15s %7.3f pts  stack %5d  err %d  t/o %d"
                  % (tid, res["hands"], place, mine["points"], mine["stack"], mine["errors"],
                     mine["timeouts"]))

    elapsed = time.time() - t_start
    print()
    print("%-26s %5s %8s %7s  %-27s %4s %6s %6s %9s" % (
        "bot", "seats", "avg pts", "stdev", "1st 2nd 3rd 4th .. 8th", "ICM", "errors",
        "t/outs", "slowest"))
    order = sorted(stats.items(), key=lambda kv: -statistics.mean(kv[1]["points"]))
    for name, a in order:
        places = a["places"]

        def cnt(k):
            return sum(1 for p in places if p == k or (isinstance(p, list) and k in p))
        dist = "%3d %3d %3d %3d .. %3d" % (cnt(1), cnt(2), cnt(3), cnt(4), cnt(8))
        sd = statistics.stdev(a["points"]) if len(a["points"]) > 1 else 0.0
        print("%-26s %5d %8.3f %7.3f  %-27s %4d %6d %6d %7.3fms" % (
            name[:26], a["seats"], statistics.mean(a["points"]), sd, dist, a["survived"],
            a["errors"], a["timeouts"], a["max_ms"]))

    me = stats[me_name]
    print()
    print("YOUR BOT (%s)" % args.bot)
    print("  average points per table : %.3f over %d tables (stdev %.3f)" % (
        statistics.mean(me["points"]), len(me["points"]),
        statistics.stdev(me["points"]) if len(me["points"]) > 1 else 0.0))
    print("  decisions                : %d" % me["decisions"])
    print("  errors                   : %d" % me["errors"])
    print("  timeouts                 : %d" % me["timeouts"])
    print("  tables auto-played       : %d (setup over budget or Agent() failed)" % me["disabled"])
    print("  slowest decision         : %.3f ms charged (%s); slowest call alone %.3f ms"
          % (me["max_ms"], me["where"] or "-", me["max_raw_ms"]))
    if me["error_log"]:
        print("  first problems:")
        for line in me["error_log"]:
            print("    - " + line)
    if not args.no_logs:
        print("  hand logs                : %s/table_XXX.log" % os.path.relpath(args.log_dir))
    print("  wall time                : %.1f s" % elapsed)
    return 0


if __name__ == "__main__":
    sys.exit(main())
