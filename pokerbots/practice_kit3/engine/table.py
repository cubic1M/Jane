"""One sit-and-go table: up to 8 bots, 2,000 chips each, until one bot is left
or MAX_HANDS hands have been played. Implements the README rules exactly.

Variant: every player is dealt three hole cards. After the preflop betting round
each player still in the hand discards one hole card FACE UP, one at a time in
postflop action order; the hand is then ordinary no-limit hold'em with the two
kept cards. Discarded cards are dead.
"""

import random
import time

from . import rules
from .actions import ActionError, parse_action, half_bbs_to_chips
from .cards import cards_str, card_str
from .evaluator import evaluate, hand_name
from .icm import icm_equities
from .pots import build_pots, split_amount
from .positions import position_names

_ns = time.perf_counter_ns
_ID_CHARS = "abcdefghjkmnpqrstuvwxyz23456789"


class Seat:
    """A bot sitting at the table, with its chips, per-hand state and stats."""

    def __init__(self, seat, pid, name, factory):
        self.seat = seat
        self.pid = pid
        self.name = name
        self.factory = factory
        self.agent = None
        self.disabled = False
        self.stack = 0
        self.alive = True
        self.place = None
        self.points = 0.0
        self.bust_hand = None
        # stats
        self.decisions = 0
        self.errors = 0
        self.timeouts = 0
        self.max_charged_ns = 0
        self.max_raw_ns = 0
        self.slowest_where = ""
        self.pending_ns = 0
        self.setup_ns = 0
        self.error_log = []
        self.reset_hand()

    def reset_hand(self):
        self.hole = []
        self.bet = 0          # chips put in on the current street
        self.contrib = 0      # chips put in this hand
        self.folded = False
        self.allin = False
        self.in_hand = False
        self.last_acted = -1
        self.discarded = None
        self.start_stack = self.stack

    @property
    def can_act(self):
        return self.in_hand and not self.folded and not self.allin

    def note_error(self, where, msg):
        self.errors += 1
        if len(self.error_log) < 20:
            self.error_log.append("%s: %s" % (where, msg))


class Table:
    def __init__(self, entrants, seed=None, table_id="T1",
                 time_limit_ms=rules.DECISION_LIMIT_MS,
                 setup_limit_ms=rules.SETUP_LIMIT_MS,
                 enforce_time=True,
                 max_hands=rules.MAX_HANDS,
                 starting_stack=rules.STARTING_STACK,
                 stacks=None,
                 deck_fn=None,
                 log=None,
                 blind_levels=rules.BLIND_LEVELS,
                 hands_per_level=rules.HANDS_PER_LEVEL,
                 points=rules.POINTS,
                 shuffle_seats=True,
                 ids=None,
                 button_seat=None):
        """entrants: list of (display_name, factory); factory() returns a new Agent.

        deck_fn(hand_number) -> list of 52 card ints, for tests. Dealing: the
        i-th player in postflop order (first left of the button; heads-up the BB)
        gets deck[3i:3i+3]; the board is the next 5 cards.
        """
        if not 2 <= len(entrants) <= 8:
            raise ValueError("a table seats 2..8 bots")
        self.rng = random.Random(seed)
        self.table_id = table_id
        self.limit_ns = int(time_limit_ms * 1_000_000)
        self.setup_limit_ns = int(setup_limit_ms * 1_000_000)
        self.time_limit_ms = time_limit_ms
        self.enforce_time = enforce_time
        self.max_hands = max_hands
        self.deck_fn = deck_fn
        self.log = log
        self.blind_levels = blind_levels
        self.hands_per_level = hands_per_level
        self.points_table = list(points)
        order = list(entrants)
        if shuffle_seats:
            self.rng.shuffle(order)
        if ids is None:
            ids = self._make_ids(len(order))
        self.seats = []
        for i, (name, factory) in enumerate(order):
            s = Seat(i, ids[i], name, factory)
            s.stack = stacks[i] if stacks is not None else starting_stack
            self.seats.append(s)
        self.by_pid = {s.pid: s for s in self.seats}
        self.starting_total = sum(s.stack for s in self.seats)
        self.button = None
        self.button_seat = (self.rng.randrange(len(self.seats))
                            if button_seat is None else button_seat)
        self.hand_no = 0
        self.h = None

    # ------------------------------------------------------------------ utils
    def _make_ids(self, n):
        out = set()
        while len(out) < n:
            out.add("p" + "".join(self.rng.choice(_ID_CHARS) for _ in range(3)))
        ids = sorted(out)
        self.rng.shuffle(ids)
        return ids

    def _log(self, line):
        if self.log is not None:
            self.log(line)

    def _tag(self, s):
        return "%s(%s)" % (s.pid, s.name)

    def total_chips(self):
        return sum(s.stack for s in self.seats) + (
            sum(s.contrib for s in self.seats) if self.h and not self.h.settled else 0)

    def alive_seats(self):
        return [s for s in self.seats if s.alive]

    # ------------------------------------------------------- calling the bots
    def _notify(self, s, method, payload):
        if s.disabled or s.agent is None:
            return
        fn = getattr(s.agent, method, None)
        if fn is None:
            return
        t0 = _ns()
        try:
            fn(payload)
        except Exception as e:  # noqa: BLE001 - bot code
            s.note_error("%s hand %d" % (method, self.hand_no), repr(e))
        s.pending_ns += _ns() - t0

    def _decide(self, s, method, payload, where):
        """Call a decision callback. Returns (result, problem) where problem is
        None, 'timeout', 'error' or 'disabled'."""
        if s.disabled or s.agent is None:
            return None, "disabled"
        fn = getattr(s.agent, method, None)
        if fn is None:
            s.note_error(where, "Agent has no %s method" % method)
            return None, "error"
        err = None
        t0 = _ns()
        try:
            result = fn(payload)
        except Exception as e:  # noqa: BLE001
            result, err = None, repr(e)
        raw = _ns() - t0
        charged = raw + s.pending_ns
        s.pending_ns = 0
        s.decisions += 1
        if raw > s.max_raw_ns:
            s.max_raw_ns = raw
        if charged > s.max_charged_ns:
            s.max_charged_ns = charged
            s.slowest_where = where
        if self.enforce_time and charged > self.limit_ns:
            s.timeouts += 1
            if len(s.error_log) < 20:
                s.error_log.append("%s: timeout (%.3f ms charged, %.3f ms in the call)"
                                   % (where, charged / 1e6, raw / 1e6))
            return None, "timeout"
        if err is not None:
            s.note_error(where, err)
            return None, "error"
        return result, None

    def _broadcast(self, event):
        self.h.history.append(event)
        for s in self.seats:
            if s.alive:
                self._notify(s, "on_event", dict(event))

    # ------------------------------------------------------------------ setup
    def _setup(self):
        ids = [s.pid for s in self.seats]
        for s in self.seats:
            info = {
                "table_id": self.table_id,
                "your_id": s.pid,
                "seating": list(ids),
                "starting_stack": s.stack,
                "blind_levels": [list(b) for b in self.blind_levels],
                "hands_per_level": self.hands_per_level,
                "max_hands": self.max_hands,
                "points": list(self.points_table),
                "time_limit_ms": self.time_limit_ms,
            }
            t0 = _ns()
            try:
                s.agent = s.factory()
            except Exception as e:  # noqa: BLE001
                s.note_error("setup", "could not create Agent: %r" % (e,))
                s.disabled = True
                s.agent = None
                continue
            fn = getattr(s.agent, "on_table_start", None)
            if fn is not None:
                try:
                    fn(info)
                except Exception as e:  # noqa: BLE001
                    s.note_error("on_table_start", repr(e))
            s.setup_ns = _ns() - t0
            if self.enforce_time and s.setup_ns > self.setup_limit_ns:
                s.timeouts += 1
                s.disabled = True
                s.error_log.append("setup: %.1f ms > %.0f ms budget; bot auto-plays this table"
                                   % (s.setup_ns / 1e6, self.setup_limit_ns / 1e6))
        self._log("=" * 72)
        self._log("TABLE %s  seats: %s" % (self.table_id, "  ".join(
            "%d:%s" % (s.seat, self._tag(s)) for s in self.seats)))
        for s in self.seats:
            if s.disabled:
                self._log("  %s is DISABLED for this table (%s)" % (self._tag(s), s.error_log[-1]))

    # ------------------------------------------------------------------- hand
    def play_hand(self):
        self.hand_no += 1
        level, sb_amt, bb_amt = rules.blinds_for_hand(
            self.hand_no, self.blind_levels, self.hands_per_level)
        alive = self.alive_seats()
        n_seats = len(self.seats)
        if self.button is None:
            start = self.button_seat
            k = 0
        else:
            start = self.button + 1
            k = 0
        btn = None
        while btn is None:
            cand = self.seats[(start + k) % n_seats]
            if cand.alive:
                btn = cand
            k += 1
        self.button = btn.seat
        i0 = alive.index(btn)
        order = alive[i0:] + alive[:i0]
        n = len(order)
        names = position_names(n)
        if n == 2:
            sb_s, bb_s = order[0], order[1]
            pre, post = [order[0], order[1]], [order[1], order[0]]
        else:
            sb_s, bb_s = order[1], order[2]
            pre, post = order[3:] + order[:3], order[1:] + order[:1]

        h = _Hand()
        self.h = h
        h.level, h.sb, h.bb = level, sb_amt, bb_amt
        h.order, h.pre, h.post = order, pre, post
        h.pos = {s.pid: names[i] for i, s in enumerate(order)}
        for s in self.seats:
            s.reset_hand()
        for s in order:
            s.in_hand = True

        deck = list(self.deck_fn(self.hand_no)) if self.deck_fn else list(range(52))
        if not self.deck_fn:
            self.rng.shuffle(deck)
        for i, s in enumerate(post):
            s.hole = deck[3 * i:3 * i + 3]
        h.board_all = deck[3 * n:3 * n + 5]

        self._log("")
        self._log("--- %s hand %d  level %d (%d/%d)  button %s ---" % (
            self.table_id, self.hand_no, level, sb_amt, bb_amt, btn.pid))
        for s in order:
            self._log("  %-5s %-28s %6d  [%s]" % (h.pos[s.pid], self._tag(s), s.stack, cards_str(s.hole)))
        if any(s.disabled for s in order):
            self._log("  (auto-playing: %s)" % ", ".join(s.pid for s in order if s.disabled))

        stacks = {s.pid: s.stack for s in order}
        for s in self.seats:
            if not s.alive:
                continue
            self._notify(s, "on_hand_start", {
                "hand_number": self.hand_no,
                "level": level, "sb": sb_amt, "bb": bb_amt,
                "button": btn.pid,
                "your_position": h.pos.get(s.pid),
                "positions": dict(h.pos),
                "stacks": dict(stacks),
                "hole_cards": list(s.hole),
                "hands_left": self.max_hands - self.hand_no,
            })

        # blinds
        h.street = "preflop"
        for s, amt, label in ((sb_s, sb_amt, "SB"), (bb_s, bb_amt, "BB")):
            pay = min(amt, s.stack)
            s.stack -= pay
            s.bet += pay
            s.contrib += pay
            if s.stack == 0:
                s.allin = True
            self._log("  %s posts %s %d%s" % (s.pid, label, pay, " (all-in)" if s.allin else ""))
            self._broadcast({"type": "blind", "street": "preflop", "player": s.pid,
                             "blind": label, "amount": pay, "allin": s.allin})
        h.current_bet = bb_amt
        h.last_raise = bb_amt

        self._betting_round("preflop", pre)
        if self._live_count() > 1:
            self._discard_phase()
        for street, lo, hi in (("flop", 0, 3), ("turn", 3, 4), ("river", 4, 5)):
            if self._live_count() < 2:
                break
            h.street = street
            h.board = h.board_all[:hi]
            new = h.board_all[lo:hi]
            self._log("  *** %s *** [%s]  pot %d" % (street.upper(), cards_str(h.board), self._pot()))
            self._broadcast({"type": "street", "street": street, "cards": list(new),
                             "board": list(h.board)})
            self._betting_round(street, [s for s in post])
        self._settle()

    def _live_count(self):
        return sum(1 for s in self.h.order if not s.folded)

    def _pot(self):
        return sum(s.contrib for s in self.h.order)

    # --------------------------------------------------------------- betting
    def _betting_round(self, street, order):
        h = self.h
        h.street = street
        if street != "preflop":
            for s in order:
                s.bet = 0
            h.current_bet = 0
            h.last_raise = h.bb
        h.full_raise_id = 0
        for s in order:
            s.last_acted = -1
        live = [s for s in order if not s.folded]
        actors = [s for s in live if not s.allin]
        if len(live) < 2 or not actors:
            return
        if len(actors) == 1 and actors[0].bet >= h.current_bet:
            return
        pending = {s.seat for s in actors}
        i = 0
        n = len(order)
        while pending:
            s = order[i % n]
            i += 1
            if s.seat not in pending:
                continue
            pending.discard(s.seat)
            if not s.can_act:
                continue
            if self._live_count() < 2:
                break
            if self._ask_action(s, street):
                pending = {q.seat for q in order if q is not s and q.can_act}

    def _players_view(self):
        h = self.h
        out = []
        for s in h.order:
            status = "folded" if s.folded else ("allin" if s.allin else "active")
            out.append({"id": s.pid, "position": h.pos[s.pid], "stack": s.stack,
                        "bet": s.bet, "contributed": s.contrib, "status": status,
                        "discard": s.discarded})
        return out

    def _ask_action(self, s, street):
        """Ask s for an action and apply it. Returns True if s raised."""
        h = self.h
        owed = h.current_bet - s.bet
        to_call = min(owed, s.stack)
        others_active = any(q.can_act for q in h.order if q is not s)
        can_raise = others_active and s.last_acted < h.full_raise_id and s.stack > owed
        max_to = s.bet + s.stack
        min_to = min(h.current_bet + h.last_raise, max_to)
        state = {
            "hand_number": self.hand_no,
            "street": street,
            "position": h.pos[s.pid],
            "hole_cards": list(s.hole),
            "board": list(h.board),
            "discards": {q.pid: q.discarded for q in h.order if q.discarded is not None},
            "pot": self._pot(),
            "current_bet": h.current_bet,
            "your_bet": s.bet,
            "to_call": to_call,
            "stack": s.stack,
            "can_raise": can_raise,
            "min_raise_to": min_to if can_raise else None,
            "max_raise_to": max_to if can_raise else None,
            "sb": h.sb, "bb": h.bb, "level": h.level,
            "players": self._players_view(),
            "history": [dict(e) for e in h.history],
            "hands_left": self.max_hands - self.hand_no,
        }
        where = "%s hand %d %s" % (self.table_id, self.hand_no, street)
        result, problem = self._decide(s, "on_action_request", state, where)
        kind, arg, auto = None, None, False
        if problem is None:
            try:
                kind, arg = parse_action(result)
            except ActionError as e:
                s.note_error(where, str(e))
                problem = "invalid"
        if problem is not None:
            auto = True
            kind = "c" if to_call == 0 else "f"
        if kind == "r" and not can_raise:
            kind = "c"

        raised = False
        prev_bet = h.current_bet
        if kind == "f":
            s.folded = True
            ev = {"type": "fold"}
            text = "folds"
        elif kind == "c":
            if to_call == 0:
                ev = {"type": "check"}
                text = "checks"
            else:
                s.stack -= to_call
                s.bet += to_call
                s.contrib += to_call
                if s.stack == 0:
                    s.allin = True
                ev = {"type": "call", "amount": to_call, "to": s.bet, "allin": s.allin}
                text = "calls %d%s" % (to_call, " (all-in)" if s.allin else "")
        else:
            target = half_bbs_to_chips(arg, h.bb)
            if target >= max_to:
                target = max_to
            elif target < min_to:
                target = min_to
            add = target - s.bet
            s.stack -= add
            s.bet = target
            s.contrib += add
            if s.stack == 0:
                s.allin = True
            size = target - h.current_bet
            if size >= h.last_raise:
                h.last_raise = size
                h.full_raise_id += 1
            h.current_bet = target
            raised = True
            typ = "bet" if prev_bet == 0 else "raise"
            ev = {"type": typ, "amount": add, "to": target, "allin": s.allin}
            text = "%ss to %d (%.1f bb)%s" % ("bet" if typ == "bet" else "raise", target,
                                             target / h.bb, " (all-in)" if s.allin else "")
        s.last_acted = h.full_raise_id
        ev["street"] = street
        ev["player"] = s.pid
        ev["auto"] = auto
        if auto:
            text += "  [auto: %s]" % problem
        elif kind == "c" and result is not None and str(result).strip().lower().startswith("r"):
            text += "  [sent %r, raise not allowed -> call]" % (result,)
        elif kind == "r":
            text += "  [sent %r]" % (result,)
        self._log("  %s %s" % (s.pid, text))
        self._broadcast(ev)
        return raised

    # ---------------------------------------------------------------- discard
    def _discard_phase(self):
        h = self.h
        h.street = "discard"
        order = [s for s in h.post if not s.folded]
        ids = [s.pid for s in order]
        for s in order:
            state = {
                "hand_number": self.hand_no,
                "street": "discard",
                "position": h.pos[s.pid],
                "hole_cards": list(s.hole),
                "discards": {q.pid: q.discarded for q in order if q.discarded is not None},
                "discard_order": list(ids),
                "pot": self._pot(),
                "stack": s.stack,
                "sb": h.sb, "bb": h.bb, "level": h.level,
                "players": self._players_view(),
                "history": [dict(e) for e in h.history],
            }
            where = "%s hand %d discard" % (self.table_id, self.hand_no)
            result, problem = self._decide(s, "on_discard_request", state, where)
            card = None
            if problem is None:
                if type(result) is int and result in s.hole:
                    card = result
                else:
                    s.note_error(where, "invalid discard %r (must be one of your hole card ints %r)"
                                 % (result, s.hole))
                    problem = "invalid"
            auto = card is None
            if auto:
                card = s.hole[0]
            s.hole.remove(card)
            s.discarded = card
            self._log("  %s discards %s face up -> keeps [%s]%s" % (
                s.pid, card_str(card), cards_str(s.hole), "  [auto: %s]" % problem if auto else ""))
            self._broadcast({"type": "discard", "street": "discard", "player": s.pid,
                             "card": card, "auto": auto})

    # ----------------------------------------------------------------- settle
    def _settle(self):
        h = self.h
        live = [s for s in h.post if not s.folded]
        won = {s.pid: 0 for s in h.order}
        pots_out = []
        showdown = len(live) > 1
        if showdown:
            values = {}
            for s in live:
                values[s.pid] = evaluate(s.hole + h.board_all)
            h.board = list(h.board_all)
            self._log("  *** SHOWDOWN *** board [%s]" % cards_str(h.board_all))
            for s in live:
                self._log("    %s shows [%s]  %s" % (s.pid, cards_str(s.hole), hand_name(values[s.pid])))
            contribs = {s.pid: s.contrib for s in h.post}
            folded = {s.pid for s in h.post if s.folded}
            for idx, (amount, elig) in enumerate(build_pots(contribs, folded)):
                best = max(values[p] for p in elig) if len(elig) > 1 else None
                winners = [p for p in elig if len(elig) == 1 or values[p] == best]
                for p, amt in split_amount(amount, winners).items():
                    won[p] += amt
                label = "main pot" if idx == 0 else "side pot %d" % idx
                if len(elig) == 1:
                    self._log("    %s %d returned to %s (uncalled)" % (label, amount, elig[0]))
                else:
                    self._log("    %s %d -> %s  (%s)" % (label, amount, ", ".join(winners),
                                                       hand_name(best)))
                pots_out.append({"amount": amount, "eligible": list(elig), "winners": winners,
                                 "hand": hand_name(best) if best else None})
        else:
            total = self._pot()
            w = live[0]
            won[w.pid] = total
            self._log("  %s wins %d (no showdown)" % (w.pid, total))
            pots_out.append({"amount": total, "eligible": [w.pid], "winners": [w.pid], "hand": None})

        for s in h.order:
            s.stack += won[s.pid]
        h.settled = True
        net = {s.pid: s.stack - s.start_stack for s in h.order}

        if showdown:
            payload = {"hand_number": self.hand_no,
                       "board": list(h.board_all),
                       "hands": {s.pid: list(s.hole) for s in live},
                       "hand_names": {s.pid: hand_name(evaluate(s.hole + h.board_all)) for s in live},
                       "pots": [dict(p) for p in pots_out]}
            for s in self.seats:
                if s.alive:
                    self._notify(s, "on_showdown", dict(payload))

        alive_before = len(h.order)
        busted = [s for s in h.order if s.stack == 0]
        end = {"hand_number": self.hand_no, "stacks": {s.pid: s.stack for s in h.order},
               "net": net, "busted": [s.pid for s in busted], "showdown": showdown,
               "pots": [dict(p) for p in pots_out],
               "discards": {s.pid: s.discarded for s in h.order if s.discarded is not None}}
        for s in self.seats:
            if s.alive:
                self._notify(s, "on_hand_end", dict(end))

        if busted:
            # bigger stack at the start of the hand finishes higher; equal stacks share
            busted.sort(key=lambda s: -s.start_stack)
            place = alive_before - len(busted) + 1
            i = 0
            while i < len(busted):
                j = i
                while j < len(busted) and busted[j].start_stack == busted[i].start_stack:
                    j += 1
                places = list(range(place + i, place + j))
                pts = sum(self._points_for(p) for p in places) / len(places)
                for s in busted[i:j]:
                    s.alive = False
                    s.place = places[0] if len(places) == 1 else places
                    s.points = pts
                    s.bust_hand = self.hand_no
                    self._log("  %s busts: place %s, %.2f points" % (self._tag(s), s.place, pts))
                i = j
        self._log("  stacks: " + "  ".join("%s %d" % (s.pid, s.stack) for s in h.order))
        assert sum(s.stack for s in self.seats) == self.starting_total, "chip leak"

    def _points_for(self, place):
        return self.points_table[place - 1] if place - 1 < len(self.points_table) else 0

    # ------------------------------------------------------------------- run
    def run(self):
        self._setup()
        while self.hand_no < self.max_hands and len(self.alive_seats()) > 1:
            self.play_hand()
        return self._finish()

    def _finish(self):
        alive = self.alive_seats()
        if len(alive) == 1:
            alive[0].place = 1
            alive[0].points = float(self._points_for(1))
            self._log("TABLE %s over after %d hands: %s wins" % (self.table_id, self.hand_no,
                                                                  self._tag(alive[0])))
        else:
            eq = icm_equities([s.stack for s in alive],
                              [self._points_for(p) for p in range(1, len(alive) + 1)])
            self._log("TABLE %s reached the %d-hand cap; %d survivors split places 1-%d by ICM:"
                      % (self.table_id, self.hand_no, len(alive), len(alive)))
            for s, e in zip(alive, eq):
                s.points = e
                s.place = None
                self._log("  %s stack %d -> %.3f points" % (self._tag(s), s.stack, e))
        players = []
        for s in self.seats:
            players.append({
                "id": s.pid, "name": s.name, "seat": s.seat, "place": s.place,
                "survived": s.alive and len(alive) > 1, "points": s.points,
                "stack": s.stack, "bust_hand": s.bust_hand,
                "decisions": s.decisions, "errors": s.errors, "timeouts": s.timeouts,
                "max_charged_ms": s.max_charged_ns / 1e6, "max_raw_ms": s.max_raw_ns / 1e6,
                "slowest_where": s.slowest_where, "setup_ms": s.setup_ns / 1e6,
                "disabled": s.disabled, "error_log": list(s.error_log),
            })
        return {"table_id": self.table_id, "hands": self.hand_no, "players": players}


class _Hand:
    def __init__(self):
        self.history = []
        self.board = []
        self.board_all = []
        self.street = "preflop"
        self.current_bet = 0
        self.last_raise = 0
        self.full_raise_id = 0
        self.settled = False
