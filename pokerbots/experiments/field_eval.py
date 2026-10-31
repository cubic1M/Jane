"""Evaluation against a realistic field: six opponents written independently
(opponents/, by agents that never saw bots/) as strong tournament teams would.

Our candidates (incl. tuned versions) vs each field bot on every variant, fresh
deal seeds 40000+ (never used for design or tuning before this experiment).

    python -m experiments.field_eval [--pairs 6] [--workers 4] [--candidates ...]
"""
from __future__ import annotations

import argparse

from experiments.common import run_jobs

FIELD = ["opp_tag", "opp_gtolite", "opp_lag", "opp_exploit", "opp_solver", "opp_quick"]
CANDIDATES = ["adaptive", "hybrid@30m", "balanced", "full_cfr@30m", "equity"]


def build(cands, variants, pairs, hands, exp="field", seed0=40_000, field=FIELD):
    return [dict(exp=exp, variant=v, a=c, b=o, seed=seed0 + k, hands=hands)
            for k in range(pairs) for v in variants for c in cands for o in field]


def main(argv=None):
    from engine.variants import VARIANTS
    ap = argparse.ArgumentParser()
    ap.add_argument("--candidates", default=",".join(CANDIDATES))
    ap.add_argument("--field", default=",".join(FIELD))
    ap.add_argument("--variants", default="all")
    ap.add_argument("--pairs", type=int, default=6)
    ap.add_argument("--hands", type=int, default=1000)
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--exp", default="field")
    ap.add_argument("--seed0", type=int, default=40_000)
    a = ap.parse_args(argv)
    variants = list(VARIANTS) if a.variants == "all" else a.variants.split(",")
    jobs = build(a.candidates.split(","), variants, a.pairs, a.hands, exp=a.exp, seed0=a.seed0,
                 field=a.field.split(","))
    run_jobs(jobs, workers=a.workers, label=a.exp)


if __name__ == "__main__":
    main()
