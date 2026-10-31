"""opp_lag: a loose-aggressive pressure bot.

Plan (what a team picks when it expects many bots to over-fold):
  * Preflop: open ~80% of buttons, iso-raise limps, 3-bet a value range plus a
    wide bluff band, 4-bet/shove light at shallow depth; push/fold when short.
  * Postflop: Monte Carlo equity against a range that narrows with the
    opponent's actions. Big sizes: 2/3-pot c-bets, near-pot turn barrels, pot or
    overbet rivers, shoves when the stack-to-pot ratio is small.
  * Barrels scare cards (overcards, flush/straight completers, board pairs) and
    keeps betting draws, but pure air only bluffs at a limited, size-balanced
    frequency so it does not burn money on every street.
  * Light adaptation: tracks how often the opponent folds to its bets and scales
    bluff frequency (more vs over-folders, far less vs calling stations).
Everything is read from the spec, so it plays every variant (discards included).
"""
from __future__ import annotations

import numpy as np

from engine.bot import Bot
from engine.game import CALL, CHECK, FOLD, RAISE, Fold, RaiseTo

from . import _common as C

PARAMS = dict(
    open_frac=0.82,        # SB opens this share of hands
    iso_frac=0.65,         # BB raises this share vs a limp
    three_bet_value=0.86,  # percentile for value 3-bets
    three_bet_bluff=0.40,  # probability of 3-betting a hand in the bluff band
    bluff_band=(0.45, 0.86),
    shove_bb=13,           # push/fold below this many big blinds
    shove_frac=0.58,       # push this share of hands when short
    cbet_air=0.60,         # flop c-bet frequency with air
    barrel_air=0.35,       # turn barrel with air (no scare card)
    scare_bonus=0.30,
    river_bluff=0.30,
    value_eq=0.70,
    budget_ms=3.0,
)


class LagBot(Bot):
    name = "opp_lag"

    def __init__(self, **kw):
        self.p = dict(PARAMS)
        self.p.update(kw)

    def new_match(self, spec, seed=0):
        super().new_match(spec, seed)
        self.np = np.random.default_rng(seed)
        C.warm_up(spec)
        # opponent fold-to-our-bet (postflop + preflop opens), Beta prior
        self.fold_n = 4.5
        self.fold_d = 10.0

    # ------------------------------------------------------------------ helpers
    def _fold_factor(self) -> float:
        f = self.fold_n / self.fold_d
        return float(np.clip(f / 0.45, 0.25, 1.7))

    def _eq(self, obs, frac):
        return C.equity(obs, self.spec, self.np, self.p["budget_ms"], frac)

    # ------------------------------------------------------------------ act
    def act(self, obs):
        lg = obs.legal
        if lg.discard_count:
            return C.best_discard(obs, self.spec, self.np)
        try:
            a = self._preflop(obs) if obs.street == 0 else self._postflop(obs)
        except Exception:
            a = lg.passive()
        if not lg.is_legal(a):
            a = lg.passive() if (lg.can_check or lg.can_call) else Fold()
        return a

    # ------------------------------------------------------------------ preflop
    def _preflop(self, obs):
        sp, lg, p = self.spec, obs.legal, self.p
        bb = sp.big_blind
        pct = C.preflop_pct(sp, obs.my_cards)
        nr = C.raises_on(obs.history, 0)
        eff_bb = (min(obs.my_stack + obs.my_pip, obs.opp_stack + obs.opp_pip)) / bb
        r = self.rng.random()

        # push/fold when short
        if eff_bb <= p["shove_bb"]:
            if nr == 0 and obs.position == 0:
                return RaiseTo(lg.max_raise_to) if (lg.can_raise and pct >= 1 - p["shove_frac"]) else (
                    lg.passive() if pct >= 0.30 else Fold())
            if lg.can_check and nr == 0:
                return RaiseTo(lg.max_raise_to) if (lg.can_raise and pct >= 0.45) else lg.passive()
            eq = self._eq(obs, 0.55 if nr <= 1 else 0.35)
            po = lg.call_amount / (obs.pot + lg.call_amount)
            if eq >= po + 0.01:
                if lg.can_raise and eq > 0.55:
                    return RaiseTo(lg.max_raise_to)
                return lg.passive()
            return Fold()

        # unopened pot, SB acts first
        if nr == 0 and obs.position == 0 and lg.can_call:
            if pct >= 1 - p["open_frac"] and lg.can_raise:
                size = 2.5 if eff_bb < 40 else (3.0 if r < 0.6 else 2.5)
                if pct >= 0.97 and r < 0.3:
                    size = 3.5
                return RaiseTo(lg.clamp_raise(size * bb))
            return lg.passive() if pct >= 0.10 and r < 0.4 else Fold()

        # BB vs a limp
        if nr == 0 and lg.can_check:
            if lg.can_raise and (pct >= 1 - p["iso_frac"] or (pct >= 0.25 and r < 0.15)):
                return RaiseTo(lg.clamp_raise(4 * bb if r < 0.7 else 5 * bb))
            return lg.passive()

        # facing a raise
        call = lg.call_amount
        po = call / (obs.pot + call)
        raise_sz = obs.opp_pip / bb
        rng_frac = {1: 0.65, 2: 0.32, 3: 0.16}.get(nr, 0.09)
        if obs.opp_stack == 0 or raise_sz * bb >= 0.6 * (obs.opp_pip + obs.opp_stack):
            rng_frac *= 0.7
        eq = self._eq(obs, rng_frac)
        pot_after = obs.pot + call
        # re-raise size: 3x the raise in position, 3.7x out of position; 2.3x for 4-bets
        mult = (3.0 if obs.position == 0 else 3.7) if nr == 1 else 2.3
        target = lg.clamp_raise(obs.opp_pip * mult)
        commit = target >= 0.4 * (obs.my_stack + obs.my_pip)
        if commit:
            target = lg.max_raise_to
        value = eq >= {1: 0.60, 2: 0.58, 3: 0.56}.get(nr, 0.55)
        lo, hi = p["bluff_band"]
        bluff = (nr <= 2 and lo <= pct < hi and eq >= 0.33
                 and r < (p["three_bet_bluff"] if nr == 1 else 0.12) * min(1.3, self._fold_factor()))
        if lg.can_raise and (value or (bluff and not commit)):
            return RaiseTo(target)
        implied = 0.05 if (nr == 1 and eff_bb > 40) else (0.02 if nr == 1 else 0.0)
        if eq >= po - implied:
            return lg.passive()
        return Fold()

    # ------------------------------------------------------------------ postflop
    def _range_frac(self, obs):
        me, opp = obs.position, 1 - obs.position
        pre_aggr = C.last_aggressor(obs.history, 0)
        frac = 0.55 if pre_aggr == opp else (0.85 if pre_aggr == me else 1.0)
        # opponent aggression on earlier postflop streets narrows its range
        for st in range(1, obs.street):
            if C.opp_raised_on(obs.history, st, opp):
                frac *= 0.6
            elif any(r.street == st and r.kind == CALL and r.position == opp for r in obs.history):
                frac *= 0.8
        return max(frac, 0.12)

    def _postflop(self, obs):
        sp, lg, p = self.spec, obs.legal, self.p
        me, opp = obs.position, 1 - obs.position
        river = C.is_last_street(obs, sp) and obs.board_cards_to_come == 0
        scare = C.scare_card(obs, sp)
        frac = self._range_frac(obs)
        spr = C.eff_stack(obs) / max(1, obs.pot)
        prev = obs.street - 1
        was_aggr = C.last_aggressor(obs.history, prev) == me
        ff = self._fold_factor()
        r = self.rng.random()

        if lg.call_amount == 0:
            eq = self._eq(obs, frac)
            if not lg.can_raise:
                return lg.passive()
            if eq >= p["value_eq"]:
                if spr < 1.3 or (river and eq > 0.88 and r < 0.35):
                    return RaiseTo(lg.max_raise_to)
                if river:
                    size = 1.5 if (eq > 0.85 and r < 0.5) else 1.0
                else:
                    size = 0.7 if obs.street == 1 else 0.9
                return RaiseTo(C.bet_to(obs, size))
            if eq >= 0.50:
                bet_p = 0.55 if not river else 0.35
                if r < bet_p:
                    return RaiseTo(C.bet_to(obs, 0.6))
                return lg.passive()
            if not river and eq >= 0.32:
                bet_p = (0.75 if was_aggr else 0.5) + (0.15 if scare else 0.0)
                if r < bet_p:
                    size = 0.7 if obs.street == 1 else 0.9
                    return RaiseTo(C.bet_to(obs, size))
                return lg.passive()
            # air: a limited, fold-equity-scaled bluff frequency
            if river:
                bp = p["river_bluff"] + (p["scare_bonus"] if scare else 0) + (0.1 if was_aggr else 0)
                size = 1.25 if r < 0.5 else 0.9
            elif obs.street == 1:
                bp = p["cbet_air"] if was_aggr else 0.40
                size = 0.66
            else:
                bp = (p["barrel_air"] if was_aggr else 0.25) + (p["scare_bonus"] if scare else 0)
                size = 0.85
            if eq < 0.12:
                bp *= 0.6
            if self.rng.random() < bp * ff:
                if spr < 1.6:
                    return RaiseTo(lg.max_raise_to)
                return RaiseTo(C.bet_to(obs, size))
            return lg.passive()

        # facing a bet or raise
        call = lg.call_amount
        po = call / (obs.pot + call)
        bet_frac = call / max(1, obs.pot - call)
        nr = C.raises_on(obs.history, obs.street)
        f2 = frac * (0.6 if bet_frac <= 0.5 else 0.5 if bet_frac <= 1.1 else 0.4)
        f2 *= 0.6 ** max(0, nr - 1)
        eq = self._eq(obs, f2)
        if lg.can_raise:
            if eq >= (0.86 if river else 0.75):
                target = C.bet_to(obs, 0.9)
                if spr < 2.0 or target >= 0.45 * (obs.my_stack + obs.my_pip):
                    target = lg.max_raise_to
                return RaiseTo(target)
            if (not river and nr == 1 and 0.33 <= eq < 0.55 and r < 0.22 * ff):
                return RaiseTo(C.bet_to(obs, 0.9))
            if river and nr == 1 and eq < 0.2 and bet_frac < 0.55 and r < 0.10 * ff:
                return RaiseTo(C.bet_to(obs, 1.1))
        margin = {1: -0.03, 2: 0.0}.get(obs.street, 0.02) if not river else 0.02
        if eq >= po + margin:
            return lg.passive()
        if obs.street == 1 and me == 0 and po < 0.3 and eq >= po - 0.07 and r < 0.5:
            return lg.passive()   # float in position, planning to take it away later
        return Fold()

    # ------------------------------------------------------------------ learning
    def end_hand(self, result):
        me, opp = result.position, 1 - result.position
        decay = 0.995
        for rec, pot, pips, to_call in C.replay(result.history, self.spec):
            if rec.position != opp or to_call <= 0:
                continue
            if rec.street == 0 and pips[me] <= self.spec.big_blind:
                continue  # facing only the blind, not our bet
            self.fold_n = self.fold_n * decay + (1.0 if rec.kind == FOLD else 0.0)
            self.fold_d = self.fold_d * decay + 1.0


def make_bot(**kw):
    return LagBot(**kw)
