"""One side of a paired A/B run: per-table points for our bot, with parameter overrides.

    python3 planb2/ab.py OUT.json [NAME=VALUE ...] -- <run_local args>
Opponents should be seeded (planb2/random_seeded.py instead of random) and the
time limit raised, so that both sides see identical tables.
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "kit"))
import engine  # noqa: E402
import run_local  # noqa: E402

out = sys.argv[1]
i = sys.argv.index("--")
overrides = dict(a.split("=", 1) for a in sys.argv[2:i])
argv = sys.argv[i + 1:]
points = []
_orig_load = run_local.load_bot_class
_done = []


def load(path, class_name="Bot"):
    cls = _orig_load(path, class_name)
    if not _done:
        _done.append(1)
        mod = sys.modules[cls.__module__]
        for k, v in overrides.items():
            setattr(mod, k, type(getattr(mod, k))(float(v)))
    return cls


_orig_run = engine.Table.run


def run(self):
    res = _orig_run(self)
    for sr in res.seats:
        if self.names[sr.seat] == "you":
            points.append(sr.points)
    return res


run_local.load_bot_class = load
engine.Table.run = run
run_local.main(argv)
json.dump({"overrides": overrides, "points": points}, open(out, "w"))
