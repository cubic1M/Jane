"""f2_equity: precomputed-equity-table bot (pot odds + implied odds, semi-bluffs).

Idea of the team that wrote it: Monte Carlo is too slow inside a 1 ms decision, so do
it at import time and store the answers in a dict. Preflop: per-class equity vs 1, 2
and 3 random hands and vs top-x% ranges (the shared score bank). Postflop: a bucket
table built by Monte Carlo when the table starts (a small budget, cached per card spec):
bucket = (street, made-hand strength bin, outs bin) -> equity vs one and two random
hands at showdown. Decisions are textbook pot odds: call when equity (discounted for
the strength a bet shows) beats the price, adding implied odds for draws; value-bet
when ahead; semi-bluff strong draws.
"""
from __future__ import annotations

import numpy as np

from engine.evaluator import get_evaluator

from .common import (Ctx, F2Base, bet_frac, call_or_check, fold_or_check, push_pct, raise_to,
                     read_postflop, shove)

HS_BINS = (0.2, 0.35, 0.5, 0.62, 0.72, 0.8, 0.88, 0.95)
_TABLES: dict = {}


def hs_bin(hs):
    for i, b in enumerate(HS_BINS):
        if hs < b:
            return i
    return len(HS_BINS)


def outs_bin(o):
    return 0 if o == 0 else 1 if o <= 4 else 2 if o <= 8 else 3 if o <= 12 else 4


def build_table(spec, sc, n_per_street=None, seed=4242):
    """{(street, hs_bin, outs_bin): (eq_vs_1, eq_vs_2, count)} by Monte Carlo."""
    key = (tuple(spec.deck_ranks), spec.category_order, spec.hole_cards, spec.hole_usage,
           spec.hole_exact, spec.board_cards_per_street)
    if key in _TABLES:
        return _TABLES[key]
    if n_per_street is None:
        n_per_street = 2500 if spec.hole_usage == "any" else 900
    ev = get_evaluator(spec)
    rng = np.random.default_rng(seed)
    deck = np.array(spec.deck, dtype=np.int64)
    h = spec.hole_cards
    nb = spec.total_board_dealt
    cum = np.cumsum(spec.board_cards_per_street)
    acc = {}
    for st in range(1, spec.num_streets):
        shown = int(cum[st])
        N = n_per_street
        perm = deck[rng.random((N, len(deck))).argsort(axis=1)[:, :3 * h + nb]]
        me, o1, o2, board = perm[:, :h], perm[:, h:2 * h], perm[:, 2 * h:3 * h], perm[:, 3 * h:]
        s_me = ev.evaluate_batch(me, board)
        s1 = ev.evaluate_batch(o1, board)
        s2 = ev.evaluate_batch(o2, board)
        w1 = np.where(s_me > s1, 1.0, np.where(s_me == s1, 0.5, 0.0))
        m2 = np.maximum(s1, s2)
        w2 = np.where(s_me > m2, 1.0, np.where(s_me == m2, 0.5, 0.0))
        mel = me.tolist()
        bl = board[:, :shown].tolist()
        for i in range(N):
            rd = read_postflop(sc, mel[i], bl[i])
            k = (st, hs_bin(rd.hs), outs_bin(rd.outs))
            a = acc.setdefault(k, [0.0, 0.0, 0])
            a[0] += w1[i]
            a[1] += w2[i]
            a[2] += 1
    tab = {k: (a[0] / a[2], a[1] / a[2], a[2]) for k, a in acc.items()}
    _TABLES[key] = tab
    return tab


class F2Equity(F2Base):
    name = "f2_equity"

    def setup(self):
        self.table = build_table(self.spec, self.sc)

    def decide(self, obs):
        ctx = Ctx(obs)
        if obs.street == 0:
            return self.preflop(ctx, self.pf(obs))
        return self.postflop(ctx, self.read(obs))

    # ---- preflop ---------------------------------------------------------------------
    def range_width(self, ctx):
        obs = ctx.obs
        j = ctx.last_raiser
        rv = obs.seats[j]
        if rv.all_in or rv.bet >= 0.5 * (rv.stack + rv.bet):
            return max(0.03, push_pct((rv.stack + rv.committed) / ctx.bb, 3) * (0.6 if ctx.n_raises > 1 else 1.0))
        if ctx.n_raises >= 3:
            return 0.03
        if ctx.n_raises == 2:
            return 0.06
        r = ctx.cur_bet / ctx.bb
        return 0.28 if r <= 2.5 else 0.2 if r <= 4 else 0.13

    def preflop(self, ctx, pf):
        obs = ctx.obs
        bb = ctx.bb
        if ctx.n_raises == 0:
            nb = len(ctx.behind)
            if ctx.is_bb:
                if pf.eq_vs_n(max(1, ctx.n_opp)) >= 0.5 + 0.02 * ctx.n_opp and pf.pct <= 0.12:
                    return raise_to(ctx, ctx.cur_bet + (3 + ctx.limpers) * bb)
                return call_or_check(ctx)
            if ctx.eff_bb <= 10:
                if pf.pct <= push_pct(ctx.eff_bb, max(1, nb)) * 0.9:
                    return shove(ctx)
                return fold_or_check(ctx)
            k = 1 if nb <= 3 else 2
            e = pf.eq_vs_n(k + ctx.limpers)
            thr = {1: 0.52, 2: 0.36}[k] + 0.012 * nb
            if e >= thr:
                return raise_to(ctx, (2.5 + ctx.limpers) * bb if not ctx.is_sb else 3 * bb)
            # pot-odds limp: complete the SB / over-limp with hands that play well multiway
            if ctx.to_call <= bb and (pf.pair or (pf.suited and pf.gap <= 1)) and ctx.eff_bb >= 30 \
                    and (ctx.is_sb or ctx.limpers):
                return call_or_check(ctx)
            return fold_or_check(ctx)
        width = self.range_width(ctx)
        eq = pf.eq_vs_top(width) * (0.86 ** ctx.callers)
        po_pot = ctx.pot + ctx.to_call
        behind_after = max(0, min(obs.my_stack - ctx.to_call, ctx.eff - ctx.cur_bet))
        implied = 0.0
        if ctx.eff_bb >= 30 and not ctx.facing_allin:
            implied = behind_after * (0.09 if pf.pair else 0.05 if pf.suited and pf.gap <= 2 else 0.0)
        need = ctx.to_call / (po_pot + implied)
        if eq >= 0.6 and ctx.lg.can_raise:
            if ctx.eff_bb <= 25 or ctx.n_raises >= 2:
                return shove(ctx)
            return raise_to(ctx, ctx.cur_bet * 3.0 + ctx.callers * ctx.cur_bet)
        realize = 1.0 if ctx.facing_allin else (0.9 if ctx.is_btn else 0.8)
        floor = 0.0 if (ctx.is_bb or ctx.facing_allin) else 0.42
        if eq * realize >= max(need, floor):
            if ctx.to_call > 0.3 * obs.my_stack and eq < 0.5 and not ctx.facing_allin:
                return fold_or_check(ctx)
            return call_or_check(ctx)
        return fold_or_check(ctx)

    # ---- postflop ---------------------------------------------------------------------
    def lookup(self, st, rd, n_opp):
        st = min(st, self.spec.num_streets - 1)
        v = self.table.get((st, hs_bin(rd.hs), outs_bin(rd.outs)))
        if v is None or v[2] < 12:
            e1 = rd.eq
            e2 = rd.eq ** 1.6
        else:
            w = min(1.0, v[2] / 60.0)
            e1 = w * v[0] + (1 - w) * rd.eq
            e2 = w * v[1] + (1 - w) * rd.eq ** 1.6
        if n_opp <= 1:
            return e1
        if n_opp == 2:
            return e2
        return e2 * (0.8 ** (n_opp - 2))

    def postflop(self, ctx, rd):
        obs = ctx.obs
        n_opp = max(1, ctx.n_opp)
        eq = self.lookup(ctx.street, rd, n_opp)
        last = ctx.street >= self.spec.num_streets - 1
        spr = obs.my_stack / max(1, ctx.pot)
        draw = rd.outs >= 8 and not last
        if ctx.lg.can_check:
            if eq >= 0.62:
                return shove(ctx) if spr < 1.0 else bet_frac(ctx, 0.66)
            if draw and self.rng.random() < 0.65:
                return bet_frac(ctx, 0.66)
            if ctx.i_pfr and n_opp == 1 and ctx.street == 1 and eq >= 0.35 and self.rng.random() < 0.5:
                return bet_frac(ctx, 0.5)
            return call_or_check(ctx)
        bet_size = ctx.to_call / max(1, ctx.pot - ctx.to_call)
        # equity vs the range that bets: shrink toward 0, more for raises and big bets
        eq_f = eq ** (1.4 + 0.4 * (ctx.n_raises - 1) + 0.3 * min(1.5, bet_size))
        implied = 0.0
        if draw:
            opp_behind = max((obs.seats[j].stack for j in ctx.opps), default=0)
            implied = 0.3 * min(opp_behind, ctx.pot)
        need = ctx.to_call / (ctx.pot + ctx.to_call + implied)
        if eq_f >= 0.75:
            return bet_frac(ctx, 0.75)
        if draw and n_opp == 1 and ctx.n_raises == 1 and self.rng.random() < 0.3:
            return bet_frac(ctx, 0.75)
        if eq_f >= need:
            return call_or_check(ctx)
        return fold_or_check(ctx)
