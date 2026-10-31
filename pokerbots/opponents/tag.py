"""opp_tag: a disciplined tight-aggressive heads-up bot (spec-driven).

Preflop
  * Hand strength = Monte Carlo preflop equity vs a random hand, turned into a
    per-spec percentile against a seeded pool of random hands.
  * First in: open a fixed top share from the button, raise a top share vs a limp.
  * Facing raises: Monte Carlo equity vs the opponent's range (top r of the pool,
    r learned from the opponent's preflop raise/continue frequencies); 3-bet/4-bet
    the top of what continues, call when equity x realisation beats the pot odds.
  * Push/fold when the effective stack is 12 bb or less.
Postflop
  * Monte Carlo equity vs a range that narrows with opponent aggression (best of m
    on the current board, m grows with each bet/raise/call, less vs maniacs).
  * Value-bet / raise strong hands, c-bet as preflop raiser (frequency adapted to
    the opponent's fold-to-cbet), occasional semi-bluff raises, pot-odds calls,
    fold to strength. Sizes 1/3, 1/2-3/4 and pot (all-in when it commits most).
Discards: best option by the engine's Monte Carlo discard_options.
"""
from __future__ import annotations

import numpy as np

from engine.bot import Bot
from engine.game import Call, Check, Fold, RaiseTo

from ._common import (HandView, OppModel, bet_pot, choose_discard, eff_stack, equity_vs,
                      fold_or_check, get_info, opp_pre_range, raise_to, safe, shove)

PARAMS = dict(
    push_fold_bb=12.0,
    open_frac=0.55, open_frac_short=0.5, open_bb=2.5, open_bb_short=2.0,
    iso_frac=0.28, iso_bb=4.0,
    three_bet_share=0.33, four_bet_share=0.3, bluff_3bet=0.12,
    realize_ip=0.92, realize_oop=0.8,
    vthr=0.62, raise_thr=0.78, river_raise_thr=0.85,
    cbet_base=0.55, semibluff=0.1,
    pre_budget_ms=3.0, post_budget_ms=4.5,
)


def push_frac(eff_bb: float) -> float:
    """Share of hands to shove from the button at an effective stack (Nash-like)."""
    return float(np.clip(1.0 - 0.042 * eff_bb, 0.42, 0.9))


class TagBot(Bot):
    name = "opp_tag"
    STRICT = False  # tests set True to surface bugs instead of falling back

    def __init__(self, **params):
        self.p = dict(PARAMS, **params)

    def new_match(self, spec, seed=0):
        super().new_match(spec, seed)
        self.np_rng = np.random.default_rng(seed)
        self.info = get_info(spec)
        self.opp = OppModel()

    def end_hand(self, result):
        self.opp.update(result)

    def act(self, obs):
        try:
            if obs.legal.discard_count:
                return safe(obs, choose_discard(self.info, obs, self.np_rng))
            hv = HandView(obs)
            a = self._preflop(obs, hv) if obs.street == 0 else self._postflop(obs, hv)
        except Exception:  # never crash a match: fall back to a passive legal action
            if self.STRICT:
                raise
            a = obs.legal.passive() if obs.legal.can_check else Fold()
        return safe(obs, a)

    # ---- preflop ---------------------------------------------------------------------
    def _preflop(self, obs, hv):
        p, lg, info = self.p, obs.legal, self.info
        bb = obs.big_blind
        pct = info.pct(obs.my_cards)
        eff_bb = eff_stack(obs) / bb
        short = eff_bb <= p["push_fold_bb"]
        if hv.pf_raises == 0:
            if obs.position == 0 and not lg.can_check:     # button, first in
                if short:
                    return shove(obs) if pct >= 1 - push_frac(eff_bb) else Fold()
                frac = p["open_frac_short"] if eff_bb < 25 else p["open_frac"]
                if pct >= 1 - frac:
                    size = p["open_bb_short"] if eff_bb < 25 else p["open_bb"]
                    return raise_to(obs, size * bb, allin_frac=0.45)
                return Fold()
            # big blind after a limp
            if pct >= 1 - p["iso_frac"]:
                if short:
                    return shove(obs)
                return raise_to(obs, p["iso_bb"] * bb, allin_frac=0.45)
            return Check() if lg.can_check else lg.passive()

        # facing a raise
        if not lg.can_call:
            return Check() if lg.can_check else Fold()
        r = opp_pre_range(obs, self.opp)
        call = lg.call_amount
        req = call / (obs.pot + call)
        eq = equity_vs(info, obs, self.np_rng, r_pre=r, budget_ms=p["pre_budget_ms"])
        my_total = obs.my_stack + obs.my_pip
        allin_call = call >= obs.my_stack or obs.opp_stack == 0
        if allin_call or eff_bb <= p["push_fold_bb"] * 1.5:
            realize = 1.0
        else:
            realize = p["realize_ip"] if obs.position == 0 else p["realize_oop"]
        if lg.can_raise and obs.opp_stack > 0:
            mult = 3.5 if obs.position == 1 else 3.0
            if hv.pf_raises >= 2:
                mult = 2.3
            target = obs.opp_pip * mult
            share = p["three_bet_share"] if hv.pf_raises == 1 else p["four_bet_share"]
            jam = target >= 0.35 * my_total or eff_bb <= 25
            if jam:
                # shove: needs equity vs the calling part of the range
                if eq >= max(0.56, req + 0.05) and pct >= 1 - share * r - 0.02:
                    return shove(obs)
            else:
                if pct >= 1 - share * r and eq >= 0.52:
                    return raise_to(obs, target, allin_frac=0.35)
                if (hv.pf_raises == 1 and 0.4 <= pct <= 0.62 and eq * realize < req + 0.02
                        and self.rng.random() < p["bluff_3bet"]):
                    return raise_to(obs, target, allin_frac=0.35)
        if eq * realize >= req + 0.01:
            return Call()
        return Fold()

    # ---- postflop --------------------------------------------------------------------
    def _postflop(self, obs, hv):
        p, lg, info, om = self.p, obs.legal, self.info, self.opp
        r = opp_pre_range(obs, om)
        inc = 1.0 if om.aggression < 0.45 else 0.5
        m = 1.0 + inc * hv.opp_raises_street + 0.5 * inc * hv.opp_raises_prev + 0.3 * hv.opp_calls_prev
        if hv.opp_checked_street:
            m -= 0.3
        m = max(1.0, min(4.0, m))
        eq = equity_vs(info, obs, self.np_rng, r_pre=r, m_post=m, budget_ms=p["post_budget_ms"])
        last = hv.is_last_street
        rnd = self.rng.random()

        if lg.can_call:  # facing a bet or raise
            call = lg.call_amount
            req = call / (obs.pot + call)
            rthr = p["river_raise_thr"] if last else p["raise_thr"]
            if hv.raises_street >= 3:
                rthr = max(rthr, 0.88)
            if lg.can_raise and obs.opp_stack > 0 and eq >= rthr:
                return bet_pot(obs, 0.8, allin_frac=0.5)
            if (lg.can_raise and not last and hv.raises_street == 1 and 0.33 <= eq <= 0.5
                    and rnd < p["semibluff"] * min(1.5, om.fold_to_bet / 0.4)):
                return bet_pot(obs, 0.75, allin_frac=0.9)
            margin = 0.02 + (0.03 if (obs.position == 1 and not last) else 0.0)
            if eq >= req + margin:
                return Call()
            return Fold()

        # checked to me / first to act
        if not lg.can_raise:
            return Check()
        vthr = p["vthr"] - float(np.clip(0.4 - om.fold_to_bet, -0.1, 0.3)) * 0.2
        if eq >= vthr:
            if last:
                frac = 1.0 if eq >= 0.85 else 0.6
            else:
                frac = 0.75 if eq >= 0.8 else 0.55
            if obs.position == 1 and hv.my_raises_street == 0 and eq >= 0.9 and rnd < 0.25 and not last:
                return Check()  # occasional slowplay out of position
            return bet_pot(obs, frac)
        if obs.street == 1 and hv.i_am_pf_aggr and hv.my_raises_street == 0:
            freq = float(np.clip(p["cbet_base"] * om.fold_to_cbet / 0.45, 0.12, 0.85))
            if eq >= 0.4:
                freq = min(0.9, freq + 0.2)
            if rnd < freq:
                return bet_pot(obs, 0.4, allin_frac=0.9)
        elif not last and hv.i_bet_prev and 0.4 <= eq < vthr:
            if rnd < 0.3 * min(1.5, om.fold_to_bet / 0.4):
                return bet_pot(obs, 0.55, allin_frac=0.9)
        elif last and eq < 0.2 and hv.prev_last_raiser == obs.position:
            # river barrel with air after betting the turn, only vs folders
            if om.fold_to_bet > 0.45 and rnd < 0.25:
                return bet_pot(obs, 0.7, allin_frac=0.9)
        return Check()


def make_bot(**kw):
    return TagBot(**kw)
