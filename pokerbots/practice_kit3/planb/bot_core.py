"""Plan B bot for practice kit 3 (Pitch Hold'em: 3 hole cards, discard 1 face up).

Equity tables (PRE, POST, at the end of the file) were built by simulating the
variant (planb/build_tables.py). Amounts in = chips; raises out = "r <x>",
x = street total in big blinds, rounded to 0.5 bb.
"""
import random

DEBUG = False          # set by planb/debug_harness.py, never by env vars

# ---- parameters (prompt 3) ----
PUSH_DEPTH = 9.0       # eff bb at or below which we push or fold unopened pots
PUSH_BASE = 0.75
PUSH_SLOPE = 0.25
OPEN_BAR = 1.07
STEAL_W = 0.55
RAISER_K = 4.0
EXTRA_OPP_K = 0.8
RERAISE = 2.6
RERAISE_ALLIN_EFF = 24.0
CALL_MARGIN = 0.06
ICM_BASE = 0.10
ICM_PER_BUST = 0.15
PRE_BIG_CALL = 0.40
POST_BIG_CALL = 0.50
POST_BET_DISCOUNT = 0.6
VALUE_BET_EQ = 0.62
VALUE_BET_FRAC = 0.65
CBET_FREQ = 0.55
CBET_FRAC = 0.5
STAB_W = 0.4

RANKS = "23456789TJQKA"
STRAIGHTS = [(0b11111 << (h - 4)) for h in range(12, 3, -1)] + [(1 << 12) | 0b1111]


def category(cards):
    """Hold'em category of the best 5 of 5..7 cards: 0 high card .. 8 straight flush."""
    cnt = [0] * 13
    suits = [0, 0, 0, 0]
    smask = [0, 0, 0, 0]
    mask = 0
    for c in cards:
        r = c % 13
        s = c // 13
        cnt[r] += 1
        suits[s] += 1
        smask[s] |= 1 << r
        mask |= 1 << r
    fl = -1
    for s in range(4):
        if suits[s] >= 5:
            fl = s
    if fl >= 0:
        m = smask[fl]
        for st in STRAIGHTS:
            if m & st == st:
                return 8
    mx = max(cnt)
    if mx == 4:
        return 7
    if mx == 3:
        n3 = 0
        n2 = 0
        for v in cnt:
            if v == 3:
                n3 += 1
            elif v == 2:
                n2 += 1
        if n3 >= 2 or n2:
            return 6
    if fl >= 0:
        return 5
    for st in STRAIGHTS:
        if mask & st == st:
            return 4
    if mx == 3:
        return 3
    if mx == 2:
        return 2 if cnt.count(2) >= 2 else 1
    return 0


def board_cat(board):
    if len(board) >= 5:
        return category(board)
    cnt = {}
    for c in board:
        cnt[c % 13] = cnt.get(c % 13, 0) + 1
    v = sorted(cnt.values(), reverse=True)
    if v[0] == 4:
        return 7
    if v[0] == 3:
        return 3
    if v[0] == 2:
        return 2 if len(v) > 1 and v[1] == 2 else 1
    return 0


def flush_draw(hole, board, cat):
    if cat >= 5 or len(board) >= 5:
        return 0
    allc = hole + board
    for s in (hole[0] // 13, hole[1] // 13):
        if sum(1 for c in allc if c // 13 == s) == 4:
            return 1
    return 0


def _class_index():
    out, i = {}, 0
    for hi in range(12, -1, -1):
        for lo in range(hi, -1, -1):
            if hi == lo:
                out[(hi, lo, 2)] = i
                i += 1
            else:
                out[(hi, lo, 1)] = i
                out[(hi, lo, 0)] = i + 1
                i += 2
    return out


CLASS_IDX = _class_index()


def pre2(a, b, k):
    """Variant equity of keeping a, b vs k opponents (None if not in table)."""
    ra, rb = a % 13, b % 13
    if ra < rb:
        ra, rb = rb, ra
    shape = 2 if ra == rb else (1 if a // 13 == b // 13 else 0)
    i = (CLASS_IDX[(ra, rb, shape)] * 7 + k - 1) * 3
    s = PRE[i:i + 3]
    return None if s == "   " else int(s) / 999.0


def best_keep(hole, k):
    """(equity, discard card) maximising the kept two-card equity vs k."""
    best, disc = -1.0, hole[0]
    n = len(hole)
    for i in range(n):
        keep = [hole[j] for j in range(n) if j != i]
        e = pre2(keep[0], keep[1], k)
        if e is None:
            e = 0.0
        if e > best:
            best, disc = e, hole[i]
    if best <= 0.0:
        best = 0.8 / (k + 1)
    return best, disc


def post_eq(si, mc, bc, fd, k):
    i = ((((si * 9 + mc) * 9 + bc) * 2 + fd) * 7 + k - 1) * 3
    s = POST[i:i + 3]
    if s != "   ":
        return int(s) / 999.0
    tot, n = 0.0, 0
    for b in range(9):
        for f in range(2):
            j = ((((si * 9 + mc) * 9 + b) * 2 + f) * 7 + k - 1) * 3
            s = POST[j:j + 3]
            if s != "   ":
                tot += int(s)
                n += 1
    if n:
        return tot / n / 999.0
    return 1.0 / (k + 1)


def raise_str(chips, bb):
    """'r x' rounded UP to 0.5 bb (so the engine never rounds us below `chips`)."""
    half = -(-int(chips) * 2 // bb)
    return "r %.1f" % (half / 2.0)


def allin_str(st):
    return raise_str(st["max_raise_to"], st["bb"])


class Agent:
    def __init__(self):
        self.me = None
        self.rng = random.Random(7)
        self.open_faced = {}
        self.open_fold = {}
        self.bet_faced = {}
        self.bet_fold = {}
        self.dbg = []
        self._new_hand()

    def _new_hand(self):
        self.pf_raises = 0
        self.opener = None
        self.responded = set()
        self.street = "preflop"
        self.street_bets = 0
        self.aggressor = None
        self.pre_cache = {}
        self.post_cache = None

    # ---------------- notifications (kept cheap: they are charged to decisions)
    def on_table_start(self, info):
        self.me = info.get("your_id")
        seed = 0
        for ch in str(info.get("table_id", "")) + str(self.me):
            seed = seed * 131 + ord(ch)
        self.rng = random.Random(seed)

    def on_hand_start(self, hand):
        self._new_hand()

    def on_event(self, ev):
        t = ev["type"]
        if t == "street":
            self.street = ev["street"]
            self.street_bets = 0
            self.aggressor = None
            return
        p = ev.get("player")
        if t == "blind" or t == "discard" or p is None:
            return
        if self.street == "preflop":
            if self.pf_raises == 1 and p != self.opener and p not in self.responded:
                self.responded.add(p)
                if p != self.me:
                    self.open_faced[p] = self.open_faced.get(p, 0) + 1
                    if t == "fold":
                        self.open_fold[p] = self.open_fold.get(p, 0) + 1
            if t == "raise":
                self.pf_raises += 1
                if self.pf_raises == 1:
                    self.opener = p
                self.aggressor = p
        else:
            if self.street_bets and p != self.aggressor and p != self.me and t != "check":
                self.bet_faced[p] = self.bet_faced.get(p, 0) + 1
                if t == "fold":
                    self.bet_fold[p] = self.bet_fold.get(p, 0) + 1
            if t == "bet" or t == "raise":
                self.street_bets += 1
                self.aggressor = p

    def open_rate(self, p):
        return (self.open_fold.get(p, 0) + 1.0) / (self.open_faced.get(p, 0) + 2.0)

    def bet_rate(self, p):
        return (self.bet_fold.get(p, 0) + 1.0) / (self.bet_faced.get(p, 0) + 2.0)

    # ---------------- decisions
    def on_discard_request(self, state):
        hole = state["hole_cards"]
        try:
            k = sum(1 for q in state["players"] if q["status"] != "folded") - 1
            k = 1 if k < 1 else (7 if k > 7 else k)
            c = best_keep(hole, k)[1]
            if c in hole:
                return c
        except Exception:
            if DEBUG:
                raise
        return min(hole, key=lambda x: x % 13)

    def on_action_request(self, state):
        try:
            a = self.decide(state)
            if DEBUG:
                self.check(state, a)
            return a
        except Exception:
            if DEBUG:
                raise
            return "c" if state.get("to_call", 1) == 0 else "f"

    def pre_eq(self, hole, k):
        e = self.pre_cache.get(k)
        if e is None:
            e = best_keep(hole, k)[0]
            self.pre_cache[k] = e
        return e

    def pre_eq_f(self, hole, kf):
        if kf <= 1:
            return self.pre_eq(hole, 1)
        if kf >= 7:
            return self.pre_eq(hole, 7)
        lo = int(kf)
        w = kf - lo
        e = self.pre_eq(hole, lo)
        return e if w == 0 else e * (1 - w) + self.pre_eq(hole, lo + 1) * w

    def premium(self, n_left):
        return ICM_BASE * (1 + ICM_PER_BUST * (8 - n_left))

    def decide(self, st):
        me = self.me
        bb = st["bb"]
        to_call = st["to_call"]
        free = to_call == 0
        players = st["players"]
        pot = st["pot"]
        stack = st["stack"]
        mine = stack + st["your_bet"]
        opps = [q for q in players if q["id"] != me and q["status"] != "folded"]
        n_opp = len(opps)
        big = 0
        for q in opps:
            v = q["stack"] + q["bet"]
            if v > big:
                big = v
        eff = min(mine, big) / bb
        hole = st["hole_cards"]
        can_raise = st["can_raise"]

        if st["street"] == "preflop":
            if st["current_bet"] <= bb:
                # ----- no raise yet
                acted = set()
                limpers = 0
                for e in st["history"]:
                    if e["street"] == "preflop" and e["type"] != "blind":
                        acted.add(e["player"])
                        if e["type"] == "call":
                            limpers += 1
                behind = [q for q in opps if q["id"] not in acted]
                k = len(behind) + limpers
                k = 1 if k < 1 else (7 if k > 7 else k)
                eq = self.pre_eq(hole, k)
                if can_raise:
                    if eff <= PUSH_DEPTH:
                        if eq >= (PUSH_BASE + PUSH_SLOPE * eff / PUSH_DEPTH) / (k + 1):
                            return allin_str(st)
                    else:
                        sf = 1.0
                        if 1 <= len(behind) <= 5 and limpers == 0:
                            f = sum(self.open_rate(q["id"]) for q in behind) / len(behind)
                            sf = 1 - STEAL_W * max(0.0, 2 * f - 1)
                        if eq >= OPEN_BAR / (k + 1) * sf:
                            return raise_str((2 + limpers) * bb, bb)
                return "c" if free else "f"
            # ----- facing a raise
            kf = RAISER_K + EXTRA_OPP_K * max(0, n_opp - 1)
            eq = self.pre_eq_f(hole, kf)
            if can_raise and eq * (kf + 1) >= RERAISE:
                if eff <= RERAISE_ALLIN_EFF:
                    return allin_str(st)
                return raise_str(3 * st["current_bet"], bb)
            if free:
                return "c"
            need = to_call / float(pot + to_call) + CALL_MARGIN
            if to_call >= stack or to_call > PRE_BIG_CALL * stack:
                need += self.premium(len(players))
            return "c" if eq >= need else "f"

        # ----- postflop
        k = 1 if n_opp < 1 else (7 if n_opp > 7 else n_opp)
        board = st["board"]
        key = (st["street"], len(board))
        pc = self.post_cache
        if pc is None or pc[0] != key:
            mc = category(hole + board)
            bc = board_cat(board)
            fd = flush_draw(hole, board, mc)
            si = len(board) - 3
            pc = (key, si, mc, bc, fd, {})
            self.post_cache = pc
        eqs = pc[5]
        eq = eqs.get(k)
        if eq is None:
            eq = post_eq(pc[1], pc[2], pc[3], pc[4], k)
            eqs[k] = eq
        if not free:
            nb = 0
            for e in st["history"]:
                if e["street"] == st["street"] and (e["type"] == "bet" or e["type"] == "raise"):
                    nb += 1
            adj = eq * (POST_BET_DISCOUNT ** max(1, nb))
            need = to_call / float(pot + to_call) + CALL_MARGIN
            if to_call >= POST_BIG_CALL * stack:
                need += self.premium(len(players))
            return "c" if adj >= need else "f"
        if not can_raise:
            return "c"
        if eq >= VALUE_BET_EQ:
            return raise_str(st["your_bet"] + VALUE_BET_FRAC * pot, bb)
        if st["street"] == "flop" and k == 1 and self.i_raised_pre(st):
            if self.rng.random() < CBET_FREQ:
                return raise_str(st["your_bet"] + CBET_FRAC * pot, bb)
            return "c"
        if k <= 2:
            f = sum(self.bet_rate(q["id"]) for q in opps) / len(opps)
            if self.rng.random() < STAB_W * max(0.0, 2 * f - 1):
                return raise_str(st["your_bet"] + CBET_FRAC * pot, bb)
        return "c"

    def i_raised_pre(self, st):
        last = None
        for e in st["history"]:
            if e["street"] == "preflop" and e["type"] == "raise":
                last = e["player"]
        return last == self.me

    # ---------------- debug checks (prompt 4)
    def check(self, st, a):
        players = st["players"]
        tot_in = sum(q["contributed"] for q in players)
        assert st["pot"] == tot_in, "pot %d != contributions %d" % (st["pot"], tot_in)
        chips = sum(q["stack"] + q["contributed"] for q in players)
        assert chips == 2000 * 8, "chips %d != 16000" % chips
        rebuilt = 0
        for e in st["history"]:
            if e["type"] in ("blind", "call", "bet", "raise"):
                rebuilt += e["amount"]
        assert rebuilt == st["pot"], "rebuilt pot %d != pot %d" % (rebuilt, st["pot"])
        me = [q for q in players if q["id"] == self.me][0]
        assert me["stack"] == st["stack"] and me["bet"] == st["your_bet"]
        assert st["to_call"] == min(st["current_bet"] - st["your_bet"], st["stack"])
        if a.startswith("r"):
            assert st["can_raise"], "raise sent when can_raise is false"
            x = float(a.split()[1])
            half = int(x * 2 + 0.5)
            assert abs(half - x * 2) < 1e-9, "not a 0.5 bb step: %r" % a
            chips = half * st["bb"] // 2
            assert chips >= st["min_raise_to"], "raise %r = %d chips below min %d (engine would bump it)" % (
                a, chips, st["min_raise_to"])
            assert chips > st["current_bet"], "raise %r to %d not above current bet %d" % (
                a, chips, st["current_bet"])
            self.dbg.append((chips, st["min_raise_to"], st["max_raise_to"]))
        else:
            assert a in ("c", "f"), a


