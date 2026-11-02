import unittest

from helpers import ScriptBot, stacked_deck, table
from engine.cards import parse_card, parse_cards


class DiscardTwistTests(unittest.TestCase):
    def test_order_visibility_and_hole_counts(self):
        # 3 players: p0 BTN, p1 SB, p2 BB. Everyone limps/checks to showdown.
        rec = [{}, {}, {}]
        bots = [ScriptBot([], "last", rec[i]) for i in range(3)]
        deck = stacked_deck("2s 3s 9h", "4d 5d Th", "6c 7c Jh", "Ac Kd 8s 2h 3h")
        t = table(bots, deck=deck)
        t.run()
        # discard order = postflop order: p1, p2, p0
        disc_events = [e for e in rec[0]["events"] if e["type"] == "discard"]
        self.assertEqual([e["player"] for e in disc_events], ["p1", "p2", "p0"])
        self.assertEqual([e["card"] for e in disc_events], parse_cards("9h Th Jh"))
        # later discarders see earlier discards
        self.assertEqual(rec[1]["discard_states"][0]["discards"], {})
        self.assertEqual(rec[2]["discard_states"][0]["discards"], {"p1": parse_card("9h")})
        self.assertEqual(rec[0]["discard_states"][0]["discards"],
                         {"p1": parse_card("9h"), "p2": parse_card("Th")})
        self.assertEqual(rec[0]["discard_states"][0]["discard_order"], ["p1", "p2", "p0"])
        # 3 hole cards preflop, 2 afterwards, discards visible to everyone
        pre = [s for s in rec[0]["states"] if s["street"] == "preflop"][0]
        flop = [s for s in rec[0]["states"] if s["street"] == "flop"][0]
        self.assertEqual(len(pre["hole_cards"]), 3)
        self.assertEqual(flop["hole_cards"], parse_cards("6c 7c"))
        self.assertEqual(len(flop["discards"]), 3)
        self.assertEqual(rec[0]["showdown"]["hands"]["p1"], parse_cards("2s 3s"))

    def test_discarded_card_is_dead(self):
        # heads-up: p0 BTN, p1 BB; deal order p1 then p0.
        rec = [{}, {}]
        bots = [ScriptBot([], "last", rec[0]), ScriptBot([], "first", rec[1])]
        deck = stacked_deck("As Kd 4h", "Qs Qh 2c", "Ah Ac 9d 7h 3s")
        t = table(bots, deck=deck)
        t.run()
        # p1 threw As (would have been trip aces); p0's queens-up wins
        self.assertEqual(t.seats[0].stack, 2020)
        self.assertEqual(t.seats[1].stack, 1980)
        self.assertEqual(rec[0]["showdown"]["hand_names"]["p1"], "Pair of Aces")

    def test_invalid_discard_defaults_to_first_hole_card(self):
        rec = [{}, {}]
        # returning an index (1) instead of a card int; card int 1 (3s) is not held
        bots = [ScriptBot([], 1, rec[0]), ScriptBot([], "last", rec[1])]
        deck = stacked_deck("Qs Qh 2c", "Kd 7h As", "Ah Ac 9d 7c 3d")
        t = table(bots, deck=deck)
        t.run()
        disc = [e for e in rec[1]["events"] if e["type"] == "discard"]
        self.assertEqual(disc[1], {"type": "discard", "street": "discard", "player": "p0",
                                   "card": parse_card("Kd"), "auto": True})
        self.assertEqual(t.seats[0].errors, 1)

    def test_index_that_matches_a_held_card_discards_that_card(self):
        rec = [{}, {}]
        # p0 holds 3s (card int 1) as its third card and returns 1 meaning "index 1"
        bots = [ScriptBot([], 1, rec[0]), ScriptBot([], "last", rec[1])]
        deck = stacked_deck("Qs Qh 2c", "Kd 7h 3s", "Ah Ac 9d 7c 4d")
        t = table(bots, deck=deck)
        t.run()
        disc = [e for e in rec[1]["events"] if e["type"] == "discard"]
        self.assertEqual(disc[1]["card"], parse_card("3s"))
        self.assertFalse(disc[1]["auto"])
        self.assertEqual(t.seats[0].errors, 0)

    def test_no_discard_when_hand_ends_preflop(self):
        rec = [{}, {}, {}]
        bots = [ScriptBot(["r 999"], "last", rec[0]), ScriptBot(["f"], "last", rec[1]),
                ScriptBot(["f"], "last", rec[2])]
        t = table(bots)
        t.run()
        for r in rec:
            self.assertEqual(r["discard_states"], [])
        self.assertEqual(t.seats[0].stack, 2030)

    def test_folded_players_do_not_discard(self):
        rec = [{}, {}, {}]
        bots = [ScriptBot(["f"], "last", rec[0]), ScriptBot(["c"], "last", rec[1]),
                ScriptBot(["c"], "last", rec[2])]
        t = table(bots)
        t.run()
        self.assertEqual(rec[0]["discard_states"], [])
        self.assertEqual(len(rec[1]["discard_states"]), 1)
        self.assertEqual(rec[2]["discard_states"][0]["discard_order"], ["p1", "p2"])


if __name__ == "__main__":
    unittest.main()
