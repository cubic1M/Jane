"""Template: run one of our sit-and-go bots behind the organisers' Agent interface.

The kit's interface is unknown until the day. Fill in the four TODO translations
(state -> SngObservation, our Action -> their action, table start, hand end); every
other line stays. Self-checks print one warning each to stderr when the translation
looks wrong (pot vs committed chips, chip total, blinds vs schedule, raise bounds),
so a mapping bug shows up in the first local game instead of in a scored round.

Design rules for the 1 ms limit:
  * everything heavy (tables, bot construction) happens at import or table start;
  * act() never allocates much and never raises: any exception returns check/fold;
  * gc.freeze() after loading, so the collector does not walk the tables mid-hand.
"""
from __future__ import annotations

import gc
import sys

from engine.cards import parse_card
from engine.game import CALL, CHECK, FOLD, RAISE
from sng.registry import make
from sng.rules import SngRules
from sng.table import Legal, SeatView, SngObservation

BOT_NAME = "icm_tag"
RULES = SngRules()            # TODO on the day: the kit's blinds, antes, payouts, variant spec
_warned = set()


def warn(key, msg):
    if key not in _warned:
        _warned.add(key)
        print(f"[adapter] {msg}", file=sys.stderr)


def card(c) -> int:
    """TODO: their card format -> our int (rank << 2 | suit). E.g. 'Ah', 'Td' or '10d'."""
    return parse_card(str(c).replace("10", "T"))


class Adapter:
    def __init__(self):
        self.bot = make(BOT_NAME)
        self.table_started = False
        gc.collect()
        gc.freeze()

    # ---- TODO 1: table start ----------------------------------------------------------
    def start_table(self, my_seat: int, seed: int = 0):
        self.bot.new_table(RULES, my_seat, seed)
        self.table_started = True

    # ---- TODO 2: their state -> SngObservation -------------------------------------------
    def observation(self, s: dict) -> SngObservation:
        """Map the kit's state object `s` (field names below are placeholders)."""
        n = RULES.num_players
        seats = tuple(SeatView(seat=i, stack=s["stacks"][i], bet=s["bets"][i], committed=s["committed"][i],
                               folded=s["folded"][i], all_in=s["stacks"][i] == 0 and not s["folded"][i],
                               in_hand=s["in_hand"][i]) for i in range(n))
        me = s["seat"]
        cur = max(sv.bet for sv in seats)
        to_call = cur - seats[me].bet
        legal = Legal(can_check=to_call == 0, can_call=to_call > 0,
                      call_amount=min(to_call, seats[me].stack),
                      can_raise=s["can_raise"], min_raise_to=s["min_raise_to"], max_raise_to=s["max_raise_to"])
        hn = s["hand_number"]
        sb, bb, ante = RULES.blinds_for(hn)
        left = sum(1 for sv in seats if sv.in_hand)
        obs = SngObservation(
            hand_number=hn, hands_left=RULES.max_hands - hn - 1, level=RULES.level(hn),
            small_blind=sb, big_blind=bb, ante=ante, seat=me, button=s["button"], sb_seat=s["sb_seat"],
            bb_seat=s["bb_seat"], street=s["street"], hole=tuple(card(c) for c in s["hole"]),
            board=tuple(card(c) for c in s["board"]), pot=s["pot"], my_stack=seats[me].stack,
            my_bet=seats[me].bet, legal=legal, seats=seats, history=tuple(s.get("history", ())),
            players_left=left, payouts=RULES.payouts,
            places_paid=tuple((p, RULES.payouts[p - 1]) for p in range(1, left + 1)))
        self.check(obs, s)
        return obs

    def check(self, obs, s):
        committed = sum(sv.committed for sv in obs.seats)
        if obs.pot != committed:
            warn("pot", f"POT MAPPING: pot {obs.pot} != committed chips {committed} (antes? previous streets?)")
        total = sum(sv.stack + sv.committed for sv in obs.seats)
        if total != RULES.starting_stack * RULES.num_players:
            warn("chips", f"CHIP MAPPING: stacks+committed {total} != {RULES.starting_stack * RULES.num_players}")
        if "big_blind" in s and s["big_blind"] != obs.big_blind:
            warn("blinds", f"BLIND SCHEDULE: kit says {s['big_blind']}, our schedule {obs.big_blind} at hand {obs.hand_number}")
        lg = obs.legal
        if lg.can_raise and not (lg.min_raise_to <= lg.max_raise_to <= obs.my_stack + obs.my_bet):
            warn("raise", f"RAISE MAPPING: min {lg.min_raise_to} max {lg.max_raise_to} stack {obs.my_stack} bet {obs.my_bet}")
        if len(obs.hole) != RULES.spec.hole_cards:
            warn("hole", f"HOLE CARDS: got {len(obs.hole)}, spec says {RULES.spec.hole_cards}")

    # ---- TODO 3: our action -> theirs ------------------------------------------------------
    def translate(self, a, obs):
        if a.kind == FOLD:
            return ("fold",) if not obs.legal.can_check else ("check",)
        if a.kind == CHECK:
            return ("check",)
        if a.kind == CALL:
            return ("call",)
        if a.kind == RAISE:
            return ("raise", a.amount)       # TODO: raise-to vs raise-by in their API
        return ("fold",)

    def act(self, s):
        try:
            obs = self.observation(s)
            return self.translate(self.bot.act(obs), obs)
        except Exception as e:  # noqa: BLE001  never lose a decision to an exception
            warn("exc", f"EXCEPTION {type(e).__name__}: {e}")
            return ("check",) if s.get("to_call", 1) == 0 else ("fold",)

    # ---- TODO 4: hand end --------------------------------------------------------------------
    def end_hand(self, info: dict):
        if hasattr(self.bot, "end_hand"):
            try:
                self.bot.end_hand(info)
            except Exception:  # noqa: BLE001
                pass
