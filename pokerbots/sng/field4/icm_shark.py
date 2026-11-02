"""f4_icm -- careful ICM push/fold specialist.

* Effective stack <= PUSH_BB: every unopened decision compares the ICM value of folding
  with the ICM value of shoving, over the scenarios "all fold", and for each player
  behind "calls first and I win / lose". Calling ranges depend on the caller's risk in
  big blinds, its seat (blinds call wider) and its observed rate of calling all-ins.
* Facing an all-in (or a raise that commits me): ICM value of calling vs folding, with
  the shover's range from its observed shove rate and its depth.
* Deeper: tight positional raise-or-fold, reshove over opens when <= RESHOVE_BB, fit-or-fold
  postflop with ICM-checked stack-off decisions.
"""
from __future__ import annotations

from engine.game import Call, Check, Fold

from .base import F4Bot, HU_PCT, MW_PCT, eq_vs_range, multiway_eq
from .icmfast import equity_fast

PUSH_BB = 14.0
RESHOVE_BB = 24.0
PUSH_MARGIN = 0.02          # points: shove only if it beats folding by this much
CALL_MARGIN = 0.05
OPEN_PCT = {"EP": 0.09, "MP": 0.11, "HJ": 0.14, "CO": 0.20, "BTN": 0.30, "SB": 0.26, "BB": 0.0}
OPEN_BB = 2.2
MAX_CALLERS = 5


class IcmShark(F4Bot):
    name = "f4_icm"

    # ---- ranges -------------------------------------------------------------------------
    def call_pct(self, obs, j, risk_bb):
        base = 0.06 + 1.5 / (risk_bb + 1.0)
        if j == obs.bb_seat:
            base *= 1.3
        elif j == obs.sb_seat:
            base *= 1.1
        f = (self.tracker.call_allin(j) / 0.2) ** 0.6
        return min(0.85, max(0.03, base * min(2.2, max(0.5, f))))

    def shove_pct(self, obs, j, depth_bb, reraise):
        base = min(0.6, 0.05 + 2.0 / max(depth_bb, 1.0))
        if reraise:
            base *= 0.55
        f = (self.tracker.push_rate(j) / 0.25) ** 0.5
        return min(0.9, max(0.025, base * min(2.0, max(0.6, f))))

    # ---- ICM scenario helpers ---------------------------------------------------------
    def _base(self, obs):
        me = obs.seat
        return {s.seat: s.stack for s in obs.seats if s.in_hand and s.seat != me}

    def shove_vs_fold(self, obs, c, callers):
        """callers: [(seat, p_call, eq_when_called)] in acting order. Returns (ev_shove, ev_fold)."""
        me = obs.seat
        seats = obs.seats
        pay = [p for _, p in obs.places_paid]
        base = self._base(obs)
        ids = sorted(base)
        P = obs.pot
        my_tot = obs.my_stack + obs.my_bet
        mes, oth, probs = [], [], []
        # fold: the pot goes to the last raiser, else the big blind
        winner = c.last_raiser if c.last_raiser >= 0 else obs.bb_seat
        o = dict(base)
        if winner in o:
            o[winner] += P
        mes.append(obs.my_stack)
        oth.append([o[i] for i in ids])
        # everyone folds to my shove
        mes.append(obs.my_stack + P)
        oth.append([base[i] for i in ids])
        if len(callers) > MAX_CALLERS:
            callers = sorted(callers, key=lambda x: -x[1])[:MAX_CALLERS]
            callers.sort(key=lambda x: c.order.index(x[0]) if x[0] in c.order else 0)
        p_none = 1.0
        for j, pc, eq in callers:
            sj = seats[j].stack
            tj = sj + seats[j].bet
            total = P + obs.my_stack + sj
            my_ex = max(0, my_tot - tj)
            j_ex = max(0, tj - my_tot)
            main = total - my_ex - j_ex
            o = dict(base)
            o[j] = j_ex
            mes.append(main + my_ex)
            oth.append([o[i] for i in ids])
            o = dict(base)
            o[j] = main + j_ex
            mes.append(my_ex)
            oth.append([o[i] for i in ids])
            probs.append(p_none * pc)
            p_none *= 1.0 - pc
        v = equity_fast(mes, oth, pay)
        ev = p_none * v[1]
        for k, (j, pc, eq) in enumerate(callers):
            ev += probs[k] * (eq * v[2 + 2 * k] + (1 - eq) * v[3 + 2 * k])
        return ev, v[0]

    def call_vs_fold(self, obs, c, eq):
        """ICM value of calling the current bet (all-in sized) vs folding."""
        me = obs.seat
        seats = obs.seats
        pay = [p for _, p in obs.places_paid]
        base = self._base(obs)
        ids = sorted(base)
        A = min(obs.legal.call_amount, obs.my_stack)
        my_c = seats[me].committed + A
        # main aggressor = the opponent with the largest bet this street
        agg = max(c.opps, key=lambda j: seats[j].bet)
        won = my_c
        refunds = {}
        for j in range(len(seats)):
            if j == me or seats[j].committed == 0:
                continue
            cj = seats[j].committed
            won += min(cj, my_c)
            if not seats[j].folded and cj > my_c:
                refunds[j] = cj - my_c
        o_f = dict(base)
        if agg in o_f:
            o_f[agg] += obs.pot
        o_w = dict(base)
        for j, r in refunds.items():
            o_w[j] += r
        o_l = dict(base)
        for j, r in refunds.items():
            o_l[j] += r
        o_l[agg] += won
        mes = [obs.my_stack, obs.my_stack - A + won, obs.my_stack - A]
        oth = [[o_f[i] for i in ids], [o_w[i] for i in ids], [o_l[i] for i in ids]]
        v = equity_fast(mes, oth, pay)
        return eq * v[1] + (1 - eq) * v[2], v[0]

    # ---- decisions --------------------------------------------------------------------
    def decide(self, obs, c):
        lg = obs.legal
        if obs.street == 0:
            return self.preflop(obs, c)
        return self.postflop(obs, c)

    def preflop(self, obs, c):
        lg = obs.legal
        bb = c.bb
        cls = c.cls
        if c.n_raises == 0:
            if c.eff_bb <= PUSH_BB and lg.can_raise:
                callers = []
                limp = {s for (s, k, a) in c.acts if k == "call"}
                seq = c.behind + [j for j in c.order if j in limp and j in c.live_opps]
                for j in seq:
                    risk = min(c.total, obs.seats[j].stack + obs.seats[j].bet) / bb
                    pc = self.call_pct(obs, j, risk)
                    if j in limp:
                        pc = min(0.85, pc * 1.4)
                    callers.append((j, pc, eq_vs_range(cls, pc)))
                if HU_PCT[cls] > 0.75 and c.eff_bb > 6:
                    return self.passive(obs)
                ev_s, ev_f = self.shove_vs_fold(obs, c, callers)
                if ev_s > ev_f + PUSH_MARGIN:
                    return self.allin(obs)
                return self.passive(obs)
            pct = OPEN_PCT.get(c.pos, 0.1)
            if c.limpers:
                pct = 0.08
            if MW_PCT[cls] <= pct and lg.can_raise:
                return self.raise_to(obs, (OPEN_BB + c.limpers) * bb)
            return self.passive(obs)
        # facing a raise
        raiser = c.last_raiser
        rt = obs.seats[raiser]
        raiser_tot = rt.stack + rt.bet
        call_amt = lg.call_amount
        commits = call_amt >= 0.4 * obs.my_stack or c.facing_allin or raiser_tot <= 1.3 * c.last_raise_to
        if commits:
            depth = min(c.total, raiser_tot) / bb
            pct = self.shove_pct(obs, raiser, depth, c.n_raises > 1 or c.limpers > 0)
            if c.n_raises == 1 and not c.facing_allin and raiser_tot > 1.5 * c.last_raise_to:
                pct = min(0.9, self.tracker.open_rate(raiser) * 0.8)
            eqs = [eq_vs_range(cls, pct)]
            for j in c.opps:
                if j != raiser and obs.seats[j].bet >= rt.bet:
                    eqs.append(eq_vs_range(cls, pct * 0.6))
            eq = multiway_eq(eqs)
            ev_c, ev_f = self.call_vs_fold(obs, c, eq)
            if ev_c > ev_f + CALL_MARGIN:
                return self.allin(obs) if lg.can_raise and not c.facing_allin and c.eff_bb <= RESHOVE_BB else Call()
            return self.passive(obs)
        if c.n_raises == 1 and c.eff_bb <= RESHOVE_BB and lg.can_raise:
            open_pct = self.tracker.open_rate(raiser)
            open_pct = min(0.7, max(0.06, open_pct))
            callers = [(raiser, 0.45, eq_vs_range(cls, open_pct * 0.45))]
            for j in c.behind:
                risk = min(c.total, obs.seats[j].stack + obs.seats[j].bet) / bb
                pc = self.call_pct(obs, j, risk) * 0.5
                callers.append((j, pc, eq_vs_range(cls, pc)))
            if HU_PCT[cls] <= 0.30:
                ev_s, ev_f = self.shove_vs_fold(obs, c, callers)
                if ev_s > ev_f + PUSH_MARGIN:
                    return self.allin(obs)
            if c.pos == "BB" and HU_PCT[cls] <= 0.25 and call_amt <= 1.5 * bb:
                return Call()
            return self.passive(obs)
        # deep: 3-bet premiums, call pairs / strong broadways cheaply, else fold
        if HU_PCT[cls] <= 0.025 and lg.can_raise:
            return self.raise_to(obs, 3 * c.last_raise_to)
        if c.n_raises >= 2:
            if HU_PCT[cls] <= 0.045:
                return self.allin(obs)
            return self.passive(obs)
        hi_pair = cls // 13 == cls % 13
        if call_amt <= 0.08 * c.eff and (hi_pair or MW_PCT[cls] <= 0.07):
            return Call()
        if c.pos == "BB" and call_amt <= 1.6 * bb and MW_PCT[cls] <= 0.3:
            return Call()
        return self.passive(obs)

    def postflop(self, obs, c):
        lg = obs.legal
        k = max(1, len(c.opps))
        made, draw, tex, _ = self.feats(obs)
        eq = self.street_eq(obs, c, k)
        pot = obs.pot
        if c.to_call == 0:
            if eq >= 0.62 and lg.can_raise:
                return self.raise_to(obs, obs.my_bet + 0.6 * pot)
            if obs.street == 1 and c.pfr == obs.seat and k == 1 and lg.can_raise and (
                    eq >= 0.38 or self.rng.random() < 0.5):
                return self.raise_to(obs, 0.45 * pot)
            return Check()
        call = c.to_call
        adj = eq - 0.10 * c.bets_faced - (0.04 if c.pfr not in (-1, obs.seat) else 0.0)
        if obs.street == 3:
            adj -= 0.03
        need = call / (pot + call)
        if adj >= 0.80 and lg.can_raise:
            return self.raise_to(obs, c.last_raise_to * 3)
        if call >= 0.4 * obs.my_stack:
            ev_c, ev_f = self.call_vs_fold(obs, c, max(0.0, adj))
            return Call() if ev_c > ev_f + CALL_MARGIN else Fold()
        if adj >= need + 0.04:
            return Call()
        if draw >= 2 and obs.street < 3 and call <= 0.12 * c.eff and eq >= need:
            return Call()
        return Fold()
