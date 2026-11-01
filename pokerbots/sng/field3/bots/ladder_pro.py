"""(8) What I would expect a winning team to build in 60 minutes: an ICM-aware
aggressor. Cheap min-raise steals deep (wider when the players behind fold a lot),
ICM push/fold and re-jams up to ~18-30 big blinds with caller ranges blended from
defaults and observed behaviour, ICM call-offs vs the shover's estimated range, and
a small Monte Carlo equity postflop, shaded for the strength that betting shows."""
from __future__ import annotations

from engine.game import Call, Check, Fold, RaiseTo

from ..common import F3Bot, OppStats, Spot, allin, raise_to_pot_frac
from ..icm_fast import IcmCurve
from ..postflop import mc_equity, mc_samples
from ..pushfold import call_outcomes, default_call_width, default_shove_width, push_ev

OPEN = {0: 0.50, 1: 0.50, 2: 0.40, 3: 0.30, 4: 0.23, 5: 0.19, 6: 0.16, 7: 0.14}


class LadderProBot(F3Bot):
    name = "f3_ladder_pro"
    MC_N = 40

    def setup(self):
        n = self.rules.num_players
        s = self.rules.starting_stack
        self.stats = OppStats(self.rules, self.seat)
        self.curve = IcmCurve(s, [s] * (n - 1), self.rules.payouts[:n])

    def end_hand(self, info):
        self.stats.update(info, self.pf)
        st = info["stacks"]
        my = st[self.seat]
        if my > 0:
            others = [x for j, x in enumerate(st) if j != self.seat and x > 0]
            self.curve = IcmCurve(my, others, self.rules.payouts[:len(others) + 1])

    def _fold_prob(self, j):
        return min(0.97, max(0.3, self.stats.rate(self.stats.faced_fold[j], self.stats.faced[j], 0.8, 6)))

    def _cw(self, j, risk_bb, bb_seat):
        c = default_call_width(risk_bb)
        st = self.stats
        if st.faced_shove[j] >= 3:
            c = 0.6 * c + 0.4 * st.call_shove_rate(j)
        if j == bb_seat:
            c *= 1.25
        return min(1.0, max(0.02, c))

    def decide(self, obs):
        sp = Spot(obs)
        if obs.street == 0:
            return self.preflop(obs, sp)
        return self.postflop(obs, sp)

    def preflop(self, obs, sp):
        lg = obs.legal
        pf = self.pf
        hole = obs.hole
        p = pf.pct(hole)
        bb = sp.bb
        U = self.curve
        if sp.unopened:
            if sp.eff_bb <= 18:
                callers = sp.behind + [j for j in sp.opps if j not in sp.behind]
                ev = push_ev(obs, callers, U, lambda x: pf.eq_vs_top(hole, x),
                             lambda j, r: self._cw(j, r, obs.bb_seat))
                if ev > U(obs.my_stack):
                    return allin(obs)
                return Check() if lg.can_check else Fold()
            pfold = 1.0
            for j in sp.behind:
                pfold *= self._fold_prob(j)
            x = OPEN.get(sp.n_behind, 0.14)
            if sp.limpers:
                x *= 0.6
            elif pfold >= 0.55:
                x = max(x, 0.55)
            elif pfold >= 0.4:
                x = max(x, 0.35)
            if p <= x:
                size = (2.5 if p <= 0.04 else 2.0) * bb + sp.limpers * bb
                return RaiseTo(int(size))
            return Check() if lg.can_check else Fold()
        j = sp.last_raiser
        js = obs.seats[j]
        st = self.stats
        if sp.facing_allin or sp.to_call >= 0.35 * sp.my_total:
            opened = sp.n_raises == 1
            prior = default_shove_width(js.committed / bb) if opened else 0.06
            obs_r = st.shove_rate(j) if opened else st.rate(st.pfr[j], st.hands[j], 0.1)
            width = max(0.03, 0.6 * prior + 0.4 * obs_r * 1.15)
            if len(st.shown_pct[j]) >= 2:
                width = max(width, max(st.shown_pct[j]) * 0.9)
            e = pf.eq_vs_top(hole, min(1.0, width))
            if sp.callers_after_raise:
                e = e ** (1 + 0.6 * sp.callers_after_raise)
            win, lose, fold = call_outcomes(obs, j)
            return Call() if e * U(win) + (1 - e) * U(lose) > U(fold) else Fold()
        o = min(0.7, max(0.05, st.open_rate(j)))
        if sp.n_raises >= 2:
            o = min(o, 0.06)
        if sp.eff_bb <= 30:
            fj = self._fold_prob(j)

            def cw(k, r):
                if k == j:
                    return min(1.0, max(0.12, 1 - fj if st.faced[j] >= 4 else 0.35))
                return 0.5 * self._cw(k, r, obs.bb_seat)
            ev = push_ev(obs, sp.behind + [j], U, lambda x: pf.eq_vs_top(hole, max(0.02, x * o)), cw)
            if p <= 0.04 or (p <= 0.35 and ev > U(obs.my_stack) + 0.15):
                return allin(obs)
            if p <= 0.10 and sp.to_call <= 0.05 * sp.my_total and sp.n_behind <= 2:
                return Call()
            return Fold()
        if p <= max(0.03, 0.2 * o):
            return RaiseTo(int(3 * sp.last_raise_to)) if sp.n_raises == 1 else allin(obs)
        pair = len(hole) == 2 and (hole[0] >> 2) == (hole[1] >> 2)
        implied = sp.eff - sp.to_call >= 15 * sp.to_call
        if (p <= max(0.08, 0.4 * o) or (pair and implied)) and sp.to_call <= 0.06 * sp.my_total:
            return Call()
        return Fold()

    def postflop(self, obs, sp):
        n_opp = min(sp.n_opp, 2)
        eq = mc_equity(obs.hole, obs.board, n_opp, mc_samples(self.spec, self.MC_N), self.nrng,
                       self.spec, self.ev)
        if sp.n_opp > 2:
            eq *= 0.8 ** (sp.n_opp - 2)
        if sp.to_call == 0:
            if eq > 0.62:
                if sp.spr < 1.3:
                    return allin(obs)
                return RaiseTo(raise_to_pot_frac(obs, 0.6))
            if sp.n_opp == 1 and sp.i_was_pf_aggressor and obs.street == 1:
                return RaiseTo(raise_to_pot_frac(obs, 0.33))
            if sp.n_opp == 1 and sp.in_position and eq > 0.45 and self.rng.random() < 0.5:
                return RaiseTo(raise_to_pot_frac(obs, 0.45))
            return Check()
        bet_frac = sp.to_call / max(1, obs.pot - sp.to_call)
        adj = eq - (0.06 + 0.08 * min(1.0, bet_frac)) - 0.04 * (sp.n_raises - 1)
        if adj >= 0.72 and obs.legal.can_raise:
            return allin(obs) if sp.spr < 3 else RaiseTo(raise_to_pot_frac(obs, 0.8))
        if adj >= sp.pot_odds:
            return Call()
        return Fold()
