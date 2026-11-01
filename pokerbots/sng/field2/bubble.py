"""f2_bubble: ICM-pressure bot that plays by stack rank.

Idea of the team that wrote it: with points for every place, a medium stack loses far
more by busting than it gains by doubling (bubble factor > 1), so the big stack can
bully, medium stacks must tighten (especially against bigger stacks) and short stacks
should shove wide before the blinds eat them. Roles are recomputed every hand from the
stacks (and the bubble factors vs each seat, refreshed in end_hand):
  * big (top 2 and >= 1.3x the average): open wide, re-raise/shove at medium stacks;
  * medium: tight, avoid confrontations with covering stacks, pot control postflop;
  * short (<= 12bb, or bottom two with <= 18bb): push/fold with a wide range.
"""
from __future__ import annotations

from .common import (Ctx, F2Base, bet_frac, call_or_check, fold_or_check, icm_required_equity, push_pct,
                     raise_to, shove)

BASE_OPEN = {1: 0.38, 2: 0.33, 3: 0.24, 4: 0.19, 5: 0.15, 6: 0.13, 7: 0.12}


class F2Bubble(F2Base):
    name = "f2_bubble"
    use_icm = True

    def role(self, ctx):
        stacks = sorted(ctx.stacks_now(), reverse=True)
        me = ctx.start_stack
        avg = sum(stacks) / len(stacks)
        rank = stacks.index(me) + 1 if me in stacks else len(stacks)
        bbs = me / ctx.bb
        if bbs <= 12 or (rank >= len(stacks) - 1 and bbs <= 18 and len(stacks) > 2):
            return "short"
        if rank <= 2 and me >= 1.3 * avg:
            return "big"
        if len(stacks) <= 2:
            return "big" if me >= avg else "short"
        return "medium"

    def decide(self, obs):
        ctx = Ctx(obs)
        role = self.role(ctx)
        if obs.street == 0:
            return self.preflop(ctx, self.pf(obs), role)
        return self.postflop(ctx, self.read(obs), role)

    # ---- preflop ---------------------------------------------------------------------
    def preflop(self, ctx, pf, role):
        obs = ctx.obs
        bb = ctx.bb
        seats = obs.seats
        me_total = ctx.start_stack
        end_tight = 0.85 if obs.hands_left < 20 and role == "medium" else 1.0
        if ctx.n_raises == 0:
            behind = ctx.behind
            nb = max(1, len(behind) + ctx.limpers)
            if role == "short":
                p = push_pct(ctx.stack_bb, nb, shrink=0.8) * 1.25
                if ctx.stack_bb <= 6 and len(behind) <= 2:
                    p = max(p, 0.85)
                if pf.pct <= p:
                    return shove(ctx)
                return fold_or_check(ctx)
            if ctx.is_bb:
                if pf.pct <= (0.15 if role == "big" else 0.07):
                    return raise_to(ctx, ctx.cur_bet + (3 + ctx.limpers) * bb)
                return call_or_check(ctx)
            t = BASE_OPEN.get(len(behind), 0.12)
            if role == "big":
                covered = sum(1 for j in behind if seats[j].stack + seats[j].committed < me_total)
                t *= 1.0 + 0.9 * covered / max(1, len(behind))
            else:
                # tighten in proportion to the pressure the players behind put on me
                bfs = [self.bf_of(j, 1.5) for j in behind] or [1.5]
                t *= max(0.5, min(1.0, 1.6 / max(bfs))) * end_tight
            if ctx.limpers:
                t *= 0.65
            if pf.pct <= t:
                size = (2.2 + ctx.limpers) * bb if not ctx.is_sb else 2.8 * bb
                return raise_to(ctx, size)
            return fold_or_check(ctx)
        j = ctx.last_raiser
        rv = seats[j]
        r_total = rv.stack + rv.committed
        r_shove = rv.all_in or rv.bet >= 0.5 * (rv.stack + rv.bet)
        bf = self.bf_of(j, 1.5)
        if r_shove:
            width = push_pct(min(r_total, me_total) / bb, 3) * (1.2 if r_total < me_total * 0.5 else 1.0)
            if ctx.n_raises >= 2:
                width *= 0.55
            width = max(0.03, min(1.0, width))
            eq = pf.eq_vs_top(width) * (0.85 if ctx.callers else 1.0)
            req = icm_required_equity(min(ctx.to_call, obs.my_stack), ctx.pot, bf) + 0.03 * ctx.n_behind
            return call_or_check(ctx) if eq >= req else fold_or_check(ctx)
        if role == "short":
            if ctx.n_raises == 1 and pf.pct <= push_pct(ctx.stack_bb, ctx.n_behind + 1) * 0.6:
                return shove(ctx)
            return fold_or_check(ctx)
        if role == "big":
            # re-steal from medium stacks that cannot afford to call
            if ctx.n_raises == 1 and r_total < me_total and bf < 1.3 and pf.pct <= 0.16 and ctx.callers == 0:
                if r_total / bb <= 30:
                    return shove(ctx)
                return raise_to(ctx, ctx.cur_bet * 3.2)
            if pf.pct <= 0.03:
                return raise_to(ctx, ctx.cur_bet * 3.0) if ctx.n_raises == 1 else shove(ctx)
            if ctx.n_raises == 1 and pf.pct <= 0.2 and ctx.to_call <= 3 * bb:
                return call_or_check(ctx)
            return fold_or_check(ctx)
        # medium
        lim3 = 0.02 if r_total >= me_total else 0.035
        if pf.pct <= lim3:
            if ctx.eff_bb <= 30:
                return shove(ctx)
            return raise_to(ctx, ctx.cur_bet * 3.0)
        if ctx.n_raises == 1 and ctx.to_call <= 2.5 * bb and pf.pct <= (0.25 if ctx.is_bb else 0.08) / bf:
            return call_or_check(ctx)
        return fold_or_check(ctx)

    # ---- postflop ---------------------------------------------------------------------
    def postflop(self, ctx, rd, role):
        obs = ctx.obs
        n_opp = max(1, ctx.n_opp)
        eq = rd.eq ** (1 + 0.35 * (n_opp - 1))
        spr = obs.my_stack / max(1, ctx.pot)
        last = ctx.street >= self.spec.num_streets - 1
        if role == "short" or spr < 1.2:
            if rd.hs >= 0.45 or (rd.outs >= 8 and not last):
                return shove(ctx)
            return call_or_check(ctx) if ctx.lg.can_check else fold_or_check(ctx)
        if ctx.lg.can_check:
            if role == "big":
                if eq >= 0.5:
                    return bet_frac(ctx, 0.6)
                if n_opp == 1 and (ctx.i_pfr or ctx.in_position) and self.rng.random() < 0.55:
                    return bet_frac(ctx, 0.5)
                return call_or_check(ctx)
            if eq >= 0.66:
                return bet_frac(ctx, 0.5)
            if ctx.i_pfr and n_opp == 1 and ctx.street == 1 and self.rng.random() < 0.35:
                return bet_frac(ctx, 0.4)
            return call_or_check(ctx)
        po = ctx.pot_odds()
        big_bet = ctx.to_call >= 0.4 * obs.my_stack
        j = ctx.last_raiser
        bf = self.bf_of(j, 1.5) if j is not None else 1.5
        if role == "big":
            if eq >= 0.8:
                return bet_frac(ctx, 0.9)
            return call_or_check(ctx) if eq >= po + 0.03 else fold_or_check(ctx)
        # medium: pot control; big bets need near-nuts
        if big_bet:
            need = icm_required_equity(ctx.to_call, ctx.pot, bf)
            return call_or_check(ctx) if rd.hs >= max(0.75, need + 0.1) else fold_or_check(ctx)
        if eq >= 0.88:
            return bet_frac(ctx, 0.8)
        return call_or_check(ctx) if eq >= po + 0.07 else fold_or_check(ctx)
