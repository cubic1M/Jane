import contextlib
import io
import json
import tempfile
import unittest
from pathlib import Path

from sng import arena


class TestArenaPlayers(unittest.TestCase):
    def test_short_handed_tables(self):
        """--players N plays N-handed tables with the point table cut to N places."""
        buf = io.StringIO()
        raw = Path(tempfile.mkdtemp()) / "raw.json"
        with contextlib.redirect_stdout(buf):
            arena.main(["--players", "3", "--candidates", "icm_tag,nit", "--tables", "4", "--workers", "1",
                        "--field", "custom:random=1,station=1", "--no-enforce", "--out", str(raw)])
        out = buf.getvalue()
        for r in json.loads(raw.read_text()):
            self.assertEqual(len(r["lineup"]), 3)
        self.assertIn("paired difference", out)
        self.assertIn("8 tables", out)       # 2 candidates x 4 tables


if __name__ == "__main__":
    unittest.main()
