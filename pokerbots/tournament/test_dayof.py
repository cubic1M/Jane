"""Tests for dayof.py (the day-of checklist).
    python3 -m unittest tournament.test_dayof
"""
import contextlib
import io
import unittest

import dayof


class TestDayof(unittest.TestCase):
    def test_checkpoints_never_exceed_the_run(self):
        self.assertEqual(dayof.checkpoints(1), [1])
        self.assertEqual(dayof.checkpoints(10), [5, 10])
        self.assertEqual(dayof.checkpoints(20), [5, 15, 20])

    def test_training_hint_names_loadable_checkpoints(self):
        # the hint's --bots must be runnable as printed (no placeholder) and only name
        # checkpoints the run will write
        for full, want in ((1, "hybrid@1m"), (10, "hybrid@10m"), (20, "hybrid@15m")):
            h = dayof.training_hint("k_irish", 0, full)
            bots = h.split("--bots ")[1].split()[0]
            self.assertEqual(bots, want)
            self.assertNotIn("<", h)
            if full < 15:
                self.assertNotIn("15m", h)
        h = dayof.training_hint("k_irish", 3, 20)
        self.assertEqual(h.split("--bots ")[1].split()[0], "preflop_cfr@3m,hybrid@15m")

    def test_quick_run_with_bot_options_and_spaces(self):
        out = io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(io.StringIO()):
            rc = dayof.main(["--variant", "f", "--quick", "--hands", "6",
                             "--bots", "equity, full_cfr@no_such_budget:threshold=0.1+lp"])
        txt = out.getvalue()
        self.assertEqual(rc, 0, txt)
        self.assertIn("NO POLICY", txt)
        self.assertIn("GO", txt)


if __name__ == "__main__":
    unittest.main()
