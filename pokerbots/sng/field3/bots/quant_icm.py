"""(4) The quant team: ICM push/fold below 15 big blinds (fast one-player ICM curve
recomputed between hands, Nash-flavoured caller/shover ranges, equity vs top-x
ranges), a tight standard game above it, simple disciplined postflop."""
from __future__ import annotations

from engine.game import Call, Check, Fold, RaiseTo

from ..common import F3Bot, Spot, allin, raise_to_pot_frac
from ..icm_fast import IcmCurve
from ..postflop import hand_info
from ..pushfold import call_outcomes, default_call_width, default_shove_width, push_ev

OPEN_X = {0: 0.45, 1: 0.45, 2: 0.36, 3: 0.27, 4: 0.21, 5: 0.17, 6: 0.14, 7: 0.12}


class QuantIcmBot(F3Bot):
    name = "f3_quant_icm"
    PUSH_BB = 15

    def setup(self):
        n = self.rules.num_players
        s = self.rules.starting_stack
        self.curve = IcmCurve(s, [s] * (n - 1), self.rules.payouts[:n])

    def end_hand(self, info):
        st = info["stacks"]
        my = st[self.seat]
        if my <= 0:
            return
        others = [x for j, x in enumerate(st) if j != self.seat and x > 0]
        self.curve = IcmCurve(my, others, self.rules.payouts[:len(others) + 1])

    # ---- preflop ------------------------------------------------------------------
    def decide(self, obs):
        sp = Spot(obs)
        if obs.street == 0:
            return self.preflop(obs, sp)
        return self.postflop(obs, sp)

    def _eqf(self, hole):
        pf = self.pf
        return lambda x: pf.eq_vs_top(hole, x)

    def _push_or_fold(self, obs, sp, margin=0.0):
        callers = sp.behind + [j for j in sp.opps if j not in sp.behind]
        bbj = obs.bb_seat

        def cw(j, risk_bb):
            c = default_call_width(risk_bb)
            return min(1.0, c * 1.3) if j == bbj else c
        ev = push_ev(obs, callers, self.curve, self._eqf(obs.hole), cw)
        if ev > self.curve(obs.my_stack) + margin:
            return allin(obs)
        return obs.legal.passive() if obs.legal.can_check else Fold()

    def _call_allin(self, obs, sp, width):
        e = self.pf.eq_vs_top(obs.hole, width)
        if sp.callers_after_raise:
            e = e ** (1 + 0.6 * sp.callers_after_raise)
        win, lose, fold = call_outcomes(obs, sp.last_raiser)
        U = self.curve
        return e * U(win) + (1 - e) * U(lose) > U(fold)

    def preflop(self, obs, sp):
        lg = obs.legal
        p = self.pf.pct(obs.hole)
        bb = sp.bb
        if sp.unopened:
            if sp.eff_bb <= self.PUSH_BB:
                return self._push_or_fold(obs, sp)
            x = OPEN_X.get(sp.n_behind, 0.12)
            if sp.limpers:
                x *= 0.7
            if p <= x:
                return RaiseTo(int(2.3 * bb + sp.limpers * bb))
            return Check() if lg.can_check else Fold()
        # facing a raise
        j = sp.last_raiser
        commit = sp.facing_allin or sp.to_call >= 0.35 * sp.my_total
        if commit:
            jstack = (obs.seats[j].committed) / bb
            width = default_shove_width(jstack) if sp.facing_allin else 0.08
            if sp.n_raises >= 2:
                width = min(width, 0.06)
            return Call() if self._call_allin(obs, sp, width) else Fold()
        if sp.eff_bb <= 25 and sp.n_raises == 1:
            if p <= 0.06:
                return allin(obs)
            # 3-bet jam with ICM EV: opener calls with the top fraction of his range
            def cw(k, risk_bb):
                return 0.35 if k == j else 0.5 * default_call_width(risk_bb)
            callers = sp.behind + [j]
            if p <= 0.15 and push_ev(obs, callers, self.curve, self._eqf(obs.hole), cw) > self.curve(obs.my_stack) + 0.3:
                return allin(obs)
            return Fold()
        if p <= 0.025:
            return RaiseTo(3 * sp.last_raise_to) if sp.n_raises == 1 else allin(obs)
        if p <= 0.08 and sp.n_raises == 1 and sp.to_call <= 0.08 * sp.my_total:
            return Call()
        if p <= 0.045 and sp.to_call <= 0.25 * sp.my_total:
            return Call()
        return Fold()

    # ---- postflop -------------------------------------------------------------------
    def postflop(self, obs, sp):
        hi = hand_info(obs.hole, obs.board, self.ev, self.spec)
        lv = hi.level
        if sp.to_call == 0:
            if lv >= 3 and sp.spr < 1.2:
                return allin(obs)
            if lv >= 3:
                return RaiseTo(raise_to_pot_frac(obs, 0.6))
            if sp.i_was_pf_aggressor and sp.n_opp == 1 and obs.street == 1:
                return RaiseTo(raise_to_pot_frac(obs, 0.4))
            return Check()
        bet_frac = sp.to_call / max(1, obs.pot - sp.to_call)
        if lv >= 4:
            return allin(obs) if sp.spr < 3 else RaiseTo(raise_to_pot_frac(obs, 0.8))
        if lv == 3 and bet_frac <= 1.0:
            return Call()
        if lv == 2 and bet_frac <= 0.45 and sp.n_opp == 1:
            return Call()
        if hi.outs and obs.street < len(self.spec.board_cards_per_street) - 1:
            if hi.outs * 0.021 >= sp.pot_odds:
                return Call()
        return Fold()
