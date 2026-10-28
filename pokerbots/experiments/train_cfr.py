"""Train the CFR policies used by the study, as a queue of single-threaded jobs.

Budgets (reduced from "everything at 60 min" to fit the machine; see REPORT.md):
  full-game CFR : 60 min with checkpoints 5,15,30,60 on variants in --long (a, c),
                  30 min with checkpoints 5,15,30 on the other variants
  preflop CFR   : 30 min with checkpoints 5,15,30 on --long variants, 15 min (5,15) elsewhere
A job is skipped if its final checkpoint file exists. Wall-clock budgets: run at
most one job per free core (--workers) or the iteration counts drop.

    python -m experiments.train_cfr [--workers 3] [--full 15,30,60] [--preflop 5,15,30]
"""
from __future__ import annotations

import argparse
import importlib.util
import os
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / "cache" / "cfr"
LOGS = ROOT / "results" / "logs"


def jobs(full_budgets, pre_budgets, long_variants, variants):
    out = []
    full_max = max(full_budgets)
    pre_max = max(pre_budgets)
    for v in variants:
        if importlib.util.find_spec("bots.cfr_full") is not None:
            top = full_max if v in long_variants else min(full_max, 30)
            cps = sorted({b for b in [5] + full_budgets if b <= top} | {top})
            out.append(("full", v, top, cps))
        if importlib.util.find_spec("bots.cfr_preflop") is not None:
            top = pre_max if v in long_variants else min(pre_max, 15)
            cps = sorted({b for b in pre_budgets if b <= top} | {top})
            out.append(("preflop", v, top, cps))
    # longest first so the queue finishes evenly
    out.sort(key=lambda j: -j[2])
    return out


def cmd(kind, v, minutes, cps):
    mod = "bots.cfr_full.train" if kind == "full" else "bots.cfr_preflop.train"
    return [sys.executable, "-m", mod, "--variant", v, "--minutes", str(minutes),
            "--checkpoints", ",".join(map(str, cps)), "--seed", "0", "--out", str(CACHE) + "/"]


def main(argv=None):
    from engine.variants import VARIANTS
    ap = argparse.ArgumentParser()
    ap.add_argument("--workers", type=int, default=3)
    ap.add_argument("--full", default="15,30,60")
    ap.add_argument("--preflop", default="5,15,30")
    ap.add_argument("--long", default="a_nlhe100,c_discard3")
    ap.add_argument("--variants", default="all")
    ap.add_argument("--only", default="", help="full or preflop")
    a = ap.parse_args(argv)
    variants = list(VARIANTS) if a.variants == "all" else a.variants.split(",")
    q = jobs([int(x) for x in a.full.split(",")], [int(x) for x in a.preflop.split(",")],
             a.long.split(","), variants)
    if a.only:
        q = [j for j in q if j[0] == a.only]
    q = [j for j in q if not (CACHE / f"{j[0]}_{j[1]}_{j[2]}m.pkl").exists()]
    CACHE.mkdir(parents=True, exist_ok=True)
    LOGS.mkdir(parents=True, exist_ok=True)
    env = dict(os.environ, OMP_NUM_THREADS="1", OPENBLAS_NUM_THREADS="1")
    running = []
    print(f"{len(q)} training jobs, {a.workers} at a time", flush=True)
    while q or running:
        while q and len(running) < a.workers:
            kind, v, m, cps = q.pop(0)
            log = open(LOGS / f"train_{kind}_{v}.log", "w")
            p = subprocess.Popen(cmd(kind, v, m, cps), cwd=ROOT, env=env, stdout=log, stderr=subprocess.STDOUT)
            running.append((p, kind, v, m, time.time()))
            print(f"start {kind} {v} {m}m checkpoints {cps}", flush=True)
        for r in list(running):
            if r[0].poll() is not None:
                print(f"done  {r[1]} {r[2]} rc={r[0].returncode} ({(time.time()-r[4])/60:.1f} min)", flush=True)
                running.remove(r)
        time.sleep(5)


if __name__ == "__main__":
    main()
