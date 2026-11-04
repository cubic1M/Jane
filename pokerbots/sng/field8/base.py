"""Shared machinery for the field8 bots.

  * Ctx: one decision's view (stacks, positions, preflop and street action, ranges);
  * Base: a complete tournament player built from overridable pieces:
      - push/fold from the ICM-indexed equilibrium tables (data/pf8.npz) and an ICM
        best-response shove EV against the equilibrium (or observed) calling ranges;
      - all-in calls by ICM expected points (endpoints computed in end_hand);
      - deeper preflop by position charts (or the solver tables in the subclasses);
      - postflop by calibrated equity (data/post8.npz) against an estimated range;
      - a legal, simple fallback for any other card game, discards included.
act() never raises: an internal error falls back to check / fold (or the lowest discard).
"""
from __future__ import annotations

import os
import random

from engine.game import Call, Check, Discard, Fold, RaiseTo
from engine.spec import STANDARD_ORDER
from sng.field8 import tables as T
from sng.field8.hands import (choose_discard, class_info, generic_strength, hclass, made_and_draw,
                              post_key, preflop_generic)
from sng.field8.icm8 import IcmState
from sng.field8.model import Stats

DEBUG = bool(os.environ.get("FIELD8_DEBUG"))


def is_std_holdem(spec) -> bool:
    return (spec.hole_cards == 2 and len(spec.deck_ranks) == 13 and tuple(spec.board_cards_per_street) == (0, 3, 1, 1)
            and not spec.discards and getattr(spec, "showdown", "high") == "high"
            and tuple(spec.category_order) == STANDARD_ORDER and spec.hole_usage == "any")


def clip(x, lo, hi):
    return lo if x < lo else hi if x > hi else x


# chart opening widths by players behind (0 = heads-up button, 1 = small blind vs BB)
OPEN_CHART = {0: 0.72, 1: 0.42, 2: 0.40, 3: 0.27, 4: 0.21, 5: 0.17, 6: 0.145, 7: 0.125}


class Ctx:
    """Parsed view of one decision."""

    def __init__(self, obs):
        lg = obs.legal
        seats = obs.seats
        n = len(seats)
        me = obs.seat
        self.obs, self.lg, self.me, self.n = obs, lg, me, n
        self.bb = max(1, obs.big_blind)
        self.street = obs.street
        self.pot = obs.pot
        self.to_call = lg.call_amount if lg.can_call else 0
        self.stack = obs.my_stack
        self.my_bet = obs.my_bet
        self.total = obs.my_stack + obs.my_bet
        start, committed, bets, stacks, in_hand, live, all_in, opps = [], [], [], [], [], [], [], []
        for j, sv in enumerate(seats):
            st, cm = sv.stack, sv.committed
            start.append(st + cm)
            committed.append(cm)
            bets.append(sv.bet)
            stacks.append(st)
            ih = sv.in_hand
            in_hand.append(ih)
            lv = ih and not sv.folded
            live.append(lv)
            all_in.append(sv.all_in)
            if lv and j != me:
                opps.append(j)
        self.start, self.committed, self.bets, self.stacks = start, committed, bets, stacks
        self.in_hand, self.live, self.all_in, self.opps = in_hand, live, all_in, opps
        self.n_opp = len(self.opps)
        self.players = sum(self.in_hand)
        self.players_left = obs.players_left
        self.hole = obs.hole
        self.board = obs.board
        # ---- preflop order (first to act .. big blind); heads-up: button/SB first
        bbs = obs.bb_seat
        order = [j for j in list(range(bbs + 1, n)) + list(range(0, bbs + 1)) if in_hand[j]]
        self.order = order
        self.pidx = {j: i for i, j in enumerate(order)}
        self.nb = len(order) - 1 - self.pidx.get(me, 0)        # players behind me preflop
        if self.players == 2:
            self.nb_code = 0 if me == obs.sb_seat else -1      # -1: heads-up big blind
        else:
            self.nb_code = self.nb
        # ---- action history
        self.pre_raises = []          # (seat, raise-to)
        self.limpers = []
        self.cold_callers = []        # callers of the latest preflop raise
        self.street_raises = []       # this street: (seat, raise-to)
        self.street_callers = []
        self.aggr = {}                # street -> last aggressor
        self.called_street = {}       # seat -> set of streets on which it called a bet
        self.checked = set()          # seats that checked this street
        acted = set()
        for item in obs.history:
            s, st, k, a = item
            if k == "post" or k == "discard":
                continue
            if st == 0:
                if k == "raise":
                    self.pre_raises.append((s, a))
                    self.cold_callers = []
                elif k == "call":
                    if self.pre_raises:
                        self.cold_callers.append(s)
                    else:
                        self.limpers.append(s)
            if k == "raise":
                self.aggr[st] = s
            elif k == "call" and st > 0:
                self.called_street.setdefault(s, set()).add(st)
            if st == self.street:
                acted.add(s)
                if k == "raise":
                    self.street_raises.append((s, a))
                    self.street_callers = []
                elif k == "call":
                    self.street_callers.append(s)
                elif k == "check":
                    self.checked.add(s)
        self.acted = acted
        self.pf_aggr = self.aggr.get(0)
        self.n_raises = len(self.pre_raises)
        # ---- postflop position: am I last to act among the live players who can act?
        btn = obs.button
        able = [j for j in range(n) if self.live[j] and not self.all_in[j]]
        if able:
            last = max(able, key=lambda j: (j - btn - 1) % n)
            self.ip = last == me
        else:
            self.ip = True
        self.dead_pre = obs.small_blind + obs.big_blind + obs.ante * self.players

    # ---- helpers ------------------------------------------------------------------------
    def behind(self):
        """Live players still to act after me preflop (in order)."""
        i = self.pidx.get(self.me, 0)
        return [j for j in self.order[i + 1:] if self.live[j]]

    def eff_vs(self, j) -> int:
        return min(self.start[self.me], self.start[j])

    def s_units(self, chips) -> float:
        """A stack in 'big blinds' scaled so the preflop dead money is always 1.5 units."""
        return chips * 1.5 / max(1.0, self.dead_pre)

    def pot_after_call(self):
        return self.pot + self.to_call

    def facing_allin(self):
        if not self.pre_raises and not self.street_raises:
            return False
        s = (self.street_raises or self.pre_raises)[-1][0]
        return self.all_in[s]


class Base:
    name = "f8_base"
    handles_discards = True
    DEFAULTS = dict(
        pf_max=15.0,           # push/fold at or below this effective stack (units)
        open_scale=1.0,        # multiplies chart opening widths
        tb_value=0.035,        # 3-bet for value: top fraction of all hands
        tb_bluff=0.25,         # frequency of 3-bet bluffs with suited wheel aces / suited connectors
        call_open=1.0,         # calling width multiplier vs opens
        cbet=0.55,             # flop c-bet frequency heads-up with air on a dry board
        barrel=0.30,           # turn barrel frequency with air
        river_bluff=0.20,      # river bluff frequency with air after betting the turn
        vthr=0.60,             # value-bet threshold (equity vs a calling range)
        call_margin=0.0,       # extra equity to call bets postflop
        raise_thr=0.80,        # value-raise threshold vs a bettor's range
        icm_weight=1.0,        # how much ICM risk premiums count (1 = fully)
        shove_margin=0.0,      # extra ICM points (fraction of the total) required to shove
        pure_table=True,       # push/fold by the equilibrium table (else by ICM EV)
        press=0.5,             # wider opens when covering everyone behind (x their ICM pressure)
        covered_margin=0.003,  # extra points needed to call an all-in from a covering stack
    )

    def __init__(self, **kw):
        self.p = dict(self.DEFAULTS)
        self.p.update(kw)

    # ---- lifecycle -------------------------------------------------------------------------
    def new_table(self, rules, seat, seed=0):
        self.rules = rules
        self.spec = rules.spec
        self.seat = seat
        self.n = rules.num_players
        self.pays = tuple(rules.payouts)
        self.rng = random.Random(seed * 7 + 13)
        self.hold = is_std_holdem(rules.spec)
        self.stats = Stats(self.n)
        self.icm = IcmState(self.n)
        self.hand_no = 0
        self.stacks = [rules.starting_stack] * self.n
        try:
            self.icm.update(self.stacks, seat, self.pays, self.n)
        except Exception:  # noqa: BLE001
            if DEBUG:
                raise
        self.setup()

    def setup(self):
        pass

    def end_hand(self, info):
        try:
            if not isinstance(info, dict):
                return
            hist = info.get("history") or ()
            stacks = info.get("stacks")
            deltas = info.get("deltas")
            start = None
            if stacks is not None and deltas is not None and len(stacks) == self.n and len(deltas) == self.n:
                start = [stacks[j] - deltas[j] for j in range(self.n)]
            hn = info.get("hand_number", 0)
            ante = 0
            try:
                ante = self.rules.blinds_for(max(0, hn))[2]
            except Exception:  # noqa: BLE001
                pass
            self.stats.update(hist, info.get("showdown"), start, ante)
            if stacks is not None and len(stacks) == self.n:
                self.stacks = list(stacks)
                left = sum(1 for s in stacks if s > 0)
                if stacks[self.seat] > 0 and left >= 2:
                    self.icm.update(self.stacks, self.seat, self.pays, left)
                else:
                    self.icm.ready = False
            self.hand_no = hn + 1
            self.after_hand(info)
        except Exception:  # noqa: BLE001
            if DEBUG:
                raise

    def after_hand(self, info):
        pass

    # ---- entry point -------------------------------------------------------------------------
    def act(self, obs):
        lg = obs.legal
        try:
            if lg.discard_count:
                a = self.discard(obs)
            else:
                c = Ctx(obs)
                if self.hold:
                    a = self.preflop(c) if c.street == 0 else self.postflop(c)
                else:
                    a = self.generic(c)
        except Exception:  # noqa: BLE001
            if DEBUG:
                raise
            a = None
        return self.legalize(a, obs)

    @staticmethod
    def legalize(a, obs):
        lg = obs.legal
        if a is not None and lg.is_legal(a):
            if a.kind != "discard" or (set(a.cards) <= set(obs.hole) and len(set(a.cards)) == len(a.cards)):
                return a
        if lg.discard_count:
            return Discard(sorted(obs.hole, key=lambda c: (c >> 2, c & 3))[:lg.discard_min])
        if a is not None and a.kind == "raise" and lg.can_raise:
            return RaiseTo(lg.clamp(a.amount))
        return Check() if lg.can_check else Fold()

    # ---- action helpers ----------------------------------------------------------------------
    def rand(self):
        return self.rng.random()

    @staticmethod
    def fold(c):
        return Check() if c.lg.can_check else Fold()

    @staticmethod
    def passive(c):
        return Check() if c.lg.can_check else Call()

    @staticmethod
    def shove(c):
        lg = c.lg
        if lg.can_raise:
            return RaiseTo(lg.max_raise_to)
        return Call() if lg.can_call else Check()

    def raise_to(self, c, amount):
        lg = c.lg
        if not lg.can_raise:
            return self.passive(c)
        amt = lg.clamp(amount)
        if amt >= 0.8 * lg.max_raise_to:
            amt = lg.max_raise_to
        return RaiseTo(amt)

    def bet_pot(self, c, frac):
        """Bet / raise to a fraction of the pot after calling."""
        cur = c.my_bet + c.to_call
        return self.raise_to(c, cur + frac * (c.pot + c.to_call))

    # ---- discards -----------------------------------------------------------------------------
    def discard(self, obs):
        lg = obs.legal
        return Discard(choose_discard(obs.hole, obs.board, lg.discard_min, lg.discard_count))

    # ---- ICM helpers --------------------------------------------------------------------------
    def bf_me(self, j) -> float:
        if not self.icm.ready:
            return 1.0
        return 1.0 + (self.icm.bf_me[j] - 1.0) * self.p["icm_weight"]

    def rf(self, c, j, risk) -> float:
        """Risk premium for putting `risk` chips at stake against seat j: the bubble factor
        scaled by the share of my stack at risk (a small call risks little ICM)."""
        bf = self.bf_me(j)
        if bf <= 1.0:
            return bf
        frac = risk / max(1.0, float(c.start[c.me]))
        return 1.0 + (bf - 1.0) * clip(1.5 * frac, 0.0, 1.0)

    def bf_opp(self, j) -> float:
        if not self.icm.ready:
            return 1.0
        return 1.0 + (self.icm.bf_opp[j] - 1.0) * self.p["icm_weight"]

    def allin_values(self, c, j):
        """(V_fold, V_win, V_lose) in points for an all-in between me and seat j now, from the
        endpoints computed at the start of the hand (dead money and my sunk chips added along
        the local chip value)."""
        me = c.me
        eff = c.eff_vs(j)
        st = self.icm
        if not st.ready or eff <= 0:
            # chip values (a points-per-chip of 1)
            s0 = c.start[me]
            dead = max(0, c.pot - c.committed[j] - c.committed[me])
            return s0 - c.committed[me], s0 + eff + dead, s0 - eff
        up = (st.win[j] - st.base) / eff
        down = (st.base - st.lose[j]) / eff
        # money in the pot from the other players (j's chips beyond my stack come back to j)
        dead = max(0, c.pot - c.committed[j] - c.committed[me])
        v_fold = st.base - down * c.committed[me]
        v_win = st.win[j] + up * dead * 0.85
        v_lose = st.lose[j]
        return v_fold, v_win, v_lose

    # ---- range estimates ---------------------------------------------------------------------
    def open_width(self, c, nb, S) -> float:
        """How wide a player opens first in with nb behind at stack S (units)."""
        w = OPEN_CHART.get(nb, 0.125) * self.p["open_scale"]
        return clip(w, 0.05, 0.95)

    def est_open_width(self, c, j) -> float:
        """Estimated opening range of seat j (who opened this hand)."""
        nbj = len(c.order) - 1 - c.pidx.get(j, 0)
        if c.players == 2:
            nbj = 0
        S = c.s_units(c.start[j]) / 1.0
        return self.opp_open_width(c, j, nbj, S)

    def opp_open_width(self, c, j, nbj, S) -> float:
        return T.sv_open_width(nbj, max(12.0, S))

    def est_shove_width(self, c, j) -> float:
        """Estimated range width of seat j's all-in raise."""
        raises = c.pre_raises
        idx = max((i for i, (s, _) in enumerate(raises) if s == j), default=0)
        S = c.s_units(min(c.start[j], max([c.start[k] for k in c.opps if k != j] + [c.start[c.me]])))
        if idx == 0 and not c.all_in[j]:
            return self.est_open_width(c, j)       # a normal open that puts me all-in
        if idx == 0 and not c.limpers:
            nbj = len(c.order) - 1 - c.pidx.get(j, 0)
            if c.players == 2:
                nbj = 0 if j == c.obs.sb_seat else 1
            if S <= T.PF_SMAX:
                bp = self.icm.bf_opp[j] if self.icm.ready else 1.0
                return T.pf_width_fast(max(nbj, 1), S, bp, 1.0)
            return clip(0.10 * 20.0 / max(S, 1.0), 0.03, 0.12)
        if idx == 0:
            return clip(0.25 * 15.0 / max(S, 4.0), 0.06, 0.35)
        if idx == 1:
            # re-shove over an open: tighter, wider when short
            return clip(0.30 * 10.0 / max(S, 4.0), 0.04, 0.30)
        return clip(0.04 * 25.0 / max(S, 8.0), 0.02, 0.08)

    def range_width(self, c, j) -> float:
        """Preflop range width of a live opponent for postflop equity."""
        rs = c.pre_raises
        if rs:
            if rs[-1][0] == j:
                if len(rs) == 1:
                    return self.est_open_width(c, j)
                if len(rs) == 2:
                    return 0.07
                return 0.03
            if any(s == j for s, _ in rs):
                return 0.06 if len(rs) >= 3 else 0.12      # raised, then called a re-raise
            # called a raise
            if j == c.obs.bb_seat:
                return 0.45
            return 0.18 if len(rs) == 1 else 0.06
        if j == c.obs.bb_seat:
            return 1.0
        return 0.55 if j in c.limpers else 0.8

    # ---- preflop -----------------------------------------------------------------------------
    def preflop(self, c):
        h = hclass(c.hole[0], c.hole[1])
        c.h = h
        c.pct = T.PCT[h]
        if not c.pre_raises:
            if c.limpers:
                return self.vs_limpers(c)
            if c.lg.can_check:                           # big blind, folded / completed to
                return self.bb_option(c)
            return self.first_in(c)
        if c.facing_allin() or c.to_call >= 0.45 * c.total:
            return self.vs_allin(c)
        nr = c.n_raises
        mine = [i for i, (s, _) in enumerate(c.pre_raises) if s == c.me]
        if nr == 1:
            return self.vs_open(c)
        if mine and nr == mine[-1] + 2:
            return self.vs_3bet(c) if nr == 2 else self.vs_4bet(c)
        return self.vs_cold_3bet(c)

    # first in ---------------------------------------------------------------------------------
    def first_in(self, c):
        beh = c.behind()
        if not beh:
            return self.fold(c)
        eff = min(c.total, max(c.stacks[j] + c.bets[j] for j in beh))
        S = c.s_units(eff)
        c.S = S
        if S <= self.p["pf_max"]:
            return self.shove(c) if self.push_decision(c, S, beh) else self.fold(c)
        return self.open_decision(c, S, beh)

    def nb_for_tables(self, c):
        """Players-behind code for the push/fold tables (heads-up button = 1 behind)."""
        return max(1, len(c.behind()))

    def push_bfs(self, c, beh):
        if not self.icm.ready or not beh:
            return 1.0, 1.0
        wsum = bp = bc = 0.0
        for j in beh:
            w = 1.5 if c.start[j] >= c.start[c.me] else 1.0
            wsum += w
            bp += w * self.bf_me(j)
            bc += w * self.bf_opp(j)
        return bp / wsum, bc / wsum

    def push_decision(self, c, S, beh) -> bool:
        if self.p["pure_table"]:
            bp, bcf = self.push_bfs(c, beh)
            pr = T.pf_push(self.nb_for_tables(c), S, bp, bcf, c.h)
            return pr >= 0.999 or (pr > 0.001 and self.rand() < pr)
        return self.push_ev(c, S, beh) > 0

    def caller_widths(self, c, S, beh):
        """Calling width of each player behind against my shove: the equilibrium table's
        callers, with their risk premium damped to what real callers show (measured against
        the field: they call about like a bubble factor of 1.1 + 0.3 * (BF - 1))."""
        bp, bcf = self.push_bfs(c, beh)
        bcf = 1.1 + 0.3 * (bcf - 1.0)
        nbt = self.nb_for_tables(c)
        out = []
        for k, j in enumerate(beh):
            cf = T.pf_callfrac(nbt, S, bp, bcf, k)
            out.append((j, cf))
        return out

    def push_ev(self, c, S, beh, widths=None) -> float:
        """ICM points of shoving minus folding, against the callers' widths."""
        if widths is None:
            widths = self.caller_widths(c, S, beh)
        me = c.me
        h = c.h
        base = self.icm.base if self.icm.ready else float(c.start[me])
        v_fold = None
        ev = 0.0
        reach = 1.0
        dead = c.pot - c.committed[me]
        for j, cw in widths:
            cw = clip(cw, 0.0, 1.0)
            vf, vw, vl = self.allin_values(c, j)
            if v_fold is None:
                v_fold = vf
            if cw > 0.0:
                e = T.eq_top(max(cw, 0.01), h)
                ev += reach * cw * (e * vw + (1 - e) * vl)
            reach *= 1.0 - cw
        if v_fold is None:
            return 0.0
        # everyone folds: I win the dead money at my local chip value
        up = 1.0
        if self.icm.ready and widths:
            j0 = widths[-1][0]
            eff0 = max(1, c.eff_vs(j0))
            up = (self.icm.win[j0] - self.icm.base) / eff0
        ev += reach * (base + up * dead)
        return ev - v_fold - self.p["shove_margin"] * (self.icm.total_pts if self.icm.ready else 1.0)

    def open_decision(self, c, S, beh):
        nb = c.nb_code if c.players > 2 else 0
        w = clip(self.open_width(c, nb, S) * self.open_factor(c, beh), 0.03, 0.95)
        if c.pct <= w:
            return self.raise_to(c, self.open_size(c, S) * c.bb)
        return self.fold(c)

    def open_factor(self, c, beh) -> float:
        """Multiplier on the opening width: opponents under more ICM pressure than me fold
        more (open wider); tighter when I am the one under pressure."""
        if not self.icm.ready or not beh:
            return 1.0
        bp, bcf = self.push_bfs(c, beh)
        f = clip((bcf / bp) ** 0.35, 0.7, 1.5)
        # covering every player behind: they risk their tournament against me, I do not
        if all(c.start[c.me] > c.start[j] for j in beh):
            pres = sum(self.icm.bf_opp[j] for j in beh) / len(beh)
            f *= clip(1.0 + self.p["press"] * (pres - 1.0), 1.0, 1.7)
        return f

    # postflop adjustment hooks (the adaptive and endgame players override these)
    def cbet_scale(self, c, j) -> float:
        return 1.0

    def bluff_scale(self, c, j) -> float:
        return 1.0

    def vthr_adj(self, c, j) -> float:
        return 0.0

    def call_adj(self, c, j) -> float:
        return 0.0

    def open_size(self, c, S):
        if c.players == 2:
            return 2.0 if S < 25 else 2.3
        if c.me == c.obs.sb_seat:
            return 2.5 if S < 25 else 3.0
        return 2.0 if S < 22 else 2.2 if S < 40 else 2.4

    def bb_option(self, c):
        # limped / completed to the big blind: raise strong hands, check the rest
        if c.pct <= 0.12 + (0.15 if c.players == 2 else 0.0):
            return self.raise_to(c, c.pot + 2 * c.bb)
        return Check()

    def vs_limpers(self, c):
        nl = len(c.limpers)
        beh = c.behind()
        eff = min(c.total, max([c.stacks[j] + c.bets[j] for j in beh + c.limpers] or [c.total]))
        S = c.s_units(eff)
        if c.lg.can_check:
            return self.bb_option(c)
        thr = 0.09 if nl >= 2 else 0.13
        if c.players <= 3:
            thr += 0.06
        if S <= self.p["pf_max"]:
            if c.pct <= thr * 0.9 + 0.02:
                return self.shove(c)
            return self.fold(c)
        if c.pct <= thr:
            return self.raise_to(c, (3.5 + nl) * c.bb)
        # complete / over-limp with speculative hands in position, cheaply
        hi, lo, kind = class_info(c.h)
        if c.to_call <= c.bb and S > 30 and ((kind == 0) or (kind == 1 and hi - lo <= 2)) and c.pct <= 0.45:
            return Call()
        return self.fold(c)

    # facing an open ------------------------------------------------------------------------------
    def vs_open(self, c):
        opener, amt = c.pre_raises[0]
        w_o = self.est_open_width(c, opener)
        eff = min(c.total, c.stacks[opener] + c.bets[opener])
        S = c.s_units(eff)
        c.S = S
        callers = len(c.cold_callers)
        # short: re-shove or fold
        if S <= 26:
            return self.resteal(c, opener, w_o, S)
        return self.deep_vs_open(c, opener, w_o, S, callers)

    def deep_vs_open(self, c, opener, w_o, S, callers):
        h = c.h
        hi, lo, kind = class_info(h)
        tb_size = self.three_bet_size(c, amt_to=c.pre_raises[0][1], callers=callers)
        bf = self.rf(c, opener, 2.2 * tb_size)
        value = max(0.022, self.p["tb_value"] * (0.6 + 1.2 * w_o)) / bf
        if callers:
            value *= 0.8
        if c.pct <= value:
            return self.raise_to(c, self.three_bet_size(c, amt_to=c.pre_raises[0][1], callers=callers))
        # bluff 3-bets: suited wheel aces and suited connectors, mostly vs late opens
        bluff_hand = (kind == 1 and hi == 12 and lo <= 3) or (kind == 1 and hi - lo == 1 and 3 <= lo <= 8)
        if bluff_hand and not callers and w_o >= 0.2 and bf < 1.25 and self.rand() < self.p["tb_bluff"]:
            return self.raise_to(c, self.three_bet_size(c, amt_to=c.pre_raises[0][1], callers=0))
        # call: price, equity vs the opening range, position and playability
        need = c.to_call / (c.pot + c.to_call)
        e = T.eq_top(w_o, h)
        in_bb = c.me == c.obs.bb_seat
        bf = self.rf(c, opener, 3.0 * c.to_call)
        R = self.realization(c, h, opener)
        behind_n = len(c.behind())
        squeeze_tax = 0.012 * behind_n if not in_bb else 0.0
        if e * R * (1 + 0.15 * callers) - squeeze_tax - need * bf > 0.0 * self.p["call_open"] and \
                (c.pct <= 0.55 * self.p["call_open"] or in_bb):
            return Call()
        return self.fold(c)

    def realization(self, c, h, villain):
        hi, lo, kind = class_info(h)
        ip = (villain - c.obs.button - 1) % c.n < (c.me - c.obs.button - 1) % c.n
        R = 0.97 if ip else 0.80
        if kind == 1:
            R += 0.05
        if kind != 0 and hi - lo == 1:
            R += 0.03
        if kind == 0:
            R += 0.05 * (1 - hi / 12.0)
        if kind == 2 and hi - lo >= 4 and hi < 10:
            R -= 0.08
        return R

    def three_bet_size(self, c, amt_to, callers=0):
        ip = c.me not in (c.obs.sb_seat, c.obs.bb_seat)
        size = amt_to * (3.0 if ip else 3.8) + callers * amt_to
        if size >= 0.38 * c.total:
            return c.lg.max_raise_to
        return size

    def resteal(self, c, opener, w_o, S):
        """Re-shove over an open (or call / fold) at a shallow effective stack."""
        h = c.h
        ev_jam = self.jam_over_ev(c, opener, w_o)
        if ev_jam > 0:
            return self.shove(c)
        # the big blind defends a small open at its price (out of position, low SPR: the
        # realisation is lower the shorter the stacks; the chips at risk carry the ICM premium)
        if c.me == c.obs.bb_seat and S >= 8 and c.to_call <= 0.25 * c.total and not c.cold_callers:
            need = c.to_call / (c.pot + c.to_call)
            e = T.eq_top(w_o, h)
            R = self.realization(c, h, opener) - (0.06 if S < 15 else 0.0)
            if e * R > need * self.rf(c, opener, 2.5 * c.to_call) + 0.02 and c.pct <= 0.6:
                return Call()
        return self.fold(c)

    def jam_over_ev(self, c, opener, w_o, my_width=None) -> float:
        """ICM points of re-shoving over an open minus folding. The opener continues with the
        part of its range that has the equity it needs against my perceived shoving range."""
        h = c.h
        eff = c.eff_vs(opener)
        jam = min(c.total, c.start[opener])
        risk = jam - c.bets[opener]
        pot_if_call = c.pot + jam - c.my_bet + max(0, jam - c.bets[opener])
        need = risk / max(1.0, pot_if_call)
        # opponents call re-shoves far wider than an ICM-tight equilibrium caller would: damp
        # their risk premium, assume they credit me with a reasonable range, and never expect
        # less than a floor of calls (measured: about the top 12% call a 15-30 bb re-shove)
        bf_o = 1.0 + 0.35 * (self.bf_opp(opener) - 1.0)
        need = need * bf_o / (need * bf_o + (1 - need))
        mw = my_width if my_width is not None else 0.12
        cw = T.call_width(mw, need)
        cw = min(max(cw, self.reshove_call_floor(c, opener, w_o)), w_o)
        pcall = cw / max(w_o, 1e-6)
        # players behind me can wake up
        beh = [j for j in c.behind() if j != opener]
        pbeh = 1.0
        for _ in beh:
            pbeh *= 0.975
        vf, vw, vl = self.allin_values(c, opener)
        e = T.eq_top(max(cw, 0.01), h)
        st = self.icm
        up = (st.win[opener] - st.base) / max(1, eff) if st.ready else 1.0
        base = st.base if st.ready else float(c.start[c.me])
        v_take = base + up * (c.pot - c.committed[c.me])
        ev = pbeh * ((1 - pcall) * v_take + pcall * (e * vw + (1 - e) * vl)) + (1 - pbeh) * (0.3 * vw + 0.7 * vl)
        return ev - vf

    def reshove_call_floor(self, c, opener, w_o) -> float:
        return min(w_o, 0.08 + 0.2 * w_o)

    def vs_3bet(self, c):
        raiser, amt = c.pre_raises[-1]
        h = c.h
        eff = min(c.total, c.stacks[raiser] + c.bets[raiser])
        S = c.s_units(eff)
        w3 = self.est_3bet_width(c, raiser)
        bf = self.rf(c, raiser, 2.5 * c.to_call)
        if S <= 40 or c.to_call >= 0.3 * c.total:
            # jam or fold: equity against the part of the 3-bet range that calls
            e = T.eq_top(max(0.02, w3 * 0.7), h)
            vf, vw, vl = self.allin_values(c, raiser)
            pf = clip(0.35 - S / 200.0, 0.05, 0.3)
            st = self.icm
            up = (st.win[raiser] - st.base) / max(1, c.eff_vs(raiser)) if st.ready else 1.0
            ev = pf * (vf + (c.pot - c.committed[c.me]) * up) \
                + (1 - pf) * (e * vw + (1 - e) * vl)
            if ev > vf and c.pct <= 0.12:
                return self.shove(c)
            need = c.to_call / (c.pot + c.to_call)
            e2 = T.eq_top(w3, h)
            if e2 > need * bf + 0.08 and c.pct <= 0.08 and c.to_call < 0.3 * c.total:
                return Call()
            return self.fold(c)
        if c.pct <= max(0.02, 0.35 * w3) / bf:
            return self.raise_to(c, amt * 2.3)
        need = c.to_call / (c.pot + c.to_call)
        e = T.eq_top(w3, h)
        if e * self.realization(c, h, raiser) > need * bf + 0.03 and c.pct <= 0.12:
            return Call()
        return self.fold(c)

    def est_3bet_width(self, c, j) -> float:
        return clip(self.stats.rate("tb", j) * 0.9, 0.025, 0.15)

    def vs_4bet(self, c):
        raiser, amt = c.pre_raises[-1]
        h = c.h
        need = c.to_call / (c.pot + c.to_call)
        e = T.eq_top(0.03, h)
        if c.pct <= 0.02 or e > need * self.rf(c, raiser, c.total) + 0.05:
            return self.shove(c) if c.pct <= 0.015 else Call()
        return self.fold(c)

    def vs_cold_3bet(self, c):
        raiser, amt = c.pre_raises[-1]
        if c.pct <= 0.02:
            return self.shove(c)
        if c.pct <= 0.035 and c.to_call < 0.25 * c.total:
            return Call()
        return self.fold(c)

    # all-in calls ----------------------------------------------------------------------------------
    def vs_allin(self, c):
        """Call (or shove over) a large or all-in raise by ICM expected points."""
        shover = (c.pre_raises[-1][0])
        h = c.h
        w = self.shove_width(c, shover)
        e = self.allin_equity(c, shover, w, h)
        # others still to act, or already in, cost equity
        beh = [j for j in c.behind() if j != shover and not c.all_in[j]]
        in_already = [j for j in c.opps if j != shover and c.bets[j] > 0 and j not in beh
                      and c.committed[j] >= c.committed[shover] * 0.99]
        if in_already:
            e = e ** (1.0 + 0.7 * len(in_already))
        e -= 0.015 * len(beh)
        vf, vw, vl = self.allin_values(c, shover)
        ev_call = e * vw + (1 - e) * vl
        margin = self.call_allin_margin(c, shover)
        if ev_call > vf + margin:
            if c.lg.can_raise and not c.all_in[shover] and c.pct <= 0.03:
                return self.shove(c)
            return Call() if c.lg.can_call else self.passive(c)
        return self.fold(c)

    def call_allin_margin(self, c, j):
        """Covered by the shover: stacking off loses my whole tournament, so a marginal call
        is a fold (a margin in points, a fraction of all points still to be paid)."""
        if self.icm.ready and c.start[j] >= c.start[c.me]:
            return self.p["covered_margin"] * self.icm.total_pts
        return 0.0

    def shove_width(self, c, j):
        return self.est_shove_width(c, j)

    def allin_equity(self, c, j, w, h):
        rs = c.pre_raises
        # an open-shove from short: use the exact equilibrium shoving range
        if len(rs) == 1 and rs[0][0] == j and not c.limpers and c.all_in[j]:
            S = c.s_units(min(c.start[j], max(c.start[k] for k in range(c.n) if k != j and c.in_hand[k])))
            if S <= T.PF_SMAX and self.use_pf_range(c, j):
                nbj = len(c.order) - 1 - c.pidx.get(j, 0)
                nbj = 1 if c.players == 2 else max(1, nbj)
                bp = self.icm.bf_opp[j] if self.icm.ready else 1.0
                bc = self.icm.bf_me[j] if self.icm.ready else 1.0
                return T.pf_push_eq(nbj, S, bp, bc, h)
        return T.eq_top(clip(w, 0.01, 1.0), h)

    def use_pf_range(self, c, j):
        return True

    # ---- postflop ----------------------------------------------------------------------------
    def villain(self, c):
        """The main opponent: the last aggressor if live, else the live opponent with the most chips."""
        st = c.street
        for s in (st, st - 1, st - 2, st - 3):
            a = c.aggr.get(s)
            if a is not None and a != c.me and c.live[a]:
                return a
        return max(c.opps, key=lambda j: c.start[j]) if c.opps else None

    def equity(self, c, j, row=None):
        """Equity vs villain j's estimated range (heads-up), and vs its calling range."""
        if row is None:
            row = T.POST[post_key(c.hole, c.board)]
        w = self.range_width(c, j)
        # preflop range: interpolate random (1.0) / top45 / top20, extrapolate below
        if w >= 0.45:
            f = (w - 0.45) / 0.55
            e_pre = row[1] + (row[0] - row[1]) * f
        elif w >= 0.2:
            f = (w - 0.2) / 0.25
            e_pre = row[2] + (row[1] - row[2]) * f
        else:
            e_pre = row[2] - (row[1] - row[2]) * min(1.0, (0.2 - w) / 0.25)
        shift = e_pre - row[1]
        # this street's action by j
        bet_now = any(s == j for s, _ in c.street_raises)
        raised_now = sum(1 for s, _ in c.street_raises if s == j) >= 2 or (
            bet_now and len(c.street_raises) >= 2 and c.street_raises[-1][0] == j)
        prev_call = any(st < c.street for st in c.called_street.get(j, ()))
        prev_bet = any(c.aggr.get(st) == j for st in range(1, c.street))
        # the value columns hold no bluffs: a real betting range has some air, which my hand
        # beats about as often as sqrt(equity vs a random hand)
        e_air = row[0] ** 0.5
        if raised_now:
            b = self.bluff_share(c, j, True)
            e = (1 - b) * (row[5] + 0.5 * shift) + b * e_air
        elif bet_now:
            amt = max(a for s, a in c.street_raises if s == j)
            frac = amt / max(1.0, c.pot - amt)
            e_bet = row[4] if frac >= 0.45 else row[3] + (row[4] - row[3]) * frac / 0.45
            e_bet += 0.6 * shift
            if c.street == 1 and c.pf_aggr == j and len(c.street_raises) == 1:
                # a flop c-bet by the preflop raiser: close to its whole range
                e_bet = 0.5 * e_pre + 0.5 * (row[3] + 0.6 * shift)
            elif c.street == 2 and c.aggr.get(1) == j and len(c.street_raises) == 1:
                # the second barrel: between the continuing and the betting range
                e_bet = 0.5 * (row[3] + row[4]) + 0.6 * shift
            elif prev_bet or prev_call:
                e_bet -= 0.03
            b = self.bluff_share(c, j, False)
            e = (1 - b) * e_bet + b * e_air
        elif prev_call or prev_bet:
            e = row[3] + 0.6 * shift
        else:
            e = e_pre
        e_call = row[3] + 0.6 * shift          # vs the range that continues vs my bet
        return clip(e, 0.01, 0.99), clip(e_call, 0.01, 0.99), row

    def bluff_share(self, c, j, raised) -> float:
        """Share of pure air in a bettor's range (draws are already in the value columns)."""
        if raised:
            return 0.08
        return (0.0, 0.12, 0.18, 0.24)[min(3, c.street)]

    def multiway(self, e, row, n_opp):
        if n_opp <= 1:
            return e
        r = row[6] / max(0.05, row[1])
        return clip(e * r ** (n_opp - 1), 0.0, 1.0)

    def postflop(self, c):
        j = self.villain(c)
        if j is None:
            return self.passive(c)
        key = post_key(c.hole, c.board)
        row = T.POST[key]
        made, draw, ftex, stex, paired = made_and_draw(c.hole[0], c.hole[1], c.board)
        c.made, c.draw, c.ftex, c.stex, c.paired = made, draw, ftex, stex, paired
        e, e_call, _ = self.equity(c, j, row)
        n_live = sum(1 for k in c.opps if not c.all_in[k]) or 1
        nop = c.n_opp
        e = self.multiway(e, row, nop)
        e_call = self.multiway(e_call, row, nop)
        c.e, c.e_call, c.vil = e, e_call, j
        if c.to_call > 0:
            return self.facing_bet(c, j, e, row)
        return self.unbet(c, j, e, e_call, row, n_live)

    def bet_size(self, c, value=True):
        st = c.street
        wet = c.ftex >= 1 or c.stex >= 2
        if st == 1:
            f = 0.66 if wet else 0.4
        elif st == 2:
            f = 0.66
        else:
            f = 0.75 if value else 0.7
        return f

    def unbet(self, c, j, e, e_call, row, n_live):
        st = c.street
        nop = c.n_opp
        spr = c.stack / max(1.0, c.pot)
        vthr = self.p["vthr"] + 0.05 * (nop - 1) - (0.03 if st == 3 else 0.0) + self.vthr_adj(c, j)
        bs = self.bluff_scale(c, j)
        if e_call >= vthr:
            if spr <= 1.1:
                return self.shove(c)
            f = self.bet_size(c, True)
            if e_call >= 0.8 and (c.ftex >= 1 or c.stex >= 1) and st < 3:
                f = max(f, 0.75)
            return self.bet_pot(c, f)
        initiative = c.aggr.get(st - 1) == c.me
        if nop == 1:
            if initiative or (st == 1 and c.pf_aggr == c.me):
                if st == 1:
                    dry = c.ftex == 0 and c.stex <= 1
                    freq = self.p["cbet"] * (1.0 if dry else 0.7) * self.cbet_scale(c, j)
                    if c.draw >= 2:
                        freq = max(freq, 0.75)
                    if self.rand() < freq:
                        return self.bet_pot(c, self.bet_size(c, False))
                elif st == 2:
                    freq = self.p["barrel"] * bs
                    if c.draw >= 2:
                        freq = 0.6
                    elif c.made >= 3:
                        freq = 0.15          # showdown value: check
                    if self.rand() < freq:
                        return self.bet_pot(c, self.bet_size(c, False))
                elif st == 3:
                    if c.made <= 2 and e < 0.25 and self.rand() < self.p["river_bluff"] * bs:
                        return self.bet_pot(c, self.bet_size(c, False))
            elif c.ip and st < 3 and c.draw >= 3 and self.rand() < 0.35:
                return self.bet_pot(c, self.bet_size(c, False))
            elif c.ip and st >= 2 and c.made <= 2 and c.checked and self.rand() < 0.12 * bs:
                # stab when checked to in position
                return self.bet_pot(c, 0.5)
        return Check()

    def facing_bet(self, c, j, e, row):
        st = c.street
        pot_after = c.pot + c.to_call
        price = c.to_call / pot_after
        rf = self.rf(c, j, c.committed[c.me] + c.to_call * (1.0 if st == 3 else 1.6))
        need = price * rf / (price * rf + (1 - price))
        commit = c.to_call >= 0.6 * c.stack or c.to_call >= c.stack
        R = 1.0 if (c.ip or st == 3 or commit) else 0.93
        e_eff = e * R
        if st < 3 and c.draw >= 2 and not commit:
            e_eff += 0.02                         # implied odds
        if commit:
            e_eff -= 0.02
        e_eff -= self.p["call_margin"]
        e_eff += self.call_adj(c, j)
        # raise for value
        if c.lg.can_raise and e >= self.p["raise_thr"] and (st < 3 or e >= self.p["raise_thr"] + 0.06):
            if c.stack <= 1.5 * pot_after:
                return self.shove(c)
            return self.raise_to(c, c.my_bet + c.to_call + 1.0 * (pot_after + c.to_call))
        # semi-bluff raise with big draws on the flop
        if c.lg.can_raise and st == 1 and c.draw >= 4 and c.n_opp == 1 and not commit and self.rand() < 0.3:
            return self.raise_to(c, c.my_bet + c.to_call + 0.9 * (pot_after + c.to_call))
        if e_eff >= need:
            return Call()
        return self.fold(c)

    # ---- any other card game -----------------------------------------------------------------
    def generic(self, c):
        lg = c.lg
        pot_after = c.pot + c.to_call
        if c.street == 0:
            s = preflop_generic(c.hole)
            short = c.total <= 10 * c.bb
            if short:
                if s >= 0.5 and (c.to_call <= 0 or s >= 0.6):
                    return self.shove(c)
                return self.fold(c)
            if c.to_call <= 0:
                if s >= 0.62 and lg.can_raise:
                    return self.raise_to(c, c.my_bet + 3 * c.bb)
                return Check()
            if c.to_call <= c.bb - c.my_bet + 1 and not c.pre_raises:
                if s >= 0.66:
                    return self.raise_to(c, 3.5 * c.bb)
                if s >= 0.45:
                    return Call()
                return self.fold(c)
            need = c.to_call / pot_after
            if s >= 0.85 and lg.can_raise and c.n_raises < 3:
                return self.raise_to(c, c.my_bet + c.to_call + pot_after)
            if s >= 0.55 + need * 0.6:
                return Call()
            return self.fold(c)
        s = generic_strength(c.hole, c.board)
        if getattr(self.spec, "showdown", "high") != "high":
            s = 0.5 * s + 0.25
        need = c.to_call / pot_after if c.to_call else 0.0
        if c.to_call <= 0:
            if s >= 0.72 and lg.can_raise:
                return self.bet_pot(c, 0.6)
            return Check()
        if s >= 0.9 and lg.can_raise:
            return self.bet_pot(c, 0.8)
        if s - 0.18 >= need:
            return Call()
        return self.fold(c)
