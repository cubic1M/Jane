"""The six field9 bots. All share base9.Base (ICM push/fold tables, ICM all-in calls and
re-shoves, chart preflop, table-calibrated postflop, fixed-limit and any-game fallbacks);
each one has its own style:

  f9_threebet  aggressive regular: opens a little wide, 3-bets light (more against late and
               blind-steal opens, wide openers and players who fold to 3-bets), re-shoves
               12-25 bb over opens, 4-bet-shoves wide against frequent 3-bettors, c-bets a lot;
  f9_limptrap  limps strong and speculative hands from early and middle position and
               limp-re-raises its premiums, over-limps, flats or checks big pairs and sets as
               traps, defends its blinds and re-shoves wide against steals, bets big when
               checked to;
  f9_bubble    ICM bully: shoves and opens by ICM expected points against callers held to
               their own ICM price, presses covered medium stacks pre- and postflop, tightens
               when a bigger stack covers it, calls short shoves wide when it covers;
  f9_float     postflop specialist: flats opens in position, floats c-bets against frequent
               c-bettors, bets when checked to, raises the turn as a bluff with draws, sizes its
               aggression by each opponent's fold-to-bet rate;
  f9_gto       balanced baseline: mixed opening borders, a polarised 3-bet range with a fixed
               bluff ratio, equilibrium push/fold, size-dependent bluffing and pot-odds
               defence mixed near the border; no opponent modelling;
  f9_meta      model-based exploiter: per-seat VPIP / PFR / 3-bet / fold-to-3-bet /
               fold-to-c-bet / shove / call-shove rates pick a counter per opponent (steal from
               folders, re-steal wide openers, call down maniacs, value-bet stations, shove
               wider into players who never call).
"""
from __future__ import annotations

from engine.game import Call, Check
from sng.field9.base9 import Base, clip
from sng.field9.cards9 import AIR1, AIR2, SET, TOPTWO, WINDOW, class_info
from sng.field9.model9 import PRIORS


def backdoors(hole, board) -> int:
    """Backdoor flush / straight draws of two hole cards on a three-card flop (0..2)."""
    if len(board) != 3 or len(hole) != 2:
        return 0
    n = 0
    s1, s2 = hole[0] & 3, hole[1] & 3
    if s1 == s2 and sum(1 for x in board if x & 3 == s1) == 1:
        n += 1
    m = 0
    for x in list(hole) + list(board):
        m |= 1 << (x >> 2)
    if WINDOW[m] >= 3 and WINDOW[m & ~(1 << (hole[0] >> 2)) & ~(1 << (hole[1] >> 2))] < WINDOW[m]:
        n += 1
    return n


def _late(c, j) -> bool:
    return c.players == 2 or c.nb_of(j) <= 3


# =========================================================================== 3-bettor
class ThreeBet(Base):
    name = "f9_threebet"
    DEFAULTS = dict(Base.DEFAULTS, open_scale=1.12, tb_value=0.045, tb_bluff=0.45, jam_max=25.0, jam_width=0.17,
                    cbet=0.68, barrel=0.38, rbluff=0.22, icm_w=0.75)

    def open_adjust(self, c, j):
        key = "steal" if _late(c, j) else "open"
        prior = 0.38 if key == "steal" else 0.24
        return clip((self.stats.rate(key, j) / prior) ** 0.8, 0.6, 2.2)

    def tb_bluff_hand(self, c):
        hi, lo, kind = class_info(c.h)
        if kind == 1 and (hi == 12 or (hi - lo <= 2 and lo >= 3) or (hi >= 10 and lo >= 7)):
            return True
        return kind == 2 and hi >= 11 and lo >= 9          # offsuit broadways vs wide opens

    def tb_bluff_freq(self, c, opener, w_o):
        base = self.p["tb_bluff"] if (_late(c, opener) or w_o >= 0.25) else 0.15
        f3 = self.stats.rate("f3", opener)
        return clip(base * (f3 / 0.55) ** 1.5 * clip(w_o / 0.25, 0.6, 1.8), 0.0, 0.9)

    def flat_or_fold(self, c, opener, w_o, callers):
        # a 3-bettor flats little out of position outside the big blind
        if c.me == c.obs.sb_seat and c.pct > 0.08:
            return self.fold(c)
        return super().flat_or_fold(c, opener, w_o, callers)

    def opener_call_width(self, c, opener, w_o, need):
        cw = super().opener_call_width(c, opener, w_o, need)
        f3 = self.stats.rate("f3", opener)
        return min(w_o, cw * clip((1 - f3) / 0.45, 0.7, 1.6))

    def est_3bet_width(self, c, j):
        return clip(self.stats.rate("tb", j) * 1.2, 0.03, 0.25)

    def fourbet_width(self, c, raiser, w3):
        # a known light 4-bet shover is called wider
        return clip(0.04 + 0.3 * w3, 0.06, 0.12)

    def vs_3bet(self, c):
        raiser, amt = c.pre_raises[-1]
        S = c.s_units(min(c.start[c.me], c.start[raiser]))
        w3 = self.est_3bet_width(c, raiser)
        if S > 45 and c.to_call < 0.3 * c.total and w3 >= 0.10:
            hi, lo, kind = class_info(c.h)
            if kind == 1 and hi == 12 and lo <= 3 and self.rand() < 0.5:
                return self.raise_to(c, amt * 2.3)               # 4-bet bluff with an ace blocker
        return super().vs_3bet(c)

    def cbet_freq(self, c, j):
        f = super().cbet_freq(c, j)
        if c.n_raises >= 2:
            f = max(f, 0.8)                                       # 3-bet pots: the range is strong
        return f


# =========================================================================== limp / trap
class LimpTrap(Base):
    name = "f9_limptrap"
    DEFAULTS = dict(Base.DEFAULTS, pf_max=11.0, jam_max=22.0, call_scale=1.2, jam_width=0.15, cbet=0.5,
                    stab=0.55, vthr=0.56, barrel=0.3, rbluff=0.24)

    def first_in(self, c):
        beh = c.behind()
        if not beh:
            return self.fold(c)
        eff = min(c.start[c.me], max(c.start[j] for j in beh))
        S = c.s_units(eff)
        c.S = S
        early = c.players > 2 and c.nb >= 4
        if S <= self.p["pf_max"]:
            if early and S >= 7 and c.pct <= 0.025 and self.rand() < 0.35:
                return Call()                                     # limp-shove trap
            return self.shove(c) if self.push_decision(c, S, beh) else self.fold(c)
        if c.players > 2 and c.me == c.obs.sb_seat:
            if c.pct <= 0.07:
                return self.raise_to(c, 3.2 * c.bb) if self.rand() < 0.6 else Call()
            return Call() if c.pct <= (0.45 if S >= 20 else 0.3) else self.fold(c)
        if early and S >= 16:
            if c.pct <= 0.03:
                return Call() if self.rand() < 0.75 else self.raise_to(c, self.open_size(c, S) * c.bb)
            limp_w = 0.19 + (0.06 if S >= 35 else 0.0)
            if c.pct <= limp_w or (S >= 35 and self._speculative(c) and c.pct <= 0.4):
                return Call()
            return self.fold(c)
        if c.pct <= 0.015 and c.players > 2 and self.rand() < 0.25:
            return Call()                                         # late-position trap limp
        return self.open_decision(c, S, beh)

    def _speculative(self, c):
        hi, lo, kind = class_info(c.h)
        return kind == 0 or (kind == 1 and (hi - lo <= 2 or hi == 12))

    def limp_vs_raise(self, c):
        raiser, amt = c.pre_raises[-1]
        eff = min(c.start[c.me], c.start[raiser])
        S = c.s_units(eff)
        if c.pct <= 0.045 or (c.pct <= 0.07 and S <= 20):
            if S <= 35 or c.to_call >= 0.25 * c.total:
                return self.shove(c)
            return self.raise_to(c, amt * 3.2 + c.bb * len(c.cold_callers))
        hi, lo, kind = class_info(c.h)
        if kind == 1 and hi == 12 and lo <= 4 and S > 35 and self.rand() < 0.12:
            return self.raise_to(c, amt * 3.2)                     # balance the limp-raise
        if c.to_call <= 0.08 * eff and (self._speculative(c) or c.pct <= 0.15):
            return Call()
        need = c.to_call / (c.pot + c.to_call)
        if self.T.eq_top(self.est_open_width(c, raiser), c.h) * 0.9 > need + 0.05 and c.pct <= 0.2:
            return Call()
        return self.fold(c)

    def vs_open(self, c):
        opener = c.pre_raises[0][0]
        eff = min(c.start[c.me], c.start[opener])
        S = c.s_units(eff)
        if c.pct <= 0.012 and S > 28 and not c.cold_callers and self.rand() < 0.5:
            return Call()                                         # trap AA / KK
        return super().vs_open(c)

    def opener_call_width(self, c, opener, w_o, need):
        return super().opener_call_width(c, opener, w_o, need) * 0.95

    def jam_margin(self, c, opener):
        # tough to steal against: re-shove a little looser against late-position opens
        if _late(c, opener) and c.me in (c.obs.sb_seat, c.obs.bb_seat) and self.icm.ready:
            return -0.002 * self.icm.total_pts
        return 0.0

    def bb_option(self, c):
        if c.pct <= 0.012 and self.rand() < 0.4:
            return Check()
        if c.pct <= 0.10 + (0.15 if c.players == 2 else 0.0):
            return self.raise_to(c, c.pot + 3 * c.bb)
        return Check()

    def vs_limpers(self, c):
        nl = len(c.limpers)
        beh = c.behind()
        eff = min(c.total, max([c.start[j] for j in beh + c.limpers] or [c.total]))
        S = c.s_units(eff)
        if S <= self.p["pf_max"]:
            return self.shove(c) if c.pct <= 0.12 else self.fold(c)
        if c.pct <= 0.05 and not (c.pct <= 0.012 and self.rand() < 0.3):
            return self.raise_to(c, (5.0 + nl) * c.bb)
        if c.to_call <= c.bb and (c.pct <= 0.30 or (self._speculative(c) and c.pct <= 0.5)):
            return Call()                                         # over-limp
        return self.fold(c)

    # postflop: traps and big bets when checked to
    def _monster_dry(self, c):
        return c.made >= TOPTWO and c.ftex == 0 and c.stex <= 1 and c.street == 1

    def slowplay(self, c, j):
        return self._monster_dry(c) and c.made >= SET and self.rand() < 0.6

    def facing_bet(self, c, j, e, row):
        if self._monster_dry(c) and c.to_call < 0.4 * c.stack and self.rand() < 0.65:
            return Call()                                         # flat the flop, raise later
        return super().facing_bet(c, j, e, row)

    def checked_to(self, c):
        able = [k for k in c.opps if not c.all_in[k]]
        return bool(c.checked) and bool(able) and all(k in c.checked for k in able)

    def unbet(self, c, j, e, e_call, row):
        if c.n_opp <= 2 and self.checked_to(c):
            size = 0.9 if c.street < 3 else 1.0
            if e_call >= self.vthr(c, j) - 0.08 and not self.slowplay(c, j):
                return self.shove(c) if c.stack <= 1.1 * c.pot else self.bet_pot(c, size)
            if (c.made <= AIR2 or c.draw >= 2) and self.rand() < (0.45 if c.n_opp == 1 else 0.22):
                return self.bet_pot(c, size)
        return super().unbet(c, j, e, e_call, row)

    def bet_size(self, c, value=True):
        if self.checked_to(c):
            return 0.9 if c.street < 3 else 1.0
        return super().bet_size(c, value)


# =========================================================================== bubble bully
class Bubble(Base):
    name = "f9_bubble"
    DEFAULTS = dict(Base.DEFAULTS, pf_max=16.0, jam_max=26.0, covered_margin=0.004, press=0.7)

    def caller_bf(self, j):
        return 1.0 + 0.8 * (self.bf_opp(j) - 1.0)

    def caller_widths(self, c, S, beh, my_w):
        out = []
        for j in beh:
            eff = c.eff_vs(j)
            risk = eff - c.bets[j]
            gain = eff + c.pot - c.bets[j]
            bf = self.caller_bf(j)
            need = bf * risk / max(1.0, bf * risk + gain)
            need0 = risk / max(1.0, risk + gain)
            cw = self.T.call_width(my_w, need)
            cw = max(cw, 0.35 * self.T.call_width(my_w, need0))  # nobody folds everything
            out.append((j, clip(cw, 0.0, 1.0)))
        return out

    def push_decision(self, c, S, beh):
        """The equilibrium shove, plus every shove the callers' own ICM prices make profitable."""
        if super().push_decision(c, S, beh):
            return True
        if not self.icm.ready:
            return False
        bp, bc = self.push_bfs(c, beh)
        my_w = clip(self.T.pf_width(len(beh), S, bp, bc), 0.08, 0.5)    # the range they credit me with
        return self.push_ev(c, beh, my_w) > 0.0005 * self.icm.total_pts

    def shover_bf(self, c, j):
        return 1.0                       # short stacks shove chip-EV wide: call them accordingly

    def allin_equity(self, c, j, h):
        rs = c.pre_raises
        if len(rs) == 1 and rs[0][0] == j and not c.limpers and c.all_in[j] and c.start[c.me] > c.start[j]:
            # a shorter stack's open shove: desperate stacks shove wider than any equilibrium
            return self.T.eq_top(clip(1.35 * self.est_shove_width(c, j), 0.02, 1.0), h)
        return super().allin_equity(c, j, h)

    def open_factor(self, c, beh):
        if not self.icm.ready or not beh:
            return 1.0
        bp, bc = self.push_bfs(c, beh)
        f = clip((bc / bp) ** 0.6, 0.6, 1.8)
        if all(c.start[c.me] > c.start[j] for j in beh):
            pres = sum(self.bf_opp(j) for j in beh) / len(beh)
            f *= clip(1.0 + self.p["press"] * (pres - 1.0), 1.0, 1.9)
        return clip(f, 0.55, 2.4)

    def opener_call_width(self, c, opener, w_o, need):
        # the opener prices the call with its own risk premium (on top of the base's damped one)
        bf = 1.0 + 0.5 * (self.bf_opp(opener) - 1.0)
        need = need * bf / (need * bf + (1 - need))
        return super().opener_call_width(c, opener, w_o, need)

    def pressure(self, c, j) -> float:
        """How much more seat j risks against me than I risk against it."""
        if not self.icm.ready:
            return 1.0
        return clip(self.bf_opp(j) / max(0.8, self.bf_me(j)), 0.6, 2.2)

    def cbet_freq(self, c, j):
        return clip(super().cbet_freq(c, j) * self.pressure(c, j) ** 0.7, 0.2, 0.92)

    def barrel_freq(self, c, j):
        return clip(super().barrel_freq(c, j) * self.pressure(c, j) ** 0.8, 0.1, 0.8)

    def stab_freq(self, c, j):
        return clip(super().stab_freq(c, j) * self.pressure(c, j), 0.1, 0.8)

    def rbluff_freq(self, c, j):
        return clip(super().rbluff_freq(c, j) * self.pressure(c, j), 0.05, 0.6)

    def call_adj(self, c, j):
        # a medium stack betting into me risks its tournament: its bets are value-heavy
        return -0.02 * max(0.0, self.bf_opp(j) - 1.3)


# =========================================================================== floater
class Float(Base):
    name = "f9_float"
    DEFAULTS = dict(Base.DEFAULTS, call_scale=1.35, tb_value=0.032, tb_bluff=0.08, cbet=0.5, stab=0.5,
                    barrel=0.42, rbluff=0.26, jam_max=20.0)

    def fb(self, j):
        return self.stats.rate("fb", j)

    def flat_or_fold(self, c, opener, w_o, callers):
        ip = c.me not in (c.obs.sb_seat, c.obs.bb_seat)
        S = getattr(c, "S", 30.0)
        if ip and S >= 25 and not callers:
            hi, lo, kind = class_info(c.h)
            playable = kind == 0 or kind == 1 or (hi >= 9 and lo >= 8) or (hi - lo == 1 and lo >= 6)
            need = c.to_call / (c.pot + c.to_call)
            e = self.T.eq_top(w_o, c.h)
            if playable and c.pct <= 0.42 and e * 1.08 > need * self.rf(c, opener, 3 * c.to_call):
                return Call()
        return super().flat_or_fold(c, opener, w_o, callers)

    def realization(self, c, h, villain):
        return super().realization(c, h, villain) + 0.04

    def float_call(self, c, j, e, need):
        if c.n_opp != 1 or not c.ip or c.street != 1 or c.pf_aggr != j:
            return False
        bet = c.to_call / max(1.0, c.pot - c.to_call)
        if bet > 0.8 or c.stack < 2.5 * (c.pot + c.to_call):
            return False
        cb = self.stats.rate("cb", j)
        has_something = c.made >= AIR1 or c.draw >= 1 or backdoors(c.hole, c.board) >= 1
        if not has_something or e < need - 0.16:
            return False
        return self.rand() < clip((cb - 0.4) * 2.0, 0.1, 0.85)

    def _floated(self, c, j):
        """I called j's bet on the previous street and j now checks to me."""
        prev = c.street - 1
        return prev >= 1 and prev in c.called_street.get(c.me, ()) and c.aggr.get(prev) == j and j in c.checked

    def unbet(self, c, j, e, e_call, row):
        if c.n_opp == 1 and c.ip and e_call < self.vthr(c, j) and self._floated(c, j):
            freq = clip(0.75 * (self.fb(j) / 0.45), 0.35, 0.95)
            if self.rand() < freq:
                return self.bet_pot(c, 0.65 if c.street < 3 else 0.7)
        return super().unbet(c, j, e, e_call, row)

    def stab_freq(self, c, j):
        return clip(self.p["stab"] * (self.fb(j) / 0.45) ** 1.2, 0.15, 0.9)

    def rbluff_freq(self, c, j):
        return clip(self.p["rbluff"] * (self.fb(j) / 0.45) ** 1.5, 0.03, 0.7)

    def bluff_raise(self, c, j):
        if c.n_opp != 1:
            return False
        bet = c.to_call / max(1.0, c.pot - c.to_call)
        fb = self.fb(j)
        if c.street == 2 and c.draw >= 2 and bet <= 0.8:
            return self.rand() < clip(0.4 * fb / 0.45, 0.1, 0.7)    # the turn bluff-raise
        if c.street == 1 and c.draw >= 3 and not c.ip:
            return self.rand() < 0.35                               # check-raise draws
        if c.street == 1 and c.draw >= 5:
            return self.rand() < 0.5
        return False


# =========================================================================== balanced baseline
class Balanced(Base):
    name = "f9_gto"
    DEFAULTS = dict(Base.DEFAULTS, open_mix=0.22, tb_value=0.04, cbet=0.62, barrel=0.4, rbluff=0.3, stab=0.35)

    # no opponent modelling: fixed population ranges
    def est_3bet_width(self, c, j):
        return 0.075

    def trust_pf_range(self, c, j):
        return True

    def tb_bluff_freq(self, c, opener, w_o):
        value = max(0.022, self.p["tb_value"] * (0.6 + 1.2 * w_o))
        return clip(0.6 * value / 0.04, 0.0, 0.9)               # about 0.6 bluff per value combo

    def cbet_freq(self, c, j):
        dry = c.ftex == 0 and c.stex <= 1
        return 0.78 if dry else 0.48

    def bet_size(self, c, value=True):
        if c.street == 1:
            return 0.33 if (c.ftex == 0 and c.stex <= 1) else 0.66
        return 0.66 if c.street == 2 else 0.75

    def rbluff_freq(self, c, j):
        b = self.bet_size(c, False)
        return b / (1 + 2 * b) * 1.1                            # bluff share for the price offered

    def facing_bet(self, c, j, e, row):
        a = super().facing_bet(c, j, e, row)
        if a.kind != "fold" or c.to_call >= 0.6 * c.stack:
            return a
        pot_after = c.pot + c.to_call
        need = c.to_call / pot_after
        R = 1.0 if (c.ip or c.street == 3) else 0.93
        gap = need - e * R
        if 0 < gap < 0.06 and self.rand() < 1.0 - gap / 0.06:
            return Call()                                           # mixed defence at the border
        return a

    def bluff_raise(self, c, j):
        return c.n_opp == 1 and c.street <= 2 and c.draw >= 4 and self.rand() < 0.25


# =========================================================================== model-based exploiter
class Meta(Base):
    name = "f9_meta"
    DEFAULTS = dict(Base.DEFAULTS, tb_bluff=0.25)
    MIN_OBS = 6

    def r(self, key, j):
        return self.stats.rate(key, j)

    def norm(self, key):
        """The table's norm for a rate: the opportunity-weighted mean over the other seats
        (population prior until there is data). Exploits target deviations from it."""
        st = self.stats
        x = sum(st.x[key][j] for j in range(self.n) if j != self.seat)
        o = sum(st.o[key][j] for j in range(self.n) if j != self.seat)
        k = 20.0
        return (x + k * PRIORS[key]) / (o + k)

    def rel(self, key, j):
        """Seat j's rate against a reference halfway between the table norm and the prior."""
        return self.r(key, j) / max(0.02, 0.5 * self.norm(key) + 0.5 * PRIORS[key])

    def seen(self, key, j):
        return self.stats.opp(key, j) >= self.MIN_OBS

    def profile(self, j):
        vpip, pfr, agg, fb = self.r("vpip", j), self.r("pfr", j), self.r("agg", j), self.r("fb", j)
        if vpip >= 0.45 and agg >= 0.6:
            return "maniac"
        if vpip >= 0.40 and fb <= 0.35:
            return "station"
        if vpip <= 0.16:
            return "nit"
        return "reg"

    # preflop -------------------------------------------------------------------------------
    def open_adjust(self, c, j):
        key = "steal" if _late(c, j) else "open"
        prior = 0.38 if key == "steal" else 0.24
        return clip((self.r(key, j) / prior) ** 0.9, 0.5, 2.5)

    def open_factor(self, c, beh):
        f = super().open_factor(c, beh)
        blinds = [j for j in beh if j in (c.obs.sb_seat, c.obs.bb_seat)]
        if blinds and len(beh) <= 3:
            fts = sum(self.r("fts", j) for j in blinds) / len(blinds)
            f *= clip(1.0 + 1.6 * (fts - 0.66), 0.75, 1.5)
        if any(self.r("tb", j) >= 0.14 for j in beh):
            f *= 0.85
        return f

    def tb_bluff_freq(self, c, opener, w_o):
        f3 = self.r("f3", opener)
        if f3 <= 0.4 or w_o < 0.15:
            return 0.0
        return clip((f3 - 0.4) * 1.6 * clip(w_o / 0.22, 0.5, 2.0), 0.0, 0.8)

    def tb_bluff_hand(self, c):
        hi, lo, kind = class_info(c.h)
        return kind == 1 and (hi == 12 or hi - lo <= 2 or hi >= 10) or (kind == 2 and hi >= 11 and lo >= 8)

    def opener_call_width(self, c, opener, w_o, need):
        cw = super().opener_call_width(c, opener, w_o, need)
        return min(w_o, cw * clip((1 - self.r("f3", opener)) / 0.45, 0.6, 1.8))

    def est_3bet_width(self, c, j):
        return clip(self.r("tb", j) * 1.15, 0.025, 0.3)

    def fourbet_width(self, c, raiser, w3):
        return clip(0.04 + 0.3 * w3, 0.05, 0.12)

    def call_tendency(self, c, j):
        return clip(self.rel("cshove", j), 0.4, 2.2)

    def push_decision(self, c, S, beh):
        """The (scaled) equilibrium shove, or a best response to the callers' observed tendencies."""
        if super().push_decision(c, S, beh):
            return True
        if not beh or not all(self.seen("cshove", j) for j in beh) or not self.icm.ready:
            return False
        bp, bc = self.push_bfs(c, beh)
        my_w = clip(self.T.pf_width(len(beh), S, bp, bc), 0.08, 0.5)
        return self.push_ev(c, beh, my_w) > 0.001 * self.icm.total_pts

    def push_scale(self, c, beh):
        if not beh:
            return 1.0
        cs = sum(self.rel("cshove", j) for j in beh) / len(beh)
        return clip((1.0 / max(0.2, cs)) ** 0.6, 0.8, 1.5)

    def trust_pf_range(self, c, j):
        return not self.seen("shove", j) or 0.65 <= self.rel("shove", j) <= 1.5

    def shove_width(self, c, j):
        w = super().shove_width(c, j)
        shown = self.stats.shown_shove_width(j)
        if self.seen("shove", j):
            w *= clip(self.rel("shove", j) ** 0.7, 0.5, 3.0)
        if shown is not None:
            w = 0.5 * w + 0.5 * shown
        return clip(w, 0.02, 1.0)

    def allin_equity(self, c, j, h):
        if not self.trust_pf_range(c, j) or self.stats.shown_shove_width(j) is not None:
            return self.T.eq_top(clip(self.shove_width(c, j), 0.01, 1.0), h)
        return super().allin_equity(c, j, h)

    # postflop ------------------------------------------------------------------------------
    def cbet_freq(self, c, j):
        return clip(super().cbet_freq(c, j) * self.rel("fcb", j) ** 1.2, 0.15, 0.95)

    def stab_freq(self, c, j):
        if self.profile(j) == "station":
            return 0.05
        return clip(self.p["stab"] * self.rel("fb", j) ** 1.3, 0.05, 0.9)

    def barrel_freq(self, c, j):
        if self.profile(j) == "station":
            return 0.08
        return clip(self.p["barrel"] * self.rel("fb", j), 0.08, 0.8)

    def rbluff_freq(self, c, j):
        if self.profile(j) in ("station", "maniac"):
            return 0.0
        return clip(self.p["rbluff"] * self.rel("fb", j) ** 1.5, 0.02, 0.7)

    def vthr(self, c, j):
        v = super().vthr(c, j)
        p = self.profile(j)
        if p == "station":
            v -= 0.06
        elif p == "nit":
            v += 0.03
        return v

    def bluff_share(self, c, j, raised):
        b = super().bluff_share(c, j, raised)
        if self.seen("rbluff", j) or self.stats.opp("agg", j) >= 15:
            b *= clip(self.r("rbluff", j) / 0.25, 0.4, 2.5) * clip(self.r("agg", j) / 0.5, 0.6, 1.8)
        return clip(b, 0.0, 0.6)

    def call_adj(self, c, j):
        p = self.profile(j)
        if p == "maniac":
            return 0.04
        if self.stats.opp("agg", j) >= 15 and self.r("agg", j) <= 0.33:
            return -0.05
        if p == "nit":
            return -0.03
        return 0.0
