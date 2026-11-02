"""Unit checks for planb_bot (draw policy, raise-by, safety, seat tracking).

    python3 -m unittest discover -s planb -p 'test_*.py'
"""

import json
import random
import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path[:0] = [str(HERE.parent), str(HERE)]

from simkit.cards import evaluate, full_deck  # noqa: E402
import planb_bot as B  # noqa: E402


def state(hole, board=(), street="preflop", kind="action", bb=20, cur=20,
          mine=0, total=2000, seat=3, n=8, history=(), pot=0, can_raise=True):
    players = []
    for s in range(n):
        p = {"seat": s, "chips_total": 2000, "chips_in_pot_this_round": 0,
             "status": "active", "drew": None}
        players.append(p)
    players[seat]["chips_total"] = total
    players[seat]["chips_in_pot_this_round"] = mine
    if street == "preflop" and n > 2:
        players[1]["chips_in_pot_this_round"] = bb // 2
        players[2]["chips_in_pot_this_round"] = bb
    return {"type": kind, "hand_number": 1, "street": street,
            "board": list(board), "hole_cards": list(hole), "my_seat": seat,
            "num_seats": n, "pot": pot, "current_bet": cur,
            "min_raise_by": bb, "can_raise": can_raise, "big_blind": bb,
            "small_blind": bb // 2, "ante": 0, "players": players,
            "history": list(history)}


class TestCategory(unittest.TestCase):
    def test_matches_kit_evaluator(self):
        d = full_deck()
        rng = random.Random(5)
        for n in (5, 6, 7):
            for _ in range(5000):
                rng.shuffle(d)
                self.assertEqual(B.category(d[:n]), evaluate(d[:n])[0])

    def test_short_board_by_rank_counts(self):
        self.assertEqual(B.category(["10H", "10D", "3C"]), 1)
        self.assertEqual(B.category(["10H", "10D", "10C"]), 3)
        self.assertEqual(B.category(["10H", "JD", "QC"]), 0)


class TestDraw(unittest.TestCase):
    def test_keeps_pocket_pair(self):
        self.assertIsNone(B.choose_discard(["AS", "AD"], ["2C", "7D", "9H"]))

    def test_keeps_two_pair(self):
        self.assertIsNone(B.choose_discard(["AS", "KD"], ["AC", "KH", "2H"]))

    def test_keeps_flush_draw_with_both(self):
        self.assertIsNone(B.choose_discard(["AH", "5H"], ["KH", "9H", "2C"]))

    def test_throws_off_suit_card_to_four_flush(self):
        self.assertEqual(B.choose_discard(["AH", "5C"], ["KH", "9H", "2H"]),
                         "5C")

    def test_nothing_throws_lowest(self):
        self.assertEqual(B.choose_discard(["10H", "3C"], ["KS", "8D", "2H"]),
                         "3C")

    def test_keeps_straight_draw_card(self):
        self.assertEqual(B.choose_discard(["9C", "2D"], ["10H", "JS", "QD"]),
                         "2D")

    def test_reply_is_valid_card_or_null(self):
        d = full_deck()
        rng = random.Random(9)
        for _ in range(2000):
            rng.shuffle(d)
            s = state(d[:2], d[2:5], street="draw", kind="draw", cur=0)
            r = B.get_action(json.loads(json.dumps(s)))
            self.assertIn(r["discard"], [None] + d[:2])

    def test_draw_error_stands_pat(self):
        self.assertEqual(B.get_action({"type": "draw", "hole_cards": ["XX"]}),
                         {"discard": None})


class TestBetting(unittest.TestCase):
    def test_short_push_is_raise_by_allin(self):
        B.init({})
        s = state(["AS", "AD"], total=150, bb=20)
        r = B.get_action(s)
        self.assertEqual(r, {"action": "raise", "amount": 150 - 20})

    def test_open_is_raise_by(self):
        B.init({})
        s = state(["AS", "KD"], seat=3)
        r = B.get_action(s)
        self.assertEqual(r["action"], "raise")
        self.assertEqual(r["amount"], 20)          # raise to 2 bb = 40

    def test_trash_folds_but_never_when_free(self):
        B.init({})
        self.assertEqual(B.get_action(state(["7S", "2D"]))["action"], "fold")
        s = state(["7S", "2D"], seat=2, mine=20)
        self.assertEqual(B.get_action(s)["action"], "check")

    def test_garbage_state_does_not_raise(self):
        self.assertEqual(B.get_action({}), {"action": "fold"})

    def test_amount_is_int(self):
        B.init({})
        s = state(["AS", "AD"], ["AH", "7C", "2D"], street="flop", cur=0,
                  pot=300, n=2, seat=1)
        r = B.get_action(s)
        self.assertEqual(r["action"], "raise")
        self.assertIs(type(r["amount"]), int)


class TestSeatTracking(unittest.TestCase):
    def test_ring_follows_button_and_knockouts(self):
        B.init({})
        # hand 1: I am seat 3 of 8; seat 5 is id 2
        B._ids(state(["2C", "3D"], seat=3))
        self.assertEqual(B._ids(state(["2C", "3D"], seat=3))(5), 2)
        B.on_hand_end({"my_seat": 3, "chips_after": {str(i): 1 for i in
                                                      range(8)},
                       "history": [], "knocked_out_seats": [4]})
        # next hand: 7 seats, button moved: I am seat 2; old id 2 is next
        # to me now (id 1 was knocked out)
        pid = B._ids(state(["2C", "3D"], seat=2, n=7))
        self.assertEqual(pid(3), 2)
        self.assertEqual(pid(2), 0)


if __name__ == "__main__":
    unittest.main()
