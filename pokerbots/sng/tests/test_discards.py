"""Discard and draw phases in the sit-and-go engine.
    python3 -m unittest sng.tests.test_discards
"""
import time
import unittest

from engine.game import Check, Discard, Fold, RaiseTo
from engine.spec import DiscardRule, GameSpec
from sng.bots_basic import RandomSng, SngBot, StationSng
from sng.rules import SngRules
from sng.table import Hand, play_table

BASE = dict(starting_stack=2000, small_blind=10, big_blind=20, stack_reset_per_hand=False)

# three hole cards, after the flop each player discards one face up onto the board
TO_BOARD = GameSpec(name="t_to_board", hole_cards=3,
                    discards=(DiscardRule(street=1, count=1, to_board=True, face_up=True),), **BASE)
# four hole cards, after the flop discard two face down (dead), dealer side first
DEAD_DOWN = GameSpec(name="t_dead_down", hole_cards=4,
                     discards=(DiscardRule(street=1, count=2, to_board=False, face_up=False, order="ip_first"),),
                     **BASE)
# hold'em with a draw: after the flop each player may replace 0-1 hole cards (face down)
DRAW_HOLDEM = GameSpec(name="t_draw_holdem", discards=(DiscardRule(street=1, count=1, to_board=False,
                                                                    face_up=False, draw=True, min_count=0),), **BASE)
# five-card draw: no board; one draw of 0-3 cards between two betting rounds
FIVE_DRAW = GameSpec(name="t_five_draw", hole_cards=5, board_cards_per_street=(0, 0),
                     discards=(DiscardRule(street=1, count=3, to_board=False, face_up=False, draw=True,
                                           min_count=0),), **BASE)
SPECS = (TO_BOARD, DEAD_DOWN, DRAW_HOLDEM, FIVE_DRAW)


class Recorder(SngBot):
    """Calls preflop / checks after; discards the first legal number of cards; records."""

    def __init__(self, log):
        self.log = log

    def act(self, obs):
        self.log.append(obs)
        lg = obs.legal
        if lg.discard_count:
            return Discard(obs.hole[:lg.discard_min if lg.discard_min else 1][:lg.discard_count])
        return lg.passive()


class TestDiscards(unittest.TestCase):
    def test_random_play_conserves_chips_on_every_discard_variant(self):
        for spec in SPECS:
            r = SngRules(spec=spec, enforce_time=False)
            for seed in range(12):
                bots = [RandomSng() if i % 2 else StationSng() for i in range(8)]
                res = play_table(bots, r, seed)
                self.assertEqual(sum(res.final_stacks), 16000, spec.name)
                self.assertAlmostEqual(sum(res.points), sum(r.payouts), places=6)
                for st in res.stats:
                    self.assertEqual((st.errors, st.illegal), (0, 0), f"{spec.name}: {st.first_error}")

    def _hand(self, spec, players=4):
        r = SngRules(spec=spec, num_players=players, payouts=tuple(range(players, 0, -1)), enforce_time=False)
        deck = list(spec.deck)
        return r, Hand(r, [2000] * players, button=0, hand_number=0, deck=deck)

    def test_to_board_discards_join_the_board_and_are_visible(self):
        log = []
        r, h = self._hand(TO_BOARD)
        rec = Recorder(log)

        def decide(j, o, lg):
            return rec.act(o)
        h.play(decide, 4)
        self.assertEqual(len(h.board), 5 + 4)                 # 5 dealt + one discard per player
        for j in range(4):
            self.assertEqual(len(h.hole[j]), 2)
            self.assertEqual(len(h.discards[j]), 1)
        disc = [o for o in log if o.phase == "discard"]
        self.assertEqual([o.seat for o in disc], [1, 2, 3, 0])   # oop first: clockwise after the button
        later = disc[-1]
        self.assertEqual(sum(len(v) for v in later.visible_discards), 3)   # the three earlier discards
        self.assertEqual(sum(h.stack), 8000)

    def test_face_down_discards_are_hidden_and_ip_first(self):
        log = []
        r, h = self._hand(DEAD_DOWN)
        rec = Recorder(log)
        h.play(lambda j, o, lg: rec.act(o), 4)
        disc = [o for o in log if o.phase == "discard"]
        self.assertEqual([o.seat for o in disc], [0, 3, 2, 1])   # button first, then backwards
        for o in disc:
            self.assertEqual(sum(len(v) for v in o.visible_discards), 0)
            self.assertEqual(len(o.hole), 4)
        self.assertEqual(len(disc[-1].my_discards), 0)
        self.assertEqual(len(h.board), 5)
        self.assertTrue(all(len(h.hole[j]) == 2 for j in range(4)))

    def test_draw_replaces_cards_and_zero_is_allowed(self):
        r, h = self._hand(FIVE_DRAW)
        before = {}

        def decide(j, o, lg):
            if lg.discard_count:
                before[j] = o.hole
                self.assertEqual((lg.discard_min, lg.discard_count), (0, 3))
                return Discard(o.hole[:j % 4])                   # seats draw 0, 1, 2, 3
            return lg.passive()
        h.play(decide, 4)
        for j in range(4):
            self.assertEqual(len(h.hole[j]), 5)
            kept = set(before[j]) & set(h.hole[j])
            self.assertEqual(len(kept), 5 - j % 4)
        allc = [c for j in range(4) for c in h.hole[j]] + [c for j in range(4) for c in h.discards[j]]
        self.assertEqual(len(allc), len(set(allc)))               # no card dealt twice
        self.assertEqual(sum(h.stack), 8000)

    def test_bad_discards_fall_back_to_the_lowest_cards(self):
        class Wrong(SngBot):
            def act(self, obs):
                return Check() if obs.legal.discard_count else obs.legal.passive()

        class Slow(SngBot):
            def act(self, obs):
                if obs.legal.discard_count:
                    time.sleep(0.003)
                    return Discard(obs.hole[-obs.legal.discard_count:])
                return obs.legal.passive()
        r = SngRules(spec=TO_BOARD, num_players=3, payouts=(3, 2, 1), max_hands=10)
        res = play_table([Wrong(), Slow(), StationSng()], r, 5)
        self.assertGreater(res.stats[0].illegal, 0)
        self.assertGreater(res.stats[1].over_limit, 0)
        self.assertEqual(sum(res.final_stacks), 6000)

    def test_allin_players_still_discard(self):
        log = []

        class Shove(SngBot):
            def act(self, obs):
                log.append(obs)
                lg = obs.legal
                if lg.discard_count:
                    return Discard(obs.hole[:lg.discard_count])
                return RaiseTo(lg.max_raise_to) if lg.can_raise else lg.passive()
        r = SngRules(spec=TO_BOARD, num_players=3, payouts=(3, 2, 1), enforce_time=False, max_hands=1)
        play_table([Shove(), Shove(), Shove()], r, 9)
        self.assertTrue(any(o.phase == "discard" for o in log))

    def test_draws_reuse_the_muck_when_the_stub_runs_out(self):
        """8-handed five-card draw needs up to 40 + 24 cards: dead discards are reshuffled in,
        never a card that is live (in a hand) and never the drawing player's own discards."""
        r = SngRules(spec=FIVE_DRAW, enforce_time=False)
        h = Hand(r, [2000] * 8, button=0, hand_number=3, deck=list(FIVE_DRAW.deck))
        own = {}

        def decide(j, o, lg):
            if lg.discard_count:
                own[j] = o.hole[:3]
                return Discard(o.hole[:3])                         # everyone draws three
            return lg.passive()
        h.play(decide, 8)
        live = [c for j in range(8) for c in h.hole[j]]
        self.assertEqual(len(live), 40)
        self.assertEqual(len(set(live)), 40)                       # no live card twice
        for j in range(8):
            self.assertFalse(set(own[j]) & set(h.hole[j]))         # never your own discards back
        self.assertEqual(sum(h.stack), 16000)

    def test_deck_capacity(self):
        big = GameSpec(name="t_big", hole_cards=7, board_cards_per_street=(0, 0), **BASE)
        with self.assertRaises(ValueError):
            SngRules(spec=big).validate()          # 8 x 7 hole cards > 52


if __name__ == "__main__":
    unittest.main()
