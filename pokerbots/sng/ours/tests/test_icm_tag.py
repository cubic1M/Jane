"""icm_tag: legal on every variant, fast (incl. the first decision), behaves as designed.
    python3 -m unittest sng.ours.tests.test_icm_tag
"""
import os
import time
import unittest

import numpy as np

from engine.variants import get_variant
from engine.game import Fold, RaiseTo
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

    def test_postflop_bet_frequency_read(self):
        """bet_opp / bet_made count who bets when checked to (agg_alpha's read)."""
        b = IcmTag()
        b.new_table(SngRules(enforce_time=False), 0, 0)
        pre = ((1, 0, "post", 10), (2, 0, "post", 20), (0, 0, "call", 20), (1, 0, "call", 20), (2, 0, "check", 0))
        # flop: 1 checks, 2 bets, 0 folds, 1 calls; turn: everyone checks
        flop = ((1, 1, "check", 0), (2, 1, "raise", 30), (0, 1, "fold", 0), (1, 1, "call", 30))
        turn = ((1, 2, "check", 0), (2, 2, "check", 0))
        b.end_hand(dict(history=pre + flop + turn, stacks=(), deltas=(), board=()))
        self.assertEqual(b.bet_made[2], 1)
        self.assertEqual(b.bet_opp[2], 2)          # flop bet + turn check
        self.assertEqual(b.bet_opp[1], 2)          # flop check + turn check
        self.assertEqual(b.bet_made[1], 0)
        self.assertEqual((b.pf_faced[0], b.pf_fold[0]), (1, 1))

    def test_read_switches_default_off_and_legal_when_on(self):
        """rk_floor / agg_alpha / thin_value default to off; switched on, the bot stays legal."""
        self.assertEqual((PARAMS["rk_floor"], PARAMS["agg_alpha"], PARAMS["thin_value"]), (1.2, 0.0, 0.0))
        r = SngRules(enforce_time=False, max_hands=60)
        lineup = lambda: [make("icm_tag")] + [make(x) for x in ("maniac", "station", "push", "nit", "lag", "random", "chen_tag")]
        a = play_table(lineup(), r, seed=5)
        on = [make("icm_tag:agg_alpha=1.0;thin_value=0.3;rk_floor=1.0")] + lineup()[1:]
        c = play_table(on, r, seed=5)
        self.assertEqual(c.stats[0].errors + c.stats[0].illegal, 0)
        self.assertEqual(a.stats[0].errors + a.stats[0].illegal, 0)

    def test_payout_risk_scale(self):
        from sng.ours.icm_tag import payout_risk_scale
        self.assertEqual(payout_risk_scale((100, 0, 0, 0, 0, 0, 0, 0)), 0.0)
        self.assertEqual(payout_risk_scale((50, 30, 20, 0, 0, 0, 0, 0)), 1.0)
        self.assertEqual(payout_risk_scale((350, 220, 150, 100, 75, 50, 35, 20)), 1.0)
        self.assertAlmostEqual(payout_risk_scale((65, 35, 0, 0)), 0.7)
        self.assertEqual(payout_risk_scale((12, 7, 4, 2, 0, 0, 0, -3)), 1.0)   # negative last place
        self.assertEqual(payout_risk_scale((5,)), 1.0)
        b = IcmTag(risk_payout=1)
        b.new_table(SngRules(enforce_time=False, payouts=(100, 0, 0, 0, 0, 0, 0, 0)), 0, 0)
        self.assertEqual(b.risk_scale, 0.0)
        b = IcmTag()                                                # on by default
        b.new_table(SngRules(enforce_time=False, payouts=(100, 0, 0, 0, 0, 0, 0, 0)), 0, 0)
        self.assertEqual(b.risk_scale, 0.0)
        b = IcmTag(risk_payout=0)
        b.new_table(SngRules(enforce_time=False, payouts=(100, 0, 0, 0, 0, 0, 0, 0)), 0, 0)
        self.assertEqual(b.risk_scale, 1.0)
        b = IcmTag()
        b.new_table(SngRules(enforce_time=False), 0, 0)             # default payouts: unchanged
        self.assertEqual(b.risk_scale, 1.0)

    def test_minimal_rules_stand_in_without_payouts(self):
        """A kit adapter's Rules stand-in may lack payouts: setup must not fail (scale 1)."""
        class Rules:
            spec = SngRules().spec
            num_players = 8
        b = IcmTag()
        b.new_table(Rules, 0, 1)
        self.assertEqual(b.risk_scale, 1.0)
        Rules.payouts = ("x",)                                    # garbage: still no failure
        b.new_table(Rules, 0, 1)
        self.assertEqual(b.risk_scale, 1.0)

    def test_heads_up_switches_only_on_heads_up_tables(self):
        """hu_open_mult opens wider heads-up, and never changes 8-handed play."""
        from sng.registry import make as mk
        r2 = SngRules(enforce_time=False, num_players=2, payouts=(100, 0), max_hands=80)
        r8 = SngRules(enforce_time=False, max_hands=40)
        def opens(bot_name, rules, seed):
            b = mk(bot_name)
            others = [mk("station") for _ in range(rules.num_players - 1)]
            log = []
            class Spy:
                def __init__(s, inner): s.inner = inner
                def new_table(s, *a): s.inner.new_table(*a)
                def end_hand(s, i): s.inner.end_hand(i)
                def act(s, obs):
                    a = s.inner.act(obs)
                    log.append(type(a).__name__)
                    return a
            res = play_table([Spy(b)] + others, rules, seed=seed)
            return log, res
        self.assertEqual((PARAMS["hu_open_mult"], PARAMS["hu_range_k"]), (0.6, 2.0))   # validated defaults
        base2, _ = opens("icm_tag:hu_open_mult=0;hu_range_k=0", r2, 3)
        wide2, res = opens("icm_tag", r2, 3)
        self.assertEqual(res.stats[0].errors + res.stats[0].illegal, 0)
        self.assertNotEqual(base2, wide2)
        base8, _ = opens("icm_tag:hu_open_mult=0;hu_range_k=0", r8, 3)
        same8, _ = opens("icm_tag", r8, 3)
        self.assertEqual(base8[:150], same8[:150])            # no change until the table is heads-up

    def test_top_range_mapping(self):
        """Equity vs one top-c hand ~ vs k = 1 + 0.65 log2(0.5/c) random hands, clamped to 1..7."""
        b = IcmTag()
        self.assertAlmostEqual(b._k_for_top(0.5), 1.0)
        self.assertAlmostEqual(b._k_for_top(0.1), 1 + 0.65 * 2.321928, places=4)
        self.assertEqual(b._k_for_top(1.0), 1.0)
        self.assertTrue(6.0 < b._k_for_top(1e-6) <= 7.0)               # c floored at 0.001
        ks = [b._k_for_top(c) for c in (0.6, 0.4, 0.2, 0.1, 0.05)]
        self.assertEqual(ks, sorted(ks))                           # tighter range = more hands

    def test_shove_models_legal_and_fast_when_on(self):
        """pev / resteal (off by default, day-of tuner candidates) stay legal and inside budget."""
        self.assertEqual((PARAMS["pev"], PARAMS["resteal"]), (0, 0))
        for seed in range(3):
            r = SngRules(enforce_time=False, max_hands=150)
            bots = [make("icm_tag:resteal=1;resteal_risk=0.5;pev=1;pev_risk=0.5")] + [
                make(x) for x in ("lag", "maniac", "chen_tag", "push", "station", "nit", "f3_exploiter")]
            res = play_table(bots, r, seed=seed)
            st = res.stats[0]
            self.assertEqual(st.errors + st.illegal, 0, st.first_error)
            if not os.environ.get("SNG_SKIP_TIMING"):
                ts = sorted(st.times)
                self.assertLess(ts[len(ts) // 2], 0.2e-3)

    def test_heads_up_and_cap_risk_scaling(self):
        """hu_risk scales the premium with 2 players left; cap_fade shrinks it as the cap nears."""
        from types import SimpleNamespace as NS
        self.assertEqual((PARAMS["hu_risk"], PARAMS["cap_fade"]), (1.0, 0))
        r = SngRules(enforce_time=False, payouts=(50, 30, 20, 0, 0, 0, 0, 0))

        def risk(left, hl, **kw):
            b = IcmTag(**kw)
            b.new_table(r, 0, 0)
            return b._risk(NS(players_left=left, hands_left=hl, seats=(), my_stack=0, seat=0))

        base2, base4 = risk(2, 100), risk(4, 100)
        self.assertGreater(base2, 0)
        self.assertEqual(risk(2, 100, hu_risk=0), 0.0)
        self.assertAlmostEqual(risk(2, 100, hu_risk=0.5), base2 / 2)
        self.assertAlmostEqual(risk(4, 100, hu_risk=0), base4)          # only heads-up
        self.assertAlmostEqual(risk(4, 100, cap_fade=50), base4)        # far from the cap: unchanged
        self.assertAlmostEqual(risk(4, 10, cap_fade=50), base4 * 0.2)
        self.assertEqual(risk(4, 0, cap_fade=50), 0.0)                  # the last hand
        self.assertEqual(risk(4, None, cap_fade=50), base4)             # a kit without hands_left

    def test_behind_k_counts_only_players_still_to_act(self):
        """UTG opens, I am next with six players still to act: the old rule models the raiser as
        4 + 6 x 0.8 random hands; behind_k=0 counts only players who put chips in (4)."""
        from sng.table import Hand
        from sng.tests.test_table import make_deck
        r = SngRules(enforce_time=False)
        got = {}
        for bk in (0.8, 0.0):
            b = IcmTag(behind_k=bk)
            b.new_table(r, 4, 1)
            seen = []
            real = b._eq_k
            b._eq_k = lambda obs, kf, _r=real, _s=seen: (_s.append(kf), _r(obs, kf))[1]

            def decide(j, o, lg, b=b):
                if j == 3 and o.street == 0 and not any(h[2] == "raise" for h in o.history):
                    return RaiseTo(60)
                if j == 4:
                    return b.act(o)
                return lg.passive() if lg.can_check else Fold()
            h = Hand(r, [2000] * 8, button=0, hand_number=0,
                     deck=make_deck(["2c 3d", "4c 5d", "6c 7d", "8c 9d", "Kh Qs", "Tc Jd", "2h 3h", "4h 5h"],
                                    "Kd 9h 4s 3c 8h", r.spec))
            h.play(decide, 8)
            got[bk] = seen[0]
        self.assertAlmostEqual(got[0.8], 4.0 + 6 * 0.8, places=6)
        self.assertAlmostEqual(got[0.0], 4.0, places=6)


if __name__ == "__main__":
    unittest.main()
