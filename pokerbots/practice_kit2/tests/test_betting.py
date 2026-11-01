"""Actions, raise-by, state fields, order of play, seats, antes, places."""

import unittest

from helpers import agent, rig, script, table
from simkit.rules import PAYOUTS_PER_MILLE

FOLD, CHECK, CALL = {"action": "fold"}, {"action": "check"}, {"action": "call"}


def raise_by(n):
    return {"action": "raise", "amount": n}


HOLES2 = [["AS", "AD"], ["2C", "7D"]]
BOARD = ["3C", "8D", "9H", "JC", "4S"]


class TestRaiseBy(unittest.TestCase):
    def heads_up(self, first_reply, second=None, stacks=None):
        seen = []
        a = agent("a", script([first_reply]))
        b = agent("b", script(second or [FOLD], log=seen))
        t = table([a, b], stacks=stacks, deck_factory=rig(HOLES2, BOARD))
        t.play_hand()
        return t, seen

    def test_amount_is_increment_over_current_bet(self):
        t, seen = self.heads_up(raise_by(40))
        s = seen[0]
        self.assertEqual(s["current_bet"], 60)          # 20 + 40
        me, opp = s["players"][1], s["players"][0]
        self.assertEqual(me["chips_in_pot_this_round"], 20)
        self.assertEqual(opp["chips_in_pot_this_round"], 60)
        # chips_total INCLUDES this round's chips; pot EXCLUDES them
        self.assertEqual(opp["chips_total"], 2000)
        self.assertEqual(me["chips_total"], 2000)
        self.assertEqual(s["pot"], 0)
        self.assertEqual(s["min_raise_by"], 40)
        raise_entry = [h for h in s["history"] if h["action"] == "raise"][0]
        self.assertEqual((raise_entry["amount"], raise_entry["to"]), (40, 60))
        self.assertEqual(t.entrants[0].stack, 2020)     # won the blind

    def test_small_raise_rounded_up_to_minimum(self):
        _, seen = self.heads_up(raise_by(5))
        self.assertEqual(seen[0]["current_bet"], 40)

    def test_huge_raise_is_all_in(self):
        _, seen = self.heads_up(raise_by(10**9))
        self.assertEqual(seen[0]["current_bet"], 2000)
        self.assertEqual(seen[0]["players"][0]["status"], "allin")

    def test_bad_amounts_are_errors(self):
        for bad in (40.0, "40", -20, 0, True, None):
            a = agent("a", script([raise_by(bad)]))
            b = agent("b", script([]))
            t = table([a, b], deck_factory=rig(HOLES2, BOARD))
            t.play_hand()
            self.assertEqual(a.stats.errors, 1, bad)
            # facing 10 more: the default is fold
            self.assertEqual(t.history[2]["action"], "fold", bad)


class TestDefaults(unittest.TestCase):
    def test_check_facing_bet_folds(self):
        a = agent("a", script([CHECK]))
        b = agent("b", script([]))
        t = table([a, b], deck_factory=rig(HOLES2, BOARD))
        t.play_hand()
        self.assertEqual(a.stats.errors, 1)
        self.assertEqual(t.entrants[0].stack, 1990)

    def test_unknown_actions_check_when_free(self):
        a = agent("a", script([CALL, {"action": "bet", "amount": 50}]))
        b = agent("b", script([CHECK, {"action": "allin"}, {"action": "Raise",
                                                           "amount": 40}]))
        t = table([a, b], deck_factory=rig(HOLES2, BOARD))
        t.play_hand()
        flop = [h for h in t.history if h["street"] == "flop"]
        self.assertEqual([h["action"] for h in flop], ["check", "check"])
        self.assertTrue(all(h.get("auto") for h in flop))
        turn = [h for h in t.history if h["street"] == "turn"]
        self.assertEqual((turn[0]["seat"], turn[0]["action"]), (1, "check"))
        self.assertTrue(turn[0].get("auto"))       # "Raise" is not "raise"
        self.assertEqual(a.stats.errors + b.stats.errors, 3)

    def test_call_when_free_is_check(self):
        a = agent("a", script([CALL]))
        b = agent("b", script([CALL, CALL]))
        t = table([a, b], deck_factory=rig(HOLES2, BOARD))
        t.play_hand()
        self.assertEqual(t.history[3]["action"], "check")   # BB option
        self.assertEqual(a.stats.errors + b.stats.errors, 0)

    def test_non_dict_reply(self):
        a = agent("a", lambda s: "fold" if s["type"] == "action"
                  else {"discard": None})
        b = agent("b", script([]))
        t = table([a, b], deck_factory=rig(HOLES2, BOARD))
        t.play_hand()
        self.assertEqual(a.stats.errors, 1)


class TestOrderAndSeats(unittest.TestCase):
    def test_heads_up_button_is_small_blind_and_acts_first_preflop(self):
        log_a, log_b = [], []
        a = agent("a", script([CALL], log=log_a))
        b = agent("b", script([CHECK, CHECK], log=log_b))
        t = table([a, b], deck_factory=rig(HOLES2, BOARD))
        t.play_hand()
        self.assertEqual(log_a[0]["my_seat"], 0)
        self.assertEqual(log_a[0]["street"], "preflop")
        self.assertEqual(t.history[0], {"street": "preflop", "seat": 0,
                                        "action": "small_blind", "amount": 10})
        self.assertEqual(t.history[1]["seat"], 1)
        flop = [h for h in t.history if h["street"] == "flop"]
        self.assertEqual(flop[0]["seat"], 1)    # BB first after the flop

    def test_three_handed_preflop_starts_on_button(self):
        bots = [agent(n, script([])) for n in "abc"]
        t = table(bots)
        t.play_hand()
        acts = [h for h in t.history if h["action"] not in
                ("small_blind", "big_blind")]
        self.assertEqual(acts[0]["seat"], 0)

    def test_eight_handed_order(self):
        log = []
        bots = [agent(f"p{i}", script([FOLD] * 5, log=log)) for i in range(8)]
        t = table(bots)
        t.play_hand()
        self.assertEqual([s["my_seat"] for s in log], [3, 4, 5, 6, 7, 0, 1])

    def test_seats_move_with_button(self):
        log = {n: [] for n in "abcd"}
        bots = [agent(n, script([FOLD] * 10, log=log[n])) for n in "abcd"]
        t = table(bots)
        t.play_hand()
        t.play_hand()
        self.assertEqual([x["my_seat"] for x in log["b"]], [1, 0])
        self.assertEqual([x["my_seat"] for x in log["a"]], [0, 3])

    def test_seats_close_up_after_knockout(self):
        holes = [["KS", "KD"], ["AS", "AD"], ["2C", "7D"]]
        bots = [agent("short", script([raise_by(10**6)])),
                agent("big", script([CALL])),
                agent("mid", script([FOLD]))]
        t = table(bots, stacks=[100, 1500, 400],
                  deck_factory=rig(holes, BOARD))
        t.play_hand()
        self.assertFalse(t.entrants[0].alive)
        log = []
        t.entrants[1].agent.module.get_action = script([FOLD], log=log)
        t.play_hand()
        self.assertEqual(log[0]["num_seats"], 2)
        self.assertEqual(len(log[0]["players"]), 2)
        self.assertEqual(log[0]["my_seat"], 0)   # button moved to "big"


class TestBettingRules(unittest.TestCase):
    def test_incomplete_all_in_does_not_reopen(self):
        log0, log2 = [], []
        holes = [["AS", "AD"], ["2C", "7D"], ["KS", "KD"]]
        bots = [agent("btn", script([raise_by(80), raise_by(500)], log=log0)),
                agent("sb", script([raise_by(10**6)])),
                agent("bb", script([CALL], log=log2))]
        t = table(bots, stacks=[1000, 130, 1000],
                  deck_factory=rig(holes, BOARD))
        t.play_hand()
        pre = [h for h in t.history if h["street"] == "preflop"]
        # btn raises to 100, sb all-in to 130 (by 30 < 80: incomplete)
        self.assertEqual((pre[3]["action"], pre[3]["to"]), ("raise", 130))
        self.assertTrue(log2[0]["can_raise"])        # bb had not acted yet
        self.assertEqual(log0[1]["min_raise_by"], 80)
        self.assertFalse(log0[1]["can_raise"])       # btn had acted
        self.assertEqual(pre[5]["action"], "call")   # raise became a call
        self.assertEqual(pre[5]["amount"], 30)

    def test_short_big_blind_still_full_bet_to_match(self):
        log = []
        holes = [["KS", "KD"], ["2C", "7D"], ["AS", "AD"]]
        bots = [agent("btn", script([CALL], log=log)),
                agent("sb", script([FOLD])),
                agent("bb", script([]))]
        t = table(bots, stacks=[1000, 1000, 15], deck_factory=rig(holes, BOARD))
        t.play_hand()
        self.assertEqual(log[0]["current_bet"], 20)
        self.assertEqual(log[0]["players"][2]["chips_in_pot_this_round"], 15)
        self.assertEqual(t.history[2]["amount"], 20)
        # bb's all-in wins 15 from each caller (40 with the sb's 10); the
        # button's unmatched 5 comes back
        self.assertEqual([e.stack for e in t.entrants], [985, 990, 40])

    def test_antes_from_level_four(self):
        log = []
        bots = [agent(n, script([FOLD] * 300, log=log)) for n in "abcd"]
        t = table(bots)
        for _ in range(75):
            t.play_hand()
        self.assertEqual(log[-1]["ante"], 0)
        t.play_hand()
        s = log[-1]
        self.assertEqual((s["level"], s["big_blind"], s["ante"]), (4, 100, 10))
        self.assertEqual(s["pot"], 40)                 # antes: in the pot
        self.assertEqual(sum(p["chips_in_pot_this_round"]
                             for p in s["players"]), 150)  # blinds only
        self.assertEqual(s["hands_left_in_level"], 24)

    def test_level_schedule(self):
        log = []
        bots = [agent(n, script([FOLD] * 300, log=log)) for n in "ab"]
        t = table(bots)
        for _ in range(26):
            t.play_hand()
        self.assertEqual(log[-1]["hand_number"], 26)
        self.assertEqual((log[-1]["small_blind"], log[-1]["big_blind"]),
                         (15, 30))
        self.assertEqual(log[-1]["hands_remaining"], 174)


class TestPlaces(unittest.TestCase):
    def test_simultaneous_knockouts(self):
        # seats 0 and 2 both lose all-in to seat 1 in one hand
        holes = [["KS", "KD"], ["AS", "AD"], ["QS", "QD"], ["2C", "7D"]]
        bots = [agent("k", script([raise_by(10**6)])),
                agent("a", script([CALL])),
                agent("q", script([CALL])),
                agent("x", script([FOLD]))]
        # 4 players: preflop order 3, 0, 1, 2
        t = table(bots, stacks=[300, 3000, 200, 1000],
                  payouts=PAYOUTS_PER_MILLE[:4], deck_factory=rig(holes, BOARD))
        t.play_hand()
        e = {x.name: x for x in t.entrants}
        self.assertEqual((e["k"].place, e["q"].place), (3, 4))
        self.assertEqual((e["k"].points, e["q"].points), (150, 100))

    def test_equal_stacks_share_places(self):
        holes = [["KS", "KD"], ["AS", "AD"], ["QS", "QD"], ["2C", "7D"]]
        bots = [agent("k", script([raise_by(10**6)])),
                agent("a", script([CALL])),
                agent("q", script([CALL])),
                agent("x", script([FOLD]))]
        t = table(bots, stacks=[300, 3000, 300, 1000],
                  payouts=PAYOUTS_PER_MILLE[:4], deck_factory=rig(holes, BOARD))
        t.play_hand()
        e = {x.name: x for x in t.entrants}
        self.assertEqual((e["k"].place, e["q"].place), (3, 3))
        self.assertEqual(e["k"].points, 125.0)
        self.assertEqual(e["q"].points, 125.0)


if __name__ == "__main__":
    unittest.main()
