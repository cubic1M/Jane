import json
import random
import time
import unittest

from tests.helpers import call_any, ctrl, rigged, scripted, shove
from engine import rules
from engine.cards import DECK
from engine.table import Table


def random_bot(seed):
    rng = random.Random(seed)

    def play(view, memory):
        r = rng.random()
        if r < 0.2:
            return -1
        if r < 0.6 or view["min_add"] is None:
            return view["owe"]
        if r < 0.9:
            return view["min_add"] + rng.randrange(0, 3 * view["bb"])
        return view["max_add"]
    return play


def fold_unless_free(view, memory):
    return 0


class BlindScheduleTest(unittest.TestCase):
    def test_levels(self):
        self.assertEqual(rules.blinds_for_hand(1), (1, 10, 20))
        self.assertEqual(rules.blinds_for_hand(25), (1, 10, 20))
        self.assertEqual(rules.blinds_for_hand(26), (2, 20, 40))
        self.assertEqual(rules.blinds_for_hand(176), (8, 200, 400))
        self.assertEqual(rules.blinds_for_hand(200), (8, 200, 400))
        self.assertEqual(rules.hands_until_blinds_rise(1), 25)
        self.assertEqual(rules.hands_until_blinds_rise(25), 1)
        self.assertIsNone(rules.hands_until_blinds_rise(180))

    def test_blinds_posted_by_the_table(self):
        seen = {}
        table = Table([ctrl(fold_unless_free) for _ in range(8)], seed=3,
                      hand_logger=lambda rec: seen.setdefault(rec["hand"], rec))
        table.run()
        self.assertEqual(table.hand_no, 200)
        for hand, rec in seen.items():
            level, sb, bb = rules.blinds_for_hand(hand)
            self.assertEqual((rec["sb"], rec["bb"], rec["level"]), (sb, bb, level))
            first, second = rec["log"].split()[:2]
            self.assertTrue(first.endswith(f"s{sb}"), rec["log"])
            self.assertTrue(second.endswith(f"b{bb}"), rec["log"])

    def test_button_moves_clockwise(self):
        buttons = []
        Table([ctrl(fold_unless_free) for _ in range(8)], seed=1, max_hands=10,
              first_button=7, hand_logger=lambda r: buttons.append(r["button"])).run()
        self.assertEqual(buttons, [7, 8, 1, 2, 3, 4, 5, 6, 7, 8])


class ConservationTest(unittest.TestCase):
    def test_chips_conserved_and_points_paid(self):
        for seed in range(25):
            table = None
            checks = []

            def logger(rec):
                checks.append(sum(table.stacks.values()))
                self.assertTrue(all(v >= 0 for v in table.stacks.values()))
                self.assertEqual(sum(rec["net"]), 0)
                for cards in rec["hole"].values():
                    for c in cards:
                        self.assertIn(c, DECK)
            table = Table([ctrl(random_bot(seed * 10 + k)) for k in range(8)],
                          seed=seed, hand_logger=logger)
            res = table.run()
            self.assertTrue(all(c == 16000 for c in checks))
            self.assertAlmostEqual(sum(res["points"].values()), sum(rules.POINTS))
            places = list(res["place"].values())      # tied busts share a place
            self.assertEqual(len(places), 8)
            self.assertEqual(places.count(1), 1)

    def test_view_is_json_and_seat_indexed(self):
        def play(view, memory):
            json.dumps(view)
            assert len(view["seats"]) == 8
            assert view["seats"][view["me"] - 1]["seat"] == view["me"]
            assert view["max_add"] == view["seats"][view["me"] - 1]["stack"]
            return random.choice([-1, view["owe"], view["max_add"]])
        table = Table([ctrl(play) for _ in range(8)], seed=5, max_hands=40)
        table.run()
        self.assertEqual(sum(c.errors for c in table.ctrl.values()), 0)


class PotTest(unittest.TestCase):
    def test_side_pots(self):
        # seat 3 is the button; seat 1 SB, seat 2 BB; everybody shoves.
        deck = rigged([["Ah", "Ad"], ["Kh", "Kd"], ["7c", "8d"]],
                      ["As", "Ks", "6h", "Tc", "Jd"])
        t = Table([ctrl(shove) for _ in range(3)], stacks=[100, 300, 1000],
                  first_button=3, max_hands=1, deck_fn=deck)
        t.run()
        self.assertEqual(t.stacks, {1: 300, 2: 400, 3: 700})

    def test_short_stack_wins_main_only_and_others_split_side(self):
        deck = rigged([["Ah", "Ad"], ["Kh", "Kd"], ["Kc", "Ks"]],
                      ["As", "Qd", "6h", "Tc", "Jd"])
        t = Table([ctrl(shove) for _ in range(3)], stacks=[100, 500, 500],
                  first_button=3, max_hands=1, deck_fn=deck)
        t.run()
        self.assertEqual(t.stacks, {1: 300, 2: 400, 3: 400})

    def test_split_pot_odd_chip_goes_left_of_button(self):
        # button 4. s3 raises to 41, s4 to 100, s1 folds, s2 calls, s3 folds.
        deck = rigged([["6c", "7d"], ["8c", "9d"], ["6d", "7c"], ["8d", "9c"]],
                      ["As", "Ks", "Qs", "Js", "Ts"])
        plays = [scripted([-1]), scripted([80]), scripted([41, -1]), scripted([100])]
        t = Table([ctrl(p) for p in plays], first_button=4, max_hands=1, deck_fn=deck)
        t.run()
        self.assertEqual(t.stacks, {1: 1990, 2: 2026, 3: 1959, 4: 2025})

    def test_uncalled_bet_returned(self):
        t = Table([ctrl(shove), ctrl(fold_unless_free)], first_button=1, max_hands=1)
        t.run()
        self.assertEqual(t.stacks, {1: 2020, 2: 1980})

    def test_variant_flush_beats_full_house_at_showdown(self):
        deck = rigged([["Kc", "Kd"], ["Ah", "Jh"]], ["Ks", "7h", "7d", "9h", "6h"])
        t = Table([ctrl(shove), ctrl(shove)], first_button=2, max_hands=1, deck_fn=deck)
        res = t.run()
        self.assertEqual(t.stacks, {1: 0, 2: 4000})
        self.assertEqual(res["place"], {1: 2, 2: 1})

    def test_variant_trips_beat_straight_at_showdown(self):
        deck = rigged([["Tc", "Kd"], ["8h", "8d"]], ["8s", "Jh", "Qd", "6c", "7s"])
        t = Table([ctrl(shove), ctrl(shove)], first_button=2, max_hands=1, deck_fn=deck)
        t.run()
        self.assertEqual(t.stacks, {1: 0, 2: 4000})


class BettingTest(unittest.TestCase):
    def test_heads_up_order(self):
        logs = []
        t = Table([ctrl(call_any), ctrl(call_any)], first_button=1, max_hands=1,
                  hand_logger=lambda r: logs.append(r["log"]))
        t.run()
        toks = logs[0].split()
        self.assertEqual(toks[:4], ["1s10", "2b20", "1c10", "2k"])   # button = SB, acts first
        flop = toks.index(next(x for x in toks if x.startswith("|")))
        self.assertEqual(toks[flop + 1], "2k")                       # BB first after the flop

    def test_big_blind_option(self):
        seen = []

        def bb_bot(view, memory):
            if view["street"] == 0:
                seen.append((view["owe"], view["min_add"]))
            return 0
        t = Table([ctrl(call_any), ctrl(bb_bot), ctrl(call_any)], first_button=3,
                  max_hands=1)
        t.run()
        self.assertEqual(seen, [(0, 20)])

    def test_incomplete_all_in_raise_does_not_reopen(self):
        seen = {}

        def opener(view, memory):
            if view["street"] == 0:
                seen.setdefault("s3", []).append((view["owe"], view["min_add"]))
                return 100 if view["owe"] == 20 else view["owe"]
            return 0

        def bb(view, memory):
            if view["street"] == 0:
                seen.setdefault("s2", []).append(view["min_add"])
            return view["owe"]
        # s1 (SB) has 150: shoving makes it 150, only 50 more than 100.
        t = Table([ctrl(shove), ctrl(bb), ctrl(opener)], stacks=[150, 2000, 2000],
                  first_button=3, max_hands=1)
        t.run()
        self.assertEqual(seen["s3"], [(20, 40), (50, None)])    # may only call
        self.assertEqual(seen["s2"], [210])    # BB has not acted: may raise to 150 + 80

    def test_full_raise_reopens(self):
        seen = []

        def opener(view, memory):
            if view["street"] == 0:
                seen.append(view["min_add"])
                return 100 if view["owe"] == 20 else view["owe"]
            return 0
        # s1 shoves to 300: a full raise (+200 >= +80), so s3 may re-raise.
        t = Table([ctrl(shove), ctrl(call_any), ctrl(opener)], stacks=[300, 2000, 2000],
                  first_button=3, max_hands=1)
        t.run()
        self.assertEqual(seen, [40, 400])


class CapTest(unittest.TestCase):
    def test_hand_cap_pays_icm(self):
        t = Table([ctrl(fold_unless_free) for _ in range(8)], seed=11)
        res = t.run()
        self.assertEqual(res["hands"], rules.MAX_HANDS)
        self.assertEqual(len(res["points"]), 8)
        self.assertAlmostEqual(sum(res["points"].values()), sum(rules.POINTS))
        from engine.icm import icm
        alive = sorted(t.stacks)
        expect = icm([t.stacks[s] for s in alive], rules.POINTS)
        for s, e in zip(alive, expect):
            self.assertAlmostEqual(res["points"][s], e)
        self.assertEqual(sorted(res["place"].values()), list(range(1, 9)))

    def test_bust_places_and_ties(self):
        t = Table([ctrl(call_any) for _ in range(8)])
        t._assign_bust_places([3, 5], {3: 500, 5: 500}, remaining=5)
        self.assertEqual(t.score[3], (rules.POINTS[5] + rules.POINTS[6]) / 2)
        self.assertEqual(t.score[5], t.score[3])
        t._assign_bust_places([1, 2], {1: 300, 2: 900}, remaining=3)
        self.assertEqual((t.place[2], t.place[1]), (4, 5))
        self.assertEqual((t.score[2], t.score[1]), (rules.POINTS[3], rules.POINTS[4]))

    def test_table_ends_with_one_winner(self):
        t = Table([ctrl(shove) for _ in range(8)], seed=2)
        res = t.run()
        self.assertLess(res["hands"], rules.MAX_HANDS)
        winner = [s for s, p in res["place"].items() if p == 1]
        self.assertEqual(len(winner), 1)
        self.assertEqual(t.stacks[winner[0]], 16000)
        self.assertEqual(res["points"][winner[0]], rules.POINTS[0])


class ClockTest(unittest.TestCase):
    def slow(self, counter):
        def play(view, memory):
            counter.append(1)
            time.sleep(0.003)
            return view["owe"]
        return play

    def test_timeout_folds_even_when_check_is_free_then_benches(self):
        calls, logs = [], []
        slow = ctrl(self.slow(calls), limit_ms=1.0)
        t = Table([ctrl(call_any), slow, ctrl(call_any)], first_button=3,
                  max_hands=6, hand_logger=lambda r: logs.append(r["log"]))
        t.run()
        self.assertIn("2f!", logs[0].split())        # BB owed nothing and still folded
        self.assertEqual(len(calls), rules.BENCH_AFTER)
        self.assertEqual(slow.timeouts, rules.BENCH_AFTER)
        self.assertTrue(slow.benched)
        later = " ".join(logs[3:])
        self.assertNotIn("2c", later)

    def test_no_timeouts_mode_measures_only(self):
        calls = []
        slow = ctrl(self.slow(calls), limit_ms=1.0, enforce=False)
        Table([ctrl(call_any), slow], first_button=1, max_hands=2).run()
        self.assertEqual(slow.timeouts, 0)
        self.assertGreater(slow.max_ns, 1_000_000)

    def test_errors_and_invalid_replies_check_or_fold(self):
        def boom(view, memory):
            raise RuntimeError("bug")

        def bad(view, memory):
            return "call"
        logs = []
        b1, b2 = ctrl(boom), ctrl(bad)
        t = Table([ctrl(call_any), b1, b2], first_button=1, max_hands=1,
                  hand_logger=lambda r: logs.append(r["log"]))
        t.run()
        toks = logs[0].split()
        # order: s2 SB, s3 BB, s1 button first
        self.assertEqual(toks[:5], ["2s10", "3b20", "1c20", "2f!", "3k!"])
        self.assertEqual((b1.errors, b2.errors), (1, b2.errors))
        self.assertGreaterEqual(b2.errors, 1)
        self.assertFalse(b1.benched)


if __name__ == "__main__":
    unittest.main()
