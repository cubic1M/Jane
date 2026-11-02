"""Reverse kit adapter (sng/kitbot.py): kit bots inside our arena."""
import unittest

from sng.presets import PRESETS
from sng.registry import make
from sng.rules import SngRules
from sng.table import play_table


def rules(**kw):
    return SngRules(enforce_time=False, **dict(PRESETS["rehearsal_sixplus"], **kw))


class Spy:
    """Wraps a KitBot and checks every translated observation against ours."""

    def __init__(self, inner, test):
        self.inner, self.t, self.n = inner, test, 0

    def new_table(self, r, seat, seed=0):
        self.inner.new_table(r, seat, seed)

    def end_hand(self, info):
        self.inner.end_hand(info)

    def act(self, o):
        k = self.inner._obs(o)
        self.n += 1
        t = self.t
        t.assertEqual(k.pot + sum(p.committed for p in k.players), o.pot)
        t.assertEqual(k.hand_number, o.hand_number + 1)
        t.assertEqual(k.players[o.seat].stack, o.my_stack)
        t.assertEqual(k.players[o.seat].committed, o.my_bet)
        t.assertEqual(min(k.to_call, o.my_stack), o.legal.call_amount)
        t.assertEqual(("raise" in k.legal_actions), o.legal.can_raise)
        if o.street == 0 and o.history:
            t.assertEqual(k.history[0].kind, "sb")
        out = sum(1 for p in k.players if p.status == "out")
        t.assertEqual(8 - out, o.players_left)
        return self.inner.act(o)


class TestKitBot(unittest.TestCase):
    def test_planb_plays_legally_and_translates_exactly(self):
        for seed in range(3):
            spy = Spy(make("planb_sd"), self)
            bots = [spy] + [make(x) for x in ("icm_tag", "planb_sd", "push", "station", "lag", "nit", "planb_sd")]
            res = play_table(bots, rules(max_hands=120), seed=seed)
            for i in (0, 2, 7):
                self.assertEqual(res.stats[i].errors + res.stats[i].illegal, 0, res.stats[i].first_error)
            self.assertGreater(spy.n, 50)

    def test_planb_is_deterministic(self):
        def once():
            bots = [make("planb_sd") for _ in range(8)]
            return play_table(bots, rules(max_hands=80), seed=4).points
        self.assertEqual(once(), once())


class TestBehindK(unittest.TestCase):
    def test_validated_default_and_legal_settings(self):
        from sng.ours.icm_tag import PARAMS
        self.assertEqual(PARAMS["behind_k"], 0.2)                  # validated on fresh seeds
        for bk in (0.0, 0.8):
            bots = [make(f"icm_tag:behind_k={bk}")] + [make(x) for x in ("lag", "maniac", "chen_tag", "push",
                                                                          "station", "nit", "f2_shark")]
            res = play_table(bots, SngRules(enforce_time=False, max_hands=120), seed=1)
            self.assertEqual(res.stats[0].errors + res.stats[0].illegal, 0, res.stats[0].first_error)


if __name__ == "__main__":
    unittest.main()
