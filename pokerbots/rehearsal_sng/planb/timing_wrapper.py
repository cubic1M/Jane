"""Local-only timing harness: wraps planb/bot.py and prints decision-time percentiles at exit."""
import atexit
import importlib.util
import os
import time

_spec = importlib.util.spec_from_file_location("planb_bot", os.path.join(os.path.dirname(__file__), "bot.py"))
_mod = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_mod)
TIMES = []
SLOW = []


class Bot(_mod.Bot):
    def decide(self, obs):
        t0 = time.perf_counter()
        a = super().decide(obs)
        dt = (time.perf_counter() - t0) * 1000
        TIMES.append(dt)
        if dt > 0.3:
            SLOW.append((round(dt, 3), obs.hand_number, obs.street, len(TIMES)))
        return a


@atexit.register
def _report():
    if not TIMES:
        return
    s = sorted(TIMES)
    n = len(s)
    print(f"[timing] n={n} p50={s[n//2]:.4f} p99={s[int(n*0.99)]:.4f} p99.9={s[int(n*0.999)]:.4f} max={s[-1]:.3f} ms; >0.3ms: {len(SLOW)}")
    print("[timing] slow:", SLOW[:15])
