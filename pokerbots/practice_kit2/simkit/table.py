"""One sit-and-go table: hands, betting, the draw, side pots, places, ICM.

Read README.md for the rules; this file implements them.
"""

import random

from . import cards as C
from .icm import icm_equities
from .rules import (BLIND_SCHEDULE, HANDS_PER_LEVEL, MAX_HANDS,
                    PAYOUTS_PER_MILLE, STARTING_STACK, hands_left_in_level,
                    level_for_hand)
from .agent import INIT_TIME_LIMIT_MS, TIME_LIMIT_MS

ACTIONS = ("fold", "check", "call", "raise")


class Entrant:
    """A bot for the whole table."""

    def __init__(self, agent, stack):
        self.agent = agent
        self.name = agent.name
        self.stack = stack          # chips not yet put into the pot
        self.alive = True
        self.place = None
        self.points = 0.0
        self.bust_hand = None


class InHand:
    """A bot during one hand.  seat is relative to the button (button = 0)."""

    def __init__(self, entrant, seat):
        self.e = entrant
        self.seat = seat
        self.hole = []
        self.status = "active"      # active / folded / allin
        self.round_bet = 0          # chips put in during the current round
        self.contrib = 0            # chips put in during the whole hand
        self.drew = None            # None until the draw, then 0 or 1
        self.start_stack = entrant.stack


def default_deck(rng):
    deck = C.full_deck()
    rng.shuffle(deck)
    return deck


class Table:
    def __init__(self, agents, *, seed=0, stacks=None, max_hands=MAX_HANDS,
                 hands_per_level=HANDS_PER_LEVEL, schedule=BLIND_SCHEDULE,
                 payouts=None, deck_factory=None, table_id=1,
                 hand_observer=None):
        if not 2 <= len(agents) <= 10:
            raise ValueError("2-10 bots per table")
        n = len(agents)
        self.rng = random.Random(seed)
        stacks = list(stacks) if stacks is not None else [STARTING_STACK] * n
        self.entrants = [Entrant(a, s) for a, s in zip(agents, stacks)]
        self.max_hands = max_hands
        self.hands_per_level = hands_per_level
        self.schedule = schedule
        self.payouts = list(payouts) if payouts is not None else \
            list(PAYOUTS_PER_MILLE[:n])
        self.deck_factory = deck_factory or default_deck
        self.table_id = table_id
        self.hand_observer = hand_observer
        self.button_abs = None
        self.hand_no = 0
        self.finished = False
        self.started = False
        self.log = []
        self.last_hand = None
        self.total_chips = sum(stacks)
        self.starting_stack = max(stacks)

    # ------------------------------------------------------------------ setup
    def config(self):
        n = len(self.entrants)
        return {
            "starting_stack": self.starting_stack,
            "num_players": n,
            "max_hands": self.max_hands,
            "hands_per_level": self.hands_per_level,
            "blind_schedule": [
                {"level": lv, "small_blind": sb, "big_blind": bb, "ante": an}
                for lv, sb, bb, an in self.schedule],
            "payouts_per_mille": list(self.payouts),
            "time_limit_ms": self.entrants[0].agent.time_limit_ms
            if hasattr(self.entrants[0].agent, "time_limit_ms")
            else TIME_LIMIT_MS,
            "init_time_limit_ms": INIT_TIME_LIMIT_MS,
            "draw_after_flop": True,
        }

    def start(self):
        cfg = self.config()
        self.started = True
        self._log(f"##### Table {self.table_id}: "
                  + ", ".join(e.name for e in self.entrants))
        for e in self.entrants:
            if not e.agent.start(cfg):
                self._log(f"!! {e.name} failed init and sits out "
                          f"({e.agent.stats.messages[-1] if e.agent.stats.messages else ''})")

    def play(self):
        if not self.started:
            self.start()
        while not self.finished:
            self.play_hand()
        return self.results()

    def results(self):
        return [{"name": e.name, "place": e.place, "points": e.points,
                 "final_stack": e.stack, "bust_hand": e.bust_hand}
                for e in self.entrants]

    def _log(self, line):
        self.log.append(line)

    # ------------------------------------------------------------- one hand
    def _next_button(self):
        n = len(self.entrants)
        if self.button_abs is None:
            j = 0
        else:
            j = (self.button_abs + 1) % n
        while not self.entrants[j].alive:
            j = (j + 1) % n
        self.button_abs = j
        return j

    def _deal(self):
        card = self.deck[self.deck_pos]
        self.deck_pos += 1
        return card

    def _action_order(self, preflop):
        n = len(self.hp)
        if preflop:
            start = 0 if n == 2 else 3 % n
        else:
            start = 1 % n
        return [self.hp[(start + i) % n] for i in range(n)]

    def _not_folded(self):
        return [h for h in self.hp if h.status != "folded"]

    def play_hand(self):
        if self.finished:
            raise RuntimeError("table finished")
        if not self.started:
            self.start()
        self.hand_no += 1
        level, sb, bb, ante = level_for_hand(self.hand_no, self.hands_per_level,
                                             self.schedule)
        self.level, self.sb, self.bb, self.ante = level, sb, bb, ante
        btn = self._next_button()
        n_all = len(self.entrants)
        seating = [self.entrants[(btn + i) % n_all] for i in range(n_all)]
        seating = [e for e in seating if e.alive]
        self.hp = [InHand(e, i) for i, e in enumerate(seating)]
        n = len(self.hp)
        self.deck = self.deck_factory(self.rng)
        self.deck_pos = 0
        self.board = []
        self.pot = 0
        self.history = []
        self.street = "preflop"
        self.current_bet = 0
        self.min_raise_by = bb
        self.can_raise_now = False
        self.dead = []

        self._log("")
        self._log(f"=== Table {self.table_id} | hand {self.hand_no} | level "
                  f"{level} ({sb}/{bb}, ante {ante}) ===")
        self._log("  " + " | ".join(
            f"seat {h.seat} {h.e.name} {h.e.stack}" for h in self.hp))

        # antes (go straight into the pot, not into this round's bets)
        if ante:
            for h in self.hp:
                a = min(ante, h.e.stack)
                h.e.stack -= a
                h.contrib += a
                self.pot += a
                if h.e.stack == 0:
                    h.status = "allin"
                self.history.append({"street": "preflop", "seat": h.seat,
                                     "action": "ante", "amount": a})
            self._log(f"  antes {ante} each -> pot {self.pot}")

        # blinds
        sb_seat, bb_seat = (0, 1) if n == 2 else (1, 2)
        for seat, amount, tag in ((sb_seat, sb, "small_blind"),
                                  (bb_seat, bb, "big_blind")):
            h = self.hp[seat]
            a = min(amount, h.e.stack)
            h.e.stack -= a
            h.round_bet += a
            h.contrib += a
            if h.e.stack == 0:
                h.status = "allin"
            self.history.append({"street": "preflop", "seat": seat,
                                 "action": tag, "amount": a})
            self._log(f"  seat {seat} {h.e.name} posts {tag.replace('_', ' ')}"
                      f" {a}" + (" (all-in)" if h.status == "allin" else ""))

        # hole cards: one at a time starting left of the button
        deal_order = [self.hp[(1 + i) % n] for i in range(n)]
        for _ in range(2):
            for h in deal_order:
                h.hole.append(self._deal())
        self._log("  hole: " + " | ".join(
            f"{h.e.name} [{' '.join(h.hole)}]" for h in self.hp))

        self._betting_round("preflop")
        if len(self._not_folded()) >= 2:
            self.board += [self._deal() for _ in range(3)]
            self._log(f"  FLOP [{' '.join(self.board)}]  pot {self.pot}")
            self._betting_round("flop")
        if len(self._not_folded()) >= 2:
            self._draw_phase()
            self.board.append(self._deal())
            self._log(f"  TURN [{' '.join(self.board)}]  pot {self.pot}")
            self._betting_round("turn")
        if len(self._not_folded()) >= 2:
            self.board.append(self._deal())
            self._log(f"  RIVER [{' '.join(self.board)}]  pot {self.pot}")
            self._betting_round("river")
        self._settle()

    # ------------------------------------------------------------- betting
    def _player_view(self, h):
        return {"seat": h.seat,
                "chips_total": h.e.stack + h.round_bet,
                "chips_in_pot_this_round": h.round_bet,
                "status": h.status,
                "drew": h.drew}

    def build_state(self, h, kind):
        return {
            "type": kind,
            "hand_number": self.hand_no,
            "hands_remaining": self.max_hands - self.hand_no,
            "level": self.level,
            "small_blind": self.sb,
            "big_blind": self.bb,
            "ante": self.ante,
            "hands_left_in_level": hands_left_in_level(
                self.hand_no, self.hands_per_level, self.schedule),
            "street": self.street,
            "board": list(self.board),
            "hole_cards": list(h.hole),
            "my_seat": h.seat,
            "num_seats": len(self.hp),
            "pot": self.pot,
            "current_bet": self.current_bet,
            "min_raise_by": self.min_raise_by,
            "can_raise": self.can_raise_now,
            "players": [self._player_view(p) for p in self.hp],
            "history": [dict(x) for x in self.history],
            "time_limit_ms": getattr(h.e.agent, "time_limit_ms", TIME_LIMIT_MS),
        }

    def _interpret(self, h, state, reply, to_call, can_raise):
        """Turn a reply into ('fold'|'check'|'call'|'raise', target, auto)."""
        free = to_call <= 0
        default = ("check" if free else "fold", None, True)
        if reply is None:
            return default
        agent = h.e.agent
        if not isinstance(reply, dict):
            agent.invalid(state, f"reply must be an object, got {reply!r}")
            return default
        action = reply.get("action")
        if action not in ACTIONS:
            agent.invalid(state, f"unknown action {action!r}")
            return default
        if action == "fold":
            return ("fold", None, False)
        if action == "check":
            if free:
                return ("check", None, False)
            agent.invalid(state, f"check while facing {to_call} to call")
            return default
        if action == "call":
            return ("check" if free else "call", None, False)
        # raise
        amount = reply.get("amount")
        if type(amount) is not int or amount <= 0:
            agent.invalid(state, f"raise amount must be a positive integer, "
                                 f"got {amount!r}")
            return default
        if not can_raise:
            return ("check" if free else "call", None, False)
        max_by = h.e.stack - to_call
        by = min(max(amount, self.min_raise_by), max_by)
        return ("raise", self.current_bet + by, False)

    def _put(self, h, amount):
        amount = min(amount, h.e.stack)
        h.e.stack -= amount
        h.round_bet += amount
        h.contrib += amount
        if h.e.stack == 0:
            h.status = "allin"
        return amount

    def _betting_round(self, street):
        self.street = street
        preflop = street == "preflop"
        self.current_bet = self.bb if preflop else 0
        self.min_raise_by = self.bb
        order = self._action_order(preflop)
        n = len(order)
        to_act = {h.seat for h in self.hp if h.status == "active"}
        may_raise = {h.seat: True for h in self.hp}
        acted = set()
        i = 0
        while to_act:
            nf = self._not_folded()
            if len(nf) <= 1:
                break
            h = order[i % n]
            i += 1
            if h.seat not in to_act:
                continue
            others_active = [o for o in nf if o is not h and o.status == "active"]
            to_call = self.current_bet - h.round_bet
            if not others_active and to_call <= 0:
                to_act.discard(h.seat)
                continue
            can_raise = may_raise[h.seat] and bool(others_active) \
                and h.e.stack > to_call
            self.can_raise_now = can_raise
            state = self.build_state(h, "action")
            reply = h.e.agent.decide(state)
            kind, target, auto = self._interpret(h, state, reply, to_call,
                                                 can_raise)
            entry = {"street": street, "seat": h.seat, "action": kind,
                     "amount": 0}
            note = ""
            if auto:
                entry["auto"] = True
                note = f"  [{h.e.agent.last_issue or 'auto'}]"
            if kind == "fold":
                h.status = "folded"
                to_act.discard(h.seat)
                text = "folds"
            elif kind == "check":
                to_act.discard(h.seat)
                acted.add(h.seat)
                text = "checks"
            elif kind == "call":
                put = self._put(h, to_call)
                entry["amount"] = put
                to_act.discard(h.seat)
                acted.add(h.seat)
                text = f"calls {put}" + (" (all-in)" if h.status == "allin"
                                         else "")
            else:  # raise
                by = target - self.current_bet
                self._put(h, target - h.round_bet)
                entry["amount"] = by
                entry["to"] = target
                text = (f"raises by {by} to {target}"
                        + (" (all-in)" if h.status == "allin" else ""))
                if by >= self.min_raise_by:          # full raise: reopens
                    self.min_raise_by = by
                    may_raise = {s: True for s in may_raise}
                    acted = {h.seat}
                else:                                # short all-in raise
                    for s in acted:
                        may_raise[s] = False
                    acted.add(h.seat)
                    text += " (incomplete raise)"
                self.current_bet = target
                to_act = {o.seat for o in self.hp
                          if o.status == "active" and o is not h}
            self.history.append(entry)
            self._log(f"  {street.upper()}: seat {h.seat} {h.e.name} {text}{note}")
        # close the round
        for h in self.hp:
            self.pot += h.round_bet
            h.round_bet = 0
        self.current_bet = 0
        self.can_raise_now = False

    # ---------------------------------------------------------------- draw
    def _draw_phase(self):
        """After flop betting, each live bot may swap 0 or 1 hole card."""
        self.street = "draw"
        self.current_bet = 0
        self.min_raise_by = 0
        self.can_raise_now = False
        for h in self._action_order(preflop=False):
            if h.status == "folded":
                continue
            state = self.build_state(h, "draw")
            reply = h.e.agent.decide(state)
            discard = None
            if reply is not None:
                if not isinstance(reply, dict) or "discard" not in reply:
                    h.e.agent.invalid(state, f"draw reply must be "
                                             f"{{'discard': card or null}}, "
                                             f"got {reply!r}")
                else:
                    d = reply["discard"]
                    if d is None:
                        pass
                    elif isinstance(d, str) and d in h.hole:
                        discard = d
                    else:
                        h.e.agent.invalid(state, f"cannot discard {d!r}; "
                                                 f"hole cards {h.hole}")
            if discard is None:
                h.drew = 0
                text = "stands pat"
            else:
                new = self._deal()
                h.hole[h.hole.index(discard)] = new
                self.dead.append(discard)
                h.drew = 1
                text = f"discards {discard}, draws {new}"
            entry = {"street": "draw", "seat": h.seat, "action": "draw",
                     "amount": h.drew}
            note = ""
            if reply is None:
                entry["auto"] = True
                note = f"  [{h.e.agent.last_issue or 'auto'}]"
            self.history.append(entry)
            self._log(f"  DRAW: seat {h.seat} {h.e.name} {text}{note}")

    # ------------------------------------------------------------ showdown
    def _award_order(self, players):
        """Odd chips go to the first winner left of the button."""
        n = len(self.hp)
        return sorted(players, key=lambda h: (h.seat - 1) % n)

    def _side_pots(self):
        """[[amount, eligible InHands, bottom level], ...] main pot first."""
        nf = self._not_folded()
        levels = sorted({h.contrib for h in self.hp if h.contrib > 0})
        pots = []
        prev = 0
        for lv in levels:
            amount = sum(min(h.contrib, lv) - min(h.contrib, prev)
                         for h in self.hp)
            elig = [h for h in nf if h.contrib >= lv]
            bottom = prev
            prev = lv
            if not elig:
                if pots:
                    pots[-1][0] += amount
                    continue
                elig = list(nf)
            if pots and [x.seat for x in pots[-1][1]] == [x.seat for x in elig]:
                pots[-1][0] += amount
            else:
                pots.append([amount, elig, bottom])
        return pots

    def _settle(self):
        for h in self.hp:                     # (already 0 after a round)
            self.pot += h.round_bet
            h.round_bet = 0
        nf = self._not_folded()
        showdown = len(nf) >= 2
        scores = {}
        if showdown:
            while len(self.board) < 5:
                self.board.append(self._deal())
            for h in nf:
                scores[h.seat] = C.evaluate(h.hole + self.board)
            self._log(f"  SHOWDOWN board [{' '.join(self.board)}]")
            for h in nf:
                self._log(f"    seat {h.seat} {h.e.name} [{' '.join(h.hole)}] "
                          f"{C.hand_name(scores[h.seat])}")
        pots = self._side_pots()
        assert sum(p[0] for p in pots) == self.pot, "pot accounting"
        won = {h.seat: 0 for h in self.hp}
        pot_records = []
        for idx, (amount, elig, bottom) in enumerate(pots):
            if len(elig) == 1 or not showdown:
                winners = [elig[0]] if len(elig) == 1 else [nf[0]]
            else:
                best = max(scores[h.seat] for h in elig)
                winners = [h for h in elig if scores[h.seat] == best]
            winners = self._award_order(winners)
            share, rem = divmod(amount, len(winners))
            for k, w in enumerate(winners):
                got = share + (1 if k < rem else 0)
                w.e.stack += got
                won[w.seat] += got
            label = "main pot" if idx == 0 else f"side pot {idx}"
            contributors = sum(1 for h in self.hp if h.contrib > bottom)
            pot_records.append({"amount": amount,
                                "eligible": [h.seat for h in elig],
                                "winners": [w.seat for w in winners]})
            self._log(f"  {label} {amount}: "
                      + ", ".join(w.e.name for w in winners)
                      + (" (unmatched chips returned)" if contributors == 1
                         else ""))
        self.pot = 0
        self.last_hand = {"board": list(self.board),
                          "holes": {h.seat: list(h.hole) for h in self.hp},
                          "names": {h.seat: h.e.name for h in self.hp},
                          "pots": pot_records, "won": won,
                          "showdown": showdown, "dead": list(self.dead)}
        self._finish_hand(scores if showdown else {}, pot_records)

    # ------------------------------------------------------- end of hand
    def _finish_hand(self, scores, pot_records):
        alive_before = len(self.hp)
        busted = [h for h in self.hp if h.e.stack == 0]
        # places for bots knocked out this hand: bigger start-of-hand stack
        # finishes higher; equal stacks share the points of their places.
        busted.sort(key=lambda h: -h.start_stack)
        cursor = alive_before - len(busted) + 1
        k = 0
        while k < len(busted):
            group = [b for b in busted[k:]
                     if b.start_stack == busted[k].start_stack]
            places = list(range(cursor, cursor + len(group)))
            pts = sum(self._payout(p) for p in places) / len(group)
            for b in group:
                b.e.alive = False
                b.e.place = cursor
                b.e.points = pts
                b.e.bust_hand = self.hand_no
                self._log(f"  ** {b.e.name} is knocked out: place {cursor}"
                          f"{' (shared)' if len(group) > 1 else ''}, "
                          f"{pts:g} points")
            cursor += len(group)
            k += len(group)

        total = sum(e.stack for e in self.entrants)
        assert total == self.total_chips, "chip conservation"

        showdown = [{"seat": s, "hole_cards": list(self.hp[s].hole),
                     "hand": C.hand_name(sc)} for s, sc in scores.items()]
        for h in self.hp:
            summary = {
                "hand_number": self.hand_no,
                "my_seat": h.seat,
                "my_hole_cards": list(h.hole),
                "board": list(self.board),
                "showdown": showdown,
                "pots": pot_records,
                "net": {h2.seat: h2.e.stack - h2.start_stack for h2 in self.hp},
                "chips_after": {h2.seat: h2.e.stack for h2 in self.hp},
                "knocked_out_seats": [b.seat for b in busted],
                "history": [dict(x) for x in self.history],
            }
            h.e.agent.hand_end(summary)

        alive = [e for e in self.entrants if e.alive]
        if len(alive) == 1:
            w = alive[0]
            w.place, w.points = 1, float(self._payout(1))
            self._log(f"##### {w.name} wins the table (hand {self.hand_no})")
            self.finished = True
        elif self.hand_no >= self.max_hands:
            self._icm_finish(alive)
            self.finished = True
        if self.hand_observer is not None:
            self.hand_observer(self)

    def _payout(self, place):
        return self.payouts[place - 1] if place - 1 < len(self.payouts) else 0

    def _icm_finish(self, alive):
        prizes = [self._payout(p) for p in range(1, len(alive) + 1)]
        eq = icm_equities([e.stack for e in alive], prizes)
        ranked = sorted(zip(alive, eq), key=lambda t: -t[0].stack)
        self._log(f"##### hand cap reached: ICM split of "
                  f"{sum(prizes)} points between {len(alive)} bots")
        place = 1
        for k, (e, pts) in enumerate(ranked):
            if k > 0 and e.stack < ranked[k - 1][0].stack:
                place = k + 1
            e.place = place
            e.points = pts
            self._log(f"  {e.name}: {e.stack} chips -> {pts:.2f} points")

