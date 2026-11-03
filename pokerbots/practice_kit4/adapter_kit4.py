"""Practice kit 4 (Six-Plus sit-and-go) adapter, PLAN A: our IcmAny bot behind the kit's
module-level NAME / setup(rules) / play(view, memory).

Bundled after our modules by sng/bundle_flat.py (the kit bans exec/compile, the time/os/sys
imports and most dunder access; 64 KiB cap). It also imports unbundled, so the unit tests
(practice_kit4/tests_adapter/) can drive it directly.

Kit facts handled here (practice_kit4/README.md):
  * seats 1..8, fixed for the table, out seats keep their number: our seat id = kit seat - 1;
  * view["pot"] includes this street's bets (ours too); amounts in chips;
  * the reply is the chips to ADD now (ours is raise-TO): add = to - my street bet;
    less than `owe` folds, 0 checks only when owe == 0; anything but an int is invalid;
  * min_add is None when we may not raise;
  * the log string: "<seat><code><chips added>[!]", codes s b f k c r, "|cards" = new street;
  * no end-of-hand call: last_hand arrives on our next decision (we feed it to end_hand once);
  * per-table state lives in `memory` (module globals are shared across tables).
"""
from dataclasses import dataclass as _dc

from engine.cards import parse_card as _pc
from engine.spec import SHORT_DECK_ORDER as _SDO, GameSpec as _GS
from sng.ours.anyvar import IcmAny as _IcmAny

NAME = "Jane Plan A"

# our model of the kit's variant (sng/presets.py "kit4_sixplus": same card signature)
_SPEC = _GS(name="kit4_sixplus", deck_ranks=tuple(range(4, 13)), category_order=_SDO,
            starting_stack=2000, small_blind=10, big_blind=20, stack_reset_per_hand=False)
_PAYOUTS = (100, 65, 45, 30, 20, 10, 5, 0)
INVARIANTS = False        # True: check every observation (tests / the invariant run)

try:   # the bundle embeds the six-plus any-variant table
    _ANY_OK = load_bundled_any(_SPEC)  # noqa: F821  (defined by the bundler)
except NameError:   # unbundled: IcmAny reads cache/sng/any_<sig>.json itself
    _ANY_OK = False

_CARDS = {}
for _r in "6789TJQKA":
    for _s in "cdhs":
        _CARDS[_r + _s] = _pc(_r + _s)


def kit_card(s):
    c = _CARDS.get(s)
    return c if c is not None else _pc(s)


# ---- observation types (the fields our bot reads; see sng/table.py) -----------------------
@_dc(slots=True)
class _Seat:
    seat: int
    stack: int
    bet: int
    committed: int
    folded: bool
    all_in: bool
    in_hand: bool


@_dc(slots=True)
class _Legal:
    can_check: bool
    can_call: bool
    call_amount: int
    can_raise: bool
    min_raise_to: int
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
    hand_number: int
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
    pot: int
    my_stack: int
    my_bet: int
    legal: object
    seats: tuple
    history: tuple
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


def parse_log(log, n=8):
    """kit log -> our tuples (seat id, street, kind, amount), raise amount = raise-TO; plus
    per seat id: chips put in this hand and on the current street."""
    out, total, cur, street = [], [0] * n, [0] * n, 0
    for t in log.split():
        if t[0] == "|":
            street += 1
            cur = [0] * n
            continue
        if t[-1] == "!":
            t = t[:-1]
        i = 0
        while t[i].isdigit():
            i += 1
        s = int(t[:i]) - 1
        code = t[i]
        amt = int(t[i + 1:]) if len(t) > i + 1 else 0
        if code in "sb":
            cur[s] += amt
            total[s] += amt
            out.append((s, street, "post", amt))
        elif code == "c":
            cur[s] += amt
            total[s] += amt
            out.append((s, street, "call", amt))
        elif code == "r":
            cur[s] += amt
            total[s] += amt
            out.append((s, street, "raise", cur[s]))
        elif code == "f":
            out.append((s, street, "fold", 0))
        elif code == "k":
            out.append((s, street, "check", 0))
    return out, total, cur


class Kit4Bot:
    def __init__(self, rules=None):
        r = rules or {}
        self.n = int(r.get("seats", 8))
        pays = tuple(r.get("points") or _PAYOUTS)
        self.rules = _Rules(self.n, pays + (0,) * (self.n - len(pays)), int(r.get("max_hands", 200)))
        self.bot = _IcmAny()
        self.bot.new_table(self.rules, 0, 12345)
        self.me = None
        self.seen_hand = 0            # last hand fed to end_hand
        self.violations = []

    def observe(self, v):
        n = self.n
        me = v["me"] - 1
        if self.me != me:
            self.me = me
            self.bot.new_table(self.rules, me, 12345)
        hist, total, cur = parse_log(v["log"], n)
        seats = []
        live = 0
        for k, sv in enumerate(v["seats"]):
            st = sv["status"]
            out = st == "out"
            live += not out
            seats.append(_Seat(k, sv["stack"], sv["bet"], sv["total"], st == "folded", st == "allin", not out))
        mine = v["seats"][me]
        my_bet = mine["bet"]
        owe = v["owe"]
        mx = v["max_add"]
        ma = v["min_add"]
        can_raise = ma is not None and mx > owe
        lo = my_bet + min(ma, mx) if can_raise else 0
        hi = my_bet + mx if can_raise else 0
        legal = _Legal(owe == 0, owe > 0, min(owe, mx), can_raise, lo, hi)
        pays = self.rules.payouts
        obs = _Obs(hand_number=v["hand"] - 1, hands_left=v["hands_left"], level=v["level"] - 1,
                   small_blind=v["sb"], big_blind=v["bb"], ante=0, seat=me, button=v["button"] - 1,
                   sb_seat=v["sb_seat"] - 1, bb_seat=v["bb_seat"] - 1, street=v["street"],
                   hole=tuple(kit_card(c) for c in v["hole"]), board=tuple(kit_card(c) for c in v["board"]),
                   pot=v["pot"], my_stack=mine["stack"], my_bet=my_bet, legal=legal, seats=tuple(seats),
                   history=tuple(hist), players_left=live, payouts=pays,
                   places_paid=tuple((q, pays[q - 1]) for q in range(1, live + 1)))
        if INVARIANTS:
            self._check(v, obs, total, cur)
        return obs

    def feed_last(self, v):
        lh = v.get("last_hand")
        if not lh or lh["hand"] <= self.seen_hand:
            return
        self.seen_hand = lh["hand"]
        hist, _, _ = parse_log(lh["log"], self.n)
        stacks = tuple(sv["stack"] + sv["total"] for sv in v["seats"])     # chips after that hand
        self.bot.end_hand(dict(history=tuple(hist), stacks=stacks))

    @staticmethod
    def reply(a, v, obs):
        owe = v["owe"]
        k = getattr(a, "kind", None)
        if k == "raise" and obs.legal.can_raise:
            add = int(a.amount) - obs.my_bet
            return int(min(v["max_add"], max(v["min_add"], add)))
        if k in ("raise", "call"):
            return int(min(owe, v["max_add"])) if owe > 0 else 0
        return 0 if owe == 0 else -1

    def play(self, v):
        try:
            self.feed_last(v)
        except Exception:  # noqa: BLE001  reads are optional
            if INVARIANTS:
                raise
        try:
            obs = self.observe(v)
            a = self.bot.act(obs)
            if INVARIANTS and not obs.legal.is_legal(a):
                self._bad(v, f"bot action {a} not legal under {obs.legal}")
            return self.reply(a, v, obs)
        except Exception as e:  # noqa: BLE001  never lose a decision to an exception
            if INVARIANTS:
                self._bad(v, f"exception {type(e).__name__}: {e}")
                raise AssertionError(self.violations[-1])
            return 0 if v.get("owe", 1) == 0 else -1

    # ---- invariant mode ---------------------------------------------------------------------
    def _bad(self, v, msg):
        self.violations.append(f"hand {v.get('hand')} street {v.get('street')}: {msg}")

    def _check(self, v, obs, total, cur):
        for k, sv in enumerate(v["seats"]):
            if sv["status"] != "out" and (total[k] != sv["total"] or cur[k] != sv["bet"]):
                self._bad(v, f"seat {k + 1}: log total/bet {total[k]}/{cur[k]} != view {sv['total']}/{sv['bet']}")
        if v["pot"] != sum(total):
            self._bad(v, f"pot {v['pot']} != log total {sum(total)}")
        if sum(sv["stack"] + sv["total"] for sv in v["seats"]) != 2000 * self.n:
            self._bad(v, "chips not conserved")
        lg = obs.legal
        if lg.can_raise and not (lg.min_raise_to <= lg.max_raise_to):
            self._bad(v, f"raise bounds {lg}")
        if len(obs.hole) != 2 or any(c is None for c in obs.hole + obs.board):
            self._bad(v, "cards")
        if self.violations:
            raise AssertionError(self.violations[-1])


# ---- the kit's interface ----------------------------------------------------------------------
_RULES = {}


def _warm():
    """Pay first-call costs (evaluator, strength keys) at import, not in a 1 ms decision."""
    b = Kit4Bot()
    seats = [dict(seat=k, stack=1980, bet=0, total=20 if k <= 2 else 0, status="in") for k in range(1, 9)]
    seats[0]["stack"], seats[0]["total"], seats[0]["bet"] = 1990, 10, 10
    seats[1]["stack"], seats[1]["total"], seats[1]["bet"] = 1980, 20, 20
    for k in range(2, 8):
        seats[k]["stack"], seats[k]["total"] = 2000, 0
    v = dict(hand=1, hands_left=199, level=1, sb=10, bb=20, blinds_up_in=25, street=0, me=3, button=8,
             sb_seat=1, bb_seat=2, hole=["Ah", "Kd"], board=[], pot=30, owe=20, min_add=40, max_add=2000,
             seats=seats, log="1s10 2b20", last_hand=None, ms=1.0)
    b.play(v)
    for board, st in ((["Th", "9s", "6d"], 1), (["Th", "9s", "6d", "Jc"], 2), (["Th", "9s", "6d", "Jc", "7h"], 3)):
        v.update(street=st, board=board, owe=0, min_add=20, log=v["log"] + " |x")
        for s in seats:
            s["bet"] = 0
        b.play(v)


try:
    _warm()
except Exception:  # noqa: BLE001  warming is best effort
    pass


def setup(rules):
    _RULES.clear()
    _RULES.update(rules or {})


def play(view, memory):
    b = memory.get("b")
    if b is None:
        b = memory["b"] = Kit4Bot(_RULES)
    return b.play(view)
