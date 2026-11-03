import os
import unittest
from unittest import mock

from sng.timescale import factor


class TestTimescale(unittest.TestCase):
    def test_default_and_clamps(self):
        with mock.patch.dict(os.environ, {}, clear=False):
            os.environ.pop("SNG_TIME_SCALE", None)
            self.assertEqual(factor(), 1.0)
        for v, want in (("1.5", 1.5), ("0.2", 1.0), ("9", 3.0), ("junk", 1.0)):
            with mock.patch.dict(os.environ, {"SNG_TIME_SCALE": v}):
                self.assertEqual(factor(), want, v)


if __name__ == "__main__":
    unittest.main()
