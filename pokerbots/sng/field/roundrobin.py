"""Round-robin of the field against itself under the real rules (1 ms enforced).

    python3 -m sng.field.roundrobin --tables 200 --workers 2

Table t seats 8 of the field_mix() entries (a seeded random choice, so each archetype
plays ~80% of the tables) in shuffled seats. Prints average points per archetype with
standard errors, plus its auto-fold rate (decisions over the time limit).
"""
from __future__ import annotations

import argparse
import math
import random
from multiprocessing import Pool

from sng.field import field_mix
from sng.rules import SngRules
from sng.table import play_table


def one_table(t: int):
    pairs = dict(field_mix())
    names = random.Random(t).sample(sorted(pairs), 8)
    r = play_table([pairs[n]() for n in names], SngRules(), seed=t)
    return [(n, p, st.over_limit, st.decisions) for n, p, st in zip(names, r.points, r.stats)]


def summarize(rows):
    acc = {}
    for table in rows:
        for n, p, over, dec in table:
            a = acc.setdefault(n, [[], 0, 0])
            a[0].append(p)
            a[1] += over
            a[2] += dec
    out = []
    for n, (pts, over, dec) in acc.items():
        m = sum(pts) / len(pts)
        sd = math.sqrt(sum((x - m) ** 2 for x in pts) / max(1, len(pts) - 1))
        out.append((n, m, sd / math.sqrt(len(pts)), len(pts), over / max(1, dec)))
    return sorted(out, key=lambda x: -x[1])


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--tables", type=int, default=200)
    ap.add_argument("--workers", type=int, default=2)
    args = ap.parse_args(argv)
    with Pool(args.workers) as pool:
        rows = pool.map(one_table, range(args.tables), chunksize=4)
    print(f"{'bot':14s} {'points':>7s} {'se':>5s} {'tables':>6s} {'>1ms':>6s}")
    for n, m, se, k, over in summarize(rows):
        print(f"{n:14s} {m:7.2f} {se:5.2f} {k:6d} {over:6.1%}")


if __name__ == "__main__":
    main()
