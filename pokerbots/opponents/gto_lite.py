"""opp_gtolite: an "approximately balanced" heads-up bot (spec-driven).

The kind of bot a team builds after reading about GTO, without solving anything:

* Mixed strategies everywhere: actions are drawn from smooth (sigmoid) frequencies
  around thresholds instead of hard cut-offs, so the same hand does different
  things and ranges stay merged at the boundaries.
* Preflop: per-spec percentile (MC equity vs random). Wide button opens mixed with
  limps; big blind defends by minimum defence frequency (MDF) or pot odds,
  3-bets value plus bluffs taken from just below the defence threshold.
* Postflop strength = MC equity vs the opponent's range (preflop range from their
  observed frequencies, narrowed on the board as they bet). Each equity is also
  ranked against this bot's own past equities in the same kind of spot, which
  gives "where am I in my range" for MDF defence.
* Polarized betting on the last street: value + bluffs with bluffs:value =
  bet/(pot+bet), i.e. bluffs make bet/(pot+2*bet) of the betting range; the bluff
  frequency is computed from the observed value/air mix of its own river spots.
* Small range c-bets as preflop raiser, polar turn barrels, check-raises out of
  position (value + semi-bluffs), occasional checked traps.
* Opponent modelling within bounds: fold-to-cbet and fold-to-bet scale the bluff
  frequencies (x0.4..x1.6); the opponent's river bluffs shown at showdown and
  postflop aggression scale the defence frequency (x0.7..x1.3).
Discards: best option by the engine's Monte Carlo discard_options.
"""
from __future__ import annotations

from collections import defaultdict

import numpy as np

from engine.bot import Bot
from engine.game import Call, Check, Fold

from ._tg_common import (HandView, OppModel, bet_pot, choose_discard, eff_stack, equity_vs,
                      get_info, opp_pre_range, raise_to, safe, shove, sigmoid)

PARAMS = dict(
    push_fold_bb=11.0,
    open_frac=0.72, open_frac_short=0.62, limp_prob=0.45, open_bb=2.5, open_bb_short=2.0,
    iso_frac=0.24, iso_bluff=0.22, iso_bb=3.5,
    three_bet_share=0.3, bluff_ratio=0.5,
    realize_ip=0.92, realize_oop=0.78,
    cbet_base=0.55, mix_w=0.03,
    river_value=0.7, river_air=0.3,
    defend_scale=0.85, bluff_scale=1.0,
    pre_budget_ms=3.0, post_budget_ms=4.5,
)


def push_frac(eff_bb: float) -> float:
    return float(np.clip(1.02 - 0.042 * eff_bb, 0.42, 0.92))


class GtoLiteBot(Bot):
    name = "opp_gtolite"
    STRICT = False

    def __init__(self, **params):
        self.p = dict(PARAMS, **params)

    def new_match(self, spec, seed=0):
        super().new_match(spec, seed)
        self.np_rng = np.random.default_rng(seed)
        self.info = get_info(spec)
        self.opp = OppModel()
        grid = list(np.linspace(0.05, 0.95, 10))
        self.hist = defaultdict(lambda: list(grid))   # spot -> my past equities
        self.river_v, self.river_b = 3.0, 5.0          # value / air counts at river first-in spots

    def end_hand(self, result):
        self.opp.update(result)

    def act(self, obs):
        try:
            if obs.legal.discard_count:
                return safe(obs, choose_discard(self.info, obs, self.np_rng))
            hv = HandView(obs)
            a = self._preflop(obs, hv) if obs.street == 0 else self._postflop(obs, hv)
        except Exception:
            if self.STRICT:
                raise
            a = obs.legal.passive() if obs.legal.can_check else Fold()
        return safe(obs, a)

    # ---- helpers ---------------------------------------------------------------------
    def _mix(self, x, thr, w=None):
        """True with probability sigmoid((x - thr) / w): a mixed threshold."""
        w = self.p["mix_w"] if w is None else w
        return self.rng.random() < float(sigmoid((x - thr) / w))

    def _rank(self, spot, eq):
        h = self.hist[spot]
        rank = float(np.mean(np.asarray(h) < eq) + 0.5 * np.mean(np.asarray(h) == eq))
        h.append(eq)
        if len(h) > 400:
            del h[:len(h) - 400]
        return rank

    # ---- preflop ---------------------------------------------------------------------
    def _preflop(self, obs, hv):
        p, lg, info = self.p, obs.legal, self.info
        bb = obs.big_blind
        pct = info.pct(obs.my_cards)
        eff_bb = eff_stack(obs) / bb
        short = eff_bb <= p["push_fold_bb"]
        rnd = self.rng.random()
        if hv.pf_raises == 0:
            if obs.position == 0 and not lg.can_check:    # button first in
                if short:
                    if self._mix(pct, 1 - push_frac(eff_bb)):
                        return shove(obs)
                    return Call() if (pct > 0.9 and rnd < 0.2) else Fold()  # rare limp-trap
                frac = p["open_frac_short"] if eff_bb < 25 else p["open_frac"]
                if self._mix(pct, 1 - frac):
                    size = p["open_bb_short"] if eff_bb < 25 else p["open_bb"]
                    return raise_to(obs, size * bb, allin_frac=0.45)
                if pct >= 0.15 and rnd < p["limp_prob"]:
                    return Call()
                return Fold()
            # big blind after a limp: value raises + bluffs from the middle
            if self._mix(pct, 1 - p["iso_frac"]) or (0.3 <= pct <= 0.5 and rnd < p["iso_bluff"]):
                if short:
                    return shove(obs)
                return raise_to(obs, p["iso_bb"] * bb, allin_frac=0.45)
            return Check() if lg.can_check else lg.passive()

        if not lg.can_call:
            return Check() if lg.can_check else Fold()
        r = opp_pre_range(obs, self.opp)
        call = lg.call_amount
        req = call / (obs.pot + call)
        mdf = 1.0 - call / obs.pot
        eq = equity_vs(info, obs, self.np_rng, r_pre=r, budget_ms=p["pre_budget_ms"])
        allin_call = call >= obs.my_stack or obs.opp_stack == 0
        deep = not allin_call and eff_bb > 18
        realize = (p["realize_ip"] if obs.position == 0 else p["realize_oop"]) if deep else 1.0
        # continue by MDF relative to the opponent's range width, or by pot odds
        defend_thr = 1 - min(0.95, mdf * min(1.0, 0.45 + r)) if deep else 1.0
        cont = self._mix(eq * realize, req) or (deep and hv.pf_raises == 1 and self._mix(pct, defend_thr))
        if lg.can_raise and obs.opp_stack > 0:
            my_total = obs.my_stack + obs.my_pip
            mult = 3.5 if obs.position == 1 else 3.0
            if hv.pf_raises >= 2:
                mult = 2.3
            target = obs.opp_pip * mult
            jam = target >= 0.35 * my_total or eff_bb <= 22
            vshare = p["three_bet_share"] * r
            if jam:
                if eq >= req + 0.04 and self._mix(pct, 1 - vshare - 0.03, 0.02):
                    return shove(obs)
            else:
                if eq >= 0.5 and self._mix(pct, 1 - vshare, 0.02):
                    return raise_to(obs, target, allin_frac=0.35)
                # bluffs from just below the continue range, bluffs:value = bluff_ratio
                band_lo = max(0.0, defend_thr - 0.15)
                if not cont and band_lo <= pct < defend_thr + 0.05:
                    if rnd < min(1.0, p["bluff_ratio"] * vshare / 0.2):
                        return raise_to(obs, target, allin_frac=0.35)
        return Call() if cont else Fold()

    # ---- postflop --------------------------------------------------------------------
    def _postflop(self, obs, hv):
        p, lg, info, om = self.p, obs.legal, self.info, self.opp
        r = opp_pre_range(obs, om)
        inc = 0.8 if om.aggression < 0.45 else 0.45
        m = 1.0 + inc * hv.opp_raises_street + 0.4 * inc * hv.opp_raises_prev + 0.25 * hv.opp_calls_prev
        if hv.opp_checked_street:
            m -= 0.3
        m = max(1.0, min(4.0, m))
        eq = equity_vs(info, obs, self.np_rng, r_pre=r, m_post=m, budget_ms=p["post_budget_ms"])
        last = hv.is_last_street
        st_key = "river" if last else ("flop" if obs.street == 1 else "turn")
        rnd = self.rng.random()
        bluff_adj = float(np.clip(om.fold_to_bet / 0.4, 0.4, 1.6)) * p["bluff_scale"]

        if lg.can_call:
            return self._facing_bet(obs, hv, eq, last, st_key, rnd)

        if not lg.can_raise:
            return Check()
        rank = self._rank((st_key, "first"), eq)
        if last:
            frac = 0.75
            if eq >= 0.9 and rnd < 0.5:
                frac = 1.25          # nutted overbet, mixed
            v_thr, a_thr = p["river_value"], p["river_air"]
            self.river_v += eq >= v_thr
            self.river_b += eq <= a_thr
            if eq >= v_thr:
                # protect the checking range out of position: check some value to check-raise
                if obs.position == 1 and not hv.opp_checked_street and rnd < 0.2:
                    return Check()
                return bet_pot(obs, frac, allin_frac=0.7)
            if eq <= a_thr:
                s = frac
                bluff_to_value = s / (1 + s)        # bluffs = s/(1+2s) of the betting range
                pb = bluff_to_value * self.river_v / self.river_b * bluff_adj
                if rnd < min(1.0, pb):
                    return bet_pot(obs, frac, allin_frac=0.9)
            return Check()

        if obs.street == 1 and hv.i_am_pf_aggr:
            # small range c-bet; frequency of the non-value part adapts to fold-to-cbet
            cfreq = float(np.clip(p["cbet_base"] * om.fold_to_cbet / 0.45, 0.25, 0.85))
            if eq >= 0.6:
                return bet_pot(obs, 0.33) if rnd < 0.85 else Check()
            if rnd < cfreq:
                return bet_pot(obs, 0.33, allin_frac=0.9)
            return Check()
        if obs.position == 1 and not hv.opp_checked_street:
            # out of position first to act: mostly check (to check-raise), some leads
            if eq >= 0.72 and rnd < 0.3:
                return bet_pot(obs, 0.6)
            if 0.3 <= eq <= 0.45 and rnd < 0.06 * bluff_adj:
                return bet_pot(obs, 0.6, allin_frac=0.9)
            return Check()
        # in position (or checked to) on flop/turn: polar 2/3 pot
        if eq >= 0.68 and self._mix(eq, 0.68, 0.04):
            return bet_pot(obs, 0.66)
        if rank < 0.45 and eq >= 0.25:
            pb = 0.66 / 1.66 * 1.4 * bluff_adj * 0.6  # semi-bluffs: more than river ratio
            if rnd < min(0.6, pb):
                return bet_pot(obs, 0.66, allin_frac=0.9)
        return Check()

    def _facing_bet(self, obs, hv, eq, last, st_key, rnd):
        p, lg, om = self.p, obs.legal, self.opp
        call = lg.call_amount
        req = call / (obs.pot + call)
        alpha = call / obs.pot
        mdf = 1.0 - alpha
        rank = self._rank((st_key, "facing"), eq)
        # opponents shown bluffing at showdown get more defence, value-heavy ones less
        k = float(np.clip(om.river_bluff_rate / 0.3, 0.6, 1.3))
        if not last:
            k = 0.5 * (k + float(np.clip(om.aggression / 0.35, 0.7, 1.2)))
        defend = float(np.clip(mdf * k * p["defend_scale"], 0.1, 0.92))
        can_raise = lg.can_raise and obs.opp_stack > 0
        # raises: value + bluffs, check-raises out of position
        if can_raise:
            v_thr = 0.85 if last else 0.78
            if hv.raises_street >= 3:
                v_thr = 0.9
            cr = obs.position == 1 and hv.i_checked_street
            if eq >= v_thr and rnd < (0.75 if cr else 0.6):
                return bet_pot(obs, 0.85, allin_frac=0.5)
            if hv.raises_street == 1:
                if not last and cr and 0.3 <= eq <= 0.47 and rnd < 0.2:
                    return bet_pot(obs, 0.85, allin_frac=0.9)     # semi-bluff check-raise
                if last and eq < 0.12 and rnd < 0.05 * float(np.clip(om.fold_to_bet / 0.4, 0.4, 1.6)):
                    return bet_pot(obs, 0.85, allin_frac=0.9)     # rare river bluff-raise
        if self._mix(eq, req + 0.02, 0.025):
            return Call()
        # minimum defence: continue with the top `defend` share of my range here,
        # but never with near-dead hands
        if eq >= 0.5 * req and self._mix(rank, 1.0 - defend, 0.04):
            return Call()
        return Fold()


def make_bot(**kw):
    return GtoLiteBot(**kw)
