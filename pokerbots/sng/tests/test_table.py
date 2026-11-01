"""Sit-and-go engine tests: betting rules, side pots, table loop, timing, ICM.
    python3 -m unittest discover -s sng/tests -t .
"""
import time
import unittest

from engine.cards import parse_card
from engine.game import Call, Check, Fold, RaiseTo
from sng.bots_basic import PushSng, RandomSng, SngBot, StationSng
from sng.icm import icm
from sng.rules import SngRules
from sng.table import Hand, play_table


def cards(s):
    return [parse_card(c) for c in s.split()]


def make_deck(holes, board, spec):
    """holes: list per seat of 'Ah Kd' (or '' for a busted seat), board: 5 cards."""
    used = []
    for h in holes:
        used += cards(h) if h else [None, None]
    used += cards(board)
    rest = [c for c in spec.deck if c not in used]
    deck, it = [], iter(rest)
    for c in used:
        deck.append(next(it) if c is None else c)
    return deck + list(it)


class Script:
    """decide() driven by a per-seat list of actions; records observations."""

    def __init__(self, plan):
        self.plan = {k: list(v) for k, v in plan.items()}
        self.seen = []

    def __call__(self, j, obs, lg):
        self.seen.append((j, obs, lg))
        a = self.plan[j].pop(0)
        assert lg.is_legal(a), (j, a, lg)
        return a


R = SngRules(num_players=4, payouts=(50, 30, 20, 0), enforce_time=False)


class TestHand(unittest.TestCase):
    def test_blinds_and_preflop_order(self):
        spec = R.spec
        deck = make_deck(["Ah Ad", "Kh Kd", "2c 3d", "7h 8h"], "2s 5h 9c Jd Qs", spec)
        h = Hand(R, [2000] * 4, button=0, hand_number=0, deck=deck)
        s = Script({3: [Fold()], 0: [Fold()], 1: [Fold()]})
        h.play(s, 4)
        self.assertEqual((h.sb_seat, h.bb_seat), (1, 2))
        self.assertEqual([j for j, _, _ in s.seen], [3, 0, 1])     # UTG = after the BB, then button, SB
        self.assertEqual(h.stack, [2000, 1990, 2010, 2000])         # BB wins the blinds

    def test_heads_up_button_is_small_blind_and_acts_first_preflop(self):
        r = R.with_(num_players=2, payouts=(1, 0))
        deck = make_deck(["Ah Ad", "Kh Kd"], "2s 5h 9c Jd Qs", r.spec)
        h = Hand(r, [2000, 2000], button=1, hand_number=0, deck=deck)
        s = Script({1: [Call(), Check(), Check(), Check()], 0: [Check(), Check(), Check(), Check()]})
        h.play(s, 2)
        self.assertEqual((h.sb_seat, h.bb_seat), (1, 0))
        order = [(j, o.street) for j, o, _ in s.seen]
        self.assertEqual(order[:2], [(1, 0), (0, 0)])               # button first preflop
        self.assertEqual(order[2], (0, 1))                          # BB first after the flop
        self.assertEqual(h.stack, [2020, 1980])                     # aces win

    def test_min_raise_and_short_allin_does_not_reopen(self):
        # seat 3 raises to 100 (inc 80), seat 0 all-in to 150 (inc 50 < 80: not a full raise)
        deck = make_deck(["Ah Ad", "Kh Kd", "Qh Qd", "7h 8h"], "2s 5h 9c Jd 3c", R.spec)
        h = Hand(R, [150, 2000, 2000, 2000], button=0, hand_number=0, deck=deck)
        s = Script({3: [RaiseTo(100), Call()], 0: [RaiseTo(150)], 1: [Fold()],
                    2: [Call(), Check(), Check(), Check()]})
        s.plan[3] += [Check(), Check(), Check()]
        h.play(s, 4)
        lg3_first = s.seen[0][2]
        self.assertEqual((lg3_first.min_raise_to, lg3_first.max_raise_to), (40, 2000))
        lg0 = s.seen[1][2]
        self.assertEqual(lg0.min_raise_to, 150)                     # min raise 180 > stack: all-in for less
        lg2 = s.seen[3][2]                                          # BB had not acted: may re-raise
        self.assertTrue(lg2.can_raise)
        self.assertEqual(lg2.min_raise_to, 150 + 80)
        lg3_again = [lg for j, o, lg in s.seen if j == 3][1]       # seat 3 already acted: call or fold only
        self.assertFalse(lg3_again.can_raise)
        self.assertEqual(lg3_again.call_amount, 50)
        self.assertEqual(sum(h.stack), 150 + 6000)

    def test_full_raise_reopens(self):
        deck = make_deck(["Ah Ad", "Kh Kd", "Qh Qd", "7h 8h"], "2s 5h 9c Jd 3c", R.spec)
        h = Hand(R, [2000] * 4, button=0, hand_number=0, deck=deck)
        s = Script({3: [RaiseTo(60), RaiseTo(300)], 0: [RaiseTo(140)], 1: [Fold()], 2: [Fold()]})
        s.plan[0] += [Fold()]
        h.play(s, 4)
        lg0 = s.seen[1][2]
        self.assertEqual(lg0.min_raise_to, 100)                     # 60 + last increment 40
        lg3 = s.seen[4][2]
        self.assertTrue(lg3.can_raise)
        self.assertEqual(lg3.min_raise_to, 220)                     # 140 + 80
        self.assertEqual(h.stack[3], 2000 + 140 + 10 + 20)          # uncalled 160 returned

    def test_side_pots(self):
        # seat 0 (100) has the best hand, seat 1 (300) second, seat 2 (1000) third, seat 3 folds
        deck = make_deck(["Ah Ad", "Kh Kd", "Qh Qd", "7c 2d"], "2s 5h 9c Jd 3c", R.spec)
        h = Hand(R, [100, 300, 1000, 2000], button=3, hand_number=0, deck=deck)
        # button 3: SB 0, BB 1, first to act preflop = seat 2
        s = Script({2: [RaiseTo(1000)], 3: [Fold()], 0: [Call()], 1: [Call()]})
        h.play(s, 4)
        self.assertEqual(h.stack[0], 100 * 3)                       # main pot 100 x3
        self.assertEqual(h.stack[1], 200 * 2)                       # side pot 200 x2
        self.assertEqual(h.stack[2], 700)                           # uncalled 700 back
        self.assertEqual(h.stack[3], 2000)
        self.assertEqual(sum(h.stack), 3400)

    def test_split_pot_odd_chip_left_of_button(self):
        r = R.with_(blinds=((5, 15),))
        deck = make_deck(["Ah 2d", "As 2c", "Kh Kd", "7c 3d"], "Th Jc Qd Ks 4h", r.spec)  # broadway straight on board... both play it
        h = Hand(r, [2000] * 4, button=2, hand_number=0, deck=deck)
        # button 2: SB 3, BB 0; first preflop = seat 1
        s = Script({1: [Call(), Check(), Check(), Check()], 2: [Fold()], 3: [Fold()],
                    0: [Check(), Check(), Check(), Check()]})
        h.play(s, 4)
        # pot 15 + 15 + 5 = 35, split between seats 0 and 1: 18 to the first left of the button (3, then 0)
        self.assertEqual(h.stack[0] - (2000 - 15), 18)
        self.assertEqual(h.stack[1] - (2000 - 15), 17)

    def test_pot_limit_max(self):
        r = R.with_(spec=R.spec.with_(betting="pot_limit"))
        deck = make_deck(["Ah Ad", "Kh Kd", "Qh Qd", "7c 2d"], "2s 5h 9c Jd 3c", r.spec)
        h = Hand(r, [2000] * 4, button=0, hand_number=0, deck=deck)
        s = Script({3: [Fold()], 0: [Fold()], 1: [Fold()]})
        captured = []
        orig = s.__call__

        def dec(j, o, lg):
            captured.append(lg)
            return orig(j, o, lg)
        h.play(dec, 4)
        self.assertEqual(captured[0].max_raise_to, 20 + (30 + 20))   # call 20 then pot (10+20+20)

    def test_antes_are_dead_money(self):
        r = R.with_(antes=(5,))
        deck = make_deck(["Ah Ad", "Kh Kd", "Qh Qd", "7c 2d"], "2s 5h 9c Jd 3c", r.spec)
        h = Hand(r, [2000] * 4, button=0, hand_number=0, deck=deck)
        s = Script({3: [Fold()], 0: [Fold()], 1: [Fold()]})
        h.play(s, 4)
        self.assertEqual(h.stack, [1995, 1985, 2000 - 5 - 20 + (4 * 5 + 10 + 20), 1995])

    def test_allin_preflop_runs_out_board(self):
        deck = make_deck(["Ah Ad", "Kh Kd", "", "7c 2d"], "Ks 5h 9c Jd 3c", R.spec)
        h = Hand(R, [500, 800, 0, 2000], button=3, hand_number=0, deck=deck)
        s = Script({3: [Fold()], 0: [RaiseTo(500)], 1: [Call()]})
        h.play(s, 3)
        self.assertEqual(len(h.board), 5)
        self.assertEqual(h.stack[1], 800 + 500)                     # kings make a set
        self.assertEqual(h.stack[0], 0)


class TestTable(unittest.TestCase):
    def test_conservation_and_points_random_play(self):
        r = SngRules(enforce_time=False)
        for seed in range(25):
            bots = [RandomSng() if i % 2 else StationSng() for i in range(8)]
            res = play_table(bots, r, seed)
            self.assertAlmostEqual(sum(res.points), sum(r.payouts), places=6)
            self.assertEqual(sum(res.final_stacks), 16000)
            for st in res.stats:
                self.assertEqual((st.errors, st.illegal), (0, 0), st.first_error)

    def test_cap_uses_icm(self):
        r = SngRules(enforce_time=False, max_hands=3)
        res = play_table([StationSng() for _ in range(8)], r, 1)
        alive = [j for j in range(8) if res.final_stacks[j] > 0]
        exp = icm([res.final_stacks[j] for j in alive], r.payouts[:len(alive)])
        for j, e in zip(alive, exp):
            self.assertAlmostEqual(res.points[j], e)

    def test_same_hand_busts_share_or_rank_by_start_stack(self):
        r = SngRules(num_players=3, payouts=(50, 30, 20), enforce_time=False)
        found_tie = found_ranked = False
        for seed in range(300):
            res = play_table([PushSng(), PushSng(), StationSng()], r, seed)
            self.assertAlmostEqual(sum(res.points), 100)
            busts = [j for j in range(3) if res.bust_hand[j] is not None]
            if len(busts) == 2 and res.bust_hand[busts[0]] == res.bust_hand[busts[1]]:
                a, b = busts
                if res.places[a] == res.places[b]:          # equal start stacks: share places 2-3
                    self.assertEqual((res.places[a], res.points[a], res.points[b]), (2.5, 25, 25))
                    found_tie = True
                else:
                    self.assertEqual(sorted([res.points[a], res.points[b]]), [20, 30])
                    found_ranked = True
            elif len(busts) == 2:
                first, second = sorted(busts, key=lambda j: res.bust_hand[j])
                self.assertEqual((res.points[first], res.points[second]), (20, 30))
        self.assertTrue(found_tie)

    def test_timeout_and_errors_fold_or_check(self):
        class Slow(SngBot):
            def act(self, obs):
                time.sleep(0.003)
                return RaiseTo(obs.legal.max_raise_to) if obs.legal.can_raise else obs.legal.passive()

        class Broken(SngBot):
            def act(self, obs):
                raise RuntimeError("boom")
        r = SngRules(num_players=3, payouts=(50, 30, 20), max_hands=20)
        res = play_table([Slow(), Broken(), StationSng()], r, 3)
        self.assertGreater(res.stats[0].over_limit, 0)
        self.assertGreater(res.stats[1].errors, 0)
        self.assertEqual(sum(res.final_stacks), 6000)
        # the slow pusher never got an all-in through: it only ever checked/folded
        self.assertLessEqual(res.final_stacks[0], 2000 + 60 * 20)

    def test_duplicate_deal_same_cards_per_seat(self):
        seen = {}

        class Peek(SngBot):
            def act(self, obs):
                seen.setdefault((obs.hand_number, obs.seat), obs.hole)
                return Fold() if not obs.legal.can_check else Check()
        r = SngRules(enforce_time=False, max_hands=5)
        play_table([Peek() for _ in range(8)], r, seed=1, deal_seed=42)
        first = dict(seen)
        seen.clear()
        play_table([Peek() for _ in range(8)], r, seed=2, deal_seed=42)
        common = set(first) & set(seen)
        self.assertTrue(common)
        for k in common:
            self.assertEqual(first[k], seen[k])


class TestICM(unittest.TestCase):
    def test_known_values(self):
        e = icm([5000, 3000, 2000], (50, 30, 20))
        self.assertAlmostEqual(sum(e), 100)
        # P(1st) = .5/.3/.2; player 0 2nd: .3*(5/7)+.2*(5/8)
        p0_2 = 0.3 * 5 / 7 + 0.2 * 5 / 8
        p0_1 = 0.5
        self.assertAlmostEqual(e[0], 50 * p0_1 + 30 * p0_2 + 20 * (1 - p0_1 - p0_2))
        self.assertTrue(e[0] > e[1] > e[2])

    def test_equal_stacks_equal_shares(self):
        e = icm([1000] * 8, (100, 65, 45, 30, 20, 12, 6, 0))
        for x in e:
            self.assertAlmostEqual(x, 278 / 8)

    def test_chip_leader_gets_less_than_chip_share(self):
        e = icm([7000, 500, 500], (50, 30, 20))
        self.assertLess(e[0], 100 * 7000 / 8000)


if __name__ == "__main__":
    unittest.main()
