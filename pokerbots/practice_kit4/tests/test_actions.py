import unittest

from tests import helpers  # noqa: F401
from engine.actions import CALL, CHECK, FOLD, RAISE, default_action, interpret


class InterpretTest(unittest.TestCase):
    # owe 20, stack 500, raising allowed with min_add 40
    def i(self, x, owe=20, stack=500, can=True, min_add=40):
        return interpret(x, owe, stack, can, min_add)

    def test_fold_values(self):
        self.assertEqual(self.i(-1), (FOLD, 0))
        self.assertEqual(self.i(0), (FOLD, 0))            # 0 while owing = fold
        self.assertEqual(self.i(19), (FOLD, 0))

    def test_check(self):
        self.assertEqual(self.i(0, owe=0, min_add=20), (CHECK, 0))
        self.assertEqual(self.i(-1, owe=0, min_add=20), (FOLD, 0))
        self.assertEqual(self.i(5, owe=0, min_add=20), (CHECK, 0))   # snapped down

    def test_call_and_snap_down(self):
        self.assertEqual(self.i(20), (CALL, 20))
        self.assertEqual(self.i(39), (CALL, 20))

    def test_raise(self):
        self.assertEqual(self.i(40), (RAISE, 40))
        self.assertEqual(self.i(123), (RAISE, 123))

    def test_all_in_clamp(self):
        self.assertEqual(self.i(10 ** 9), (RAISE, 500))
        self.assertEqual(self.i(500, stack=30, min_add=40), (RAISE, 30))  # short all-in raise
        self.assertEqual(self.i(25, stack=15), (CALL, 15))              # call all-in for less
        self.assertEqual(self.i(10, stack=15), (FOLD, 0))

    def test_cannot_raise(self):
        self.assertEqual(self.i(200, can=False, min_add=None), (CALL, 20))
        self.assertEqual(self.i(10 ** 6, can=False, min_add=None), (CALL, 20))

    def test_invalid_types(self):
        for bad in (None, "call", "raise 60", 20.0, True, False, [20]):
            self.assertIsNone(self.i(bad), bad)

    def test_index_types_accepted(self):
        class NumpyLike:
            def __index__(self):
                return 20
        self.assertEqual(self.i(NumpyLike()), (CALL, 20))

    def test_default_action(self):
        self.assertEqual(default_action(0), (CHECK, 0))
        self.assertEqual(default_action(5), (FOLD, 0))


if __name__ == "__main__":
    unittest.main()
