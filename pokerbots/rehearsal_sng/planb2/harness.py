"""Run kit/run_local.py with a timer (p50/p99) around Bot.decide and an optional debug mode.

    python3 planb2/harness.py [--debug] --bot planb2/bot.py --tables 200 --seed 21 --no-log
"""
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
KIT = os.path.join(HERE, "..", "kit")
sys.path.insert(0, KIT)
import run_local  # noqa: E402

debug = "--debug" in sys.argv
argv = [a for a in sys.argv[1:] if a != "--debug"]
times = []
_orig_load = run_local.load_bot_class
_first = []


def load(path, class_name="Bot"):
    cls = _orig_load(path, class_name)
    if not _first:
        _first.append(cls)
        mod = sys.modules[cls.__module__]
        if debug:
            mod.DEBUG = True
        inner = cls.decide

        def timed(self, obs):
            t0 = time.perf_counter()
            r = inner(self, obs)
            times.append(time.perf_counter() - t0)
            return r
        cls.decide = timed
    return cls


run_local.load_bot_class = load
run_local.main(argv)
if times:
    ts = sorted(times)
    n = len(ts)
    print(f"decide timer: n={n} p50={ts[n // 2] * 1e3:.4f} ms  p99={ts[int(n * 0.99)] * 1e3:.4f} ms"
          f"  max={ts[-1] * 1e3:.4f} ms  debug={'on' if debug else 'off'}")
