"""Lead protection: X+lp vs X (the same bot without it), many 1000-hand matches.

By symmetry X vs X wins 50% of matches and 0 bb/hand, so any deviation is the
effect of lead protection: on match win rate (what matters if matches are scored
win/loss) and on chips (what matters if scored by total chips).

    python -m experiments.lead_protection --bot balanced --variants a_nlhe100 --pairs 60
Writes results/lead_protection.md.
"""
from __future__ import annotations

import argparse
import math

from experiments.common import RESULTS, ROOT, load_results, match_wins, pair_units, run_jobs
from experiments.stats import fmt_ci, mean_ci


def summarize(bots, variants) -> str:
    lines = ["| variant | matchup | match wins (W-L-T) | win rate ± 95% CI | bb/hand ± 95% CI |",
             "|---|---|---|---|---|"]
    for v in variants:
        recs = load_results("lead", v)
        for b in bots:
            a = f"{b}+lp"
            w, l, t = match_wins(recs, a, b)
            n = w + l + t
            if n == 0:
                continue
            p = (w + 0.5 * t) / n
            h = 1.96 * math.sqrt(max(p * (1 - p), 1e-9) / n)
            m, hh, k = mean_ci(pair_units(recs, a, b))
            lines.append(f"| {v} | {a} vs {b} | {w}-{l}-{t} | {p:.3f} ± {h:.3f} | {fmt_ci(m, hh, 3)} (pairs={k}) |")
    return "\n".join(lines)


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--bots", default="balanced")
    ap.add_argument("--variants", default="a_nlhe100")
    ap.add_argument("--pairs", type=int, default=60)
    ap.add_argument("--hands", type=int, default=1000)
    ap.add_argument("--workers", type=int, default=3)
    a = ap.parse_args(argv)
    bots, variants = a.bots.split(","), a.variants.split(",")
    jobs = [dict(exp="lead", variant=v, a=f"{b}+lp", b=b, seed=70_000 + k, hands=a.hands)
            for v in variants for b in bots for k in range(a.pairs)]
    run_jobs(jobs, workers=a.workers, label="lead")
    md = summarize(bots, variants)
    RESULTS.mkdir(parents=True, exist_ok=True)
    (RESULTS / "lead_protection.md").write_text(md + "\n")
    print(md)


if __name__ == "__main__":
    main()
