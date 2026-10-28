"""Adapter: run any of our bots inside an MIT-Pokerbots-style skeleton.

Many university pokerbot competitions reuse the MIT skeleton API:
    handle_new_round(game_state, round_state, active)
    get_action(game_state, round_state, active) -> FoldAction/CallAction/CheckAction/RaiseAction/DiscardAction
    handle_round_over(game_state, terminal_state, active)
where round_state is a namedtuple chain (button, street, pips, stacks, hands, board,
previous_state). This module turns that into our Observation, asks our bot, and
turns the answer back. Everything protocol-specific is in PROTOCOL below; on the
day, if the tournament's skeleton differs, edit PROTOCOL (and only it) first.

Self-checks (printed once each, never fatal): blinds posted as the spec says, our
legal-action model agrees with the server's, chips add up. A mapping bug shows up
here in the first few hands instead of as a silent 1 bb/hand leak.

    from tournament.mit_adapter import AdaptedPlayer
    player = AdaptedPlayer("balanced", "c_discard3", actions_module=skeleton.actions)
"""
from __future__ import annotations

import sys
import traceback

from engine.cards import parse_card
from engine.game import (CALL, CHECK, DISCARD, FOLD, RAISE, ActionRecord, HandResult,
                         LegalActions, Observation)

# ---- protocol description (MIT Pokerbots 2026 skeleton) ------------------------------
PROTOCOL = dict(
    # their street code -> (our street index, is a discard step)
    streets={0: (0, False), 2: (1, True), 3: (1, True), 4: (1, False), 5: (2, False), 6: (3, False)},
    # player index 0 posts the small blind and acts first preflop
    sb_index=0,
)


def _cards(xs):
    return tuple(parse_card(str(c)) for c in xs)


class AdaptedPlayer:
    def __init__(self, bot_name: str, variant: str, actions_module, seed: int = 0, log=None):
        from engine.variants import get_variant
        from experiments.common import make_bot
        self.spec = get_variant(variant)
        self.bot = make_bot(bot_name)
        self.bot.new_match(self.spec, seed)
        self.A = actions_module
        self.log = log or (lambda m: print(m, file=sys.stderr))
        self.warned: set = set()
        self.errors = 0
        self._reset_hand()

    # ---- helpers -------------------------------------------------------------------
    def _warn(self, key: str, msg: str) -> None:
        if key not in self.warned:
            self.warned.add(key)
            self.log(f"[adapter] {msg}")

    def _reset_hand(self):
        self.start_cards = None
        self.my_discards: list = []

    def _chain(self, rs):
        out = []
        while rs is not None and hasattr(rs, "street"):
            out.append(rs)
            rs = rs.previous_state
        return out[::-1]

    def _history(self, rs, active):
        """Rebuild our ActionRecord history from the previous_state chain."""
        hist = []
        chain = self._chain(rs)
        for s0, s1 in zip(chain, chain[1:]):
            our_street, is_disc = PROTOCOL["streets"].get(s0.street, (None, False))
            if our_street is None:
                continue
            actor = s0.button % 2
            if is_disc:
                # in a discard step only the player with actor != street % 2 discards; the
                # other one's turn is a placeholder check (skipped). Opponent hands are
                # empty in the skeleton, so its discarded card is read from the board.
                if actor != s0.street % 2:
                    gone = [c for c in s0.hands[actor] if c not in s1.hands[actor]]
                    hist.append(ActionRecord(actor, our_street, DISCARD, 0, _cards(gone)))
                continue
            cost = s0.pips[1 - actor] - s0.pips[actor]
            if s1.street != s0.street:                      # round closed by a call or a check
                kind = CALL if cost > 0 else CHECK
                hist.append(ActionRecord(actor, our_street, kind, cost if cost > 0 else 0))
            elif s1.pips[actor] > s0.pips[actor]:
                if s1.pips[actor] > s0.pips[1 - actor]:
                    hist.append(ActionRecord(actor, our_street, RAISE, s1.pips[actor]))
                else:
                    hist.append(ActionRecord(actor, our_street, CALL, s1.pips[actor] - s0.pips[actor]))
            else:
                hist.append(ActionRecord(actor, our_street, CHECK, 0))
        return hist

    def _observation(self, game_state, rs, active) -> Observation:
        spec = self.spec
        legal_set = rs.legal_actions()
        our_street, is_disc = PROTOCOL["streets"][rs.street]
        my_cards = _cards(rs.hands[active])
        board = _cards(rs.board)
        if self.start_cards is None:
            self.start_cards = my_cards
        my_disc = tuple(c for c in self.start_cards if c not in my_cards)
        flop_n = spec.board_cards_per_street[1] if spec.num_streets > 1 else 0
        opp_disc = tuple(c for c in board[flop_n:flop_n + 2] if c not in my_disc) if spec.discards else ()
        total_disc = sum(d.count for d in spec.discards)
        stack0 = spec.starting_stack
        committed = [stack0 - rs.stacks[0], stack0 - rs.stacks[1]]
        A = self.A
        can_raise = A.RaiseAction in legal_set
        lo, hi = rs.raise_bounds() if can_raise else (0, 0)
        cost = rs.pips[1 - active] - rs.pips[active]
        legal = LegalActions(can_fold=A.FoldAction in legal_set, can_check=A.CheckAction in legal_set,
                             can_call=A.CallAction in legal_set, call_amount=max(0, cost),
                             can_raise=can_raise, min_raise_to=int(lo), max_raise_to=int(hi),
                             discard_count=1 if A.DiscardAction in legal_set else 0)
        position = active if PROTOCOL["sb_index"] == 0 else 1 - active
        hist = tuple(self._history(rs, active))
        # ---- self-checks --------------------------------------------------------------
        if rs.street == 0 and len(hist) == 0:
            want = spec.small_blind if position == 0 else spec.big_blind
            if rs.pips[active] != want:
                self._warn("blinds", f"BLIND MAPPING? position {position} has pip {rs.pips[active]}, spec says {want}")
        if max(committed) > stack0 or min(rs.stacks) < 0:
            self._warn("stack", f"STACK MAPPING? stacks {rs.stacks} vs starting_stack {stack0}")
        if len(my_cards) + len(my_disc) != spec.hole_cards:
            self._warn("hole", f"HOLE CARD COUNT? have {len(my_cards)} + discarded {len(my_disc)}, spec says {spec.hole_cards}")
        return Observation(
            hand_index=game_state.round_num - 1, hands_in_match=spec.hands_per_match,
            position=position, street=our_street, phase="discard" if legal.discard_count else "bet",
            my_cards=my_cards, board=board, my_discards=my_disc, opp_discards=opp_disc,
            opp_num_cards=spec.hole_cards - len(opp_disc) if spec.discards and our_street >= 1 else spec.hole_cards,
            pot=sum(committed), my_pip=rs.pips[active], opp_pip=rs.pips[1 - active],
            my_stack=rs.stacks[active], opp_stack=rs.stacks[1 - active],
            my_committed=committed[active], opp_committed=committed[1 - active], legal=legal,
            history=hist, board_cards_to_come=sum(spec.board_cards_per_street[our_street + 1:]),
            my_discards_left=total_disc - len(my_disc), opp_discards_left=total_disc - len(opp_disc),
            bankroll=game_state.bankroll, time_left=game_state.game_clock, big_blind=spec.big_blind)

    # ---- skeleton API ----------------------------------------------------------------
    def handle_new_round(self, game_state, round_state, active):
        self._reset_hand()

    def get_action(self, game_state, round_state, active):
        A = self.A
        legal_set = round_state.legal_actions()
        if legal_set == {A.CheckAction}:          # the non-discarding player's placeholder turn
            return A.CheckAction()
        try:
            obs = self._observation(game_state, round_state, active)
            act = self.bot.act(obs)
            return self._translate(act, obs, round_state, active)
        except Exception:
            self.errors += 1
            self._warn("exc", "bot/adapter exception (playing safe):\n" + traceback.format_exc())
            if A.DiscardAction in legal_set:
                return A.DiscardAction(0)
            return A.CheckAction() if A.CheckAction in legal_set else A.FoldAction()

    def _translate(self, act, obs, rs, active):
        A = self.A
        lg = obs.legal
        if act.kind == DISCARD and lg.discard_count:
            idx = [str(c) for c in rs.hands[active]]
            from engine.cards import card_str
            return A.DiscardAction(idx.index(card_str(act.cards[0])))
        if act.kind == RAISE and lg.can_raise:
            return A.RaiseAction(lg.clamp_raise(act.amount))
        if act.kind == CALL and lg.can_call:
            return A.CallAction()
        if act.kind == CHECK and lg.can_check:
            return A.CheckAction()
        if act.kind == FOLD:
            return A.CheckAction() if lg.can_check else A.FoldAction()
        self._warn("illegal", f"bot returned {act} not legal here ({lg}); playing safe")
        if lg.discard_count:
            return A.DiscardAction(0)
        return A.CheckAction() if lg.can_check else (A.CallAction() if lg.can_call else A.FoldAction())

    def handle_round_over(self, game_state, terminal_state, active):
        prev = terminal_state.previous_state
        try:
            opp = list(prev.hands[1 - active])
            showdown = len(opp) > 0
            hist = self._history(prev, active)
            folded_by = None
            if not showdown:
                folded_by = prev.button % 2
                our_street = PROTOCOL["streets"].get(prev.street, (0, False))[0]
                hist.append(ActionRecord(folded_by, our_street, FOLD, 0))
            position = active if PROTOCOL["sb_index"] == 0 else 1 - active
            res = HandResult(position=position, delta=int(terminal_state.deltas[active]), showdown=showdown,
                             my_cards=_cards(prev.hands[active]), opp_cards=_cards(opp) if showdown else None,
                             board=_cards(prev.board), history=tuple(hist),
                             folded_by=(None if folded_by is None else
                                        (folded_by if PROTOCOL["sb_index"] == 0 else 1 - folded_by)))
            self.bot.end_hand(res)
        except Exception:
            self.errors += 1
            self._warn("end", "end_hand exception:\n" + traceback.format_exc())
        self._reset_hand()
