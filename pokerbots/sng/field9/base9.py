"""Shared machinery for the field9 bots.

  * Ctx: one decision's view (stacks, positions, preflop and street action);
  * Base: a complete tournament player built from overridable pieces:
      - push/fold from the field9 equilibrium tables (linearised ICM, data/pf9_*.npz), or by
        ICM expected points against the callers' estimated widths (push_ev);
      - all-in calls and re-shoves by ICM expected points (pairwise endpoints from end_hand);
      - deeper preflop from position charts (opens, 3-bets, 4-bets, calls by realised equity);
      - postflop by the calibrated equity table (data/post9_*.npz) against an estimated range;
      - fixed-limit play and a legal, simple player for any other card game, discards included.
act() never raises: an internal error falls back to check / fold (or the lowest discard).
"""
from __future__ import annotations

import os
import random

from engine.game import Call, Check, Discard, Fold, RaiseTo
from engine.spec import STANDARD_ORDER
from sng.field9 import tables9
from sng.field9.cards9 import (AIR2, LOWPAIR, Scorer, choose_discard, class_info,
                               features, hclass, key_of, post_generic, pre_generic, street_key)
from sng.field9.icm9 import pair_icm
from sng.field9.model9 import Stats

DEBUG = bool(os.environ.get("FIELD9_DEBUG"))

# chart opening widths by players behind (0 = heads-up button)
OPEN_CHART = {0: 0.74, 1: 0.44, 2: 0.42, 3: 0.28, 4: 0.21, 5: 0.17, 6: 0.145, 7: 0.125}


def clip(x, lo, hi):
    return lo if x < lo else hi if x > hi else x


def game_mode(spec):
    """('holdem' | 'limit' | 'generic', deck for the preflop tables or None, deck for the postflop
    table or None)."""
    high = getattr(spec, "showdown", "high") == "high"
    ranks = tuple(sorted(spec.deck_ranks))
    deck = "std" if ranks == tuple(range(13)) else "six" if ranks == tuple(range(4, 13)) else None
    if deck == "std" and tuple(spec.category_order) != STANDARD_ORDER:
        deck = None
    if deck is not None and not tables9.available(deck):
        deck = None
    hold = (spec.hole_cards == 2 and tuple(spec.board_cards_per_street) == (0, 3, 1, 1) and not spec.discards
            and high and spec.hole_usage == "any")
    post_ok = (deck is not None and high and spec.hole_usage == "any" and spec.final_hole_cards == 2
               and sum(1 for d in spec.discards if d.draw) == 0)
    if hold and deck is not None:
        return ("limit" if spec.betting == "fixed_limit" else "holdem"), deck, deck
    return "generic", (deck if spec.hole_cards == 2 else None), (deck if post_ok else None)


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
            start.append(sv.stack + sv.committed)
            committed.append(sv.committed)
            bets.append(sv.bet)
            stacks.append(sv.stack)
            in_hand.append(sv.in_hand)
            lv = sv.in_hand and not sv.folded
            live.append(lv)
            all_in.append(sv.all_in)
            if lv and j != me:
                opps.append(j)
        self.start, self.committed, self.bets, self.stacks = start, committed, bets, stacks
        self.in_hand, self.live, self.all_in, self.opps = in_hand, live, all_in, opps
        self.n_opp = len(opps)
        self.players = sum(in_hand)
        self.hole, self.board = obs.hole, obs.board
        bbs = obs.bb_seat
        order = [j for j in list(range(bbs + 1, n)) + list(range(0, bbs + 1)) if in_hand[j]]
        self.order = order
        self.pidx = {j: i for i, j in enumerate(order)}
        self.nb = len(order) - 1 - self.pidx.get(me, 0)
        self.pre_raises, self.limpers, self.cold_callers = [], [], []
        self.street_raises, self.street_callers = [], []
        self.aggr = {}
        self.called_street = {}
        self.checked = set()
        for s, st, k, a in obs.history:
            if k == "post" or k == "discard":
                continue
            if st == 0:
                if k == "raise":
                    self.pre_raises.append((s, a))
                    self.cold_callers = []
                elif k == "call":
                    (self.cold_callers if self.pre_raises else self.limpers).append(s)
            if k == "raise":
                self.aggr[st] = s
            elif k == "call" and st > 0:
                self.called_street.setdefault(s, set()).add(st)
            if st == self.street:
                if k == "raise":
                    self.street_raises.append((s, a))
                    self.street_callers = []
                elif k == "call":
                    self.street_callers.append(s)
                elif k == "check":
                    self.checked.add(s)
        self.pf_aggr = self.aggr.get(0)
        self.n_raises = len(self.pre_raises)
        btn = obs.button
        able = [j for j in range(n) if live[j] and not all_in[j]]
        self.ip = (max(able, key=lambda j: (j - btn - 1) % n) == me) if able else True
        self.dead_pre = obs.small_blind + obs.big_blind + obs.ante * self.players
        self.h = None
        self.pct = 1.0

    def behind(self):
        i = self.pidx.get(self.me, 0)
        return [j for j in self.order[i + 1:] if self.live[j]]

    def eff_vs(self, j) -> int:
        return min(self.start[self.me], self.start[j])

    def s_units(self, chips) -> float:
        """Chips in 'big blinds' scaled so the preflop dead money is always 1.5 units."""
        return chips * 1.5 / max(1.0, self.dead_pre)

    def facing_allin(self):
        rs = self.street_raises or self.pre_raises
        return bool(rs) and self.all_in[rs[-1][0]]

    def nb_of(self, j) -> int:
        """Players behind seat j preflop (heads-up: the button has 1 behind)."""
        return max(1, len(self.order) - 1 - self.pidx.get(j, 0))


class Base:
    name = "f9_base"
    handles_discards = True
    DEFAULTS = dict(
        pf_max=14.0,          # push/fold first in at or below this effective stack (units)
        jam_max=24.0,         # re-shove (or fold) over an open at or below this
        open_scale=1.0,       # x chart opening widths
        open_mix=0.0,         # randomised band around the opening border (fraction of the width)
        tb_value=0.035,       # value 3-bets: top share of all hands (scaled by the opener's width)
        tb_bluff=0.20,        # 3-bet bluff frequency with the bluff candidates
        call_scale=1.0,       # x calling widths vs opens
        jam_width=0.12,       # the re-shove range opponents credit me with
        cbet=0.58,            # flop c-bet frequency heads-up without value
        barrel=0.32,
        rbluff=0.20,
        stab=0.30,            # bet when checked to in position
        vthr=0.58,            # value-bet threshold (equity vs the calling range)
        raise_thr=0.82,
        call_margin=0.0,
        icm_w=1.0,
        covered_margin=0.003,
        push_scale=1.0,       # x equilibrium shove probability edge (>1 wider)
    )

    def __init__(self, **kw):
        self.p = dict(self.DEFAULTS)
        self.p.update(kw)

    # ---- lifecycle ---------------------------------------------------------------------
    def new_table(self, rules, seat, seed=0):
        self.rules = rules
        self.spec = rules.spec
        self.seat = seat
        self.n = rules.num_players
        self.pays = tuple(rules.payouts)
        self.rng = random.Random(seed * 7919 + 17 + sum(map(ord, self.name)))
        self.mode, self.pre_deck, self.post_deck = game_mode(rules.spec)
        self.T = tables9.get(self.pre_deck) if self.pre_deck else None
        self.TP = tables9.get(self.post_deck) if self.post_deck else None
        self.sc = Scorer(rules.spec)
        self.exact = rules.spec.hole_exact if rules.spec.hole_usage == "exactly" else 0
        self.stats = Stats(self.n, self.T.PCT if self.T else None)
        self.stacks = [rules.starting_stack] * self.n
        self.hand_no = 0
        self.icm = pair_icm(self.stacks, self.pays[:self.n])
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
            hn = int(info.get("hand_number", 0) or 0)
            sb, bb, ante = self.rules.blinds_for(max(0, hn))
            self._end_board = tuple(info.get("board") or ())
            self.stats.update(hist, info.get("showdown"), start, bb, hclass, self._river_weak,
                              ante=ante)
            if stacks is not None and len(stacks) == self.n:
                self.stacks = list(stacks)
                left = sum(1 for s in stacks if s > 0)
                self.icm = pair_icm(self.stacks, self.pays[:left])
            self.hand_no = hn + 1
            self.after_hand(info)
        except Exception:  # noqa: BLE001
            if DEBUG:
                raise

    def _river_weak(self, seat, cards):
        """A shown river bettor's hand was weak (a bluff: no pair of its own)."""
        b = getattr(self, "_end_board", ())
        if self.mode != "holdem" or len(b) < 5 or not cards or len(cards) != 2:
            return False
        return features(cards[0], cards[1], b, self.sc)[0] <= AIR2

    def after_hand(self, info):
        pass

    # ---- entry point -------------------------------------------------------------------
    def act(self, obs):
        try:
            if obs.legal.discard_count:
                a = self.discard(obs)
            else:
                c = Ctx(obs)
                if self.mode == "holdem":
                    a = self.preflop(c) if c.street == 0 else self.postflop(c)
                elif self.mode == "limit":
                    a = self.limit_play(c)
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
            return Discard(tuple(sorted(obs.hole, key=lambda x: (x >> 2, x & 3))[:lg.discard_min]))
        if a is not None and a.kind == "raise" and lg.can_raise:
            return RaiseTo(lg.clamp(a.amount))
        if a is not None and a.kind == "call" and lg.can_check:
            return Check()
        return Check() if lg.can_check else Fold()

    # ---- action helpers ----------------------------------------------------------------
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
        cur = c.my_bet + c.to_call
        return self.raise_to(c, cur + frac * (c.pot + c.to_call))

    # ---- ICM helpers -------------------------------------------------------------------
    def bf_me(self, j) -> float:
        return 1.0 + (self.icm.bf(self.seat, j) - 1.0) * self.p["icm_w"]

    def bf_opp(self, j) -> float:
        return self.icm.bf(j, self.seat)

    def rf(self, c, j, risk) -> float:
        """Risk premium for `risk` chips against seat j: the bubble factor scaled by the share of
        my stack at risk."""
        bf = self.bf_me(j)
        if bf <= 1.0:
            return bf
        return 1.0 + (bf - 1.0) * clip(1.5 * risk / max(1.0, float(c.start[c.me])), 0.0, 1.0)

    def allin_values(self, c, j):
        """(V_fold, V_win, V_lose) in points for an all-in between me and seat j now: ICM endpoints
        blended with linear chip values by icm_w."""
        me = c.me
        eff = c.eff_vs(j)
        ic = self.icm
        dead = max(0, c.pot - c.committed[j] - c.committed[me])
        s0 = c.start[me]
        if not ic.ready or eff <= 0 or ic.stacks[me] != s0:
            return s0 - c.committed[me], s0 + eff + dead, s0 - eff
        bounty = self.rules.bounty if (self.rules.bounty and s0 >= c.start[j]) else 0.0   # I knock j out
        base = ic.base[me]
        up = (ic.win[me][j] - base) / eff
        down = (base - ic.lose[me][j]) / eff
        v = (base - down * c.committed[me], ic.win[me][j] + up * dead * 0.85, ic.lose[me][j])
        w = self.p["icm_w"]
        if w < 1.0:
            k = base / max(1.0, s0)                       # points per chip, linear
            lin = (base - k * c.committed[me], base + k * (eff + dead), base - k * eff)
            v = tuple(w * a + (1 - w) * b for a, b in zip(v, lin))
        return (v[0], v[1] + bounty, v[2]) if bounty else v

    def chip_up(self, c, j):
        ic = self.icm
        eff = max(1, c.eff_vs(j))
        if not ic.ready or ic.stacks[c.me] != c.start[c.me]:
            return 1.0, float(c.start[c.me])
        return (ic.win[c.me][j] - ic.base[c.me]) / eff, ic.base[c.me]

    # ---- range estimates ---------------------------------------------------------------
    def chart_width(self, nb) -> float:
        return OPEN_CHART.get(nb, 0.125)

    def est_open_width(self, c, j) -> float:
        nbj = 0 if c.players == 2 else c.nb_of(j)
        return clip(self.chart_width(nbj) * self.open_adjust(c, j), 0.06, 0.9)

    def open_adjust(self, c, j) -> float:
        """Multiplier on seat j's chart opening width (the exploiters read it from stats)."""
        return 1.0

    def est_3bet_width(self, c, j) -> float:
        return clip(self.stats.rate("tb", j) * 1.1, 0.03, 0.2)

    def est_shove_width(self, c, j) -> float:
        raises = c.pre_raises
        idx = max((i for i, (s, _) in enumerate(raises) if s == j), default=0)
        S = c.s_units(min(c.start[j], max([c.start[k] for k in c.opps if k != j] + [c.start[c.me]])))
        if idx == 0 and not c.limpers:
            if self.T is not None and S <= self.T.PF_SMAX:
                return self.T.pf_width(c.nb_of(j) if c.players > 2 else 1, S, self.shover_bf(c, j), 1.0)
            return clip(0.12 * 20.0 / max(S, 1.0), 0.03, 0.15)
        if idx == 0:
            return clip(0.25 * 15.0 / max(S, 4.0), 0.06, 0.35)
        if idx == 1:
            return clip(0.30 * 10.0 / max(S, 4.0), 0.05, 0.30)
        return clip(0.04 * 25.0 / max(S, 8.0), 0.025, 0.08)

    def range_width(self, c, j) -> float:
        rs = c.pre_raises
        if rs:
            if rs[-1][0] == j:
                return self.est_open_width(c, j) if len(rs) == 1 else 0.08 if len(rs) == 2 else 0.035
            if any(s == j for s, _ in rs):
                return 0.06 if len(rs) >= 3 else 0.12
            if j == c.obs.bb_seat:
                return 0.45 if len(rs) == 1 else 0.10
            return 0.20 if len(rs) == 1 else 0.07
        if j == c.obs.bb_seat:
            return 1.0
        return 0.5 if j in c.limpers else 0.8

    # ---- preflop -----------------------------------------------------------------------
    def preflop(self, c):
        h = hclass(c.hole[0], c.hole[1])
        c.h = h
        c.pct = self.T.PCT[h]
        if not c.pre_raises:
            if c.limpers:
                return self.bb_option(c) if c.lg.can_check else self.vs_limpers(c)
            if c.lg.can_check:
                return self.bb_option(c)
            return self.first_in(c)
        if c.facing_allin() or c.to_call >= 0.45 * c.total:
            return self.vs_allin(c)
        nr = c.n_raises
        mine = [i for i, (s, _) in enumerate(c.pre_raises) if s == c.me]
        if nr == 1:
            if c.me in c.limpers:
                return self.limp_vs_raise(c)
            return self.vs_open(c)
        if mine and nr == mine[-1] + 2:
            return self.vs_3bet(c) if nr == 2 else self.vs_4bet(c)
        return self.vs_cold_3bet(c)

    # first in --------------------------------------------------------------------------
    def first_in(self, c):
        beh = c.behind()
        if not beh:
            return self.fold(c)
        eff = min(c.start[c.me], max(c.start[j] for j in beh))
        S = c.s_units(eff)
        c.S = S
        if S <= self.p["pf_max"]:
            return self.shove(c) if self.push_decision(c, S, beh) else self.fold(c)
        return self.open_decision(c, S, beh)

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

    def push_prob(self, c, S, beh) -> float:
        bp, bc = self.push_bfs(c, beh)
        return self.T.pf_push(len(beh), S, bp, bc, c.h)

    def push_decision(self, c, S, beh) -> bool:
        pr = self.push_prob(c, S, beh)
        ps = self.push_scale(c, beh)
        if abs(ps - 1.0) > 0.02:
            # wider / tighter: also read the table at the hand whose percentile is pct / scale
            bp, bc = self.push_bfs(c, beh)
            ph = self.T.pf_push(len(beh), S, bp, bc, self._shift_hand(c, ps))
            pr = max(pr, ph) if ps > 1 else min(pr, ph)
        return pr >= 0.999 or (pr > 0.001 and self.rand() < pr)

    def push_scale(self, c, beh) -> float:
        return self.p["push_scale"]

    def _shift_hand(self, c, scale):
        """A hand class whose percentile is c.pct / scale (to widen a range by `scale`)."""
        target = c.pct / scale
        best, bd = c.h, 9.0
        for h, p in enumerate(self.T.PCT):
            d = abs(p - target)
            if d < bd and self.T.W[h] > 0:
                best, bd = h, d
        return best

    def caller_widths(self, c, S, beh, my_w):
        """Each player behind calls my shove with the hands that have the equity its ICM price
        asks for against my shoving range (width my_w)."""
        out = []
        eff_dead = c.pot
        for j in beh:
            eff = c.eff_vs(j)
            risk = eff - c.bets[j]
            gain = eff + eff_dead - c.bets[j]
            bf = 1.0 + 0.6 * (self.bf_opp(j) - 1.0)
            need = bf * risk / max(1.0, bf * risk + gain)
            cw = self.T.call_width(my_w, need) * self.call_tendency(c, j)
            out.append((j, clip(cw, 0.0, 1.0)))
        return out

    def call_tendency(self, c, j) -> float:
        return 1.0

    def push_ev(self, c, beh, my_w) -> float:
        """ICM points of shoving minus folding."""
        widths = self.caller_widths(c, c.S if hasattr(c, "S") else 10.0, beh, my_w)
        ev = 0.0
        reach = 1.0
        v_fold = None
        for j, cw in widths:
            vf, vw, vl = self.allin_values(c, j)
            v_fold = vf if v_fold is None else v_fold
            if cw > 0:
                e = self.T.eq_top(max(cw, 0.01), c.h)
                ev += reach * cw * (e * vw + (1 - e) * vl)
            reach *= 1.0 - cw
        if v_fold is None:
            return 0.0
        up, base = self.chip_up(c, widths[-1][0])
        ev += reach * (base + up * (c.pot - c.committed[c.me]))
        return ev - v_fold

    def open_decision(self, c, S, beh):
        nb = c.nb if c.players > 2 else 0
        w = clip(self.chart_width(nb) * self.p["open_scale"] * self.open_factor(c, beh), 0.04, 0.95)
        mix = self.p["open_mix"]
        if mix > 0:
            lo, hi = w * (1 - mix), w * (1 + mix)
            if c.pct <= lo:
                go = True
            elif c.pct >= hi:
                go = False
            else:
                go = self.rand() < (hi - c.pct) / (hi - lo)
        else:
            go = c.pct <= w
        if go:
            return self.raise_to(c, self.open_size(c, S) * c.bb)
        return self.fold(c)

    def open_factor(self, c, beh) -> float:
        """Wider when the players behind are under more ICM pressure than me."""
        if not self.icm.ready or not beh:
            return 1.0
        bp, bc = self.push_bfs(c, beh)
        return clip((bc / bp) ** 0.3, 0.75, 1.4)

    def open_size(self, c, S):
        if c.players == 2:
            return 2.0 if S < 25 else 2.3
        if c.me == c.obs.sb_seat:
            return 2.6 if S < 25 else 3.0
        return 2.0 if S < 22 else 2.2 if S < 45 else 2.5

    def bb_option(self, c):
        if c.pct <= 0.12 + (0.15 if c.players == 2 else 0.0):
            return self.raise_to(c, c.pot + 2 * c.bb)
        return Check()

    def vs_limpers(self, c):
        nl = len(c.limpers)
        beh = c.behind()
        eff = min(c.total, max([c.start[j] for j in beh + c.limpers] or [c.total]))
        S = c.s_units(eff)
        thr = (0.08 if nl >= 2 else 0.12) + (0.06 if c.players <= 3 else 0.0)
        if S <= self.p["pf_max"]:
            return self.shove(c) if c.pct <= thr + 0.03 else self.fold(c)
        if c.pct <= thr:
            return self.raise_to(c, (4.0 + nl) * c.bb)
        hi, lo, kind = class_info(c.h)
        if c.to_call <= c.bb and S > 30 and (kind == 0 or (kind == 1 and hi - lo <= 2)) and c.pct <= 0.45:
            return Call()
        return self.fold(c)

    def limp_vs_raise(self, c):
        """I limped and someone raised."""
        return self.vs_open(c)

    # facing an open ----------------------------------------------------------------------
    def vs_open(self, c):
        opener = c.pre_raises[0][0]
        w_o = self.est_open_width(c, opener)
        eff = min(c.start[c.me], c.start[opener])
        S = c.s_units(eff)
        c.S = S
        if S <= self.p["jam_max"]:
            return self.resteal(c, opener, w_o, S)
        return self.deep_vs_open(c, opener, w_o, S, len(c.cold_callers))

    def three_bet_size(self, c, amt_to, callers=0):
        ip = c.me not in (c.obs.sb_seat, c.obs.bb_seat)
        size = amt_to * (3.0 if ip else 3.8) + callers * amt_to
        if size >= 0.38 * c.total:
            return c.lg.max_raise_to
        return size

    def tb_bluff_hand(self, c):
        hi, lo, kind = class_info(c.h)
        return (kind == 1 and hi == 12 and lo <= 4) or (kind == 1 and hi - lo == 1 and 3 <= lo <= 8) or (
            kind == 1 and hi == 11 and 5 <= lo <= 8)

    def tb_bluff_freq(self, c, opener, w_o) -> float:
        return self.p["tb_bluff"] if w_o >= 0.2 else 0.0

    def deep_vs_open(self, c, opener, w_o, S, callers):
        amt = c.pre_raises[0][1]
        tb_size = self.three_bet_size(c, amt, callers)
        bf = self.rf(c, opener, 2.2 * tb_size)
        value = max(0.022, self.p["tb_value"] * (0.6 + 1.2 * w_o)) / bf
        if callers:
            value *= 0.8
        if c.pct <= value:
            return self.raise_to(c, tb_size)
        if not callers and self.tb_bluff_hand(c) and bf < 1.3 and self.rand() < self.tb_bluff_freq(c, opener, w_o):
            return self.raise_to(c, tb_size)
        return self.flat_or_fold(c, opener, w_o, callers)

    def flat_or_fold(self, c, opener, w_o, callers):
        need = c.to_call / (c.pot + c.to_call)
        e = self.T.eq_top(w_o, c.h)
        in_bb = c.me == c.obs.bb_seat
        bf = self.rf(c, opener, 3.0 * c.to_call)
        R = self.realization(c, c.h, opener)
        tax = 0.012 * len(c.behind()) if not in_bb else 0.0
        width = 0.5 * self.p["call_scale"]
        if e * R * (1 + 0.12 * callers) - tax > need * bf and (c.pct <= width or in_bb):
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

    def resteal(self, c, opener, w_o, S):
        if self.jam_ev(c, opener, w_o) > self.jam_margin(c, opener):
            return self.shove(c)
        if c.me == c.obs.bb_seat and S >= 8 and c.to_call <= 0.25 * c.total and not c.cold_callers:
            need = c.to_call / (c.pot + c.to_call)
            e = self.T.eq_top(w_o, c.h)
            R = self.realization(c, c.h, opener) - (0.06 if S < 15 else 0.0)
            if e * R > need * self.rf(c, opener, 2.5 * c.to_call) + 0.02 and c.pct <= 0.6 * self.p["call_scale"]:
                return Call()
        return self.fold(c)

    def jam_margin(self, c, opener) -> float:
        return 0.0

    def opener_call_width(self, c, opener, w_o, need) -> float:
        """How wide the opener calls my re-shove (fraction of all hands)."""
        cw = self.T.call_width(self.p["jam_width"], need)
        return min(max(cw, min(w_o, 0.07 + 0.2 * w_o)), w_o)

    def jam_ev(self, c, opener, w_o) -> float:
        return self.reshove_ev(c, opener, w_o, self.p["jam_width"], self.opener_call_width)

    def reshove_ev(self, c, v, w_v, my_w, call_width_fn) -> float:
        """ICM points of shoving over seat v's raise (its range: the top w_v) minus folding. v
        continues with the hands that have the equity its (damped) ICM price asks for against my
        perceived shoving range my_w; players behind me can wake up."""
        jam = min(c.total, c.start[v] - (c.committed[v] - c.bets[v]))
        risk = max(0, jam - c.bets[v])
        pot_if_call = c.pot + (jam - c.my_bet) + risk
        need = risk / max(1.0, pot_if_call)
        bf_o = 1.0 + 0.4 * (self.bf_opp(v) - 1.0)
        need = need * bf_o / (need * bf_o + (1 - need))
        cw = call_width_fn(c, v, w_v, need)
        pcall = clip(cw / max(w_v, 1e-6), 0.0, 1.0)
        beh = [j for j in c.behind() if j != v]
        pbeh = 0.975 ** len(beh)
        vf, vw, vl = self.allin_values(c, v)
        e = self.T.eq_top(max(cw, 0.01), c.h)
        up, base = self.chip_up(c, v)
        v_take = vf + up * (c.pot - c.committed[c.me])
        ev = pbeh * ((1 - pcall) * v_take + pcall * (e * vw + (1 - e) * vl)) + (1 - pbeh) * (0.3 * vw + 0.7 * vl)
        return ev - vf

    def threebettor_call_width(self, c, v, w3, need) -> float:
        """How wide a 3-bettor calls my 4-bet shove."""
        cw = self.T.call_width(self.fourbet_width(c, v, w3), need)
        return min(w3, max(cw, min(w3, 0.035)))

    def vs_3bet(self, c):
        raiser, amt = c.pre_raises[-1]
        eff = min(c.start[c.me], c.start[raiser])
        S = c.s_units(eff)
        w3 = self.est_3bet_width(c, raiser)
        bf = self.rf(c, raiser, 2.5 * c.to_call)
        if S <= 45 or c.to_call >= 0.3 * c.total:
            return self.jam_vs_3bet(c, raiser, w3, S)
        if c.pct <= max(0.02, 0.35 * w3) / bf:
            return self.raise_to(c, amt * 2.3)
        need = c.to_call / (c.pot + c.to_call)
        e = self.T.eq_top(w3, c.h)
        if e * self.realization(c, c.h, raiser) > need * bf + 0.03 and c.pct <= 0.13:
            return Call()
        return self.fold(c)

    def jam_vs_3bet(self, c, raiser, w3, S):
        ev = self.reshove_ev(c, raiser, w3, self.fourbet_width(c, raiser, w3), self.threebettor_call_width)
        if ev > 0 and c.pct <= 0.4:
            return self.shove(c)
        need = c.to_call / (c.pot + c.to_call)
        if self.T.eq_top(w3, c.h) > need * self.rf(c, raiser, c.to_call) + 0.08 and c.pct <= 0.08 \
                and c.to_call < 0.3 * c.total:
            return Call()
        return self.fold(c)

    def fourbet_width(self, c, raiser, w3) -> float:
        """The 4-bet shoving range a 3-bettor credits me with."""
        return 0.06

    def vs_4bet(self, c):
        raiser = c.pre_raises[-1][0]
        need = c.to_call / (c.pot + c.to_call)
        e = self.T.eq_top(0.03, c.h)
        if c.pct <= 0.02 or e > need * self.rf(c, raiser, c.total) + 0.05:
            return self.shove(c) if c.pct <= 0.015 else Call()
        return self.fold(c)

    def vs_cold_3bet(self, c):
        if c.pct <= 0.02:
            return self.shove(c)
        if c.pct <= 0.035 and c.to_call < 0.25 * c.total:
            return Call()
        return self.fold(c)

    # all-in calls --------------------------------------------------------------------------
    def vs_allin(self, c):
        shover = c.pre_raises[-1][0]
        h = c.h
        e = self.allin_equity(c, shover, h)
        beh = [j for j in c.behind() if j != shover and not c.all_in[j]]
        in_already = [j for j in c.opps if j != shover and c.bets[j] > 0 and j not in beh
                      and c.committed[j] >= 0.99 * c.committed[shover]]
        if in_already:
            e = e ** (1.0 + 0.7 * len(in_already))
        e -= 0.015 * len(beh)
        vf, vw, vl = self.allin_values(c, shover)
        if e * vw + (1 - e) * vl > vf + self.call_allin_margin(c, shover):
            if c.lg.can_raise and not c.all_in[shover] and c.pct <= 0.03:
                return self.shove(c)
            return Call() if c.lg.can_call else self.passive(c)
        return self.fold(c)

    def call_allin_margin(self, c, j) -> float:
        if self.icm.ready and c.start[j] >= c.start[c.me]:
            return self.p["covered_margin"] * self.icm.total_pts
        return 0.0

    def allin_equity(self, c, j, h):
        rs = c.pre_raises
        if len(rs) == 1 and rs[0][0] == j and not c.limpers and c.all_in[j]:
            S = c.s_units(min(c.start[j], max(c.start[k] for k in range(c.n) if k != j and c.in_hand[k])))
            if S <= self.T.PF_SMAX and self.trust_pf_range(c, j):
                nbj = 1 if c.players == 2 else c.nb_of(j)
                return self.T.pf_eq(nbj, S, self.shover_bf(c, j), 1.0 + 0.5 * (self.bf_me(j) - 1.0), h)
        w = self.shove_width(c, j)
        return self.T.eq_top(clip(w, 0.01, 1.0), h)

    def shover_bf(self, c, j) -> float:
        """The risk premium a shover actually shows (players shove wider than ICM-tight)."""
        return 1.0 + 0.4 * (self.icm.bf(j, c.me) - 1.0)

    def trust_pf_range(self, c, j) -> bool:
        return True

    def shove_width(self, c, j):
        return self.est_shove_width(c, j)

    # ---- postflop ----------------------------------------------------------------------
    def villain(self, c):
        st = c.street
        for s in (st, st - 1, st - 2, st - 3, 0):
            a = c.aggr.get(s)
            if a is not None and a != c.me and c.live[a]:
                return a
        return max(c.opps, key=lambda j: c.start[j]) if c.opps else None

    def post_row(self, c, T=None):
        T = T or self.TP
        sk = street_key(len(c.board))
        made, draw, ftex, stex, paired = features(c.hole[0], c.hole[1], c.board, self.sc)
        c.made, c.draw, c.ftex, c.stex, c.paired = made, draw, ftex, stex, paired
        return T.POST[key_of(sk, made, draw, ftex, stex, paired)]

    @staticmethod
    def pre_col(row, w):
        if w >= 0.5:
            return row[1] + (row[0] - row[1]) * (w - 0.5) / 0.5
        if w >= 0.25:
            return row[2] + (row[1] - row[2]) * (w - 0.25) / 0.25
        if w >= 0.12:
            return row[3] + (row[2] - row[3]) * (w - 0.12) / 0.13
        return row[3] - 0.6 * (row[2] - row[3]) * min(1.0, (0.12 - w) / 0.13)

    def air_equity(self, c):
        """My equity against a pure bluff."""
        return 0.92 if c.made >= LOWPAIR else 0.62 if c.made == AIR2 else 0.45

    def bluff_share(self, c, j, raised) -> float:
        if raised:
            return 0.08
        return (0.0, 0.14, 0.18, 0.22)[min(3, c.street)]

    def equity(self, c, j, row):
        w = self.range_width(c, j)
        e_pre = self.pre_col(row, w)
        shift = e_pre - row[1]
        bet_now = any(s == j for s, _ in c.street_raises)
        raised_now = bet_now and len(c.street_raises) >= 2 and c.street_raises[-1][0] == j
        prev_call = any(st < c.street for st in c.called_street.get(j, ()))
        prev_bet = any(c.aggr.get(st) == j for st in range(1, c.street))
        e_air = self.air_equity(c)
        if raised_now:
            b = self.bluff_share(c, j, True)
            e = (1 - b) * (row[6] + 0.5 * shift) + b * e_air
        elif bet_now:
            amt = max(a for s, a in c.street_raises if s == j)
            frac = amt / max(1.0, c.pot - amt)
            e_bet = row[5] if frac >= 0.5 else row[4] + (row[5] - row[4]) * frac / 0.5
            e_bet += 0.6 * shift
            if c.street == 1 and c.pf_aggr == j and len(c.street_raises) == 1:
                e_bet = 0.55 * e_pre + 0.45 * (row[4] + 0.6 * shift)       # a c-bet: most of the range
            elif prev_bet or prev_call:
                e_bet -= 0.03
            b = self.bluff_share(c, j, False)
            e = (1 - b) * e_bet + b * e_air
        elif prev_call or prev_bet:
            e = row[4] + 0.6 * shift
        else:
            e = e_pre
        e_call = row[4] + 0.6 * shift
        if prev_call or prev_bet:
            e_call -= 0.03
        return clip(e, 0.01, 0.99), clip(e_call, 0.01, 0.99)

    def multiway(self, e, row, n_opp):
        if n_opp <= 1:
            return e
        r = row[7] / max(0.05, row[1])
        return clip(e * min(1.0, r) ** (n_opp - 1), 0.0, 1.0)

    def postflop(self, c):
        j = self.villain(c)
        if j is None:
            return self.passive(c)
        row = self.post_row(c)
        e, e_call = self.equity(c, j, row)
        e = self.multiway(e, row, c.n_opp)
        e_call = self.multiway(e_call, row, c.n_opp)
        c.e, c.e_call, c.vil, c.row = e, e_call, j, row
        if c.to_call > 0:
            return self.facing_bet(c, j, e, row)
        return self.unbet(c, j, e, e_call, row)

    def bet_size(self, c, value=True):
        wet = c.ftex >= 1 or c.stex >= 2
        if c.street == 1:
            return 0.66 if wet else 0.4
        if c.street == 2:
            return 0.66
        return 0.75 if value else 0.7

    # postflop hooks -----------------------------------------------------------------------
    def vthr(self, c, j) -> float:
        return self.p["vthr"] + 0.05 * (c.n_opp - 1) - (0.03 if c.street == 3 else 0.0)

    def cbet_freq(self, c, j) -> float:
        dry = c.ftex == 0 and c.stex <= 1
        return self.p["cbet"] * (1.0 if dry else 0.75)

    def barrel_freq(self, c, j) -> float:
        return self.p["barrel"]

    def rbluff_freq(self, c, j) -> float:
        return self.p["rbluff"]

    def stab_freq(self, c, j) -> float:
        return self.p["stab"]

    def call_adj(self, c, j) -> float:
        return 0.0

    def float_call(self, c, j, e, need) -> bool:
        return False

    def bluff_raise(self, c, j) -> bool:
        return c.street == 1 and c.draw >= 4 and c.n_opp == 1 and self.rand() < 0.3

    def slowplay(self, c, j) -> bool:
        return False

    def unbet(self, c, j, e, e_call, row):
        st = c.street
        spr = c.stack / max(1.0, c.pot)
        if e_call >= self.vthr(c, j) and not self.slowplay(c, j):
            if spr <= 1.1:
                return self.shove(c)
            f = self.bet_size(c, True)
            if e_call >= 0.8 and (c.ftex >= 1 or c.stex >= 1) and st < 3:
                f = max(f, 0.75)
            return self.bet_pot(c, f)
        if c.n_opp == 1:
            initiative = c.aggr.get(st - 1) == c.me
            if st == 1 and c.pf_aggr == c.me:
                freq = self.cbet_freq(c, j)
                if c.draw >= 2:
                    freq = max(freq, 0.75)
                if self.rand() < freq:
                    return self.bet_pot(c, self.bet_size(c, False))
            elif initiative and st == 2:
                freq = self.barrel_freq(c, j)
                if c.draw >= 2:
                    freq = max(freq, 0.6)
                elif c.made >= LOWPAIR:
                    freq = min(freq, 0.15)
                if self.rand() < freq:
                    return self.bet_pot(c, self.bet_size(c, False))
            elif initiative and st == 3:
                if c.made <= AIR2 and self.rand() < self.rbluff_freq(c, j):
                    return self.bet_pot(c, self.bet_size(c, False))
            elif c.ip and c.checked and j in c.checked:
                if (c.draw >= 2 or c.made <= AIR2 or e < 0.45) and self.rand() < self.stab_freq(c, j):
                    return self.bet_pot(c, 0.5 if st < 3 else 0.6)
        return Check()

    def facing_bet(self, c, j, e, row):
        st = c.street
        pot_after = c.pot + c.to_call
        price = c.to_call / pot_after
        rf = self.rf(c, j, c.committed[c.me] + c.to_call * (1.0 if st == 3 else 1.6))
        need = price * rf / (price * rf + (1 - price))
        commit = c.to_call >= 0.6 * c.stack
        R = 1.0 if (c.ip or st == 3 or commit) else 0.93
        e_eff = e * R + (0.02 if st < 3 and c.draw >= 2 and not commit else 0.0) - (0.02 if commit else 0.0)
        e_eff += self.call_adj(c, j) - self.p["call_margin"]
        if c.lg.can_raise and e >= self.p["raise_thr"] and (st < 3 or e >= self.p["raise_thr"] + 0.06):
            if c.stack <= 1.5 * pot_after:
                return self.shove(c)
            return self.raise_to(c, c.my_bet + c.to_call + 1.0 * (pot_after + c.to_call))
        if c.lg.can_raise and not commit and self.bluff_raise(c, j):
            return self.raise_to(c, c.my_bet + c.to_call + 0.9 * (pot_after + c.to_call))
        if e_eff >= need:
            return Call()
        if not commit and self.float_call(c, j, e, need):
            return Call()
        return self.fold(c)

    # ---- discards ------------------------------------------------------------------------
    def discard(self, obs):
        lg = obs.legal
        rule = None
        for r in self.spec.discards_on_street(obs.street):
            if r.count >= lg.discard_count:
                rule = r
                break
        to_board = bool(rule and rule.to_board)
        draw = bool(rule and rule.draw)
        T = self.TP or (tables9.get("std") if self.sc.inv == list(range(9)) and len(self.spec.deck_ranks) == 13
                        else None)
        board = list(obs.board)
        kv = None
        if T is not None and not draw and len(obs.hole) - lg.discard_count == 2 and len(board) >= 3 \
                and getattr(self.spec, "showdown", "high") == "high" and self.spec.hole_usage == "any":
            sk = street_key(len(board))

            def kv(keep, drop):
                b = board + list(drop) if to_board else board
                f = features(keep[0], keep[1], b, self.sc)
                return T.POST[key_of(sk, *f)][1]
        return Discard(choose_discard(obs.hole, board, lg.discard_min, lg.discard_count, self.sc, kv, draw))

    # ---- fixed limit -----------------------------------------------------------------------
    def limit_play(self, c):
        lg = c.lg
        pot_after = c.pot + c.to_call
        if c.street == 0:
            h = hclass(c.hole[0], c.hole[1])
            c.h, c.pct = h, self.T.PCT[h]
            nb = c.nb if c.players > 2 else 0
            w = self.chart_width(nb) * self.p["open_scale"]
            if not c.pre_raises:
                if c.lg.can_check:
                    return self.raise_to(c, lg.max_raise_to) if c.pct <= 0.2 else Check()
                if c.pct <= w * (0.8 if c.limpers else 1.0):
                    return self.raise_to(c, lg.max_raise_to)
                if c.limpers and c.pct <= 0.4:
                    return Call()
                if c.me == c.obs.sb_seat and c.pct <= 0.55:
                    return Call()
                return self.fold(c)
            vw = 0.05 if c.n_raises >= 2 else 0.09
            if c.pct <= vw and lg.can_raise:
                return self.raise_to(c, lg.max_raise_to)
            cw = 0.12 if c.n_raises >= 2 else 0.30
            if c.me == c.obs.bb_seat and c.n_raises == 1:
                cw = 0.55
            return Call() if c.pct <= cw else self.fold(c)
        j = self.villain(c)
        if j is None:
            return self.passive(c)
        row = self.post_row(c, self.T)
        e, e_call = self.equity(c, j, row)
        e = self.multiway(e, row, c.n_opp)
        e_call = self.multiway(e_call, row, c.n_opp)
        if c.to_call <= 0:
            if e_call >= 0.55 or (c.pf_aggr == c.me and c.street == 1 and c.n_opp == 1 and self.rand() < 0.65):
                return self.raise_to(c, lg.max_raise_to)
            return Check()
        need = c.to_call / pot_after
        if e >= 0.72 and lg.can_raise:
            return self.raise_to(c, lg.max_raise_to)
        if e + (0.04 if c.draw >= 2 and c.street < 3 else 0.0) >= need:
            return Call()
        return self.fold(c)

    # ---- any other card game ----------------------------------------------------------------
    def gen_strength(self, c) -> float:
        hole, board = c.hole, c.board
        if not board:
            if self.T is not None and len(hole) == 2:
                return 1.0 - self.T.PCT[hclass(hole[0], hole[1])]
            return pre_generic(hole)
        if self.TP is not None and len(hole) == 2 and len(board) >= 3:
            row = self.post_row(c, self.TP)
            return row[1] - 0.05 * (c.n_opp - 1)
        s = post_generic(hole, board, self.sc, self.exact)
        sd = getattr(self.spec, "showdown", "high")
        if sd == "wild2":
            s = min(0.99, s + 0.1 * sum(1 for x in hole if x >> 2 == 0))
        elif sd != "high":
            s = 0.55 * s + 0.2
        return s - 0.04 * (c.n_opp - 1)

    def generic(self, c):
        lg = c.lg
        pot_after = c.pot + c.to_call
        s = self.gen_strength(c)
        c.made = c.draw = 0
        if c.street == 0:
            short = c.total <= 12 * c.bb
            if short:
                if s >= 0.62 or (c.to_call <= 0 and s >= 0.5):
                    return self.shove(c)
                return self.fold(c) if c.to_call > 0 else Check()
            if c.to_call <= 0:
                if s >= 0.66 and lg.can_raise:
                    return self.raise_to(c, c.my_bet + 3 * c.bb)
                return Check()
            if not c.pre_raises:
                if s >= 0.7:
                    return self.raise_to(c, 3.5 * c.bb)
                if s >= 0.48:
                    return Call()
                return self.fold(c)
            need = c.to_call / pot_after
            if s >= 0.86 and lg.can_raise and c.n_raises < 3:
                return self.raise_to(c, c.my_bet + c.to_call + pot_after)
            if s >= 0.56 + need * 0.6:
                return Call()
            return self.fold(c)
        need = c.to_call / pot_after if c.to_call else 0.0
        if c.to_call <= 0:
            if s >= 0.7 and lg.can_raise:
                return self.bet_pot(c, 0.6)
            if c.n_opp == 1 and c.pf_aggr == c.me and c.street == 1 and self.rand() < 0.4:
                return self.bet_pot(c, 0.45)
            return Check()
        if s >= 0.88 and lg.can_raise:
            return self.bet_pot(c, 0.8)
        if s - 0.12 >= need:
            return Call()
        return self.fold(c)

