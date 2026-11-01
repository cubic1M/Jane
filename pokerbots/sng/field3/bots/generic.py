"""(1) What a coding agent writes from 'write a strong poker bot': Chen formula
preflop, made-hand strength and pot odds postflop, no stack-depth or ICM awareness."""
from __future__ import annotations

from engine.game import Call, Check, Fold, RaiseTo

from ..common import F3Bot, Spot, allin, raise_to_pot_frac
from ..postflop import hand_info
from ..preflop import chen_multi

EQ_BY_LEVEL = {5: 0.90, 4: 0.78, 3: 0.62, 2: 0.45, 1: 0.30, 0: 0.12}


class GenericBot(F3Bot):
    name = "f3_generic"

    def decide(self, obs):
        sp = Spot(obs)
        if obs.street == 0:
            return self.preflop(obs, sp)
        return self.postflop(obs, sp)

    def _raise(self, obs, sp, to):
        if (to - obs.my_bet) >= 0.4 * sp.my_total:
            return allin(obs)
        return RaiseTo(to)

    def preflop(self, obs, sp):
        lg = obs.legal
        c = chen_multi(obs.hole)
        bb = sp.bb
        late = sp.n_behind <= 2
        if sp.unopened:
            if c >= 9 or (c >= 8 and sp.n_behind <= 4) or (c >= 7 and late):
                return self._raise(obs, sp, 3 * bb + sp.limpers * bb)
            if lg.can_check:
                return Check()
            if c >= 6 and sp.to_call <= bb and (sp.limpers or obs.seat == obs.sb_seat):
                return Call()
            return Fold()
        frac = sp.to_call / max(1, sp.my_total)
        if c >= 12:
            return self._raise(obs, sp, 3 * sp.last_raise_to)
        if c >= 11:
            return Call()
        if c >= 10 and frac <= 0.35:
            return Call()
        if c >= 8 and frac <= 0.08:
            return Call()
        if c >= 7 and late and frac <= 0.04:
            return Call()
        return Fold()

    def postflop(self, obs, sp):
        hi = hand_info(obs.hole, obs.board, self.ev, self.spec)
        lv = hi.level
        last = obs.street >= len(self.spec.board_cards_per_street) - 1
        if sp.to_call == 0:
            if lv >= 4:
                return self._raise(obs, sp, raise_to_pot_frac(obs, 0.75))
            if lv == 3:
                return RaiseTo(raise_to_pot_frac(obs, 0.6))
            if lv == 2 and sp.n_opp <= 2 and self.rng.random() < 0.5:
                return RaiseTo(raise_to_pot_frac(obs, 0.5))
            if sp.i_was_pf_aggressor and obs.street == 1 and sp.n_opp == 1 and self.rng.random() < 0.5:
                return RaiseTo(raise_to_pot_frac(obs, 0.5))
            if hi.outs >= 8 and self.rng.random() < 0.25:
                return RaiseTo(raise_to_pot_frac(obs, 0.5))
            return Check()
        eq = EQ_BY_LEVEL[lv]
        if not last:
            eq = max(eq, hi.outs * (4 if obs.street == 1 else 2) / 100.0)
        eq *= 0.85 ** (sp.n_opp - 1)
        if lv >= 4 and obs.legal.can_raise:
            return self._raise(obs, sp, raise_to_pot_frac(obs, 1.0))
        if eq > sp.pot_odds:
            return Call()
        return Fold()
