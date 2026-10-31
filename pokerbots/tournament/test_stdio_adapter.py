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

    def test_preflop_allin_then_discards(self):
        # pot limit: four raises to get all-in, then no betting, but both still discard
        acts = [[1, "post 5"], [0, "post 10"], [1, "raise 20"], [0, "raise 60"], [1, "raise 180"],
                [0, "raise 540"], [1, "raise 690"], [0, "call"], [1, "discard Qd 3s"]]
        h = self.ad.history(acts)
        self.assertEqual((h[4].kind, h[4].amount), ("raise", 1500))
        self.assertEqual((h[5].position, h[5].street, h[5].kind, h[5].amount), (1, 0, "call", 690))
        self.assertEqual((h[6].position, h[6].street, h[6].kind), (0, 1, "discard"))
        m = act_msg(street="flop", phase="discard", board=["2c", "7h", "Ks"], seat=0,
                    discards=[[], ["Qd", "3s"]], pot=3000, bets=[0, 0], stacks=[0, 0], to_call=0,
                    legal=["discard"], raise_by=None, discard_count=2, actions=acts)
        ans = self.ad.answer(m)
        self.assertEqual(len(ans.split()), 3)
        self.assertEqual(self.ad.errors, 0)
        self.assertEqual(self.msgs, [])

    def test_discard_street_after_allin_comes_from_the_rules(self):
        # two discard rules (flop and turn): after a preflop all-in no betting action marks
        # the turn, so the second discards must still be recorded on street 2
        ad = StdioAdapter("balanced", "i_double_discard", log=self.msgs.append)
        acts = [[1, "post 1"], [0, "post 2"], [1, "raise 97"], [0, "call"],
                [0, "discard Qd"], [1, "discard 3s"], [0, "discard 4h"], [1, "discard 5c"]]
        h = ad.history(acts)
        self.assertEqual([(r.position, r.street) for r in h if r.kind == "discard"],
                         [(1, 1), (0, 1), (1, 2), (0, 2)])
        # normal betting after a discard keeps its street
        acts = [[1, "post 1"], [0, "post 2"], [1, "call"], [0, "check"], [0, "discard Qd"], [1, "discard 3s"],
                [0, "check"], [1, "check"], [0, "discard 4h"], [1, "discard 5c"], [0, "raise 4"]]
        h = ad.history(acts)
        self.assertEqual([(r.street, r.kind) for r in h][-3:], [(2, "discard"), (2, "discard"), (2, "raise")])

    def test_fold_when_check_was_possible(self):
        acts = [[1, "post 5"], [0, "post 10"], [1, "call"], [0, "fold"]]
        h = self.ad.history(acts)
        self.assertEqual((h[-1].position, h[-1].street, h[-1].kind), (1, 0, "fold"))
        self.ad.hand_end({"type": "hand_end", "hand": 1, "seat": 1, "result": 10, "showdown": False,
                          "folded": 0, "board": [], "discards": [[], []], "shown": None, "actions": acts})
        self.assertEqual((self.ad.errors, self.msgs), (0, []))

    def test_hand_end_without_fold_or_showdown_is_flagged(self):
        acts = [[1, "post 5"], [0, "post 10"], [1, "call"], [0, "check"]]
        self.ad.hand_end({"type": "hand_end", "hand": 3, "seat": 1, "result": 0, "showdown": False,
                          "folded": None, "board": [], "discards": [[], []], "shown": None, "actions": acts})
        self.assertEqual(self.ad.errors, 0)
        self.assertTrue(any("HAND_END MAPPING" in m for m in self.msgs), self.msgs)

    def test_history_matches_engine_on_random_hands(self):
        """Engine hands (with all-ins, folds when a check was free, discards after all-ins)
        written as protocol texts must replay to exactly the engine's own history."""
        import random
        from engine.game import Discard, Fold, HandState, RaiseTo
        from engine.match import deal_order
        from engine.variants import get_variant
        for v in ("k_irish", "i_double_discard", "c_discard3"):
            spec = get_variant(v)
            ad = StdioAdapter("random_legal", v, log=self.msgs.append)
            rnd = random.Random(1)

            def decide(p, o):
                lg = o.legal
                if lg.discard_count:
                    return Discard(o.my_cards[:lg.discard_count])
                r = rnd.random()
                if lg.can_raise and r < 0.45:
                    return RaiseTo(lg.max_raise_to if rnd.random() < 0.5 else lg.min_raise_to)
                return Fold() if r < 0.55 else lg.passive()
            for i in range(300):
                hs = HandState(spec, deal_order(spec, 1, i))
                hs.play(decide)
                texts = [[1, f"post {spec.small_blind}"], [0, f"post {spec.big_blind}"]]
                pips, street = [spec.small_blind, spec.big_blind], 0
                for (p, st, kind, amt, cs, fu) in hs.history:
                    if st != street:
                        street, pips = st, [0, 0]
                    if kind == "raise":
                        texts.append([1 - p, f"raise {amt - max(pips)}"])
                        pips[p] = amt
                    elif kind == "discard":
                        texts.append([1 - p, "discard " + " ".join(to_theirs(c) for c in cs)])
                    else:
                        texts.append([1 - p, kind])
                        pips[p] += amt
                want = [(p, st, k, a) for (p, st, k, a, cs, fu) in hs.history]
                got = [(r.position, r.street, r.kind, r.amount) for r in ad.history(texts)]
                self.assertEqual(got, want, f"{v} hand {i}")

    def test_match_start_takes_hands_from_server(self):
        self.ad.match_start({"type": "match_start", "hands": 300, "small_blind": 5, "big_blind": 10,
                             "stack": 1500, "hole_cards": 4, "discard_count": 2})
        self.assertEqual(self.ad.spec.hands_per_match, 300)
        self.assertEqual(self.msgs, [])


LOG = """# match seed=1 hands=1
Hand 1: a(D/SB,seat1) vs b(BB,seat0)
  a(D/SB,seat1) dealt 2c 3d 7h 8s
  b(BB,seat0) dealt Ah Ad As Ac
  a: post 5
  b: post 10
  a: call
  b: check
  a: discard 2c 3d
  b: discard As Ac
  b: check
  a: check
  b: check
  a: check
  b: raise 15
  a: fold
  board Kh 9c 4d 5s
  result b +10, a -10 | match total bot1 -10
"""


class TestReplayCheck(unittest.TestCase):
    def _hand(self):
        import os
        import tempfile
        from tournament.replay_check import parse_log
        fd, path = tempfile.mkstemp(suffix=".log")
        with os.fdopen(fd, "w") as f:
            f.write(LOG)
        try:
            return parse_log(path)[0]
        finally:
            os.unlink(path)

    def test_matching_rules_replay(self):
        from engine.variants import get_variant
        from tournament.replay_check import replay
        self.assertEqual(replay(self._hand(), get_variant("k_irish")), {"a": -10, "b": 10})

    def test_unreplayed_server_actions_are_a_mismatch(self):
        # our spec ends the hand (3 streets: showdown after the turn) with the same chip
        # result, but the server's river actions were never replayed: rules differ
        from engine.variants import get_variant
        from tournament.replay_check import replay
        spec = get_variant("k_irish").with_(board_cards_per_street=(0, 3, 1))
        with self.assertRaises(AssertionError):
            replay(self._hand(), spec)

    def test_engine_asking_past_the_log_is_a_mismatch(self):
        # our spec has a 5th street the server never played: an order mismatch, not a crash
        from engine.variants import get_variant
        from tournament.replay_check import replay
        h = self._hand()
        h["acts"] = h["acts"][:-2] + [("b", "check", []), ("a", "check", [])]
        h["board"] = h["board"] + ["Js"]
        spec = get_variant("k_irish").with_(board_cards_per_street=(0, 3, 1, 1, 1))
        with self.assertRaises(AssertionError):
            replay(h, spec)


if __name__ == "__main__":
    unittest.main()
