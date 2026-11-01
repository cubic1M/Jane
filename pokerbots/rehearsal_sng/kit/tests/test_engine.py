import io
import os
import random
import unittest

from helpers import (
    KIT_DIR, BadReturnBot, CallBot, CrashBot, SlowBot, instance, script,
)
import config
import run_local
from engine import HandLog, Table, build_pots
from table_api import (
    ACTIVE, ALLIN, ANTE, BIG_BLIND, FLOP, FOLDED, OUT, PREFLOP, RAISE, SMALL_BLIND,
    Action,
)

NO_ANTE = [(10, 20, 0)]
LOSE_BOARD = ["6c", "7d", "8h", "Tc", "Js"]


def sample_classes():
    return {name: run_local.load_bot_class(path) for name, path in run_local.SAMPLE_BOTS.items()}


class ScheduleTests(unittest.TestCase):
    def test_levels_change_every_25_hands(self):
        self.assertEqual(config.level_for_hand(1), 1)
        self.assertEqual(config.level_for_hand(25), 1)
        self.assertEqual(config.level_for_hand(26), 2)
        self.assertEqual(config.level_for_hand(51), 3)
        self.assertEqual(config.level_for_hand(200), 8)
        self.assertEqual(config.level_for_hand(250), 8)
        self.assertEqual(config.blinds_for_hand(51), (25, 50, 5))

    def test_points_table_order(self):
        self.assertEqual(config.points_for_place(1), 100)
        self.assertEqual(config.points_for_place(8), 0)
        self.assertEqual(sum(config.POINTS_BY_FINISH), 300)


class PotTests(unittest.TestCase):
    def test_build_pots_layers(self):
        pots = build_pots([100, 200, 20, 200], live=[0, 1, 3])
        self.assertEqual(pots, [(320, [0, 1, 3]), (200, [1, 3])])

    def test_build_pots_single_layer(self):
        self.assertEqual(build_pots([50, 50, 50], [0, 2]), [(150, [0, 2])])


class ChipConservationTests(unittest.TestCase):
    def test_random_tables_conserve_chips_and_hand_out_all_points(self):
        classes = sample_classes()
        kinds = ["random", "tight", "pusher", "caller"]
        rng = random.Random(7)
        for t in range(12):
            factories = [classes[kinds[(t + i) % 4]] for i in range(8)]
            table = Table(factories, seed=rng.randrange(10**9), button=rng.randrange(8))
            while not table.finished:
                table.play_hand()
                self.assertEqual(sum(table.stacks), 8 * config.STARTING_STACK)
                self.assertTrue(all(s >= 0 for s in table.stacks))
            res = table.result()
            self.assertAlmostEqual(sum(r.points for r in res.seats), 300.0, places=6)
            self.assertTrue(all(r.place is not None for r in res.seats))
            for r in res.seats:
                self.assertEqual(r.stats.errors, 0)
            # competition ranking: tied seats share the best of their places
            places = [r.place for r in res.seats]
            if res.ended_by == "winner":
                self.assertEqual(places.count(1), 1)
            for p in set(places):
                self.assertEqual(sum(1 for q in places if q < p), p - 1, places)
            if res.ended_by != "winner":
                self.assertEqual(res.hands_played, config.MAX_HANDS)

    def test_tables_with_antes_conserve_chips(self):
        classes = sample_classes()
        table = Table([classes["random"]] * 8, seed=3, blind_levels=[(50, 100, 25)])
        while not table.finished:
            table.play_hand()
            self.assertEqual(sum(table.stacks), 16000)


class SidePotTests(unittest.TestCase):
    def test_three_way_all_in_with_uncalled_excess(self):
        f0 = script(Action.raise_(100))
        f1 = script(Action.raise_(300))
        f2 = script(Action.raise_(500))
        table = Table([f0, f1, f2], stacks=[100, 300, 500], button=0, blind_levels=NO_ANTE)
        table.play_hand(hole={0: ("As", "Ad"), 1: ("Ks", "Kd"), 2: ("Qs", "Qd")}, board=LOSE_BOARD)
        self.assertEqual(table.stacks, [300, 400, 200])

    def test_side_pot_with_folded_contributor(self):
        f0 = script(Action.call())
        f1 = script(Action.call())
        f2 = script(Action.fold())
        f3 = script(Action.raise_(200))
        table = Table([f0, f1, f2, f3], stacks=[100, 1000, 1000, 1000], button=0,
                      blind_levels=NO_ANTE)
        table.play_hand(hole={0: ("As", "Ad"), 1: ("8c", "8d"), 2: ("9c", "9d"), 3: ("Ks", "Kd")},
                        board=["6h", "7s", "Jc", "Td", "Qh"])
        self.assertEqual(table.stacks, [320, 800, 980, 1000])

    def test_odd_chip_goes_left_of_button(self):
        table = Table([CallBot] * 3, stacks=[1000] * 3, button=0, blind_levels=[(10, 20, 5)])
        table.play_hand(hole={0: ("Qc", "Qd"), 1: ("Qh", "6c"), 2: ("8c", "6d")},
                        board=["As", "Ad", "Kh", "Kd", "7c"])
        self.assertEqual(table.stacks, [1012, 1013, 975])

    def test_uncalled_raise_is_returned(self):
        table = Table([script(Action.raise_(100)), script(Action.fold())],
                      stacks=[1000, 1000], button=0, blind_levels=NO_ANTE)
        table.play_hand()
        self.assertEqual(table.stacks, [1020, 980])


class TimingAndErrorTests(unittest.TestCase):
    def test_slow_bot_folds_when_facing_a_bet(self):
        table = Table([SlowBot, CallBot], stacks=[1000, 1000], button=0, blind_levels=NO_ANTE)
        table.play_hand()
        self.assertEqual(table.stacks, [990, 1010])
        self.assertEqual(table.stats[0].timeouts, 1)
        self.assertEqual(table.stats[0].decisions, 1)
        self.assertGreater(table.stats[0].max_ms, 1.0)

    def test_slow_bot_checks_when_free(self):
        caller = CallBot()
        table = Table([instance(caller), SlowBot], stacks=[1000, 1000], button=0,
                      blind_levels=NO_ANTE)
        table.play_hand()
        st = table.stats[1]
        self.assertEqual(st.decisions, 4)       # preflop option + three streets
        self.assertEqual(st.timeouts, 4)
        flop_obs = [o for o in caller.seen if o.street == FLOP]
        self.assertEqual(flop_obs[0].players[1].status, ACTIVE)
        self.assertEqual(sum(table.stacks), 2000)

    def test_limit_is_configurable(self):
        table = Table([SlowBot, CallBot], stacks=[1000, 1000], button=0, blind_levels=NO_ANTE,
                      time_limit_ms=100.0)
        table.play_hand()
        self.assertEqual(table.stats[0].timeouts, 0)
        self.assertIn(table.stacks, ([0, 2000], [2000, 0], [1000, 1000]))

    def test_exception_folds(self):
        table = Table([CrashBot, CallBot], stacks=[1000, 1000], button=0, blind_levels=NO_ANTE)
        table.play_hand()
        self.assertEqual(table.stacks, [990, 1010])
        self.assertEqual(table.stats[0].errors, 1)
        self.assertIn("boom", table.stats[0].first_error)

    def test_bad_return_values_fold(self):
        for value in ("call", None, ("raise", 100), Action("bet", 100), Action(RAISE, "lots")):
            table = Table([instance(BadReturnBot(value)), CallBot], stacks=[1000, 1000],
                          button=0, blind_levels=NO_ANTE)
            table.play_hand()
            self.assertEqual(table.stacks, [990, 1010], value)
            self.assertEqual(table.stats[0].errors, 1, value)

    def test_float_raise_amount_is_truncated(self):
        f0 = script(Action.raise_(75.9), Action.fold())
        table = Table([f0, script(Action.raise_(200))], stacks=[1000, 1000], button=0,
                      blind_levels=NO_ANTE)
        table.play_hand()
        self.assertEqual(table.stacks, [925, 1075])

    def test_failed_init_auto_folds(self):
        def broken():
            raise ValueError("no")
        table = Table([broken, CallBot], stacks=[1000, 1000], button=0, blind_levels=NO_ANTE)
        self.assertTrue(table.stats[0].init_failed)
        table.play_hand()
        self.assertEqual(table.stacks, [990, 1010])


class ActionRuleTests(unittest.TestCase):
    def test_check_facing_bet_is_a_fold(self):
        table = Table([script(Action.check()), CallBot], stacks=[1000, 1000], button=0,
                      blind_levels=NO_ANTE)
        table.play_hand()
        self.assertEqual(table.stacks, [990, 1010])
        self.assertEqual(table.stats[0].errors, 0)

    def test_raise_amount_is_raise_to_and_small_raises_are_clamped(self):
        f0 = script(Action.raise_(25))
        f1 = script(Action.fold())
        table = Table([f0, f1], stacks=[1000, 1000], button=0, blind_levels=NO_ANTE)
        table.play_hand()
        obs = f1.instances[0].seen[0]
        raise_event = obs.history[-1]
        self.assertEqual((raise_event.kind, raise_event.amount), (RAISE, 40))
        self.assertEqual(obs.to_call, 20)
        self.assertEqual(obs.players[0].committed, 40)
        self.assertEqual(obs.players[0].stack, 960)

    def test_raise_above_stack_is_all_in(self):
        f0 = script(Action.raise_(10**9))
        f1 = script(Action.call())
        table = Table([f0, f1], stacks=[300, 1000], button=0, blind_levels=NO_ANTE)
        table.play_hand(hole={0: ("As", "Ad"), 1: ("Ks", "Kd")}, board=LOSE_BOARD)
        self.assertEqual(table.stacks, [600, 700])

    def test_short_all_in_does_not_reopen_raising(self):
        f0 = script(Action.raise_(40), Action.raise_(500))
        f1 = script(Action.call())
        f2 = script(Action.raise_(50))
        table = Table([f0, f1, f2], stacks=[1000, 1000, 50], button=0, blind_levels=NO_ANTE)
        table.play_hand()
        second = f0.instances[0].seen[1]
        self.assertEqual(second.street, PREFLOP)
        self.assertEqual(second.to_call, 10)
        self.assertNotIn(RAISE, second.legal_actions)
        self.assertEqual(second.min_raise_to, 0)
        self.assertEqual(second.players[2].status, ALLIN)
        sb_second = f1.instances[0].seen[1]
        self.assertEqual(sb_second.street, PREFLOP)
        self.assertNotIn(RAISE, sb_second.legal_actions)

    def test_full_raise_reopens(self):
        f0 = script(Action.raise_(40))
        f1 = script(Action.call())
        f2 = script(Action.raise_(100))
        table = Table([f0, f1, f2], stacks=[1000, 1000, 100], button=0, blind_levels=NO_ANTE)
        table.play_hand()
        second = f0.instances[0].seen[1]
        self.assertIn(RAISE, second.legal_actions)
        self.assertEqual(second.min_raise_to, 160)

    def test_to_call_is_not_capped_by_stack(self):
        f0 = script(Action.raise_(800))
        f1 = script(Action.call())
        table = Table([f0, f1], stacks=[1000, 300], button=0, blind_levels=NO_ANTE)
        table.play_hand(hole={0: ("As", "Ad"), 1: ("Ks", "Kd")}, board=LOSE_BOARD)
        obs = f1.instances[0].seen[0]
        self.assertEqual(obs.to_call, 780)
        self.assertEqual(obs.players[1].stack, 280)
        self.assertNotIn(RAISE, obs.legal_actions)
        self.assertEqual(table.stacks, [1300, 0])


class PositionAndAnteTests(unittest.TestCase):
    def test_heads_up_button_posts_small_blind_and_acts_first_preflop(self):
        order = []

        class Recorder(CallBot):
            def decide(self, obs):
                order.append((obs.street, obs.seat))
                return super().decide(obs)

        table = Table([Recorder, Recorder], stacks=[1000, 1000], button=0, blind_levels=NO_ANTE)
        table.play_hand()
        self.assertEqual(order[0], (PREFLOP, 0))
        self.assertEqual(order[1], (PREFLOP, 1))
        self.assertEqual(order[2], (FLOP, 1))
        self.assertEqual(order[3], (FLOP, 0))

    def test_antes_are_dead_money_in_pot_not_committed(self):
        caller = CallBot()
        table = Table([instance(caller), CallBot, CallBot], stacks=[1000] * 3, button=0,
                      blind_levels=[(25, 50, 5)])
        table.play_hand()
        obs = caller.seen[0]
        self.assertEqual(obs.pot, 15)
        self.assertEqual(obs.to_call, 50)
        self.assertEqual(obs.players[1].committed, 25)
        self.assertEqual(obs.players[2].committed, 50)
        self.assertEqual(obs.players[0].stack, 995)
        self.assertEqual([e.kind for e in obs.history], [ANTE, ANTE, ANTE, SMALL_BLIND, BIG_BLIND])
        self.assertEqual(sum(table.stacks), 3000)

    def test_button_moves_and_busted_players_show_as_out(self):
        f0 = script(Action.raise_(10**6))
        watcher = CallBot()
        table = Table([f0, CallBot, instance(watcher)], stacks=[100, 1000, 1000], button=0,
                      blind_levels=NO_ANTE)
        table.play_hand(hole={0: ("Qs", "Qd"), 1: ("As", "Ad"), 2: ("Ks", "Kd")}, board=LOSE_BOARD)
        self.assertFalse(table.alive[0])
        self.assertEqual(table.places[0], 3)
        table.play_hand()
        self.assertEqual(table.button, 1)
        obs = watcher.seen[-1]
        self.assertEqual(len(obs.players), 3)
        self.assertEqual(obs.players[0].status, OUT)
        self.assertEqual(obs.players[0].stack, 0)
        # heads-up now: the button (seat 1) is also the small blind
        self.assertEqual(obs.small_blind_seat, 1)
        self.assertEqual(obs.big_blind_seat, 2)


class FinishTests(unittest.TestCase):
    def test_same_hand_busts_ranked_by_starting_stack(self):
        allin = Action.raise_(10**6)
        table = Table([script(allin), script(allin), script(Action.call())],
                      stacks=[100, 200, 1000], button=0, blind_levels=NO_ANTE)
        table.play_hand(hole={0: ("Ks", "Kd"), 1: ("Qs", "Qd"), 2: ("As", "Ad")}, board=LOSE_BOARD)
        res = table.result()
        self.assertEqual([r.place for r in res.seats], [3, 2, 1])
        self.assertEqual([r.points for r in res.seats], [50, 70, 100])
        self.assertEqual(res.ended_by, "winner")

    def test_equal_starting_stacks_share_places(self):
        allin = Action.raise_(10**6)
        table = Table([script(allin), script(Action.call()), script(Action.call())],
                      stacks=[150, 150, 1000], button=0, blind_levels=NO_ANTE)
        table.play_hand(hole={0: ("Ks", "Kd"), 1: ("Qs", "Qd"), 2: ("As", "Ad")}, board=LOSE_BOARD)
        res = table.result()
        self.assertEqual(res.seats[0].points, 60)
        self.assertEqual(res.seats[1].points, 60)
        self.assertEqual(res.seats[0].place, 2)

    def test_hand_cap_splits_by_icm(self):
        f0 = script(Action.raise_(300))
        table = Table([f0, CallBot, CallBot], stacks=[1000] * 3, button=0, blind_levels=NO_ANTE,
                      max_hands=1)
        table.play_hand(hole={0: ("As", "Ad"), 1: ("Ks", "Kd"), 2: ("Qs", "Qd")}, board=LOSE_BOARD)
        res = table.result()
        self.assertEqual(res.ended_by, "hand_cap")
        self.assertEqual(table.stacks, [1600, 700, 700])
        pts = [r.points for r in res.seats]
        self.assertAlmostEqual(sum(pts), 220)
        self.assertGreater(pts[0], pts[1])
        self.assertAlmostEqual(pts[1], pts[2])
        self.assertLess(pts[0], 100)
        self.assertEqual([r.place for r in res.seats], [1, 2, 2])


class LogTests(unittest.TestCase):
    def test_log_lines_have_eleven_fields(self):
        buf = io.StringIO()
        classes = sample_classes()
        table = Table([classes["random"]] * 8, seed=11, log=HandLog(buf), max_hands=20)
        table.run()
        lines = buf.getvalue().splitlines()
        self.assertTrue(lines[0].startswith("#table"))
        for line in lines[1:]:
            self.assertEqual(len(line.split("\t")), 11, line)
        events = {line.split("\t")[6] for line in lines[1:]}
        self.assertTrue({"HAND", "SB", "BB", "HOLE", "FINISH"} <= events)


class RunLocalTests(unittest.TestCase):
    def test_run_local_smoke(self):
        out = io.StringIO()
        import contextlib
        with contextlib.redirect_stdout(out):
            code = run_local.main(["--bot", os.path.join(KIT_DIR, "agent_template.py"),
                                   "--tables", "2", "--seed", "5", "--no-log"])
        self.assertEqual(code, 0)
        self.assertIn("average points", out.getvalue())
        self.assertIn("slowest decision", out.getvalue())


if __name__ == "__main__":
    unittest.main()
