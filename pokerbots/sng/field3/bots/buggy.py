"""(5) A rushed team's tight-aggressive bot that shipped with two bugs:

  * units: the strategy works in big blinds, but bet sizes are passed to
    legal.clamp() still in big blinds (e.g. 2.5 or 0.6*pot/bb), so every open,
    bet and raise becomes a min-raise (only explicit all-ins are right);
  * position: 'players to act after me' is computed from absolute seat numbers
    on an assumed 8-seat table, so busted seats still count as players behind and
    the bot plays late position too tight once the table thins out.
"""
from __future__ import annotations

from engine.game import Call, Check, Fold, RaiseTo

from ..common import F3Bot, Spot
from ..postflop import hand_info

OPEN_BY_AFTER = {0: 0.45, 1: 0.40, 2: 0.35, 3: 0.26, 4: 0.20, 5: 0.16, 6: 0.13, 7: 0.11}
SEATS = 8


class BuggyBot(F3Bot):
    name = "f3_buggy"

    def _players_after(self, obs):
        pos = (obs.seat - obs.sb_seat) % SEATS     # SB = 0, BB = 1, UTG = 2, ... BTN = 7
        return (1 - pos) % SEATS                    # BUG: counts busted seats too

    def _bet(self, obs, size_bb):
        lg = obs.legal
        if not lg.can_raise:
            return lg.passive()
        return RaiseTo(lg.clamp(size_bb))         # BUG: size in big blinds, not chips

    def _jam(self, obs):
        lg = obs.legal
        return RaiseTo(lg.max_raise_to) if lg.can_raise else lg.passive()

    def decide(self, obs):
        sp = Spot(obs)
        bb = sp.bb
        if obs.street == 0:
            p = self.pf.pct(obs.hole)
            if sp.unopened:
                after = self._players_after(obs)
                x = OPEN_BY_AFTER.get(after, 0.11)
                if sp.stack_bb <= 12:
                    if p <= min(0.6, x * 1.5):
                        return self._jam(obs)
                    return Check() if obs.legal.can_check else Fold()
                if p <= x:
                    return self._bet(obs, 2.5 + sp.limpers)
                return Check() if obs.legal.can_check else Fold()
            if sp.facing_allin or sp.to_call >= 0.4 * sp.my_total:
                return Call() if p <= 0.06 else Fold()
            if p <= 0.04:
                return self._bet(obs, 3 * sp.last_raise_to / bb)
            if p <= 0.12 and sp.to_call <= 0.10 * sp.my_total:
                return Call()
            return Fold()
        hi = hand_info(obs.hole, obs.board, self.ev, self.spec)
        lv = hi.level
        pot_bb = obs.pot / bb
        if sp.to_call == 0:
            if lv >= 3 or (sp.i_was_pf_aggressor and sp.n_opp == 1 and obs.street == 1):
                return self._bet(obs, 0.6 * pot_bb)
            return Check()
        if lv >= 4:
            return self._bet(obs, 3 * sp.to_call / bb)
        if lv == 3:
            return Call()
        if lv == 2 and sp.pot_odds < 0.3:
            return Call()
        last = obs.street >= len(self.spec.board_cards_per_street) - 1
        if not last and hi.outs * 0.022 * (2 if obs.street == 1 else 1) >= sp.pot_odds:
            return Call()
        return Fold()
