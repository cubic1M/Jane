"""Timing probe (rehearsal only): logs every decision over 1 ms with its context."""
import importlib.util, os, sys, time
_spec = importlib.util.spec_from_file_location("realbot", os.path.join(os.path.dirname(__file__), "bot.py"))
_m = importlib.util.module_from_spec(_spec); _spec.loader.exec_module(_m)
N = [0]


class Bot(_m.Bot):
    def decide(self, o):
        t = time.perf_counter()
        a = super().decide(o)
        dt = (time.perf_counter() - t) * 1000
        N[0] += 1
        if dt > 1.0:
            print(f"[slow] {dt:.2f} ms decision#{N[0]} hand {o.hand_number} street {o.street} board {len(o.board)} "
                  f"to_call {o.to_call} legal {sorted(o.legal_actions)} -> {a}", file=sys.stderr)
        return a
