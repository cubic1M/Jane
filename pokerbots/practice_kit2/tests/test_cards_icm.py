import unittest

from helpers import agent, rig, script, table
from simkit import cards as C
from simkit.icm import finish_probabilities, icm_equities


class TestCards(unittest.TestCase):
    def test_format(self):
        self.assertEqual(C.parse("10H"), (10, "H"))
        self.assertEqual(C.parse("AS"), (14, "S"))
        for bad in ("TH", "10h", "1H", "AX", "", "10", None, 10):
            self.assertFalse(C.is_card(bad), bad)
        self.assertEqual(len(set(C.full_deck())), 52)
        self.assertIn("10C", C.full_deck())

    def test_category_order(self):
        hands = [
            ["2C", "7D", "9H", "JS", "KC"],               # high card
            ["2C", "2D", "9H", "JS", "KC"],               # pair
            ["2C", "2D", "9H", "9S", "KC"],               # two pair
            ["2C", "2D", "2H", "9S", "KC"],               # trips
            ["AC", "2D", "3H", "4S", "5C"],               # wheel
            ["6C", "2D", "3H", "4S", "5C"],               # six-high straight
            ["2C", "7C", "9C", "JC", "KC"],               # flush
            ["2C", "2D", "2H", "9S", "9C"],               # full house
            ["2C", "2D", "2H", "2S", "9C"],               # quads
            ["10S", "JS", "QS", "KS", "AS"],              # royal
        ]
        scores = [C.evaluate(h) for h in hands]
        self.assertEqual(scores, sorted(scores))
        self.assertEqual(len(set(scores)), len(scores))

    def test_seven_cards(self):
        # two trips -> full house, best of three pairs, flush beats straight
        self.assertEqual(C.evaluate(["5C", "5D", "5H", "9S", "9C", "9D", "2H"]),
                         (6, 9, 5))
        self.assertEqual(C.evaluate(["5C", "5D", "9H", "9S", "KC", "KD", "AH"]),
                         (2, 13, 9, 14))
        self.assertEqual(C.evaluate(["4H", "5H", "6H", "7D", "8H", "2H", "KS"])[0],
                         5)
        self.assertEqual(C.evaluate(["4H", "5H", "6H", "7H", "8H", "9D", "KS"]),
                         (8, 8))
        self.assertEqual(C.hand_name(C.evaluate(["10D", "10S", "3C", "4D", "8H"])),
                         "pair")


class TestICM(unittest.TestCase):
    def test_equal_stacks(self):
        eq = icm_equities([1000] * 4, [500, 300, 200])
        for v in eq:
            self.assertAlmostEqual(v, 250.0)

    def test_two_players_linear(self):
        eq = icm_equities([3000, 1000], [350, 220])
        self.assertAlmostEqual(eq[0], 220 + 130 * 0.75)
        self.assertAlmostEqual(eq[1], 220 + 130 * 0.25)

    def test_known_three_way(self):
        eq = icm_equities([50, 30, 20], [0.5, 0.3, 0.2])
        self.assertAlmostEqual(eq[0], 0.3839286, places=6)
        self.assertAlmostEqual(sum(eq), 1.0)

    def test_probabilities_are_stochastic(self):
        P = finish_probabilities([10, 20, 30, 40, 50])
        for row in P:
            self.assertAlmostEqual(sum(row), 1.0)
        for k in range(5):
            self.assertAlmostEqual(sum(P[i][k] for i in range(5)), 1.0)
        self.assertAlmostEqual(P[4][0], 50 / 150)

    def test_table_cap_uses_icm_for_remaining_places(self):
        bots = [agent(f"b{i}", script([])) for i in range(4)]
        t = table(bots, max_hands=1, stacks=[4000, 2000, 1000, 1000],
                  payouts=[350, 220, 150, 100])
        res = t.play()
        stacks = [r["final_stack"] for r in res]
        expected = icm_equities(stacks, [350, 220, 150, 100])
        for r, e in zip(res, expected):
            self.assertAlmostEqual(r["points"], e)
        self.assertAlmostEqual(sum(r["points"] for r in res), 820)

    def test_cap_after_knockouts(self):
        # seat 0 (button, preflop first to act with 3 bots) shoves 100,
        # seat 1 calls, seat 2 folds; aces beat kings
        holes = [["KS", "KD"], ["AS", "AD"], ["2C", "7D"]]
        board = ["3C", "8D", "9H", "JC", "4S"]
        bots = [agent("short", script([{"action": "raise", "amount": 10**6}])),
                agent("big", script([{"action": "call"}])),
                agent("mid", script([{"action": "fold"}]))]
        t = table(bots, max_hands=1, stacks=[100, 1500, 400],
                  payouts=[350, 220, 150], deck_factory=rig(holes, board))
        res = {r["name"]: r for r in t.play()}
        self.assertEqual(res["short"]["place"], 3)
        self.assertEqual(res["short"]["points"], 150)
        eq = icm_equities([res["big"]["final_stack"], res["mid"]["final_stack"]],
                          [350, 220])
        self.assertAlmostEqual(res["big"]["points"], eq[0])
        self.assertAlmostEqual(res["mid"]["points"], eq[1])


if __name__ == "__main__":
    unittest.main()
