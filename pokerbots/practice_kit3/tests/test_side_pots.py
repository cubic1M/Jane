import unittest

from helpers import ScriptBot, stacked_deck, table
from engine.pots import build_pots, split_amount


class PotFunctionTests(unittest.TestCase):
    def test_three_way_all_in(self):
        pots = build_pots({"a": 100, "b": 300, "c": 1000}, set())
        self.assertEqual(pots, [(300, ["a", "b", "c"]), (400, ["b", "c"]), (700, ["c"])])

    def test_folded_money_stays_in_pot(self):
        pots = build_pots({"a": 200, "b": 50, "c": 200}, {"b"})
        self.assertEqual(pots, [(450, ["a", "c"])])

    def test_folded_bigger_than_short_all_in(self):
        # d folded after putting in 150; a all-in for 100; b and c to 400
        pots = build_pots({"a": 100, "b": 400, "c": 400, "d": 150}, {"d"})
        self.assertEqual(pots, [(400, ["a", "b", "c"]), (650, ["b", "c"])])
        self.assertEqual(sum(p[0] for p in pots), 1050)

    def test_split_odd_chips_go_in_order(self):
        self.assertEqual(split_amount(303, ["x", "y"]), {"x": 152, "y": 151})
        self.assertEqual(split_amount(10, ["x", "y", "z"]), {"x": 4, "y": 3, "z": 3})


class TableSidePotTests(unittest.TestCase):
    def test_main_side_and_uncalled(self):
        # seat0 p0 = BTN (1000), p1 = SB (100), p2 = BB (300). Deal order p1, p2, p0.
        rec = [{}, {}, {}]
        bots = [ScriptBot(["r 999"], "last", rec[0]), ScriptBot(["c"], "last", rec[1]),
                ScriptBot(["c"], "last", rec[2])]
        deck = stacked_deck("As Ah 2c", "Ks Kh 3c", "Qs Qh 4c", "7d 8d 9c 2h 3d")
        t = table(bots, stacks=[1000, 100, 300], deck=deck)
        t.run()
        self.assertEqual([s.stack for s in t.seats], [700, 300, 400])
        pots = rec[0]["end"]["pots"]
        self.assertEqual([p["amount"] for p in pots], [300, 400, 700])
        self.assertEqual([p["winners"] for p in pots], [["p1"], ["p2"], ["p0"]])
        # every all-in player still discarded
        for r in rec:
            self.assertEqual(len(r["discard_states"]), 1)

    def test_split_main_pot_odd_chip_and_side_pot(self):
        bots = [ScriptBot(["r 999"], "last"), ScriptBot(["c"], "last"), ScriptBot(["c"], "last")]
        deck = stacked_deck("As Kd 2c", "Ac Kh 3c", "7s 8h 4c", "Qd Jc Ts 2h 5s")
        t = table(bots, stacks=[1000, 101, 1000], deck=deck)
        t.run()
        # main 303 split p1/p2, odd chip to p1 (first left of button); side 1798 to p2
        self.assertEqual([s.stack for s in t.seats], [0, 152, 1949])


if __name__ == "__main__":
    unittest.main()
