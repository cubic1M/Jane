import unittest

from helpers import ScriptBot, table
from engine import rules
from engine.positions import position_names


def actions(rec, pid):
    return [e for e in rec["events"] if e.get("player") == pid and e["type"] not in ("blind", "discard")]


class RaiseUnitTests(unittest.TestCase):
    def test_raise_to_in_big_blinds_includes_posted_blind(self):
        rec = {}
        # heads-up: p0 BTN posts SB 10 and acts first; "r 3" = raise TO 60 chips
        bots = [ScriptBot(["r 3", "f"], record=rec), ScriptBot(["f"])]
        t = table(bots)
        t.run()
        ev = actions(rec, "p0")[0]
        self.assertEqual((ev["type"], ev["to"], ev["amount"]), ("raise", 60, 50))
        self.assertEqual(t.seats[0].stack, 2020)

    def test_big_blind_units_follow_the_level(self):
        rec = {}
        bots = [ScriptBot(["r 3"], record=rec), ScriptBot(["f"])]
        table(bots, blind_levels=[(15, 30)]).run()
        self.assertEqual(actions(rec, "p0")[0]["to"], 90)

    def test_chip_amount_sent_as_bb_is_a_shove(self):
        rec = {}
        bots = [ScriptBot(["r 120"], record=rec), ScriptBot(["f"])]
        table(bots).run()
        ev = actions(rec, "p0")[0]
        self.assertEqual(ev["to"], 2000)
        self.assertTrue(ev["allin"])

    def test_rounding_and_min_raise_bump(self):
        rec = {}
        # "r 2.2" -> 2.0 bb = 40 = exactly the min raise; "r 1" -> bumped to min (40)
        bots = [ScriptBot(["r 2.2"], record=rec), ScriptBot(["f"])]
        table(bots).run()
        self.assertEqual(actions(rec, "p0")[0]["to"], 40)
        rec2 = {}
        bots = [ScriptBot(["r 1"], record=rec2), ScriptBot(["f"])]
        table(bots).run()
        self.assertEqual(actions(rec2, "p0")[0]["to"], 40)
        rec3 = {}
        bots = [ScriptBot(["r 2.25"], record=rec3), ScriptBot(["f"])]
        table(bots).run()
        self.assertEqual(actions(rec3, "p0")[0]["to"], 50)

    def test_postflop_bet_is_reported_as_bet(self):
        rec = {}
        bots = [ScriptBot(["c", "c"], record=rec), ScriptBot(["c", "r 1"])]
        table(bots).run()
        bets = [e for e in rec["events"] if e["type"] == "bet"]
        self.assertEqual((bets[0]["player"], bets[0]["to"], bets[0]["street"]), ("p1", 20, "flop"))


class ActionRuleTests(unittest.TestCase):
    def test_fold_when_check_is_free_folds(self):
        bots = [ScriptBot(["c"]), ScriptBot(["f"])]
        t = table(bots)
        t.run()
        self.assertEqual([s.stack for s in t.seats], [2020, 1980])

    def test_invalid_check_string_is_error_then_check_or_fold(self):
        # BB says "k": free -> auto check (error counted); later faces a bet -> fold
        rec = {}
        bots = [ScriptBot(["c", "r 2"], record=rec), ScriptBot(["k", "k", "k"])]
        t = table(bots)
        res = t.run()
        self.assertEqual(res["players"][1]["errors"], 3)
        ev = actions(rec, "p1")
        self.assertEqual([(e["type"], e["auto"]) for e in ev],
                         [("check", True), ("check", True), ("fold", True)])

    def test_incomplete_all_in_raise_does_not_reopen(self):
        rec0 = {}
        # p0 BTN opens to 100; p1 SB all-in to 130 (raise of 30 < 80); p2 BB calls;
        # p0 may only call or fold: its "r 20" becomes a call.
        bots = [ScriptBot(["r 5", "r 20"], record=rec0), ScriptBot(["r 999"]), ScriptBot(["c", "f"])]
        t = table(bots, stacks=[2000, 130, 2000])
        t.run()
        second = [s for s in rec0["states"] if s["street"] == "preflop"][1]
        self.assertFalse(second["can_raise"])
        self.assertIsNone(second["min_raise_to"])
        self.assertEqual(second["to_call"], 30)
        ev = actions(rec0, "p0")
        self.assertEqual([e["type"] for e in ev[:2]], ["raise", "call"])

    def test_full_raise_reopens(self):
        rec0 = {}
        bots = [ScriptBot(["r 5", "c"], record=rec0), ScriptBot(["r 999"]), ScriptBot(["c", "f"])]
        table(bots, stacks=[2000, 400, 2000]).run()
        second = [s for s in rec0["states"] if s["street"] == "preflop"][1]
        self.assertTrue(second["can_raise"])

    def test_raise_against_all_all_in_is_a_call(self):
        rec = {}
        bots = [ScriptBot(["r 999"]), ScriptBot(["r 50"], record=rec)]
        t = table(bots, stacks=[500, 3000])
        t.run()
        st = rec["states"][0]
        self.assertFalse(st["can_raise"])
        self.assertEqual(st["to_call"], 480)
        ev = [e for e in rec["events"] if e.get("player") == "p1" and e["type"] != "blind"]
        self.assertEqual(ev[0]["type"], "call")

    def test_short_big_blind(self):
        rec = {}
        bots = [ScriptBot(["c"], record=rec), ScriptBot([])]
        t = table(bots, stacks=[2000, 15])
        t.run()
        st = rec["states"][0]
        self.assertEqual((st["to_call"], st["current_bet"]), (10, 20))
        self.assertEqual(sum(s.stack for s in t.seats), 2015)

    def test_state_amounts_are_chips(self):
        rec = {}
        bots = [ScriptBot(["r 3"]), ScriptBot([], record=rec)]
        table(bots).run()
        st = rec["states"][0]
        self.assertEqual((st["to_call"], st["current_bet"], st["your_bet"], st["stack"], st["pot"]),
                         (40, 60, 20, 1980, 80))
        self.assertEqual((st["min_raise_to"], st["max_raise_to"]), (100, 2000))


class PositionAndBlindTests(unittest.TestCase):
    def test_position_names(self):
        self.assertEqual(position_names(2), ["BTN", "BB"])
        self.assertEqual(position_names(8), ["BTN", "SB", "BB", "UTG", "UTG1", "MP", "HJ", "CO"])
        self.assertEqual(position_names(5), ["BTN", "SB", "BB", "HJ", "CO"])
        self.assertEqual(position_names(4), ["BTN", "SB", "BB", "CO"])
        for n in range(2, 9):
            self.assertEqual(len(set(position_names(n))), n)

    def test_heads_up_button_posts_small_blind_acts_first_preflop_last_after(self):
        rec0, rec1 = {}, {}
        bots = [ScriptBot(["c", "c"], record=rec0), ScriptBot(["c", "c"], record=rec1)]
        table(bots).run()
        blinds = [e for e in rec0["events"] if e["type"] == "blind"]
        self.assertEqual([(e["player"], e["blind"], e["amount"]) for e in blinds],
                         [("p0", "SB", 10), ("p1", "BB", 20)])
        acts = [(e["street"], e["player"]) for e in rec0["events"] if e["type"] in ("call", "check")]
        self.assertEqual(acts[:4], [("preflop", "p0"), ("preflop", "p1"), ("flop", "p1"), ("flop", "p0")])
        self.assertEqual(rec0["states"][0]["position"], "BTN")

    def test_eight_handed_first_to_act_is_utg(self):
        recs = [{} for _ in range(8)]
        bots = [ScriptBot(["f"], record=recs[i]) for i in range(8)]
        table(bots).run()
        first = [e for e in recs[0]["events"] if e["type"] != "blind"][0]
        self.assertEqual(first["player"], "p3")
        self.assertEqual(recs[3]["states"][0]["position"], "UTG")

    def test_blind_schedule(self):
        self.assertEqual(rules.blinds_for_hand(1), (1, 10, 20))
        self.assertEqual(rules.blinds_for_hand(25), (1, 10, 20))
        self.assertEqual(rules.blinds_for_hand(26), (2, 15, 30))
        self.assertEqual(rules.blinds_for_hand(200), (8, 250, 500))
        self.assertEqual(rules.blinds_for_hand(250), (8, 250, 500))
        self.assertTrue(all(bb % 2 == 0 for _, bb in rules.BLIND_LEVELS))

    def test_button_moves_and_skips_busted(self):
        bots = [ScriptBot(["c"] * 50) for _ in range(3)]
        t = table(bots, max_hands=3)
        t._setup()
        t.play_hand()
        self.assertEqual(t.button, 0)
        t.play_hand()
        self.assertEqual(t.button, 1)
        t.seats[2].alive = False
        t.seats[0].stack += t.seats[2].stack
        t.seats[2].stack = 0
        t.play_hand()
        self.assertEqual(t.button, 0)


if __name__ == "__main__":
    unittest.main()
