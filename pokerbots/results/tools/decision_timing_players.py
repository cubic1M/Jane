"""Decision time of one of our bots at N players, both timing models.
arena: end_hand untimed. kit4: end-of-hand work counted inside the next decision.
usage: python3 results/tools/decision_timing_players.py BOT PLAYERS [TABLES]"""
import sys, time
sys.path.insert(0, '.')
from sng.registry import make
from sng.rules import SngRules, SYNTHETIC_PAYOUTS
from sng.table import play_table
dec, inl = [], []
class Conv:
    def __init__(s, n): s.b = make(n); s.pending = None
    def new_table(s, *a): s.b.new_table(*a)
    def end_hand(s, info): s.pending = info
    def act(s, o):
        t0 = time.perf_counter()
        if s.pending is not None:
            s.b.end_hand(s.pending); s.pending = None
        t1 = time.perf_counter()
        a = s.b.act(o)
        t2 = time.perf_counter()
        dec.append((t2 - t1) * 1000); inl.append((t2 - t0) * 1000)
        return a
name, n = sys.argv[1], int(sys.argv[2]); tables = int(sys.argv[3]) if len(sys.argv) > 3 else 20
A = ("f7_profiler", "f7_balanced", "f9_threebet", "f9_meta", "f8_ensemble", "f10_aggro", "f10_tag_simple", "f9_float", "f5_nash")
B = ("f2_shark", "station", "nit", "f5_reg", "chen_tag", "f10_chen", "f3_exploiter", "f10_passive", "maniac")
pay = (tuple(SYNTHETIC_PAYOUTS) + (0,) * n)[:n]
for t in range(tables):
    field = (A if t % 2 == 0 else B)[:n - 1]
    play_table([Conv(name)] + [make(x) for x in field], SngRules(enforce_time=False, num_players=n, payouts=pay), seed=900 + t)
def st(ts):
    ts = sorted(ts); k = len(ts)
    return f"p50 {ts[k//2]:.3f} p99 {ts[int(k*.99)]:.3f} max {ts[-1]:.2f} >1ms {100*sum(x > 1 for x in ts)/k:.2f}%"
print(f"{name} players={n} n={len(dec)}\n  arena (end_hand untimed): {st(dec)}\n  kit4  (end_hand inside):  {st(inl)}")
