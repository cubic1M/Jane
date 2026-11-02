"""icm_tag: legal on every variant, fast (incl. the first decision), behaves as designed.
    python3 -m unittest sng.ours.tests.test_icm_tag
"""
import os
import time
import unittest

import numpy as np

from engine.variants import get_variant
from engine.game import Fold
from sng.ours.icm_tag import PARAMS, IcmTag
from sng.registry import make
from sng.rules import SngRules
from sng.table import play_table

FIELD = ["chen_tag", "lag", "station", "maniac", "pushfold_icm", "nit", "adaptive"]


def rules_for(v, betting=None, **kw):
    spec = get_variant(v).with_(stack_reset_per_hand=False)
    if betting:
        spec = spec.with_(betting=betting)
    return SngRules(spec=spec, **kw)


class TestIcmTag(unittest.TestCase):
    def test_legal_on_variants(self):
        for v, betting in (("a_nlhe100", None), ("a_nlhe100", "pot_limit"), ("e_shortdeck", None),
                           ("d_omaha4x2", None)):
            r = rules_for(v, betting, enforce_time=False)
            for t in range(6):
                bots = [make(x) for x in FIELD]
                bots.insert(t % 8, IcmTag())
                res = play_table(bots, r, seed=300 + t)
                st = res.stats[t % 8]
                self.assertEqual((st.errors, st.illegal), (0, 0), f"{v} {betting}: {st.first_error}")
                self.assertEqual(sum(res.final_stacks), 16000)

    def test_never_illegal_on_discard_variants_or_omaha(self):
        """Bug-hunter regressions: icm_tag answered discard requests illegally, icm_lite raised
        on Omaha / discard games (every error is an auto-fold)."""
        from sng.presets import PRESETS
        cases = [SngRules(enforce_time=False, **PRESETS[p]) for p in ("discard_to_board", "omaha_discard2",
                                                                       "draw_holdem", "five_draw")]
        cases.append(rules_for("d_omaha4x2", enforce_time=False))
        for r in cases:
            for name in ("icm_tag", "icm_lite"):
                for t in range(3):
                    bots = [make(x) for x in FIELD]
                    bots.insert(t, make(name))
                    res = play_table(bots, r, seed=1300 + t)
                    st = res.stats[t]
                    self.assertEqual((st.errors, st.illegal), (0, 0), f"{name} {r.spec.name}: {st.first_error}")

    @unittest.skipIf(os.environ.get("SNG_SKIP_TIMING"), "timing skipped")
    def test_fast_including_first_decision(self):
        r = rules_for("a_nlhe100", enforce_time=False)
        times, firsts = [], []
        for t in range(8):
            bots = [make(x) for x in FIELD]
            me = IcmTag()
            bots.insert(t % 8, me)
            res = play_table(bots, r, seed=900 + t)
            st = res.stats[t % 8]
            times += st.times
            firsts.append(st.times[0])
        p99 = np.percentile(np.array(times) * 1000, 99)
        self.assertLess(p99, 0.2, f"p99 {p99:.3f} ms")
        self.assertLess(max(firsts) * 1000, 0.5, f"first decisions {[round(x * 1000, 3) for x in firsts]} ms")

    def test_params_override_and_reject_unknown(self):
        b = IcmTag(range_k=5.0)
        self.assertEqual(b.p["range_k"], 5.0)
        self.assertEqual(b.p["call_margin"], PARAMS["call_margin"])
        with self.assertRaises(ValueError):
            IcmTag(no_such=1)
        self.assertEqual(make("icm_tag:range_k=5.5").p["range_k"], 5.5)

    def test_short_stack_is_push_or_fold(self):
        """At <= push_bb every voluntary preflop raise is all-in."""
        r = rules_for("a_nlhe100", enforce_time=False, blinds=((100, 200),))   # 10bb deep from hand 0
        raises = []

        class Spy(IcmTag):
            def act(self, obs):
                a = super().act(obs)
                short = obs.my_stack + obs.my_bet <= PARAMS["push_bb"] * obs.big_blind
                if short and obs.street == 0 and a.kind == "raise" and not any(
                        h[2] == "raise" for h in obs.history if h[1] == 0):
                    raises.append(a.amount == obs.legal.max_raise_to)
                return a
        for t in range(6):
            bots = [make(x) for x in FIELD]
            bots.insert(0, Spy())
            play_table(bots, r, seed=40 + t)
        self.assertTrue(raises)
        self.assertTrue(all(raises))

    def test_works_without_history(self):
        """A kit that gives no action history: still legal, still sees raises from the bets."""
        from dataclasses import replace

        class NoHist(IcmTag):
            def act(self, obs):
                return super().act(replace(obs, history=()))
        r = rules_for("a_nlhe100", enforce_time=False)
        for t in range(4):
            bots = [make(x) for x in FIELD]
            bots.insert(t, NoHist())
            res = play_table(bots, r, seed=700 + t)
            st = res.stats[t]
            self.assertEqual((st.errors, st.illegal), (0, 0), st.first_error)
        # facing a big raise with a weak hand and no history: fold, not an open-raise
        b = IcmTag()
        b.new_table(SngRules(enforce_time=False), 3, 0)
        from engine.cards import parse_cards
        from sng.table import Legal, SeatView, SngObservation
        seats = tuple(SeatView(i, 2000 - (200 if i == 2 else 0), 200 if i == 2 else 0, 200 if i == 2 else 0,
                               False, False, True) for i in range(8))
        lg = Legal(False, True, 200, True, 380, 2000)
        o = SngObservation(hand_number=0, hands_left=199, level=0, small_blind=10, big_blind=20, ante=0, seat=3,
                           button=0, sb_seat=1, bb_seat=2, street=0, hole=tuple(parse_cards("7c2d")), board=(),
                           pot=200, my_stack=2000, my_bet=0, legal=lg, seats=seats, history=(), players_left=8,
                           payouts=SngRules().payouts, places_paid=())
        self.assertEqual(b.act(o).kind, "fold")

    def test_calls_when_raising_is_impossible(self):
        """Regression: with no raise possible (a blind all-in for less, or my call all-in) the
        open / push branch fell through to Fold: AA folded 5 more chips into a 25-chip pot."""
        from engine.cards import parse_cards
        from sng.table import Hand
        from sng.tests.test_table import make_deck
        r = SngRules(num_players=2, payouts=(100, 0), enforce_time=False)
        for hole in ("Ah As", "7c 2d"):
            b = IcmTag()
            b.new_table(r, 0, 1)
            acts = []

            def decide(j, o, lg):
                a = b.act(o) if j == 0 else Fold()
                if j == 0:
                    acts.append((lg.can_raise, a.kind))
                return a
            # heads-up: the BB has 15 chips and is all-in from posting; the button (SB) owes 5
            h = Hand(r, [3000, 15], button=0, hand_number=0,
                     deck=make_deck([hole, "9c 8d"], "Kd 9h 4s 3c 8h", r.spec))
            h.play(decide, 2)
            self.assertEqual(acts[0], (False, "call"), hole)
        # 3-handed: my small blind leaves 5 chips behind and the call (all-in) is 10 more
        r3 = SngRules(num_players=3, payouts=(50, 30, 20), enforce_time=False)
        b = IcmTag()
        b.new_table(r3, 1, 1)
        seen = []

        def decide3(j, o, lg):
            if j == 1:
                a = b.act(o)
                seen.append((lg.can_raise, a.kind))
                return a
            return Fold() if lg.can_call else lg.passive()
        h = Hand(r3, [3000, 15, 3000], button=0, hand_number=0,
                 deck=make_deck(["9c 8d", "Ah Ad", "7c 6d"], "Kd 9h 4s 3c 8h", r3.spec))
        h.play(decide3, 3)
        self.assertIn((False, "call"), seen)

    def test_steal_read_never_uses_my_own_seat(self):
        """Regression: in the small blind (one player behind) the fold-to-steal read fell back
        to [SB, BB], i.e. it read my own fold rate as an opponent's."""
        from sng.table import Hand
        from sng.tests.test_table import make_deck
        r3 = SngRules(num_players=3, payouts=(50, 30, 20), enforce_time=False)
        asked = []

        class Spy(IcmTag):
            def _fold_rate(self, seats):
                asked.append(list(seats))
                return super()._fold_rate(seats)
        b = Spy()
        b.new_table(r3, 1, 1)

        def decide(j, o, lg):
            return b.act(o) if j == 1 else (Fold() if lg.can_call else lg.passive())
        h = Hand(r3, [3000] * 3, button=0, hand_number=0,
                 deck=make_deck(["9c 8d", "Ah Ad", "7c 6d"], "Kd 9h 4s 3c 8h", r3.spec))
        h.play(decide, 3)          # button folds; my SB (seat 1) is first in vs the BB alone
        self.assertTrue(asked)
        self.assertTrue(all(1 not in seats for seats in asked), asked)

    def test_discard_policy_is_loaded_at_setup_not_in_a_decision(self):
        """Regression: the first discard decision imported sng.ours.anyvar (and built its
        high-card code) inside the 1 ms limit (~2.6 ms: an automatic lowest-card discard)."""
        import subprocess
        import sys
        from pathlib import Path
        code = ("import sys; from sng.presets import PRESETS; from sng.rules import SngRules;"
                "from sng.ours.icm_tag import IcmTag; b = IcmTag();"
                "b.new_table(SngRules(**PRESETS['five_draw']), 0, 1);"
                "loaded = 'sng.ours.anyvar' in sys.modules;"
                "from sng.ours import anyvar, features as F;"
                "print(loaded, F.get_ctx(b.spec).sig in anyvar._HC)")
        root = Path(__file__).resolve().parents[3]     # fresh interpreter: nothing imported before
        r = subprocess.run([sys.executable, "-c", code], cwd=root, capture_output=True, text=True, timeout=60)
        self.assertEqual(r.returncode, 0, r.stderr[-1500:])
        self.assertEqual(r.stdout.split(), ["True", "True"])

    def test_default_chart_is_the_equilibrium_not_a_best_response_file(self):
        """Regression: load_chart(rules) (pf_file "") took the first pushfold_*.json whose
        payouts matched; pushfold_br_* (best-response shove charts, no call charts) sort
        before pushfold_synthetic.json, so the 'equilibrium' default silently became one."""
        import json
        import tempfile
        from pathlib import Path
        from unittest import mock
        from sng.ours import pushfold_chart as PC
        tmp = Path(tempfile.mkdtemp(prefix="pf_"))
        pay = list(SngRules().payouts)
        (tmp / "pushfold_br_blend_synthetic.json").write_text(json.dumps(
            dict(pay=pay, depths=[10], shove={"8,10,0": "1" * 169}, call={}, kind="best_response")))
        (tmp / "pushfold_synthetic.json").write_text(json.dumps(
            dict(pay=pay, depths=[10], shove={"8,10,0": "0" * 169}, call={"8,10,1,0": "0" * 169})))
        with mock.patch.object(PC, "CACHE", tmp), mock.patch.dict(PC._CACHE, clear=True):
            ch = PC.load_chart(SngRules())
            self.assertNotEqual(ch.raw.get("kind"), "best_response")
            self.assertIn("8,10,1,0", ch.call)
            br = PC.load_chart(SngRules(), "br_blend_synthetic")          # still loadable by name
            self.assertEqual(br.raw.get("kind"), "best_response")

    def test_steals_wider_against_folders(self):
        """With blinds that always fold, the open bar drops (fold-to-steal read)."""
        b = IcmTag()
        r = SngRules(enforce_time=False)
        b.new_table(r, 0, 0)
        base = b._fold_rate([1, 2])
        for _ in range(20):
            b.end_hand(dict(history=((1, 0, "post", 10), (2, 0, "post", 20), (0, 0, "raise", 50),
                                     (1, 0, "fold", 0), (2, 0, "fold", 0)), stacks=(), deltas=(), board=()))
        self.assertGreater(b._fold_rate([1, 2]), base + 0.3)


if __name__ == "__main__":
    unittest.main()
