"""Coordinate-descent tuner for a sit-and-go bot on paired tables (resumable).

Each round: every parameter is tried one step up and one step down (numeric steps
from STEPS); all candidates play the same fresh tables (new seed per round) as the
current best. The best candidate replaces the incumbent if its paired gain exceeds
`accept_se` standard errors. State and history go to results/sng_tune/<name>.json.

    python3 -m sng.tune --bot icm_tag --rounds 6 --tables 500 --workers 4
"""
from __future__ import annotations

import argparse
import json
import math
import time
from pathlib import Path

import numpy as np

from sng.arena import run
from sng.registry import field_weights
from sng.rules import PAYOUT_SETS

ROOT = Path(__file__).resolve().parents[1]

# multiplicative (m) or additive (a) steps per parameter
STEPS = {
    "icm_tag": dict(open_mult=("m", 1.1), open_size=("a", 0.5), push_bb=("a", 3.0), push_mult=("m", 1.1),
                    range_k=("m", 1.25), call_margin=("a", 0.03), threebet_eq=("a", 0.04), risk=("a", 0.08),
                    value_eq=("a", 0.05), cbet=("a", 0.2), bet_frac=("a", 0.15), bet_discount=("a", 0.1),
                    steal_bonus=("a", 0.15)),
}


def name_of(bot, params, base):
    diff = {k: v for k, v in params.items() if base.get(k) != v}
    if not diff:
        return bot
    return bot + ":" + ";".join(f"{k}={round(v, 4)}" for k, v in sorted(diff.items()))


def neighbours(params, steps):
    for k, (kind, st) in steps.items():
        for sgn in (+1, -1):
            v = params[k] * (st if sgn > 0 else 1 / st) if kind == "m" else params[k] + sgn * st
            if v < 0:
                continue
            yield k, round(v, 4)


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--bot", default="icm_tag")
    ap.add_argument("--rounds", type=int, default=6)
    ap.add_argument("--tables", type=int, default=500)
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--field", default="default")
    ap.add_argument("--payouts", default="synthetic")
    ap.add_argument("--accept-se", type=float, default=1.0)
    ap.add_argument("--tag", default="")
    a = ap.parse_args(argv)
    import importlib
    base = dict(importlib.import_module(f"sng.ours.{a.bot}").PARAMS)
    steps = STEPS[a.bot]
    out_dir = ROOT / "results" / "sng_tune"
    out_dir.mkdir(parents=True, exist_ok=True)
    state_f = out_dir / f"{a.bot}{a.tag}.json"
    state = json.loads(state_f.read_text()) if state_f.exists() else dict(params=base, history=[], round=0)
    field = field_weights(a.field)
    rules_kw = dict(payouts=PAYOUT_SETS[a.payouts])
    while state["round"] < a.rounds:
        r = state["round"]
        inc = dict(state["params"])
        cands = {name_of(a.bot, inc, base): (None, None)}
        for k, v in neighbours(inc, steps):
            p = dict(inc, **{k: v})
            cands[name_of(a.bot, p, base)] = (k, v)
        names = list(cands)
        t0 = time.time()
        out = run(names, field, rules_kw, a.tables, seed0=1000 + 37 * r, workers=a.workers, log=lambda s: None)
        by = {n: {x["t"]: x["points"] for x in out if x["cand"] == n} for n in names}
        inc_name = names[0]
        rows = []
        for n in names[1:]:
            d = np.array([by[n][t] - by[inc_name][t] for t in by[inc_name]])
            se = d.std(ddof=1) / math.sqrt(len(d))
            rows.append((float(d.mean()), float(se), n, cands[n]))
        rows.sort(reverse=True)
        best = rows[0]
        inc_pts = float(np.mean(list(by[inc_name].values())))
        accepted = best[0] > a.accept_se * best[1]
        rec = dict(round=r, incumbent=inc_name, incumbent_points=inc_pts, best=best[2], gain=best[0], se=best[1],
                   accepted=accepted, top5=[(n, round(m, 2), round(s, 2)) for m, s, n, _ in rows[:5]],
                   seconds=round(time.time() - t0))
        print(json.dumps(rec), flush=True)
        if accepted:
            k, v = best[3]
            state["params"][k] = v
        state["history"].append(rec)
        state["round"] = r + 1
        state_f.write_text(json.dumps(state, indent=1))
    print("final:", name_of(a.bot, state["params"], base))


if __name__ == "__main__":
    main()
