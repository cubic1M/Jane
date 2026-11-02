import unittest

from sng.registry import field_weights


class TestCustomField(unittest.TestCase):
    def test_parse(self):
        self.assertEqual(field_weights("custom:push=3,maniac,f2_shark=0.5"),
                         [("push", 3.0), ("maniac", 1.0), ("f2_shark", 0.5)])

    def test_unknown_bot(self):
        with self.assertRaises(KeyError):
            field_weights("custom:nosuchbot=1")


if __name__ == "__main__":
    unittest.main()
