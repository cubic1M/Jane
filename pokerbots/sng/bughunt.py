"""Continuous bug-hunter for the sit-and-go stack (resumable, bounded by --minutes).

Each round draws random rules: card variant (all engine variants plus the discard /
draw shapes), 2..8 players, random blind schedule, antes, point table and hand cap;
then a random line-up of bots from every registry (ours + all three fields). Checks:
  * the engine never raises;
  * chips are conserved and points add up to the paid places;
  * OUR bots (icm_tag, icm_any, icm_lite) make 0 errors and 0 illegal actions;
  * our bots' p99 decision time stays under 0.5 ms (recorded; flagged when exceeded).
Failures go to results/sng_bughunt/failures.jsonl with everything needed to replay.

    python3 -m sng.bughunt --minutes 60 --workers 3
"""
from __future__ import annotations

import argparse
import json
import multiprocessing as mp
import random
import time
import traceback
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "results" / "sng_bughunt"
OURS = ("icm_tag", "icm_any", "icm_lite")


def random_rules(rng):
    from engine.variants import ALL_VARIANTS
    from sng.presets import PRESETS
    from sng.rules import SngRules
    names = [n for n, s in ALL_VARIANTS.items() if not s.discards] + ["P:" + p for p in PRESETS if p != "default"]
    pick = rng.choice(names)
    if pick.startswith("P:"):
        kw = dict(PRESETS[pick[2:]])
        spec = kw.pop("spec", None)
    else:
        kw, spec = {}, ALL_VARIANTS[pick]
    if spec is None:
        from sng.rules import NLHE
        spec = NLHE
    spec = spec.with_(stack_reset_per_hand=False, starting_stack=2000, small_blind=10, big_blind=20, ante=0)
    if rng.random() < 0.3:
        spec = spec.with_(betting="pot_limit")
    n = rng.choice([2, 3, 4, 5, 6, 7, 8, 8, 8])
    if spec.hole_cards * n + spec.total_board_dealt > len(spec.deck):
        n = max(2, (len(spec.deck) - spec.total_board_dealt) // spec.hole_cards)
    growth = rng.choice([1.25, 1.5, 2.0])
    blinds = []
    sb, bb = 10, 20
    for _ in range(8):
        blinds.append((sb, bb))
        sb, bb = int(sb * growth), int(bb * growth)
    antes = tuple(rng.choice([0, 0, bb // 10]) for _ in range(8)) if rng.random() < 0.4 else ()
    pay = sorted((rng.randint(0, 100) for _ in range(n)), reverse=True)
    kw.pop("payouts", None)
    kw.pop("blinds", None)
    kw.pop("antes", None)
    return SngRules(spec=spec, num_players=n, blinds=tuple(blinds), antes=antes, payouts=tuple(pay),
                    max_hands=rng.choice([30, 100, 200]), enforce_time=True, **kw), pick


def _round(args):
    seed = args
    rng = random.Random(seed)
    from sng.registry import BOTS, make
    try:
        rules, pick = random_rules(rng)
    except Exception:  # noqa: BLE001
        return [dict(kind="rules_error", seed=seed, tb=traceback.format_exc()[-1500:])]
    field_names = [b for b in BOTS if b not in OURS and b not in ("mc_slow", "f3_mc_slow")]
    lineup = [rng.choice(field_names) for _ in range(rules.num_players)]
    for _ in range(rng.randint(1, 3)):
        lineup[rng.randrange(rules.num_players)] = rng.choice(OURS)
    fails = []
    try:
        bots = [make(x) for x in lineup]
        res = __import__("sng.table", fromlist=["play_table"]).play_table(bots, rules, seed=seed)
    except Exception:  # noqa: BLE001
        return [dict(kind="engine_crash", seed=seed, variant=pick, lineup=lineup, tb=traceback.format_exc()[-2500:])]
    total = rules.starting_stack * rules.num_players
    if sum(res.final_stacks) != total:
        fails.append(dict(kind="chips", seed=seed, variant=pick, lineup=lineup))
    if abs(sum(res.points) - sum(rules.payouts[:rules.num_players])) > 1e-6:
        fails.append(dict(kind="points", seed=seed, variant=pick, lineup=lineup, got=sum(res.points)))
    for i, name in enumerate(lineup):
        if name not in OURS:
            continue
        st = res.stats[i]
        if st.errors or st.illegal:
            fails.append(dict(kind="our_bot_error", seed=seed, variant=pick, bot=name, lineup=lineup,
                              errors=st.errors, illegal=st.illegal, first_error=(st.first_error or "")[-2000:]))
        if st.times:
            p99 = float(np.percentile(np.array(st.times) * 1000, 99))
            if p99 > 0.5:
                fails.append(dict(kind="slow", seed=seed, variant=pick, bot=name, p99_ms=round(p99, 3)))
    return fails


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--minutes", type=float, default=60)
    ap.add_argument("--workers", type=int, default=3)
    ap.add_argument("--seed", type=int, default=None)
    a = ap.parse_args(argv)
    OUT.mkdir(parents=True, exist_ok=True)
    prog = OUT / "progress.json"
    state = json.loads(prog.read_text()) if prog.exists() else dict(next_seed=1, rounds=0, failures=0)
    seed = a.seed or state["next_seed"]
    t_end = time.time() + 60 * a.minutes
    with mp.Pool(a.workers) as pool:
        while time.time() < t_end:
            batch = list(range(seed, seed + 4 * a.workers))
            seed += len(batch)
            for fails in pool.map(_round, batch):
                state["rounds"] += 1
                for f in fails:
                    state["failures"] += 1
                    f["t"] = time.strftime("%Y-%m-%d %H:%M:%S")
                    with open(OUT / "failures.jsonl", "a") as fh:
                        fh.write(json.dumps(f, default=str) + "\n")
                    print("FAIL", {k: v for k, v in f.items() if k not in ("tb", "first_error")}, flush=True)
            state["next_seed"] = seed
            prog.write_text(json.dumps(state))
    print(f"sng bughunt: {state['rounds']} rounds total, {state['failures']} failures total", flush=True)


if __name__ == "__main__":
    main()
