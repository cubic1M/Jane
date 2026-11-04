import sys, time
sys.path.insert(0, sys.argv[1])
PRESET = sys.argv[3] if len(sys.argv) > 3 else None
import bot
from sng.registry import make
from sng.rules import SngRules
from sng.table import play_table
from engine.game import Call, Check, Fold, RaiseTo
ts_pre, ts_post = [], []
class Conv:   # kit-4 style: the end-of-hand info is fed inside the next decision, and timed with it
    def __init__(s, b): s.b = b; s.pending = None
    def new_table(s, *a): s.b.new_table(*a)
    def end_hand(s, info): s.pending = info
    def act(s, o):
        t = time.perf_counter()
        if s.pending is not None:
            s.b.end_hand(s.pending); s.pending = None
        a = s.b.act(o)
        (ts_post if s.b.switched else ts_pre).append((time.perf_counter() - t) * 1000)
        return {"fold": Fold, "check": Check, "call": Call}[a.kind]() if a.kind != "raise" else RaiseTo(a.amount)
sw = 0
for t in range(int(sys.argv[2])):
    b = bot.BOT()
    field = ("f7_profiler", "f7_balanced", "f6_raiser", "f9_threebet", "f7_bully", "f9_meta", "f8_ensemble") if t % 2 == 0 else ("f2_shark", "station", "nit", "f5_reg", "chen_tag", "lag", "f3_exploiter")
    if PRESET:
        from sng.presets import PRESETS
        rules = SngRules(enforce_time=False, **{k: v for k, v in PRESETS[PRESET].items()})
    else:
        rules = SngRules(enforce_time=False)
    play_table([Conv(b)] + [make(n) for n in field], rules, seed=900 + t)
    sw += b.switched
q = lambda x, p: sorted(x)[min(len(x) - 1, int(len(x) * p))] if x else float("nan")
for name, x in (("before hand-over", ts_pre), ("after hand-over", ts_post)):
    print(f"{name:17s} n={len(x):6d} p50 {q(x,.5):.3f} p99 {q(x,.99):.3f} p99.9 {q(x,.999):.3f} max {max(x) if x else 0:.2f} >1ms {sum(v > 1 for v in x)}")
print("tables switched", sw)
