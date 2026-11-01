"""icm_any: legal and fast on discard/draw variants, sensible discards, bundles without numpy.
    python3 -m unittest sng.ours.tests.test_anyvar
"""
import os
import subprocess
import sys
import tempfile
import textwrap
import unittest
from pathlib import Path

import numpy as np

from engine.cards import parse_cards
from sng.ours import features as F
from sng.ours.anyvar import choose_discard, table_path
from sng.registry import make
from sng.rules import SngRules
from sng.table import play_table
from sng.tests.test_discards import DEAD_DOWN, DRAW_HOLDEM, FIVE_DRAW, TO_BOARD

ROOT = Path(__file__).resolve().parents[3]
FIELD = ["chen_tag", "pushfold_icm", "lag", "station", "nit", "adaptive", "random"]


class TestIcmAny(unittest.TestCase):
    def test_legal_and_fast_on_discard_variants(self):
        for spec in (TO_BOARD, DEAD_DOWN, DRAW_HOLDEM, FIVE_DRAW):
            r = SngRules(spec=spec, enforce_time=False)
            ts = []
            for t in range(6):
                bots = [make(x) for x in FIELD]
                bots.insert(t % 8, make("icm_any"))
                res = play_table(bots, r, seed=900 + t)
                st = res.stats[t % 8]
                self.assertEqual((st.errors, st.illegal), (0, 0), f"{spec.name}: {st.first_error}")
                ts += st.times
            if not os.environ.get("SNG_SKIP_TIMING"):
                p99 = float(np.percentile(np.array(ts) * 1000, 99))
                self.assertLess(p99, 0.5, f"{spec.name}: p99 {p99:.3f} ms")

    def _ctx(self, spec):
        return F.get_ctx(spec)

    def test_discard_keeps_the_pair_to_board(self):
        ctx = self._ctx(TO_BOARD)
        out = choose_discard(ctx, parse_cards("AhAd7c"), parse_cards("Ks9d2c"), 1, 1, False, True)
        self.assertEqual(out, tuple(parse_cards("7c")))

    def test_five_draw_keeps_the_pair_and_draws_three(self):
        ctx = self._ctx(FIVE_DRAW)
        hole = parse_cards("KhKd7c4s2h")
        out = choose_discard(ctx, hole, (), 0, 3, True, False)
        self.assertEqual(sorted(out), sorted(parse_cards("7c4s2h")))

    def test_five_draw_draws_one_to_a_flush(self):
        ctx = self._ctx(FIVE_DRAW)
        out = choose_discard(ctx, parse_cards("AhJh8h3h9c"), (), 0, 3, True, False)
        self.assertEqual(out, tuple(parse_cards("9c")))

    def test_five_draw_stands_pat_with_a_made_straight(self):
        ctx = self._ctx(FIVE_DRAW)
        self.assertEqual(choose_discard(ctx, parse_cards("9c8d7h6s5c"), (), 0, 3, True, False), ())

    def test_draw_holdem_keeps_two_pair(self):
        ctx = self._ctx(DRAW_HOLDEM)
        self.assertEqual(choose_discard(ctx, parse_cards("AsKd"), parse_cards("AhKc2d"), 0, 1, True, False), ())

    @unittest.skipUnless(table_path(FIVE_DRAW).exists(), "no any-variant table for five-card draw")
    def test_bundle_embeds_the_any_table_and_runs_without_numpy(self):
        from sng.bundle import build
        adapter = textwrap.dedent('''
            from sng.tests_stub import SPEC
        ''')
        tmp = tempfile.mkdtemp(prefix="anybundle_")
        (Path(tmp) / "adapter.py").write_text(textwrap.dedent('''
            from engine.spec import DiscardRule as _DR, GameSpec as _GS
            SPEC = _GS(name="t_five_draw", hole_cards=5, board_cards_per_street=(0, 0), starting_stack=2000,
                       small_blind=10, big_blind=20, stack_reset_per_hand=False,
                       discards=(_DR(street=1, count=3, to_board=False, face_up=False, draw=True, min_count=0),))
            ANY_OK = load_bundled_any(SPEC)
            from sng.ours import anyvar as _A
            from sng.ours import features as _F
            OK2 = _A._STRENGTH[_F.card_signature(SPEC)].ok
        '''))
        build(Path(tmp) / "adapter.py", None, Path(tmp) / "bot.py", table_path(FIVE_DRAW))
        env = dict(os.environ, PYTHONPATH=tmp)
        r = subprocess.run([sys.executable, "-c", "import sys; sys.modules['numpy'] = None; import bot;"
                            "print(bot.ANY_OK, bot.OK2)"], cwd=tmp, env=env, capture_output=True, text=True,
                           timeout=60)
        self.assertEqual(r.returncode, 0, r.stderr[-1500:])
        self.assertEqual(r.stdout.split(), ["True", "True"])


if __name__ == "__main__":
    unittest.main()
