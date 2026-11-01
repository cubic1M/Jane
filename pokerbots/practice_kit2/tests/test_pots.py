"""Side pots, split pots, odd chips, chip conservation over whole tables."""

import random
import unittest

from helpers import agent, rig, script, table
from simkit.cards import full_deck

SHOVE = {"action": "raise", "amount": 10**6}
CALL, FOLD, CHECK = {"action": "call"}, {"action": "fold"}, {"action": "check"}
BOARD = ["3C", "8D", "9H", "JC", "4S"]
ROYAL = ["10S", "JS", "QS", "KS", "AS"]


class TestSidePots(unittest.TestCase):
    def test_three_way_all_in(self):
        holes = [["AS", "AD"], ["KS", "KD"], ["2C", "7D"]]
        bots = [agent(n, script([SHOVE])) for n in ("s100", "s300", "s1000")]
        t = table(bots, stacks=[100, 300, 1000], deck_factory=rig(holes, BOARD))
        t.play_hand()
        pots = t.last_hand["pots"]
        self.assertEqual([p["amount"] for p in pots], [300, 400, 700])
        self.assertEqual([p["eligible"] for p in pots], [[0, 1, 2], [1, 2], [2]])
        self.assertEqual([p["winners"] for p in pots], [[0], [1], [2]])
        self.assertEqual([e.stack for e in t.entrants], [300, 400, 700])

    def test_short_stack_loses_main_but_side_pot_paid_separately(self):
        holes = [["2C", "7D"], ["AS", "AD"], ["KS", "KD"]]
        bots = [agent(n, script([SHOVE])) for n in ("s100", "s300", "s1000")]
        t = table(bots, stacks=[100, 300, 1000], deck_factory=rig(holes, BOARD))
        t.play_hand()
        self.assertEqual([e.stack for e in t.entrants], [0, 700, 700])

    def test_folded_chips_stay_in_pot_without_eligibility(self):
        # seat 3 calls 20 then folds to the shove; its 20 goes to the winner
        holes = [["AS", "AD"], ["KS", "KD"], ["QS", "QD"], ["2C", "7D"]]
        bots = [agent("btn", script([SHOVE])),
                agent("sb", script([CALL])),
                agent("bb", script([FOLD])),
                agent("utg", script([CALL, FOLD]))]
        t = table(bots, stacks=[500, 1000, 1000, 1000],
                  deck_factory=rig(holes, BOARD))
        t.play_hand()
        main = t.last_hand["pots"][0]
        self.assertEqual(main["eligible"], [0, 1])
        self.assertEqual(main["amount"], 500 + 500 + 20 + 20)
        self.assertEqual(t.entrants[0].stack, 1040)

    def test_split_pot_odd_chip_goes_left_of_button(self):
        schedule = [(1, 5, 10, 1)]                      # ante makes it odd
        bots = [agent("btn", script([FOLD])), agent("sb", script([])),
                agent("bb", script([]))]
        holes = [["2C", "3D"], ["2D", "3C"], ["4D", "5C"]]
        t = table(bots, schedule=schedule, deck_factory=rig(holes, ROYAL))
        t.play_hand()
        pot = t.last_hand["pots"][0]
        self.assertEqual(pot["amount"], 23)
        self.assertEqual(pot["winners"], [1, 2])
        self.assertEqual(t.last_hand["won"], {0: 0, 1: 12, 2: 11})

    def test_heads_up_odd_chip_goes_to_big_blind(self):
        schedule = [(1, 5, 10, 1)]
        bots = [agent("btn", script([])), agent("bb", script([]))]
        holes = [["2C", "3D"], ["2D", "3C"]]
        t = table(bots, schedule=schedule, deck_factory=rig(holes, ROYAL))
        t.play_hand()
        self.assertEqual(t.last_hand["won"], {0: 10, 1: 12 - 1})
        self.assertEqual(t.last_hand["pots"][0]["winners"], [1, 0])

    def test_uncalled_bet_returned(self):
        bots = [agent("btn", script([{"action": "raise", "amount": 300}])),
                agent("bb", script([FOLD]))]
        t = table(bots)
        t.play_hand()
        self.assertEqual([e.stack for e in t.entrants], [2020, 1980])


def chaos_bot(seed):
    rng = random.Random(seed)
    junk = [None, 40.0, "x", -5, 0, True, [], {"a": 1}]

    def get_action(state):
        if state["type"] == "draw":
            r = rng.random()
            if r < 0.4:
                return {"discard": rng.choice(state["hole_cards"])}
            if r < 0.5:
                return {"discard": rng.choice(full_deck())}
            if r < 0.55:
                return rng.choice(junk)
            return {"discard": None}
        r = rng.random()
        if r < 0.15:
            return {"action": "fold"}
        if r < 0.45:
            return {"action": "call"}
        if r < 0.55:
            return {"action": "check"}
        if r < 0.85:
            return {"action": "raise",
                    "amount": rng.choice([1, state["min_raise_by"],
                                          state["big_blind"] * 3, 10**6,
                                          rng.randrange(1, 3000)])}
        if r < 0.9:
            return {"action": "raise", "amount": rng.choice(junk)}
        return rng.choice(junk)
    return get_action


class TestConservation(unittest.TestCase):
    def test_whole_tables(self):
        for seed in range(6):
            n = 2 + seed % 7
            bots = [agent(f"c{i}", chaos_bot(seed * 10 + i)) for i in range(n)]
            checks = []

            def observe(t):
                self.assertEqual(sum(e.stack for e in t.entrants),
                                 2000 * n)
                self.assertTrue(all(e.stack >= 0 for e in t.entrants))
                self.assertEqual(t.pot, 0)
                checks.append(1)

            t = table(bots, seed=seed, hand_observer=observe)
            res = t.play()
            self.assertEqual(len(checks), t.hand_no)
            self.assertAlmostEqual(sum(r["points"] for r in res),
                                   sum(t.payouts), places=6)
            self.assertTrue(all(r["place"] is not None for r in res))
            # every card seen in a hand is distinct (draws use fresh cards)
            lh = t.last_hand
            seen = lh["board"] + lh["dead"] + [c for h in lh["holes"].values()
                                                for c in h]
            self.assertEqual(len(seen), len(set(seen)))


if __name__ == "__main__":
    unittest.main()
