"""f4_tag -- solid tight-aggressive with opponent reads.

* Reads per seat: fold-to-steal (blinds), fold-to-3-bet and open rate (openers),
  fold-to-c-bet, postflop aggression, shove and all-in-call rates.
* Preflop: positional open ranges widened against blinds that over-fold; value 3-bets plus
  light 3-bets against wide openers who fold to 3-bets; set-mining by stack depth;
  chip-EV push/fold under PUSH_BB from a position-aware shove chart.
* Postflop: bucket equity against k random hands, minus a range penalty scaled by the
  bettor's aggression; c-bets against high fold-to-c-bet players, value raises with
  monsters, draws called on direct + implied odds.
"""
from __future__ import annotations

from engine.game import Call, Check, Fold

from .base import F4Bot, HU_PCT, MW_PCT, eq_vs_range



def push_chart(n_behind, eff_bb):
    pct = 0.62 / (n_behind + 0.5) ** 0.85 * (10.0 / max(eff_bb, 2.0)) ** 0.8
    return min(0.9, pct)


class TagTracker(F4Bot):
    OPEN_PCT = {"EP": 0.12, "MP": 0.14, "HJ": 0.17, "CO": 0.24, "BTN": 0.34, "SB": 0.30, "BB": 0.0}
    PUSH_BB = 11.0
    VALUE3 = 0.04
    LIGHT3 = (0.08, 0.15)
    CALL_PEN = 0.14
    CALL_MARGIN = 0.05
    FLAT = 0.4              # scales the preflop flat-calling ranges (0 = 3-bet or fold)
    VALUE_EQ = 0.58
    CBET_FOLD = 0.5         # c-bet air when the caller folds to c-bets at least this often
    name = "f4_tag"

    def decide(self, obs, c):
        if obs.street == 0:
            return self.preflop(obs, c)
        return self.postflop(obs, c)

    # ---- preflop ----------------------------------------------------------------------
    def shover_range(self, j, depth_bb, reraise):
        base = min(0.6, 0.05 + 2.2 / max(depth_bb, 1.0))
        if reraise:
            base *= 0.6
        f = self.tracker.push_rate(j) / 0.25
        return min(0.85, max(0.03, base * min(2.0, max(0.5, f))))

    def preflop(self, obs, c):
        lg = obs.legal
        T = self.tracker
        bb = c.bb
        cls = c.cls
        hp = HU_PCT[cls]
        mp = MW_PCT[cls]
        if c.n_raises == 0:
            if c.eff_bb <= self.PUSH_BB:
                n_b = len(c.behind) + c.limpers
                pct = push_chart(max(1, n_b), c.eff_bb)
                if c.limpers:
                    pct *= 0.7
                if c.pos == "BB" and lg.can_check and hp > pct:
                    return Check()
                return self.allin(obs) if hp <= pct else self.passive(obs)
            pct = self.OPEN_PCT.get(c.pos, 0.12)
            if c.pos in ("CO", "BTN", "SB"):
                blinds = [j for j in c.behind if j in (obs.sb_seat, obs.bb_seat)]
                if blinds:
                    f = sum(T.fold_to_steal(j) for j in blinds) / len(blinds)
                    pct *= min(1.5, max(0.7, 1 + 1.2 * (f - 0.6)))
            if c.limpers:
                pct = 0.10
                if mp <= pct:
                    return self.raise_to(obs, (3 + c.limpers) * bb)
                if c.pos == "BB":
                    return Check()
                if mp <= 0.2 and (cls // 13 == cls % 13) and c.eff_bb > 30:
                    return Call()
                return self.passive(obs)
            if mp <= pct:
                size = 2.5 if c.eff_bb > 30 else 2.2
                return self.raise_to(obs, size * bb)
            return self.passive(obs)

        raiser = c.last_raiser
        rs = obs.seats[raiser]
        r_tot = rs.stack + rs.bet
        call = lg.call_amount
        pot = obs.pot
        need = call / (pot + call)
        allin_like = c.facing_allin or call >= 0.45 * obs.my_stack
        if allin_like:
            depth = min(c.total, r_tot) / bb
            pct = self.shover_range(raiser, depth, c.n_raises > 1)
            if c.n_raises == 1 and not c.facing_allin:
                pct = max(pct, T.open_rate(raiser) * 0.7)
            eq = eq_vs_range(cls, pct)
            others = sum(1 for j in c.opps if j != raiser and obs.seats[j].bet >= rs.bet)
            eq -= 0.08 * others
            margin = 0.04 + 0.01 * max(0, 8 - obs.players_left)
            if eq >= need + margin:
                return self.allin(obs) if lg.can_raise and not c.facing_allin else Call()
            return self.passive(obs)

        if c.n_raises == 1:
            opener_wide = T.open_rate(raiser) >= 0.28
            f3 = T.fold_to_3bet(raiser)
            three_to = (3.0 if c.ip else 3.6) * c.last_raise_to + c.callers * c.last_raise_to
            shove_mode = three_to >= 0.35 * c.total
            if hp <= self.VALUE3 or mp <= self.VALUE3:
                return self.allin(obs) if shove_mode else self.raise_to(obs, three_to)
            if opener_wide and f3 >= 0.5 and self.LIGHT3[0] <= mp <= self.LIGHT3[1] and c.callers == 0 \
                    and self.rng.random() < 0.6:
                if shove_mode:
                    if c.eff_bb <= 22 and f3 >= 0.6 and hp <= 0.2:
                        return self.allin(obs)
                else:
                    return self.raise_to(obs, three_to)
            pair = cls // 13 == cls % 13
            if pair and call <= 0.06 * c.eff * self.FLAT:
                return Call()
            call_pct = 0.10 if c.ip else 0.07
            if c.pos == "BB":
                call_pct = 0.30 if opener_wide else 0.18
                call_pct *= min(1.3, max(0.6, 2.5 * bb / max(call, 1)))
            if mp <= call_pct * self.FLAT and call <= 0.12 * c.eff:
                return Call()
            return self.passive(obs)
        # facing a 3-bet or more
        three_freq = (T.s[raiser]["three"] + 0.3) / (T.s[raiser]["three_opp"] + 3)
        jam = 0.045 if three_freq > 0.12 else 0.025
        if hp <= jam:
            return self.allin(obs)
        if hp <= 0.05 and c.ip and call <= 0.15 * c.eff:
            return Call()
        return self.passive(obs)

    # ---- postflop ----------------------------------------------------------------------
    def postflop(self, obs, c):
        lg = obs.legal
        T = self.tracker
        k = max(1, len(c.opps))
        made, draw, tex, _ = self.feats(obs)
        eq = self.street_eq(obs, c, k)
        pot = obs.pot
        st = obs.street
        if c.to_call == 0:
            if eq >= (self.VALUE_EQ + 0.13 if st == 3 else self.VALUE_EQ) and lg.can_raise:
                return self.raise_to(obs, obs.my_bet + (0.75 if st == 3 else 0.66) * pot)
            if c.pfr == obs.seat and lg.can_raise:
                if st == 1 and k <= 2:
                    fcb = sum(T.fold_to_cbet(j) for j in c.opps) / k
                    if eq >= 0.45 or (k == 1 and fcb >= self.CBET_FOLD and self.rng.random() < 0.75) or draw >= 2:
                        return self.raise_to(obs, 0.5 * pot)
                if st == 2 and k == 1 and self._i_bet_flop(obs) and (eq >= 0.5 or draw >= 2):
                    return self.raise_to(obs, 0.6 * pot)
            if k == 1 and c.ip and st < 3 and eq >= 0.5 and lg.can_raise and self.rng.random() < 0.5:
                return self.raise_to(obs, 0.5 * pot)
            return Check()
        bettor = c.last_raiser
        agg = T.aggression(bettor) if bettor >= 0 else 1.0
        pen = self.CALL_PEN * c.bets_faced + (0.05 if c.pfr == bettor else 0.0)
        if agg > 2.0:
            pen *= 0.7
        elif agg < 0.7:
            pen *= 1.4
        adj = eq - pen
        call = c.to_call
        need = call / (pot + call)
        if adj >= 0.82 and lg.can_raise:
            return self.raise_to(obs, 3 * c.last_raise_to)
        if call >= 0.5 * obs.my_stack:
            need += 0.06
        if adj >= need + self.CALL_MARGIN:
            return Call()
        if st < 3 and draw >= 2 and eq >= need - 0.05 and call <= 0.15 * c.eff:
            return Call()
        return Fold()

    def _i_bet_flop(self, obs):
        for (s, street, kind, amt) in obs.history:
            if street == 1 and s == obs.seat and kind == "raise":
                return True
        return False
