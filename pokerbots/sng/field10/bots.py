"""The eight field10 bots: what student teams with AI coding assistants plausibly submit after
2-3 hours (8-max NLHE sit-and-go, 2,000 chips, 10/20 blinds, 1 ms per decision).

  f10_chen          Chen-formula thresholds preflop, "bet if strong" postflop; ignores position,
                    stack depth and ICM. Quirks: Chen rounded down (int()), A2 scored as an
                    11-gap, a raise-call cutoff compared with the STARTING stack (400 chips)
                    instead of the current one, re-raises "3x" the call amount.
  f10_montecarlo    equity vs random hands (precomputed preflop table; 32 live samples
                    postflop through the engine evaluator) against pot odds. Quirks: opponents
                    are random hands (calls shoves with K7o), opponent count capped at 3
                    preflop / 2 postflop "for speed", visible discards not removed, raise
                    sizes computed from equity x pot.
  f10_pushfold      push/fold chart below 18 bb from hand 1, nit-raise-or-fold above.
                    Quirks: the bubble factor reads the payout table one place off (and widens
                    shoves where it means to tighten calls), the effective stack is its own
                    stack, limpers are treated as if the pot were unopened.
  f10_llm_rules     an LLM-written rule list (premium pairs raise 3x, suited connectors call,
                    c-bet 70%, fold to big river bets, never fold a set...). Quirks: "raise 3x"
                    = RaiseTo(3*bb) (a min-raise when facing a raise), the river fold rule runs
                    before the never-fold-a-set rule, the suited-connector rule shadows the
                    steal rule (KQs limps the button), board pairs count as two pair.
  f10_aggro         hyper-aggressive: opens 45%, 3-bets 20%, barrels 100/65/45%, raises or
                    shoves when unsure. Quirk: 3-bets to 3x the call amount (raise-by confusion,
                    clamped), calls shoves with the top 30%.
  f10_passive       calling station: calls down with any pair (a board pair counts) or draw,
                    raises only AA/KK preflop (min-raise) and sets+ postflop now and then.
  f10_tag_simple    the best team in the room: position-based opening charts, 3-bet / call
                    charts, short-stack push/fold, raise-or-fold at 12-25 bb, c-bets and
                    value-bets by hand class, a little bubble tightening. Quirk: SB uses a
                    late-position range, M ignores antes.
  f10_exploit_lite  a TAG-lite base plus VPIP / PFR / aggression counters per seat: steals
                    wider when the players behind are tight, defends / calls lighter against
                    aggressive raisers, stops bluffing stations. Quirks: no minimum sample
                    (trusts 2-hand stats), counters keep seat stats after the seat busts.
"""
from __future__ import annotations

import numpy as np

from engine.evaluator import get_evaluator
from engine.game import Call, Check, Discard, Fold, RaiseTo

from .base10 import (DRAW, NO_DRAW, STRAIGHT, GUTSHOT, MID, OVER, TOP, TRIPS, TWO, WEAK, Bot10, Ctx, best_pair, chen_raw, classify,
                     hand_key, lowest, parse_range, pre_pct, raw_category)


def _is_last_street(c: Ctx, spec) -> bool:
    return c.street >= len(spec.board_cards_per_street) - 1


# =============================================================================== 1. chen
class Chen(Bot10):
    name = "f10_chen"

    def discard(self, obs):
        # "throw away the lowest cards"
        lg = obs.legal
        return Discard(lowest(obs.hole, lg.discard_min))

    def score(self, hole):
        a, b = best_pair(hole)
        return int(chen_raw(a, b))          # bug: rounds 9.5 down to 9

    def decide(self, c: Ctx):
        if c.street == 0:
            return self.preflop(c)
        return self.postflop(c)

    def preflop(self, c: Ctx):
        s = self.score(c.hole)
        bb = c.bb
        if c.unopened:
            if s >= 10:
                return RaiseTo(3 * bb)
            if s >= 7:
                return Call()               # limp (check in the BB)
            return Fold()
        if s >= 12:
            if c.to_call > 0.3 * c.stack:
                return c.shove()
            return RaiseTo(c.my_bet + 3 * c.to_call)
        if s >= 10:
            # bug: "20% of the stack" uses the starting stack
            if c.to_call <= 0.2 * self.rules.starting_stack:
                return Call()
            return Fold()
        if s >= 8 and c.to_call <= 2 * bb:
            return Call()
        return Fold()

    def postflop(self, c: Ctx):
        made, draw = classify(c.hole, c.board)
        if made >= TWO:
            if c.to_call == 0:
                return RaiseTo(c.pot_bet(0.75))
            return RaiseTo(c.my_bet + 3 * c.to_call)
        if made >= TOP:
            if c.to_call == 0:
                return RaiseTo(c.pot_bet(0.5))
            return Call() if c.to_call <= 0.75 * c.pot else Fold()
        if made >= MID:
            return Call() if c.to_call <= c.pot / 3 else Fold()
        if draw >= DRAW and c.to_call <= c.pot / 4:
            return Call()
        return Fold()


# ========================================================================= 2. monte carlo
_AR4 = np.arange(4, dtype=np.int64)
_POW5 = 5 ** np.arange(13, dtype=np.int64)
_SHIFT8 = 1 << (3 * _AR4)                 # suit counts packed 3 bits each (at most 7 cards)
_CARD_R5 = np.array([5 ** (c >> 2) for c in range(52)], dtype=np.int64)
_CARD_S8 = np.array([1 << 3 * (c & 3) for c in range(52)], dtype=np.int64)
_CARD_M = np.array([1 << (13 * (c & 3) + (c >> 2)) for c in range(52)], dtype=np.int64)   # rank bits per suit
_FLUSH_SUIT = np.array([next((u for u in range(4) if (k >> 3 * u) & 7 >= 5), -1) for k in range(4096)],
                       dtype=np.int64)


class Fast7:
    """Exact 7-card scores through a lookup on the rank multiset (key = sum of 5^rank) plus the
    engine's flush table for rows with five of a suit. Built once per card rules from the
    engine evaluator, so the scores are the engine's own."""

    _CACHE = {}

    def __init__(self, spec):
        from itertools import combinations_with_replacement
        ev = get_evaluator(spec)
        key = (tuple(spec.deck_ranks), spec.category_order, spec.ace_low_straight)
        if key not in Fast7._CACHE:
            ranks = sorted(spec.deck_ranks)
            rows = [m for m in combinations_with_replacement(ranks, 7) if max(m.count(x) for x in set(m)) <= 4]
            arr = np.array(rows, dtype=np.int64)
            cards = (arr << 2) | (np.arange(7, dtype=np.int64) % 4)       # round-robin suits: never a flush
            vals = ev.eval_any(cards)
            keys = _POW5[arr].sum(axis=1)
            o = np.argsort(keys)
            Fast7._CACHE[key] = (keys[o], vals[o])
        self.keys, self.vals = Fast7._CACHE[key]
        self.flush = ev.t["flush"]

    def __call__(self, cards):
        r = cards >> 2
        sc = self.vals[np.minimum(np.searchsorted(self.keys, _POW5[r].sum(axis=1)), len(self.keys) - 1)]
        s = cards & 3
        fs = _FLUSH_SUIT[_SHIFT8[s].sum(axis=1)]          # suit with 5+ cards, else -1
        fl = np.flatnonzero(fs >= 0)
        if len(fl):
            m = np.bitwise_or.reduce(np.where(s[fl] == fs[fl, None], 1 << r[fl], 0), axis=1)
            sc[fl] = np.maximum(sc[fl], self.flush[m])
        return sc

class MonteCarlo(Bot10):
    name = "f10_montecarlo"
    SAMPLES = 20
    PRE_SAMPLES = 160
    _PRE = {}                   # per process: card rules -> {(hand key, nopp): equity vs random}

    def setup(self):
        sp = self.spec
        self.ev = get_evaluator(sp)
        self.nrng = np.random.default_rng(self.rng.randrange(1 << 30))
        self.deck = list(sp.deck)
        self.live = sp.hole_usage == "any"
        self.fast = Fast7(sp) if self.live else None
        self.pre = None
        self._cache_key, self._cache_eq = None, 0.0
        if sp.hole_cards == 2 and self.live and 2 + sp.total_board_dealt >= 5:
            key = (tuple(sp.deck_ranks), sp.category_order, sp.ace_low_straight, sp.total_board_dealt)
            if key not in MonteCarlo._PRE:
                MonteCarlo._PRE[key] = self._build_pre(sp)
            self.pre = MonteCarlo._PRE[key]

    def _build_pre(self, sp):
        rng = np.random.default_rng(12345)
        ranks = sorted(sp.deck_ranks)
        deck = np.array(sp.deck, dtype=np.int64)
        nb = sp.total_board_dealt
        out = {}
        N = self.PRE_SAMPLES
        for i, hi in enumerate(ranks):
            for lo in ranks[:i + 1]:
                for suited in ((False,) if hi == lo else (True, False)):
                    h = ((hi << 2) | 0, (lo << 2) | (0 if suited else 1))
                    rest = deck[(deck != h[0]) & (deck != h[1])]
                    for nopp in (1, 2, 3):
                        m = 2 * nopp + nb
                        idx = rng.random((N, len(rest))).argsort(axis=1)[:, :m]
                        drawn = rest[idx]
                        board = drawn[:, 2 * nopp:]
                        rows = [np.concatenate([np.tile(np.array(h), (N, 1)), board], axis=1)]
                        for o in range(nopp):
                            rows.append(np.concatenate([drawn[:, 2 * o:2 * o + 2], board], axis=1))
                        allrows = np.concatenate(rows)
                        ev = self.fast if allrows.shape[1] == 7 else self.ev.eval_any
                        sc = ev(allrows).reshape(nopp + 1, N)
                        best_opp = sc[1:].max(axis=0)
                        eq = (sc[0] > best_opp).mean() + 0.5 * (sc[0] == best_opp).mean()
                        out[(hi, lo, suited, nopp)] = float(eq)
        return out

    # --- equity ------------------------------------------------------------------
    def equity(self, c: Ctx, nopp: int) -> float:
        if c.street == 0 and self.pre is not None and len(c.hole) == 2:
            return self.pre.get(hand_key(*c.hole) + (min(3, nopp),), 0.3)
        if not self.live:
            return self.heuristic(c, nopp)
        if c.street > 0:
            # "skip the simulation in obvious spots to stay under 1 ms"
            made, draw = classify(c.hole, c.board)
            if made >= STRAIGHT or (made <= WEAK and draw == NO_DRAW and c.to_call == 0):
                return self.heuristic(c, nopp)
            key = (c.obs.hand_number, c.street, tuple(c.board), nopp)
            if key == self._cache_key:
                return self._cache_eq
            eq = self.simulate(c, nopp)
            self._cache_key, self._cache_eq = key, eq
            return eq
        return self.simulate(c, nopp)

    def simulate(self, c: Ctx, nopp: int) -> float:
        sp = self.spec
        known = set(c.hole) | set(c.board)          # bug: visible discards stay in the deck
        rest = np.array([x for x in self.deck if x not in known], dtype=np.int64)
        dealt = sum(sp.board_cards_per_street[:c.street + 1])
        need = max(0, sp.total_board_dealt - dealt)
        hn = len(c.hole)
        while nopp > 1 and hn * nopp + need > len(rest):
            nopp -= 1
        m = hn * nopp + need
        if m > len(rest) or hn + len(c.board) + need < 5 or len(rest) == 0:
            return self.heuristic(c, nopp)
        B = self.SAMPLES
        nk = len(c.board)
        width = hn + nk + need
        drawn = rest[self.nrng.integers(0, len(rest), (B, m))]     # bug: with replacement (duplicates possible)
        if width == 7:
            eq = self._fast_equity(c, drawn, nopp, hn)
            if eq is not None:
                return eq
        rows = np.empty((nopp + 1, B, width), dtype=np.int64)
        rows[0, :, :hn] = c.hole
        rows[1:, :, :hn] = drawn[:, :hn * nopp].reshape(B, nopp, hn).transpose(1, 0, 2)
        if nk:
            rows[:, :, hn:hn + nk] = c.board
        rows[:, :, hn + nk:] = drawn[:, hn * nopp:]
        rows = rows.reshape(-1, width)
        sc = (self.fast(rows) if width == 7 else self.ev.eval_any(rows)).reshape(nopp + 1, B)
        me = sc[0]
        best = sc[1:].max(axis=0)
        return (np.count_nonzero(me > best) + 0.5 * np.count_nonzero(me == best)) / B

    def _fast_equity(self, c: Ctx, drawn, nopp: int, hn: int):
        """The same scores as Fast7, with the lookup keys summed per card (no 7-card rows)."""
        B = self.SAMPLES
        n_opp = hn * nopp
        R = _CARD_R5[drawn]
        S = _CARD_S8[drawn]
        kb = sum(5 ** (x >> 2) for x in c.board)
        sb = sum(1 << 3 * (x & 3) for x in c.board)
        keys = np.empty((nopp + 1, B), dtype=np.int64)
        suits = np.empty((nopp + 1, B), dtype=np.int64)
        board_k = R[:, n_opp:].sum(axis=1) + kb
        board_s = S[:, n_opp:].sum(axis=1) + sb
        keys[0] = board_k + sum(5 ** (x >> 2) for x in c.hole)
        suits[0] = board_s + sum(1 << 3 * (x & 3) for x in c.hole)
        keys[1:] = R[:, :n_opp].reshape(B, nopp, hn).sum(axis=2).T + board_k
        suits[1:] = S[:, :n_opp].reshape(B, nopp, hn).sum(axis=2).T + board_s
        f = self.fast
        sc = f.vals[np.minimum(np.searchsorted(f.keys, keys), len(f.keys) - 1)]
        fs = _FLUSH_SUIT[suits & 4095]
        fl = fs >= 0
        if fl.any():
            M = _CARD_M[drawn]
            masks = np.empty((nopp + 1, B), dtype=np.int64)
            board_m = M[:, n_opp:].sum(axis=1) + sum(1 << (13 * (x & 3) + (x >> 2)) for x in c.board)
            masks[0] = board_m + sum(1 << (13 * (x & 3) + (x >> 2)) for x in c.hole)
            masks[1:] = M[:, :n_opp].reshape(B, nopp, hn).sum(axis=2).T + board_m
            sc[fl] = np.maximum(sc[fl], f.flush[(masks[fl] >> (13 * fs[fl])) & 8191])
        me = sc[0]
        best = sc[1:].max(axis=0)
        return (np.count_nonzero(me > best) + 0.5 * np.count_nonzero(me == best)) / B

    def heuristic(self, c: Ctx, nopp: int) -> float:
        if c.street == 0:
            eq1 = 0.68 - 0.36 * pre_pct(c.hole)
        else:
            made, draw = classify(c.hole, c.board)
            eq1 = (0.3, 0.35, 0.45, 0.55, 0.66, 0.72, 0.8, 0.86, 0.9, 0.93, 0.97)[made] + 0.05 * draw
        return eq1 ** max(1, nopp)

    # --- decisions ---------------------------------------------------------------
    def decide(self, c: Ctx):
        if c.street == 0:
            nopp = min(3, c.n_active - 1)
        else:
            nopp = min(2, c.n_active - 1)
        nopp = max(1, nopp)
        eq = self.equity(c, nopp)
        fair = 1.0 / (nopp + 1)
        po = c.pot_odds()
        if c.street == 0:
            if c.unopened:
                if eq > fair + 0.14:
                    return RaiseTo(c.bb * (2 + 4 * eq))           # "bigger with more equity"
                if eq > fair + 0.04:
                    return Call()
                return Fold()
            if eq > fair + 0.28 and not c.facing_allin:
                return RaiseTo(c.my_bet + c.to_call * 3)
            return Call() if eq > po + 0.02 else Fold()
        if c.to_call == 0:
            if eq > 0.62:
                return RaiseTo(c.pot_bet(min(1.0, eq)))
            if eq > 0.48 and self.rng.random() < 0.35:
                return RaiseTo(c.pot_bet(0.5))
            return Check()
        if eq > 0.78 and not c.facing_allin:
            amt = c.my_bet + 3 * c.to_call
            if amt > 0.45 * (c.stack + c.my_bet):
                return c.shove()
            return RaiseTo(amt)
        return Call() if eq > po + 0.02 else Fold()


# =========================================================================== 3. push/fold
PUSH_BASE = {0: 0.62, 1: 0.55, 2: 0.36, 3: 0.27, 4: 0.22, 5: 0.18, 6: 0.15, 7: 0.13}


class PushFold(Bot10):
    name = "f10_pushfold"
    PF_BB = 18

    def bubble(self, c: Ctx) -> float:
        """Tightening factor for calls (1 = none). Off by one: looks at the pay jump between
        places players_left+1 and players_left+2."""
        pay = self.rules.payouts
        pl = c.obs.players_left
        if pl + 1 < len(pay) and pay[0] > 0:
            jump = pay[pl] - pay[pl + 1]
            return 1.0 / (1.0 + 4.0 * jump / pay[0])
        return 1.0

    def decide(self, c: Ctx):
        pct = pre_pct(c.hole)
        if c.street == 0:
            if c.S <= self.PF_BB:
                return self.pushfold(c, pct)
            return self.deep_pre(c, pct)
        return self.post(c)

    def pushfold(self, c: Ctx, pct):
        S = max(1.0, c.S)
        tight = self.bubble(c)
        if c.unopened:
            nb = min(7, c.behind)
            width = PUSH_BASE.get(nb, 0.13) * (10.0 / S) ** 0.8 / tight   # bug: widens on the "bubble"
            if pct < min(1.0, width):
                return c.shove()
            return c.check_fold()
        # facing a raise or a shove: the shover's size in bb
        shover = c.to_call / c.bb + c.my_bet / c.bb
        width = 0.35 * (10.0 / max(2.0, shover)) ** 0.7 * tight / (1 + 0.3 * max(0, c.behind))
        if pct < min(0.6, width):
            return c.shove()
        return c.check_fold()

    def deep_pre(self, c: Ctx, pct):
        if c.unopened:
            if pct < 0.08:
                return RaiseTo(3 * c.bb)
            return c.check_fold()
        if pct < 0.03:
            return c.shove()
        if pct < 0.06 and c.to_call <= 0.1 * c.stack:
            return Call()
        return c.check_fold()

    def post(self, c: Ctx):
        made, draw = classify(c.hole, c.board)
        if c.to_call == 0:
            if made >= TOP or (c.i_am_pfr and c.street == 1 and self.rng.random() < 0.5):
                return RaiseTo(c.pot_bet(0.5))
            return Check()
        if made >= TWO:
            return c.shove()
        if made >= TOP:
            return Call()
        return Fold()


# ============================================================================ 4. llm rules
PREMIUM = parse_range("QQ+")
MEDIUM_PAIRS = parse_range("TT, JJ")
BIG_ACES = parse_range("AQ+")
SMALL_PAIRS = parse_range("22+") - parse_range("TT+")
BROADWAY = parse_range("KQ, KJ, KT, QJ, QT, JT, AT+")


class LlmRules(Bot10):
    name = "f10_llm_rules"

    def decide(self, c: Ctx):
        if c.street == 0:
            return self.preflop(c)
        return self.postflop(c)

    def preflop(self, c: Ctx):
        hole = best_pair(c.hole)
        k = hand_key(*hole)
        bb = c.bb
        pair = k[0] == k[1]
        # Rule 1: short stack -> all-in with any pair, any ace or two broadway cards
        if c.S < 10:
            if pair or k[0] == 12 or k[1] >= 8:
                return c.shove()
            return c.check_fold()
        # Rule 2: premium pairs (QQ+) raise 3x; facing a re-raise, go all-in
        if k in PREMIUM:
            if c.pre_raises >= 2:
                return c.shove()
            return RaiseTo(3 * bb)                 # "raise 3x" (a min-raise when facing a raise)
        # Rule 3: JJ/TT raise 2.5x unopened, call a raise up to 10% of the stack
        if k in MEDIUM_PAIRS:
            if c.unopened:
                return RaiseTo(2.5 * bb)
            return Call() if c.to_call <= 0.1 * c.stack else Fold()
        # Rule 4: AK/AQ raise 3x, call a 3-bet
        if k in BIG_ACES:
            if c.pre_raises >= 2:
                return Call() if c.to_call <= 0.25 * c.stack else Fold()
            return RaiseTo(3 * bb)
        # Rule 5: suited connectors call (play them cheap)
        if k[2] and k[0] - k[1] == 1 and k[1] >= 3:
            if c.to_call <= 4 * bb:
                return Call()
            return Fold()
        # Rule 6: small pairs set-mine if it is cheap (5% of the stack)
        if k in SMALL_PAIRS:
            return Call() if c.to_call <= 0.05 * c.stack else c.check_fold()
        # Rule 8: steal from late position with broadway / any ace when folded to
        if c.unopened and c.limpers == 0 and c.pos in ("btn", "co"):
            if k in BROADWAY or k[0] == 12:
                return RaiseTo(2.5 * bb)
        # Rule 7: never limp
        return c.check_fold()

    def postflop(self, c: Ctx):
        made, draw = classify(c.hole, c.board, not _is_last_street(c, self.spec))
        raw = raw_category(c.hole, c.board)
        river = _is_last_street(c, self.spec)
        # Rule 9: fold to big river bets (more than 75% pot)
        if river and c.to_call > 0.75 * (c.pot - c.to_call):
            return Fold()
        # Rule 10: as the preflop raiser, c-bet the flop 70% of the time (2/3 pot)
        if c.street == 1 and c.i_am_pfr and c.to_call == 0 and self.rng.random() < 0.7:
            return RaiseTo(c.pot_bet(2 / 3))
        # Rule 11: two pair or better: bet pot / raise 3x the bet
        if raw >= 2:
            if c.to_call == 0:
                return RaiseTo(c.pot_bet(1.0))
            return RaiseTo(3 * c.to_call)
        # Rule 12: never fold a set or better
        if made >= TRIPS:
            return Call() if c.to_call else RaiseTo(c.pot_bet(0.66))
        # Rule 13: top pair / overpair: bet 2/3 pot, call bets
        if made >= TOP:
            return RaiseTo(c.pot_bet(2 / 3)) if c.to_call == 0 else Call()
        # Rule 14: flush draw or open-ender: call up to a third of the pot
        if draw >= DRAW:
            return Call() if c.to_call <= c.pot / 3 else c.check_fold()
        # Rule 15: middle pair: call one bet up to half pot
        if made == MID and c.street_raises <= 1:
            return Call() if c.to_call <= c.pot / 2 else c.check_fold()
        return c.check_fold()


# ================================================================================ 5. aggro
class Aggro(Bot10):
    name = "f10_aggro"

    def decide(self, c: Ctx):
        pct = pre_pct(c.hole)
        if c.street == 0:
            return self.preflop(c, pct)
        return self.postflop(c)

    def preflop(self, c: Ctx, pct):
        bb = c.bb
        if c.S < 15:
            if c.unopened:
                return c.shove() if pct < 0.5 else c.check_fold()
            return c.shove() if pct < 0.3 else c.check_fold()
        if c.facing_allin:
            return Call() if pct < 0.3 else Fold()
        if c.unopened:
            width = 0.6 if c.pos in ("sb", "btn") else 0.45
            if pct < width:
                return RaiseTo(3 * bb + c.limpers * bb)
            return c.check_fold()
        if c.pre_raises == 1:
            if pct < 0.2:
                return RaiseTo(3 * c.to_call)              # raise-by confusion: 3x the call amount
            return Call() if pct < 0.35 else Fold()
        if pct < 0.1:
            return c.shove()
        return Call() if pct < 0.15 else Fold()

    def postflop(self, c: Ctx):
        made, draw = classify(c.hole, c.board, not _is_last_street(c, self.spec))
        r = self.rng.random()
        if c.to_call == 0:
            barrel = {1: 1.0, 2: 0.65}.get(c.street, 0.45)
            if made >= MID or draw >= DRAW or r < barrel:
                return RaiseTo(c.pot_bet(0.75))
            return Check()
        if made >= TWO:
            return c.shove()
        if made >= TOP or draw >= DRAW:
            if r < 0.5:
                return RaiseTo(c.my_bet + 3 * c.to_call)
            return Call()
        if made >= WEAK:
            if r < 0.15:
                return c.shove()                       # "when unsure, shove"
            return Call() if c.to_call <= 0.6 * c.pot else Fold()
        if r < 0.2:
            return RaiseTo(c.my_bet + 3 * c.to_call)
        return Fold()


# ============================================================================= 6. passive
class Passive(Bot10):
    name = "f10_passive"

    def decide(self, c: Ctx):
        if c.street == 0:
            return self.preflop(c)
        return self.postflop(c)

    def playable(self, k):
        hi, lo, suited = k
        return hi == lo or hi == 12 or suited or lo >= 7 or (hi - lo == 1 and lo >= 3)

    def preflop(self, c: Ctx):
        k = hand_key(*best_pair(c.hole))
        if k[0] == k[1] and k[0] >= 11 and c.pre_raises < 2:
            return RaiseTo(c.lg.min_raise_to)
        if c.to_call == 0:
            return Check()
        if c.facing_allin:
            return Call() if (k[0] == k[1] or pre_pct(c.hole) < 0.2) else Fold()
        if self.playable(k) and (c.to_call <= 0.15 * c.stack or c.to_call <= 3 * c.bb):
            return Call()
        return Fold()

    def postflop(self, c: Ctx):
        made, draw = classify(c.hole, c.board, not _is_last_street(c, self.spec))
        raw = raw_category(c.hole, c.board)
        if c.to_call == 0:
            if made >= TWO and self.rng.random() < 0.3:
                return RaiseTo(c.pot_bet(1 / 3))
            return Check()
        if made >= TRIPS and self.rng.random() < 0.25:
            return RaiseTo(c.lg.min_raise_to)
        if raw >= 1 or draw >= GUTSHOT:        # any pair (a board pair too) or any draw
            return Call()
        return Fold()


# ============================================================================== 7. tag
TAG_OPEN = {
    "ep": parse_range("77+, ATs+, KQs, AQo+"),
    "mp": parse_range("55+, A9s+, KTs+, QTs+, JTs, AJo+, KQo"),
    "co": parse_range("22+, A2s+, K7s+, Q8s+, J8s+, T8s+, 97s+, 87s, 76s, 65s, A8o+, KTo+, QTo+, JTo"),
    "btn": parse_range("22+, A2s+, K2s+, Q5s+, J7s+, T7s+, 96s+, 85s+, 75s+, 64s+, 54s, A2o+, K8o+, Q9o+, J9o+, "
                       "T9o, 98o"),
}
TAG_OPEN["sb"] = TAG_OPEN["co"] | parse_range("A2o+, K9o+, Q9o+")     # quirk: SB as a late position
TAG_DEFEND = parse_range("22+, A2s+, K6s+, Q8s+, J8s+, T8s+, 97s+, 86s+, 76s, 65s, A7o+, KTo+, QTo+, JTo")
TAG_3BET = parse_range("QQ+, AK")
TAG_3BET_LATE = TAG_3BET | parse_range("JJ, TT, AQs, AJs, KQs, A5s, A4s")
TAG_CALL = parse_range("22+, ATs+, KJs+, QJs, JTs, T9s, 98s, AQo")
TAG_4BET = parse_range("QQ+, AK")
TAG_CALL3 = parse_range("JJ, TT, AQs")


class TagSimple(Bot10):
    name = "f10_tag_simple"
    SHORT = 12
    MID_DEPTH = 25

    def decide(self, c: Ctx):
        if c.street == 0:
            return self.preflop(c)
        return self.postflop(c)

    def bubble(self, c: Ctx) -> bool:
        pay = self.rules.payouts
        pl = c.obs.players_left
        return 2 < pl <= len(pay) and pay[pl - 1] == 0 and c.obs.hands_left > 10

    def preflop(self, c: Ctx):
        hole = best_pair(c.hole)
        k = hand_key(*hole)
        pct = pre_pct(c.hole)
        bb = c.bb
        eff = c.eff if c.eff > 0 else c.S
        M = (c.stack + c.my_bet) / (c.obs.small_blind + bb)        # quirk: ignores antes
        tight = 0.7 if self.bubble(c) else 1.0
        if eff <= self.SHORT or M < 7:
            if c.unopened:
                nb = min(7, c.behind)
                width = PUSH_BASE.get(nb, 0.13) * (10.0 / max(1.0, eff)) ** 0.8
                return c.shove() if pct < min(1.0, width) else c.check_fold()
            shover = (c.to_call + c.my_bet) / bb
            width = 0.3 * (10.0 / max(2.0, shover)) ** 0.75 * tight / (1 + 0.25 * c.behind)
            return c.shove() if pct < min(0.5, width) else c.check_fold()
        late_opener = c.pfr is not None and c.pfr in c.order and \
            (len(c.order) - 1 - c.order.index(c.pfr)) <= 1
        if c.unopened:
            rng_set = TAG_OPEN.get(c.pos)
            if c.pos == "bb":
                if k in TAG_OPEN["mp"] and c.limpers:
                    return RaiseTo(4 * bb + c.limpers * bb)
                return Check() if c.lg.can_check else Fold()
            if rng_set is not None and k in rng_set:
                if eff <= self.MID_DEPTH:
                    return RaiseTo(2.2 * bb)
                return RaiseTo(2.5 * bb + c.limpers * bb)
            return c.check_fold()
        if c.pre_raises == 1:
            three = TAG_3BET_LATE if late_opener else TAG_3BET
            if k in three:
                if eff <= self.MID_DEPTH:
                    return c.shove()
                return RaiseTo(3 * (c.to_call + c.my_bet) + (bb if not c.ip else 0))
            if c.pos == "bb" and k in TAG_DEFEND and not c.facing_allin and c.to_call <= 2.5 * bb \
                    and eff > self.SHORT + 3:
                return Call()                                   # defend the big blind vs a small raise
            if k in TAG_CALL and eff > self.MID_DEPTH and tight == 1.0 and \
                    (c.ip or c.pos == "bb") and c.to_call <= 0.08 * c.stack:
                return Call()
            if c.facing_allin and pct < 0.05 * (1 if tight == 1.0 else 0.6) + 0.02:
                return Call()
            return c.check_fold()
        # facing a 3-bet or more
        if k in TAG_4BET:
            return c.shove()
        if k in TAG_CALL3 and c.to_call <= 0.15 * c.stack and not c.facing_allin:
            return Call()
        return c.check_fold()

    def postflop(self, c: Ctx):
        last = _is_last_street(c, self.spec)
        made, draw = classify(c.hole, c.board, not last)
        heads_up = c.n_active == 2
        strong = made >= TWO or (made >= OVER and heads_up)
        good = made >= TOP
        if c.to_call == 0:
            if strong:
                return RaiseTo(c.pot_bet(0.66))
            if good and (heads_up or made >= OVER):
                return RaiseTo(c.pot_bet(0.55 if c.street < 3 else 0.5))
            if c.i_am_pfr and c.street == 1 and heads_up and self.rng.random() < 0.75:
                return RaiseTo(c.pot_bet(0.4))
            if draw >= DRAW and c.street == 1 and self.rng.random() < 0.5:
                return RaiseTo(c.pot_bet(0.5))
            return Check()
        po = c.pot_odds()
        if made >= TRIPS or (made >= TWO and c.street_raises <= 1):
            if c.to_call > 0.4 * c.stack:
                return c.shove()
            return RaiseTo(c.my_bet + 2.5 * c.to_call + 0.5 * c.pot)
        if strong:
            return Call()
        if good:
            if c.street_raises >= 2:
                return Fold()
            return Call() if po < 0.4 else Fold()
        if made == MID and po < 0.25 and heads_up and c.street < 3:
            return Call()
        if draw >= DRAW and not last and po < 0.3:
            return Call()
        return Fold()


# ======================================================================= 8. exploit lite
class _Seat:
    __slots__ = ("hands", "vpip", "pfr", "raises", "calls", "steal_folds", "steal_opps")

    def __init__(self):
        self.hands = self.vpip = self.pfr = self.raises = self.calls = 0
        self.steal_folds = self.steal_opps = 0


class ExploitLite(Bot10):
    name = "f10_exploit_lite"
    BASE_OPEN = {"ep": 0.12, "mp": 0.16, "co": 0.25, "btn": 0.38, "sb": 0.33}

    def setup(self):
        self.st = {}

    def stats_for(self, j) -> _Seat:
        s = self.st.get(j)
        if s is None:
            s = self.st[j] = _Seat()
        return s

    def observe_hand(self, info):
        hist = info.get("history") or ()
        acted = set()
        vp = set()
        pr = set()
        for item in hist:
            if not isinstance(item, tuple) or len(item) < 3:
                continue
            j, st, kind = item[0], item[1], item[2]
            if kind in ("post", "discard"):
                continue
            if st == 0:
                acted.add(j)
                if kind in ("call", "raise"):
                    vp.add(j)
                if kind == "raise":
                    pr.add(j)
            else:
                if kind == "raise":
                    self.stats_for(j).raises += 1
                elif kind == "call":
                    self.stats_for(j).calls += 1
        for j in acted:
            s = self.stats_for(j)
            s.hands += 1
            s.vpip += j in vp
            s.pfr += j in pr

    def rates(self, j):
        s = self.st.get(j)
        if s is None or s.hands == 0:                 # no minimum sample beyond this
            return 0.25, 0.15, 1.0
        agg = (s.raises + 1) / (s.calls + 1)
        return s.vpip / s.hands, s.pfr / s.hands, agg

    def decide(self, c: Ctx):
        if c.street == 0:
            return self.preflop(c)
        return self.postflop(c)

    def preflop(self, c: Ctx):
        pct = pre_pct(c.hole)
        bb = c.bb
        if c.S <= 13:
            if c.unopened:
                width = PUSH_BASE.get(min(7, c.behind), 0.13) * (10.0 / max(1.0, c.S)) ** 0.8
                return c.shove() if pct < min(1.0, width) else c.check_fold()
            vp, pf, _ = self.rates(c.pfr)
            width = 0.12 + (0.12 if pf > 0.3 else 0.0)
            return c.shove() if pct < width else c.check_fold()
        if c.unopened:
            if c.pos == "bb":
                return Check() if c.lg.can_check else Fold()
            width = self.BASE_OPEN.get(c.pos, 0.12)
            if c.limpers == 0 and c.pos in ("co", "btn", "sb"):
                behind = [s.seat for s in c.others]          # everyone still in = the players behind
                tight = all(self.rates(j)[0] < 0.2 for j in behind) if behind else False
                if tight:
                    width = 0.6 if c.pos == "btn" else 0.5
            if pct < width:
                return RaiseTo(2.5 * bb + c.limpers * bb)
            return c.check_fold()
        vp, pf, agg = self.rates(c.pfr)
        loose = pf > 0.3
        if c.facing_allin:
            return Call() if pct < (0.2 if loose else 0.08) else Fold()
        if c.pre_raises == 1:
            three, call = (0.09, 0.22) if loose else (0.035, 0.09)
            if pct < three:
                return RaiseTo(3 * (c.to_call + c.my_bet))
            if pct < call and c.to_call <= 0.12 * c.stack:
                return Call()
            return c.check_fold()
        if pct < 0.03:
            return c.shove()
        if pct < (0.06 if loose else 0.04) and c.to_call <= 0.2 * c.stack:
            return Call()
        return c.check_fold()

    def postflop(self, c: Ctx):
        last = _is_last_street(c, self.spec)
        made, draw = classify(c.hole, c.board, not last)
        heads_up = c.n_active == 2
        opp = c.others[0].seat if heads_up else None
        vp, pf, agg = self.rates(opp) if opp is not None else (0.25, 0.15, 1.0)
        station = vp > 0.45 and pf < 0.1
        if c.to_call == 0:
            if made >= TWO or (made >= TOP and (heads_up or station)):
                return RaiseTo(c.pot_bet(0.75 if station else 0.6))
            if c.i_am_pfr and c.street == 1 and not station and self.rng.random() < 0.7:
                return RaiseTo(c.pot_bet(0.45))
            return Check()
        po = c.pot_odds()
        if made >= TRIPS:
            return RaiseTo(c.my_bet + 3 * c.to_call)
        if made >= TWO:
            return Call()
        aggressor = c.last_aggr
        _, _, a_agg = self.rates(aggressor) if aggressor is not None else (0, 0, 1.0)
        if made >= TOP:
            return Call() if (po < 0.4 or a_agg > 2) else Fold()
        if made == MID and (a_agg > 2 or po < 0.2):
            return Call()
        if draw >= DRAW and not last and po < 0.3:
            return Call()
        return Fold()
