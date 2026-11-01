"""Sit-and-go arena: candidates vs a field, on paired tables.

For table t: deal_seed = seed0 + t, the candidate sits in seat t % 8, the other 7
seats get field bots drawn (by weight, seeded by t). Every candidate plays exactly the
same table (same cards per seat, same opponents in the same seats), so the difference
in points between two candidates is paired, which removes most of the card and seating
luck.

    python3 -m sng.arena --candidates tag_basic,station --tables 400 --workers 4
"""
from __future__ import annotations

import argparse
import json
import math
import multiprocessing as mp
import random
import time
from pathlib import Path

import numpy as np

from sng.registry import field_weights, make
from sng.rules import BLIND_SETS, PAYOUT_SETS, SngRules
from sng.table import play_table

ROOT = Path(__file__).resolve().parents[1]


class DiscardHelper:
    """Wraps a bot that does not know discard phases: answers them with the shared policy."""

    def __init__(self, inner):
        self.inner = inner

    def new_table(self, rules, seat, seed=0):
        from sng.ours import features as F
        self.rules, self.ctx = rules, F.get_ctx(rules.spec)
        self.inner.new_table(rules, seat, seed)

    def act(self, obs):
        lg = obs.legal
        if getattr(lg, "discard_count", 0):
            from engine.game import Discard
            from sng.ours.anyvar import choose_discard
            rule = next(iter(self.rules.spec.discards_on_street(obs.street)), None)
            return Discard(choose_discard(self.ctx, obs.hole, obs.board, lg.discard_min, lg.discard_count,
                                          bool(rule and rule.draw), bool(rule and rule.to_board)))
        return self.inner.act(obs)

    def end_hand(self, info):
        if hasattr(self.inner, "end_hand"):
            self.inner.end_hand(info)


def _table_job(args):
    t, cand, seed0, rules_kw, field = args
    rules = SngRules(**rules_kw)
    n = rules.num_players
    rng = random.Random(seed0 * 7919 + t)
    names, weights = zip(*field)
    seats = rng.choices(names, weights=weights, k=n - 1)
    my_seat = t % n
    lineup = seats[:my_seat] + [cand] + seats[my_seat:]
    bots = [make(x) for x in lineup]
    if rules.spec.discards:
        # field bots were written for hold'em: give them our sensible discard policy so a
        # comparison measures betting, not their engine-fallback discards
        bots = [b if getattr(b, "handles_discards", False) else DiscardHelper(b) for b in bots]
    res = play_table(bots, rules, seed=seed0 * 100003 + t, deal_seed=seed0 * 100003 + t)
    st = res.stats[my_seat]
    times = np.array(st.times) if st.times else np.zeros(1)
    return dict(t=t, cand=cand, points=res.points[my_seat], place=res.places[my_seat],
                survived=res.bust_hand[my_seat] is None, hands=res.hands,
                p99_ms=float(np.percentile(times, 99) * 1000), max_ms=float(times.max() * 1000),
                over=st.over_limit, decisions=st.decisions, errors=st.errors, illegal=st.illegal,
                first_error=st.first_error, lineup=lineup,
                field_points={x: res.points[i] for i, x in enumerate(lineup) if i != my_seat})


def run(candidates, field, rules_kw, tables=200, seed0=1, workers=4, log=print):
    jobs = [(t, c, seed0, rules_kw, field) for t in range(tables) for c in candidates]
    t0 = time.time()
    out = []
    if workers > 1:
        with mp.Pool(workers) as pool:
            for i, r in enumerate(pool.imap_unordered(_table_job, jobs, chunksize=4)):
                out.append(r)
                if (i + 1) % max(1, len(jobs) // 10) == 0:
                    log(f"  {i + 1}/{len(jobs)} tables ({time.time() - t0:.0f}s)")
    else:
        out = [_table_job(j) for j in jobs]
    return out


def ci95(xs):
    xs = np.asarray(xs, dtype=float)
    if len(xs) < 2:
        return float(xs.mean()) if len(xs) else 0.0, float("inf")
    return float(xs.mean()), float(1.96 * xs.std(ddof=1) / math.sqrt(len(xs)))


def summarize(out, candidates, baseline=None):
    by = {c: sorted([r for r in out if r["cand"] == c], key=lambda r: r["t"]) for c in candidates}
    lines = ["| bot | points/table | P(1st) | P(top 3) | busts | p99 ms | max ms | >1ms | errors+illegal |",
             "|---|---|---|---|---|---|---|---|---|"]
    for c in candidates:
        rs = by[c]
        m, h = ci95([r["points"] for r in rs])
        first = np.mean([r["place"] == 1 for r in rs])
        top3 = np.mean([(r["place"] is not None and r["place"] <= 3) or r["survived"] for r in rs])
        busts = np.mean([not r["survived"] for r in rs])
        lines.append(f"| {c} | {m:.2f} ± {h:.2f} | {first:.0%} | {top3:.0%} | {busts:.0%} | "
                     f"{np.percentile([r['p99_ms'] for r in rs], 50):.3f} | {max(r['max_ms'] for r in rs):.2f} | "
                     f"{sum(r['over'] for r in rs)} | {sum(r['errors'] + r['illegal'] for r in rs)} |")
    if baseline and baseline in by:
        lines.append("")
        lines.append(f"paired difference vs {baseline} (same tables):")
        base = {r["t"]: r["points"] for r in by[baseline]}
        for c in candidates:
            if c == baseline:
                continue
            d = [r["points"] - base[r["t"]] for r in by[c] if r["t"] in base]
            m, h = ci95(d)
            sig = " *" if abs(m) > h else ""
            lines.append(f"  {c:28s} {m:+.2f} ± {h:.2f}{sig}")
    errs = [r["first_error"] for r in out if r["first_error"]]
    if errs:
        lines.append("\nfirst error: " + errs[0][-600:])
    return "\n".join(lines)


def field_table(out):
    """Average points of each field archetype across all tables (who is strong)."""
    acc = {}
    for r in out:
        for x, p in r["field_points"].items():
            acc.setdefault(x, []).append(p)
    rows = sorted(((x, *ci95(v), len(v)) for x, v in acc.items()), key=lambda r: -r[1])
    return "\n".join(f"  {x:22s} {m:6.2f} ± {h:.2f}  (n={n})" for x, m, h, n in rows)


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--candidates", required=True)
    ap.add_argument("--baseline", default=None)
    ap.add_argument("--field", default="default", help="field mix name in sng.registry")
    ap.add_argument("--tables", type=int, default=200)
    ap.add_argument("--seed0", type=int, default=1)
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--payouts", default="synthetic", choices=sorted(PAYOUT_SETS))
    ap.add_argument("--no-enforce", action="store_true", help="do not fold over-time decisions")
    ap.add_argument("--out", default=None, help="write raw results JSON here")
    ap.add_argument("--variant", default=None, help="card rules from engine.variants (default NLHE)")
    ap.add_argument("--betting", default=None, choices=[None, "no_limit", "pot_limit"])
    ap.add_argument("--blinds", default="synthetic", choices=sorted(BLIND_SETS))
    ap.add_argument("--preset", default=None, help="full rule set from sng.presets (overrides the above)")
    a = ap.parse_args(argv)
    cands = a.candidates.split(",")
    rules_kw = dict(payouts=PAYOUT_SETS[a.payouts], enforce_time=not a.no_enforce, blinds=BLIND_SETS[a.blinds])
    if a.variant or a.betting:
        from engine.variants import get_variant
        from sng.rules import NLHE
        spec = get_variant(a.variant).with_(stack_reset_per_hand=False) if a.variant else NLHE
        if a.betting:
            spec = spec.with_(betting=a.betting)
        rules_kw["spec"] = spec
    if a.preset:
        from sng.presets import PRESETS
        rules_kw.update(PRESETS[a.preset])
    field = field_weights(a.field)
    t0 = time.time()
    out = run(cands, field, rules_kw, a.tables, a.seed0, a.workers)
    print(summarize(out, cands, a.baseline or cands[0]))
    print("\nfield archetypes (points/table):")
    print(field_table(out))
    print(f"\n{len(out)} tables in {time.time() - t0:.0f}s")
    if a.out:
        Path(a.out).parent.mkdir(parents=True, exist_ok=True)
        Path(a.out).write_text(json.dumps(out, default=str))


if __name__ == "__main__":
    main()
