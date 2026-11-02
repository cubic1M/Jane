"""f4_lag -- loose-aggressive pressure bot.

* Wide, small opens (2.0-2.1 bb), wider again against blinds that over-fold and when I
  cover the stacks behind me (chip-leader bullying).
* Resteals: 3-bet shoves over late-position opens up to RESTEAL_BB; deep light 3-bets.
* Push/fold up to PUSH_BB with wide shove ranges; calls shoves on near-chip-EV odds.
* Postflop: frequent small c-bets, turn barrels with equity, draws or scare cards,
  river bluffs with busted draws, semi-bluff raises with combo draws, probes in position.
"""
from __future__ import annotations

from engine.game import Call, Check, Fold

from .base import F4Bot, HU_PCT, MW_PCT, eq_vs_range



class PressureLag(F4Bot):
    OPEN_PCT = {"EP": 0.18, "MP": 0.22, "HJ": 0.26, "CO": 0.36, "BTN": 0.52, "SB": 0.50, "BB": 0.0}
    PUSH_BB = 16.0
    RESTEAL_BB = 26.0
    CALL_PEN = 0.13         # equity discount per bet faced this street
    CALL_MARGIN = 0.05
    CBET_HU = 0.65
    PROBE = 0.2
    RIVER_BLUFF = 0.2
    DRAW_CALL = 0.11        # call a draw on odds when the call is at most this share of the stack
    name = "f4_lag"

    def decide(self, obs, c):
        if obs.street == 0:
            return self.preflop(obs, c)
        return self.postflop(obs, c)

    def bully(self, obs, c):
        if not c.behind:
            return 1.0
        biggest = max(obs.seats[j].stack + obs.seats[j].bet for j in c.behind)
        return 1.25 if c.total >= 1.4 * biggest else 1.0

    def preflop(self, obs, c):
        lg = obs.legal
        T = self.tracker
        bb = c.bb
        cls = c.cls
        hp = HU_PCT[cls]
        mp = MW_PCT[cls]
        bully = self.bully(obs, c)
        if c.n_raises == 0:
            if c.eff_bb <= self.PUSH_BB:
                n_b = max(1, len(c.behind) + c.limpers)
                pct = 0.95 / (n_b + 0.6) ** 0.8 * (10.0 / max(c.eff_bb, 2.0)) ** 0.75 * bully
                if c.limpers:
                    pct *= 0.75
                # medium stacks behind under ICM pressure fold more: push a bit wider into them
                if obs.players_left <= 5:
                    pct *= 1.1
                pct = min(0.95, pct)
                if c.pos == "BB" and lg.can_check and hp > pct:
                    return Check()
                if hp <= pct:
                    return self.allin(obs)
                return self.passive(obs)
            pct = self.OPEN_PCT.get(c.pos, 0.18) * bully
            blinds = [j for j in c.behind if j in (obs.sb_seat, obs.bb_seat)]
            if blinds and c.pos in ("CO", "BTN", "SB", "HJ"):
                f = sum(T.fold_to_steal(j) for j in blinds) / len(blinds)
                pct *= min(1.5, max(0.75, 1 + 1.0 * (f - 0.6)))
            if c.limpers:
                if mp <= 0.18 * bully:
                    return self.raise_to(obs, (3.5 + c.limpers) * bb)
                if c.pos == "BB":
                    return Check()
                if mp <= 0.3 and c.ip:
                    return Call()
                return self.passive(obs)
            if mp <= min(0.85, pct):
                return self.raise_to(obs, (2.0 if c.eff_bb < 25 else 2.1) * bb)
            return self.passive(obs)

        raiser = c.last_raiser
        rs = obs.seats[raiser]
        r_tot = rs.stack + rs.bet
        call = lg.call_amount
        pot = obs.pot
        need = call / (pot + call)
        if c.facing_allin or call >= 0.5 * obs.my_stack:
            depth = min(c.total, r_tot) / bb
            pct = min(0.85, 0.08 + 2.4 / max(depth, 1.0))
            pct *= min(2.0, max(0.6, T.push_rate(raiser) / 0.25)) ** 0.7
            if c.n_raises > 1:
                pct *= 0.6
            eq = eq_vs_range(cls, min(0.9, pct))
            others = sum(1 for j in c.opps if j != raiser and obs.seats[j].bet >= rs.bet)
            eq -= 0.08 * others
            if eq >= need + 0.015:
                return self.allin(obs) if lg.can_raise and not c.facing_allin else Call()
            return self.passive(obs)
        if c.n_raises == 1:
            opener_rate = T.open_rate(raiser)
            late = raiser in self._late(obs)
            # resteal shove
            if c.eff_bb <= self.RESTEAL_BB and lg.can_raise and c.callers == 0:
                rng_pct = 0.18 * min(2.0, max(0.5, opener_rate / 0.25)) * (1.2 if late else 0.8)
                if hp <= min(0.4, rng_pct) or hp <= 0.06:
                    return self.allin(obs)
            three_to = 3.0 * c.last_raise_to + c.callers * c.last_raise_to
            if hp <= 0.05 or mp <= 0.05:
                return self.raise_to(obs, three_to)
            if opener_rate >= 0.22 and 0.05 < mp <= 0.16 and self.rng.random() < 0.5 and lg.can_raise:
                return self.raise_to(obs, three_to)
            if call <= 0.10 * c.eff and (mp <= (0.25 if c.ip else 0.15) or (cls // 13 == cls % 13)):
                return Call()
            if c.pos == "BB" and call <= 2 * bb and mp <= 0.45:
                return Call()
            return self.passive(obs)
        if hp <= 0.05:
            return self.allin(obs)
        if hp <= 0.09 and c.ip and call <= 0.2 * c.eff:
            return Call()
        return self.passive(obs)

    def _late(self, obs):
        n = len(obs.seats)
        out = {obs.button, obs.sb_seat}
        for k in range(1, n):
            j = (obs.button - k) % n
            if obs.seats[j].in_hand:
                out.add(j)
                break
        return out

    def postflop(self, obs, c):
        lg = obs.legal
        T = self.tracker
        k = max(1, len(c.opps))
        made, draw, tex, _ = self.feats(obs)
        eq = self.street_eq(obs, c, k)
        pot = obs.pot
        st = obs.street
        r = self.rng.random()
        if c.to_call == 0:
            if not lg.can_raise:
                return Check()
            if eq >= 0.66:
                return self.raise_to(obs, obs.my_bet + (0.7 if st == 3 else 0.6) * pot)
            if c.pfr == obs.seat:
                if st == 1:
                    if k == 1 and r < self.CBET_HU:
                        return self.raise_to(obs, 0.4 * pot)
                    if k == 2 and (eq >= 0.35 or draw >= 2) and r < 0.6:
                        return self.raise_to(obs, 0.5 * pot)
                elif st == 2 and k == 1 and self._bet_on(obs, 1):
                    scare = (obs.board[3] >> 2) > max(b >> 2 for b in obs.board[:3])
                    if eq >= 0.45 or draw >= 2 or (scare and r < 0.55):
                        return self.raise_to(obs, 0.6 * pot)
                elif st == 3 and k == 1 and self._bet_on(obs, 2):
                    if made <= 2 and r < self.RIVER_BLUFF * min(1.5, T.fold_to_bet(c.opps[0]) / 0.45):
                        return self.raise_to(obs, 0.7 * pot)
            if k == 1 and c.ip and st < 3 and (eq >= 0.4 or draw >= 2 or r < self.PROBE):
                return self.raise_to(obs, 0.5 * pot)
            return Check()
        call = c.to_call
        need = call / (pot + call)
        adj = eq - self.CALL_PEN * c.bets_faced
        if lg.can_raise:
            if adj >= 0.80:
                return self.raise_to(obs, 3 * c.last_raise_to)
            if st == 1 and draw == 4 and c.bets_faced == 1 and r < 0.6:
                return self.raise_to(obs, 3 * c.last_raise_to)
        if call >= 0.5 * obs.my_stack:
            need += 0.04
        if adj >= need + self.CALL_MARGIN:
            return Call()
        if st < 3 and draw >= 2 and eq >= need - 0.06 and call <= self.DRAW_CALL * c.eff:
            return Call()
        return Fold()

    def _bet_on(self, obs, street):
        for (s, stt, kind, amt) in obs.history:
            if stt == street and s == obs.seat and kind == "raise":
                return True
        return False
