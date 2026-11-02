import os
import subprocess
import sys
import tempfile
import unittest

import helpers

KIT = helpers.KIT
sys.path.insert(0, KIT)
import check_submission  # noqa: E402


def write(tmp, name, text):
    p = os.path.join(tmp, name)
    with open(p, "w") as f:
        f.write(text)
    return p


GOOD = '''
import random, math
from collections import Counter
class Agent:
    def on_discard_request(self, s):
        return s["hole_cards"][0]
    def on_action_request(self, s):
        return "c"
'''


class CheckerTests(unittest.TestCase):
    def test_kit_bots_pass(self):
        for b in ("template_bot", "calling_station", "tight_aggressive", "random_raiser"):
            fails, _ = check_submission.static_check(os.path.join(KIT, "bots", b + ".py"))
            self.assertEqual(fails, [], b)

    def test_rules(self):
        with tempfile.TemporaryDirectory() as tmp:
            self.assertEqual(check_submission.static_check(write(tmp, "a.py", GOOD))[0], [])
            cases = {
                "numpy": GOOD + "\nimport numpy\n",
                "os": GOOD + "\nfrom os import path\n",
                "relative": GOOD + "\nfrom . import x\n",
                "eval": GOOD + "\nx = eval('1')\n",
                "open": GOOD + "\nopen('f')\n",
                "dunder": GOOD + "\n__import__('os')\n",
                "noagent": GOOD.replace("class Agent", "class MyAgent"),
                "nodiscard": GOOD.replace("on_discard_request", "discard"),
                "initargs": GOOD.replace("class Agent:", "class Agent:\n    def __init__(self, seat):\n        pass"),
                "size": GOOD + "#" * 32001 + "\n",
                "syntax": GOOD + "\ndef broken(:\n",
            }
            for name, text in cases.items():
                fails, _ = check_submission.static_check(write(tmp, name + ".py", text))
                self.assertTrue(fails, name)

    def test_size_limit_is_bytes_not_characters(self):
        with tempfile.TemporaryDirectory() as tmp:
            # 11,000 three-byte characters = 33,000 bytes > 32,000
            p = write(tmp, "u.py", GOOD + "# " + "€" * 11000 + "\n")
            fails, _ = check_submission.static_check(p)
            self.assertTrue(any("bytes" in f for f in fails))

    def test_cli_smoke(self):
        out = subprocess.run([sys.executable, os.path.join(KIT, "check_submission.py"),
                              os.path.join(KIT, "bots", "template_bot.py")],
                             capture_output=True, text=True, timeout=120)
        self.assertEqual(out.returncode, 0, out.stdout + out.stderr)
        self.assertIn("RESULT: PASS", out.stdout)


class RunnerTests(unittest.TestCase):
    def test_runner_prints_summary(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = subprocess.run([sys.executable, os.path.join(KIT, "run_local.py"), "--bot",
                                  os.path.join(KIT, "bots", "template_bot.py"), "--tables", "3",
                                  "--seed", "7", "--log-dir", tmp],
                                 capture_output=True, text=True, timeout=300, cwd=KIT)
            self.assertEqual(out.returncode, 0, out.stderr)
            for needle in ("average points per table", "errors", "timeouts", "slowest decision"):
                self.assertIn(needle, out.stdout)
            with open(os.path.join(tmp, "table_001.log")) as f:
                log = f.read()
            self.assertIn("hand 1", log)
            self.assertIn("discards", log)

    def test_bot_state_resets_between_tables(self):
        with tempfile.TemporaryDirectory() as tmp:
            bot = write(tmp, "counter.py", '''
TABLES = []
class Agent:
    def __init__(self):
        TABLES.append(1)
        assert len(TABLES) == 1, "module globals survived a table"
    def on_discard_request(self, s):
        return s["hole_cards"][0]
    def on_action_request(self, s):
        return "c"
''')
            from engine.loader import load_factory
            f = load_factory(bot)
            f()
            f()   # fresh module each time: no AssertionError


if __name__ == "__main__":
    unittest.main()
