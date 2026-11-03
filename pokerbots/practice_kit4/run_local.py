#!/usr/bin/env python3
"""Play N practice tables of your bot against the sample bots.

    python3 run_local.py --bot bots/my_bot.py --tables 20 --seed 7
"""
import argparse
import glob
import json
import os
import random
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from engine import rules                       # noqa: E402
from engine.seats import BotFile, Controller, rules_dict   # noqa: E402
from engine.table import Table                 # noqa: E402

DEFAULT_OPPONENTS = sorted(
    p for p in glob.glob(os.path.join(HERE, "bots", "*.py"))
    if not os.path.basename(p).startswith("template"))


def parse_args(argv=None):
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--bot", required=True, help="your submission (.py)")
    ap.add_argument("--opponents", nargs="+", default=DEFAULT_OPPONENTS,
                    help="bot files that fill the other 7 seats, in turn")
    ap.add_argument("--tables", type=int, default=20)
    ap.add_argument("--seed", type=int, default=1)
    ap.add_argument("--time-limit-ms", type=float, default=rules.TIME_LIMIT_MS)
    ap.add_argument("--no-timeouts", action="store_true",
                    help="measure time but never fold or bench a slow bot")
    ap.add_argument("--max-hands", type=int, default=rules.MAX_HANDS)
    ap.add_argument("--log-dir", help="write one JSON-lines hand history per table here")
    ap.add_argument("--quiet", action="store_true", help="no per-table lines")
    return ap.parse_args(argv)


class Stats:
    def __init__(self, label):
        self.label = label
        self.tables = self.decisions = self.errors = self.timeouts = 0
        self.benched = self.total_ns = self.max_ns = 0
        self.points = 0.0
        self.places = []
        self.problems = []

    def add(self, ctrl, points, place):
        self.tables += 1
        self.points += points
        self.places.append(place)
        self.decisions += ctrl.decisions
        self.errors += ctrl.errors
        self.timeouts += ctrl.timeouts
        self.benched += ctrl.benched
        self.total_ns += ctrl.total_ns
        self.max_ns = max(self.max_ns, ctrl.max_ns)
        for p in ctrl.problems:
            if len(self.problems) < 8:
                self.problems.append(f"table {self.tables}: {p}")

    def row(self):
        avg_ms = self.total_ns / self.decisions / 1e6 if self.decisions else 0.0
        return (f"{self.label[:22]:22} {self.tables:6d} {self.points / self.tables:8.2f} "
                f"{sum(self.places) / self.tables:6.2f} {self.places.count(1):5d} "
                f"{self.errors:6d} {self.timeouts:8d} {self.benched:7d} "
                f"{self.decisions:9d} {avg_ms:7.4f} {self.max_ns / 1e6:7.3f}")


HEADER = (f"{'bot':22} {'seats':>6} {'avg pts':>8} {'place':>6} {'wins':>5} "
          f"{'errors':>6} {'timeouts':>8} {'benched':>7} {'decisions':>9} "
          f"{'avg ms':>7} {'max ms':>7}")


def run(args):
    info = rules_dict(args.time_limit_ms)
    you = BotFile(args.bot, info)
    if you.load_error:
        print(f"WARNING: your bot failed to load ({you.load_error}); "
              "it will check/fold every decision.")
    else:
        print(f"loaded {args.bot} as {you.name!r} (import + setup {you.setup_ms:.1f} ms)")
    opponents = [BotFile(p, info) for p in args.opponents]
    stats = {"YOU": Stats(f"YOU: {you.name}")}
    for b in opponents:
        stats.setdefault(b.path, Stats(b.name))
    if args.log_dir:
        os.makedirs(args.log_dir, exist_ok=True)

    for t in range(args.tables):
        rng = random.Random(f"kit4:{args.seed}:{t}")
        lineup = [("YOU", you)] + [
            (opponents[(t + k) % len(opponents)].path,
             opponents[(t + k) % len(opponents)]) for k in range(rules.SEATS - 1)]
        rng.shuffle(lineup)
        ctrls = [Controller(b, args.time_limit_ms, not args.no_timeouts)
                 for _, b in lineup]
        random.seed(f"bots:{args.seed}:{t}")           # the event does NOT do this
        log = None
        if args.log_dir:
            log = open(os.path.join(args.log_dir, f"table_{args.seed}_{t:03d}.jsonl"), "w")
        table = Table(ctrls, seed=rng.randrange(2 ** 32), max_hands=args.max_hands,
                      time_limit_ms=args.time_limit_ms,
                      hand_logger=(lambda rec, f=log: f.write(json.dumps(rec) + "\n"))
                      if log else None)
        res = table.run()
        if log:
            log.close()
        for seat, ((key, _), ctrl) in enumerate(zip(lineup, ctrls), start=1):
            stats[key].add(ctrl, res["points"][seat], res["place"][seat])
            if key == "YOU" and not args.quiet:
                print(f"table {t:3d}: seat {seat}, place {res['place'][seat]}, "
                      f"{res['points'][seat]:6.2f} pts, {res['hands']} hands, "
                      f"{ctrl.errors} errors, {ctrl.timeouts} timeouts")

    print()
    print(HEADER)
    for s in stats.values():
        if s.tables:
            print(s.row())
    me = stats["YOU"]
    print()
    print("your places: " + " ".join(f"{p}:{me.places.count(p)}" for p in range(1, 9)))
    if me.problems:
        print("first problems for your bot:")
        for p in me.problems:
            print("  " + p)
    return me


if __name__ == "__main__":
    run(parse_args())
