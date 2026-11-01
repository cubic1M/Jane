"""Rehearsal kit adapter: kit Observation -> our observation, icm_tag decides, our Action -> kit Action.
Appended by sng/bundle.py after the bundled modules (so the sng.* / engine.* imports work).

Kit facts handled here (README): pot excludes this round's bets; committed = this round only
(antes excluded); stack excludes committed; hand_number is 1-based; raise amount is raise-TO
for the street; cards like 'Td'; statuses active/folded/allin/out; short deck with
flush > full house and trips > straight (engine.spec SHORT_DECK_ORDER); antes from level 3.
"""
import gc as _gc
from dataclasses import dataclass as _dc

from table_api import Action as KAction, Agent as KAgent

from engine.cards import parse_card as _pc
from engine.spec import SHORT_DECK_ORDER as _SDO, GameSpec as _GS
from sng.ours.icm_tag import IcmTag as _IcmTag

_SPEC = _GS(name="rehearsal_sixplus", deck_ranks=tuple(range(4, 13)), category_order=_SDO,
            starting_stack=2000, small_blind=10, big_blind=20, stack_reset_per_hand=False)
_STREET = {"preflop": 0, "flop": 1, "turn": 2, "river": 3}
_PAYOUTS = (100, 70, 50, 35, 25, 15, 5, 0)          # 1st..8th (kit lists 8th first)
_TABLE_OK = load_bundled_table(_SPEC)               # noqa: F821  (defined by the bundle loader)


class _Rules:
    spec = _SPEC
    num_players = 8
    payouts = _PAYOUTS


@_dc(frozen=True)
class _Seat:
    seat: int
    stack: int
    bet: int
    committed: int
    folded: bool
    all_in: bool
    in_hand: bool


@_dc(frozen=True)
class _Legal:
    can_check: bool
    can_call: bool
    call_amount: int
    can_raise: bool
    min_raise_to: int
    max_raise_to: int

    def passive(self):
        from engine.game import Call, Check
        return Check() if self.can_check else Call()

    def clamp(self, amount):
        return int(min(self.max_raise_to, max(self.min_raise_to, int(round(amount)))))


@_dc(frozen=True)
class _Obs:
    hand_number: int
    street: int
    seat: int
    button: int
    sb_seat: int
    bb_seat: int
    big_blind: int
    hole: tuple
    board: tuple
    pot: int
    my_stack: int
    my_bet: int
    legal: object
    seats: tuple
    history: tuple
    players_left: int


def _hist(events):
    """kit Events -> (seat, street, kind, amount) with blinds as 'post', antes dropped;
    also total chips committed this hand per seat (antes included)."""
    out, total, cur, street = [], [0] * 8, [0] * 8, -1
    for e in events:
        st = _STREET[e.street]
        if st != street:
            street, cur = st, [0] * 8
        k = e.kind
        if k == "ante":
            total[e.seat] += e.amount
            continue
        if k in ("sb", "bb"):
            cur[e.seat] += e.amount
            total[e.seat] += e.amount
            out.append((e.seat, st, "post", e.amount))
        elif k == "call":
            cur[e.seat] += e.amount
            total[e.seat] += e.amount
            out.append((e.seat, st, "call", e.amount))
        elif k == "raise":
            total[e.seat] += e.amount - cur[e.seat]
            cur[e.seat] = e.amount
            out.append((e.seat, st, "raise", e.amount))
        else:
            out.append((e.seat, st, k, 0))
    return tuple(out), total


class Bot(KAgent):
    def __init__(self):
        self.bot = _IcmTag()
        self.bot.new_table(_Rules, 0, 12345)
        self._seat_set = False
        _gc.collect()
        _gc.freeze()

    def _obs(self, o):
        hist, total = _hist(o.history)
        seats = tuple(_Seat(p.seat, p.stack, p.committed, total[p.seat], p.status == "folded",
                            p.status == "allin", p.status != "out") for p in o.players)
        me = o.players[o.seat]
        la = o.legal_actions
        legal = _Legal("check" in la, "call" in la, min(o.to_call, me.stack), "raise" in la,
                       o.min_raise_to, o.max_raise_to)
        pot = o.pot + sum(p.committed for p in o.players)
        return _Obs(o.hand_number - 1, _STREET[o.street], o.seat, o.button, o.small_blind_seat,
                    o.big_blind_seat, o.big_blind, tuple(_pc(c) for c in o.hole),
                    tuple(_pc(c) for c in o.board), pot, me.stack, me.committed, legal, seats, hist,
                    sum(1 for p in o.players if p.status != "out"))

    def decide(self, o):
        try:
            if not self._seat_set:
                self.bot.seat = o.seat
                self._seat_set = True
            a = self.bot.act(self._obs(o))
            if a.kind == "raise":
                return KAction.raise_(int(a.amount))
            if a.kind == "call":
                return KAction.call()
            if a.kind == "check" or "check" in o.legal_actions:
                return KAction.check()
            return KAction.fold()
        except Exception:  # noqa: BLE001  never lose a decision to an exception
            return KAction.check() if "check" in o.legal_actions else KAction.fold()

    def hand_over(self, summary):
        try:
            hist, _ = _hist(summary.history)
            self.bot.end_hand(dict(history=hist, stacks=summary.stacks))
        except Exception:  # noqa: BLE001
            pass
