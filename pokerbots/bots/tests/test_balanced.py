"""Tests for bots/balanced.py (python3 -m unittest bots.tests.test_balanced)."""
from __future__ import annotations

import unittest

from engine.cards import cards_str, parse_cards
from engine.game import CALL, CHECK, DISCARD, FOLD, RAISE, Call, Check, HandState, RaiseTo
from engine.match import play_match
from engine.variants import VARIANTS, get_variant
from bots.balanced import ADJUSTABLE, DEFAULT_PARAMS, BalancedBot, make_bot
from bots.random_legal import RandomLegalBot


class _Stop(Exception):
    pass


def spot(spec, sb_cards, bb_cards, board, script):
    """Observation at the decision after `script` (a list of actions) has been played.
    Cards are strings; the deck is ordered SB hole, BB hole, board, then the rest."""
    sb, bb, bd = parse_cards(sb_cards), parse_cards(bb_cards), parse_cards(board)
    used = set(sb + bb + bd)
    order = sb + bb + bd + [c for c in spec.deck if c not in used]
    state = HandState(spec, order)
    script = list(script)
    captured = {}

    def decide(pos, obs):
        if script:
            return script.pop(0)
        captured["obs"] = obs
        raise _Stop

    try:
        state.play(decide)
    except _Stop:
        return captured["obs"]
    raise AssertionError("hand ended before the target decision")


def bot_for(spec, seed=0, **params):
    b = BalancedBot(params=params or None)
    b.new_match(spec, seed)
    return b


def kinds(spec, obs, seeds, **params):
    out = []
    for s in seeds:
        b = bot_for(spec, s, **params)
        a = b.act(obs)
        assert obs.legal.is_legal(a, obs.my_cards), a
        assert b.errors == 0, b.last_error
        out.append(a.kind)
    return out


A = get_variant("a")


class TestApi(unittest.TestCase):
    def test_make_bot_and_name(self):
        b = make_bot()
        self.assertIsInstance(b, BalancedBot)
        self.assertEqual(b.name, "balanced")

    def test_params_override_and_validation(self):
        b = BalancedBot(params={"bluff_freq": 0.0})
        self.assertEqual(b.params["bluff_freq"], 0.0)
        self.assertEqual(DEFAULT_PARAMS["bluff_freq"], BalancedBot().params["bluff_freq"])
        self.assertIsNot(b.params, DEFAULT_PARAMS)
        with self.assertRaises(KeyError):
            BalancedBot(params={"no_such_param": 1})

    def test_adjustable_bounds(self):
        for k, (lo, hi) in ADJUSTABLE.items():
            self.assertIn(k, DEFAULT_PARAMS)
            self.assertLessEqual(lo, DEFAULT_PARAMS[k], k)
            self.assertLessEqual(DEFAULT_PARAMS[k], hi, k)


class TestLegality(unittest.TestCase):
    def test_all_variants_vs_random_and_self(self):
        for spec in VARIANTS.values():
            for opp in (RandomLegalBot(), BalancedBot()):
                bot = BalancedBot()
                for pair in ((bot, opp), (opp, bot)):
                    r = play_match(pair[0], pair[1], spec, deal_seed=3, hands=24)
                    for st in r.stats:
                        s = st.summary()
                        self.assertEqual(s["illegal"], 0, spec.name)
                        self.assertEqual(s["errors"], 0, (spec.name, s["first_error"]))
                self.assertEqual(bot.errors, 0, (spec.name, bot.last_error))

    def test_postflop_works_after_any_preflop(self):
        class Limper(BalancedBot):  # a subclass that replaces preflop play
            def preflop_action(self, obs):
                lg = obs.legal
                if lg.can_raise and obs.hand_index % 3 == 0:
                    return RaiseTo(lg.clamp_raise(obs.opp_pip * 4))
                return lg.passive()
        for name in ("a", "c", "d"):
            spec = get_variant(name)
            bot = Limper()
            r = play_match(bot, RandomLegalBot(), spec, deal_seed=5, hands=40)
            self.assertEqual(r.stats[0].summary()["errors"], 0)
            self.assertEqual(bot.errors, 0, bot.last_error)

    def test_tight_clock_still_legal(self):
        spec = A.with_(time_per_decision=0.004, time_per_match=0.5)
        bot = BalancedBot()
        r = play_match(bot, RandomLegalBot(), spec, deal_seed=9, hands=40)
        s = r.stats[0].summary()
        self.assertEqual(s["illegal"] + s["errors"], 0)
        self.assertEqual(bot.errors, 0, bot.last_error)


class TestSpots(unittest.TestCase):
    def test_river_nuts_bets_and_raises(self):
        # SB: As Ks on Qs Js Ts 4d 2c = royal flush. Lines: limp/check down to the river.
        pre = [Call(), Check()]
        flop = [Check(), Check()]
        turn = [Check(), Check()]
        obs = spot(A, "AsKs", "7h6d", "QsJsTs4d2c", pre + flop + turn + [Check()])
        self.assertEqual(obs.street, 3)
        self.assertTrue(all(k == RAISE for k in kinds(A, obs, range(20))))
        # facing a river bet: raise
        obs = spot(A, "AsKs", "7h6d", "QsJsTs4d2c", pre + flop + turn + [RaiseTo(4)])
        self.assertTrue(all(k == RAISE for k in kinds(A, obs, range(20))))

    def test_air_facing_all_in_folds(self):
        pre = [Call(), Check()]
        obs = spot(A, "7d2c", "KhKc", "AsKd8h5c3s",
                   pre + [Check(), Check(), Check(), Check(), RaiseTo(196)])
        self.assertEqual((obs.position, obs.street, obs.legal.call_amount), (0, 3, 196))
        self.assertTrue(all(k == FOLD for k in kinds(A, obs, range(20))))

    def test_preflop_premium_vs_trash(self):
        # SB first to act at 100bb: AA never folds, 72o never raises
        aa = spot(A, "AhAd", "7c2s", "", [])
        self.assertTrue(all(k == RAISE for k in kinds(A, aa, range(10))))
        trash = spot(A, "7h2d", "AcAs", "", [])
        self.assertTrue(all(k != RAISE for k in kinds(A, trash, range(10))))
        # BB facing an all-in: call with AA, fold 72o
        obs = spot(A, "Kc2s", "AhAd", "", [RaiseTo(200)])
        self.assertTrue(all(k == CALL for k in kinds(A, obs, range(10))))
        obs = spot(A, "AcAs", "7h2d", "", [RaiseTo(200)])
        self.assertTrue(all(k == FOLD for k in kinds(A, obs, range(10))))

    def test_short_stack_shove_range_is_sane(self):
        spec = get_variant("f").with_(starting_stack=20)  # 10bb: push/fold
        aa = spot(spec, "AhAd", "7c2s", "", [])
        b = bot_for(spec)
        a = b.act(aa)
        self.assertEqual((a.kind, a.amount), (RAISE, aa.legal.max_raise_to))
        trash = spot(spec, "7h2d", "AcAs", "", [])
        self.assertTrue(all(k == FOLD for k in kinds(spec, trash, range(10))))
        # share of random SB hands shoved: wide but not everything (shove_k / 10bb = 75%)
        b = bot_for(spec, 1)
        shoves = n = 0
        for _ in range(160):
            deck = list(spec.deck)
            b.rng.shuffle(deck)
            obs = spot(spec, cards_str(deck[:2]).replace(" ", ""),
                       cards_str(deck[2:4]).replace(" ", ""), "", [])
            a = b.act(obs)
            n += 1
            if a.kind == RAISE:
                self.assertEqual(a.amount, obs.legal.max_raise_to)  # only all-ins
                shoves += 1
        self.assertGreater(shoves / n, 0.55)
        self.assertLess(shoves / n, 0.92)

    def test_discard_keeps_the_pair(self):
        spec = get_variant("c")
        # BB discards first after the flop; BB holds As Ah 2c on Kd 7s 4h
        obs = spot(spec, "9c8c3d", "AsAh2c", "Kd7s4h", [Call(), Check()])
        self.assertEqual(obs.phase, "discard")
        b = bot_for(spec)
        a = b.act(obs)
        self.assertEqual(a.kind, DISCARD)
        self.assertEqual(a.cards, tuple(parse_cards("2c")))

    def test_strength_in_range_and_narrows_vs_aggression(self):
        pre = [Call(), Check()]
        # BB holds a medium pair on the flop; compare checked-to vs facing a pot bet+raise
        obs_free = spot(A, "Kc9d", "8h8d", "Qs7c2h", pre + [Check()])
        obs_raise = spot(A, "Kc9d", "8h8d", "Qs7c2h", pre + [RaiseTo(4), RaiseTo(16)])
        b = bot_for(A, 0)
        e_free = b.strength(obs_free)
        e_raise = b.strength(obs_raise)
        for e in (e_free, e_raise):
            self.assertGreaterEqual(e, 0.0)
            self.assertLessEqual(e, 1.0)
        self.assertLess(e_raise, e_free - 0.1)


class TestRandomness(unittest.TestCase):
    def river_air_checked_to(self):
        # SB (in position) with air on the river after BB checks
        return spot(A, "7d2c", "KhKc", "AsKd8h5c3s",
                    [Call(), Check(), Check(), Check(), Check(), Check(), Check()])

    def test_mixing_happens(self):
        obs = self.river_air_checked_to()
        ks = kinds(A, obs, range(80))
        self.assertIn(CHECK, ks)
        self.assertIn(RAISE, ks)   # river bluffs at bluff_freq_river

    def test_params_change_behaviour(self):
        obs = self.river_air_checked_to()
        self.assertTrue(all(k == CHECK for k in kinds(A, obs, range(30), bluff_freq_river=0.0)))
        self.assertTrue(all(k == RAISE for k in kinds(A, obs, range(30), bluff_freq_river=1.0)))

    def test_params_read_at_every_decision(self):
        obs = self.river_air_checked_to()
        b = bot_for(A, 0)
        b.params["bluff_freq_river"] = 1.0
        self.assertEqual(b.act(obs).kind, RAISE)
        b.params["bluff_freq_river"] = 0.0
        self.assertEqual(b.act(obs).kind, CHECK)

    def test_seeded_reproducibility(self):
        spec = get_variant("c")

        def actions(seed):
            r = play_match(BalancedBot(), RandomLegalBot(), spec, deal_seed=11, hands=30,
                           bot_seeds=(seed, 6), record=True)
            return [lg["actions"] for lg in r.logs]

        self.assertEqual(actions(5), actions(5))
        # same cards, same opponent seed, different bot seed: play differs somewhere
        self.assertNotEqual(actions(5), actions(99))


if __name__ == "__main__":
    unittest.main()
