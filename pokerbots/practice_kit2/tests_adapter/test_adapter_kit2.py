"""Tests for practice_kit2/adapter_kit2.py (plan A) and its flat bundle.

    cd pokerbots && python3 -m unittest discover -s practice_kit2/tests_adapter -t .
"""
import importlib.util
import itertools
import random
import sys
import tempfile
import unittest
from pathlib import Path

KIT = Path(__file__).resolve().parents[1]
ROOT = KIT.parent
for p in (str(ROOT), str(KIT)):
    if p not in sys.path:
        sys.path.insert(0, p)

from engine.cards import parse_card  # noqa: E402
from engine.game import Call, Check, Discard, Fold, RaiseTo  # noqa: E402
from simkit.agent import BotAgent, load_module_from_path  # noqa: E402
from simkit.table import Table  # noqa: E402

_n = itertools.count()


def load_adapter(invariants=False):
    """A fresh copy of the unbundled adapter (as the kit loads a bot: not in sys.modules)."""
    spec = importlib.util.spec_from_file_location(f"_kit2_adapter_{next(_n)}", KIT / "adapter_kit2.py")
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    m.INVARIANTS = invariants
    return m


def state(**kw):
    """A kit betting state: 4 seats, hand 3, preflop, seat 3 to act facing the big blind."""
    s = dict(type="action", hand_number=3, hands_remaining=197, level=1, small_blind=10, big_blind=20,
             ante=0, hands_left_in_level=22, street="preflop", board=[], hole_cards=["10H", "AS"],
             my_seat=3, num_seats=4, pot=0, current_bet=20, min_raise_by=20, can_raise=True,
             players=[dict(seat=0, chips_total=2000, chips_in_pot_this_round=0, status="active", drew=None),
                      dict(seat=1, chips_total=2000, chips_in_pot_this_round=10, status="active", drew=None),
                      dict(seat=2, chips_total=2000, chips_in_pot_this_round=20, status="active", drew=None),
                      dict(seat=3, chips_total=2000, chips_in_pot_this_round=0, status="active", drew=None)],
             history=[dict(street="preflop", seat=1, action="small_blind", amount=10),
                      dict(street="preflop", seat=2, action="big_blind", amount=20)],
             time_limit_ms=1.0)
    s.update(kw)
    return s


class Cards(unittest.TestCase):
    def test_ten_and_upper_case_suits(self):
        m = load_adapter()
        self.assertEqual(m.kit_card("10H"), parse_card("Th"))
        self.assertEqual(m.kit_card("AS"), parse_card("As"))
        self.assertEqual(m.kit_card("2C"), parse_card("2c"))
        kit = [r + s for r in ("2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A") for s in "CDHS"]
        self.assertEqual(sorted(m.kit_card(c) for c in kit), list(range(52)))

    def test_spec_matches_draw_after_flop_preset_and_table(self):
        from sng.ours import features as F
        from sng.ours.anyvar import table_path
        from sng.presets import PRESETS
        m = load_adapter()
        self.assertEqual(F.card_signature(m._SPEC), F.card_signature(PRESETS["draw_after_flop"]["spec"]))
        self.assertTrue(table_path(m._SPEC).exists())


class Rebuild(unittest.TestCase):
    def test_antes_blinds_calls_raise_to(self):
        m = load_adapter()
        hist = [dict(street="preflop", seat=0, action="ante", amount=10),
                dict(street="preflop", seat=1, action="ante", amount=10),
                dict(street="preflop", seat=2, action="ante", amount=5),          # short: all-in
                dict(street="preflop", seat=0, action="small_blind", amount=50),
                dict(street="preflop", seat=1, action="big_blind", amount=100),
                dict(street="preflop", seat=2, action="fold", amount=0),
                dict(street="preflop", seat=0, action="raise", amount=200, to=300),
                dict(street="preflop", seat=1, action="call", amount=200),
                dict(street="flop", seat=1, action="check", amount=0),
                dict(street="flop", seat=0, action="raise", amount=100, to=100),
                dict(street="flop", seat=1, action="raise", amount=200, to=300),
                dict(street="flop", seat=0, action="call", amount=200),
                dict(street="draw", seat=1, action="draw", amount=1),
                dict(street="draw", seat=0, action="draw", amount=0)]
        ids = [5, 0, 2]
        out, total, cur, last = m.rebuild(hist, ids, 3)
        self.assertEqual(total, [610, 610, 5])
        self.assertEqual(last, "draw")
        self.assertEqual(out[:2], [(5, 0, "post", 50), (0, 0, "post", 100)])
        self.assertIn((5, 0, "raise", 300), out)             # raise amount = raise-TO
        self.assertIn((0, 1, "raise", 300), out)
        self.assertFalse(any(k in ("ante", "draw") for _, _, k, _ in out))


class Observation(unittest.TestCase):
    def test_fields(self):
        m = load_adapter()
        b = m.Kit2Bot()
        o = b.observe(state())
        self.assertEqual(o.hand_number, 2)
        self.assertEqual(o.hands_left, 197)
        self.assertEqual(o.seat, 0)
        self.assertEqual((o.button, o.sb_seat, o.bb_seat), (1, 2, 3))   # seats 0,1,2 are 1,2,3 places on
        self.assertEqual(o.pot, 30)                                     # incl. this round's bets
        self.assertEqual((o.my_stack, o.my_bet), (2000, 0))
        lg = o.legal
        self.assertEqual((lg.can_check, lg.can_call, lg.call_amount, lg.can_raise), (False, True, 20, True))
        self.assertEqual((lg.min_raise_to, lg.max_raise_to), (40, 2000))
        self.assertEqual(o.seats[3].stack, 1980)                        # bb: chips behind
        self.assertEqual(o.seats[3].committed, 20)
        self.assertFalse(o.seats[5].in_hand)
        self.assertEqual(o.history, ((2, 0, "post", 10), (3, 0, "post", 20)))
        self.assertEqual(o.players_left, 4)
        self.assertEqual(o.places_paid[-1], (4, 100))

    def test_heads_up_blinds_and_draw_phase(self):
        m = load_adapter()
        b = m.Kit2Bot()
        s = state(num_seats=2, my_seat=1, street="draw", type="draw", current_bet=0, min_raise_by=0,
                  can_raise=False, board=["10H", "AS", "3D"], hole_cards=["KC", "10D"], pot=40,
                  players=[dict(seat=k, chips_total=1980, chips_in_pot_this_round=0, status="active",
                                drew=None) for k in range(2)],
                  history=[dict(street="preflop", seat=0, action="small_blind", amount=10),
                           dict(street="preflop", seat=1, action="big_blind", amount=20),
                           dict(street="preflop", seat=0, action="call", amount=10),
                           dict(street="preflop", seat=1, action="check", amount=0)])
        o = b.observe(s)
        self.assertEqual((o.button, o.sb_seat, o.bb_seat), (1, 1, 0))
        self.assertEqual(o.phase, "discard")
        self.assertEqual(o.street, 1)
        self.assertEqual((o.legal.discard_count, o.legal.discard_min), (1, 0))
        r = b.decide(s)
        self.assertEqual(set(r), {"discard"})
        self.assertIn(r["discard"], (None, "KC", "10D"))


class Reply(unittest.TestCase):
    def setUp(self):
        self.m = load_adapter()
        self.b = self.m.Kit2Bot()

    def rep(self, a, s):
        return self.b.reply(a, s, self.b.observe(s))

    def test_raise_to_becomes_raise_by(self):
        s = state()
        self.assertEqual(self.rep(RaiseTo(60), s), {"action": "raise", "amount": 40})
        self.assertEqual(self.rep(RaiseTo(10 ** 6), s), {"action": "raise", "amount": 1980})   # all-in
        self.assertIs(type(self.rep(RaiseTo(60), s)["amount"]), int)

    def test_never_check_facing_a_bet_never_fold_free(self):
        s = state()
        self.assertEqual(self.rep(Check(), s), {"action": "fold"})
        self.assertEqual(self.rep(Call(), s), {"action": "call"})
        free = state(my_seat=2)
        self.assertEqual(self.rep(Fold(), free), {"action": "check"})
        self.assertEqual(self.rep(Call(), free), {"action": "check"})

    def test_raise_when_kit_says_no_raise(self):
        s = state(can_raise=False)
        self.assertEqual(self.rep(RaiseTo(60), s), {"action": "call"})

    def test_discard_card_string_as_given(self):
        s = state(type="draw", street="draw", current_bet=0, min_raise_by=0, can_raise=False,
                  board=["2C", "3D", "4H"], players=[dict(p, chips_in_pot_this_round=0) for p in state()["players"]])
        self.assertEqual(self.rep(Discard((parse_card("Th"),)), s), {"discard": "10H"})
        self.assertEqual(self.rep(Discard(()), s), {"discard": None})

    def test_exception_gives_safe_reply(self):
        s = state()
        s["players"] = None                       # broken state
        self.assertEqual(self.b.decide(dict(s, players=[dict(seat=3, chips_total=1, chips_in_pot_this_round=0)] * 4,
                                            hole_cards=["XX", "YY"])), {"action": "fold"})


def kit_numbering(alive, button):
    """Kit seats this hand: alive players clockwise from the button (absolute positions)."""
    n = len(alive)
    i = alive.index(button)
    return [alive[(i + k) % n] for k in range(n)]


class StableIds(unittest.TestCase):
    def test_mapping_across_knockouts_synthetic(self):
        m = load_adapter()
        rng = random.Random(3)
        for trial in range(300):
            n0 = rng.randint(2, 8)
            me = rng.randrange(n0)
            alive = list(range(n0))
            button = rng.randrange(n0)
            seat = m.Seating()
            ident = {}
            hand = 0
            while len(alive) >= 2 and me in alive:
                hand += 1
                order = kit_numbering(alive, button)
                ids = seat.for_hand(hand, order.index(me), len(order))
                for k, player in enumerate(order):
                    ident.setdefault(player, ids[k])
                    self.assertEqual(ident[player], ids[k], f"trial {trial} hand {hand}")
                self.assertEqual(ids[order.index(me)], 0)
                # clockwise from me = increasing ids
                mine = order.index(me)
                cw = [ids[(mine + d) % len(order)] for d in range(len(order))]
                self.assertEqual(cw, sorted(cw))
                # knock out 0-3 players (never everyone), the button among them sometimes
                out = [p for p in alive if rng.random() < 0.2][:len(alive) - 1]
                seat.knock_out(hand, mine, len(order), [order.index(p) for p in out])
                prev = button
                alive = [p for p in alive if p not in out]
                if alive:
                    # the button moves one bot clockwise (absolute), skipping knocked-out bots
                    j = (prev + 1) % n0
                    while j not in alive:
                        j = (j + 1) % n0
                    button = j
            self.assertEqual(seat.resets, 0)

    def test_mapping_in_the_kit_engine(self):
        """Real kit tables with short stacks (many knockouts): each opponent keeps one id."""
        for t in range(6):
            mods = []

            def loader():
                mods.append(load_adapter(invariants=True))
                return mods[-1]

            agents = [BotAgent("ours", loader, enforce_time=False)]
            for i in range(7):
                agents.append(BotAgent.from_file(f"opp{i}", KIT / "bots" / ("sample_shover.py", "sample_caller.py")[i % 2],
                                                 enforce_time=False))
            random.Random(t).shuffle(agents)
            ident, seen_ko = {}, [0]

            def observer(table):
                bot = mods[-1]._BOT
                me = next((h for h in table.hp if h.e.name == "ours"), None)
                if me is None or bot.seating.hand != table.hand_no:     # knocked out earlier
                    return
                for h in table.hp:
                    i = bot.seating.ids[h.seat]
                    ident.setdefault(h.e.name, i)
                    self.assertEqual(ident[h.e.name], i, f"table {t} hand {table.hand_no}")
                self.assertEqual(bot.seating.ids[me.seat], 0)
                seen_ko[0] = max(seen_ko[0], 8 - len(table.hp))

            tb = Table(agents, seed=100 + t, stacks=[400] * 8, hand_observer=observer)
            tb.play()
            ours = next(a for a in agents if a.name == "ours")
            self.assertEqual(ours.stats.errors, 0, ours.stats.messages[:3])
            self.assertEqual(mods[-1]._BOT.seating.resets, 0)
            self.assertGreaterEqual(len(set(ident.values())), 2)
        self.assertGreater(seen_ko[0], 0)

    def test_missed_hand_end_with_knockout_resets(self):
        m = load_adapter()
        s = m.Seating()
        s.for_hand(1, 0, 8)
        self.assertEqual(s.for_hand(2, 0, 6), [0, 1, 2, 3, 4, 5])
        self.assertEqual(s.resets, 1)


class InvariantMode(unittest.TestCase):
    def test_kit_tables_no_violations(self):
        for t in range(3):
            agents = [BotAgent("ours", lambda: load_adapter(invariants=True), enforce_time=False)]
            for i in range(7):
                agents.append(BotAgent.from_file(f"o{i}", KIT / "bots" / ("sample_tight.py", "sample_caller.py",
                                                                           "sample_shover.py")[i % 3],
                                                 enforce_time=False))
            random.Random(t).shuffle(agents)
            Table(agents, seed=t).play()
            ours = next(a for a in agents if a.name == "ours")
            self.assertEqual(ours.stats.errors, 0, ours.stats.messages[:3])
            self.assertEqual(ours.stats.init_failures, 0)


    def test_a_violation_is_reported_through_on_hand_end(self):
        m = load_adapter(invariants=True)
        m._BOT._bad(state(), "forced")
        summary = dict(hand_number=3, my_seat=3, chips_after={"0": 2000, "1": 2000, "2": 2000, "3": 2000},
                       net={"0": 0, "1": 0, "2": 0, "3": 0}, knocked_out_seats=[], history=state()["history"])
        m._BOT.total_chips = 8000
        with self.assertRaises(AssertionError):
            m.on_hand_end(summary)
        m.on_hand_end(dict(summary, hand_number=4))        # reported once only


class FlatBundle(unittest.TestCase):
    def test_bundle_passes_check_and_plays(self):
        from check_bot import check_file
        from sng import bundle_flat
        from sng.ours.anyvar import table_path
        m = load_adapter()
        with tempfile.TemporaryDirectory() as d:
            out = bundle_flat.build(KIT / "adapter_kit2.py", Path(d) / "bot.py", table_path(m._SPEC))
            self.assertEqual(check_file(out), [])
            mod = load_module_from_path(out)              # the kit's loader (not in sys.modules)
            self.assertTrue(mod._ANY_OK)
            agents = [BotAgent.from_file("ours", out, enforce_time=False)]
            for i in range(7):
                agents.append(BotAgent.from_file(f"o{i}", KIT / "bots" / "sample_tight.py", enforce_time=False))
            Table(agents, seed=5).play()
            self.assertEqual(agents[0].stats.errors, 0, agents[0].stats.messages[:3])
            self.assertEqual(agents[0].stats.init_failures, 0)
            self.assertGreater(agents[0].stats.decisions, 0)


if __name__ == "__main__":
    unittest.main()
