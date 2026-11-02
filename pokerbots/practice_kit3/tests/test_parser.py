import unittest

import helpers  # noqa: F401
from engine.actions import ActionError, half_bbs_to_chips, parse_action


class ParserTests(unittest.TestCase):
    def test_fold_and_call(self):
        self.assertEqual(parse_action("f"), ("f", None))
        self.assertEqual(parse_action("c"), ("c", None))
        self.assertEqual(parse_action("  C \n"), ("c", None))
        self.assertEqual(parse_action("F"), ("f", None))

    def test_raise_units_are_half_big_blinds(self):
        self.assertEqual(parse_action("r 3"), ("r", 6))
        self.assertEqual(parse_action("r 2.5"), ("r", 5))
        self.assertEqual(parse_action("R\t2.5"), ("r", 5))
        self.assertEqual(parse_action("r   .5"), ("r", 1))
        self.assertEqual(parse_action("r 2."), ("r", 4))
        self.assertEqual(parse_action("r 120"), ("r", 240))

    def test_rounding_half_up_to_half_bb(self):
        self.assertEqual(parse_action("r 2.25"), ("r", 5))   # -> 2.5
        self.assertEqual(parse_action("r 2.24"), ("r", 4))   # -> 2.0
        self.assertEqual(parse_action("r 2.74"), ("r", 5))   # -> 2.5
        self.assertEqual(parse_action("r 2.75"), ("r", 6))   # -> 3.0
        self.assertEqual(parse_action("r 0.2"), ("r", 0))
        self.assertEqual(parse_action("r 0.25"), ("r", 1))

    def test_invalid_strings(self):
        for bad in ["k", "x", "check", "call", "fold", "r", "r -1", "r 2,5", "r 1e3",
                    "r nan", "r inf", "r 2.5bb", "raise 3", "r3", "b 3", "", "c 0",
                    "r 2 .5", "rr 2", "r +2"]:
            with self.assertRaises(ActionError, msg=bad):
                parse_action(bad)

    def test_non_strings_rejected(self):
        for bad in [None, 3, 2.5, ("r", 3), b"c"]:
            with self.assertRaises(ActionError):
                parse_action(bad)

    def test_half_bbs_to_chips(self):
        self.assertEqual(half_bbs_to_chips(5, 20), 50)
        self.assertEqual(half_bbs_to_chips(5, 30), 75)
        self.assertEqual(half_bbs_to_chips(1, 500), 250)


if __name__ == "__main__":
    unittest.main()
