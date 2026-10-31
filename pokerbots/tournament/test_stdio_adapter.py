"""Unit tests for the JSON stdin/stdout adapter (rehearsal protocol).
    python3 -m unittest tournament.test_stdio_adapter
"""
import unittest

from engine.cards import parse_card
from tournament.stdio_json_adapter import StdioAdapter, to_ours, to_theirs


def act_msg(**kw):
    m = {"type": "act", "id": 1, "hand": 1, "seat": 1, "street": "preflop", "phase": "bet",
         "hole": ["Ah", "10d", "7c", "7s"], "board": [], "discards": [[], []], "pot": 15,
         "bets": [10, 5], "stacks": [1490, 1495], "actions": [[1, "post 5"], [0, "post 10"]],
         "to_call": 5, "legal": ["fold", "call", "raise"], "raise_by": [10, 20], "clock": 120.0, "score": 0}
    m.update(kw)
    return m


class TestStdioAdapter(unittest.TestCase):
    def setUp(self):
        self.msgs = []
        self.ad = StdioAdapter("balanced", "k_irish", log=self.msgs.append)
        self.ad.bot.new_match(self.ad.spec, 0)

    def test_cards(self):
        self.assertEqual(to_ours("10d"), parse_card("Td"))
        self.assertEqual(to_theirs(parse_card("Td")), "10d")
        self.assertEqual(to_theirs(to_ours("Ah")), "Ah")

    def test_dealer_is_our_position_0_and_raise_is_by(self):
        o = self.ad.observation(act_msg())
        self.assertEqual(o.position, 0)                       # seat 1 = dealer = our SB
        self.assertEqual((o.my_pip, o.opp_pip, o.legal.call_amount), (5, 10, 5))
        self.assertEqual((o.legal.min_raise_to, o.legal.max_raise_to), (20, 30))
        from engine.game import RaiseTo
        self.assertEqual(self.ad.translate(RaiseTo(30), o, act_msg()), "raise 20")
        self.assertEqual(self.msgs, [])

    def test_history_replay_streets_and_raise_to(self):
        acts = [[1, "post 5"], [0, "post 10"], [1, "raise 20"], [0, "call"],
                [1, "discard Qd 3s"], [0, "discard 10d 7c"], [0, "check"], [1, "raise 30"], [0, "call"],
                [0, "check"]]
        h = self.ad.history(acts)
        kinds = [(r.position, r.street, r.kind, r.amount) for r in h]
        self.assertEqual(kinds[0], (0, 0, "raise", 30))       # raise by 20 over 10 = to 30
        self.assertEqual(kinds[1], (1, 0, "call", 20))
        self.assertEqual(kinds[2][:3], (0, 1, "discard"))
        self.assertEqual(kinds[4], (1, 1, "check", 0))
        self.assertEqual(kinds[5], (0, 1, "raise", 30))
        self.assertEqual(kinds[6], (1, 1, "call", 30))
        self.assertEqual(kinds[7], (1, 2, "check", 0))        # turn

    def test_discard_phase_and_dead_cards(self):
        m = act_msg(street="flop", phase="discard", board=["2c", "7h", "Ks"], seat=0,
                    discards=[[], ["Qd", "3s"]], pot=40, bets=[0, 0], stacks=[1480, 1480],
                    to_call=0, legal=["discard"], raise_by=None, discard_count=2,
                    actions=[[1, "post 5"], [0, "post 10"], [1, "raise 5"], [0, "call"], [1, "discard Qd 3s"]])
        o = self.ad.observation(m)
        self.assertEqual((o.phase, o.legal.discard_count, o.position), ("discard", 2, 1))
        self.assertEqual(o.opp_discards, (parse_card("Qd"), parse_card("3s")))
        self.assertEqual((o.my_discards_left, o.opp_discards_left, o.opp_num_cards), (2, 0, 2))
        ans = self.ad.answer(m)
        self.assertTrue(ans.startswith("discard "))
        self.assertEqual(len(ans.split()), 3)
        self.assertTrue(all(c in m["hole"] for c in ans.split()[1:]))

    def test_wrong_blind_mapping_is_flagged(self):
        from tournament import stdio_json_adapter as mod
        mod.PROTOCOL["seat_of_sb"] = 0
        try:
            self.ad.observation(act_msg())
        finally:
            mod.PROTOCOL["seat_of_sb"] = 1
        self.assertTrue(any("BLIND MAPPING" in m for m in self.msgs), self.msgs)

    def test_match_start_takes_hands_from_server(self):
        self.ad.match_start({"type": "match_start", "hands": 300, "small_blind": 5, "big_blind": 10,
                             "stack": 1500, "hole_cards": 4, "discard_count": 2})
        self.assertEqual(self.ad.spec.hands_per_match, 300)
        self.assertEqual(self.msgs, [])


if __name__ == "__main__":
    unittest.main()
