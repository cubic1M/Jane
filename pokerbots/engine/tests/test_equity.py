import unittest
from itertools import combinations

import numpy as np

from engine.cards import parse_cards
from engine.equity import canonical, get_equity_model
from engine.game import Call, Check, Discard, HandState
from engine.variants import VARIANTS


class TestEquity(unittest.TestCase):
    def test_known_holdem_values(self):
        m = get_equity_model(VARIANTS["a_nlhe100"])
        rng = np.random.default_rng(0)
        aa = m.equity(parse_cards("AsAd"), (), opp_num_cards=2, board_to_come=5, n=20000, rng=rng)
        self.assertAlmostEqual(aa, 0.852, delta=0.01)
        sevdeuce = m.equity(parse_cards("7s2d"), (), opp_num_cards=2, board_to_come=5, n=20000, rng=rng)
        self.assertAlmostEqual(sevdeuce, 0.346, delta=0.01)
        kk = np.array(parse_cards("KcKh"))
        aavkk = m.equity(parse_cards("AsAd"), (), opp_num_cards=2, board_to_come=5, n=20000, rng=rng,
                         opp_sampler=lambda n, avail, r: np.tile(kk, (n, 1)))
        self.assertAlmostEqual(aavkk, 0.8126, delta=0.01)  # exact enumeration: 0.81255

    def test_river_is_exact_ish(self):
        m = get_equity_model(VARIANTS["a_nlhe100"])
        # nut straight flush on the river cannot lose
        e = m.equity(parse_cards("AhKh"), parse_cards("QhJhTh2c3d"), opp_num_cards=2, board_to_come=0, n=500)
        self.assertEqual(e, 1.0)

    def test_canonical_classes(self):
        deck = VARIANTS["a_nlhe100"].deck
        self.assertEqual(len({canonical(h) for h in combinations(deck, 2)}), 169)

    def test_discard_options_variant_c(self):
        sp = VARIANTS["c_discard3"]
        m = get_equity_model(sp)
        cards = parse_cards("AsAdAh KcKdKh 2c3c4d 5c 9d")
        deck = cards + [c for c in sp.deck if c not in cards]
        h = HandState(sp, deck)
        got = {}

        def decide(pos, obs):
            if obs.phase == "discard":
                if not got:
                    got["opts"] = m.discard_options(obs, n=200, rng=np.random.default_rng(1))
                return Discard(obs.my_cards[:1])
            return Call() if obs.legal.can_call else Check()

        h.play(decide)
        opts = got["opts"]
        self.assertEqual(len(opts), 3)
        self.assertTrue(all(0 <= e <= 1 for _, e in opts))
        self.assertGreaterEqual(opts[0][1], opts[-1][1])

    def test_preflop_equity_every_variant(self):
        for sp in VARIANTS.values():
            m = get_equity_model(sp)
            top = sp.deck[-sp.hole_cards:]
            low = sp.deck[:sp.hole_cards]
            self.assertGreater(m.preflop_equity(top, n=800), m.preflop_equity(low, n=800) - 0.02, sp.name)

    def test_symmetry(self):
        m = get_equity_model(VARIANTS["g_pineapple"])
        rng = np.random.default_rng(3)
        a, b = parse_cards("AsKsQd"), parse_cards("7c7d2h")
        ea = m.equity(a, (), opp_num_cards=3, board_to_come=5, my_discards_left=1, opp_discards_left=1,
                      discard_to_board=False, n=6000, rng=rng,
                      opp_sampler=lambda n, av, r: np.tile(np.array(b), (n, 1)))
        eb = m.equity(b, (), opp_num_cards=3, board_to_come=5, my_discards_left=1, opp_discards_left=1,
                      discard_to_board=False, n=6000, rng=rng,
                      opp_sampler=lambda n, av, r: np.tile(np.array(a), (n, 1)))
        self.assertAlmostEqual(ea + eb, 1.0, delta=0.03)


class TestMixedDiscardRules(unittest.TestCase):
    def test_bet_phase_uses_the_next_discard_rule(self):
        """Flop: discard to the muck; turn: discard to the board. During flop BETTING the
        flop rule is done, so the pending discard (turn) goes to the board."""
        from engine.spec import DiscardRule, GameSpec
        from engine.match import deal_order
        sp = GameSpec("mixed", hole_cards=4, starting_stack=200,
                      discards=(DiscardRule(1, 1, to_board=False, face_up=False),
                                DiscardRule(2, 1, to_board=True, face_up=True)))
        m = get_equity_model(sp)
        got = {}

        def dec(pos, o):
            if o.phase == "discard":
                return Discard([o.my_cards[0]])
            if o.street == 1 and "obs" not in got:
                got["obs"] = o
            return Check() if o.legal.can_check else Call()

        HandState(sp, deal_order(sp, 3, 0)).play(dec)
        o = got["obs"]
        self.assertEqual((o.phase, o.my_discards_left), ("bet", 1))
        kw = dict(opp_num_cards=o.opp_num_cards, board_to_come=o.board_cards_to_come,
                  my_discards_left=1, opp_discards_left=1, dead=m.dead_cards(o), n=400)
        to_board = m.equity(o.my_cards, o.board, discard_to_board=True,
                            rng=np.random.default_rng(5), **kw)
        got_eq = m.equity_obs(o, n=400, rng=np.random.default_rng(5))
        self.assertEqual(got_eq, to_board)


if __name__ == "__main__":
    unittest.main()
