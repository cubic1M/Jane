"""The clock, the JSON round trip, init, on_hand_end, per-table reset."""

import tempfile
import textwrap
import time
import unittest
from pathlib import Path

from helpers import agent, rig, script, table
from simkit.agent import BotAgent

CALL, FOLD, CHECK = {"action": "call"}, {"action": "fold"}, {"action": "check"}
HOLES2 = [["AS", "AD"], ["2C", "7D"]]
BOARD = ["3C", "8D", "9H", "JC", "4S"]
BIG = list(range(300_000))


def slow(seconds, reply):
    def get_action(state):
        time.sleep(seconds)
        return reply if state["type"] == "action" else {"discard": None}
    return get_action


class TestClock(unittest.TestCase):
    def test_slow_reply_is_discarded_fold_when_facing_bet(self):
        a = agent("a", slow(0.005, {"action": "call"}), enforce_time=True)
        b = agent("b", script([]))
        t = table([a, b], deck_factory=rig(HOLES2, BOARD))
        t.play_hand()
        self.assertEqual(a.stats.timeouts, 1)
        self.assertGreater(a.stats.slowest_ms, 4.0)
        self.assertEqual(t.history[2]["action"], "fold")
        self.assertTrue(t.history[2]["auto"])

    def test_slow_reply_checks_when_free(self):
        a = agent("a", script([CALL]))
        b = agent("b", slow(0.005, {"action": "raise", "amount": 500}),
                  enforce_time=True)
        t = table([a, b], deck_factory=rig(HOLES2, BOARD))
        t.play_hand()
        self.assertEqual(t.history[3]["action"], "check")
        self.assertGreaterEqual(b.stats.timeouts, 1)

    def test_clock_not_enforced(self):
        a = agent("a", slow(0.003, {"action": "call"}), enforce_time=False)
        b = agent("b", script([]))
        t = table([a, b], deck_factory=rig(HOLES2, BOARD))
        t.play_hand()
        self.assertEqual(a.stats.timeouts, 0)
        self.assertEqual(t.history[2]["action"], "call")

    def test_reply_serialisation_is_on_the_clock(self):
        # the function itself is instant; dumping the reply is not
        a = agent("a", lambda s: {"action": "call", "notes": BIG},
                  enforce_time=True)
        b = agent("b", script([]))
        t = table([a, b], deck_factory=rig(HOLES2, BOARD))
        t.play_hand()
        self.assertEqual(a.stats.timeouts, 1)
        self.assertEqual(t.history[2]["action"], "fold")

    def test_not_json_serialisable_is_an_error(self):
        class Num(int):
            pass
        replies = [{"action": "raise", "amount": {40}},
                   {"action": "raise", "amount": float("nan")},
                   {"action": "raise", "amount": object()}]
        try:
            import numpy as np
            replies.append({"action": "raise", "amount": np.int64(40)})
        except ImportError:
            pass
        for reply in replies:
            a = agent("a", lambda s, r=reply: r)
            b = agent("b", script([]))
            t = table([a, b], deck_factory=rig(HOLES2, BOARD))
            t.play_hand()
            self.assertEqual(a.stats.errors, 1, reply)
            self.assertEqual(t.history[2]["action"], "fold")

    def test_exception_is_an_error(self):
        a = agent("a", lambda s: 1 / 0)
        b = agent("b", script([]))
        t = table([a, b], deck_factory=rig(HOLES2, BOARD))
        t.play_hand()
        self.assertEqual(a.stats.errors, 1)
        self.assertIn("ZeroDivisionError", a.stats.messages[0])

    def test_bot_gets_a_copy(self):
        seen = []

        def mutate(state):
            state["players"][0]["chips_total"] = 10**9
            seen.append(state)
            return {"action": "fold"}
        a = agent("a", mutate)
        b = agent("b", script([]))
        t = table([a, b], deck_factory=rig(HOLES2, BOARD))
        t.play_hand()
        self.assertEqual(t.entrants[0].stack, 1990)


class TestInit(unittest.TestCase):
    def test_config_contents(self):
        got = {}

        def init(cfg):
            got.update(cfg)
        a = agent("a", script([FOLD]), init=init)
        b = agent("b", script([]))
        table([a, b]).play_hand()
        self.assertEqual(got["starting_stack"], 2000)
        self.assertEqual(got["blind_schedule"][3],
                         {"level": 4, "small_blind": 50, "big_blind": 100,
                          "ante": 10})
        self.assertTrue(got["draw_after_flop"])
        self.assertEqual(got["time_limit_ms"], 1.0)

    def test_slow_init_sits_out(self):
        calls = []
        a = agent("a", lambda s: calls.append(1) or {"action": "call"},
                  init=lambda cfg: time.sleep(0.03), enforce_time=True,
                  init_time_limit_ms=10)
        b = agent("b", script([]))
        t = table([a, b], deck_factory=rig(HOLES2, BOARD))
        t.play_hand()
        self.assertTrue(a.sitting_out)
        self.assertEqual(a.stats.init_failures, 1)
        self.assertEqual(calls, [])
        self.assertEqual(t.history[2]["action"], "fold")

    def test_init_exception_sits_out_but_checks_when_free(self):
        def boom(cfg):
            raise RuntimeError("nope")
        a = agent("a", script([]))
        b = agent("b", script([]), init=boom)
        t = table([a, b], deck_factory=rig(HOLES2, BOARD))
        t.play_hand()
        self.assertTrue(b.sitting_out)
        acts = [h for h in t.history if h["seat"] == 1
                and h["action"] not in ("small_blind", "big_blind")]
        self.assertEqual(len(acts), 5)       # 4 betting rounds + the draw
        self.assertTrue(all(h["action"] in ("check", "draw") for h in acts))
        self.assertTrue(all(h.get("auto") for h in acts))

    def test_module_state_resets_per_table(self):
        src = textwrap.dedent("""
            COUNT = 0
            SEEN = []
            def init(config):
                SEEN.append(COUNT)
            def get_action(state):
                global COUNT
                COUNT += 1
                if state["type"] == "draw":
                    return {"discard": None}
                return {"action": "fold"}
            def on_hand_end(summary):
                pass
        """)
        with tempfile.TemporaryDirectory() as d:
            path = Path(d) / "counter.py"
            path.write_text(src)
            modules = []
            for _ in range(2):
                a = BotAgent.from_file("counter", path, enforce_time=False)
                b = agent("b", script([]))
                t = table([a, b], max_hands=3)
                t.play()
                modules.append(a.module)
            self.assertIsNot(modules[0], modules[1])
            self.assertEqual(modules[1].SEEN, [0])
            self.assertGreater(modules[0].COUNT, 0)


class TestHandEnd(unittest.TestCase):
    def test_summary_has_string_keys_and_showdown(self):
        got = []
        a = agent("a", script([]), on_hand_end=got.append)
        b = agent("b", script([]))
        t = table([a, b], deck_factory=rig(HOLES2, BOARD))
        t.play_hand()
        s = got[0]
        self.assertEqual(set(s["net"]), {"0", "1"})
        self.assertEqual(s["net"]["0"], 20)
        self.assertEqual(s["chips_after"]["1"], 1980)
        self.assertEqual({x["seat"] for x in s["showdown"]}, {0, 1})
        self.assertEqual(s["my_hole_cards"], ["AS", "AD"])

    def test_on_hand_end_errors_are_counted_only(self):
        a = agent("a", script([]), on_hand_end=lambda s: 1 / 0)
        b = agent("b", script([]))
        t = table([a, b], deck_factory=rig(HOLES2, BOARD))
        t.play_hand()
        self.assertEqual(a.stats.errors, 1)
        self.assertEqual(t.entrants[0].stack, 2020)


if __name__ == "__main__":
    unittest.main()
