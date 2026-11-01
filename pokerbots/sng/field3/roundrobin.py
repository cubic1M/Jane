"""Round robin of the field-3 bots on 8-bot sit-and-go tables.

  mix:    each table seats 8 bots drawn by the field3 weights (what a regional looks like)
  rotate: each table seats all 8 bots once, seats rotated by table number

    python3 -m sng.field3.roundrobin --tables 300 --mode mix --workers 4
Reports average points per appearance +- standard error, plus timing per bot.
"""
from __future__ import annotations

import os

for _v in ("OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS"):
    os.environ.setdefault(_v, "1")   # one BLAS thread per worker, or timings suffer

import argparse  # noqa: E402
import math  # noqa: E402
import multiprocessing as mp  # noqa: E402
import random  # noqa: E402
import time  # noqa: E402
from collections import defaultdict  # noqa: E402

import numpy as np  # noqa: E402

from sng.field3.registry import BOTS, FIELDS, make  # noqa: E402
from sng.rules import SngRules  # noqa: E402
from sng.table import play_table  # noqa: E402


def lineup(t, mode, seed0):
    names = list(BOTS)
    if mode == "rotate":
        rng = random.Random(seed0 * 7919 + t)
        order = names[:]
        rng.shuffle(order)
        k = t % len(order)
        return order[k:] + order[:k]
    rng = random.Random(seed0 * 7919 + t)
    nm, w = zip(*FIELDS["field3"])
    return rng.choices(nm, weights=w, k=8)


def job(args):
    t, mode, seed0 = args
    names = lineup(t, mode, seed0)
    bots = [make(x) for x in names]
    res = play_table(bots, SngRules(), seed=seed0 * 100003 + t)
    out = []
    for name, pts, st, bh in zip(names, res.points, res.stats, res.bust_hand):
        ts = np.array(st.times) if st.times else np.zeros(1)
        out.append((name, pts, st.decisions, st.over_limit, st.errors, st.illegal,
                    float(np.percentile(ts, 99)) * 1e3, bh))
    return out, res.hands


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--tables", type=int, default=300)
    ap.add_argument("--mode", choices=("mix", "rotate"), default="mix")
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--seed", type=int, default=3)
    a = ap.parse_args(argv)
    t0 = time.time()
    jobs = [(t, a.mode, a.seed) for t in range(a.tables)]
    with mp.Pool(a.workers) as pool:
        results = pool.map(job, jobs, chunksize=4)
    pts = defaultdict(list)
    dec = defaultdict(int)
    over = defaultdict(int)
    errs = defaultdict(int)
    p99 = defaultdict(list)
    hands = []
    for out, h in results:
        hands.append(h)
        for name, p, d, o, e, il, q, bh in out:
            pts[name].append(p)
            dec[name] += d
            over[name] += o
            errs[name] += e + il
            p99[name].append(q)
    print(f"{a.tables} tables, mode={a.mode}, {time.time() - t0:.0f}s, mean hands {np.mean(hands):.0f}")
    print(f"{'bot':16s} {'seats':>5s} {'points':>7s} {'+-SE':>5s}  {'over1ms%':>8s} {'err':>4s} {'p99ms(med)':>10s}")
    rows = sorted(pts, key=lambda k: -np.mean(pts[k]))
    for k in rows:
        x = np.array(pts[k])
        se = x.std(ddof=1) / math.sqrt(len(x)) if len(x) > 1 else float("nan")
        print(f"{k:16s} {len(x):5d} {x.mean():7.2f} {se:5.2f}  {100 * over[k] / max(1, dec[k]):8.1f} "
              f"{errs[k]:4d} {np.median(p99[k]):10.3f}")
    print("(average points per seat is 278/8 = 34.75 with the synthetic payouts)")


if __name__ == "__main__":
    main()
