"""Pre-train the CFR policy library with the multi-core trainer (resumable).

For every variant in the list, trains full-game CFR for --minutes with --workers
processes, writing cache/cfr/full_<variant>_<M>m_w<N>.pkl (checkpoints 5 and M).
Variants whose final file exists are skipped. Load with `champion@<M>m_w<N>`.

    python -m experiments.train_library [--minutes 15] [--workers 4]
"""
from __future__ import annotations

import argparse
import os
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ORDER = ["a_nlhe100", "c_discard3", "k_irish", "n_plo4", "b_nlhe200", "m_nlhe150", "l_nlhe50",
         "f_nlhe20", "e_shortdeck", "d_omaha4x2", "g_pineapple", "h_plo5", "i_double_discard", "j_3street"]


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--minutes", type=int, default=15)
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--variants", default=",".join(ORDER))
    a = ap.parse_args(argv)
    (ROOT / "results" / "logs").mkdir(parents=True, exist_ok=True)
    env = dict(os.environ, OMP_NUM_THREADS="1", OPENBLAS_NUM_THREADS="1")
    for v in a.variants.split(","):
        final = ROOT / "cache" / "cfr" / f"full_{v}_{a.minutes}m_w{a.workers}.pkl"
        if final.exists():
            print(f"skip {v} (exists)", flush=True)
            continue
        t0 = time.time()
        cps = ",".join(str(m) for m in sorted({5, a.minutes}) if m <= a.minutes)
        with open(ROOT / "results" / "logs" / f"library_{v}.log", "w") as log:
            rc = subprocess.call([sys.executable, "-m", "bots.cfr_full.train", "--variant", v,
                                  "--minutes", str(a.minutes), "--checkpoints", cps, "--workers", str(a.workers),
                                  "--suffix", f"w{a.workers}", "--out", str(ROOT / "cache" / "cfr") + "/"],
                                 cwd=ROOT, env=env, stdout=log, stderr=subprocess.STDOUT)
        print(f"{v}: rc={rc} {(time.time() - t0) / 60:.1f} min", flush=True)


if __name__ == "__main__":
    main()
