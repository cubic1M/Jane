"""Round-robin of candidates on every variant (+ candidates vs dummy opponents).

Every pairing uses the same deal seeds (10000 + k), so all pairings see the same
card sequences, and each seed is played with seats swapped (duplicate pair).
`--pairs 10` = 20 matches per pairing.

    python -m experiments.roundrobin --variants all --pairs 10 --hands 1000 --workers 3
"""
from __future__ import annotations

import argparse
from itertools import combinations

from experiments.common import run_jobs

CANDIDATES = ["equity", "balanced", "adaptive", "preflop_cfr@15m", "full_cfr@30m"]
DUMMIES = ["push", "station", "maniac", "random_legal"]


def build_jobs(variants, cands, dummies, pairs, hands, exp="roundrobin", seed0=10_000):
    jobs = []
    for v in variants:
        for k in range(pairs):
            for a, b in combinations(cands, 2):
                jobs.append(dict(exp=exp, variant=v, a=a, b=b, seed=seed0 + k, hands=hands))
            for a in cands:
                for d in dummies:
                    jobs.append(dict(exp=exp, variant=v, a=a, b=d, seed=seed0 + k, hands=hands))
    return jobs


def main(argv=None):
    from engine.variants import VARIANTS
    ap = argparse.ArgumentParser()
    ap.add_argument("--variants", default="all")
    ap.add_argument("--bots", default=",".join(CANDIDATES))
    ap.add_argument("--dummies", default=",".join(DUMMIES))
    ap.add_argument("--pairs", type=int, default=10)
    ap.add_argument("--hands", type=int, default=1000)
    ap.add_argument("--workers", type=int, default=3)
    ap.add_argument("--exp", default="roundrobin")
    a = ap.parse_args(argv)
    variants = list(VARIANTS) if a.variants == "all" else a.variants.split(",")
    dummies = [d for d in a.dummies.split(",") if d]
    jobs = build_jobs(variants, a.bots.split(","), dummies, a.pairs, a.hands, exp=a.exp)
    # interleave so partial results cover every pairing early
    jobs.sort(key=lambda j: (j["seed"], j["variant"]))
    run_jobs(jobs, workers=a.workers, label=a.exp)


if __name__ == "__main__":
    main()
