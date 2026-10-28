"""Turn results/ into markdown tables (report/tables.md), included by REPORT.md.

    python -m report.make_tables
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np

from experiments.common import ROOT, load_results, match_wins, pair_units
from experiments.stats import fmt_ci, mean_ci

OUT = ROOT / "report" / "tables.md"


def _bots_in(recs):
    names = []
    for r in recs:
        for k in ("a", "b"):
            if r[k] not in names:
                names.append(r[k])
    return names


def roundrobin_tables(exp="roundrobin", cands=None, dummies=None) -> str:
    from experiments.roundrobin import CANDIDATES, DUMMIES
    from engine.variants import VARIANTS
    cands = cands or CANDIDATES
    dummies = dummies or DUMMIES
    lines = []
    summary = {}
    for v in VARIANTS:
        recs = load_results(exp, v)
        if not recs:
            continue
        present = [c for c in cands if any(r["a"] == c or r["b"] == c for r in recs)]
        lines.append(f"\n#### {v}\n")
        cols = present + [d for d in dummies if any(r["b"] == d for r in recs)]
        lines.append("| bot \\ vs | " + " | ".join(cols) + " | mean vs candidates | match W-L |")
        lines.append("|---" * (len(cols) + 3) + "|")
        for a in present:
            cells, cand_means, w_tot, l_tot = [], [], 0, 0
            for b in cols:
                if a == b:
                    cells.append("—")
                    continue
                u = pair_units(recs, a, b)
                m, h, n = mean_ci(u)
                if n == 0:
                    cells.append("")
                    continue
                star = "**" if abs(m) > h else ""
                cells.append(f"{star}{fmt_ci(m, h)}{star} (n={n})")
                if b in present:
                    cand_means.append(u)
                    w, l, _ = match_wins(recs, a, b)
                    w_tot += w
                    l_tot += l
            # mean over opponents of per-pair units (each opponent equally weighted)
            if cand_means:
                k = min(len(x) for x in cand_means)
                per_seed = np.mean([x[:k] for x in cand_means], axis=0)
                m, h, _ = mean_ci(per_seed)
                summary.setdefault(v, {})[a] = (m, h)
                avg = fmt_ci(m, h)
            else:
                avg = ""
            lines.append(f"| {a} | " + " | ".join(cells) + f" | {avg} | {w_tot}-{l_tot} |")
    head = ["Cells: bb/hand for the row bot, mean ± 95% CI over duplicate pairs "
            "(n = pairs; each pair = 2 matches with seats swapped). **Bold** = CI excludes 0."]
    if summary:
        head.append("\n#### Summary: mean bb/hand vs the other candidates\n")
        vs = list(summary)
        bots = [c for c in cands if any(c in summary[v] for v in vs)]
        head.append("| bot | " + " | ".join(vs) + " |")
        head.append("|---" * (len(vs) + 1) + "|")
        for b in bots:
            row = [fmt_ci(*summary[v][b]) if b in summary[v] else "" for v in vs]
            head.append(f"| {b} | " + " | ".join(row) + " |")
    return "\n".join(head + lines)


def robustness_table() -> str:
    from experiments.robustness import BUGS
    recs_all = {}
    lines = ["| bug (variant) | bot | bugged vs clean self, bb/hand | errors/illegal per match |",
             "|---|---|---|---|"]
    any_rows = False
    for bug, v in BUGS.items():
        recs = load_results("robustness", v)
        for r in recs:
            if not r["a"].endswith("!" + bug):
                continue
        bots = sorted({r["b"] for r in recs if r["a"].endswith("!" + bug)})
        for b in bots:
            a = f"{b}!{bug}"
            u = pair_units(recs, a, b)
            m, h, n = mean_ci(u)
            errs = [r[f"stats_seat{s}"]["a"]["errors"] + r[f"stats_seat{s}"]["a"]["illegal"]
                    for r in recs if r["a"] == a for s in (0, 1)]
            lines.append(f"| {bug} ({v}) | {b} | {fmt_ci(m, h)} (n={n}) | {np.mean(errs):.1f} |")
            any_rows = True
    return "\n".join(lines) if any_rows else "_no robustness results yet_"


def timing_table() -> str:
    p = ROOT / "results" / "timing.json"
    if not p.exists():
        return "_no timing results yet_"
    res = json.loads(p.read_text())
    lines = ["| variant | bot | mean ms | p99 ms | max ms | >100ms | >500ms | >2s | decisions/hand | est. s per 1000 hands |",
             "|---|---|---|---|---|---|---|---|---|---|"]
    for r in res:
        o = r["over"]
        lines.append(f"| {r['variant']} | {r['bot']} | {r['mean_ms']:.2f} | {r['p99_ms']:.1f} | {r['max_ms']:.1f} | "
                     f"{o['100']} | {o['500']} | {o['2000']} | {r['decisions_per_hand']:.2f} | {r['projected_match_s']:.0f} |")
    return "\n".join(lines)


def main():
    parts = ["# Generated tables\n", "## Round-robin\n", roundrobin_tables(),
             "\n## Robustness\n", robustness_table(), "\n## Timing\n", timing_table()]
    extra = ROOT / "results" / "cfr_budget.md"
    if extra.exists():
        parts += ["\n## CFR strength vs training time\n", extra.read_text()]
    lp = ROOT / "results" / "lead_protection.md"
    if lp.exists():
        parts += ["\n## Lead protection\n", lp.read_text()]
    OUT.write_text("\n".join(parts) + "\n")
    print(f"wrote {OUT}")


if __name__ == "__main__":
    main()
