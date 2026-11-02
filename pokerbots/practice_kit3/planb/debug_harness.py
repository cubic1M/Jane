"""Harness bot for run_local.py: loads planb/bot.py fresh per table, optionally with
DEBUG on (HARNESS_DEBUG below), and records per-decision time (notification time
charged to the next decision, as the engine does). Prints p50/p99/max at exit."""
import atexit, os, sys, time, types

HARNESS_DEBUG = True
BOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "bot.py")
_ns = time.perf_counter_ns

store = sys.modules.get("_planb_store")
if store is None:
    store = types.ModuleType("_planb_store")
    store.times = []
    store.raises = 0
    sys.modules["_planb_store"] = store

    def _report():
        t = sorted(store.times)
        if t:
            q = lambda p: t[min(len(t) - 1, int(p * len(t)))] / 1e6
            print("HARNESS: %d decisions  p50 %.4f ms  p99 %.4f ms  p99.9 %.4f ms  max %.4f ms  debug=%s raises checked %d"
                  % (len(t), q(0.5), q(0.99), q(0.999), t[-1] / 1e6, HARNESS_DEBUG, store.raises))
    atexit.register(_report)

with open(BOT) as f:
    _code = f.read()
_mod = types.ModuleType("planb_bot_inner")
exec(_code, _mod.__dict__)
_mod.DEBUG = HARNESS_DEBUG


class Agent:
    def __init__(self):
        self.a = _mod.Agent()
        self.pending = 0

    def _n(self, name, x):
        fn = getattr(self.a, name, None)
        if fn:
            t0 = _ns(); fn(x); self.pending += _ns() - t0

    def on_table_start(self, x): self._n("on_table_start", x)
    def on_hand_start(self, x): self._n("on_hand_start", x)
    def on_event(self, x): self._n("on_event", x)
    def on_showdown(self, x): self._n("on_showdown", x)
    def on_hand_end(self, x):
        self._n("on_hand_end", x)
        store.raises += len(self.a.dbg); self.a.dbg.clear()

    def _d(self, name, x):
        t0 = _ns(); r = getattr(self.a, name)(x)
        store.times.append(_ns() - t0 + self.pending); self.pending = 0
        return r

    def on_action_request(self, x): return self._d("on_action_request", x)
    def on_discard_request(self, x): return self._d("on_discard_request", x)
