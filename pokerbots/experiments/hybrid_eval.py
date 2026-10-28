"""Out-of-sample evaluation of the bots designed after the round-robin.

hybrid (and its two parents, for a paired comparison) vs the strong candidates and
the dummies, on FRESH deal seeds (20000+) that the round-robin never used, so the
design decision cannot have been fitted to these cards.

    python -m experiments.hybrid_eval [--pairs 10] [--workers 4]
"""
from __future__ import annotations

import argparse

from experiments.common import run_jobs

VARIANTS = ["a_nlhe100", "c_discard3", "d_omaha4x2", "e_shortdeck", "g_pineapple"]
SUBJECTS = ["hybrid@30m", "adaptive", "full_cfr@30m"]
OPPONENTS = ["full_cfr@30m", "adaptive", "balanced", "preflop_cfr@15m", "push", "station", "maniac", "random_legal"]


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--pairs", type=int, default=10)
    ap.add_argument("--hands", type=int, default=1000)
    ap.add_argument("--workers", type=int, default=4)
    a = ap.parse_args(argv)
    jobs = []
    for k in range(a.pairs):
        for v in VARIANTS:
            for s in SUBJECTS:
                for o in OPPONENTS:
                    if o == s:
                        continue
                    jobs.append(dict(exp="hybrid", variant=v, a=s, b=o, seed=20_000 + k, hands=a.hands))
    run_jobs(jobs, workers=a.workers, label="hybrid")


if __name__ == "__main__":
    main()
