import time
import unittest

from engine.bot import Bot
from engine.cards import parse_cards
from engine.game import (CALL, CHECK, DISCARD, FOLD, RAISE, Action, Call, Check, Discard, Fold,
                         HandState, RaiseTo)
from engine.match import deal_order, play_match
from engine.spec import DiscardRule, GameSpec
from engine.variants import VARIANTS

STD = GameSpec("std", starting_stack=200)


class Script:
    """decide() function from a list of (position, action) expectations."""

    def __init__(self, steps):
        self.steps = list(steps)
        self.obs = []

    def __call__(self, pos, obs):
        self.obs.append(obs)
        want_pos, action = self.steps.pop(0)
        assert pos == want_pos, f"expected position {want_pos} to act, got {pos}"
        if callable(action):
            action = action(obs)
        legal = obs.legal
        ok = legal.is_legal(action, obs.my_cards) if obs.phase == "discard" else legal.is_legal(action)
        return action if ok else Fold()


def deck(s, spec=STD):
    """Deck order: given cards first, rest of deck after."""
    first = parse_cards(s)
    return first + [c for c in spec.deck if c not in first]


class TestBetting(unittest.TestCase):
    def test_blinds_and_preflop_order(self):
        sc = Script([(0, Call()), (1, Check()), (1, Check()), (0, Check()),
                     (1, Check()), (0, Check()), (1, Check()), (0, Check())])
        h = HandState(STD, deck("AsAd KcKd 2h3h4h 5c 9d"))
        d = h.play(sc)
        o = sc.obs[0]
        self.assertEqual((o.my_pip, o.opp_pip, o.pot, o.legal.call_amount), (1, 2, 3, 1))
        self.assertEqual(o.legal.min_raise_to, 4)
        self.assertEqual(o.legal.max_raise_to, 200)
        self.assertTrue(h.showdown)
        self.assertEqual(d, [2, -2])  # aces win the limped pot

    def test_fold_payoff(self):
        h = HandState(STD, deck("AsAd KcKd"))
        self.assertEqual(h.play(Script([(0, Fold())])), [-1, 1])
        h = HandState(STD, deck("AsAd KcKd"))
        self.assertEqual(h.play(Script([(0, RaiseTo(6)), (1, Fold())])), [2, -2])

    def test_min_raise_tracks_last_raise(self):
        def check_min(expected):
            def f(obs):
                assert obs.legal.min_raise_to == expected, (obs.legal, expected)
                return Fold()
            return f
        # SB raises to 6 (raise of 4); BB min re-raise is to 10; SB min 4-bet after 3-bet to 20 is 34
        sc = Script([(0, RaiseTo(6)), (1, RaiseTo(20)), (0, check_min(34))])
        HandState(STD, deck("AsAd KcKd")).play(sc)
        # postflop: a first bet's minimum is the big blind
        sc = Script([(0, Call()), (1, Check()), (1, check_min(2))])
        HandState(STD, deck("AsAd KcKd")).play(sc)

    def test_illegal_raise_is_fold(self):
        h = HandState(STD, deck("AsAd KcKd"))
        self.assertEqual(h.play(Script([(0, RaiseTo(3))])), [-1, 1])
        h = HandState(STD, deck("AsAd KcKd"))
        self.assertEqual(h.play(Script([(0, RaiseTo(201))])), [-1, 1])
        h = HandState(STD, deck("AsAd KcKd"))
        self.assertEqual(h.play(Script([(0, Check())])), [-1, 1])  # check facing a bet

    def test_all_in_and_runout(self):
        sc = Script([(0, RaiseTo(200)), (1, Call())])
        h = HandState(STD, deck("AsAd KcKd 2h3h4h 5c 9d"))
        self.assertEqual(h.play(sc), [200, -200])
        self.assertEqual(len(h.board), 5)
        # all-in call leaves no more decisions; facing all-in cannot raise
        sc = Script([(0, RaiseTo(200)), (1, lambda o: (self.assertFalse(o.legal.can_raise), Fold())[1])])
        HandState(STD, deck("AsAd KcKd")).play(sc)

    def test_split_pot(self):
        sc = Script([(0, RaiseTo(200)), (1, Call())])
        h = HandState(STD, deck("2c3c 2d3d AsKsQhJcTd 5c 9d"))
        self.assertEqual(h.play(sc), [0, 0])

    def test_effective_stack_cap_and_short_blind(self):
        h = HandState(STD, deck("AsAd KcKd"), stacks=[50, 300])
        sc = Script([(0, lambda o: (self.assertEqual(o.legal.max_raise_to, 50), RaiseTo(50))[1]),
                     (1, lambda o: (self.assertFalse(o.legal.can_raise), Call())[1])])
        d = h.play(sc)
        self.assertEqual(abs(d[0]), 50)

    def test_pot_limit(self):
        sp = GameSpec("plo", betting="pot_limit", starting_stack=400)
        h = HandState(sp, deck("AsAd KcKd", sp))
        # SB facing 2: call 1 -> pot 4 -> max raise to 2 + 4 = 6
        sc = Script([(0, lambda o: (self.assertEqual(o.legal.max_raise_to, 6), RaiseTo(6))[1]),
                     # BB: call 4 -> pot 12 -> raise to 6 + 12 = 18
                     (1, lambda o: (self.assertEqual(o.legal.max_raise_to, 18), Fold())[1])])
        h.play(sc)

    def test_ante(self):
        sp = GameSpec("ante", ante=1)
        h = HandState(sp, deck("AsAd KcKd", sp))
        sc = Script([(0, lambda o: (self.assertEqual((o.pot, o.legal.call_amount), (5, 1)), Fold())[1])])
        self.assertEqual(h.play(sc), [-2, 2])


class TestDiscards(unittest.TestCase):
    def test_face_up_to_board(self):
        sp = VARIANTS["c_discard3"]
        h = HandState(sp, deck("AsAdAh KcKdKh 2c3c4d 5c 9d", sp))
        seen = {}

        def bb_discard(o):
            self.assertEqual(o.phase, "discard")
            self.assertEqual(len(o.board), 3)
            self.assertEqual(o.my_discards_left, 1)
            self.assertEqual(o.opp_discards_left, 1)
            return Discard([o.my_cards[0]])

        def sb_discard(o):
            seen["board"] = o.board
            seen["opp"] = o.opp_discards
            self.assertEqual(o.opp_discards_left, 0)
            return Discard([o.my_cards[2]])

        def flop_bet(o):
            self.assertEqual(o.phase, "bet")
            self.assertEqual(len(o.board), 5)
            self.assertEqual(len(o.my_cards), 2)
            self.assertEqual((o.my_discards_left, o.opp_discards_left), (0, 0))
            return Check()

        sc = Script([(0, Call()), (1, Check()), (1, bb_discard), (0, sb_discard), (1, flop_bet),
                     (0, Check()), (1, Check()), (0, Check()), (1, Check()), (0, Check())])
        h.play(sc)
        self.assertEqual(seen["opp"], (parse_cards("Kc")[0],))
        self.assertIn(parse_cards("Kc")[0], seen["board"])
        self.assertEqual(len(h.board), 7)
        self.assertTrue(h.showdown)

    def test_face_down_muck_is_hidden(self):
        sp = VARIANTS["g_pineapple"]
        h = HandState(sp, deck("AsAdAh KcKdKh 2c3c4d 5c 9d", sp))
        later = []
        sc = Script([(0, Call()), (1, Check()), (1, lambda o: Discard([o.my_cards[0]])),
                     (0, lambda o: (later.append(o), Discard([o.my_cards[0]]))[1]),
                     (1, lambda o: (later.append(o), Check())[1]), (0, Check()),
                     (1, Check()), (0, Check()), (1, Check()), (0, Check())])
        h.play(sc)
        o = later[0]
        self.assertEqual(o.opp_discards, ())
        disc = [r for r in o.history if r.kind == DISCARD]
        self.assertEqual(disc[0].cards, ())  # opponent's card hidden
        self.assertEqual(len(o.board), 3)
        own = later[1]
        self.assertEqual(own.my_discards, (parse_cards("Kc")[0],))
        self.assertEqual(len(h.board), 5)

    def test_discards_left_with_two_rules_on_one_street(self):
        # two 1-card discards on the flop: each player's count must drop as each rule is done
        sp = GameSpec("two_rules", hole_cards=4, starting_stack=200,
                      discards=(DiscardRule(1, 1, True, True, "oop_first"),
                                DiscardRule(1, 1, True, True, "oop_first")))
        seen = []

        def dec(pos, o):
            if o.phase == "discard":
                seen.append((pos, o.my_discards_left, o.opp_discards_left))
                return Discard([o.my_cards[0]])
            if o.street == 1 and not any(s[0] == "bet" for s in seen):
                seen.append(("bet", o.my_discards_left, o.opp_discards_left))
            return Check() if o.legal.can_check else Call()

        HandState(sp, deal_order(sp, 1, 0)).play(dec)
        self.assertEqual(seen, [(1, 2, 2), (0, 2, 1),   # rule 1: BB, then SB
                                (1, 1, 1), (0, 1, 0),   # rule 2: BB, then SB
                                ("bet", 0, 0)])

    def test_illegal_discard_is_fold(self):
        sp = VARIANTS["c_discard3"]
        h = HandState(sp, deck("AsAdAh KcKdKh 2c3c4d", sp))
        d = h.play(Script([(0, Call()), (1, Check()), (1, Discard(parse_cards("2c")))]))
        self.assertEqual(d, [2, -2])


class TestNoLeaks(unittest.TestCase):
    def test_observation_never_contains_opponent_cards(self):
        class Spy(Bot):
            def __init__(self):
                self.seen = []

            def act(self, obs):
                self.seen.append(obs)
                lg = obs.legal
                if lg.discard_count:
                    return Discard(obs.my_cards[:lg.discard_count])
                return Call() if lg.can_call else Check()

        for spec in VARIANTS.values():
            a, b = Spy(), Spy()
            r = play_match(a, b, spec, deal_seed=3, hands=20, record=True)
            for spy in (a, b):
                for o in spy.seen:
                    i = o.hand_index
                    st = HandState(spec, deal_order(spec, 3, i))
                    opp_pos = 1 - o.position
                    opp_hole = set(st.hole[opp_pos])
                    visible = set(o.board) | set(o.opp_discards)
                    for c in opp_hole - visible:
                        self.assertNotIn(c, o.my_cards)
                        self.assertNotIn(c, o.board)
                        for rec in o.history:
                            self.assertNotIn(c, rec.cards)


class TestMatch(unittest.TestCase):
    class Caller(Bot):
        name = "caller"

        def act(self, obs):
            lg = obs.legal
            if lg.discard_count:
                return Discard(obs.my_cards[:lg.discard_count])
            return Call() if lg.can_call else Check()

    def test_duplicate_dealing_mirrors_cards(self):
        spec = VARIANTS["a_nlhe100"]
        r1 = play_match(self.Caller(), self.Caller(), spec, deal_seed=5, hands=50, record=True)
        r2 = play_match(self.Caller(), self.Caller(), spec, deal_seed=5, hands=50, record=True)
        for l1, l2 in zip(r1.logs, r2.logs):
            self.assertEqual(l1["cards"], l2["cards"])
        # identical deterministic bots: bot A's duplicate total (seat 0 in r1, seat 1 in r2) is 0
        self.assertEqual(r1.total - r2.total, 0)

    def test_positions_alternate_and_chips_conserved(self):
        spec = VARIANTS["c_discard3"]
        from bots.random_legal import RandomLegalBot
        r = play_match(RandomLegalBot(), RandomLegalBot(), spec, deal_seed=8, hands=300, record=True)
        for l in r.logs:
            self.assertEqual(l["button_seat"], l["hand"] % 2)
            self.assertLessEqual(abs(l["delta_seat0"]), spec.starting_stack)
        self.assertEqual(r.hands_played, 300)

    def test_errors_and_timeouts_fold(self):
        class Boom(Bot):
            name = "boom"

            def act(self, obs):
                raise RuntimeError("bug")

        class Slow(Bot):
            name = "slow"

            def act(self, obs):
                time.sleep(0.03)
                return Call() if obs.legal.can_call else Check()

        spec = VARIANTS["a_nlhe100"]
        r = play_match(Boom(), self.Caller(), spec, deal_seed=1, hands=10)
        self.assertEqual(r.stats[0].errors, r.stats[0].decisions)
        self.assertLess(r.total, 0)
        r = play_match(Slow(), self.Caller(), spec.with_(time_per_decision=0.01), deal_seed=1, hands=6)
        self.assertEqual(r.stats[0].timeouts, r.stats[0].decisions)
        self.assertLess(r.total, 0)

    def test_match_clock_runs_out(self):
        class Slow(Bot):
            name = "slow"

            def act(self, obs):
                time.sleep(0.02)
                return Call() if obs.legal.can_call else Check()

        spec = VARIANTS["a_nlhe100"].with_(time_per_match=0.1)
        r = play_match(Slow(), self.Caller(), spec, deal_seed=1, hands=40)
        self.assertGreater(r.stats[0].clock_outs, 10)

    def test_non_reset_stacks_end_on_bust(self):
        class Shove(Bot):
            name = "shove"

            def act(self, obs):
                lg = obs.legal
                return RaiseTo(lg.max_raise_to) if lg.can_raise else (Call() if lg.can_call else Check())

        spec = VARIANTS["a_nlhe100"].with_(stack_reset_per_hand=False)
        r = play_match(Shove(), Shove(), spec, deal_seed=2, hands=200)
        self.assertLess(r.hands_played, 200)
        self.assertEqual(abs(r.total), spec.starting_stack)


class TestSpecValidation(unittest.TestCase):
    def test_bad_specs_rejected(self):
        with self.assertRaises(ValueError):
            GameSpec("x", players_per_hand=3)
        with self.assertRaises(ValueError):
            GameSpec("x", hole_cards=2, discards=(DiscardRule(street=1, count=3),))
        with self.assertRaises(ValueError):
            GameSpec("x", hole_usage="exactly", hole_exact=3)
        with self.assertRaises(ValueError):
            GameSpec("x", discards=(DiscardRule(street=1, to_board=True, face_up=False),))

    def test_all_variants_valid(self):
        for v in VARIANTS.values():
            v.validate()
            self.assertGreaterEqual(v.final_hole_cards + v.final_board_cards, 5)


if __name__ == "__main__":
    unittest.main()
