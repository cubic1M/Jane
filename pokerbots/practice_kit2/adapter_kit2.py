"""Practice kit 2 (Pocket Swap Hold'em) adapter, PLAN A: our IcmAny bot behind the kit's
module-level functions init(config) / get_action(state) / on_hand_end(summary).

Bundled after our modules by sng/bundle_flat.py (the kit bans exec/compile and the
sys/types/zlib/base64 imports sng/bundle.py needs; see that file). It also imports
unbundled, so the unit tests (practice_kit2/tests_adapter/) can drive it directly.

Kit facts handled here (practice_kit2/README.md):
  * cards '10H' (ten is '10', suits upper case) -> our ints; the draw reply must be the
    card string exactly as given;
  * seats are numbered from the button (0) and RENUMBERED every hand, closing up after
    knockouts; no ids: we keep a ring of stable opponent ids clockwise from us (we are
    id 0) and drop knocked-out players from it in on_hand_end;
  * pot excludes this round's bets; chips_total includes them (stack behind =
    chips_total - chips_in_pot_this_round); antes go to the pot, not to the round;
  * raise replies are raise-BY over current_bet (our bot says raise-TO); integer > 0;
  * a 0-1 card draw after the flop betting (street "draw"): our phase "discard" with
    discard_count 1 / discard_min 0 on street 1;
  * check facing a bet is INVALID (default fold); fold when checking is free is legal
    but wasteful (we check instead);
  * history: raise "amount" = BY, "to" = TO; blinds are small_blind / big_blind; antes
    and draws are entries too.
"""
from dataclasses import dataclass as _dc

from engine.cards import parse_card as _pc
from engine.spec import DiscardRule as _DR, GameSpec as _GS
from sng.ours.anyvar import IcmAny as _IcmAny

# our model of the kit's variant: sng/presets.py "draw_holdem" (same card signature, so
# the same cache/sng/any_<sig>.json strength table)
_SPEC = _GS(name="kit2_draw_holdem", starting_stack=2000, small_blind=10, big_blind=20,
            stack_reset_per_hand=False,
            discards=(_DR(street=1, count=1, to_board=False, face_up=False, draw=True, min_count=0),))
_STREET = {"preflop": 0, "flop": 1, "draw": 1, "turn": 2, "river": 3}
_PAYOUTS = (350, 220, 150, 100, 75, 50, 35, 20)     # kit lists 1st place first
INVARIANTS = False        # True: check every observation (tests / the invariant run)

try:   # the bundle embeds the draw_holdem any-variant table
    _ANY_OK = load_bundled_any(_SPEC)  # noqa: F821  (defined by the bundler)
except NameError:   # unbundled: IcmAny reads cache/sng/any_<sig>.json itself
    _ANY_OK = False

_CARD = {}
for _r, _o in zip(("2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"), "23456789TJQKA"):
    for _s in "CDHS":
        _CARD[_r + _s] = _pc(_o + _s.lower())


def kit_card(s):
    """'10H' -> our int (rank = s[:-1], suit = s[-1])."""
    c = _CARD.get(s)
    if c is None:
        r = s[:-1]
        c = _pc(("T" if r == "10" else r.upper()) + s[-1].lower())
    return c


# ---- observation types (the fields our bot reads; see sng/table.py) -----------------------
@_dc(slots=True)
class _Seat:
    seat: int
    stack: int          # chips behind
    bet: int            # chips put in this round
    committed: int      # chips put in this hand (antes and blinds included)
    folded: bool
    all_in: bool
    in_hand: bool


@_dc(slots=True)
class _Legal:
    can_check: bool
    can_call: bool
    call_amount: int
    can_raise: bool
    min_raise_to: int   # RAISE-TO terms
    max_raise_to: int
    discard_count: int = 0
    discard_min: int = 0

    def passive(self):
        from engine.game import Call, Check
        return Check() if self.can_check else Call()

    def clamp(self, amount):
        return int(min(self.max_raise_to, max(self.min_raise_to, int(round(amount)))))

    def is_legal(self, a):
        k = getattr(a, "kind", None)
        if self.discard_count:
            return k == "discard" and self.discard_min <= len(a.cards) <= self.discard_count
        if k == "fold":
            return True
        if k == "check":
            return self.can_check
        if k == "call":
            return self.can_call
        if k == "raise":
            return self.can_raise and self.min_raise_to <= a.amount <= self.max_raise_to
        return False


@_dc(slots=True)
class _Obs:
    hand_number: int    # 0-based
    hands_left: int
    level: int
    small_blind: int
    big_blind: int
    ante: int
    seat: int
    button: int
    sb_seat: int
    bb_seat: int
    street: int
    hole: tuple
    board: tuple
    pot: int            # incl. this round's bets
    my_stack: int
    my_bet: int
    legal: object
    seats: tuple
    history: tuple      # (seat, street, kind, amount); raise amount = raise-TO
    players_left: int
    payouts: tuple
    places_paid: tuple
    phase: str = "bet"
    my_discards: tuple = ()
    visible_discards: tuple = ()


class _Rules:
    def __init__(self, num_players=8, payouts=_PAYOUTS, max_hands=200):
        self.spec = _SPEC
        self.num_players = num_players
        self.payouts = tuple(payouts)
        self.max_hands = max_hands


# ---- stable identities ------------------------------------------------------------------
class Seating:
    """Kit seat k (this hand's numbering, button = 0) -> a stable id.

    I am always id 0; `ring` holds the opponents' ids in clockwise order from me, so
    clockwise order is increasing id order (mod n_ids), which our bot assumes. Kit seat k
    sits (k - my_seat) mod n places clockwise from me. Knockouts leave the ring; the
    others keep their ids. If the ring length ever disagrees with the table size (a
    missed on_hand_end with a knockout), the ring is rebuilt and `resets` counts it."""

    def __init__(self):
        self.ring = None
        self.hand = None
        self.ids = None
        self.resets = 0

    def for_hand(self, hand_number, my_seat, n):
        if self.hand == hand_number and self.ids is not None and len(self.ids) == n:
            return self.ids
        if self.ring is None or len(self.ring) != n - 1:
            if self.ring is not None:
                self.resets += 1
            self.ring = list(range(1, n))
        ring = self.ring
        self.ids = [0 if k == my_seat else ring[(k - my_seat) % n - 1] for k in range(n)]
        self.hand = hand_number
        return self.ids

    def knock_out(self, hand_number, my_seat, n, seats):
        ids = self.for_hand(hand_number, my_seat, n)
        gone = {ids[s] for s in seats if 0 <= s < n and ids[s] != 0}
        self.ring = [i for i in self.ring if i not in gone]


def rebuild(history, ids, n):
    """kit history -> our tuples (stable id, street, kind, amount): blinds 'post', antes
    and draws skipped, raise amount = raise-TO. Also per kit seat: chips put in this hand
    (antes included), chips put in on the last street seen, and that street's name."""
    out, total, cur, street = [], [0] * n, [0] * n, None
    for e in history:
        sn = e["street"]
        if sn != street:
            street, cur = sn, [0] * n
        a, s = e["action"], e["seat"]
        if a == "ante":
            total[s] += e["amount"]
        elif a == "raise":
            to = e["to"]
            total[s] += to - cur[s]
            cur[s] = to
            out.append((ids[s], _STREET[sn], "raise", to))
        elif a in ("call", "small_blind", "big_blind"):
            amt = e["amount"]
            cur[s] += amt
            total[s] += amt
            out.append((ids[s], _STREET[sn], "call" if a == "call" else "post", amt))
        elif a != "draw":
            out.append((ids[s], _STREET[sn], a, 0))
    return out, total, cur, street


class Kit2Bot:
    def __init__(self, config=None):
        cfg = config or {}
        self.n_ids = max(8, int(cfg.get("num_players", 8)))
        pays = tuple(cfg.get("payouts_per_mille") or _PAYOUTS)
        self.rules = _Rules(self.n_ids, pays + (0,) * (self.n_ids - len(pays)), int(cfg.get("max_hands", 200)))
        self.total_chips = int(cfg.get("starting_stack", 2000)) * int(cfg.get("num_players", 8))
        self.bot = _IcmAny()
        self.bot.new_table(self.rules, 0, 12345)
        self.seating = Seating()
        self.violations = []
        self.reported = 0
        self.last_after = None          # (hand_number, {stable id: chips after})
        self._warm()

    def _warm(self):
        """Pay first-call costs (evaluator, strength keys, discard policy) here, not in a
        1 ms decision."""
        st = dict(type="action", hand_number=1, hands_remaining=199, level=1, small_blind=10,
                  big_blind=20, ante=0, street="flop", board=["10H", "AS", "3D"], hole_cards=["KC", "10D"],
                  my_seat=1, num_seats=3, pot=60, current_bet=0, min_raise_by=20, can_raise=True,
                  players=[dict(seat=k, chips_total=1980, chips_in_pot_this_round=0, status="active", drew=None)
                           for k in range(3)],
                  history=[dict(street="preflop", seat=1, action="small_blind", amount=10),
                           dict(street="preflop", seat=2, action="big_blind", amount=20)])
        saved = (self.seating.ring, self.seating.hand, self.seating.ids)
        bot_state = self.bot._hand
        for street, kind in (("preflop", "action"), ("flop", "action"), ("draw", "draw"), ("turn", "action")):
            st["street"], st["type"] = street, kind
            if street == "turn":
                st["board"] = st["board"] + ["7C"]
            self.decide(st)
        self.seating.ring, self.seating.hand, self.seating.ids = saved
        self.bot._hand = bot_state
        self.bot.aggressor = None
        self.violations = []

    # ---- kit state -> our observation -------------------------------------------------
    def observe(self, state):
        n = state["num_seats"]
        my = state["my_seat"]
        before = self.seating.resets
        ids = self.seating.for_hand(state["hand_number"], my, n)
        if self.seating.resets != before:            # lost track of who is who: forget the reads
            self.bot.new_table(self.rules, 0, 12345)
        hist, total, cur, last_street = rebuild(state["history"], ids, n)
        players = state["players"]
        seats = [_Seat(i, 0, 0, 0, True, False, False) for i in range(self.n_ids)]
        pot = state["pot"]
        for p in players:
            k = p["seat"]
            rb = p["chips_in_pot_this_round"]
            st = p["status"]
            pot += rb
            seats[ids[k]] = _Seat(ids[k], p["chips_total"] - rb, rb, total[k], st == "folded", st == "allin", True)
        me = players[my]
        rb = me["chips_in_pot_this_round"]
        behind = me["chips_total"] - rb
        draw = state["type"] == "draw"
        if draw:
            legal = _Legal(False, False, 0, False, 0, 0, discard_count=1, discard_min=0)
        else:
            cb = state["current_bet"]
            to_call = max(0, cb - rb)
            can_raise = bool(state["can_raise"]) and behind > to_call and me["chips_total"] > cb
            lo = hi = 0
            if can_raise:
                hi = me["chips_total"]
                lo = min(cb + max(1, state["min_raise_by"]), hi)
            legal = _Legal(to_call == 0, to_call > 0, min(to_call, behind), can_raise, lo, hi)
        heads_up = n == 2
        pays = self.rules.payouts
        obs = _Obs(hand_number=state["hand_number"] - 1, hands_left=state["hands_remaining"],
                   level=state["level"], small_blind=state["small_blind"], big_blind=state["big_blind"],
                   ante=state["ante"], seat=0, button=ids[0], sb_seat=ids[0] if heads_up else ids[1],
                   bb_seat=ids[1] if heads_up else ids[2], street=_STREET[state["street"]],
                   hole=tuple(kit_card(c) for c in state["hole_cards"]),
                   board=tuple(kit_card(c) for c in state["board"]), pot=pot, my_stack=behind, my_bet=rb,
                   legal=legal, seats=tuple(seats), history=tuple(hist), players_left=n, payouts=pays,
                   places_paid=tuple((q, pays[q - 1]) for q in range(1, n + 1)),
                   phase="discard" if draw else "bet",
                   visible_discards=((),) * self.n_ids)
        if INVARIANTS:
            self._check(state, obs, ids, total, cur, last_street)
        return obs

    # ---- our action -> kit reply ----------------------------------------------------------
    @staticmethod
    def reply(a, state, obs):
        if state["type"] == "draw":
            out = tuple(getattr(a, "cards", ()) or ())
            if len(out) == 1:
                for s in state["hole_cards"]:
                    if kit_card(s) == out[0]:
                        return {"discard": s}
            return {"discard": None}
        lg = obs.legal
        free = lg.can_check
        k = a.kind
        if k == "raise" and lg.can_raise:
            cb = state["current_bet"]
            allin_by = state["players"][state["my_seat"]]["chips_total"] - cb
            by = min(max(int(a.amount) - cb, 1), allin_by)
            if by > 0:
                return {"action": "raise", "amount": int(by)}
        if k in ("raise", "call"):
            return {"action": "check" if free else "call"}
        return {"action": "check" if free else "fold"}

    def decide(self, state):
        try:
            obs = self.observe(state)
            a = self.bot.act(obs)
            if INVARIANTS and not obs.legal.is_legal(a):
                self._bad(state, f"bot action {a} not legal under {obs.legal}")
            r = self.reply(a, state, obs)
            if INVARIANTS:
                self._check_reply(state, r)
            return r
        except Exception as e:  # noqa: BLE001  never lose a decision to an exception
            if INVARIANTS:
                self._bad(state, f"exception {type(e).__name__}: {e}")
            if state.get("type") == "draw":
                return {"discard": None}
            me = state["players"][state["my_seat"]]
            free = state["current_bet"] - me["chips_in_pot_this_round"] <= 0
            return {"action": "check" if free else "fold"}

    def hand_end(self, summary):
        n = len(summary["chips_after"])
        my = summary["my_seat"]
        ids = self.seating.for_hand(summary["hand_number"], my, n)
        hist, total, _, _ = rebuild(summary["history"], ids, n)
        after = {ids[int(k)]: v for k, v in summary["chips_after"].items()}   # JSON keys are strings
        # identities first (cheap), so a slow or failing read update cannot desync the ring
        self.seating.knock_out(summary["hand_number"], my, n, summary.get("knocked_out_seats") or [])
        self.last_after = (summary["hand_number"], after)
        if INVARIANTS:
            if sum(summary["net"].values()) != 0:
                self._bad(summary, f"net does not sum to 0: {summary['net']}")
            if sum(after.values()) != self.total_chips:
                self._bad(summary, f"chips_after sum {sum(after.values())} != {self.total_chips}")
            if {ids[s] for s in summary.get("knocked_out_seats") or []} != {i for i, v in after.items() if v == 0}:
                self._bad(summary, "knocked_out_seats != seats with 0 chips")
        stacks = tuple(after.get(i, 0) for i in range(self.n_ids))
        self.bot.end_hand(dict(history=tuple(hist), stacks=stacks))
        if INVARIANTS and len(self.violations) > self.reported:
            new = self.violations[self.reported:]
            self.reported = len(self.violations)
            raise AssertionError(f"{len(new)} invariant violation(s): {new[0]}")

    # ---- invariant mode ---------------------------------------------------------------------
    def _bad(self, state, msg):
        self.violations.append(f"hand {state.get('hand_number')} {state.get('street', '')}: {msg}")

    def _check(self, state, obs, ids, total, cur, last_street):
        n = state["num_seats"]
        players = state["players"]
        if sorted(ids) != sorted(set(ids)) or ids[state["my_seat"]] != 0 or len(ids) != n:
            self._bad(state, f"bad id map {ids}")
        rbs = [p["chips_in_pot_this_round"] for p in players]
        # pot (earlier rounds + antes) = chips put in this hand minus this round's bets
        if state["pot"] != sum(total) - sum(rbs):
            self._bad(state, f"pot {state['pot']} != rebuilt {sum(total)} - round {sum(rbs)}")
        if obs.pot != sum(total):
            self._bad(state, f"our pot {obs.pot} != hand chips {sum(total)}")
        same = last_street == state["street"]
        for k, p in enumerate(players):
            if (cur[k] if same else 0) != rbs[k]:
                self._bad(state, f"seat {k} round bet {rbs[k]} != rebuilt {cur[k] if same else 0}")
            if p["chips_total"] - rbs[k] < 0:
                self._bad(state, f"seat {k} negative stack")
        starts = {ids[k]: p["chips_total"] - rbs[k] + total[k] for k, p in enumerate(players)}
        if sum(starts.values()) != self.total_chips:
            self._bad(state, f"stacks + hand chips {sum(starts.values())} != {self.total_chips}")
        la = self.last_after
        if la is not None and la[0] == state["hand_number"] - 1:
            alive = {i: v for i, v in la[1].items() if v > 0}
            if alive != starts:
                self._bad(state, f"identity: start stacks {starts} != last chips_after {alive}")
        if state["type"] == "action":
            lg = obs.legal
            me = players[state["my_seat"]]
            if lg.can_raise:
                if not state["current_bet"] < lg.min_raise_to <= lg.max_raise_to == me["chips_total"]:
                    self._bad(state, f"raise bounds {lg}")
                if lg.min_raise_to < lg.max_raise_to and lg.min_raise_to - state["current_bet"] != state["min_raise_by"]:
                    self._bad(state, f"min raise {lg.min_raise_to} vs by {state['min_raise_by']}")
            if lg.call_amount > obs.my_stack or lg.can_check == lg.can_call:
                self._bad(state, f"call bounds {lg}")
        elif any(rbs):
            self._bad(state, "round bets during the draw")
        if [kit_card(c) for c in state["hole_cards"]] != list(obs.hole) or len(obs.hole) != 2:
            self._bad(state, "hole cards")

    def _check_reply(self, state, r):
        if state["type"] == "draw":
            if set(r) != {"discard"} or not (r["discard"] is None or r["discard"] in state["hole_cards"]):
                self._bad(state, f"draw reply {r}")
            return
        me = state["players"][state["my_seat"]]
        to_call = state["current_bet"] - me["chips_in_pot_this_round"]
        act = r.get("action")
        if act == "check" and to_call > 0:
            self._bad(state, "check facing a bet")
        if act == "fold" and to_call <= 0:
            self._bad(state, "fold when checking is free")
        if act == "raise":
            amt = r.get("amount")
            if type(amt) is not int or not 0 < amt <= me["chips_total"] - state["current_bet"] or not state["can_raise"]:
                self._bad(state, f"raise reply {r}")
        if act not in ("fold", "check", "call", "raise"):
            self._bad(state, f"reply {r}")


# ---- the kit's interface ----------------------------------------------------------------------
_BOT = Kit2Bot()      # everything heavy at import (init re-runs the cheap part with the config)


def init(config):
    global _BOT
    try:
        _BOT = Kit2Bot(config)
    except Exception:  # noqa: BLE001  keep the import-time bot
        pass


def get_action(state):
    return _BOT.decide(state)


def on_hand_end(summary):
    try:
        _BOT.hand_end(summary)
    except AssertionError:
        raise                # invariant mode reports through the runner's error count
    except Exception:  # noqa: BLE001
        pass
