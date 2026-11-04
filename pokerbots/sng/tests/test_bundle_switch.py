"""sng.bundle --with-switch: icm_switch (icm_tag until attacked, then f7_balanced) in ONE file, f7's
tables embedded, runs from a directory without the repository and switches at an attacking table."""
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from sng.bundle import build

ROOT = Path(__file__).resolve().parents[2]
ADAPTER = '''
from sng.ours.switch import IcmSwitch as _Switch
BOT = _Switch
'''
DRIVER = r'''
import sys
sys.path.insert(0, REPO)                 # only to drive tables with our engine; the bot is the bundle's
import bot                               # the bundle (its modules live under _nlb.*)
from sng.registry import make
from sng.rules import SngRules
from sng.table import play_table
from engine.game import Call, Check, Fold, RaiseTo


class Conv:                              # the kit adapter's job: map the bundle's actions to the table's
    def __init__(self, b): self.b = b
    def new_table(self, *a): self.b.new_table(*a)
    def end_hand(self, info): self.b.end_hand(info)
    def act(self, o):
        a = self.b.act(o)
        return {"fold": Fold, "check": Check, "call": Call}[a.kind]() if a.kind != "raise" else RaiseTo(a.amount)


switched = 0
errors = 0
for t in range(6):
    b = bot.BOT()
    line = [Conv(b)] + [make(n) for n in ("f7_profiler", "f7_balanced", "f6_raiser", "f6_floater", "f7_bully", "f6_checkraiser", "f7_trickster")]
    res = play_table(line, SngRules(enforce_time=False), seed=50 + t)
    errors += res.stats[0].errors + res.stats[0].illegal
    switched += b.switched
    assert type(b).__module__.startswith("_nlb."), type(b).__module__
print("OK", errors, switched)
'''


class TestBundleSwitch(unittest.TestCase):
    def test_bundle_runs_and_switches(self):
        tmp = tempfile.mkdtemp(prefix="bundle_switch_")
        ad = Path(tmp) / "adapter.py"
        ad.write_text(ADAPTER)
        out = build(ad, None, Path(tmp) / "bot.py", with_switch=True)
        self.assertLess(out.stat().st_size, 7_000_000)
        env = dict(os.environ, PYTHONPATH="")
        r = subprocess.run([sys.executable, "-c", f"REPO = {str(ROOT)!r}\n" + DRIVER], cwd=tmp, env=env,
                           capture_output=True, text=True, timeout=600)
        self.assertEqual(r.returncode, 0, r.stderr[-2000:])
        ok, errors, switched = r.stdout.split()[-3:]
        self.assertEqual(errors, "0")
        self.assertGreater(int(switched), 0)          # field 6/7 attackers trigger the switch


if __name__ == "__main__":
    unittest.main()
