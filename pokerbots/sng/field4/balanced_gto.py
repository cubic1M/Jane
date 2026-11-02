"""f4_gto -- balanced, GTO-flavoured bot (no exploitation: it keeps no reads).

* Preflop charts by position with mixed frequencies at every range boundary, one open size;
  defence against opens sized by minimum-defence frequency (pot odds), polar 3-bets
  (value + a bluff band just outside the calling range); Nash-like push/fold chart.
* Postflop it thinks in percentiles of its hand among all holdings (from the bucket
  table): value-bets above a street threshold, bluffs at the indifference ratio for its
  bet size (bluffs : value = s : 1 + s), small range c-bets on dry flops, larger sizes
  on wet boards, defends by a pot-odds-scaled percentile threshold.
"""
from __future__ import annotations

from engine.game import Call, Check, Fold

from .base import F4Bot, HU_PCT, MW_PCT, eq_vs_range, post_pct



class BalancedGto(F4Bot):
    OPEN_PCT = {"EP": 0.13, "MP": 0.15, "HJ": 0.19, "CO": 0.26, "BTN": 0.40, "SB": 0.36, "BB": 0.0}
    PUSH_10BB = {1: 0.50, 2: 0.32, 3: 0.24, 4: 0.19, 5: 0.16, 6: 0.14, 7: 0.12}
    PUSH_BB = 12.0
    VALUE_PCT = {1: 0.74, 2: 0.80, 3: 0.84}
    DEFEND_BASE = {1: 0.45, 2: 0.55, 3: 0.62}
    name = "f4_gto"
    track = False

    def mix(self, x, cut, width):
        """Play the 'in' action with probability falling linearly across cut +- width."""
        if x <= cut - width:
            return True
        if x >= cut + width:
            return False
        return self.rng.random() < (cut + width - x) / (2 * width)

    def decide(self, obs, c):
        if obs.street == 0:
            return self.preflop(obs, c)
        return self.postflop(obs, c)

    def preflop(self, obs, c):
        lg = obs.legal
        bb = c.bb
        cls = c.cls
        hp = HU_PCT[cls]
        mp = MW_PCT[cls]
        pot = obs.pot
        if c.n_raises == 0:
            if c.eff_bb <= self.PUSH_BB:
                n_b = max(1, min(7, len(c.behind) + c.limpers))
                pct = min(0.92, self.PUSH_10BB[n_b] * (10.0 / max(c.eff_bb, 2.0)) ** 0.9)
                if c.limpers:
                    pct *= 0.7
                if c.pos == "BB" and lg.can_check and hp > pct:
                    return Check()
                return self.allin(obs) if self.mix(hp, pct, 0.015) else self.passive(obs)
            pct = self.OPEN_PCT.get(c.pos, 0.13)
            if c.limpers:
                if self.mix(mp, 0.6 * pct, 0.015):
                    return self.raise_to(obs, (3.3 + c.limpers) * bb)
                return self.passive(obs)
            if self.mix(mp, pct, 0.02):
                return self.raise_to(obs, (3.0 if c.pos == "SB" else 2.3) * bb)
            return self.passive(obs)
        call = lg.call_amount
        need = call / (pot + call)
        raiser = c.last_raiser
        rs = obs.seats[raiser]
        r_tot = rs.stack + rs.bet
        if c.facing_allin or call >= 0.45 * obs.my_stack:
            depth = min(c.total, r_tot) / bb
            pct = min(0.6, 0.05 + 2.1 / max(depth, 1.0)) * (0.6 if c.n_raises > 1 else 1.0)
            if c.n_raises == 1 and not c.facing_allin:
                pct = max(pct, 0.15)
            eq = eq_vs_range(cls, pct)
            eq -= 0.08 * sum(1 for j in c.opps if j != raiser and obs.seats[j].bet >= rs.bet)
            if eq >= need + 0.035:
                return self.allin(obs) if lg.can_raise and not c.facing_allin else Call()
            return self.passive(obs)
        if c.n_raises == 1:
            if c.pos == "BB":
                d = (1 - need) * 0.62
            elif c.pos == "SB":
                d = (1 - need) * 0.35
            else:
                d = 0.14 if c.pos == "BTN" else (0.12 if c.ip else 0.08)
            if c.callers:
                d *= 0.8
            three_to = (3.0 if c.ip else 3.8) * c.last_raise_to + c.callers * c.last_raise_to
            jam = three_to >= 0.33 * c.total
            value = self.mix(mp, 0.035, 0.008)
            bluff = (d < mp <= d + 0.04) and self.rng.random() < 0.5 and c.callers == 0
            if value or (bluff and not jam):
                return self.allin(obs) if jam else self.raise_to(obs, three_to)
            if mp <= d and call <= 0.15 * c.eff:
                return Call()
            return self.passive(obs)
        if hp <= 0.025 or (hp <= 0.04 and self.rng.random() < 0.5):
            return self.allin(obs)
        if hp <= 0.06 and c.ip and call <= 0.15 * c.eff:
            return Call()
        return self.passive(obs)

    def postflop(self, obs, c):
        lg = obs.legal
        st = obs.street
        k = max(1, len(c.opps))
        made, draw, tex, _ = self.feats(obs)
        pct = post_pct(st, made, draw, tex, k)
        eq = self.street_eq(obs, c, k)
        pot = obs.pot
        wet = tex >= 4 or (tex & 1)
        r = self.rng.random()
        if c.to_call == 0:
            if not lg.can_raise:
                return Check()
            aggressor = c.pfr == obs.seat
            size = 0.7 if wet else 0.33
            if st == 3:
                size = 0.75
            vt = self.VALUE_PCT[st] if (aggressor or c.ip) else self.VALUE_PCT[st] + 0.05
            if pct >= vt:
                if not c.ip and not aggressor and pct >= 0.95 and r < 0.3:
                    return Check()           # keep strong hands in the checking range
                return self.raise_to(obs, obs.my_bet + size * pot)
            if aggressor and st == 1 and k == 1 and not wet:
                if pct >= 0.45 or r < 0.45:
                    return self.raise_to(obs, 0.33 * pot)
            ratio = size / (1 + size)
            cand = (draw >= 1) if st < 3 else (pct < 0.3)
            if cand and k <= 2 and (aggressor or c.ip):
                p = min(1.0, ratio * (1 - vt) / 0.3)
                if r < p:
                    return self.raise_to(obs, obs.my_bet + size * pot)
            return Check()
        call = c.to_call
        need = call / (pot + call)
        thr = self.DEFEND_BASE[st] + (1 - self.DEFEND_BASE[st]) * min(1.0, need * 1.25)
        thr += 0.08 * (c.bets_faced - 1) + 0.04 * (k - 1)
        if lg.can_raise:
            if pct >= 0.95 and c.bets_faced <= 2:
                return self.raise_to(obs, 3 * c.last_raise_to)
            if st == 1 and draw >= 3 and c.bets_faced == 1 and r < 0.25:
                return self.raise_to(obs, 3 * c.last_raise_to)
        if pct >= min(0.97, thr) and eq >= need - 0.05:
            return Call()
        if st < 3 and draw >= 2 and eq >= need - 0.02:
            return Call()
        return Fold()
