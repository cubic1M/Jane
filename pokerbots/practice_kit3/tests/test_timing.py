import unittest

from helpers import ScriptBot, busy, table


class SlowDecider(ScriptBot):
    def __init__(self, ms, **kw):
        super().__init__(**kw)
        self.ms = ms

    def on_action_request(self, state):
        busy(self.ms)
        return "r 999"

    def on_discard_request(self, state):
        busy(self.ms)
        return state["hole_cards"][2]


class SlowListener(ScriptBot):
    def __init__(self, ms, **kw):
        super().__init__(**kw)
        self.ms = ms

    def on_event(self, e):
        busy(self.ms)
        super().on_event(e)


class SlowInit(ScriptBot):
    def __init__(self, ms):
        busy(ms)
        super().__init__()


class Crasher(ScriptBot):
    def on_action_request(self, state):
        raise RuntimeError("boom")

    def on_hand_start(self, hand):
        raise KeyError("notification errors are counted too")


class TimingTests(unittest.TestCase):
    def test_slow_decision_times_out_to_check_or_fold(self):
        rec = {}
        slow = SlowDecider(5, record=rec)
        bots = [slow, ScriptBot(["c", "c", "c", "c"])]
        t = table(bots, enforce_time=True, time_limit_ms=1.0)
        res = t.run()
        p0 = res["players"][0]
        self.assertGreater(p0["timeouts"], 0)
        self.assertEqual(p0["errors"], 0)
        # BTN owes 10 preflop and times out -> fold, despite returning "r 999"
        self.assertEqual(t.seats[0].stack, 1990)
        self.assertGreaterEqual(p0["max_charged_ms"], 5.0)
        self.assertTrue(any("timeout" in line for line in p0["error_log"]))

    def test_timeout_when_free_is_a_check(self):
        rec = {}
        slow = SlowDecider(5, record=rec)
        # p0 BTN calls with a fast scripted bot; p1 (BB) is slow: its option -> check
        bots = [ScriptBot(["c", "c", "c", "c"]), slow]
        t = table(bots, enforce_time=True, time_limit_ms=1.0)
        t.run()
        checks = [e for e in rec["events"] if e.get("player") == "p1" and e["type"] == "check"]
        self.assertTrue(checks)
        self.assertTrue(all(e["auto"] for e in checks))

    def test_notification_time_is_charged_to_next_decision(self):
        # two blind events + the BTN action precede BB's first decision: >= 3 x 2 ms
        slow = SlowListener(2)
        bots = [ScriptBot(["c"]), slow]
        res = table(bots, enforce_time=True, time_limit_ms=4.0).run()
        p1 = res["players"][1]
        self.assertGreater(p1["timeouts"], 0)
        self.assertGreaterEqual(p1["max_charged_ms"], 4.0)
        self.assertLess(p1["max_raw_ms"], 4.0)

    def test_fast_listener_has_no_timeouts(self):
        bots = [ScriptBot(["c"] * 10), SlowListener(0)]
        res = table(bots, enforce_time=True, time_limit_ms=50.0).run()
        self.assertEqual(res["players"][1]["timeouts"], 0)

    def test_setup_over_budget_disables_bot_for_table(self):
        bots_made = []

        def slow_factory():
            b = SlowInit(30)
            bots_made.append(b)
            return b
        from engine.table import Table
        t = Table([("slow", slow_factory), ("ok", lambda: ScriptBot(["c"] * 20))], seed=3,
                  shuffle_seats=False, button_seat=0, ids=["p0", "p1"], max_hands=3,
                  setup_limit_ms=10.0, enforce_time=True)
        res = t.run()
        p0 = res["players"][0]
        self.assertTrue(p0["disabled"])
        self.assertEqual(p0["decisions"], 0)
        self.assertEqual(p0["timeouts"], 1)
        self.assertEqual(bots_made[0].record["states"], [])

    def test_no_enforcement_records_but_never_times_out(self):
        bots = [SlowDecider(3), ScriptBot(["c"] * 10)]
        res = table(bots, enforce_time=False, time_limit_ms=1.0).run()
        self.assertEqual(res["players"][0]["timeouts"], 0)
        self.assertGreater(res["players"][0]["max_charged_ms"], 1.0)

    def test_exceptions_count_as_errors_and_default(self):
        bots = [Crasher(), ScriptBot(["c"] * 10)]
        t = table(bots, enforce_time=False)
        res = t.run()
        p0 = res["players"][0]
        self.assertEqual(p0["errors"], 2)   # on_hand_start + the preflop decision
        self.assertEqual(t.seats[0].stack, 1990)   # BTN owed 10 -> fold


if __name__ == "__main__":
    unittest.main()
