"""Self-contained test of the MIT-skeleton adapter.

FakeRound is a minimal state chain written here with the skeleton's semantics
(street codes 0/2/3/4/5/6, index 0 = small blind, BB discards first, the other
player gets a placeholder check during a discard step, raise-to amounts).
    python3 -m unittest tournament.test_mit_adapter
"""
import types
import unittest
from collections import namedtuple

from tournament import mit_adapter
from tournament.mit_adapter import AdaptedPlayer

Fold = namedtuple("FoldAction", [])
Call = namedtuple("CallAction", [])
Check = namedtuple("CheckAction", [])
Raise = namedtuple("RaiseAction", ["amount"])
Disc = namedtuple("DiscardAction", ["card"])
ACTIONS = types.SimpleNamespace(FoldAction=Fold, CallAction=Call, CheckAction=Check,
                                RaiseAction=Raise, DiscardAction=Disc)
GS = namedtuple("GameState", ["bankroll", "game_clock", "round_num"])
TS = namedtuple("TerminalState", ["deltas", "previous_state"])
STACK, BB = 400, 2


class FakeRound(namedtuple("R", ["button", "street", "pips", "stacks", "hands", "board", "previous_state"])):
    def legal_actions(self):
        a = self.button % 2
        if self.street in (2, 3):
            return {Disc} if a != self.street % 2 else {Check}
        cost = self.pips[1 - a] - self.pips[a]
        if cost == 0:
            return {Check, Fold} if 0 in self.stacks else {Check, Raise, Fold}
        return {Fold, Call} if cost == self.stacks[a] or self.stacks[1 - a] == 0 else {Fold, Call, Raise}

    def raise_bounds(self):
        a = self.button % 2
        cost = self.pips[1 - a] - self.pips[a]
        mx = min(self.stacks[a], self.stacks[1 - a] + cost)
        mn = min(mx, cost + max(cost, BB))
        return self.pips[a] + mn, self.pips[a] + mx

    def nxt(self, **kw):
        d = self._asdict()
        d.update(kw)
        d["previous_state"] = self
        return FakeRound(**d)


def start(hands):
    return FakeRound(0, 0, [1, 2], [STACK - 1, STACK - 2], hands, [], None)


class TestAdapter(unittest.TestCase):
    def setUp(self):
        self.msgs = []
        self.p = AdaptedPlayer("balanced", "c_discard3", ACTIONS, log=self.msgs.append)

    def test_history_and_observation(self):
        hands = [["As", "Ad", "7c"], []]            # we are index 0 = SB; opponent hidden
        r0 = start(hands)
        gs = GS(0, 60.0, 1)
        self.p.handle_new_round(gs, r0, 0)
        obs = self.p._observation(gs, r0, 0)
        self.assertEqual((obs.position, obs.street, obs.phase), (0, 0, "bet"))
        self.assertEqual((obs.my_pip, obs.opp_pip, obs.legal.call_amount), (1, 2, 1))
        self.assertEqual(obs.legal.min_raise_to, 4)
        # SB raises to 6, BB calls -> street 2 (BB discards first), flop dealt
        r1 = r0.nxt(button=1, pips=[6, 2], stacks=[394, 398])
        r2 = r1.nxt(button=1, street=2, pips=[0, 0], stacks=[394, 394], board=["Kh", "8d", "2s"])
        r3 = r2.nxt(button=0, board=["Kh", "8d", "2s", "9c"])            # BB discarded 9c face up
        self.assertEqual(r3.legal_actions(), {Check})                    # our placeholder turn
        self.assertIsInstance(self.p.get_action(gs, r3, 0), Check)
        r4 = r3.nxt(button=0, street=3)                                  # our discard
        obs = self.p._observation(gs, r4, 0)
        self.assertEqual((obs.phase, obs.legal.discard_count, obs.street), ("discard", 1, 1))
        self.assertEqual(obs.opp_discards, (mit_adapter.parse_card("9c"),))
        kinds = [(h.position, h.kind, h.amount) for h in obs.history]
        self.assertEqual(kinds[:2], [(0, "raise", 6), (1, "call", 4)])
        a = self.p.get_action(gs, r4, 0)
        self.assertIsInstance(a, Disc)
        self.assertIn(a.card, (0, 1, 2))
        self.assertEqual(self.msgs, [])                                 # no self-check warnings

    def test_round_over_records_fold(self):
        hands = [["As", "Ad", "7c"], []]
        r0 = start(hands)
        gs = GS(0, 60.0, 1)
        self.p.handle_new_round(gs, r0, 0)
        r1 = r0.nxt(button=1, pips=[6, 2], stacks=[394, 398])            # we raise, BB to act
        got = {}
        orig = self.p.bot.end_hand
        self.p.bot.end_hand = lambda res: got.setdefault("res", res) or orig(res)
        self.p.handle_round_over(gs, TS([2, -2], r1), 0)                 # BB folded
        res = got["res"]
        self.assertFalse(res.showdown)
        self.assertEqual(res.history[-1].kind, "fold")
        self.assertEqual(res.history[-1].position, 1)

    def test_wrong_blind_mapping_is_flagged(self):
        saved = dict(mit_adapter.PROTOCOL)
        mit_adapter.PROTOCOL["sb_index"] = 1                             # the bug
        try:
            r0 = start([["As", "Ad", "7c"], []])
            self.p._observation(GS(0, 60.0, 1), r0, 0)
        finally:
            mit_adapter.PROTOCOL.clear()
            mit_adapter.PROTOCOL.update(saved)
        self.assertTrue(any("BLIND MAPPING" in m for m in self.msgs), self.msgs)


if __name__ == "__main__":
    unittest.main()
