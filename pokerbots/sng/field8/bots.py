"""The five field8 bots (shared machinery in base.py, offline tables in data/).

  f8_nash      ICM push/fold equilibrium at <= 15 units: the table's (mixed) strategy looked up
               by players behind, effective stack and both sides' bubble factors from the real
               payout table; calls all-ins by ICM expected points against the equilibrium
               shoving ranges; a position-chart TAG with ICM-scaled calling above.
  f8_solver    preflop from the simplified preflop equilibrium (open / 3-bet / call / 4-bet by
               players behind, responder seat and depth, cut to the strongest part of each range
               by the ICM premium), postflop ranges read from the same tables, pot-geometry bet
               sizing and size-balanced river bluffs.
  f8_adaptive  a regular that models every seat (VPIP, PFR, opens, 3-bets, fold to 3-bet, c-bet,
               fold to c-bet, fold to bets, aggression, showdowns, open-shoves and calls of
               shoves against what the equilibrium expects in the same spots), shrunk to priors,
               and moves its thresholds smoothly; shoves by ICM EV against observed callers.
  f8_endgame   ICM-pressure specialist: per-caller ICM reads for its best-response shoves, harder
               big-stack aggression when covering everyone behind, a bigger margin before
               calling a covering all-in, the solver's heads-up ranges and heads-up postflop
               aggression.
  f8_ensemble  the best measured combination: nash's equilibrium push/fold (its caller input
               moved by observed calling), chart preflop, mild opponent modelling and the
               endgame logic (with the solver's heads-up ranges).
"""
from __future__ import annotations

from sng.field8 import tables as T
from sng.field8.base import Base, clip


# ------------------------------------------------------------------------------ helpers
def opener_nb(c, j):
    """Players behind seat j preflop (heads-up: 0 for the button)."""
    if c.players == 2:
        return 0 if j == c.obs.sb_seat else 1
    return len(c.order) - 1 - c.pidx.get(j, 0)


def resp_index(c, opener, me):
    if c.players == 2:
        return 0
    return max(0, c.pidx.get(me, 0) - c.pidx.get(opener, 0) - 1)


# ------------------------------------------------------------------------------ 1. nash
class Nash(Base):
    name = "f8_nash"
    DEFAULTS = dict(Base.DEFAULTS, pf_max=15.0, pure_table=True)


# ------------------------------------------------------------------------------ 2. solver
class SolverPre:
    """Preflop from the simplified equilibrium tables (data/pre8.npz)."""

    SV_MIN = 12.0

    def open_decision(self, c, S, beh):
        nb = 0 if c.players == 2 else max(1, c.nb)
        h = c.h
        p = T.sv_open(nb, S, h)
        m = self.open_factor(c, beh)
        if m != 1.0:
            w = T.sv_open_width(nb, S)
            if m > 1.0 and c.pct <= w * m:
                p = max(p, min(1.0, (m - 1.0) * 2.5))
            elif m < 1.0 and c.pct > w * m:
                p *= 0.25
        if p >= 0.999 or (p > 0.001 and self.rand() < p):
            size = T.sv_open_size(nb, S)
            return self.raise_to(c, size * c.bb)
        return self.fold(c)

    def opp_open_width(self, c, j, nbj, S):
        return T.sv_open_width(nbj, max(12.0, S))

    def vs_open(self, c):
        opener, amt = c.pre_raises[0]
        eff = min(c.total, c.stacks[opener] + c.bets[opener])
        S = c.s_units(eff)
        c.S = S
        if S < self.SV_MIN or c.limpers:
            return super().vs_open(c)
        h = c.h
        nb_o = opener_nb(c, opener)
        k = resp_index(c, opener, c.me)
        rb = T.sv("rb", nb_o, S, k, h)
        rc = T.sv("rc", nb_o, S, k, h)
        model_o = T.sv_open_size(nb_o, S) * c.bb
        if amt > 1.6 * model_o:                 # a big open is a stronger range: continue less
            rc *= 0.55 if c.pct > 0.06 else 1.0
            rb = rb if c.pct <= 0.05 else rb * 0.4
        if c.cold_callers:                       # squeeze for value, call tighter
            rb = rb if c.pct <= 0.05 else rb * 0.35
            rc = rc * 0.6 if c.pct > 0.12 else rc
        # ICM: continue with the strongest part of the table's continuing range only
        bf = self.rf(c, opener, 3.0 * c.to_call)
        if bf > 1.02:
            keep = (T.sv_width("rb", nb_o, S, k) + T.sv_width("rc", nb_o, S, k)) / bf ** 1.5
            if c.pct > keep:
                rb *= 0.25
                rc *= 0.25
        rb, rc = self.adjust_vs_open(c, opener, rb, rc)
        x = self.rand()
        if x < rb:
            ts = T.SV_TSZ[nb_o, T._near(T.SV_S, S), min(k, 6)]
            t = amt * float(ts) / max(1.0, T.sv_open_size(nb_o, S))
            if float(ts) >= 0.95 * T.SV_S[T._near(T.SV_S, S)] or t >= 0.38 * c.total:
                return self.shove(c)
            return self.raise_to(c, t + amt * len(c.cold_callers))
        if x < rb + rc:
            return self.call_or_shove(c)
        return self.fold(c)

    def adjust_vs_open(self, c, opener, rb, rc):
        return rb, rc

    def call_or_shove(self, c):
        from engine.game import Call
        if c.to_call >= 0.4 * c.total:
            return self.shove(c)
        return Call()

    def vs_3bet(self, c):
        raiser, amt = c.pre_raises[-1]
        eff = min(c.total, c.stacks[raiser] + c.bets[raiser])
        S = c.s_units(eff)
        my_open = c.pre_raises[0][0] == c.me
        if S < self.SV_MIN or not my_open or c.cold_callers:
            return super().vs_3bet(c)
        h = c.h
        nb_o = opener_nb(c, c.me)
        k = resp_index(c, c.me, raiser)
        oc = T.sv("oc", nb_o, S, k, h)
        o4 = T.sv("o4", nb_o, S, k, h)
        bf = self.rf(c, raiser, 2.5 * c.to_call)
        if bf > 1.02:
            keep = (T.sv_width("oc_all", nb_o, S, k) + T.sv_width("o4_all", nb_o, S, k)) / bf ** 1.5
            if c.pct > keep:
                oc *= 0.25
                o4 *= 0.25
        x = self.rand()
        if x < o4:
            return self.shove(c)
        if x < o4 + oc:
            return self.call_or_shove(c)
        return self.fold(c)

    def vs_4bet(self, c):
        raiser, amt = c.pre_raises[-1]
        eff = min(c.total, c.stacks[raiser] + c.bets[raiser])
        S = c.s_units(eff)
        if S < self.SV_MIN or len(c.pre_raises) != 3:
            return super().vs_4bet(c)
        opener = c.pre_raises[0][0]
        nb_o = opener_nb(c, opener)
        k = resp_index(c, opener, c.me)
        p = T.sv("r4c", nb_o, S, k, c.h)
        if p >= 0.5 or (p > 0.05 and self.rand() < p):
            return self.shove(c) if c.lg.can_raise else self.call_or_shove(c)
        return self.fold(c)

    def range_width(self, c, j):
        rs = c.pre_raises
        if not rs:
            return super().range_width(c, j)
        opener = rs[0][0]
        nb_o = opener_nb(c, opener)
        S = max(12.0, c.s_units(min(c.start[opener], c.start[j])))
        if len(rs) == 1:
            if j == opener:
                return T.sv_open_width(nb_o, S)
            k = resp_index(c, opener, j)
            w = T.sv_width("rc", nb_o, S, k)
            return clip(w, 0.06, 0.7)
        if len(rs) == 2:
            three = rs[1][0]
            if j == three:
                k = resp_index(c, opener, j)
                return clip(T.sv_width("rb", nb_o, S, k) * 0.9, 0.03, 0.3)
            if j == opener:
                k = resp_index(c, opener, three)
                return clip(T.sv_width("oc_all", nb_o, S, k), 0.03, 0.2)
        return super().range_width(c, j)


class Solver(SolverPre, Base):
    name = "f8_solver"
    DEFAULTS = dict(Base.DEFAULTS, pf_max=12.0, pure_table=True, cbet=0.6, barrel=0.33)

    def bet_size(self, c, value=True):
        # pot geometry: size so that two (flop) or one (turn) more bets get the stack in
        st = c.street
        spr = c.stack / max(1.0, c.pot)
        wet = c.ftex >= 1 or c.stex >= 2
        if st == 1:
            f = 0.33 if not wet else 0.6
            if spr < 3:
                f = 0.5
        elif st == 2:
            f = 0.6 if spr > 2 else 0.75
        else:
            f = 0.75 if spr > 1.2 else 1.0
        return f

    def unbet(self, c, j, e, e_call, row, n_live):
        # river bluffs balanced to the size: bluff share of a bet = f / (1 + 2f)
        if c.street == 3 and c.n_opp == 1 and c.made <= 2 and e < 0.2 and c.aggr.get(2) == c.me:
            f = self.bet_size(c, False)
            if self.rand() < f / (1 + 2 * f) * 1.1:
                return self.bet_pot(c, f)
        return super().unbet(c, j, e, e_call, row, n_live)


# ------------------------------------------------------------------------------ 3. adaptive
class AdaptiveMix:
    """Smooth, shrunk opponent adjustments; `adapt` scales them (1 = full)."""

    adapt = 1.0

    def _beh_vpip(self, beh):
        if not beh:
            return 0.26
        return sum(self.stats.rate("vpip", j) for j in beh) / len(beh)

    def open_factor(self, c, beh):
        f = super().open_factor(c, beh)
        if beh:
            loose = self._beh_vpip(beh)
            tb = sum(self.stats.rate("tb", j) for j in beh) / len(beh)
            g = (0.26 / max(0.08, loose)) ** 0.35 * (0.07 / max(0.02, tb)) ** 0.15
            f *= clip(1.0 + (g - 1.0) * self.adapt, 0.8, 1.12)
        return f

    def opp_open_width(self, c, j, nbj, S):
        w = super().opp_open_width(c, j, nbj, S)
        r = self.stats.ratio("open", j)
        return clip(w * (1.0 + (clip(r, 0.45, 2.2) - 1.0) * self.adapt), 0.04, 0.95)

    def est_3bet_width(self, c, j):
        return clip(self.stats.rate("tb", j) * (0.9 + 0.3 * self.adapt), 0.025, 0.2)

    def adjust_vs_open(self, c, opener, rb, rc):
        # more light 3-bets against a wide opener who over-folds to 3-bets
        f3 = self.stats.rate("f3", opener)
        ow = self.stats.ratio("open", opener)
        g = clip((f3 / 0.55) * ow ** 0.5, 0.6, 1.4)
        g = 1.0 + (g - 1.0) * self.adapt
        if g > 1.0 and c.pct <= 0.2 and rb + rc < 1.0:
            extra = min(1.0 - rb - rc, rb * (g - 1.0) + 0.08 * (g - 1.0))
            rb += max(0.0, extra) if c.pct > 0.04 else 0.0
        elif g < 1.0 and c.pct > 0.05:
            rb *= g
        return rb, rc

    def deep_vs_open(self, c, opener, w_o, S, callers):
        f3 = self.stats.rate("f3", opener)
        old = self.p["tb_bluff"]
        self.p["tb_bluff"] = clip(old * (1 + (f3 / 0.55 - 1) * self.adapt), 0.05, 0.6)
        try:
            return super().deep_vs_open(c, opener, w_o, S, callers)
        finally:
            self.p["tb_bluff"] = old

    def cbet_scale(self, c, j):
        g = clip(self.stats.rate("fcb", j) / 0.45, 0.5, 1.6)
        return super().cbet_scale(c, j) * (1.0 + (g - 1.0) * self.adapt)

    def bluff_scale(self, c, j):
        fb = self.stats.rate("fb", j)
        g = clip(fb / 0.42, 0.2, 1.6) ** 1.3
        return super().bluff_scale(c, j) * (1.0 + (g - 1.0) * self.adapt)

    def vthr_adj(self, c, j):
        # thinner value against players who call a lot
        fb = self.stats.rate("fb", j)
        wt = self.stats.rate("wtsd", j)
        adj = -0.10 * (0.42 - fb) - 0.06 * (wt - 0.30)
        return super().vthr_adj(c, j) + clip(adj, -0.06, 0.04) * self.adapt

    def call_adj(self, c, j):
        # call more against aggressive bettors, less against passive ones
        ag = self.stats.rate("aggr", j)
        adj = 0.12 * (ag - 0.45)
        return super().call_adj(c, j) + clip(adj, -0.05, 0.02) * self.adapt

    def push_bfs(self, c, beh):
        bp, bc = super().push_bfs(c, beh)
        if self.p["pure_table"] and beh:
            # table lookups: players who call shoves less than the equilibrium expects act as
            # if under more ICM pressure (a higher caller bubble factor), and vice versa
            r = sum(clip(self.stats.ratio("callshove", j), 0.4, 2.5) for j in beh) / len(beh)
            bc = clip(bc * r ** (-0.6 * self.adapt), 1.0, 3.0)
        return bp, bc

    def caller_widths(self, c, S, beh):
        out = super().caller_widths(c, S, beh)
        res = []
        for j, cf in out:
            r = self.stats.ratio("callshove", j)
            g = 1.0 + (clip(r, 0.5, 2.0) - 1.0) * self.adapt
            res.append((j, clip(cf * g, 0.0, 0.9)))
        return res

    def shove_width(self, c, j):
        w = super().shove_width(c, j)
        n = self.stats.sample("shove", j)
        if n >= 4:
            r = clip(self.stats.ratio("shove", j), 0.5, 2.5)
            w = clip(w * (1.0 + (r - 1.0) * self.adapt), 0.02, 0.9)
        return w

    def use_pf_range(self, c, j):
        return self.stats.sample("shove", j) < 6 or self.adapt < 0.75


class Adaptive(AdaptiveMix, Base):
    name = "f8_adaptive"
    DEFAULTS = dict(Base.DEFAULTS, pf_max=15.0, pure_table=False, open_scale=1.05)
    adapt = 1.0


# ------------------------------------------------------------------------------ 4. endgame
class EndgameMix:
    """Phase-aware adjustments: per-caller ICM reads for shoves, heads-up ranges and
    heads-up postflop aggression (the shared base already widens opens when covering
    everyone behind and demands a margin to call a covering all-in; this player does both
    harder)."""

    def phase(self, c):
        if c.players == 2:
            return "hu"
        if c.players_left <= 4:
            return "short"
        return "full"

    def first_in(self, c):
        if c.players == 2:
            beh = c.behind()
            eff = min(c.total, max(c.stacks[j] + c.bets[j] for j in beh))
            S = c.s_units(eff)
            if S > self.p["pf_max"]:
                p = T.sv_open(0, S, c.h)
                if p >= 0.999 or (p > 0.001 and self.rand() < p):
                    return self.raise_to(c, T.sv_open_size(0, S) * c.bb)
                return self.fold(c)
        return super().first_in(c)

    def vs_open(self, c):
        if c.players == 2:
            opener, amt = c.pre_raises[0]
            eff = min(c.total, c.stacks[opener] + c.bets[opener])
            S = c.s_units(eff)
            if S >= 12.0:
                rb = T.sv("rb", 0, S, 0, c.h)
                rc = T.sv("rc", 0, S, 0, c.h)
                x = self.rand()
                if x < rb:
                    t = amt * 3.4
                    return self.shove(c) if t >= 0.35 * c.total else self.raise_to(c, t)
                if x < rb + rc:
                    from engine.game import Call
                    return Call()
                return self.fold(c)
        return super().vs_open(c)

    def caller_widths(self, c, S, beh):
        """Each player behind calls by its own ICM position against me: its bubble factor
        against me (damped to what real callers show) and mine against it."""
        base = super().caller_widths(c, S, beh)
        if not self.icm.ready or len(beh) < 2:
            return base
        nbt = self.nb_for_tables(c)
        out = []
        for k, (j, cf_avg) in enumerate(base):
            bfc = 1.1 + 0.3 * (self.bf_opp(j) - 1.0)
            Sj = c.s_units(min(c.total, c.stacks[j] + c.bets[j]))
            cf = T.pf_callfrac(nbt, min(S, Sj), self.bf_me(j), bfc, k)
            out.append((j, 0.5 * cf + 0.5 * cf_avg))
        return out

    def vthr_adj(self, c, j):
        a = super().vthr_adj(c, j)
        if self.phase(c) == "hu":
            a -= 0.04
        return a

    def cbet_scale(self, c, j):
        s = super().cbet_scale(c, j)
        ph = self.phase(c)
        return s * (1.2 if ph == "hu" else 1.0)

    def call_adj(self, c, j):
        a = super().call_adj(c, j)
        ph = self.phase(c)
        if ph == "hu":
            a += 0.02
        return a


class Endgame(EndgameMix, Base):
    name = "f8_endgame"
    DEFAULTS = dict(Base.DEFAULTS, pf_max=15.0, pure_table=False, open_scale=0.95, tb_bluff=0.15,
                    press=0.8, covered_margin=0.004)


# ------------------------------------------------------------------------------ 5. ensemble
class Ensemble(EndgameMix, AdaptiveMix, Base):
    """The combination that measured best: the equilibrium push/fold table (whose caller
    bubble-factor input is moved by how tightly the players behind actually call shoves),
    position-chart preflop with ICM-scaled calls, mild opponent modelling, and the endgame
    logic (per-caller pressure, covering-stack margins, the solver's heads-up ranges).
    Measured on paired tables, the solver's deep ranges and the best-response shove did
    worse inside this combination than the chart and the table."""
    name = "f8_ensemble"
    DEFAULTS = dict(Base.DEFAULTS, pf_max=15.0, pure_table=True, cbet=0.58)
    adapt = 0.6
