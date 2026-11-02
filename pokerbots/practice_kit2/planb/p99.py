#!/usr/bin/env python3
"""Decision-time percentiles for a bot (the kit runner shows only mean/max).

Times every get_action / on_hand_end call the way the kit clock does
(JSON round trip included) by wrapping simkit.agent.BotAgent._call.

    python3 planb/p99.py --bot planb/planb_bot.py --tables 50
"""

import argparse
import random
import sys
from pathlib import Path

KIT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(KIT))

from simkit.agent import BotAgent  # noqa: E402
from simkit.rules import PAYOUTS_PER_MILLE  # noqa: E402
from simkit.table import Table  # noqa: E402


class TimedAgent(BotAgent):
    def _call(self, fn, payload):
        reply, ms, err = super()._call(fn, payload)
        kind = "hand_end" if "my_hole_cards" in payload else payload.get("type")
        self.times.setdefault(kind, []).append(ms)
        return reply, ms, err


def pct(xs, q):
    xs = sorted(xs)
    return xs[min(len(xs) - 1, int(q * len(xs)))]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--bot", required=True)
    ap.add_argument("--tables", type=int, default=50)
    ap.add_argument("--seed", type=int, default=3)
    a = ap.parse_args()
    opp = [KIT / "bots" / f"sample_{n}.py" for n in ("tight", "caller", "shover")]
    entries = [Path(a.bot).resolve()] + [opp[i % 3] for i in range(7)]
    master = random.Random(a.seed)
    times = {}
    for t in range(a.tables):
        agents = []
        for i, p in enumerate(entries):
            ag = TimedAgent.from_file(f"b{i}", p)
            ag.times = times if i == 0 else {}
            agents.append(ag)
        master.shuffle(agents)
        Table(agents, seed=master.randrange(1 << 30)).play()
    for kind, xs in sorted(times.items()):
        print(f"{kind:<9} n={len(xs):>7}  mean {sum(xs) / len(xs):.3f}  "
              f"p50 {pct(xs, .5):.3f}  p99 {pct(xs, .99):.3f}  "
              f"p99.9 {pct(xs, .999):.3f}  max {max(xs):.3f} ms  "
              f">1ms {sum(x > 1 for x in xs)}")


if __name__ == "__main__":
    main()
