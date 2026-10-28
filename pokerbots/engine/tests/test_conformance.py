"""Runs the conformance check for every registered bot whose module exists.
Set CONFORMANCE_HANDS to play more hands (default 30 per match)."""
import importlib.util
import os
import unittest

from bots.registry import BOTS, make
from engine.conformance import check_bot


class TestConformance(unittest.TestCase):
    def test_registered_bots(self):
        hands = int(os.environ.get("CONFORMANCE_HANDS", "30"))
        only = os.environ.get("CONFORMANCE_ONLY")
        for name, (mod, kw) in BOTS.items():
            if only and name not in only.split(","):
                continue
            if importlib.util.find_spec(mod) is None:
                continue
            with self.subTest(bot=name):
                probs = check_bot(lambda: make(name), hands=hands, verbose=False)
                self.assertEqual(probs, [], "\n".join(probs))


if __name__ == "__main__":
    unittest.main()
