#!/usr/bin/env python3
"""Run tables with planb_bot's debug checks on (prompt 4).

    PLANB_DEBUG=1 python3 planb/debug_run.py --tables 100

Every decision is checked: rebuilt pot == chips put in this hand, stacks +
pot == starting total, raise-by within [min_raise_by, all-in].
"""

import argparse
import os
import random
import sys
from pathlib import Path

KIT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(KIT))

from simkit.agent import BotAgent, load_module_from_path  # noqa: E402
from simkit.table import Table  # noqa: E402

BOT = Path(__file__).resolve().parent / "planb_bot.py"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--tables", type=int, default=100)
    ap.add_argument("--seed", type=int, default=11)
    a = ap.parse_args()
    debug = os.environ.get("PLANB_DEBUG", "1") != "0"
    logs = []
    decisions = [0]

    def loader():
        m = load_module_from_path(BOT)
        m.DEBUG = debug
        logs.append(m.DEBUG_LOG)
        return m

    opp = [KIT / "bots" / f"sample_{n}.py" for n in ("tight", "caller", "shover")]
    master = random.Random(a.seed)
    errors = 0
    for t in range(a.tables):
        agents = [BotAgent("planb", loader, enforce_time=False)]
        agents += [BotAgent.from_file(f"o{i}", opp[i % 3], enforce_time=False)
                   for i in range(7)]
        master.shuffle(agents)
        Table(agents, seed=master.randrange(1 << 30)).play()
        me = next(x for x in agents if x.name == "planb")
        decisions[0] += me.stats.decisions
        errors += me.stats.errors
    problems = [m for lg in logs for m in lg]
    print(f"{a.tables} tables, {decisions[0]} decisions, {errors} errors, "
          f"debug={'on' if debug else 'off'}, {len(problems)} debug problems")
    for m in problems[:20]:
        print("  ", m)


if __name__ == "__main__":
    main()
