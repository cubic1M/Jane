"""Helper: only the round-robin jobs that involve one bot (used to add a late bot)."""
import sys
from engine.variants import VARIANTS
from experiments.common import run_jobs
from experiments.roundrobin import CANDIDATES, DUMMIES, build_jobs

bot = sys.argv[1] if len(sys.argv) > 1 else "adaptive"
workers = int(sys.argv[2]) if len(sys.argv) > 2 else 1
jobs = [j for j in build_jobs(list(VARIANTS), CANDIDATES, DUMMIES, 10, 1000) if bot in (j["a"], j["b"])]
jobs.sort(key=lambda j: (j["seed"], j["variant"]))
run_jobs(jobs, workers=workers, label=f"rr-{bot}")
