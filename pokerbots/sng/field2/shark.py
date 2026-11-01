"""f2_shark: my own best idea for this format: survive deep, then win the push/fold game.

Reasoning: with 8 bots, 100/65/45/30/20/12/6/0 points and blinds that reach 40+% of the
average stack late, the table is decided by (a) not busting early in big marginal pots
against other strong bots, and (b) playing the <= 15bb phase better than the field:
shoving with real fold equity and calling shoves only when ICM says so. So:
  * deep: tight-aggressive, small opens, value-heavy postflop, thin value vs stations,
    call-downs vs maniacs, quick folds vs tight aggression in big pots;
  * <= 15bb unopened: shove by an EV model, not a chart: P(everyone folds) from each
    player's calling width (Nash call width for his stack, widened by his observed
    VPIP), equity vs that width, losses weighted by the bubble factor vs each caller;
  * 13-25bb vs an open: re-shove with the same fold-equity model;
  * vs shoves: shover's range blended from his observed shove rate and a Nash width,
    ICM-required equity from the bubble factor vs that seat;
  * heads-up: the heads-up chart, wider.
"""
from __future__ import annotations

from .common import (Ctx, F2Base, bet_frac, call_or_check, call_pct, fold_or_check, icm_required_equity,
                     push_pct, raise_to, shove)

RFI = {1: 0.40, 2: 0.33, 3: 0.23, 4: 0.17, 5: 0.14, 6: 0.12, 7: 0.11}


def clip(x, lo, hi):
    return lo if x < lo else hi if x > hi else x


class F2Shark(F2Base):
    name = "f2_shark"
    use_icm = True
    use_stats = True

    def decide(self, obs):
        ctx = Ctx(obs)
        if obs.street == 0:
            return self.preflop(ctx, self.pf(obs))
        return self.postflop(ctx, self.read(obs))

    # ---- model -------------------------------------------------------------------------
    def loose(self, j):
        return clip((self.stats.vpip_rate(j) / 0.24) ** 0.5, 0.6, 1.8)

    def kind(self, j):
        s = self.stats
        v, p, af = s.vpip_rate(j), s.pfr_rate(j), s.af(j)
        if s.hands[j] < 12:
            return "unknown"
        if v >= 0.4 and af < 1.5:
            return "station"
        if af >= 2.8 or p >= 0.32:
            return "maniac"
        if v <= 0.16:
            return "nit"
        return "reg"

    def call_width(self, obs, j, risk_chips, n_after):
        st = obs.seats[j]
        e = min(risk_chips, st.stack + st.bet) / max(1, obs.big_blind)
        return clip(call_pct(max(1.0, e), n_after) * self.loose(j), 0.02, 0.95)

    def shove_ev(self, ctx, pf, players):
        """Chip EV (ICM-weighted losses) of shoving now vs folding, against `players`."""
        obs = ctx.obs
        risk = obs.my_stack
        dead = ctx.pot
        p_fold = 1.0
        widths = []
        for k, j in enumerate(players):
            w = self.call_width(obs, j, obs.my_stack + obs.my_bet, len(players) - k - 1)
            widths.append(w)
            p_fold *= 1 - w
        if not widths:
            return dead
        w_avg = sum(widths) / len(widths)
        eq = pf.eq_vs_top(min(1.0, w_avg))
        bf = max(self.bf_of(j, 1.4) for j in players)
        bf = 1.0 + (bf - 1.0) * 0.8
        call_win = dead + min(risk, max(obs.seats[j].stack for j in players))
        ev_called = eq * call_win - bf * (1 - eq) * min(risk, max(obs.seats[j].stack + obs.seats[j].bet for j in players))
        return p_fold * dead + (1 - p_fold) * ev_called

    def shove_width(self, obs, j, ctx):
        s = self.stats
        rv = obs.seats[j]
        r_bb = (rv.stack + rv.committed) / max(1, obs.big_blind)
        his_behind = self._behind_at(obs, j)
        w_nash = push_pct(min(r_bb, ctx.stack_bb), his_behind)
        w_obs = clip(s.shove_rate(j) * 2.5 + 0.03, 0.03, 0.95)
        k = min(0.7, s.hands[j] / 60.0)
        w = k * w_obs + (1 - k) * w_nash
        if ctx.n_raises >= 2:
            w *= 0.55
        return clip(w, 0.025, 1.0)

    @staticmethod
    def _behind_at(obs, j):
        n = len(obs.seats)
        order = [(obs.bb_seat + 1 + i) % n for i in range(n)]
        inh = [k for k in order if obs.seats[k].in_hand]
        return max(1, len(inh) - inh.index(j) - 1) if j in inh else 2

    # ---- preflop ---------------------------------------------------------------------
    def preflop(self, ctx, pf):
        obs = ctx.obs
        bb = ctx.bb
        seats = obs.seats
        hu = obs.players_left == 2
        E = ctx.eff_bb
        if ctx.n_raises == 0:
            behind = ctx.behind
            if ctx.is_bb:
                if E <= 15 and pf.pct <= 0.3 and ctx.limpers:
                    return shove(ctx)
                if pf.pct <= 0.09 or (hu and pf.pct <= 0.25):
                    return raise_to(ctx, ctx.cur_bet + (3 + ctx.limpers) * bb)
                return call_or_check(ctx)
            if E <= 15 or (hu and E <= 18):
                ev = self.shove_ev(ctx, pf, behind)
                if ev > 0.04 * obs.my_stack or pf.pct <= 0.03:
                    return shove(ctx)
                return fold_or_check(ctx)
            t = RFI.get(len(behind), 0.11)
            if hu:
                t = 0.7
            blinds = [j for j in behind if j in (obs.sb_seat, obs.bb_seat)]
            if blinds and len(behind) <= 3:
                t *= clip(1.6 - sum(self.loose(j) for j in blinds) / len(blinds) * 0.6, 0.8, 1.4)
            if ctx.limpers:
                t *= 0.55
            if pf.pct <= t:
                size = (2.2 + ctx.limpers) * bb if not ctx.is_sb else 2.7 * bb
                return raise_to(ctx, size)
            if ctx.is_sb and ctx.to_call <= 0.5 * bb and pf.pct <= 0.5 and E >= 30 and len(behind) == 1:
                return call_or_check(ctx)
            return fold_or_check(ctx)
        j = ctx.last_raiser
        rv = seats[j]
        r_shove = rv.all_in or rv.bet >= 0.5 * (rv.stack + rv.bet)
        risk = min(ctx.to_call, obs.my_stack)
        if r_shove:
            w = self.shove_width(obs, j, ctx)
            eq = pf.eq_vs_top(w) * (0.86 if ctx.callers else 1.0)
            req = icm_required_equity(risk, ctx.pot, self.bf_of(j, 1.4)) + 0.025 * ctx.n_behind
            if hu:
                req = ctx.pot_odds()
            if eq >= req:
                return shove(ctx) if ctx.n_behind and pf.pct <= 0.03 else call_or_check(ctx)
            return fold_or_check(ctx)
        k = self.kind(j)
        open_w = clip(self.stats.pfr_rate(j) * 1.25, 0.05, 0.8) if ctx.n_raises == 1 else 0.07
        if hu:
            open_w = max(open_w, 0.5)
        # re-shove zone
        if E <= 25 and ctx.n_raises == 1:
            players = [j] + [x for x in ctx.behind if x != j]
            # vs a raise the raiser calls with the top of his opening range
            p_fold = 1.0
            for x in players:
                if x == j:
                    w = clip(open_w * 0.45, 0.02, 0.6)
                else:
                    w = self.call_width(obs, x, obs.my_stack + obs.my_bet, 0) * 0.7
                p_fold *= 1 - w
            eq = pf.eq_vs_top(clip(open_w * 0.45, 0.02, 0.6))
            bf = 1.0 + (self.bf_of(j, 1.4) - 1.0) * 0.8
            call_risk = obs.my_stack + obs.my_bet
            ev = p_fold * ctx.pot + (1 - p_fold) * (eq * (ctx.pot + call_risk) - bf * (1 - eq) * call_risk)
            if ev > 0.05 * call_risk or pf.pct <= 0.025:
                return shove(ctx)
            if ctx.is_bb and ctx.to_call <= 1.5 * bb and pf.pct <= 0.3 and E >= 15:
                return call_or_check(ctx)
            return fold_or_check(ctx)
        eq = pf.eq_vs_top(open_w)
        if ctx.n_raises == 1:
            v = 0.035 if k not in ("maniac",) else 0.09
            if pf.pct <= v or (k == "maniac" and eq >= 0.6):
                return raise_to(ctx, ctx.cur_bet * (3.0 if ctx.in_position or ctx.is_btn else 3.6)
                                + ctx.callers * ctx.cur_bet)
            price_ok = ctx.to_call <= 0.06 * obs.my_stack
            if pf.pair and E >= 45 and price_ok:
                return call_or_check(ctx)                          # set mining
            if ctx.is_bb and ctx.cur_bet <= 3 * bb and pf.pct <= 0.32:
                return call_or_check(ctx)
            if pf.pct <= 0.09 and ctx.to_call <= 0.1 * obs.my_stack:
                return call_or_check(ctx)
            return fold_or_check(ctx)
        # 3-bet or more
        if pf.pct <= 0.018 or (k == "maniac" and pf.pct <= 0.045):
            return shove(ctx)
        if pf.pct <= 0.04 and ctx.to_call <= 0.15 * obs.my_stack and E >= 60:
            return call_or_check(ctx)
        return fold_or_check(ctx)

    # ---- postflop ---------------------------------------------------------------------
    def postflop(self, ctx, rd):
        obs = ctx.obs
        n_opp = max(1, ctx.n_opp)
        eq = rd.eq ** (1 + 0.4 * (n_opp - 1))
        last = ctx.street >= self.spec.num_streets - 1
        spr = obs.my_stack / max(1, ctx.pot)
        kinds = [self.kind(j) for j in ctx.opps]
        if ctx.lg.can_check:
            stationy = "station" in kinds
            v_th = (0.55 if stationy else 0.62) + 0.05 * (n_opp - 1)
            if eq >= v_th:
                if spr < 1.3 and eq >= 0.7:
                    return shove(ctx)
                return bet_frac(ctx, 0.7 if stationy else 0.55)
            if stationy or n_opp > 2:
                return call_or_check(ctx)
            fc = sum(self.stats.fold_cbet(j) for j in ctx.opps) / n_opp
            if ctx.i_pfr and ctx.street == 1 and self.rng.random() < fc * (1.1 if not rd.wet else 0.8) / n_opp:
                return bet_frac(ctx, 0.4)
            if rd.outs >= 9 and not last and n_opp == 1 and self.rng.random() < 0.5:
                return bet_frac(ctx, 0.55)
            return call_or_check(ctx)
        villain = ctx.last_raiser
        k = self.kind(villain) if villain is not None else "unknown"
        adj = {"maniac": 0.08, "station": -0.03, "nit": -0.12, "reg": -0.02, "unknown": -0.03}[k]
        if ctx.n_raises >= 2:
            adj -= 0.1
        big = ctx.to_call >= 0.35 * (obs.my_stack + obs.my_bet)
        eq_eff = eq + adj
        po = ctx.pot_odds()
        if eq >= 0.86 or (spr < 1.0 and eq >= 0.6):
            if k == "maniac" and not last and not big and self.rng.random() < 0.5:
                return call_or_check(ctx)
            return bet_frac(ctx, 0.9)
        if big:
            bf = self.bf_of(villain, 1.4) if villain is not None else 1.4
            need = icm_required_equity(ctx.to_call, ctx.pot, bf) * 0.9
            if eq_eff >= need and rd.hs >= 0.6:
                return call_or_check(ctx)
            return fold_or_check(ctx)
        if eq_eff >= po + 0.04:
            return call_or_check(ctx)
        return fold_or_check(ctx)
