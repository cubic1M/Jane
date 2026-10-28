"""Tests for the lead-protection wrapper (bots/lead_protection.py)."""
import unittest

from engine.bot import Bot
from engine.cards import parse_cards
from engine.conformance import check_bot
from engine.game import (CALL, CHECK, DISCARD, FOLD, RAISE, Call, LegalActions, Observation,
                         RaiseTo)
from engine.match import play_match
from engine.variants import get_variant

from bots.dummies import make_bot as make_dummy
from bots.lead_protection import LeadProtection
from bots.registry import make

A = get_variant("a")


class Scripted(Bot):
    """Inner bot that always returns the same bet action and counts calls."""
    name = "scripted"

    def __init__(self, action=None):
        self.action = action or Call()
        self.calls = 0
        self.hands = 0

    def act(self, obs):
        self.calls += 1
        if obs.legal.discard_count:
            from engine.game import Discard
            return Discard(obs.my_cards[:obs.legal.discard_count])
        return self.action if obs.legal.is_legal(self.action) else obs.legal.passive()

    def end_hand(self, result):
        self.hands += 1


def obs_at(spec=A, *, hand_index, bankroll, position=0, my_committed=1, legal=None,
           cards="7c2d", phase="bet", street=0, board=""):
    hands = spec.hands_per_match
    lg = legal or LegalActions(can_fold=True, can_call=True, call_amount=1, can_raise=True,
                               min_raise_to=4, max_raise_to=200)
    return Observation(
        hand_index=hand_index, hands_in_match=hands, position=position, street=street,
        phase=phase, my_cards=tuple(parse_cards(cards)),
        board=tuple(parse_cards(board)) if board else (), my_discards=(), opp_discards=(),
        opp_num_cards=spec.hole_cards, pot=my_committed + 2, my_pip=my_committed, opp_pip=2,
        my_stack=spec.starting_stack - my_committed, opp_stack=spec.starting_stack - 2,
        my_committed=my_committed, opp_committed=2, legal=lg, history=(),
        board_cards_to_come=sum(spec.board_cards_per_street[street + 1:]),
        my_discards_left=0, opp_discards_left=0, bankroll=bankroll, time_left=None,
        big_blind=spec.big_blind)


def wrapped(inner=None, spec=A, **kw):
    lp = LeadProtection(inner or Scripted(), **kw)
    lp.new_match(spec, 0)
    return lp


class TestLeadProtection(unittest.TestCase):
    def test_registry_and_name(self):
        b = make("equity+lp")
        self.assertIsInstance(b, LeadProtection)
        self.assertEqual(b.name, "equity+lp")
        self.assertEqual(b.scoring, "win")

    def test_max_future_loss_alternates_blinds(self):
        lp = wrapped()
        # 1000 hands; at hand 997 as SB: hands 998 (BB, 2) and 999 (SB, 1) remain
        self.assertEqual(lp.max_future_loss(obs_at(hand_index=997, bankroll=0, position=0)), 3)
        self.assertEqual(lp.max_future_loss(obs_at(hand_index=996, bankroll=0, position=0)), 5)
        self.assertEqual(lp.max_future_loss(obs_at(hand_index=996, bankroll=0, position=1)), 4)
        self.assertEqual(lp.max_future_loss(obs_at(hand_index=999, bankroll=0)), 0)
        ante = wrapped(spec=A.with_(ante=1))
        self.assertEqual(ante.max_future_loss(obs_at(A.with_(ante=1), hand_index=997,
                                                     bankroll=0, position=0)), 5)

    def test_locked_folds_or_checks_without_asking_inner(self):
        inner = Scripted(RaiseTo(10))
        lp = wrapped(inner)
        # 10 hands left after this one: at most 15 chips bleed; lead 100 is locked
        a = lp.act(obs_at(hand_index=989, bankroll=100))
        self.assertEqual(a.kind, FOLD)
        self.assertEqual(lp.last_mode, "lock")
        free = LegalActions(can_fold=True, can_check=True, can_raise=True, min_raise_to=4,
                            max_raise_to=200)
        self.assertEqual(lp.act(obs_at(hand_index=989, bankroll=100, position=1, my_committed=2,
                                       legal=free)).kind, CHECK)
        spec = get_variant("c")
        lpc = wrapped(Scripted(), spec=spec)
        o = obs_at(spec, hand_index=989, bankroll=100, phase="discard", street=1,
                   cards="AsKd2c", board="Qh8d5c", legal=LegalActions(discard_count=1))
        a = lpc.act(o)
        self.assertEqual(a.kind, DISCARD)
        self.assertTrue(o.legal.is_legal(a, o.my_cards))
        self.assertEqual(inner.calls, 0)

    def test_lock_counts_current_hand_commitment(self):
        lp = wrapped(Scripted(Call()))
        # lead 20 but 10 already in this pot and 15 of future blinds: not locked
        a = lp.act(obs_at(hand_index=989, bankroll=20, my_committed=10))
        self.assertEqual(a.kind, CALL)
        self.assertEqual(lp.last_mode, "pass")
        # lead exactly covering future blinds (no margin): not locked
        self.assertFalse(lp.locked(obs_at(hand_index=989, bankroll=16, my_committed=1)))
        self.assertTrue(lp.locked(obs_at(hand_index=989, bankroll=17, my_committed=1)))

    def test_passes_through_when_not_locked(self):
        inner = Scripted(RaiseTo(10))
        lp = wrapped(inner)
        a = lp.act(obs_at(hand_index=10, bankroll=100))
        self.assertEqual((a.kind, a.amount), (RAISE, 10))
        self.assertEqual(inner.calls, 1)

    def test_chips_mode_is_pass_through(self):
        lp = wrapped(Scripted(RaiseTo(10)), scoring="chips")
        a = lp.act(obs_at(hand_index=998, bankroll=500))
        self.assertEqual((a.kind, a.amount), (RAISE, 10))
        with self.assertRaises(ValueError):
            LeadProtection(Scripted(), scoring="bogus")

    def test_catch_up_shoves_good_hands_only(self):
        lp = wrapped(Scripted(Call()))
        # 100 hands left, deficit 1000 chips >> sqrt(100) * 20
        strong = lp.act(obs_at(hand_index=900, bankroll=-1000, cards="AsAd"))
        self.assertEqual((strong.kind, strong.amount), (RAISE, 200))
        self.assertEqual(lp.last_mode, "catchup")
        weak = lp.act(obs_at(hand_index=900, bankroll=-1000, cards="7c2d"))
        self.assertEqual(weak.kind, CALL)
        # same deficit early in the match: no catch-up
        early = lp.act(obs_at(hand_index=100, bankroll=-1000, cards="AsAd"))
        self.assertEqual(early.kind, CALL)
        # small deficit late: no catch-up
        small = lp.act(obs_at(hand_index=900, bankroll=-50, cards="AsAd"))
        self.assertEqual(small.kind, CALL)

    def test_delegates_lifecycle(self):
        inner = Scripted()
        lp = wrapped(inner)
        r = play_match(lp, make_dummy(kind="station"), A, deal_seed=1, hands=6)
        self.assertEqual(inner.hands, 6)
        self.assertEqual(r.hands_played, 6)

    def test_conformance_wrapper(self):
        probs = check_bot(lambda: LeadProtection(make("equity")), hands=8, verbose=False)
        self.assertEqual(probs, [], "\n".join(probs))

    def test_lock_preserves_win_in_real_match(self):
        # short matches so a lead locks quickly; a locked bot must finish ahead
        spec = A.with_(hands_per_match=30)
        locked_seen = 0
        for seed in range(6):
            lp = LeadProtection(make("equity"))
            modes = []
            orig = lp.act

            def act(obs, orig=orig, modes=modes, lp=lp):
                a = orig(obs)
                modes.append(lp.last_mode)
                return a
            lp.act = act
            r = play_match(lp, make_dummy(kind="station"), spec, deal_seed=seed)
            if "lock" in modes:
                locked_seen += 1
                self.assertGreater(r.total, 0)
        self.assertGreater(locked_seen, 0)


if __name__ == "__main__":
    unittest.main()
