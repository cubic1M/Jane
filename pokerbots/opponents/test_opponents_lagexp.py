"""Tests for opp_lag (opponents/lag.py), opp_exploit (opponents/exploiter.py)
and their helper module opponents/_lagexp.py.

Run from pokerbots/:  OMP_NUM_THREADS=1 python3 -m unittest opponents.test_opponents_lagexp
"""
from __future__ import annotations

import unittest
from types import SimpleNamespace

import numpy as np

from engine.bot import Bot
from engine.game import CALL, CHECK, FOLD, RAISE, ActionRecord, Discard, Fold, HandResult, LegalActions
from engine.match import play_match
from engine.variants import ALL_VARIANTS, get_variant

from opponents import _lagexp as C
from opponents.exploiter import ExploitBot, OppModel
from opponents.exploiter import make_bot as make_exploit
from opponents.lag import LagBot
from opponents.lag import make_bot as make_lag


class Folder(Bot):
    """Calls preflop, never bets, folds to any postflop bet."""
    name = "folder"

    def act(self, obs):
        lg = obs.legal
        if lg.discard_count:
            return Discard(obs.my_cards[:lg.discard_count])
        if obs.street == 0:
            return lg.passive()
        return lg.passive() if lg.can_check else Fold()


class Station(Bot):
    name = "station_t"

    def act(self, obs):
        return obs.legal.passive()


def dup(make_a, make_b, spec, seed, hands):
    r1 = play_match(make_a(), make_b(), spec, deal_seed=seed, hands=hands)
    r2 = play_match(make_b(), make_a(), spec, deal_seed=seed, hands=hands)
    return (r1.deltas.sum() - r2.deltas.sum()) / spec.big_blind / (2 * hands)


class TestInterface(unittest.TestCase):
    def test_factories(self):
        self.assertIsInstance(make_lag(), Bot)
        self.assertIsInstance(make_exploit(), Bot)
        self.assertEqual(make_lag().name, "opp_lag")
        self.assertEqual(make_exploit().name, "opp_exploit")
        self.assertIsInstance(make_lag(), LagBot)
        self.assertIsInstance(make_exploit(), ExploitBot)

    def test_legal_and_fast_on_every_variant(self):
        from bots.random_legal import RandomLegalBot
        for name, spec in ALL_VARIANTS.items():
            for mk in (make_lag, make_exploit):
                for seat in (0, 1):
                    bots = (mk(), RandomLegalBot()) if seat == 0 else (RandomLegalBot(), mk())
                    r = play_match(bots[0], bots[1], spec, deal_seed=11 + seat, hands=16)
                    st = r.stats[seat].summary()
                    with self.subTest(variant=name, bot=bots[seat].name, seat=seat):
                        self.assertEqual(st["illegal"], 0, st["first_error"])
                        self.assertEqual(st["errors"], 0, st["first_error"])
                        self.assertLess(st["max_ms"], 100.0)


class TestHelpers(unittest.TestCase):
    def test_size_bucket(self):
        self.assertEqual(C.size_bucket(0.33), 0)
        self.assertEqual(C.size_bucket(0.66), 1)
        self.assertEqual(C.size_bucket(1.0), 2)
        self.assertEqual(C.size_bucket(2.0), 3)

    def test_bet_to_is_clamped(self):
        lg = LegalActions(can_fold=True, can_check=True, can_raise=True, min_raise_to=2, max_raise_to=50)
        obs = SimpleNamespace(legal=lg, my_pip=0, opp_pip=0, pot=40)
        self.assertEqual(C.bet_to(obs, 0.5), 20)
        self.assertEqual(C.bet_to(obs, 5.0), 50)
        self.assertEqual(C.bet_to(obs, 0.0), 2)
        lg2 = LegalActions(can_fold=True, can_call=True, call_amount=10, can_raise=True,
                           min_raise_to=20, max_raise_to=200)
        obs2 = SimpleNamespace(legal=lg2, my_pip=0, opp_pip=10, pot=30)
        # pot after calling = 40, raise of 1 pot on top of the call -> 10 + 40
        self.assertEqual(C.bet_to(obs2, 1.0), 50)

    def test_replay_rebuilds_pot(self):
        spec = get_variant("a")
        hist = (ActionRecord(0, 0, RAISE, 6), ActionRecord(1, 0, CALL, 4),
                ActionRecord(1, 1, CHECK), ActionRecord(0, 1, RAISE, 8), ActionRecord(1, 1, FOLD))
        rows = list(C.replay(hist, spec))
        self.assertEqual(rows[0][1], 3)           # blinds
        self.assertEqual(rows[1][3], 4)           # BB faces 4 more
        self.assertEqual(rows[3][1], 12)          # flop pot
        last = rows[-1]
        self.assertEqual(last[1], 20)             # pot when BB folds
        self.assertEqual(last[3], 8)

    def test_new_cards_skip_board_discards(self):
        spec = get_variant("c")  # 3 flop cards, then 2 discards to the board
        board = (0, 4, 8, 12, 16, 20)
        obs = SimpleNamespace(street=2, board=board)
        new, old = C.new_cards_this_street(obs, spec)
        self.assertEqual(new, (20,))
        self.assertEqual(old, (0, 4, 8, 12, 16))

    def test_scare_card(self):
        spec = get_variant("a")
        from engine.cards import parse_cards
        flop = tuple(parse_cards("2c7d9h"))
        over = SimpleNamespace(street=2, board=flop + tuple(parse_cards("Ks")))
        blank = SimpleNamespace(street=2, board=flop + tuple(parse_cards("3s")))
        self.assertTrue(C.scare_card(over, spec))
        self.assertFalse(C.scare_card(blank, spec))

    def test_range_sampler_is_stronger(self):
        spec = get_variant("a")
        board = np.array([0, 17, 34], dtype=np.int64)
        avail = np.array([c for c in spec.deck if c not in board], dtype=np.int64)
        rng = np.random.default_rng(0)
        from engine.evaluator import get_evaluator
        ev = get_evaluator(spec)
        top = C.make_range_sampler(spec, board, 0.25, 2, 2)(400, avail, rng)
        rnd = C.make_range_sampler(spec, board, 1.0, 2, 2)(400, avail, rng)
        self.assertEqual(top.shape, (400, 2))
        self.assertEqual(len(set(map(tuple, top.tolist()))) > 50, True)
        b = np.broadcast_to(board, (400, 3))
        self.assertGreater(ev.evaluate_batch(top, b).mean(), ev.evaluate_batch(rnd, b).mean())

    def test_preflop_pct_orders_hands(self):
        spec = get_variant("a")
        from engine.cards import parse_cards
        self.assertGreater(C.preflop_pct(spec, parse_cards("AsAh")), 0.95)
        self.assertLess(C.preflop_pct(spec, parse_cards("7c2d")), 0.2)


class TestOppModel(unittest.TestCase):
    def test_bluff_share_tracks_showdowns(self):
        strong, bluffy = OppModel(4), OppModel(4)
        strong.bet_strength = [0.9] * 30
        bluffy.bet_strength = [0.2] * 30
        self.assertLess(strong.bluff_share(), 0.1)
        self.assertGreater(bluffy.bluff_share(), 0.7)

    def test_fold_rate_learns_and_reraise_is_separate(self):
        m = OppModel(4)
        base = m.fold_rate(1, 1, "exploit")
        for _ in range(40):
            m.fold[1][1].add(True)
            m.fold_street[1].add(True)
            m.fold_slow.add(True)
        self.assertGreater(m.fold_rate(1, 1, "exploit"), base + 0.3)
        self.assertLess(m.fold_rate(1, 1, "exploit", rr=True), 0.3)

    def test_style_switches_after_losing_block(self):
        bot = make_exploit(block=10)
        bot.new_match(get_variant("a"), 0)
        self.assertEqual(bot.style, "exploit")
        for _ in range(10):
            bot.end_hand(HandResult(position=0, delta=-20, showdown=False, my_cards=(0, 1),
                                    opp_cards=None, board=(), history=(), folded_by=0))
        self.assertNotEqual(bot.style, "exploit")


class TestBehaviour(unittest.TestCase):
    spec = get_variant("a")

    def _bet_rate(self, opp_cls, hands=240):
        bot = make_exploit()
        r = play_match(bot, opp_cls(), self.spec, deal_seed=5, hands=hands, record=True)
        bets = chances = 0
        # count our postflop bets when the opponent checked to us or we act first
        for L in r.logs:
            acts = L["actions"]
            for i, (seat, st, kind, amt, _c) in enumerate(acts):
                if seat != 0 or st == 0:
                    continue
                prev = [a for a in acts[:i] if a[1] == st]
                if all(a[2] == CHECK for a in prev):
                    chances += 1
                    bets += kind == RAISE
        return bets / max(1, chances), bot

    def test_exploiter_bluffs_folders_and_reads_them(self):
        rate_folder, b1 = self._bet_rate(Folder)
        rate_station, b2 = self._bet_rate(Station)
        self.assertGreater(rate_folder, rate_station + 0.15)
        self.assertGreater(b1.m.fold_rate(1, 0, "exploit"), 0.8)
        self.assertLess(b2.m.fold_rate(1, 1, "exploit"), 0.15)

    def test_lag_uses_big_sizes(self):
        r = play_match(make_lag(), Station(), self.spec, deal_seed=3, hands=200, record=True)
        big = 0
        for L in r.logs:
            pot = 3
            street = 0
            pips = {L["button_seat"]: 1, 1 - L["button_seat"]: 2}
            for (seat, st, kind, amt, _c) in L["actions"]:
                if st != street:
                    street, pips = st, {0: 0, 1: 0}
                if kind == RAISE:
                    add = amt - pips[seat]
                    if seat == 0 and st > 0 and add >= pot:
                        big += 1
                    pot += add
                    pips[seat] = amt
                elif kind == CALL:
                    pot += amt
                    pips[seat] += amt
        self.assertGreater(big, 5)   # pot-sized bets, overbets and shoves

    def test_both_beat_station_and_random(self):
        from bots.dummies import make_bot as dummy
        from bots.random_legal import RandomLegalBot
        for mk in (make_lag, make_exploit):
            with self.subTest(bot=mk().name):
                self.assertGreater(dup(mk, lambda: dummy("station"), self.spec, 21, 150), 0.5)
                self.assertGreater(dup(mk, RandomLegalBot, self.spec, 22, 150), 0.5)


if __name__ == "__main__":
    unittest.main()
