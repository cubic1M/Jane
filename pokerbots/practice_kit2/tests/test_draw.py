"""The draw after the flop."""

import unittest

from helpers import agent, rig, script, table

CALL, FOLD, CHECK = {"action": "call"}, {"action": "fold"}, {"action": "check"}
SHOVE = {"action": "raise", "amount": 10**6}
BOARD = ["3C", "8D", "9H", "JC", "4S"]
HOLES = [["AS", "2D"], ["KS", "KD"], ["QH", "5C"]]


def three(draws_by_seat, deck_draws=(), replies=None, logs=None):
    logs = logs if logs is not None else {0: [], 1: [], 2: []}
    replies = replies or {}
    bots = [agent(f"s{i}", script(replies.get(i, []),
                                  draw=draws_by_seat.get(i), log=logs[i]))
            for i in range(3)]
    t = table(bots, deck_factory=rig(HOLES, BOARD, draws=deck_draws))
    t.play_hand()
    return t, logs


class TestDraw(unittest.TestCase):
    def test_replacement_comes_from_deck_and_hand_improves(self):
        t, logs = three({0: {"discard": "2D"}}, deck_draws=["AD"])
        # seat 0 drew the first replacement card (AD): aces beat kings
        self.assertEqual(t.last_hand["holes"][0], ["AS", "AD"])
        self.assertEqual(t.last_hand["dead"], ["2D"])
        self.assertEqual(t.last_hand["board"], BOARD)
        self.assertEqual(t.entrants[0].stack, 2040)
        later = [s for s in logs[0] if s["street"] in ("turn", "river")]
        self.assertTrue(later)
        self.assertEqual(later[0]["hole_cards"], ["AS", "AD"])

    def test_draw_request_shape_and_order(self):
        t, logs = three({1: {"discard": "KD"}, 2: {"discard": None}},
                        deck_draws=["AD"])
        reqs = {i: [s for s in logs[i] if s["type"] == "draw"] for i in range(3)}
        for i in range(3):
            self.assertEqual(len(reqs[i]), 1)
            r = reqs[i][0]
            self.assertEqual(r["street"], "draw")
            self.assertEqual(len(r["board"]), 3)
            self.assertFalse(r["can_raise"])
        # seat 1 decides first, then 2, then the button
        self.assertEqual(reqs[1][0]["players"][2]["drew"], None)
        self.assertEqual(reqs[2][0]["players"][1]["drew"], 1)
        self.assertEqual(reqs[0][0]["players"][1]["drew"], 1)
        self.assertEqual(reqs[0][0]["players"][2]["drew"], 0)
        draws = [h for h in t.history if h["street"] == "draw"]
        self.assertEqual([(h["seat"], h["amount"]) for h in draws],
                         [(1, 1), (2, 0), (0, 0)])
        # nobody sees which card was thrown away
        self.assertNotIn("KD", str(reqs[0][0]))

    def test_invalid_discard_stands_pat(self):
        for bad in ({"discard": "TH"}, {"discard": "10h"}, {"discard": "AH"},
                    {"discard": 0}, {"action": "fold"}, {"discard": ["AS"]}):
            t, _ = three({0: bad})
            self.assertEqual(t.last_hand["holes"][0], ["AS", "2D"], bad)
            self.assertEqual(t.entrants[0].agent.stats.errors, 1, bad)
            self.assertNotEqual(t.hp[0].status, "folded", bad)

    def test_ten_discard_by_full_name(self):
        holes = [["10S", "2D"], ["KS", "KD"], ["QH", "5C"]]
        bots = [agent("s0", script([], draw={"discard": "10S"})),
                agent("s1", script([])), agent("s2", script([]))]
        t = table(bots, deck_factory=rig(holes, BOARD, draws=["AD"]))
        t.play_hand()
        self.assertEqual(t.last_hand["holes"][0], ["AD", "2D"])

    def test_all_in_players_still_draw(self):
        logs = {0: [], 1: [], 2: []}
        t, logs = three({0: {"discard": "2D"}}, deck_draws=["AD"],
                        replies={0: [SHOVE], 1: [CALL], 2: [FOLD]}, logs=logs)
        draw_reqs = [s for s in logs[0] if s["type"] == "draw"]
        self.assertEqual(len(draw_reqs), 1)
        self.assertEqual(draw_reqs[0]["players"][0]["status"], "allin")
        self.assertEqual(t.last_hand["holes"][0], ["AS", "AD"])
        self.assertEqual(t.entrants[0].stack, 4020)

    def test_no_draw_when_hand_ends_on_flop(self):
        logs = {0: [], 1: [], 2: []}
        bet = {"action": "raise", "amount": 100}
        t, logs = three({}, replies={1: [CALL, bet], 2: [CHECK, FOLD],
                                     0: [CALL, FOLD]}, logs=logs)
        self.assertFalse(any(s["type"] == "draw"
                             for i in logs for s in logs[i]))
        self.assertEqual(len(t.last_hand["board"]), 3)

    def test_draw_counts_as_a_timed_decision(self):
        t, _ = three({})
        self.assertEqual(t.entrants[0].agent.stats.decisions,
                         sum(1 for h in t.history if h["seat"] == 0
                             and h["action"] not in ("small_blind",
                                                     "big_blind", "ante")))


if __name__ == "__main__":
    unittest.main()
