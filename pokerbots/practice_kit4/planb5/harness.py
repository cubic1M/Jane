"""Debug / timing harness (prompt 4): run tables with planb5 bot DEBUG on.

python3 planb5/harness.py BOT.py [tables] [seed]
Turns on the bot's DEBUG flag (no env vars), wraps play() with a timer for p99.
"""
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
KIT = os.path.dirname(HERE)
sys.path.insert(0, KIT)
import run_local  # noqa: E402
from engine.seats import BotFile  # noqa: E402

path = sys.argv[1]
tables = sys.argv[2] if len(sys.argv) > 2 else "100"
seed = sys.argv[3] if len(sys.argv) > 3 else "11"
bf = BotFile(path, None)
mod = bf.module
mod.DEBUG = True
times = []
orig = mod.play


def timed(view, memory):
    t0 = time.perf_counter_ns()
    r = orig(view, memory)
    times.append(time.perf_counter_ns() - t0)
    return r


bf.play = timed
run_local.BotFile = lambda p, info=None: bf if p == path else BotFile(p, info)
run_local.run(run_local.parse_args(["--bot", path, "--tables", tables,
                                    "--seed", seed, "--quiet"]))
times.sort()
n = len(times)
print(f"decisions {n}; p50 {times[n // 2] / 1e6:.4f} ms; p99 {times[int(n * 0.99)] / 1e6:.4f} ms;"
      f" max {times[-1] / 1e6:.4f} ms")
print(f"debug problems: {len(mod.DEBUG_PROBLEMS)}")
for p in mod.DEBUG_PROBLEMS[:10]:
    print("  ", p)
