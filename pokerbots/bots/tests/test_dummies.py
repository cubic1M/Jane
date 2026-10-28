"""Tests for the dummy opponents (bots/dummies.py)."""
import unittest

from engine.bot import Bot
from engine.conformance import check_bot
from engine.game import CALL, CHECK, DISCARD, FOLD, RAISE
from engine.match import play_match
from engine.variants import VARIANTS

from bots.dummies import make_bot
from bots.random_legal import RandomLegalBot
from bots.registry import make


class Recorder(Bot):
    """Wraps a bot and records (obs, action) pairs."""

    def __init__(self, inner):
        self.inner = inner
        self.name = inner.name
        self.log = []

    def new_match(self, spec, seed=0):
        super().new_match(spec, seed)
        self.inner.new_match(spec, seed)

    def act(self, obs):
        a = self.inner.act(obs)
        self.log.append((obs, a))
        return a


def record(kind, hands=40):
    out = []
    for spec in VARIANTS.values():
        for seat in (0, 1):
            rec = Recorder(make_bot(kind=kind))
            pair = (rec, RandomLegalBot()) if seat == 0 else (RandomLegalBot(), rec)
            play_match(pair[0], pair[1], spec, deal_seed=3 + seat, hands=hands)
            out.extend(rec.log)
    return out


class TestDummies(unittest.TestCase):
    def test_registry(self):
        for kind in ("push", "station", "maniac"):
            self.assertEqual(make(kind).name, kind)
        with self.assertRaises(ValueError):
            make_bot(kind="nope")

    def test_conformance_all_variants(self):
        for kind in ("push", "station", "maniac"):
            with self.subTest(kind=kind):
                probs = check_bot(lambda: make(kind), hands=15, verbose=False)
                self.assertEqual(probs, [], "\n".join(probs))

    def test_all_actions_legal(self):
        for kind in ("push", "station", "maniac"):
            for obs, a in record(kind, hands=20):
                if obs.phase == "discard":
                    self.assertTrue(obs.legal.is_legal(a, obs.my_cards))
                else:
                    self.assertTrue(obs.legal.is_legal(a))

    def test_push_always_shoves(self):
        log = record("push")
        n_raise = 0
        for obs, a in log:
            lg = obs.legal
            if obs.phase == "discard":
                self.assertEqual(a.kind, DISCARD)
            elif lg.can_raise:
                self.assertEqual((a.kind, a.amount), (RAISE, lg.max_raise_to))
                n_raise += 1
            else:
                self.assertIn(a.kind, (CALL, CHECK))
        self.assertGreater(n_raise, 50)

    def test_station_never_folds_or_raises(self):
        for obs, a in record("station"):
            if obs.phase == "discard":
                self.assertEqual(a.kind, DISCARD)
            else:
                self.assertNotIn(a.kind, (FOLD, RAISE))
                self.assertEqual(a.kind, CHECK if obs.legal.can_check else CALL)

    def test_maniac_raises_often_and_big(self):
        log = [(o, a) for o, a in record("maniac") if o.phase == "bet"]
        raisable = [(o, a) for o, a in log if o.legal.can_raise]
        raises = [(o, a) for o, a in raisable if a.kind == RAISE]
        self.assertGreater(len(raises), 0.5 * len(raisable))
        self.assertFalse(any(a.kind == FOLD for _, a in log))
        for o, a in raises:
            call = o.legal.call_amount
            pot_raise = o.legal.clamp_raise(o.my_pip + call + o.pot + call)
            self.assertGreaterEqual(a.amount, pot_raise)
            self.assertLessEqual(a.amount, o.legal.max_raise_to)

    def test_discard_lowest(self):
        for kind in ("push", "station", "maniac"):
            for obs, a in record(kind, hands=10):
                if obs.phase == "discard":
                    low = min(c >> 2 for c in obs.my_cards)
                    self.assertEqual(a.cards[0] >> 2, low)


if __name__ == "__main__":
    unittest.main()
