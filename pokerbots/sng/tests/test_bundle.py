"""The one-file bundle never collides with the kit's own modules (e.g. a kit `engine.py`),
in either import order, and its bot plays with the embedded table.
    python3 -m unittest sng.tests.test_bundle
"""
import os
import subprocess
import sys
import tempfile
import textwrap
import unittest
from pathlib import Path

from sng.bundle import build

ROOT = Path(__file__).resolve().parents[2]

ADAPTER = textwrap.dedent('''
    from engine.spec import GameSpec as _GS
    from sng.ours.icm_tag import IcmTag as _IcmTag
    SPEC = _GS(name="bundle_test", starting_stack=2000, small_blind=10, big_blind=20,
               stack_reset_per_hand=False)
    TABLE_OK = load_bundled_table(SPEC)

    class Rules:
        spec = SPEC
        num_players = 8

    class Bot:
        def __init__(self):
            self.bot = _IcmTag()
            self.bot.new_table(Rules, 0, 1)

        def equity(self):
            from sng.ours import strength as S
            from engine.cards import parse_cards
            return S.equity(tuple(parse_cards("AhAd")), (), 1, SPEC)
''')

KIT_ENGINE = "class Table:\n    pass\nKIT = True\n"


class TestBundle(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.mkdtemp(prefix="bundle_test_")
        (Path(cls.tmp) / "adapter.py").write_text(ADAPTER)
        (Path(cls.tmp) / "engine.py").write_text(KIT_ENGINE)     # the kit's own module name
        build(Path(cls.tmp) / "adapter.py", ROOT / "cache" / "sng" / "strength_a_nlhe100.npz",
              Path(cls.tmp) / "bot.py")

    def _run(self, code):
        env = dict(os.environ, PYTHONPATH=self.tmp)               # NOT our repo: only stdlib + numpy
        r = subprocess.run([sys.executable, "-c", code], cwd=self.tmp, env=env,
                           capture_output=True, text=True, timeout=60)
        self.assertEqual(r.returncode, 0, r.stderr[-2000:])
        return r.stdout

    def test_bundle_first_then_kit_engine(self):
        out = self._run("import bot; import engine; assert engine.KIT and engine.Table;"
                        "b = bot.Bot(); print(bot.TABLE_OK, round(b.equity(), 2))")
        self.assertEqual(out.split(), ["True", "0.85"])

    def test_kit_engine_first_then_bundle(self):
        out = self._run("import engine; import bot; assert engine.KIT;"
                        "b = bot.Bot(); print(bot.TABLE_OK, round(b.equity(), 2))")
        self.assertEqual(out.split(), ["True", "0.85"])

    def test_runs_without_numpy_on_older_pythons(self):
        """The sandbox may lack numpy or run another Python: the bundle needs stdlib only."""
        import shutil
        for py in ("python3.11", "python3.12"):
            exe = shutil.which(py)
            if not exe:
                continue
            env = dict(os.environ, PYTHONPATH=self.tmp)
            code = ("import sys; sys.modules['numpy'] = None; import bot; b = bot.Bot();"
                    "print(bot.TABLE_OK, round(b.equity(), 2))")
            r = subprocess.run([exe, "-c", code], cwd=self.tmp, env=env, capture_output=True, text=True,
                               timeout=60)
            self.assertEqual(r.returncode, 0, f"{py}: {r.stderr[-1500:]}")
            self.assertEqual(r.stdout.split(), ["True", "0.85"], py)

    def test_discard_phase_works_in_the_bundle(self):
        """Regression: the bundled engine.game stand-in had no Discard, so every discard /
        draw decision of the bundled bot raised ImportError (an automatic fold / discard)."""
        tmp = tempfile.mkdtemp(prefix="bundle_discard_")
        (Path(tmp) / "adapter.py").write_text(textwrap.dedent('''
            from engine.spec import DiscardRule as _DR, GameSpec as _GS
            from sng.ours.anyvar import IcmAny as _Any
            from sng.ours.icm_tag import IcmTag as _Tag
            SPEC = _GS(name="t_five_draw", hole_cards=5, board_cards_per_street=(0, 0), starting_stack=2000,
                       small_blind=10, big_blind=20, stack_reset_per_hand=False,
                       discards=(_DR(street=1, count=3, to_board=False, face_up=False, draw=True, min_count=0),))

            class Rules:
                spec = SPEC
                num_players = 8

            class Legal:
                discard_count, discard_min = 3, 0

            class Obs:
                legal, street, hole, board, hand_number = Legal, 1, (0, 5, 10, 20, 51), (), 0

            def run():
                out = []
                for cls in (_Tag, _Any):
                    b = cls()
                    b.new_table(Rules, 0, 1)
                    a = b.act(Obs)
                    out.append(f"{a.kind}:{len(a.cards)}")
                return " ".join(out)
        '''))
        build(Path(tmp) / "adapter.py", None, Path(tmp) / "bot.py")
        env = dict(os.environ, PYTHONPATH=tmp)
        r = subprocess.run([sys.executable, "-c", "import sys; sys.modules['numpy'] = None; import bot;"
                            "print(bot.run())"], cwd=tmp, env=env, capture_output=True, text=True, timeout=60)
        self.assertEqual(r.returncode, 0, r.stderr[-2000:])
        kinds = [x.split(":")[0] for x in r.stdout.split()]
        self.assertEqual(kinds, ["discard", "discard"])

    def test_no_public_module_names_taken(self):
        out = self._run("import sys; before = set(sys.modules); import bot;"
                        "new = set(sys.modules) - before;"
                        "print(sorted(m for m in new if m.split('.')[0] in ('engine', 'sng')))")
        self.assertEqual(out.strip(), "[]")


if __name__ == "__main__":
    unittest.main()
