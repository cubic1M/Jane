"""f2_gto: "GTO-ish" tight-aggressive bot with balanced ranges and mixed strategies.

Idea of the team that wrote it: be hard to exploit. Ranges are position-based
thresholds on a hand ranking with randomized edges (mixed strategies), sizes depend
only on the situation and never on hand strength (no sizing tells), 3-bets mix value
with suited bluffs, postflop bets mix value with bluffs at roughly the ratio the bet
size implies, and facing bets it defends close to the minimum defense frequency.
Short-stacked (<= 12bb) it switches to a push/fold chart.
"""
from __future__ import annotations

from .common import (Ctx, F2Base, bet_frac, call_or_check, call_pct, fold_or_check, push_pct, raise_to,
                     shove)

RFI = {1: 0.44, 2: 0.40, 3: 0.27, 4: 0.21, 5: 0.17, 6: 0.15, 7: 0.13}


class F2Gto(F2Base):
    name = "f2_gto"

    def decide(self, obs):
        ctx = Ctx(obs)
        if obs.street == 0:
            return self.preflop(ctx, self.pf(obs))
        return self.postflop(ctx, self.read(obs))

    def mix(self, pct, t, edge=0.25):
        """Play with prob 1 below t*(1-edge), 0 above t*(1+edge), linear in between."""
        lo, hi = t * (1 - edge), t * (1 + edge)
        if pct <= lo:
            return True
        if pct >= hi:
            return False
        return self.rng.random() < (hi - pct) / (hi - lo)

    @staticmethod
    def _open_behind(obs, j):
        n = len(obs.seats)
        order = [(obs.bb_seat + 1 + i) % n for i in range(n)]
        inh = [k for k in order if obs.seats[k].in_hand]
        return max(1, len(inh) - inh.index(j) - 1) if j in inh else 3

    def _bluff_candidate(self, pf):
        return pf.suited and (pf.hi == 12 or (pf.gap <= 2 and pf.hi >= 5)) and not pf.pair

    # ---- preflop ---------------------------------------------------------------------
    def preflop(self, ctx, pf):
        obs = ctx.obs
        bb = ctx.bb
        E = ctx.eff_bb
        if E <= 12:
            return self.push_fold(ctx, pf, E)
        if ctx.n_raises == 0:
            nb = len(ctx.behind)
            if ctx.is_bb:
                if self.mix(pf.pct, 0.10):
                    return raise_to(ctx, ctx.cur_bet + (3 + ctx.limpers) * bb)
                return call_or_check(ctx)
            t = RFI.get(nb, 0.13)
            if ctx.limpers:
                t *= 0.6
            if self.mix(pf.pct, t):
                size = 3.0 * bb if ctx.is_sb else (2.5 + ctx.limpers) * bb
                return raise_to(ctx, size)
            return fold_or_check(ctx)
        j = ctx.last_raiser
        rv = obs.seats[j]
        if ctx.facing_allin or rv.bet >= 0.45 * (rv.stack + rv.bet):
            return self.vs_shove(ctx, pf, j)
        oop = not (ctx.is_btn and ctx.n_opp == 1) and (ctx.is_sb or ctx.is_bb or ctx.n_behind > 0)
        if ctx.n_raises == 1:
            t_open = RFI.get(self._open_behind(obs, j), 0.2)
            v3 = min(0.08, max(0.025, 0.22 * t_open))
            size = ctx.cur_bet * (3.8 if oop else 3.0) + ctx.callers * ctx.cur_bet
            if self.mix(pf.pct, v3, 0.15):
                return raise_to(ctx, size)
            if self._bluff_candidate(pf) and pf.pct <= 0.45 and self.rng.random() < 0.35:
                return raise_to(ctx, size)
            if ctx.is_bb and ctx.cur_bet <= 3.2 * bb:
                lim = min(0.55, t_open * 1.5 + 0.05 * ctx.callers)
            else:
                lim = min(0.25, t_open * 0.6)
            if ctx.cur_bet > 4 * bb:
                lim *= 0.6
            if self.mix(pf.pct, lim, 0.15) and ctx.to_call <= 0.15 * obs.my_stack:
                return call_or_check(ctx)
            return fold_or_check(ctx)
        if ctx.n_raises == 2:
            if self.mix(pf.pct, 0.022, 0.1):
                if E <= 45:
                    return shove(ctx)
                return raise_to(ctx, ctx.cur_bet * 2.3)
            if pf.suited and pf.hi == 12 and pf.gap >= 8 and ctx.i_pfr and self.rng.random() < 0.25:
                return raise_to(ctx, ctx.cur_bet * 2.3)       # 4-bet bluff with an ace blocker
            if pf.pct <= 0.07 and ctx.to_call <= 0.2 * obs.my_stack and (ctx.in_position or ctx.i_pfr):
                return call_or_check(ctx)
            return fold_or_check(ctx)
        if pf.pct <= 0.016:
            return shove(ctx)
        if pf.pct <= 0.025:
            return call_or_check(ctx)
        return fold_or_check(ctx)

    def push_fold(self, ctx, pf, E):
        if ctx.n_raises == 0:
            if ctx.is_bb:
                return shove(ctx) if pf.pct <= 0.25 and ctx.limpers else call_or_check(ctx)
            p = push_pct(E, max(1, len(ctx.behind) + ctx.limpers), shrink=0.7)
            return shove(ctx) if self.mix(pf.pct, p, 0.1) else fold_or_check(ctx)
        j = ctx.last_raiser
        return self.vs_shove(ctx, pf, j, short=True)

    def vs_shove(self, ctx, pf, j, short=False):
        obs = ctx.obs
        rv = obs.seats[j]
        r_bb = (rv.stack + rv.committed) / ctx.bb
        behind = self._open_behind(obs, j)
        width = push_pct(min(r_bb, ctx.stack_bb), behind, shrink=0.7)
        if ctx.n_raises >= 2:
            width *= 0.5
        width = max(0.03, min(1.0, width))
        if not (rv.all_in or rv.bet >= 0.45 * (rv.stack + rv.bet)):
            # a normal raise while I am short: re-shove top of range
            if pf.pct <= max(0.05, call_pct(ctx.stack_bb, ctx.n_behind) * 0.6):
                return shove(ctx)
            return fold_or_check(ctx)
        eq = pf.eq_vs_top(width) * (0.88 if ctx.callers else 1.0)
        req = ctx.pot_odds() + 0.02 + 0.03 * ctx.n_behind
        if eq >= req:
            return call_or_check(ctx)
        return fold_or_check(ctx)

    # ---- postflop ---------------------------------------------------------------------
    def postflop(self, ctx, rd):
        n_opp = max(1, ctx.n_opp)
        st = ctx.street
        last = st >= self.spec.num_streets - 1
        eq = rd.eq ** (1 + 0.3 * (n_opp - 1))
        if ctx.lg.can_check:
            size = (0.33 if not rd.wet else 0.66) if st == 1 else (0.66 if not last else 0.75)
            v_th = (0.62, 0.68, 0.72)[min(st, 3) - 1] + 0.05 * (n_opp - 1)
            if eq >= v_th:
                if rd.nutty and self.rng.random() < 0.2 and not last:
                    return call_or_check(ctx)              # occasional slowplay keeps checks honest
                return bet_frac(ctx, size)
            # bluffs: share of the betting range ~ size / (1 + 2 size)
            if rd.outs >= 8 and not last and self.rng.random() < 0.7 / n_opp:
                return bet_frac(ctx, size)
            if eq < 0.3:
                pb = (0.45 if ctx.i_pfr else 0.15, 0.22, 0.16)[min(st, 3) - 1] / n_opp
                if self.rng.random() < pb:
                    return bet_frac(ctx, size)
            return call_or_check(ctx)
        # facing a bet: defend close to MDF using pot odds, raise value + some draws
        to_call = ctx.to_call
        po = ctx.pot_odds()
        if eq >= 0.85:
            if self.rng.random() < 0.7:
                return bet_frac(ctx, 0.9)
            return call_or_check(ctx)
        if rd.outs >= 8 and not last and n_opp == 1 and ctx.n_raises == 1 and self.rng.random() < 0.25:
            return bet_frac(ctx, 0.9)
        need = po * 1.05 + 0.03 * (n_opp - 1) + 0.04 * (ctx.n_raises - 1)
        if last:
            need = po + 0.1
            eq = rd.hs
        if eq >= need:
            return call_or_check(ctx)
        if to_call <= 0.08 * ctx.pot:
            return call_or_check(ctx)
        return fold_or_check(ctx)
