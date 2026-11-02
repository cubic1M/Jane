#!/usr/bin/env python3
"""ICM calculator, points table and blind schedule.

    python3 icm_calculator.py 8000 5000 2000 1000      # ICM points for these stacks
    python3 icm_calculator.py 6000 4000 --payouts 12 7  # custom payouts
    python3 icm_calculator.py --schedule                # blinds and points table

With no --payouts the points for places 1..k of the official table are used,
which is exactly what a table that reaches the hand cap with k survivors pays.
"""

import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from engine import rules  # noqa: E402
from engine.icm import icm_equities  # noqa: E402


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("stacks", nargs="*", type=int)
    ap.add_argument("--payouts", nargs="+", type=float)
    ap.add_argument("--schedule", action="store_true")
    args = ap.parse_args(argv)
    if args.schedule or not args.stacks:
        print("Blind schedule (level changes every %d hands of the table's hand counter):" % rules.HANDS_PER_LEVEL)
        for i, (sb, bb) in enumerate(rules.BLIND_LEVELS):
            lo = i * rules.HANDS_PER_LEVEL + 1
            print("  level %d  hands %3d-%3d  %d/%d" % (i + 1, lo, lo + rules.HANDS_PER_LEVEL - 1, sb, bb))
        print("Points by place: " + ", ".join("%d:%+d" % (i + 1, p) for i, p in enumerate(rules.POINTS)))
        if not args.stacks:
            return 0
    pay = args.payouts if args.payouts else rules.POINTS[:len(args.stacks)]
    eq = icm_equities(args.stacks, pay)
    print("payouts: %s" % ", ".join("%g" % p for p in pay))
    for s, e in zip(args.stacks, eq):
        print("  stack %7d  ->  %8.4f points" % (s, e))
    print("  total            %8.4f" % sum(eq))
    return 0


if __name__ == "__main__":
    sys.exit(main())
