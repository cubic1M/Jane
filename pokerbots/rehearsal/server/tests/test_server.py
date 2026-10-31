"""Tests for the rehearsal server. Run from rehearsal/server:  python3 -m unittest discover -s tests"""
import os
import random
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
SERVER = os.path.dirname(HERE)
sys.path.insert(0, SERVER)
import poker  # noqa: E402
import run_match  # noqa: E402

PY = sys.executable
EXAMPLE = f'"{PY}" "{os.path.join(SERVER, "example_bot.py")}"'
BAD = f'"{PY}" "{os.path.join(HERE, "misbehaving_bot.py")}"'


def cards(s):
    return [poker.parse_card(x) for x in s.split()]


def scripted(replies):
    """decide() that answers from per-seat scripts and records the messages it saw."""
    seen = []

    def decide(seat, msg):
        seen.append((seat, msg))
        return replies[seat].pop(0)
    return decide, seen


def random_legal(rng):
    def decide(seat, msg):
        if msg["phase"] == "discard":
            return "discard " + " ".join(rng.sample(msg["hole"], msg["discard_count"]))
        acts = msg["legal"]
        a = rng.choice(acts)
        if a == "raise":
            lo, hi = msg["raise_by"]
            return f"raise {rng.choice([lo, hi, rng.randint(lo, hi)])}"
        return a
    return decide


class TestCards(unittest.TestCase):
    def test_round_trip_and_tens(self):
        self.assertEqual(len(poker.CARD_OF), 52)
        for c in range(52):
            self.assertEqual(poker.parse_card(poker.card_str(c)), c)
        self.assertIn("10h", poker.CARD_OF)
        for bad in ("Th", "ah", "AH", "1h", "10"):
            with self.assertRaises(KeyError):
                poker.parse_card(bad)

    def test_deal_is_reproducible(self):
        self.assertEqual(poker.shuffled_deck(5, 9), poker.shuffled_deck(5, 9))
        self.assertNotEqual(poker.shuffled_deck(5, 9), poker.shuffled_deck(5, 10))
        self.assertEqual(sorted(poker.shuffled_deck(1, 1)), list(range(52)))


class TestEvaluator(unittest.TestCase):
    def test_category_order(self):
        hands = ["2s 3s 4s 5s 6s", "9h 9d 9c 9s 2d", "Kh Kd Ks 4c 4d", "2h 7h 9h Jh Kh",
                 "6d 7c 8h 9s 10s", "Qh Qd Qs 3c 9d", "Jh Jd 5s 5c Ad", "Ah Ad 4s 7c 9d",
                 "Ah Kd 4s 7c 9d"]
        values = [poker.rank5(cards(h)) for h in hands]
        self.assertEqual([v[0] for v in values], list(range(8, -1, -1)))
        self.assertEqual(values, sorted(values, reverse=True))

    def test_wheel_and_broadway(self):
        wheel = poker.rank5(cards("Ah 2d 3s 4c 5d"))
        six_high = poker.rank5(cards("2d 3s 4c 5d 6h"))
        broadway = poker.rank5(cards("10h Jd Qs Kc Ad"))
        self.assertEqual(wheel[0], 4)
        self.assertLess(wheel, six_high)
        self.assertGreater(broadway, six_high)
        self.assertEqual(poker.rank5(cards("Qh Kd As 2c 3d"))[0], 0)   # no wrap-around

    def test_kickers_and_best_of_seven(self):
        self.assertGreater(poker.rank5(cards("Ah Ad Ks 7c 2d")), poker.rank5(cards("As Ac Qs 7d 2h")))
        board = cards("Ks Qs Js 2d 2c")
        self.assertEqual(poker.best_hand(cards("As 10s") + board)[0], 8)
        self.assertEqual(poker.best_hand(cards("3h 4h") + board), poker.best_hand(cards("5h 6h") + board))


class TestHand(unittest.TestCase):
    def deck(self, seat0, seat1, runout):
        used = cards(seat0) + cards(seat1) + cards(runout)
        return used + [c for c in range(52) if c not in used]

    def test_blinds_order_and_fold(self):
        decide, seen = scripted({1: ["fold"], 0: []})
        h = poker.Hand(1, poker.shuffled_deck(0, 1))
        self.assertEqual(h.play(decide), [5, -5])
        seat, msg = seen[0]
        self.assertEqual(seat, 1)                    # the dealer acts first preflop
        self.assertEqual(msg["bets"], [10, 5])       # seat 0 posted the big blind
        self.assertEqual(msg["to_call"], 5)
        self.assertEqual(msg["raise_by"], [10, 20])  # pot limit: 15 in the pot + 5 to call
        self.assertEqual(msg["stacks"], [1490, 1495])
        self.assertEqual(h.illegal, [])

    def test_raise_is_by_and_postflop_order(self):
        d = self.deck("Ah Ad 2c 3c", "Kh Kd 2d 3d", "7s 8s 9h 4c 5h")
        decide, seen = scripted({
            1: ["raise 20", "discard 2d 3d", "check", "check", "check"],
            0: ["call", "discard 2c 3c", "check", "check", "check"]})
        h = poker.Hand(1, d)
        self.assertEqual(h.play(decide), [30, -30])
        _, after_raise = seen[1]
        self.assertEqual(after_raise["bets"], [10, 30])      # raise BY 20 over the call = 30 total
        self.assertEqual(after_raise["to_call"], 20)
        self.assertEqual(after_raise["raise_by"], [20, 60])  # pot 40 + 20 to call
        order = [(s, m["phase"]) for s, m in seen[2:5]]
        self.assertEqual(order, [(1, "discard"), (0, "discard"), (0, "bet")])
        seat, bb_discard = seen[3]
        self.assertEqual(bb_discard["discards"], [[], ["2d", "3d"]])  # sees the dealer's discards
        self.assertEqual(bb_discard["board"], ["7s", "8s", "9h"])     # discards are not board cards
        self.assertEqual(h.board, cards("7s 8s 9h 4c 5h"))

    def test_illegal_actions_fold(self):
        for bad in ("check", "raise 9", "raise 41", "raise", "bet 10", "raise 15.0", "", None):
            decide, _ = scripted({1: ["raise 10"], 0: []})
            h = poker.Hand(1, poker.shuffled_deck(0, 2))
            decide2 = (lambda s, m, b=bad: decide(s, m) if s == 1 else b)
            self.assertEqual(h.play(decide2), [-10, 10], bad)
            self.assertEqual(h.folded, 0)
        # "check" when facing a bet is illegal too
        h = poker.Hand(1, poker.shuffled_deck(0, 3))
        self.assertEqual(h.play(lambda s, m: "check"), [5, -5])

    def test_illegal_discard_forfeits(self):
        d = self.deck("Ah Ad 2c 3c", "Kh Kd 2d 3d", "7s 8s 9h 4c 5h")
        for bad in ("discard 2d", "discard 2d 2d", "discard 2c 3c", "discard 2d 3d Kh",
                    "discard Td 3d", "check"):
            decide, _ = scripted({1: ["call", bad], 0: ["check"]})
            h = poker.Hand(1, list(d))
            self.assertEqual(h.play(decide), [10, -10], bad)

    def test_all_in_preflop_still_discards(self):
        seen = []

        def maniac(seat, msg):
            seen.append(msg["phase"])
            if msg["phase"] == "discard":
                return "discard " + " ".join(msg["hole"][:2])
            return f"raise {msg['raise_by'][1]}" if msg["raise_by"] else "call"
        h = poker.Hand(1, poker.shuffled_deck(4, 4))
        d = h.play(maniac)
        self.assertEqual(h.stacks, [0, 0])
        self.assertTrue(h.showdown)
        self.assertEqual(seen.count("discard"), 2)
        self.assertIn(abs(d[0]), (0, 1500))

    def test_random_play_conserves_chips(self):
        rng = random.Random(7)
        for i in range(3000):
            h = poker.Hand(i, poker.shuffled_deck(11, i))
            d = h.play(random_legal(rng))
            self.assertEqual(sum(d), 0)
            self.assertEqual(h.illegal, [])
            self.assertLessEqual(abs(d[0]), poker.STACK)
            self.assertTrue(all(s >= 0 for s in h.stacks))
            if h.showdown:
                self.assertEqual(h.committed[0], h.committed[1])
                self.assertEqual(len(h.board), 5)
                self.assertEqual([len(x) for x in h.hole], [2, 2])


class TestMatch(unittest.TestCase):
    def run_match(self, bot1, bot2, hands, **kw):
        with tempfile.TemporaryDirectory() as tmp:
            r = run_match.play_match(bot1, bot2, hands, 1, os.path.join(tmp, "m.log"), **kw)
            with open(r["log"]) as f:
                r["text"] = f.read()
        self.assertEqual(sum(r["score"]), 0)
        return r

    def test_example_vs_example(self):
        r = self.run_match(EXAMPLE + " 1", EXAMPLE + " 2", 200)
        for st in r["stats"]:
            self.assertEqual((st["timeouts"], st["illegal"], st["auto"], st["stray_lines"]), (0, 0, 0, 0))
        self.assertEqual(r["text"].count("Hand "), 200)

    def test_garbage_bot_folds_everything(self):
        r = self.run_match(BAD + " garbage", EXAMPLE, 20)
        self.assertEqual(r["stats"][0]["illegal"], 20)
        self.assertLess(r["score"][0], 0)
        self.assertIn("ILLEGAL", r["text"])

    def test_timeouts_fold_and_clock_runs_out(self):
        r = self.run_match(BAD + " sleep 0.4", EXAMPLE, 30, action_timeout=0.2, time_bank=3.0)
        st = r["stats"][0]
        self.assertGreater(st["timeouts"], 0)
        self.assertGreater(st["auto"], 0)              # bank exhausted -> auto check/fold
        self.assertLessEqual(r["clock_left"][0], 0)
        self.assertIn("TIMEOUT", r["text"])

    def test_crash_and_silent_and_chatty(self):
        r = self.run_match(BAD + " crash", BAD + " silent", 20, startup_grace=1.0)
        self.assertGreater(r["stats"][0]["auto"], 0)
        self.assertIn("bot2 handshake MISSING", r["text"])
        r = self.run_match(BAD + " chatty", EXAMPLE, 20)
        self.assertGreater(r["stats"][0]["illegal"], 0)

    def test_maniac_all_ins(self):
        r = self.run_match(BAD + " maniac", BAD + " maniac", 20)
        self.assertTrue(all(st["illegal"] == 0 and st["timeouts"] == 0 for st in r["stats"]))
        # pot-limit raises BY: 20 (to 30), 60 (to 90), 180, 540, then all-in for the last 690
        self.assertIn("raise 540\n  bot1: raise 690\n  bot2: call\n  bot1: discard", r["text"])


if __name__ == "__main__":
    unittest.main()
