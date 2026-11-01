#!/usr/bin/env python3
"""Local runner: play sit-and-go tables and report points, errors, timing.

    python3 run_local.py --bot bots/template_bot.py --tables 20
    python3 run_local.py --bot my_bot.py --bot bots/sample_tight.py \
        --tables 50 --seed 7 --log-dir logs

Your --bot(s) take the first seats; the rest are filled from --opponents
(default: the sample bots, in turn).  Seating is shuffled at every table.
"""

import argparse
import random
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))

from check_bot import check_file  # noqa: E402
from simkit.agent import BotAgent, Stats  # noqa: E402
from simkit.rules import (MAX_HANDS, NUM_PLAYERS, PAYOUTS_PER_MILLE,  # noqa: E402
                          TIME_LIMIT_MS)
from simkit.table import Table  # noqa: E402

DEFAULT_OPPONENTS = ["bots/sample_tight.py", "bots/sample_caller.py",
                     "bots/sample_shover.py"]


def resolve(path):
    p = Path(path)
    if p.exists():
        return p.resolve()
    q = HERE / path
    if q.exists():
        return q.resolve()
    raise SystemExit(f"bot file not found: {path}")


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawTextHelpFormatter)
    ap.add_argument("--bot", action="append", required=True,
                    help="bot file to test (repeatable)")
    ap.add_argument("--opponents", default=",".join(DEFAULT_OPPONENTS),
                    help="comma-separated bot files used to fill the table")
    ap.add_argument("--tables", type=int, default=20)
    ap.add_argument("--players", type=int, default=NUM_PLAYERS,
                    help="bots per table (the real event uses 8)")
    ap.add_argument("--max-hands", type=int, default=MAX_HANDS)
    ap.add_argument("--seed", type=int, default=1)
    ap.add_argument("--time-limit-ms", type=float, default=TIME_LIMIT_MS)
    ap.add_argument("--no-timeouts", action="store_true",
                    help="measure time but never discard slow replies")
    ap.add_argument("--log-dir", help="write a readable hand log per table")
    ap.add_argument("--skip-check", action="store_true",
                    help="run even if check_bot.py rejects a --bot file")
    args = ap.parse_args(argv)

    if not 2 <= args.players <= 8:
        raise SystemExit("--players must be 2-8")
    mine = [resolve(b) for b in args.bot]
    opponents = [resolve(b) for b in args.opponents.split(",") if b.strip()]
    if len(mine) > args.players:
        raise SystemExit("more --bot files than seats")
    if not opponents and len(mine) < args.players:
        raise SystemExit("need --opponents to fill the table")

    for p in mine:
        problems = check_file(p)
        if problems:
            print(f"check_bot.py rejects {p.name}:")
            for msg in problems:
                print(f"  - {msg}")
            if not args.skip_check:
                return 1

    entries = list(mine)
    k = 0
    while len(entries) < args.players:
        entries.append(opponents[k % len(opponents)])
        k += 1
    names = []
    seen = {}
    for p in entries:
        seen[p.stem] = seen.get(p.stem, 0) + 1
        names.append(p.stem if seen[p.stem] == 1 else f"{p.stem}#{seen[p.stem]}")
    groups = [p.stem for p in entries]

    log_dir = Path(args.log_dir) if args.log_dir else None
    if log_dir:
        log_dir.mkdir(parents=True, exist_ok=True)

    totals = {g: {"points": 0.0, "seats": 0, "places": 0, "wins": 0,
                  "stats": Stats()} for g in dict.fromkeys(groups)}
    hands_played = 0
    t0 = time.time()
    master = random.Random(args.seed)
    for t in range(1, args.tables + 1):
        order = list(range(args.players))
        master.shuffle(order)
        agents = [BotAgent.from_file(names[i], entries[i],
                                     time_limit_ms=args.time_limit_ms,
                                     enforce_time=not args.no_timeouts)
                  for i in order]
        table = Table(agents, seed=master.randrange(1 << 30),
                      max_hands=args.max_hands,
                      payouts=PAYOUTS_PER_MILLE[:args.players], table_id=t)
        results = table.play()
        hands_played += table.hand_no
        for i, res in zip(order, results):
            g = totals[groups[i]]
            g["points"] += res["points"]
            g["seats"] += 1
            g["places"] += res["place"]
            g["wins"] += res["place"] == 1
        for i, agent in zip(order, agents):
            totals[groups[i]]["stats"].merge(agent.stats)
        if log_dir:
            (log_dir / f"table_{t:03d}.log").write_text(
                "\n".join(table.log) + "\n", encoding="utf-8")

    elapsed = time.time() - t0
    print(f"{args.tables} tables x {args.players} bots, {hands_played} hands, "
          f"{elapsed:.1f} s.  Points per table: {sum(PAYOUTS_PER_MILLE[:args.players])}"
          f" (fair share {sum(PAYOUTS_PER_MILLE[:args.players]) / args.players:.1f}"
          f" per seat).  Time limit {args.time_limit_ms} ms"
          f"{' (NOT enforced)' if args.no_timeouts else ''}.")
    header = (f"{'bot':<20}{'seats':>6}{'avg pts':>9}{'avg place':>10}"
              f"{'1sts':>6}{'errors':>8}{'timeouts':>9}{'decisions':>10}"
              f"{'avg ms':>8}{'slowest ms':>11}{'init ms':>9}{'init fail':>10}")
    print(header)
    print("-" * len(header))
    for g, d in sorted(totals.items(), key=lambda kv: -kv[1]["points"] /
                       max(1, kv[1]["seats"])):
        st = d["stats"]
        avg_ms = st.total_ms / st.decisions if st.decisions else 0.0
        print(f"{g:<20}{d['seats']:>6}{d['points'] / d['seats']:>9.1f}"
              f"{d['places'] / d['seats']:>10.2f}{d['wins']:>6}{st.errors:>8}"
              f"{st.timeouts:>9}{st.decisions:>10}{avg_ms:>8.3f}"
              f"{st.slowest_ms:>11.3f}{st.init_ms:>9.1f}{st.init_failures:>10}")
    my_groups = dict.fromkeys(p.stem for p in mine)
    for g in my_groups:
        msgs = totals[g]["stats"].messages
        if msgs:
            print(f"\nfirst problems for {g}:")
            for m in msgs[:10]:
                print(f"  {m}")
    if log_dir:
        print(f"\nhand logs written to {log_dir}/")
    return 0


if __name__ == "__main__":
    sys.exit(main())
