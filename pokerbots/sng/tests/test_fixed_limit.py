"""Fixed-limit betting in the SNG table: one bet unit (1 bb preflop/flop, 2 bb turn/river), cap of 4 bets."""
import unittest

from engine.game import Call, Check, Fold, RaiseTo
from sng.presets import PRESETS
from sng.registry import BOTS, make
from sng.rules import SngRules
from sng.table import Hand, play_table

FL = PRESETS["fixed_limit"]["spec"]


class TestFixedLimit(unittest.TestCase):
    def test_bet_units_and_cap(self):
        r = SngRules(enforce_time=False, spec=FL)
        seen = []

        def decide(j, o, lg):
            if lg.can_raise:
                seen.append((o.street, lg.min_raise_to - max(sv.bet for sv in o.seats), lg.min_raise_to == lg.max_raise_to))
                return RaiseTo(lg.max_raise_to)
            return lg.passive()
        from sng.tests.test_table import make_deck
        spec = r.spec
        h = Hand(r, [2000] * 3 + [0] * 5, button=0, hand_number=0,
                 deck=make_deck(["Ah Kd", "Qc Qd", "7h 2s", "", "", "", "", ""], "Kh 9h 4s 3c 8h", spec))
        h.play(decide, 3)
        pre = [x for x in seen if x[0] == 0]
        self.assertEqual(len(pre), 3)                          # bb is bet 1; raise, 3-bet, cap: 3 raises
        for st, unit, fixed in seen:
            self.assertTrue(fixed)
        turn = [x for x in seen if x[0] == 2]
        self.assertTrue(turn and all(u == 40 for _, u, _ in turn))   # the big bet on the turn
        flop = [x for x in seen if x[0] == 1]
        self.assertTrue(flop and all(u == 20 for _, u, _ in flop))
        self.assertEqual(len(flop), 4)                        # bet + 3 raises postflop

    def test_all_bots_legal_and_chips_conserved(self):
        import random
        names = [n for n in BOTS if n != "planb_sd"]
        rng = random.Random(2)
        r = SngRules(enforce_time=False, spec=FL)
        for t in range(6):
            line = rng.sample(names, 8)
            if t == 0:
                line[:2] = ["icm_tag", "icm_any"]
            res = play_table([make(n) for n in line], r, seed=900 + t)
            self.assertEqual(sum(res.final_stacks), 16000)
            self.assertEqual(sum(s.errors + s.illegal for s in res.stats), 0, line)


if __name__ == "__main__":
    unittest.main()
