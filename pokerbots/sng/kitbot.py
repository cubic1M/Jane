"""Reverse adapter: run a bot written for the rehearsal kit (rehearsal_sng/kit/table_api.py)
inside our arena, so it can be a field bot or a candidate on paired tables.

Our observation -> kit Observation (pot without this round's bets; committed = this round;
statuses; card strings; 1-based hand numbers and levels; Events with sb/bb kinds and the
kit's call = chips added, raise = raise-to), kit Action -> our Action (the kit's lenient
rules: a raise below the minimum = minimum, above the maximum = all-in; an illegal check =
fold). Antes are not in our history; kit bots that read ante events see none.

    make("planb_sd")       # rehearsal_sng/planb/bot.py (six-plus only: its tables are short deck)
"""
from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

from engine.cards import card_str
from engine.game import Call, Check, Fold, RaiseTo

ROOT = Path(__file__).resolve().parents[1]
KIT = ROOT / "rehearsal_sng" / "kit"
_STREETS = ("preflop", "flop", "turn", "river")
_MODS: dict = {}


def _kit_api():
    if str(KIT) not in sys.path:
        sys.path.append(str(KIT))          # appended: our `engine` package still wins
    import table_api                       # noqa: E402  (the kit's module)
    return table_api


def _load(path: Path):
    m = _MODS.get(path)
    if m is None:
        _kit_api()
        spec = importlib.util.spec_from_file_location(f"_kitbot_{len(_MODS)}", path)
        m = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(m)
        _MODS[path] = m
    return m


def _events(api, history):
    out, posts = [], 0
    for seat, st, kind, amt in history:
        if kind == "post":
            kind = "sb" if posts == 0 else "bb"
            posts += 1
        elif kind not in ("fold", "check", "call", "raise"):
            continue                       # discards etc.: not in the kit's vocabulary
        out.append(api.Event(_STREETS[min(st, 3)], seat, kind, int(amt)))
    return tuple(out)


class KitBot:
    """Wraps a kit `Bot` class (decide(obs) / hand_over(summary)) as an arena bot."""

    path: Path = ROOT / "rehearsal_sng" / "planb" / "bot.py"

    def __init__(self, path: str | None = None):
        if path:
            self.path = Path(path)
        self.api = _kit_api()
        self.mod = _load(self.path)

    def new_table(self, rules, seat, seed=0):
        self.rules, self.seat = rules, seat
        self.bot = self.mod.Bot()

    def _obs(self, o):
        api, r = self.api, self.rules
        players = tuple(api.PlayerInfo(sv.seat, sv.stack, sv.bet,
                                       "out" if not sv.in_hand else "folded" if sv.folded
                                       else "allin" if sv.all_in else "active")
                        for sv in o.seats)
        lg = o.legal
        la = {"fold"}
        if lg.can_check:
            la.add("check")
        if lg.can_call:
            la.add("call")
        if lg.can_raise:
            la.add("raise")
        cur = max(sv.bet for sv in o.seats)
        if o.street == 0:
            cur = max(cur, o.big_blind)
        lv = r.level(o.hand_number)
        return api.Observation(
            hand_number=o.hand_number + 1, level=lv + 1, small_blind=o.small_blind, big_blind=o.big_blind,
            ante=o.ante, seat=o.seat, button=o.button, small_blind_seat=o.sb_seat, big_blind_seat=o.bb_seat,
            street=_STREETS[min(o.street, 3)], hole=tuple(card_str(c) for c in o.hole),
            board=tuple(card_str(c) for c in o.board), players=players,
            pot=o.pot - sum(sv.bet for sv in o.seats), to_call=max(0, cur - o.my_bet),
            min_raise_to=lg.min_raise_to if lg.can_raise else 0,
            max_raise_to=lg.max_raise_to if lg.can_raise else 0,
            legal_actions=frozenset(la), history=_events(api, o.history),
            max_hands=r.max_hands, time_limit_ms=1.0)

    def act(self, o):
        lg = o.legal
        if getattr(lg, "discard_count", 0):
            raise RuntimeError("kit bots do not handle discard phases")
        a = self.bot.decide(self._obs(o))
        kind = getattr(a, "kind", None)
        if kind == "raise" and lg.can_raise:
            return RaiseTo(lg.clamp(a.amount))
        if kind == "raise":
            return Call() if lg.can_call else Check()
        if kind == "call" and lg.can_call:
            return Call()
        if kind == "check" and lg.can_check:
            return Check()
        if kind == "call" and lg.can_check:
            return Check()
        return Fold()

    def end_hand(self, info):
        fn = getattr(self.bot, "hand_over", None)
        if fn is None:
            return
        api = self.api
        fn(api.HandSummary(hand_number=info.get("hand_number", 0) + 1, board=(), shown={}, won=(),
                           stacks=tuple(info.get("stacks", ())), busted=(),
                           history=_events(api, info["history"])))
