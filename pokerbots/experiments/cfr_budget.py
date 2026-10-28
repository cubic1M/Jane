"""CFR strength vs training time.

For every policy checkpoint found in cache/cfr/ on the --variants:
  * abstract-game exploitability (the trainers' own evaluators), cached in
    results/cfr_expl.json
  * real-game head-to-head vs fixed opponents (equity, balanced), duplicate pairs
Writes results/cfr_budget.md.

    python -m experiments.cfr_budget --variants a_nlhe100,c_discard3 --pairs 10
"""
from __future__ import annotations

import argparse
import io
import json
import re
from contextlib import redirect_stdout
from pathlib import Path

from experiments.common import ROOT, load_results, pair_units, run_jobs
from experiments.stats import fmt_ci, mean_ci

CACHE = ROOT / "cache" / "cfr"
EXPL = ROOT / "results" / "cfr_expl.json"


def checkpoints(kind: str, variant: str) -> list[int]:
    out = []
    for p in CACHE.glob(f"{kind}_{variant}_*m.pkl"):
        m = re.search(r"_(\d+)m\.pkl$", p.name)
        if m:
            out.append(int(m.group(1)))
    return sorted(out)


def exploitability(kind: str, path: Path) -> dict:
    cache = json.loads(EXPL.read_text()) if EXPL.exists() else {}
    key = str(path.relative_to(ROOT))
    if key in cache:
        return cache[key]
    buf = io.StringIO()
    res = {}
    try:
        if kind == "full":
            from bots.cfr_full.evaluate import evaluate_policy
            r = evaluate_policy(str(path), deals=50000, log=lambda s: buf.write(s + "\n"))
            from bots.cfr_full.policy import load_policy_data
            meta = load_policy_data(str(path)).get("meta", {})
            res = dict(expl_lo=r["expl_out"], expl_hi=r["expl_in"], iterations=meta.get("iterations"))
        else:
            from bots.cfr_preflop import evaluate as pe
            with redirect_stdout(buf):
                r = pe.evaluate_policy(str(path))
            res = dict(expl_lo=r.get("expl_mbb"), expl_hi=r.get("expl_mbb"), iterations=r.get("iterations"))
    except Exception as e:  # report but do not stop the experiment
        res = dict(error=repr(e))
    res["log"] = buf.getvalue()[-2000:]
    cache[key] = res
    EXPL.parent.mkdir(parents=True, exist_ok=True)
    EXPL.write_text(json.dumps(cache, indent=1))
    return res


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--variants", default="a_nlhe100,c_discard3")
    ap.add_argument("--opponents", default="equity,balanced")
    ap.add_argument("--pairs", type=int, default=10)
    ap.add_argument("--hands", type=int, default=1000)
    ap.add_argument("--workers", type=int, default=3)
    ap.add_argument("--full", default="")      # accepted for run_all.sh symmetry; checkpoints are discovered
    ap.add_argument("--preflop", default="")
    a = ap.parse_args(argv)
    variants, opps = a.variants.split(","), a.opponents.split(",")
    jobs = []
    for v in variants:
        for kind, bot in (("full", "full_cfr"), ("preflop", "preflop_cfr")):
            for m in checkpoints(kind, v):
                for o in opps:
                    for k in range(a.pairs):
                        jobs.append(dict(exp="cfr_budget", variant=v, a=f"{bot}@{m}m", b=o,
                                         seed=30_000 + k, hands=a.hands))
    run_jobs(jobs, workers=a.workers, label="cfr_budget")

    lines = ["| variant | approach | budget | iterations | abstract exploitability (mbb/h) | "
             + " | ".join(f"vs {o} (bb/h)" for o in opps) + " |",
             "|---|---|---|---|---|" + "---|" * len(opps)]
    for v in variants:
        recs = load_results("cfr_budget", v)
        for kind, bot in (("full", "full_cfr"), ("preflop", "preflop_cfr")):
            for m in checkpoints(kind, v):
                ex = exploitability(kind, CACHE / f"{kind}_{v}_{m}m.pkl")
                if "error" in ex:
                    exs = f"error: {ex['error'][:60]}"
                elif kind == "full":
                    exs = f"{ex['expl_lo']:.0f} – {ex['expl_hi']:.0f}"
                else:
                    exs = f"{ex['expl_lo']:.1f}" if ex.get("expl_lo") is not None else "n/a"
                cells = []
                for o in opps:
                    mm, h, n = mean_ci(pair_units(recs, f"{bot}@{m}m", o))
                    cells.append(f"{fmt_ci(mm, h)} (n={n})" if n else "")
                lines.append(f"| {v} | {bot} | {m} min | {ex.get('iterations', '')} | {exs} | " + " | ".join(cells) + " |")
    md = "\n".join(lines)
    (ROOT / "results" / "cfr_budget.md").write_text(md + "\n")
    print(md)


if __name__ == "__main__":
    main()
