"""check_bot.py, run_local.py and the shipped bots."""

import contextlib
import io
import unittest

from helpers import KIT, agent, table
from simkit.agent import BotAgent

import check_bot
import run_local


class TestCheckBot(unittest.TestCase):
    def test_shipped_bots_pass(self):
        for p in sorted((KIT / "bots").glob("*.py")):
            self.assertEqual(check_bot.check_file(p), [], p.name)

    def test_rejections(self):
        bad = {
            "import os\ndef get_action(s): pass\n": "os",
            "import sys\ndef get_action(s): pass\n": "sys",
            "from simkit import cards\ndef get_action(s): pass\n": "simkit",
            "from . import helper\ndef get_action(s): pass\n": "relative",
            "def get_action(s): return eval('1')\n": "eval",
            "def get_action(s): open('x')\n": "open",
            "import random\n": "get_action",
            "async def get_action(s): pass\n": "async",
            "def get_action(s:\n": "syntax",
        }
        for src, word in bad.items():
            problems = check_bot.check_source(src)
            self.assertTrue(problems, src)
            self.assertIn(word, " ".join(problems), src)

    def test_allowed(self):
        src = ("from __future__ import annotations\nimport math, random\n"
               "import numpy as np\nfrom collections import Counter\n"
               "def get_action(state): return {'action': 'fold'}\n")
        self.assertEqual(check_bot.check_source(src), [])


class TestRunner(unittest.TestCase):
    def test_template_runs(self):
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            code = run_local.main(["--bot", str(KIT / "bots/template_bot.py"),
                                   "--tables", "2", "--max-hands", "30",
                                   "--no-timeouts"])
        self.assertEqual(code, 0)
        text = out.getvalue()
        self.assertIn("template_bot", text)
        self.assertIn("slowest ms", text)

    def test_sample_bots_make_no_errors(self):
        names = ["template_bot", "sample_tight", "sample_caller",
                 "sample_shover"]
        agents = [BotAgent.from_file(n, KIT / "bots" / f"{n}.py",
                                     enforce_time=False) for n in names * 2]
        t = table(agents, seed=3)
        t.play()
        for a in agents:
            self.assertEqual(a.stats.errors, 0, (a.name, a.stats.messages))
            self.assertEqual(a.stats.init_failures, 0)


if __name__ == "__main__":
    unittest.main()
