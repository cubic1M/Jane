"""bundle_flat --compact: table encoding, local renaming, repeat builds."""
import ast
import json
import random
import tempfile
import unittest
from pathlib import Path

from sng import bundle_flat as bf

TRICKY = '''
import math
K = 3
total = 10

def comp_shadows_global(xs):
    out = [K * k for k in xs]          # K is a global read; k a comprehension name
    return out, K

def closure(values):
    acc = 0
    def add(v):
        nonlocal acc
        acc += v
        return acc
    for v in values:
        add(v)
    return acc

def excepts(x):
    try:
        res = 1 / x
    except ZeroDivisionError as err:
        res = str(type(err).__name__)
    return res

def uses_global():
    global total
    total = total + 1
    return total

def kw_target(alpha, beta=2):
    gamma = alpha * beta
    return gamma

def kw_caller():
    longname = kw_target(beta=5, alpha=3)
    return longname, math.floor(2.5)

def with_lambda(xs):
    scale = 2
    return sorted(xs, key=lambda item: -item * scale)

class Box:
    def method(self, n):
        running = 0
        for idx in range(n):
            running += idx
        self.running = running
        return running

def calls():
    b = Box()
    return (comp_shadows_global([1, 2]), closure([1, 2, 3]), excepts(0), excepts(4),
            uses_global(), kw_caller(), with_lambda([3, 1, 2]), b.method(5), b.running)
'''


def run(code):
    ns = {}
    exec(compile(code, "<t>", "exec"), ns)  # noqa: S102  test only
    return ns["calls"]()


class TestCompact(unittest.TestCase):
    def test_table_encoding_round_trips(self):
        rng = random.Random(1)
        g = {f"{i},{j},s": [rng.choice([None, round(rng.random(), 3), 0.0, 1.0]) for _ in range(7)]
             for i in range(13) for j in range(3)}
        s = bf._encode(g)
        ns = {"_ANY_TABLE": {}}
        loader = bf.LOADER.split("\ndef load_bundled_any")[0]
        exec(loader, ns)  # noqa: S102  test only
        back = ns["_expand"](s)
        want = {f"{k}|{i + 1}": v for k, vs in g.items() for i, v in enumerate(vs) if v is not None}
        self.assertEqual(set(back), set(want))
        for k in want:
            self.assertAlmostEqual(back[k], want[k], places=9)
        self.assertLess(len(s), len(json.dumps(g, separators=(",", ":"))) * 0.7)

    def test_rename_locals_keeps_behaviour(self):
        tree = ast.parse(TRICKY)
        before = run(TRICKY)
        bf._rename_locals(tree.body)
        code = ast.unparse(tree)
        self.assertEqual(run(code), before)
        self.assertLess(len(code), len(ast.unparse(ast.parse(TRICKY))))
        # arguments, globals, attributes and keyword names survive
        for name in ("alpha", "beta", "total", "self.running", "K *", "nonlocal acc"):
            self.assertIn(name, code)

    def test_reindent_is_checked(self):
        code = "def f(x):\n    if x:\n        return 's    t'\n    return 2\n"
        out = bf._reindent(code)
        self.assertEqual(ast.dump(ast.parse(out)), ast.dump(ast.parse(code)))
        self.assertLess(len(out), len(code))

    def test_build_twice_in_one_process(self):
        """build() used to pop the file-system OVERRIDES, so a second build failed."""
        import importlib.util
        root = Path(__file__).resolve().parents[2]
        kit = root / "practice_kit2"
        spec = importlib.util.spec_from_file_location("_a_tbt", kit / "adapter_kit2.py")
        m = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(m)
        from sng.ours.anyvar import table_path
        with tempfile.TemporaryDirectory() as d:
            a = bf.build(kit / "adapter_kit2.py", Path(d) / "a.py", table_path(m._SPEC))
            b = bf.build(kit / "adapter_kit2.py", Path(d) / "b.py", table_path(m._SPEC), compact=True)
            c = bf.build(kit / "adapter_kit2.py", Path(d) / "c.py", table_path(m._SPEC))
            self.assertEqual(a.read_text(), c.read_text())
            self.assertLess(b.stat().st_size, 0.8 * a.stat().st_size)


if __name__ == "__main__":
    unittest.main()
