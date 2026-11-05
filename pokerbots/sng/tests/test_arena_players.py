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

    def test_more_players_than_paid_places(self):
        """--players 9 with an 8-place point table: the 9th place pays 0 instead of failing validation."""
        buf = io.StringIO()
        raw = Path(tempfile.mkdtemp()) / "raw.json"
        with contextlib.redirect_stdout(buf):
            arena.main(["--players", "9", "--candidates", "icm_tag,nit", "--tables", "2", "--workers", "1",
                        "--field", "custom:random=1,station=1", "--no-enforce", "--out", str(raw)])
        for r in json.loads(raw.read_text()):
            self.assertEqual(len(r["lineup"]), 9)
        self.assertIn("paired difference", buf.getvalue())


    def test_explicit_payouts_override_preset(self):
        """--preset sets its own point table; an explicit --payouts wins over it, and --players pads it."""
        from sng.presets import PRESETS
        from sng.rules import PAYOUT_SETS
        args = lambda *x: arena._parser().parse_args(["--candidates", "icm_tag", *x])
        self.assertEqual(tuple(arena.rules_kw_from(args("--preset", "kit4_sixplus"))["payouts"]),
                         tuple(PRESETS["kit4_sixplus"]["payouts"]))
        self.assertEqual(tuple(arena.rules_kw_from(args("--preset", "kit4_sixplus", "--payouts", "top3"))["payouts"]),
                         tuple(PAYOUT_SETS["top3"]))
        self.assertEqual(tuple(arena.rules_kw_from(args())["payouts"]), tuple(PAYOUT_SETS["synthetic"]))
        kw = arena.rules_kw_from(args("--preset", "kit4_sixplus", "--payouts", "winner", "--players", "6"))
        self.assertEqual(tuple(kw["payouts"]), tuple(PAYOUT_SETS["winner"])[:6])

    def test_top3_counts_cap_survivors_by_chip_rank(self):
        """P(top 3): a survivor at the hand cap counts only if at most 2 stacks are bigger."""
        def rec(place, survived, chip_rank):
            return dict(t=len(out_), cand="a", points=10.0, first_error=None, place=place, survived=survived, chip_rank=chip_rank,
                        p99_ms=0.1, max_ms=0.1, over=0, errors=0, illegal=0)
        out_ = []
        for args in ((None, True, 1), (None, True, 5), (2, False, 4), (6, False, 8)):
            out_.append(rec(*args))
        out = out_
        line = next(l for l in arena.summarize(out, ["a"]).splitlines() if l.startswith("| a "))
        self.assertEqual(line.split("|")[4].strip(), "50%")      # chip rank 1 and place 2

    def test_field_table_counts_every_seat(self):
        """An archetype in several seats of one table counts once per seat."""
        out = [dict(field_points=[("a", 10.0), ("a", 30.0), ("b", 5.0)]),
               dict(field_points={"a": 20.0})]                         # old-style raw records still read
        txt = arena.field_table(out)
        self.assertIn("(n=3)", txt.splitlines()[0])                    # a: 10, 30, 20
        self.assertIn("20.00", txt.splitlines()[0])

if __name__ == "__main__":
    unittest.main()
