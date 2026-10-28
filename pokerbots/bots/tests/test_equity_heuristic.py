"""Tests for the naive equity baseline (bots/equity_heuristic.py)."""
import time
import unittest

from engine.cards import parse_cards
from engine.conformance import check_bot
from engine.game import CALL, CHECK, DISCARD, FOLD, RAISE, LegalActions, Observation
from engine.match import play_match
from engine.variants import VARIANTS, get_variant

from bots.equity_heuristic import EquityHeuristicBot, make_bot, percentile, preflop_distribution
from bots.random_legal import RandomLegalBot
from bots.registry import make


def make_obs(spec, my_cards, board="", *, street=None, position=1, pot=4, my_pip=0, opp_pip=0,
             my_stack=None, opp_stack=None, legal=None, phase="bet", hand_index=0,
             bankroll=0, time_left=None, opp_num_cards=None, board_to_come=None,
             my_discards_left=0, opp_discards_left=0):
    mine = tuple(parse_cards(my_cards))
    bd = tuple(parse_cards(board)) if board else ()
    if street is None:
        street = {0: 0, 3: 1, 4: 2, 5: 3}[len(bd)]
    committed = pot // 2
    if my_stack is None:
        my_stack = spec.starting_stack - committed - (my_pip if my_pip else 0)
    if opp_stack is None:
        opp_stack = spec.starting_stack - committed - (opp_pip if opp_pip else 0)
    if board_to_come is None:
        board_to_come = sum(spec.board_cards_per_street[street + 1:])
    return Observation(
        hand_index=hand_index, hands_in_match=spec.hands_per_match, position=position,
        street=street, phase=phase, my_cards=mine, board=bd, my_discards=(), opp_discards=(),
        opp_num_cards=spec.hole_cards if opp_num_cards is None else opp_num_cards,
        pot=pot, my_pip=my_pip, opp_pip=opp_pip, my_stack=my_stack, opp_stack=opp_stack,
        my_committed=spec.starting_stack - my_stack, opp_committed=spec.starting_stack - opp_stack,
        legal=legal or LegalActions(), history=(), board_cards_to_come=board_to_come,
        my_discards_left=my_discards_left, opp_discards_left=opp_discards_left,
        bankroll=bankroll, time_left=time_left, big_blind=spec.big_blind)


A = get_variant("a")


def fresh(spec=A, seed=0):
    b = make_bot()
    b.new_match(spec, seed)
    return b


class TestEquityHeuristic(unittest.TestCase):
    def test_registry_name(self):
        b = make("equity")
        self.assertIsInstance(b, EquityHeuristicBot)
        self.assertEqual(b.name, "equity")

    def test_conformance_all_variants(self):
        probs = check_bot(lambda: make("equity"), hands=8, verbose=False)
        self.assertEqual(probs, [], "\n".join(probs))

    def test_deterministic_given_seed(self):
        for v in ("a", "c", "g"):
            spec = get_variant(v)
            runs = []
            for _ in range(2):
                r = play_match(make("equity"), RandomLegalBot(), spec, deal_seed=5,
                               bot_seeds=(3, 4), hands=25)
                runs.append(r.deltas.tolist())
            self.assertEqual(runs[0], runs[1], v)

    def test_nuts_on_river_bets_when_checked_to(self):
        b = fresh()
        lg = LegalActions(can_fold=True, can_check=True, can_raise=True, min_raise_to=2,
                          max_raise_to=180)
        obs = make_obs(A, "AsKs", "QsJsTs2h3d", pot=40, legal=lg)
        a = b.act(obs)
        self.assertEqual(a.kind, RAISE)
        self.assertTrue(lg.is_legal(a))

    def test_nuts_on_river_raises_facing_bet(self):
        b = fresh()
        lg = LegalActions(can_fold=True, can_call=True, call_amount=40, can_raise=True,
                          min_raise_to=80, max_raise_to=180)
        obs = make_obs(A, "AsKs", "QsJsTs2h3d", pot=80, opp_pip=40, my_stack=180, opp_stack=140,
                       legal=lg)
        a = b.act(obs)
        self.assertEqual(a.kind, RAISE)
        self.assertTrue(lg.is_legal(a))

    def test_trash_facing_shove_preflop_folds(self):
        b = fresh()
        lg = LegalActions(can_fold=True, can_call=True, call_amount=198)
        obs = make_obs(A, "7c2d", pot=202, my_pip=2, opp_pip=200, my_stack=198, opp_stack=0,
                       position=1, street=0, legal=lg)
        self.assertEqual(b.act(obs).kind, FOLD)

    def test_trash_facing_pot_bet_on_river_folds(self):
        b = fresh()
        lg = LegalActions(can_fold=True, can_call=True, call_amount=40, can_raise=True,
                          min_raise_to=80, max_raise_to=180)
        obs = make_obs(A, "7c2d", "AsKhQd9s4h", pot=80, opp_pip=40, my_stack=180, opp_stack=140,
                       legal=lg)
        self.assertEqual(b.act(obs).kind, FOLD)

    def test_premium_raises_preflop_every_variant(self):
        premium = {2: "AsAd", 3: "AsAdKs", 4: "AsAdKsKd"}
        for spec in VARIANTS.values():
            b = fresh(spec)
            lg = LegalActions(can_fold=True, can_call=True, call_amount=1, can_raise=True,
                              min_raise_to=4, max_raise_to=spec.starting_stack)
            obs = make_obs(spec, premium[spec.hole_cards], street=0, position=0, pot=3, my_pip=1,
                           opp_pip=2, my_stack=spec.starting_stack - 1,
                           opp_stack=spec.starting_stack - 2, legal=lg)
            a = b.act(obs)
            self.assertEqual(a.kind, RAISE, spec.name)
            self.assertTrue(lg.is_legal(a), spec.name)

    def test_percentiles_are_normalised_per_spec(self):
        for spec in VARIANTS.values():
            d = preflop_distribution(spec)
            self.assertTrue((d[1:] >= d[:-1]).all())
            self.assertLess(percentile(spec, d[len(d) // 10]), 0.2, spec.name)
            self.assertGreater(percentile(spec, d[-len(d) // 10]), 0.8, spec.name)

    def test_checks_when_free_with_weak_hand(self):
        b = fresh()
        lg = LegalActions(can_fold=True, can_check=True, can_raise=True, min_raise_to=2,
                          max_raise_to=180)
        obs = make_obs(A, "7c2d", "AsKhQd9s4h", pot=40, legal=lg)
        self.assertEqual(b.act(obs).kind, CHECK)

    def test_discard_is_legal_and_sensible(self):
        # face-down muck (pineapple): keep the aces, throw the deuce
        spec = get_variant("g")
        b = fresh(spec)
        lg = LegalActions(discard_count=1)
        obs = make_obs(spec, "AsAd2c", "Kh8d5c", street=1, pot=4, phase="discard", legal=lg,
                       my_discards_left=1, opp_discards_left=1)
        a = b.act(obs)
        self.assertEqual(a.kind, DISCARD)
        self.assertTrue(lg.is_legal(a, obs.my_cards))
        self.assertEqual(a.cards, tuple(parse_cards("2c")))
        # face-up discard to the board (c): legal, and never the worst option
        spec = get_variant("c")
        b = fresh(spec)
        obs = make_obs(spec, "AsKc2h", "Kh8d5c", street=1, pot=4, phase="discard", legal=lg,
                       my_discards_left=1, opp_discards_left=1)
        a = b.act(obs)
        self.assertTrue(lg.is_legal(a, obs.my_cards))
        self.assertNotEqual(a.cards, tuple(parse_cards("Kc")))

    def test_shrinks_work_when_clock_is_tight(self):
        b = fresh(get_variant("d"))
        spec = get_variant("d")
        lg = LegalActions(can_fold=True, can_call=True, call_amount=10, can_raise=True,
                          min_raise_to=20, max_raise_to=180)
        obs = make_obs(spec, "AsKd7h2c", "Qs9d4h", pot=30, opp_pip=10, legal=lg,
                       time_left=0.001, hand_index=10)
        t0 = time.perf_counter()
        a = b.act(obs)
        self.assertLess(time.perf_counter() - t0, 0.05)
        self.assertTrue(lg.is_legal(a))
        self.assertEqual(a.kind, FOLD)  # no-MC fallback: check if free, else fold

    def test_call_with_strong_hand_facing_small_bet(self):
        b = fresh()
        lg = LegalActions(can_fold=True, can_call=True, call_amount=10, can_raise=True,
                          min_raise_to=20, max_raise_to=180)
        # top pair top kicker on a dry flop facing a quarter-pot bet: never folds
        obs = make_obs(A, "AhKd", "Ks7c2d", pot=50, opp_pip=10, my_stack=175, opp_stack=165,
                       legal=lg)
        self.assertIn(b.act(obs).kind, (CALL, RAISE))


if __name__ == "__main__":
    unittest.main()
