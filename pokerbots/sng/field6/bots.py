"""The five field6 bots. All share core.Base (tight preflop, ICM push/fold at <= 10 bb, a
simple legal fallback in other card games); each one adds a distinct postflop weapon:

  f6_checkraiser  checks strong hands and strong draws out of position to check-raise,
                  and check-raises some bluffs against seats that c-bet the flop a lot;
  f6_floater      calls flop c-bets in position light and bets the turn when the
                  c-bettor checks, more often against seats that give up on the turn;
  f6_overbettor   polarised: 1.25-2x pot on the turn / river with the nuts and with
                  bluffs (bluffs scaled by the seat's fold-to-big-bet rate), a third of
                  the pot with medium hands;
  f6_riverbluffer bluffs rivers after a missed draw when the opponent checked the turn,
                  and value-bets thin against calling stations (river call rate, showdowns);
  f6_raiser       raises flop bets with draws (semi-bluff) and for value, light 3-bets
                  frequent openers preflop and folds to 4-bets without AA / KK.
"""
from __future__ import annotations

from engine.game import Call, Check

from .core import Base, Read, class_info


def _clip(x, lo, hi):
    return lo if x < lo else hi if x > hi else x


class CheckRaiser(Base):
    name = "f6_checkraiser"
    P = dict(Base.P, open_mult=0.95, call_k=0.55)

    def unbet(self, c, rd, e):
        st = c.street
        prev_checked_through = st >= 2 and c.checked_on(st - 1, c.me) and not c.bet_on(st - 1)
        if not c.ip and len(c.opps) <= 2 and c.spr > 1.2 and not prev_checked_through:
            strong = e >= 0.8 or rd.nutted
            sdraw = rd.strong_draw and not c.river and e < 0.8
            if strong or sdraw:
                if c.river:
                    pr = 0.45
                elif strong:
                    pr = 0.8 if st == 1 else 0.6
                else:
                    pr = 0.7
                # someone has to bet into us: likelier when an opponent is the aggressor
                if c.pfa is None or c.pfa == c.me:
                    pr *= 0.6
                if self.rand() < pr:
                    return Check()
        return super().unbet(c, rd, e)

    def facing(self, c, rd, e):
        if c.i_checked and c.lg.can_raise and len(c.raises) == 1 and len(c.opps) <= 2:
            b = c.bettor
            if e >= 0.78:
                return self.shove(c) if c.spr < 2.2 else self.raise_x(c, 3.0)
            if rd.strong_draw and not c.river and c.spr > 1.0:
                return self.raise_x(c, 3.0) if c.spr > 3.0 else self.shove(c)
            if st_is_flop_cbet(c, b) and len(c.opps) == 1 and c.bet_ratio() <= 0.8 and c.spr > 3.0:
                freq = _clip((self.stats.cbet_rate(b) - 0.55) * 1.5, 0.0, 0.45)
                if (rd.any_draw or rd.overs or e < 0.3) and self.rand() < freq:
                    return self.raise_x(c, 3.0)
        return super().facing(c, rd, e)


def st_is_flop_cbet(c, bettor):
    return c.street == 1 and bettor is not None and bettor == c.pfa and bettor != c.me


class Floater(Base):
    name = "f6_floater"
    P = dict(Base.P, call_k=0.5, barrel=0.4)

    def vs_open(self, c):
        obs = c.obs
        if c.me not in (obs.sb_seat, obs.bb_seat) and c.nb <= 3 and c.eff_bb >= 25:
            fr = self.opener_range(c, c.pfa)
            price = c.to_call / max(1, c.pot + c.to_call)
            if self.p["tb_value"] < c.pct <= 0.75 * fr and price < 0.36:
                return Call()                    # flat in position: floats come later
        return super().vs_open(c)

    def facing(self, c, rd, e):
        if st_is_flop_cbet(c, c.bettor) and c.ip and len(c.opps) == 1 and len(c.raises) == 1 \
                and c.bet_ratio() <= 0.85 and c.spr > 1.5:
            req = c.to_call / (c.pot + c.to_call)
            if e - self.discount(c) >= req:
                return super().facing(c, rd, e)
            hi = max(x >> 2 for x in c.obs.hole)
            something = rd.cat >= 1 or rd.any_draw or rd.overs or hi == 12
            if something:
                return Call()                    # the float
            gu = self.stats.turn_giveup(c.bettor)
            if self.rand() < 0.1 + 0.8 * max(0.0, gu - 0.3):
                return Call()
        return super().facing(c, rd, e)

    def unbet(self, c, rd, e):
        st = c.street
        if st >= 2 and c.ip and len(c.opps) == 1:
            opp = c.opps[0]
            prev_bets = c.bet_on(st - 1)
            floated = bool(prev_bets) and prev_bets[-1] == opp and c.called_on(st - 1, c.me)
            if floated and c.checked_on(st, opp):
                if e >= self.p["vb"]:
                    return self.value_bet(c, rd, 0.7)
                if c.river:
                    freq = 0.35
                else:
                    freq = _clip(0.55 + 0.8 * (self.stats.turn_giveup(opp) - 0.35), 0.45, 0.95)
                if self.rand() < freq:
                    return self.bet(c, 0.65)
                return Check()
            if c.river and c.me in prev_bets and c.checked_on(st, opp):
                if e >= 0.6:
                    return self.bet(c, 0.7)
                if e < 0.3 and self.rand() < 0.3:
                    return self.bet(c, 0.7)
                return Check()
        return super().unbet(c, rd, e)


class Overbettor(Base):
    name = "f6_overbettor"
    P = dict(Base.P, cbet=0.65, cbet_size=0.33, value_size=0.5)

    def _fold_big(self, c):
        return sum(self.stats.fold_big(s) for s in c.opps) / max(1, len(c.opps))

    def unbet(self, c, rd, e):
        if c.street < 2 or len(c.opps) > 2:
            return super().unbet(c, rd, e)
        fb = self._fold_big(c)
        if e >= 0.86 or rd.nutted:
            if c.spr < 0.9:
                return self.shove(c)
            size = 1.25 + 0.75 * _clip((0.6 - fb) / 0.3, 0.0, 1.0)   # callers get the big one
            return self.bet(c, size)
        hu = len(c.opps) == 1
        if hu and c.river and e < 0.3:
            if self.rand() < _clip(1.6 * (fb - 0.35), 0.04, 0.55):
                return self.bet(c, 1.4)
            return Check()
        if hu and not c.river and rd.draw and e < 0.6:
            if self.rand() < _clip(0.3 + 1.2 * (fb - 0.45), 0.1, 0.6):
                return self.bet(c, 1.3)
            return Check()
        if 0.5 <= e < 0.86:
            if c.river:
                if e >= 0.6 and self.rand() < 0.75:
                    return self.bet(c, 0.33)
            elif self.rand() < 0.6:
                return self.bet(c, 0.33)
        return Check()


class RiverBluffer(Base):
    name = "f6_riverbluffer"
    P = dict(Base.P, semibluff=0.2)

    def _station(self, c):
        rc = max(self.stats.river_call(s) for s in c.opps)
        wt = max(self.stats.wtsd(s) for s in c.opps)
        return rc, rc >= 0.55 or wt >= 0.42

    def unbet(self, c, rd, e):
        if c.river and len(c.opps) <= 2:
            rc, station = self._station(c)
            thr = 0.52 if station else 0.66
            if e >= thr:
                if c.spr < 1.0 and e >= 0.8:
                    return self.shove(c)
                return self.bet(c, 0.55 if e < 0.75 else 0.75)
            st = c.street
            weak = all(c.checked_on(st - 1, s) for s in c.opps) and not c.bet_on(st - 1)
            if weak and e < 0.32 and len(c.opps) == 1:
                missed = False
                if len(c.obs.board) >= 4:
                    prev = Read(c.obs.hole, c.obs.board[:-1], 1)
                    missed = prev.any_draw
                base = 0.65 if missed else 0.3
                freq = base * _clip((0.75 - rc) / 0.4, 0.0, 1.0)
                if self.rand() < freq:
                    return self.bet(c, 0.75)
            return Check()
        if not c.river and c.ip and rd.draw and c.e < 0.6 and self.rand() < 0.5:
            return Check()                       # take the free card: the river bluff is better
        return super().unbet(c, rd, e)


class Raiser(Base):
    name = "f6_raiser"
    P = dict(Base.P, jam_4b=0.0095)

    def light_3bet(self, c, fr):
        r = c.pfa
        st = self.stats
        orate = st.open_rate(r)
        if st.open_opp[r] < 8 or orate < 0.26 or c.eff_bb < 30:
            return False
        width = min(0.16, 0.05 + (orate - 0.2) * 0.4)
        hi, _lo, suited, pair = class_info(c.h)
        ok = suited or pair or hi >= 11
        return c.pct <= width and ok and self.rand() < 0.85

    def _faced_4bet(self, c):
        idx = [i for i, (s, _) in enumerate(c.pf_raises) if s == c.me]
        return bool(idx) and idx[-1] >= 1 and len(c.pf_raises) > idx[-1] + 1

    def vs_allin(self, c):
        if self._faced_4bet(c):
            return self.vs_4bet(c)
        return super().vs_allin(c)

    def facing(self, c, rd, e):
        if c.lg.can_raise and len(c.raises) == 1 and len(c.opps) <= 2 and not c.river \
                and c.bettor != c.me:
            raise_now = False
            if c.street == 1:
                if e >= 0.78:
                    raise_now = True
                elif rd.strong_draw:
                    raise_now = self.rand() < 0.85
                elif rd.draw:
                    raise_now = self.rand() < 0.6
                elif rd.gut and rd.overs:
                    raise_now = self.rand() < 0.2
            elif e >= 0.85:
                raise_now = True
            elif rd.strong_draw:
                raise_now = self.rand() < 0.35
            if raise_now:
                if c.spr < 2.0:
                    return self.shove(c)
                return self.raise_x(c, 3.0)
        if c.i_raised_here and len(c.raises) >= 2:
            req = c.to_call / (c.pot + c.to_call)
            if e >= 0.8:
                return self.shove(c) if e >= 0.9 else Call()
            if rd.draw and rd.p_improve + 0.05 >= req:
                return Call()
            return self.fold(c)
        return super().facing(c, rd, e)
