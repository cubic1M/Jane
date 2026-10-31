"""Shared experiment plumbing: bot spec strings, duplicate-pair jobs, result files.

Bot spec string: name[@budget][:opt=v;p.param=v][+lp][!bug]
    balanced            registry bot
    full_cfr@30m        CFR bot with the 30-minute policy (make_bot(budget="30m"))
    balanced+lp         wrapped in LeadProtection
    balanced!posflip    wrapped in a rules-mapping bug (see experiments/robustness.py)

One job = one duplicate pair: the same deal_seed played with A in seat 0 and then
in seat 1, so luck of the cards cancels. Results are JSON files under
results/raw/<experiment>/<variant>/, and existing files are skipped (resumable).
"""
from __future__ import annotations

import json
import os
import time
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
RESULTS = Path(os.environ.get("POKER_RESULTS", str(ROOT / "results")))  # QUICK runs use another dir
RAW = RESULTS / "raw"


def make_bot(spec_str: str):
    from bots.registry import make
    s = spec_str
    bug = None
    if "!" in s:
        s, bug = s.split("!", 1)
    lp = s.endswith("+lp")
    if lp:
        s = s[:-3]
    kw = {}
    if ":" in s:
        # options: name:gate=0.5;p.size_factor_min=0.25  (p.* = strategy params)
        s, opts = s.split(":", 1)
        for item in opts.split(";"):
            k, v = item.split("=", 1)
            try:
                v = float(v) if "." in v or "e" in v else int(v)
            except ValueError:
                pass
            if k.startswith("p."):
                key = "ad_params" if s.split("@")[0] == "hybrid" else "params"
                kw.setdefault(key, {})[k[2:]] = v
            else:
                kw[k] = v
    if "@" in s:
        s, budget = s.split("@", 1)
        # QUICK runs train tiny budgets only: BUDGET_OVERRIDE=1m maps every @XXm to it
        kw["budget"] = os.environ.get("BUDGET_OVERRIDE") or budget
    bot = make(s + ("+lp" if lp else ""), **kw)
    if bug:
        from experiments.robustness import Miswired
        bot = Miswired(bot, bug)
    bot.name = spec_str
    return bot


def _check_no_fallback(bot, label):
    inner = bot
    for _ in range(4):
        if getattr(inner, "using_fallback", False):
            raise RuntimeError(f"{label} is using its fallback policy (missing CFR policy file?)")
        inner = getattr(inner, "inner", None)
        if inner is None:
            break


def _uses_fallback(bot) -> bool:
    inner = bot
    for _ in range(4):
        if getattr(inner, "using_fallback", False):
            return True
        inner = getattr(inner, "inner", None)
        if inner is None:
            return False
    return False


def result_path(exp: str, variant: str, a: str, b: str, seed: int) -> Path:
    safe = lambda x: x.replace("/", "_")
    return RAW / exp / variant / f"{safe(a)}__vs__{safe(b)}__s{seed}.json"


def run_pair(job: dict) -> str:
    """Play one duplicate pair and write its JSON. Returns the path."""
    from engine.match import play_match
    from engine.variants import get_variant
    exp, variant, a, b, seed = job["exp"], job["variant"], job["a"], job["b"], job["seed"]
    hands = job.get("hands", 1000)
    out = result_path(exp, variant, a, b, seed)
    if out.exists() and not job.get("force"):
        return str(out)
    spec = get_variant(variant)
    if job.get("spec_overrides"):
        spec = spec.with_(**job["spec_overrides"])
    rec = dict(job=job, variant=spec.name, a=a, b=b, seed=seed, hands=hands, bb=spec.big_blind)
    t0 = time.time()
    for seat_a in (0, 1):
        A, B = make_bot(a), make_bot(b)
        pair = (A, B) if seat_a == 0 else (B, A)
        r = play_match(pair[0], pair[1], spec, deal_seed=seed, hands=hands, keep_times=True)
        # a bugged ("!") bot falling back to its default policy is a legitimate outcome
        # of the bug, so record it instead of failing the job
        for bot, label in ((A, a), (B, b)):
            if "!" in label:
                rec.setdefault("fallback", {})[label] = _uses_fallback(bot)
            else:
                _check_no_fallback(bot, label)
        d_a = r.deltas if seat_a == 0 else -r.deltas
        rec[f"a_deltas_seat{seat_a}"] = d_a.astype(int).tolist()
        rec[f"stats_seat{seat_a}"] = dict(a=r.stats[seat_a].summary(), b=r.stats[1 - seat_a].summary())
        rec[f"hands_played_seat{seat_a}"] = r.hands_played
    rec["wall_s"] = time.time() - t0
    out.parent.mkdir(parents=True, exist_ok=True)
    tmp = out.with_suffix(".tmp")
    tmp.write_text(json.dumps(rec))
    os.replace(tmp, out)
    return str(out)


def run_jobs(jobs: list, workers: int = 3, label: str = "") -> None:
    """Run jobs in a process pool (each worker single-threaded numpy)."""
    os.environ.setdefault("OMP_NUM_THREADS", "1")
    os.environ.setdefault("OPENBLAS_NUM_THREADS", "1")
    todo = [j for j in jobs if not result_path(j["exp"], j["variant"], j["a"], j["b"], j["seed"]).exists()]
    print(f"[{label}] {len(jobs)} jobs, {len(todo)} to run, {workers} workers", flush=True)
    if not todo:
        return
    t0 = time.time()
    done = 0
    if workers <= 1:
        for j in todo:
            run_pair(j)
            done += 1
            print(f"[{label}] {done}/{len(todo)} {j['variant']} {j['a']} vs {j['b']} s{j['seed']} "
                  f"({time.time()-t0:.0f}s)", flush=True)
        return
    import multiprocessing as mp
    ctx = mp.get_context("fork")
    with ctx.Pool(workers, maxtasksperchild=20) as pool:
        for path in pool.imap_unordered(_safe_run, todo):
            done += 1
            print(f"[{label}] {done}/{len(todo)} {path} ({time.time()-t0:.0f}s)", flush=True)


def _safe_run(job):
    try:
        return run_pair(job)
    except Exception as e:  # keep the pool alive; record the failure
        import traceback
        err = RAW / job["exp"] / "_errors.log"
        err.parent.mkdir(parents=True, exist_ok=True)
        with open(err, "a") as f:
            f.write(f"{job}\n{traceback.format_exc()}\n")
        return f"ERROR {job['a']} vs {job['b']} {job['variant']} s{job['seed']}: {e}"


def load_results(exp: str, variant: str | None = None) -> list[dict]:
    base = RAW / exp
    if not base.exists():
        return []
    out = []
    dirs = [base / variant] if variant else [d for d in base.iterdir() if d.is_dir()]
    for d in dirs:
        if not d.exists():
            continue
        for f in sorted(d.glob("*.json")):
            out.append(json.loads(f.read_text()))
    return out


def pair_units(recs: list[dict], a: str, b: str) -> list[float]:
    """Per duplicate pair: A's mean bb/hand over both seats. Handles either orientation."""
    units = []
    for r in recs:
        if r["a"] == a and r["b"] == b:
            sign = 1
        elif r["a"] == b and r["b"] == a:
            sign = -1
        else:
            continue
        tot = sum(r["a_deltas_seat0"]) + sum(r["a_deltas_seat1"])
        n = len(r["a_deltas_seat0"]) + len(r["a_deltas_seat1"])
        units.append(sign * tot / r["bb"] / n)
    return units


def match_wins(recs: list[dict], a: str, b: str) -> tuple[int, int, int]:
    """(wins, losses, ties) for A counting each 1000-hand match separately."""
    w = l = t = 0
    for r in recs:
        if r["a"] == a and r["b"] == b:
            sign = 1
        elif r["a"] == b and r["b"] == a:
            sign = -1
        else:
            continue
        for k in ("a_deltas_seat0", "a_deltas_seat1"):
            s = sign * sum(r[k])
            w += s > 0
            l += s < 0
            t += s == 0
    return w, l, t
