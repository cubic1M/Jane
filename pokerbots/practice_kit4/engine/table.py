"""One Six-Plus no-limit sit-and-go table (README sections 1-4, 6)."""
import random

from . import actions, rules
from .cards import DECK, evaluate, hand_name
from .icm import icm

STREET_CARDS = (0, 3, 1, 1)     # preflop, flop, turn, river


class Table:
    def __init__(self, controllers, seed=0, stacks=None, points=None,
                 max_hands=rules.MAX_HANDS, deck_fn=None, hand_logger=None,
                 first_button=None, time_limit_ms=rules.TIME_LIMIT_MS):
        n = len(controllers)
        self.seats = list(range(1, n + 1))
        self.ctrl = dict(zip(self.seats, controllers))
        self.stacks = {s: (stacks[s - 1] if stacks else rules.STARTING_STACK)
                       for s in self.seats}
        self.points = list(points if points is not None else rules.POINTS[:n])
        self.rng = random.Random(seed)
        self.max_hands = max_hands
        self.deck_fn = deck_fn
        self.hand_logger = hand_logger
        self.first_button = first_button
        self.ms = time_limit_ms
        self.hand_no = 0
        self.button = None
        self.last_public = None
        self.place = {}
        self.score = {}

    # ------------------------------------------------------------ helpers
    def alive(self):
        return [s for s in self.seats if self.stacks[s] > 0]

    def _next_alive(self, seat):
        n = len(self.seats)
        for k in range(1, n + 1):
            s = (seat - 1 + k) % n + 1
            if self.stacks[s] > 0:
                return s
        raise RuntimeError("nobody alive")

    # ------------------------------------------------------------ table
    def run(self):
        while len(self.alive()) > 1 and self.hand_no < self.max_hands:
            self.play_hand()
        self._finish()
        return {"points": dict(self.score), "place": dict(self.place),
                "hands": self.hand_no, "stacks": dict(self.stacks)}

    def _finish(self):
        alive = self.alive()
        if len(alive) == 1:
            self.place[alive[0]] = 1
            self.score[alive[0]] = float(self.points[0])
            return
        eq = icm([self.stacks[s] for s in alive], self.points[:len(alive)])
        for s, e in zip(alive, eq):
            self.score[s] = e
        ranked = sorted(alive, key=lambda s: (-self.stacks[s], s))
        for i, s in enumerate(ranked):
            self.place[s] = i + 1

    def _assign_bust_places(self, busted, start, remaining):
        """busted seats take places remaining+1 ...; more chips at the start
        of the hand finishes higher; equal starting stacks share points."""
        order = sorted(busted, key=lambda s: -start[s])
        place = remaining + 1
        i = 0
        while i < len(order):
            group = [s for s in order if start[s] == start[order[i]]]
            places = list(range(place, place + len(group)))
            share = sum(self.points[p - 1] for p in places) / len(group)
            for s in group:
                self.place[s] = places[0]
                self.score[s] = share
            place += len(group)
            i += len(group)

    # ------------------------------------------------------------ hand
    def play_hand(self):
        self.hand_no += 1
        level, sb, bb = rules.blinds_for_hand(self.hand_no)
        alive = self.alive()
        if self.button is None:
            self.button = self.first_button or self.rng.choice(alive)
        else:
            self.button = self._next_alive(self.button)
        order, s = [], self.button
        for _ in alive:
            s = self._next_alive(s)
            order.append(s)            # clockwise from left of button; button last
        heads_up = len(order) == 2
        sb_seat, bb_seat = (self.button, order[0]) if heads_up else (order[0], order[1])

        h = self.h = _Hand(self, level, sb, bb, order, sb_seat, bb_seat)
        h.post(sb_seat, sb, "s")
        h.post(bb_seat, bb, "b")
        deck = list(self.deck_fn(self.hand_no)) if self.deck_fn else \
            self.rng.sample(DECK, len(DECK))
        for _ in range(2):
            for seat in order:
                h.hole[seat].append(deck.pop(0))
        for street, ncards in enumerate(STREET_CARDS):
            if street:
                if len(h.in_hand) == 1:
                    break
                new = [deck.pop(0) for _ in range(ncards)]
                h.board += new
                h.log.append("|" + "".join(new))
                h.new_street()
            h.street = street
            start = (1 if heads_up else 2 % len(order)) if street == 0 else 0
            h.betting_round(start)
        h.award()
        busted = [x for x in alive if self.stacks[x] == 0]
        if busted:
            self._assign_bust_places(busted, h.start, len(self.alive()))
        net = [self.stacks[x] - h.start.get(x, 0) for x in self.seats]
        self.last_public = {"hand": self.hand_no, "board": list(h.board),
                            "shown": h.shown, "net": net, "busted": busted,
                            "log": " ".join(h.log)}
        if self.hand_logger:
            self.hand_logger({
                "hand": self.hand_no, "level": level, "sb": sb, "bb": bb,
                "button": self.button,
                "names": [self.ctrl[x].name for x in self.seats],
                "stacks_before": [h.start.get(x, 0) for x in self.seats],
                "hole": {str(x): h.hole[x] for x in order},
                **{k: v for k, v in self.last_public.items() if k != "hand"},
                "auto": h.auto,
            })


class _Hand:
    def __init__(self, table, level, sb, bb, order, sb_seat, bb_seat):
        self.t = table
        self.level, self.sb, self.bb = level, sb, bb
        self.order = order
        self.sb_seat, self.bb_seat = sb_seat, bb_seat
        self.start = {s: table.stacks[s] for s in order}
        self.in_hand = set(order)
        self.hole = {s: [] for s in order}
        self.board = []
        self.bet = {s: 0 for s in table.seats}
        self.total = {s: 0 for s in table.seats}
        self.log = []
        self.shown = []
        self.auto = []
        self.street = 0
        self.current = 0
        self.last_inc = bb
        self.counter = 0
        self.acted = {s: -1 for s in order}

    def put(self, seat, amount):
        self.t.stacks[seat] -= amount
        self.bet[seat] += amount
        self.total[seat] += amount

    def post(self, seat, blind, code):
        amt = min(blind, self.t.stacks[seat])
        self.put(seat, amt)
        self.current = max(self.current, self.bet[seat])
        self.log.append(f"{seat}{code}{amt}")

    def new_street(self):
        self.bet = {s: 0 for s in self.t.seats}
        self.current = 0
        self.last_inc = self.bb
        self.counter = 0
        self.acted = {s: -1 for s in self.order}

    def _others_with_chips(self, seat):
        return any(o != seat and self.t.stacks[o] > 0 for o in self.in_hand)

    def _needs(self, s):
        if s not in self.in_hand or self.t.stacks[s] == 0:
            return False
        if self.acted[s] != -1 and self.bet[s] >= self.current:
            return False
        if self.bet[s] >= self.current and not self._others_with_chips(s):
            return False
        return True

    def betting_round(self, start):
        seq = self.order[start:] + self.order[:start]
        i = 0
        while len(self.in_hand) > 1:
            for k in range(len(seq)):
                s = seq[(i + k) % len(seq)]
                if self._needs(s):
                    break
            else:
                return
            i = (i + k + 1) % len(seq)
            self.decide(s)

    def decide(self, s):
        t = self.t
        owe = self.current - self.bet[s]
        stack = t.stacks[s]
        can_raise = (self._others_with_chips(s) and self.acted[s] != self.counter
                     and stack > owe)
        min_add = self.current + self.last_inc - self.bet[s] if can_raise else None
        view = self.view(s, owe, min_add)
        ctrl = t.ctrl[s]
        raw, outcome = ctrl.act(view)
        auto = outcome != "ok"
        if outcome == "timeout":
            kind, add = actions.FOLD, 0
        elif auto:
            kind, add = actions.default_action(owe)
        else:
            res = actions.interpret(raw, owe, stack, can_raise, min_add)
            if res is None:
                ctrl.invalid(view, raw)
                auto = True
                res = actions.default_action(owe)
            kind, add = res
        mark = "!" if auto else ""
        if auto:
            self.auto.append([s, self.street, outcome if outcome != "ok" else "invalid"])
        if kind == actions.FOLD:
            self.in_hand.discard(s)
            self.log.append(f"{s}f{mark}")
        elif kind == actions.CHECK:
            self.log.append(f"{s}k{mark}")
        elif kind == actions.CALL:
            self.put(s, add)
            self.log.append(f"{s}c{add}{mark}")
        else:
            self.put(s, add)
            inc = self.bet[s] - self.current
            if inc >= self.last_inc:
                self.last_inc = inc
                self.counter += 1
            self.current = self.bet[s]
            self.log.append(f"{s}r{add}{mark}")
        self.acted[s] = self.counter

    def view(self, s, owe, min_add):
        t = self
        tb = self.t
        seats = []
        for x in tb.seats:
            if x not in self.start:
                status = "out"
            elif x not in self.in_hand:
                status = "folded"
            elif tb.stacks[x] == 0:
                status = "allin"
            else:
                status = "in"
            seats.append({"seat": x, "stack": tb.stacks[x], "bet": self.bet[x],
                          "total": self.total[x], "status": status})
        return {
            "hand": tb.hand_no, "hands_left": tb.max_hands - tb.hand_no,
            "level": t.level, "sb": t.sb, "bb": t.bb,
            "blinds_up_in": rules.hands_until_blinds_rise(tb.hand_no),
            "street": self.street, "me": s, "button": tb.button,
            "sb_seat": self.sb_seat, "bb_seat": self.bb_seat,
            "hole": list(self.hole[s]), "board": list(self.board),
            "pot": sum(self.total.values()), "owe": owe,
            "min_add": min_add, "max_add": tb.stacks[s],
            "seats": seats, "log": " ".join(self.log),
            "last_hand": tb.last_public, "ms": tb.ms,
        }

    def award(self):
        tb = self.t
        contrib = {s: v for s, v in self.total.items() if v > 0}
        pots, prev = [], 0
        for lvl in sorted(set(contrib.values())):
            payers = [s for s in contrib if contrib[s] >= lvl]
            amount = (lvl - prev) * len(payers)
            elig = [s for s in payers if s in self.in_hand] or sorted(self.in_hand)
            prev = lvl
            if pots and pots[-1][1] == elig:
                pots[-1][0] += amount
            else:
                pots.append([amount, elig])
        showdown = len(self.in_hand) > 1
        scores = {}
        if showdown:
            for s in self.order:
                if s in self.in_hand:
                    scores[s] = evaluate(self.hole[s] + self.board)
                    self.shown.append([s, list(self.hole[s]), hand_name(scores[s])])
        for amount, elig in pots:
            if len(elig) == 1:
                winners = elig
            else:
                best = max(scores[s] for s in elig)
                winners = [s for s in self.order if s in elig and scores[s] == best]
            share, odd = divmod(amount, len(winners))
            for i, s in enumerate(winners):     # winners are in clockwise order
                tb.stacks[s] += share + (1 if i < odd else 0)
