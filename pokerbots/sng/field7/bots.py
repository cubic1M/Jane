"""The five field7 bots. All share core.Base (ICM push/fold, all-in calls and resteals with
per-opponent bubble factors, a legal fallback in any card game); each one has its own
style:

  f7_balanced   equilibrium-minded: position opening ranges with mixed borders, a 3-bet
                range of value hands plus bluffs (suited wheel aces, suited connectors) in
                a fixed ratio, 4-bets and 4-bet bluffs, flats 3-bets in position with pairs
                and suited connectors when deep; protected checking ranges postflop and
                river bluffs in proportion to the bet size;
  f7_bully      ICM big-stack bully: when it covers the players behind and they carry a big
                bubble factor against it, it opens, resteals and shoves very wide, presses
                postflop; tightens when it is short or covered;
  f7_trickster  limps and min-raises strong hands, flats a lot (traps AA/KK), limp-reraises,
                slow-plays the flop and check-raises the turn, mixes donks and block bets;
                no frequency tells;
  f7_hackathon  a day's work: Monte Carlo equity against plausible ranges with a sample cap
                and a time guard, pot-odds calls, bets sized by equity, push/fold by stack
                depth with a small ICM margin;
  f7_profiler   adaptive exploiter: picks the leakiest seat in the hand from per-seat stats
                (wide openers who fold to 3-bets, limpers, stations, nits, c-bet folders)
                and plays against that seat's leak.
"""
from __future__ import annotations

import time

from engine.game import Call, Check, Fold

from .core import (EQR, PCT, Base, class_info, clip, eq_top, hclass, push_range,
                   score_cards)


def wheel_ace(h):
    hi, lo, suited, _ = class_info(h)
    return suited and hi == 12 and lo <= 3


def suited_connector(h, gap=1, lo_min=2, lo_max=8):
    hi, lo, suited, _ = class_info(h)
    return suited and 1 <= hi - lo <= gap and lo_min <= lo <= lo_max


def is_pair(h):
    return class_info(h)[3]


def later(c, a, b):
    """Seat a acts after seat b postflop."""
    n, btn = c.n, c.obs.button
    return (a - btn - 1) % n > (b - btn - 1) % n


# ======================================================================== f7_balanced
class Balanced(Base):
    name = "f7_balanced"
    P = dict(Base.P, open_size=2.2, tb_k=0.18, call_k=0.5, cbet=0.6, cbet_size=0.38, barrel=0.5,
             semibluff=0.3, xr_freq=0.35, river_bluff=0.25)

    def unopened(self, c):
        rng = self.open_range(c)
        if c.pct <= rng * 0.9:
            return self.raise_to(c, self.open_amount(c))
        if c.pct <= rng * 1.12 and self.rand() < 0.5:        # mixed border
            return self.raise_to(c, self.open_amount(c))
        return self.fold(c)

    def bluff_candidate(self, c):
        return wheel_ace(c.h) or suited_connector(c.h, 1, 3, 8)

    def vs_open(self, c):
        p = self.p
        r = c.pfa
        fr = self.opener_range(c, r)
        value = max(0.025, p["tb_k"] * fr)
        if c.pct <= value:
            return self.three_bet(c)
        deep = c.eff_bb >= 32
        if deep and len(c.callers) <= 1 and self.bluff_candidate(c):
            # ~0.8 bluff combos per value combo; the candidate pool is ~3% of hands
            if self.rand() < clip(0.8 * value / 0.03, 0.15, 0.9):
                return self.three_bet(c)
        ip = later(c, c.me, r)
        if c.me == c.obs.bb_seat:
            k = 0.85
        elif c.me == c.obs.sb_seat:
            k = 0.3
        else:
            k = 0.5 if ip else 0.35
        if c.pct <= k * fr and c.price < 0.38 and c.eff_bb >= 22:
            return Call()
        # set-mining and suited connectors in position when deep and cheap
        if ip and c.eff_bb >= 40 and c.to_call <= 0.06 * c.eff and len(c.pf_raises) == 1 and \
                (is_pair(c.h) or suited_connector(c.h, 1, 3, 9)):
            return Call()
        return self.fold(c)

    def vs_3bet(self, c):
        tb = c.pfa
        tbr = clip(self.stats.threebet_rate(tb) * 1.4, 0.03, 0.3)
        value = max(0.015, 0.33 * tbr)
        if c.pct <= value:
            if c.eff_bb <= 45:
                return self.shove(c)
            return self.raise_x(c, 2.25)
        if c.eff_bb >= 50 and wheel_ace(c.h) and class_info(c.h)[1] >= 2 and self.rand() < 0.4:
            return self.raise_x(c, 2.25)                    # 4-bet bluff (A5s, A4s)
        ip = later(c, c.me, tb)
        if c.eff_bb >= 40 and c.to_call <= 0.12 * c.eff and ip and c.pct <= 0.35 and \
                (is_pair(c.h) or suited_connector(c.h, 1, 3, 9) or (class_info(c.h)[2] and c.pct <= 0.1)):
            return Call()
        if c.pct <= 0.06 and c.price < 0.42 and c.eff_bb >= 30:
            return Call()
        return self.fold(c)

    def vs_4bet(self, c):
        if c.pct <= 0.012:
            return self.shove(c)
        if c.pct <= 0.03 and c.eff_bb <= 60 and self.stats.threebet_rate(c.pfa) > 0.08:
            return self.shove(c)
        return self.fold(c)

    # postflop: protected checking range, check-raises, river bluffs in proportion
    def unbet(self, c, rd, e):
        hu = len(c.opps) == 1
        if c.river and hu:
            if e >= 0.72:
                return self.bet(c, 0.66)
            if e < 0.2 and self.rand() < self.p["river_bluff"]:     # ~1 bluff per 2-3 value bets
                return self.bet(c, 0.66)
            return Check()
        if not c.ip and c.pfa is not None and c.pfa != c.me and hu and c.spr > 1.5:
            if (e >= 0.8 or rd.strong_draw) and self.rand() < self.p["xr_freq"]:
                return Check()                               # check to raise
        return super().unbet(c, rd, e)

    def facing(self, c, rd, e):
        if c.i_checked and c.lg.can_raise and len(c.raises) == 1 and len(c.opps) == 1 and c.spr > 1.2:
            if e >= 0.8:
                return self.shove(c) if c.spr < 2.5 else self.raise_x(c, 3.0)
            if rd.strong_draw and not c.river and self.rand() < 0.5:
                return self.raise_x(c, 3.0) if c.spr > 3 else self.shove(c)
        return super().facing(c, rd, e)


# =========================================================================== f7_bully
class Bully(Base):
    name = "f7_bully"
    need_bfo = True
    P = dict(Base.P, open_size=2.0, cbet=0.7, cbet_size=0.5, barrel=0.55, pf_bb=13.0)

    def covers(self, c, j):
        return c.my_total >= c.start[j]

    def edge(self, j):
        """How much more seat j risks than I do in an all-in between us (ICM asymmetry)."""
        return self.bfo[j] - self.bf[j]

    def pressure(self, c, seats):
        """Average ICM pressure I put on these seats (the asymmetry if I cover them;
        negative when they cover me)."""
        if not seats:
            return 0.0
        tot = 0.0
        for j in seats:
            tot += max(0.0, self.edge(j)) if self.covers(c, j) else -0.4
        return tot / len(seats)

    def big(self, c):
        """I am among the two biggest stacks and not short."""
        alive = sorted((s for s in c.start if s > 0), reverse=True)
        return c.my_total / c.bb >= 18 and len(alive) >= 2 and c.my_total >= alive[min(1, len(alive) - 1)]

    def shorties(self, c):
        return sum(1 for j, s in enumerate(c.start) if s > 0 and j != c.me and s / c.bb <= 9)

    def unopened(self, c):
        behind = c.behind()
        if not behind or not self.big(c):
            return super().unopened(c)
        prs = self.pressure(c, behind)
        mult = 1.0 + 1.6 * max(0.0, prs) + (0.25 if self.shorties(c) and prs > 0.2 else 0.0)
        rng = min(0.92, self.open_range(c) * mult)
        cap = 0.6 + 0.1 * (3 - min(3, len(behind)))      # the junk we shove shrinks with callers
        if all(self.covers(c, j) for j in behind) and c.eff_bb <= 18 and c.pct <= cap:
            perceived = clip(push_range(c.eff_bb, c.nb) * 1.5, 0.05, 1.0)
            if self.push_ev(c, perceived=perceived, opp_bf=self.field_bf()) > 0.0:
                return self.shove(c)
        if c.pct <= rng:
            return self.raise_to(c, self.open_amount(c))
        return self.fold(c)

    def field_bf(self):
        """Opponents respect ICM only partly: shrink their bubble factors against me."""
        return [1.0 + 0.65 * (b - 1.0) for b in self.bfo]

    def push_fold(self, c):
        behind = c.behind()
        covered = behind and all(self.covers(c, j) for j in behind)
        perceived = push_range(c.eff_bb, c.nb) * (1.4 if covered else 1.0)
        ev = self.push_ev(c, perceived=clip(perceived, 0.03, 1.0), opp_bf=self.field_bf())
        margin = 0.0 if covered else 0.08        # short or covered: tighter
        if ev > margin:
            return self.shove(c)
        return self.fold(c)

    def vs_open(self, c):
        r = c.pfa
        if self.covers(c, r) and self.big(c) and self.edge(r) >= 0.3 and not c.callers:
            fr = self.opener_range(c, r)
            if c.eff_bb <= 35:
                return self.resteal(c)
            if c.pct <= clip(fr * 0.4 * (1.0 + self.edge(r)), 0.03, 0.4):
                return self.raise_to(c, self.three_bet_amount(c))
        return super().vs_open(c)

    def resteal(self, c):
        if not self.covers(c, c.pfa):
            # covered by the raiser: only clear value
            if c.pct <= 0.04:
                return self.shove(c)
            return self.fold(c)
        return super().resteal(c)

    def unbet(self, c, rd, e):
        if len(c.opps) == 1 and c.pfa == c.me:
            o = c.opps[0]
            if self.covers(c, o) and self.edge(o) >= 0.3:
                if e >= self.p["vb"]:
                    return self.value_bet(c, rd)
                if c.street == 1 and self.rand() < 0.88:
                    return self.bet(c, 0.5)
                if c.street == 2 and c.me in c.bet_on(1) and self.rand() < 0.65:
                    return self.bet(c, 0.6)
        return super().unbet(c, rd, e)

    def discount(self, c):
        d = super().discount(c)
        if c.bettor is not None and not self.covers(c, c.bettor):
            d += 0.05 * (self.bf[c.bettor] - 1.0)
        return d


# ======================================================================= f7_trickster
class Trickster(Base):
    name = "f7_trickster"
    P = dict(Base.P, open_size=2.5, cbet=0.45, cbet_size=0.5, barrel=0.4, vb=0.74, semibluff=0.25,
             discount=0.03)

    def limp(self, c):
        return Check() if c.lg.can_check else Call()

    def unopened(self, c):
        rng = self.open_range(c)
        deep = c.eff_bb >= 25
        if c.pct <= 0.035:
            if deep and c.nb >= 3 and self.rand() < 0.45:
                return self.limp(c)
            if self.rand() < 0.6:
                return self.raise_to(c, 2 * c.bb)
            return self.raise_to(c, self.open_amount(c))
        if c.pct <= rng:
            if deep and c.nb >= 3 and (is_pair(c.h) or suited_connector(c.h, 2, 2, 9)) and self.rand() < 0.4:
                return self.limp(c)
            if self.rand() < 0.3:
                return self.raise_to(c, 2 * c.bb)
            return self.raise_to(c, self.open_amount(c))
        if c.me == c.obs.sb_seat and c.nplayers > 2 and deep and c.pct <= 0.55 and c.to_call <= c.bb:
            return Call()                                   # complete the small blind
        return self.fold(c)

    def vs_limpers(self, c):
        if c.pct <= 0.04:
            if self.rand() < 0.35:
                return self.limp(c)
            return self.raise_to(c, (4 + len(c.limpers)) * c.bb)
        if c.lg.can_check:
            if c.pct <= 0.15 and self.rand() < 0.3:
                return self.raise_to(c, (3.5 + len(c.limpers)) * c.bb)
            return Check()
        if c.eff_bb >= 25 and c.pct <= 0.4 and c.to_call <= c.bb:
            return Call()
        return Fold()

    def vs_open(self, c):
        if c.i_limped:
            if c.pct <= 0.035:                            # the limp-reraise
                if c.eff_bb <= 35:
                    return self.shove(c)
                return self.raise_x(c, 3.5)
            if c.pct <= 0.15 and c.price < 0.35:
                return Call()
            return self.fold(c)
        fr = self.opener_range(c, c.pfa)
        deep = c.eff_bb >= 30
        if c.pct <= 0.02:
            if deep and self.rand() < 0.5:
                return Call()                              # trap
            return self.three_bet(c)
        if c.pct <= 0.06:
            return self.three_bet(c) if self.rand() < 0.5 else Call()
        if deep and class_info(c.h)[2] and c.pct <= 0.5 and self.rand() < 0.06:
            return self.three_bet(c)                       # random light 3-bet
        k = 0.95 if c.me == c.obs.bb_seat else 0.75
        if c.pct <= k * fr and c.price < 0.38 and c.eff_bb >= 22:
            return Call()
        return self.fold(c)

    def vs_3bet(self, c):
        if c.pct <= 0.012:
            if c.eff_bb >= 35 and self.rand() < 0.45:
                return Call()                              # trap
            return self.shove(c) if c.eff_bb <= 50 else self.raise_x(c, 2.2)
        if c.pct <= 0.03:
            return self.shove(c) if c.eff_bb <= 45 else self.raise_x(c, 2.2)
        if c.pct <= 0.08 and c.price < 0.42 and c.eff_bb >= 30:
            return Call()
        if c.eff_bb >= 45 and is_pair(c.h) and c.to_call <= 0.1 * c.eff:
            return Call()
        return self.fold(c)

    def unbet(self, c, rd, e):
        st = c.street
        hu = len(c.opps) == 1
        r = self.rand()
        if e >= 0.82:
            if c.spr < 1.0:
                return self.shove(c)
            if st == 1:
                return Check() if r < 0.55 else self.bet(c, 0.33)
            if not c.river:
                if not c.ip and r < 0.6:
                    return Check()                         # turn check-raise
                return self.bet(c, 0.65)
            return self.bet(c, 1.3) if r < 0.45 else self.bet(c, 0.55)
        if e >= 0.5:
            if c.river and hu and r < 0.4:
                return self.bet(c, 0.3)                    # block
            if st == 1 and c.pfa != c.me and not c.ip and r < 0.3:
                return self.bet(c, 0.33)                   # donk
            if st == 1 and c.pfa == c.me and r < 0.55:
                return self.bet(c, 0.5)
            return Check()
        if rd.any_draw and not c.river and r < 0.3:
            return self.bet(c, 0.55)
        if c.pfa == c.me and st == 1 and hu and r < self.p["cbet"]:
            return self.bet(c, 0.5)
        if c.river and hu and e < 0.2 and r < 0.12:
            return self.bet(c, 0.75)
        return Check()

    def facing(self, c, rd, e):
        r = self.rand()
        if c.lg.can_raise and len(c.raises) == 1:
            if c.i_checked and c.street >= 2 and len(c.opps) <= 2:
                if e >= 0.78:
                    return self.shove(c) if c.spr < 2.2 else self.raise_x(c, 3.0)
                if c.street == 2 and rd.strong_draw and r < 0.6:
                    return self.raise_x(c, 3.0) if c.spr > 3 else self.shove(c)
                if c.street == 2 and e < 0.25 and len(c.opps) == 1 and r < 0.08:
                    return self.raise_x(c, 3.0)
            if c.street == 1 and e >= 0.82 and c.spr > 3 and r < 0.6:
                return Call()                              # slow-play the flop
        return super().facing(c, rd, e)


# ======================================================================= f7_hackathon
def _sorted_combos():
    combos = [(a, b) for a in range(52) for b in range(a + 1, 52)]
    combos.sort(key=lambda x: PCT[hclass(x[0], x[1])])
    return combos


COMBOS = _sorted_combos()
NCOMBOS = len(COMBOS)
DECK52 = list(range(52))


class Hackathon(Base):
    """Monte Carlo equity bot: realistic one-day engineering, not optimal play."""

    name = "f7_hackathon"
    P = dict(Base.P, budget=0.00017, samples=12)

    def setup(self):
        self.timed = bool(getattr(self.rules, "enforce_time", True))

    def preflop(self, c):
        eq1 = EQR[c.h]
        nr = len(c.pf_raises)
        S = c.eff_bb
        pays = c.obs.payouts[:c.obs.players_left]
        icm_margin = 0.06 if c.obs.players_left > 2 and len(set(pays[1:])) > 1 else 0.0
        if nr == 0:
            if S <= 15:
                need = 0.47 + 0.01 * (S - 5) + 0.012 * min(7, c.nb)
                if eq1 >= need or (c.nplayers == 2 and eq1 >= need - 0.05):
                    return self.shove(c)
                return self.fold(c)
            need = 0.6 - 0.015 * (7 - min(7, c.nb))
            if c.nplayers == 2:
                need = 0.48
            if c.limpers:
                need += 0.02
            if eq1 >= need:
                return self.raise_to(c, (2.5 + len(c.limpers)) * c.bb)
            if c.lg.can_check:
                return Check()
            if c.me == c.obs.sb_seat and eq1 >= 0.52 and S > 15:
                return Call()
            return Fold()
        # facing a raise: model the raiser as a top-25% hand (8% after a re-raise)
        rng = 0.25 if nr == 1 else 0.08
        if c.pfa is not None and c.obs.seats[c.pfa].all_in:
            rng = clip(push_range(c.start[c.pfa] / c.bb, c.nb_of(c.pfa)), 0.06, 0.6) if nr == 1 else 0.1
        eqv = eq_top(rng, c.h)
        eqv = eqv ** (1.0 + 0.6 * max(0, len(c.opps) - 1))
        allin = c.to_call >= 0.3 * c.my_stack
        if nr == 1 and not allin and S <= 20 and c.lg.can_raise:
            # short against a raise: shove or fold
            if eqv >= 0.5 + 0.005 * S + icm_margin:
                return self.shove(c)
            return self.fold(c)
        if eqv >= (0.58 if nr == 1 else 0.62) and nr <= 2 and c.lg.can_raise:
            if S <= 25:
                return self.shove(c)
            return self.raise_x(c, 3.0)
        excess = max(0, c.obs.seats[c.pfa].bet - (c.my_bet + c.my_stack)) if c.pfa is not None else 0
        price = c.to_call / max(1, c.pot - excess + c.to_call)
        # not all-in: postflop out of a raised pot needs more than raw pot odds
        need = price + (0.03 + icm_margin if allin else 0.09)
        if eqv >= need and (allin or eqv >= 0.4):
            return Call()
        return self.fold(c)

    def ranges(self, c):
        out = []
        raisers = {s for s, _ in c.pf_raises}
        callers = set(c.limpers) | set(c.callers)
        bettors = c.bet_on(c.street)
        for s in c.opps:
            f = 0.25 if s in raisers else 0.5 if s in callers else 1.0
            nb = bettors.count(s)
            if nb:
                f *= 0.45 * 0.6 ** (nb - 1)
            out.append(f)
        return out

    def mc_equity(self, c):
        obs = c.obs
        hole = list(obs.hole)
        board = list(obs.board)
        dead = set(hole) | set(board)
        rest = [x for x in DECK52 if x not in dead]
        to_come = 5 - len(board) if len(board) < 5 else 0
        ranges = self.ranges(c)[:3]
        nopp = len(ranges)
        if nopp == 0:
            return 1.0
        # heads-up, each board runout is reused for `per` opponent hands (cheaper samples)
        per = 2 if nopp == 1 else 1
        n = self.p["samples"] if nopp == 1 else 8 if nopp == 2 else 6
        if to_come == 0:
            n = int(n * 1.5)
        rnd = self.rng.random
        t0 = time.perf_counter()
        hero_fixed = score_cards(hole + board) if to_come == 0 else None
        wins = 0.0
        done = 0
        nrest = len(rest)
        # stratified runouts: walk one shuffled deck so the samples use different cards
        walk = self.rng.sample(rest, nrest) if to_come else rest
        pos = 0
        for i in range(n):
            used = set(dead)
            extra = []
            while len(extra) < to_come:
                if pos >= nrest:
                    pos = 0
                    walk = self.rng.sample(rest, nrest)
                x = walk[pos]
                pos += 1
                extra.append(x)
                used.add(x)
            full = board + extra
            hs = hero_fixed if hero_fixed is not None else score_cards(hole + full)
            for _ in range(per):
                best = 0
                taken = set(used)
                for f in ranges:
                    lim = max(1, int(f * NCOMBOS))
                    hand = None
                    for _ in range(6):
                        a, b = COMBOS[int(rnd() * lim)]
                        if a not in taken and b not in taken:
                            hand = (a, b)
                            break
                    if hand is None:
                        while True:
                            a = rest[int(rnd() * nrest)]
                            b = rest[int(rnd() * nrest)]
                            if a != b and a not in taken and b not in taken:
                                hand = (a, b)
                                break
                    taken.add(hand[0])
                    taken.add(hand[1])
                    sc = score_cards([hand[0], hand[1]] + full)
                    if sc > best:
                        best = sc
                if hs > best:
                    wins += 1.0
                elif hs == best:
                    wins += 0.5
                done += 1
            if self.timed and (i & 1) == 1 and time.perf_counter() - t0 > self.p["budget"]:
                break
        return wins / max(1, done)

    def postflop(self, c):
        eq = self.mc_equity(c)
        nopp = len(c.opps)
        if c.to_call == 0:
            if not c.lg.can_raise:
                return Check()
            if eq >= 0.6:
                return self.bet(c, clip((eq - 0.45) * 2.0, 0.33, 1.0))
            if c.street == 1 and c.pfa == c.me and nopp == 1 and eq >= 0.4:
                return self.bet(c, 0.5)                      # continuation bet
            if eq < 0.35 and nopp == 1 and self.rand() < 0.12:
                return self.bet(c, 0.5)
            return Check()
        # pot odds plus a margin: more streets to come out of position, overbets, the river
        need = c.price + 0.04 + (0.03 if not c.river and c.spr > 2 else 0.0) \
            + (0.08 if c.bet_ratio() > 0.9 else 0.0) + (0.04 if c.river else 0.0)
        if eq >= 0.8 and c.lg.can_raise:
            if c.spr < 2.0:
                return self.shove(c)
            return self.raise_x(c, 2.5)
        if eq >= need:
            return Call()
        return Fold()


# ======================================================================== f7_profiler
class Profiler(Base):
    name = "f7_profiler"
    # switches for each exploit (1 = on)
    P = dict(Base.P, x_steal=1, x_iso=1, x_open=1, x_3bet=1, x_unbet=1, x_facing=1)

    def leaks(self, s):
        st = self.stats
        n = st.hands[s]
        vpip, opn, f3 = st.vpip_rate(s), st.open_rate(s), st.fold_to_3bet(s)
        return dict(
            folds3b=max(0.0, opn - 0.22) * 2.0 + max(0.0, f3 - 0.55) * 2.0 if opn > 0.22 else 0.0,
            limper=max(0.0, st.limp_rate(s) - 0.08) * 4.0,
            # a station calls down: river calls and showdowns (not just light flop floats)
            station=(2.0 * max(0.0, st.river_call(s) - 0.55) + max(0.0, st.wtsd(s) - 0.4)
                     + 0.5 * max(0.0, vpip - 0.4)) if n >= 8 else 0.0,
            nit=max(0.0, 0.17 - vpip) * 5.0 if n >= 15 else 0.0,
            folder=max(0.0, st.fold_to_cbet(s) - 0.55) * 2.0,
            maniac=(max(0.0, st.aggression(s) - 0.6) * 2.0 + max(0.0, st.pfr_rate(s) - 0.3) * 2.0)
            if self.shows_junk(s) or vpip > 0.45 else 0.0,
        )

    def shows_junk(self, s):
        shown = self.stats.shown[s]
        return len(shown) >= 3 and sum(shown) / len(shown) > 0.4

    def target(self, c, seats):
        """The leakiest of these seats: (seat, leak name, score)."""
        best = (None, None, 0.0)
        for s in seats:
            for k, v in self.leaks(s).items():
                if v > best[2]:
                    best = (s, k, v)
        return best

    def is_(self, s, kind, thr=0.1):
        return s is not None and self.leaks(s)[kind] > thr

    # ---- preflop -------------------------------------------------------------------------
    def unopened(self, c):
        rng = self.open_range(c)
        behind = c.behind()
        if behind and self.p["x_steal"]:
            vp = sum(self.stats.vpip_rate(j) for j in behind) / len(behind)
            rng *= clip(0.26 / max(0.05, vp), 0.85, 1.3)    # steal more from tight blinds
        if c.pct <= min(0.95, rng):
            return self.raise_to(c, self.open_amount(c))
        return self.fold(c)

    def vs_limpers(self, c):
        if not self.p["x_iso"]:
            return super().vs_limpers(c)
        loose = max(self.leaks(s)["limper"] + self.leaks(s)["station"] for s in c.limpers)
        rng = min(0.4, self.open_range(c) * 0.6 + 0.12 * min(1.0, loose))
        if c.pct <= rng:
            return self.raise_to(c, (4.0 + len(c.limpers)) * c.bb)
        return super().vs_limpers(c)

    def vs_open(self, c):
        if not self.p["x_open"]:
            return super().vs_open(c)
        r = c.pfa
        fr = self.opener_range(c, r)
        lk = self.leaks(r)
        if lk["nit"] > 0.1:
            if c.pct <= 0.015:
                return self.three_bet(c)
            if c.pct <= 0.04 and c.eff_bb >= 40 and later(c, c.me, r):
                return Call()
            return self.fold(c)
        if lk["folds3b"] > 0.15 and not c.callers and c.eff_bb >= 25:
            if c.pct <= clip(fr * 0.55, 0.05, 0.35):
                return self.three_bet(c)
        if lk["station"] > 0.2 or self.stats.fold_to_3bet(r) < 0.35:
            if c.pct <= max(0.03, 0.3 * fr):
                return self.three_bet(c)              # value only: they call
        return super().vs_open(c)

    def resteal(self, c):
        if self.is_(c.pfa, "nit") and c.pct > 0.03:
            return self.fold(c)
        return super().resteal(c)

    def vs_3bet(self, c):
        if not self.p["x_3bet"]:
            return super().vs_3bet(c)
        tb = c.pfa
        rate = self.stats.threebet_rate(tb)
        if rate > 0.12:
            if c.pct <= 0.05:
                return self.shove(c) if c.eff_bb <= 60 else self.raise_x(c, 2.3)
            if c.pct <= 0.12 and c.price < 0.42 and c.eff_bb >= 30:
                return Call()
        if rate < 0.04 and self.stats.tb_opp[tb] >= 15 and c.pct > 0.01:
            return self.fold(c)
        return super().vs_3bet(c)

    # ---- postflop ------------------------------------------------------------------------
    def unbet(self, c, rd, e):
        if len(c.opps) == 1 and self.p["x_unbet"]:
            v = c.opps[0]
            if self.is_(v, "station", 0.2):
                if e >= 0.6:
                    return self.bet(c, 0.5 if c.street == 1 else 0.7)   # thin and big vs a station
                return Check()                        # never bluff a station
            if c.pfa == c.me and self.is_(v, "folder", 0.08):
                if c.street == 1:
                    return self.bet(c, 0.33)
                if c.street == 2 and c.me in c.bet_on(1) and self.stats.fold_to_bet(v) > 0.5:
                    return self.bet(c, 0.6)
        return super().unbet(c, rd, e)

    def facing(self, c, rd, e):
        b = c.bettor
        if b is not None and self.p["x_facing"]:
            if self.is_(b, "nit") and e < 0.75:
                if e - self.discount(c) - 0.1 < c.price:
                    return Fold()
            if self.is_(b, "maniac", 0.12):
                if e - self.discount(c) + 0.07 >= c.price:
                    if e >= self.p["raise_value"] and c.lg.can_raise:
                        return self.shove(c) if c.spr < 2.5 else self.raise_x(c, 2.8)
                    return Call()
        return super().facing(c, rd, e)
