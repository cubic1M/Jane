import sys, time
sys.path.insert(0, '.')
from sng.registry import make
from sng.rules import SngRules
from sng.table import play_table
ts = []
class Conv:   # kit-4 style: end-of-hand info fed inside the next decision, timed with it
    def __init__(s, n): s.b = make(n); s.pending = None
    def new_table(s, *a): s.b.new_table(*a)
    def end_hand(s, info): s.pending = info
    def act(s, o):
        t = time.perf_counter()
        if s.pending is not None:
            s.b.end_hand(s.pending); s.pending = None
        a = s.b.act(o)
        ts.append((time.perf_counter() - t) * 1000)
        return a
name = sys.argv[1]
for t in range(30):
    field = ("f7_profiler", "f7_balanced", "f9_threebet", "f9_meta", "f8_ensemble", "f10_aggro", "f10_tag_simple") if t % 2 == 0 else ("f2_shark", "station", "nit", "f5_reg", "chen_tag", "f10_chen", "f3_exploiter")
    play_table([Conv(name)] + [make(n) for n in field], SngRules(enforce_time=False), seed=700 + t)
ts.sort(); n = len(ts)
print(f"{name}: n={n} p50 {ts[n//2]:.3f} p99 {ts[int(n*.99)]:.3f} p99.9 {ts[int(n*.999)]:.3f} max {ts[-1]:.2f} >1ms {sum(x > 1 for x in ts)} ({100*sum(x > 1 for x in ts)/n:.2f}%)")
