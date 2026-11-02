"""icm_tag: legal on every variant, fast (incl. the first decision), behaves as designed.
    python3 -m unittest sng.ours.tests.test_icm_tag
"""
import os
import time
import unittest

import numpy as np

from engine.variants import get_variant
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
