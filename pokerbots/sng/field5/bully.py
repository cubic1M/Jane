"""f5_bully: the chip leader's ICM bully. With the most chips it opens very wide when it
covers the table and attacks covered medium stacks near the bubble (they must fold under
ICM); with an average stack it plays TAG; when short it plays tight."""
from __future__ import annotations

from engine.game import Check

from .core import OPEN, Base

LEAD = dict(Base.P, open_mult=2.2, open_size=2.1, tb_value=0.05, tb_light=0.08,
            tb_light_late_only=False, call_k=0.65, cbet_freq=0.85, cbet_size=0.5,
            cbet_max_opp=2, barrel_freq=0.55, semibluff=0.6, pressure=0.10, bf_scale=0.6)
NORMAL = dict(Base.P)
SHORT = dict(Base.P, open_mult=0.7, tb_value=0.03, call_k=0.35, cbet_freq=0.5,
             barrel_freq=0.2, semibluff=0.25, pressure=0.13, bf_scale=1.4, call_icm_margin=0.05)


class BullyBot(Base):
    P = NORMAL

    def mode(self, c):
        st = [c.start[s] for s in c.alive]
        avg = sum(st) / len(st)
        me = c.my_total
        others = sorted((c.start[s] for s in c.alive if s != c.me), reverse=True)
        top_other = others[0] if others else 0
        c.avg = avg
        c.covers = me >= top_other
        c.leader = c.covers and me >= 1.2 * top_other
        c.short = me < 0.65 * avg
        c.near_bubble = c.obs.players_left <= 6 or c.obs.level >= 3
        return "lead" if c.covers and me >= 1.05 * top_other else "short" if c.short else "normal"

    def decide(self, c):
        m = self.mode(c)
        self.p = LEAD if m == "lead" else SHORT if m == "short" else NORMAL
        c.mode = m
        return super().decide(c)

    def medium_targets(self, c, seats):
        """Seats I cover whose stacks are medium (they have ICM to protect)."""
        return [s for s in seats if c.start[s] <= c.my_total and 0.45 * c.avg <= c.start[s] <= 1.5 * c.avg]

    def unopened(self, c):
        if c.mode == "lead":
            behind = c.behind()
            meds = self.medium_targets(c, behind)
            if c.near_bubble and behind and len(meds) == len(behind):
                # everybody behind is a covered medium stack: attack
                rng = min(0.85, OPEN.get(c.nb, 0.11) * 3.0)
                if c.pct <= rng:
                    eff_behind = max(c.start[s] for s in behind) / c.bb
                    if eff_behind <= 13:
                        return self.shove(c)
                    return self.raise_to(c, (2.4 + len(c.limpers)) * c.bb)
        return super().unopened(c)

    def push_fold(self, c):
        if c.mode == "lead":
            behind = c.behind()
            meds = self.medium_targets(c, behind)
            bf = 1.0 if c.leader else self.bf_behind(c)
            ev = self.push_ev(c, bf)
            if c.near_bubble and behind and len(meds) == len(behind):
                ev += 0.25 * c.pot / c.bb + 0.5          # their calling ranges are ICM-tight
            return self.shove(c) if ev > 0 else self.fold(c)
        return super().push_fold(c)

    def post_unbet(self, c, hand, e, spr):
        if c.mode == "lead" and c.lg.can_raise and e < self.p["vb_thresh"]:
            meds = self.medium_targets(c, c.opps)
            # keep the pressure on covered medium stacks
            if c.opps and len(meds) == len(c.opps) and len(c.opps) <= 2 and c.obs.street <= 2 \
                    and self.rand() < 0.55:
                return self.bet_pot(c, 0.6)
        return super().post_unbet(c, hand, e, spr)

    def pressure(self, c):
        pr = super().pressure(c)
        if c.mode == "lead":
            meds = self.medium_targets(c, c.opps)
            if meds and len(meds) == len(c.opps):
                pr += 0.04          # a medium stack betting into me means it
        return pr
