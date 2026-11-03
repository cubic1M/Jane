import glob
import os
import tempfile
import unittest
from unittest import mock

from tests import helpers  # noqa: F401
import check_submission
from engine import rules
from engine.seats import BotFile, Controller
from engine.table import Table

KIT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GOOD = 'NAME = "ok"\nimport math\n\ndef play(view, memory):\n    return view["owe"]\n'


class StaticRulesTest(unittest.TestCase):
    def check(self, src, suffix=".py"):
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "bot" + suffix)
            with open(path, "w") as f:
                f.write(src)
            return check_submission.static_problems(path)

    def test_good_file(self):
        self.assertEqual(self.check(GOOD), [])

    def test_rejections(self):
        cases = {
            "import time": GOOD + "import time\n",
            "import os.path": GOOD + "import os.path\n",
            "from sys": GOOD + "from sys import argv\n",
            "relative": GOOD + "from . import x\n",
            "open": GOOD + "f = open\n",
            "eval": GOOD + "eval('1')\n",
            "dunder": GOOD + "x = (1).__class__\n",
            "no NAME": GOOD.replace('NAME = "ok"', 'NAMEX = "ok"'),
            "long NAME": GOOD.replace('"ok"', '"' + "x" * 30 + '"'),
            "no play": GOOD.replace("def play", "def act"),
            "play args": GOOD.replace("(view, memory)", "(view)"),
            "setup args": GOOD + "def setup():\n    pass\n",
            "syntax": GOOD + "def (\n",
            "too big": GOOD + "#" * rules.MAX_FILE_BYTES + "\n",
        }
        for label, src in cases.items():
            self.assertNotEqual(self.check(src), [], label)
        self.assertNotEqual(self.check(GOOD, suffix=".txt"), [])

    def test_allowed_extras(self):
        src = GOOD + "import numpy as np\nfrom collections import deque\n" \
                     "class A:\n    def __init__(self):\n        super().__init__()\n"
        self.assertEqual(self.check(src), [])

    def test_sample_bots_pass(self):
        for path in glob.glob(os.path.join(KIT, "bots", "*.py")):
            self.assertEqual(check_submission.static_problems(path), [], path)


class LoadingTest(unittest.TestCase):
    def write(self, d, src):
        path = os.path.join(d, "b.py")
        with open(path, "w") as f:
            f.write(src)
        return path

    def test_setup_over_budget_sits_out(self):
        with tempfile.TemporaryDirectory() as d:
            path = self.write(d, GOOD + "import time\ndef setup(r):\n    time.sleep(0.02)\n")
            with mock.patch.object(rules, "SETUP_LIMIT_MS", 5.0):
                bot = BotFile(path)
        self.assertIn("setup took", bot.load_error)
        c = Controller(bot)
        self.assertTrue(c.benched)
        self.assertEqual(c.act({"hand": 1, "street": 0}), (None, "benched"))

    def test_setup_receives_rules(self):
        with tempfile.TemporaryDirectory() as d:
            path = self.write(d, GOOD + "SEEN = {}\ndef setup(r):\n    SEEN.update(r)\n")
            bot = BotFile(path)
        self.assertIsNone(bot.load_error)
        self.assertEqual(bot.module.SEEN["variant"], "six-plus")
        self.assertEqual(len(bot.module.SEEN["deck"]), 36)

    def test_memory_is_per_seat_and_table(self):
        with tempfile.TemporaryDirectory() as d:
            bot = BotFile(self.write(d, GOOD))
        a, b = Controller(bot), Controller(bot)
        self.assertIsNot(a.memory, b.memory)

    def test_sample_bots_play_cleanly(self):
        bots = [BotFile(p) for p in sorted(glob.glob(os.path.join(KIT, "bots", "*.py")))]
        for b in bots:
            self.assertIsNone(b.load_error, b.path)
        for seed in range(3):
            ctrls = [Controller(bots[(seed + k) % len(bots)], enforce=False) for k in range(8)]
            Table(ctrls, seed=seed).run()
            for c in ctrls:
                self.assertEqual(c.errors, 0, (c.name, c.problems))


if __name__ == "__main__":
    unittest.main()
