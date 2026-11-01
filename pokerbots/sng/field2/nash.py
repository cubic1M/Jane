"""f2_nash: Nash push/fold + ICM specialist.

Idea of the team that wrote it: the format is a turbo sit-and-go, so most of the points
are decided at <= 15bb where push/fold is near-optimal and solvable offline. Below the
threshold it plays a heads-up-Nash-like push chart by effective stack, shrunk per
player still to act, and calls shoves only when its equity vs the shover's assumed
Nash range clears the ICM-adjusted price (bubble factor vs that seat). Deeper, it plays
a tight, simple open-raise game and an ABC postflop (value bet, pot-odds calls).
"""
from __future__ import annotations

from .common import (Ctx, F2Base, bet_frac, call_or_check, fold_or_check, icm_required_equity, push_pct,
                     raise_to, shove)

PF_THRESHOLD = 15.0
OPEN_PCT = {0: 0.0, 1: 0.32, 2: 0.27, 3: 0.19, 4: 0.15, 5: 0.12, 6: 0.10, 7: 0.09}


class F2Nash(F2Base):
    name = "f2_nash"
    use_icm = True

    def decide(self, obs):
        ctx = Ctx(obs)
        if obs.street == 0:
            return self.preflop(ctx, self.pf(obs))
        return self.postflop(ctx, self.read(obs))

    # ---- preflop ---------------------------------------------------------------------
    def _icm_shrink(self, seats):
        if not seats:
            return 1.0
        bf = sum(self.bf_of(j, 1.3) for j in seats) / len(seats)
        return max(0.45, min(1.15, (1.3 / bf) ** 0.8))

    def preflop(self, ctx, pf):
        obs = ctx.obs
        bb = ctx.bb
        seats = obs.seats
        my_total = obs.my_stack + obs.my_bet
        if ctx.n_raises == 0:
            behind = ctx.behind
            big_behind = max((seats[j].stack + seats[j].bet for j in behind), default=0)
            e_open = min(my_total, big_behind) / bb if behind else ctx.eff_bb
            if e_open <= PF_THRESHOLD or ctx.stack_bb <= PF_THRESHOLD:
                n_b = len(behind) + ctx.limpers
                p = push_pct(min(e_open, ctx.stack_bb), max(1, n_b)) * self._icm_shrink(behind)
                if ctx.limpers:
                    p *= 0.8
                if pf.pct <= p:
                    return shove(ctx)
                return fold_or_check(ctx)
            if ctx.is_bb:                               # limped to me
                if pf.pct <= 0.07:
                    return raise_to(ctx, ctx.cur_bet + (3 + ctx.limpers) * bb)
                return call_or_check(ctx)
            t = OPEN_PCT.get(len(behind), 0.09)
            if ctx.limpers:
                t *= 0.6
            if pf.pct <= t:
                size = (2.3 + ctx.limpers) * bb if not ctx.is_sb else 3.0 * bb
                return raise_to(ctx, size)
            return fold_or_check(ctx)
        # facing a raise
        j = ctx.last_raiser
        rv = seats[j]
        r_total = rv.stack + rv.committed
        r_bb = r_total / bb
        r_shove = rv.all_in or rv.bet >= 0.5 * (rv.stack + rv.bet)
        risk = min(ctx.to_call, obs.my_stack)
        win = ctx.pot
        if r_shove or ctx.stack_bb <= PF_THRESHOLD:
            # the raiser's range: Nash push range for his stack and the players behind him then
            his_behind = self._behind_at(obs, j)
            width = push_pct(min(r_bb, ctx.stack_bb), max(1, his_behind)) if r_shove else 0.2
            if ctx.n_raises >= 2:
                width *= 0.5
            width = max(0.025, min(1.0, width * 1.1))
            if not r_shove:
                # a normal raise and I'm short: re-shove with the top of a resteal range
                p = push_pct(ctx.stack_bb, ctx.n_behind + 1) * 0.5 * self._icm_shrink([j])
                if ctx.n_raises == 1 and pf.pct <= max(p, 0.04):
                    return shove(ctx)
                if ctx.lg.can_check:
                    return call_or_check(ctx)
                # cheap completion in the BB vs a min-raise with a decent hand
                if ctx.to_call <= 1.2 * bb and pf.pct <= 0.35:
                    return call_or_check(ctx)
                return fold_or_check(ctx)
            eq = pf.eq_vs_top(width)
            req = icm_required_equity(risk, win, self.bf_of(j, 1.4)) + 0.025 * ctx.n_behind
            if ctx.callers:
                eq *= 0.85
            if eq >= req:
                if ctx.lg.can_raise and pf.pct <= 0.03 and ctx.n_behind:
                    return shove(ctx)
                return call_or_check(ctx)
            return fold_or_check(ctx)
        # deep, facing a normal raise
        raise_bb = ctx.cur_bet / bb
        if ctx.n_raises == 1:
            if pf.pct <= 0.03:
                if ctx.eff_bb <= 28:
                    return shove(ctx)
                return raise_to(ctx, ctx.cur_bet * (3.0 if ctx.in_position or ctx.n_behind == 0 else 3.5))
            if ctx.eff_bb <= 25 and pf.pct <= 0.06:
                return shove(ctx)
            if raise_bb <= 3.5 and ctx.eff_bb >= 25:
                lim = 0.30 if ctx.is_bb else 0.11
                if pf.pair and ctx.eff_bb >= 40:
                    lim = max(lim, 0.45)
                if pf.pct <= lim:
                    return call_or_check(ctx)
            return fold_or_check(ctx)
        if pf.pct <= 0.02:
            return shove(ctx)
        if pf.pct <= 0.035 and ctx.eff_bb >= 50 and ctx.to_call <= 0.25 * obs.my_stack:
            return call_or_check(ctx)
        return fold_or_check(ctx)

    @staticmethod
    def _behind_at(obs, j):
        n = len(obs.seats)
        order = [(obs.bb_seat + 1 + i) % n for i in range(n)]
        inh = [k for k in order if obs.seats[k].in_hand]
        if j not in inh:
            return 1
        return max(1, len(inh) - inh.index(j) - 1)

    # ---- postflop (ABC) ---------------------------------------------------------------
    def postflop(self, ctx, rd):
        n_opp = max(1, ctx.n_opp)
        eq = rd.eq ** (1 + 0.35 * (n_opp - 1))
        spr = ctx.obs.my_stack / max(1, ctx.pot)
        if ctx.lg.can_check:
            if rd.hs >= 0.72:
                return bet_frac(ctx, 0.6)
            if ctx.i_pfr and n_opp == 1 and ctx.street == 1 and self.rng.random() < 0.6:
                return bet_frac(ctx, 0.4)
            if rd.outs >= 8 and n_opp <= 2 and ctx.street < 3 and self.rng.random() < 0.5:
                return bet_frac(ctx, 0.5)
            return call_or_check(ctx)
        po = ctx.pot_odds()
        if rd.hs >= 0.88:
            if spr < 2:
                return shove(ctx)
            return bet_frac(ctx, 0.8)
        if eq >= po + 0.06:
            if spr < 1.0 and eq >= 0.55:
                return shove(ctx)
            return call_or_check(ctx)
        return fold_or_check(ctx)
