"""Round-robin of the field2 bots: each table seats 8 bots drawn at random (with
repeats) from the six, points per appearance, mean +- standard error.

    python3 -m sng.field2.roundrobin --tables 300 --workers 4
"""
from __future__ import annotations

import argparse
import importlib
import math
import multiprocessing as mp
import random
import time

import numpy as np

from sng.rules import SngRules
from sng.table import play_table

from .registry import BOTS


def make(name):
    mod, cls = BOTS[name]
    return getattr(importlib.import_module(mod), cls)()


def _job(args):
    t, seed0, names = args
    rules = SngRules()
    rng = random.Random(seed0 * 1000003 + t)
    lineup = [rng.choice(names) for _ in range(rules.num_players)]
    res = play_table([make(x) for x in lineup], rules, seed=seed0 * 100003 + t)
    rows = []
    for i, x in enumerate(lineup):
        st = res.stats[i]
        rows.append(dict(bot=x, points=res.points[i], first=res.places[i] == 1, survived=res.bust_hand[i] is None,
                         bust=res.bust_hand[i], errors=st.errors + st.illegal, over=st.over_limit,
                         times=st.times))
    return dict(t=t, hands=res.hands, rows=rows)


def run(tables=300, workers=4, seed0=1):
    names = list(BOTS)
    jobs = [(t, seed0, names) for t in range(tables)]
    if workers > 1:
        with mp.Pool(workers) as pool:
            out = list(pool.imap_unordered(_job, jobs, chunksize=2))
    else:
        out = [_job(j) for j in jobs]
    return out


def summarize(out):
    names = list(BOTS)
    by = {n: [] for n in names}
    for o in out:
        for r in o["rows"]:
            by[r["bot"]].append(r)
    lines = ["| bot | seats | points/seat | +- SE | P(1st) | survived to cap | p99 ms | >1 ms | errors+illegal |",
             "|---|---|---|---|---|---|---|---|---|"]
    order = sorted(names, key=lambda n: -np.mean([r["points"] for r in by[n]]) if by[n] else 0)
    for n in order:
        rs = by[n]
        if not rs:
            continue
        p = np.array([r["points"] for r in rs], dtype=float)
        se = p.std(ddof=1) / math.sqrt(len(p)) if len(p) > 1 else float("nan")
        times = np.concatenate([np.asarray(r["times"]) for r in rs if r["times"]])
        lines.append(f"| {n} | {len(rs)} | {p.mean():.2f} | {se:.2f} | {np.mean([r['first'] for r in rs]):.3f} | "
                     f"{np.mean([r['survived'] for r in rs]):.3f} | {np.percentile(times, 99) * 1000:.3f} | "
                     f"{sum(r['over'] for r in rs)} | {sum(r['errors'] for r in rs)} |")
    hands = [o["hands"] for o in out]
    lines.append("")
    lines.append(f"tables {len(out)}, mean hands/table {np.mean(hands):.1f}, reached the 200-hand cap "
                 f"{np.mean([h >= 200 for h in hands]):.2f}; mean points per seat = 278/8 = 34.75")
    return "\n".join(lines)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--tables", type=int, default=300)
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--seed", type=int, default=1)
    a = ap.parse_args()
    t0 = time.time()
    out = run(a.tables, a.workers, a.seed)
    print(summarize(out))
    print(f"wall {time.time() - t0:.0f}s")


if __name__ == "__main__":
    main()
