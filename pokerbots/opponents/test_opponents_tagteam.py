"""Tests for opponents/tag.py (opp_tag), opponents/gto_lite.py (opp_gtolite) and
their shared helpers opponents/_tg_common.py.  Run from pokerbots/:
    OMP_NUM_THREADS=1 python3 -m unittest opponents.test_opponents_tagteam
"""
from __future__ import annotations

import unittest
from unittest import mock

import numpy as np

from engine.bot import Bot
from engine.cards import parse_cards
from engine.game import (ActionRecord, Call, Check, Fold, HandResult, LegalActions, Observation,
                         RaiseTo)
from engine.match import play_match
from engine.variants import ALL_VARIANTS, get_variant

from opponents import _tg_common as common
from opponents import gto_lite, tag
from opponents._tg_common import OppModel, get_info, range_sampler, safe

BOTS = {"opp_tag": tag.make_bot, "opp_gtolite": gto_lite.make_bot}


def make_obs(spec, my_cards, *, position=0, street=0, board=(), pot=3, my_pip=1, opp_pip=2,
             my_stack=None, opp_stack=None, legal=None, history=(), opp_num_cards=None,
             to_come=None):
    my_stack = spec.starting_stack - my_pip if my_stack is None else my_stack
    opp_stack = spec.starting_stack - opp_pip if opp_stack is None else opp_stack
    if legal is None:
        call = opp_pip - my_pip
        legal = LegalActions(can_fold=True, can_check=call == 0, can_call=call > 0,
                             call_amount=call, can_raise=True,
                             min_raise_to=opp_pip + max(2, call), max_raise_to=my_pip + my_stack)
    if to_come is None:
        to_come = sum(spec.board_cards_per_street[street + 1:])
    return Observation(
        hand_index=0, hands_in_match=100, position=position, street=street, phase="bet",
        my_cards=tuple(my_cards), board=tuple(board), my_discards=(), opp_discards=(),
        opp_num_cards=spec.hole_cards if opp_num_cards is None else opp_num_cards,
        pot=pot, my_pip=my_pip, opp_pip=opp_pip, my_stack=my_stack, opp_stack=opp_stack,
        my_committed=spec.starting_stack - my_stack, opp_committed=spec.starting_stack - opp_stack,
        legal=legal, history=tuple(history), board_cards_to_come=to_come,
        my_discards_left=0, opp_discards_left=0, bankroll=0, time_left=None, big_blind=2)


def started(factory, spec, seed=0):
    b = factory()
    b.STRICT = True
    b.new_match(spec, seed)
    return b


class TestFactories(unittest.TestCase):
    def test_make_bot(self):
        for name, f in BOTS.items():
            b = f()
            self.assertIsInstance(b, Bot)
            self.assertEqual(b.name, name)


class TestAllVariantsLegalAndFast(unittest.TestCase):
    """Every variant incl. DAY_VARIANTS, vs random-legal and self."""

    def test_no_illegal_no_errors_fast(self):
        from bots.random_legal import RandomLegalBot
        for name, f in BOTS.items():
            for spec in ALL_VARIANTS.values():
                spec = spec.with_(time_per_decision=None, time_per_match=None)
                get_info(spec)  # per-spec precomputation happens before play
                for opp in (RandomLegalBot, f):
                    a, b = started(f, spec), opp()
                    r = play_match(a, b, spec, deal_seed=3, hands=16)
                    st = r.stats[0].summary()
                    with self.subTest(bot=name, spec=spec.name, opp=getattr(b, "name", "")):
                        self.assertEqual(st["illegal"], 0, st["first_error"])
                        self.assertEqual(st["errors"], 0, st["first_error"])
                        self.assertLess(st["max_ms"], 250)


class TestCommon(unittest.TestCase):
    def test_percentiles_ordered(self):
        info = get_info(get_variant("a"))
        self.assertGreater(info.pct(parse_cards("AsAh")), 0.95)
        self.assertLess(info.pct(parse_cards("7c2d")), 0.12)
        self.assertGreater(info.pct(parse_cards("KsQs")), info.pct(parse_cards("Ks5d")))

    def test_range_sampler_cards_valid(self):
        for v in ("a", "d", "e", "h"):
            spec = get_variant(v)
            info = get_info(spec)
            board = np.array(spec.deck[:3], dtype=np.int64)
            avail = np.array(sorted(set(spec.deck) - set(board.tolist())), dtype=np.int64)
            for h in (spec.hole_cards, 2):
                s = range_sampler(info, board, r_pre=0.2, m_post=2.5)
                s.h = h
                out = s(200, avail, np.random.default_rng(0))
                self.assertEqual(out.shape, (200, h))
                self.assertTrue(np.isin(out, avail).all())
                self.assertTrue(all(len(set(row)) == len(row) for row in out.tolist()))

    def test_narrowed_range_lowers_equity(self):
        spec = get_variant("a")
        info = get_info(spec)
        obs = make_obs(spec, parse_cards("Kc9d"), position=1, street=1,
                       board=parse_cards("Kh7s2d"), pot=20, my_pip=0, opp_pip=0)
        rng = np.random.default_rng(1)
        wide = common.equity_vs(info, obs, rng, r_pre=1.0, m_post=1.0, budget_ms=20)
        narrow = common.equity_vs(info, obs, rng, r_pre=0.1, m_post=3.0, budget_ms=20)
        self.assertLess(narrow, wide - 0.1)

    def test_safe_fixes_illegal(self):
        spec = get_variant("a")
        obs = make_obs(spec, parse_cards("AsKs"))
        self.assertTrue(obs.legal.is_legal(safe(obs, RaiseTo(10 ** 6))))
        self.assertTrue(obs.legal.is_legal(safe(obs, Check())))
        lg = LegalActions(can_fold=True, can_call=True, call_amount=50)
        obs2 = make_obs(spec, parse_cards("AsKs"), legal=lg)
        self.assertTrue(lg.is_legal(safe(obs2, RaiseTo(100))))

    def test_opp_model_counts_cbet_fold(self):
        om = OppModel()
        hist = (ActionRecord(0, 0, "raise", 5), ActionRecord(1, 0, "call", 3),
                ActionRecord(1, 1, "check"), ActionRecord(0, 1, "raise", 4),
                ActionRecord(1, 1, "fold"))
        om.update(HandResult(position=0, delta=5, showdown=False, my_cards=(), opp_cards=None,
                             board=(), history=hist, folded_by=1))
        self.assertEqual((om.cbet_faced, om.cbet_fold), (1, 1))
        self.assertEqual((om.bets_faced, om.bets_fold), (1, 1))
        self.assertEqual(om.pf[(1, 1)], [1, 0, 1])
        self.assertGreater(om.fold_to_cbet, 0.45)

    def test_opp_model_river_bluff_shown(self):
        om = OppModel()
        hist = (ActionRecord(0, 0, "call", 1), ActionRecord(1, 0, "check"),
                ActionRecord(1, 3, "raise", 10), ActionRecord(0, 3, "call", 10))
        om.update(HandResult(position=0, delta=12, showdown=True, my_cards=(), opp_cards=(1, 2),
                             board=(), history=hist, folded_by=None))
        self.assertEqual((om.river_bets_shown, om.river_bets_lost), (1, 1))

    def test_opp_pre_range_narrows_with_raises(self):
        om = OppModel()
        spec = get_variant("a")
        o1 = make_obs(spec, parse_cards("AsKs"), position=1, my_pip=2, opp_pip=5,
                      history=(ActionRecord(0, 0, "raise", 5),))
        o2 = make_obs(spec, parse_cards("AsKs"), position=1, my_pip=12, opp_pip=30,
                      history=(ActionRecord(0, 0, "raise", 5), ActionRecord(1, 0, "raise", 12),
                               ActionRecord(0, 0, "raise", 30)))
        self.assertLess(common.opp_pre_range(o2, om), common.opp_pre_range(o1, om))
        self.assertLess(common.opp_pre_range(o1, om), 1.0)


class TestTagRules(unittest.TestCase):
    def test_push_fold_short(self):
        spec = get_variant("a").with_(starting_stack=20)  # 10 bb
        b = started(tag.make_bot, spec)
        for _ in range(5):
            self.assertEqual(b.act(make_obs(spec, parse_cards("AsAh"))), RaiseTo(20))
            self.assertEqual(b.act(make_obs(spec, parse_cards("7c2d"))), Fold())

    def test_open_and_fold_deep(self):
        spec = get_variant("a")
        b = started(tag.make_bot, spec)
        a = b.act(make_obs(spec, parse_cards("AsKh")))
        self.assertEqual(a, RaiseTo(5))  # 2.5 bb
        self.assertEqual(b.act(make_obs(spec, parse_cards("8c2d"))), Fold())

    def test_calls_allin_with_aces_folds_trash(self):
        spec = get_variant("a")
        lg = LegalActions(can_fold=True, can_call=True, call_amount=198)
        hist = (ActionRecord(0, 0, "raise", 200),)
        b = started(tag.make_bot, spec)
        kw = dict(position=1, pot=202, my_pip=2, opp_pip=200, my_stack=198, opp_stack=0,
                  legal=lg, history=hist)
        self.assertEqual(b.act(make_obs(spec, parse_cards("AsAh"), **kw)), Call())
        self.assertEqual(b.act(make_obs(spec, parse_cards("7c2d"), **kw)), Fold())

    def test_value_bets_nuts_and_folds_air_to_big_bet(self):
        spec = get_variant("a")
        b = started(tag.make_bot, spec)
        board = parse_cards("AhKh7c2s3d")
        nuts = make_obs(spec, parse_cards("AsAd"), position=0, street=3, board=board, pot=40,
                        my_pip=0, opp_pip=0)
        self.assertEqual(b.act(nuts).kind, "raise")
        hist = (ActionRecord(1, 3, "raise", 40),)
        air = make_obs(spec, parse_cards("9s8d"), position=0, street=3, board=board, pot=80,
                       my_pip=0, opp_pip=40, history=hist)
        self.assertEqual(b.act(air), Fold())

    def test_pot_odds_call(self):
        spec = get_variant("a")
        b = started(tag.make_bot, spec)
        board = parse_cards("AhKh7c2s3d")
        hist = (ActionRecord(1, 3, "raise", 4),)
        o = make_obs(spec, parse_cards("9s8d"), position=0, street=3, board=board, pot=104,
                     my_pip=0, opp_pip=4, history=hist)
        with mock.patch.object(tag, "equity_vs", return_value=0.2):
            self.assertEqual(b.act(o), Call())      # needs 4/108 = 3.7%
        with mock.patch.object(tag, "equity_vs", return_value=0.02):
            self.assertEqual(b.act(o), Fold())


class TestGtoLiteRules(unittest.TestCase):
    def _river(self, spec, b, eq, n=400):
        board = parse_cards("AhKh7c2s3d")
        acts = []
        with mock.patch.object(gto_lite, "equity_vs", return_value=eq):
            for _ in range(n):
                o = make_obs(spec, parse_cards("9s8d"), position=0, street=3, board=board,
                             pot=40, my_pip=0, opp_pip=0,
                             history=(ActionRecord(1, 3, "check"),))
                acts.append(b.act(o).kind)
        return acts.count("raise") / n

    def test_polarized_river(self):
        spec = get_variant("a")
        b = started(gto_lite.make_bot, spec)
        self.assertEqual(self._river(spec, b, 0.5), 0.0)       # bluff-catchers check
        self.assertGreater(self._river(spec, b, 0.95), 0.9)    # value bets
        b = started(gto_lite.make_bot, spec)
        b.river_v, b.river_b = 1e6, 1e6                        # freeze the value:air mix
        f = self._river(spec, b, 0.1, n=600)                   # bluffs mixed, not always
        self.assertGreater(f, 0.25)
        self.assertLess(f, 0.6)

    def test_bluff_ratio_matches_formula(self):
        spec = get_variant("a")
        b = started(gto_lite.make_bot, spec)
        b.river_v, b.river_b = 1e6, 3e6   # value:air mix 1:3, effectively frozen
        f = self._river(spec, b, 0.1, n=2000)
        # bluff prob = s/(1+s) * V/B * adj with s = 0.75 pot and adj = 1 (prior fold rate)
        self.assertAlmostEqual(f, 0.75 / 1.75 / 3.0, delta=0.04)

    def test_mdf_defence_with_bluff_catchers(self):
        spec = get_variant("a")
        b = started(gto_lite.make_bot, spec)
        board = parse_cards("AhKh7c2s3d")
        hist = (ActionRecord(1, 3, "raise", 13),)
        calls = 0
        with mock.patch.object(gto_lite, "equity_vs", return_value=0.22):
            for _ in range(300):
                # equity 0.22 is below the pot odds (13/66 + 0.02 margin) of a 1/3-pot bet
                o = make_obs(spec, parse_cards("9s8d"), position=0, street=3, board=board,
                             pot=53, my_pip=0, opp_pip=13, history=hist)
                calls += b.act(o) == Call()
        self.assertGreater(calls, 30)   # defends some by MDF, mixed
        self.assertLess(calls, 300)

    def test_check_raises_out_of_position(self):
        spec = get_variant("a")
        b = started(gto_lite.make_bot, spec)
        board = parse_cards("Ah9h7c")
        hist = (ActionRecord(1, 1, "check"), ActionRecord(0, 1, "raise", 6))
        kinds = []
        with mock.patch.object(gto_lite, "equity_vs", return_value=0.9):
            for _ in range(200):
                o = make_obs(spec, parse_cards("AsAd"), position=1, street=1, board=board,
                             pot=18, my_pip=0, opp_pip=6, history=hist)
                kinds.append(b.act(o).kind)
        self.assertGreater(kinds.count("raise"), 100)
        self.assertGreater(kinds.count("call"), 10)    # mixed, not pure


class TestSanityVsDummies(unittest.TestCase):
    def test_beats_station(self):
        from bots.dummies import make_bot as dummy
        spec = get_variant("a")
        for name, f in BOTS.items():
            r1 = play_match(started(f, spec), dummy("station"), spec, deal_seed=5, hands=150)
            r2 = play_match(dummy("station"), started(f, spec), spec, deal_seed=5, hands=150)
            with self.subTest(bot=name):
                self.assertGreater(r1.bb_per_hand(0) + r2.bb_per_hand(1), 0)


if __name__ == "__main__":
    unittest.main()
