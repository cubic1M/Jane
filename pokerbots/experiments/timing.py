"""Per-decision timing of each bot on each variant, single process.

Each bot plays `--hands` hands against random_legal (odd spots, all-ins) and the
same against balanced (realistic spots). All decision times are pooled.
Run it on an otherwise idle machine; parallel load inflates times.

    python -m experiments.timing [--bots ...] [--variants all] [--hands 150]
Writes results/timing.json.
"""
from __future__ import annotations

import argparse
import json
import os

import numpy as np

from experiments.common import ROOT, make_bot

BUDGETS_MS = (100, 500, 2000)


def time_bot(bot_str: str, variant: str, hands: int, seed: int = 777) -> dict:
    from engine.match import play_match
    from engine.variants import get_variant
    spec = get_variant(variant)
    times, decisions_per_hand = [], []
    errors = illegal = 0
    for opp in ("random_legal", "balanced"):
        for seat in (0, 1):
            b, o = make_bot(bot_str), make_bot(opp)
            pair = (b, o) if seat == 0 else (o, b)
            r = play_match(pair[0], pair[1], spec, deal_seed=seed + seat, hands=hands // 2)
            st = r.stats[seat]
            times += st.times
            errors += st.errors
            illegal += st.illegal
            decisions_per_hand.append(st.decisions / max(1, r.hands_played))
    t = np.array(times) * 1000
    dph = float(np.mean(decisions_per_hand))
    return dict(bot=bot_str, variant=variant, n=len(t), mean_ms=float(t.mean()),
                p50_ms=float(np.percentile(t, 50)), p99_ms=float(np.percentile(t, 99)),
                max_ms=float(t.max()), decisions_per_hand=dph,
                over={str(b): int((t > b).sum()) for b in BUDGETS_MS},
                projected_match_s=float(t.mean() * dph * 1000 / 1000),
                errors=errors, illegal=illegal)


def main(argv=None):
    from engine.variants import VARIANTS
    ap = argparse.ArgumentParser()
    ap.add_argument("--bots", default="equity,balanced,adaptive,preflop_cfr@15m,full_cfr@30m,adaptive_cfr@15m")
    ap.add_argument("--variants", default="all")
    ap.add_argument("--hands", type=int, default=200)
    ap.add_argument("--out", default=str(ROOT / "results" / "timing.json"))
    a = ap.parse_args(argv)
    os.environ.setdefault("OMP_NUM_THREADS", "1")
    variants = list(VARIANTS) if a.variants == "all" else a.variants.split(",")
    res = []
    if os.path.exists(a.out):
        res = json.load(open(a.out))
    have = {(r["bot"], r["variant"]) for r in res}
    for v in variants:
        for b in a.bots.split(","):
            if (b, v) in have:
                continue
            r = time_bot(b, v, a.hands)
            res.append(r)
            print(f"{v:14s} {b:18s} mean {r['mean_ms']:6.2f}  p99 {r['p99_ms']:6.1f}  max {r['max_ms']:7.1f} ms  "
                  f"over100 {r['over']['100']}  projected 1000-hand match {r['projected_match_s']:.0f}s", flush=True)
            os.makedirs(os.path.dirname(a.out), exist_ok=True)
            json.dump(res, open(a.out, "w"), indent=1)


if __name__ == "__main__":
    main()
