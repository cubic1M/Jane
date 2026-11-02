#!/usr/bin/env python3
"""Paired A/B of planb_bot parameter changes (prompt 4).

    python3 planb/ab.py --tables 800 --set OPEN_BAR=1.18

Both sides play the same tables (same seat order, deck seeds, and every
random generator seeded per table: the bot's SEED and the global `random`
the sample bots use).  Time limit not enforced so jitter cannot change a
table.  Reports mean gain and the standard error of the paired difference.
"""

import argparse
import math
import multiprocessing as mp
import random
import sys
from pathlib import Path

KIT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(KIT))

from simkit.agent import BotAgent, load_module_from_path  # noqa: E402
from simkit.table import Table  # noqa: E402

BOT = Path(__file__).resolve().parent / "planb_bot.py"
OPP = [KIT / "bots" / f"sample_{n}.py" for n in ("tight", "caller", "shover")]


def play(args):
    t, base_seed, overrides = args
    rng = random.Random(base_seed * 100003 + t)
    order = list(range(8))
    rng.shuffle(order)
    deck_seed = rng.randrange(1 << 30)
    bot_seed = rng.randrange(1 << 30)
    random.seed(rng.randrange(1 << 30))

    def loader():
        m = load_module_from_path(BOT)
        m.SEED = bot_seed
        for k, v in overrides.items():
            m.__dict__[k] = v
        return m

    entries = [BotAgent("me", loader, enforce_time=False)] + [
        BotAgent.from_file(f"o{i}", OPP[i % 3], enforce_time=False)
        for i in range(7)]
    agents = [entries[i] for i in order]
    res = Table(agents, seed=deck_seed).play()
    return next(r["points"] for r in res if r["name"] == "me")


def run(tables, seed, overrides, procs):
    with mp.Pool(procs) as pool:
        return pool.map(play, [(t, seed, overrides) for t in range(tables)])


def parse(kv):
    k, v = kv.split("=")
    return k, float(v) if "." in v else int(v)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--tables", type=int, default=800)
    ap.add_argument("--seed", type=int, default=1)
    ap.add_argument("--set", action="append", default=[])
    ap.add_argument("--procs", type=int, default=mp.cpu_count())
    a = ap.parse_args()
    over = dict(parse(x) for x in a.set)
    base = run(a.tables, a.seed, {}, a.procs)
    test = run(a.tables, a.seed, over, a.procs)
    d = [y - x for x, y in zip(base, test)]
    n = len(d)
    mean = sum(d) / n
    sd = math.sqrt(sum((x - mean) ** 2 for x in d) / (n - 1))
    se = sd / math.sqrt(n)
    print(f"{over}: base {sum(base) / n:.1f}  test {sum(test) / n:.1f}  "
          f"gain {mean:+.2f} +- {se:.2f} (se)  "
          f"{'KEEP' if mean > 2 * se else 'reject'}")


if __name__ == "__main__":
    main()
