"""f4_mc -- Monte Carlo equity bot.

* Each opponent gets a range (top x% of hands) from its preflop actions this hand and its
  tracked open / 3-bet / shove / VPIP rates. Postflop, an opponent who has bet or raised
  must hold something on the current board (a pair using a hole card or better, or a
  draw) unless it "bluffs" at a rate scaled by its observed aggression.
* Postflop equity is a Monte Carlo rollout against hands sampled from those ranges with a
  pure-Python 7-card evaluator; a fixed sample budget per street (cached), so a decision
  stays well under the time limit and the result is reproducible from the table seed.
* Preflop: explicit chip-EV of open-raising (fold equity from the players behind) and of
  shoving under PUSH_BB; calls and 3-bets from equity against the raiser's range.
"""
from __future__ import annotations

from engine.game import Call, Check, Fold

from .base import F4Bot, HU_ORDER, HU_PCT, MW_PCT, eq_vs_range, multiway_eq
from .fasteval import CK, LOW32, NONFLUSH, score_key
from .features import class_info



def _combos_sorted():
    out = []
    for cls in HU_ORDER:
        hi, lo, s, p = class_info(cls)
        for a in range(4):
            for b in range(4):
                if p and a < b or (not p and s and a == b) or (not p and not s and a != b):
                    out.append((hi * 4 + a, lo * 4 + b))
    return out


COMBOS = _combos_sorted()
NCOMBO = len(COMBOS)
CAT_OF_BOARD = (1, 2, 3, 4, 7)


class MonteCarloEq(F4Bot):
    PUSH_BB = 12.0
    SAMPLES = {1: 30, 2: 22, 3: 16}
    SAMPLES_MANY = 12
    VALUE_EQ = 0.58
    POST_MARGIN = 0.05
    SEMI_BLUFF = 0.3
    PRIOR_N = 10       # pseudo-samples of the bucket-table equity mixed into the estimate
    name = "f4_mc"

    def setup(self):
        self._mc_key = None
        self._mc_val = 0.5

    def decide(self, obs, c):
        if obs.street == 0:
            return self.preflop(obs, c)
        return self.postflop(obs, c)

    # ---- ranges -------------------------------------------------------------------------
    def range_of(self, obs, j):
        T = self.tracker
        nr = 0
        pct = 1.0
        bb = obs.big_blind
        st = obs.seats[j]
        tot = st.stack + st.committed
        for (s, street, kind, amt) in obs.history:
            if street != 0 or kind == "post":
                continue
            if kind == "raise":
                nr += 1
                if s == j:
                    if st.all_in and tot <= 20 * bb:
                        pct = min(0.7, 0.06 + 2.0 / max(1.0, tot / bb)) * (0.6 if nr > 1 else 1.0)
                        pct *= min(1.8, max(0.6, T.push_rate(j) / 0.25)) ** 0.5
                    elif nr == 1:
                        pct = min(0.6, max(0.05, T.open_rate(j)))
                    elif nr == 2:
                        pct = min(0.2, max(0.03, (T.s[j]["three"] + 0.4) / (T.s[j]["three_opp"] + 5)))
                    else:
                        pct = 0.03
            elif kind == "call" and s == j:
                if nr == 0:
                    pct = min(pct, 0.55)
                else:
                    pct = min(pct, min(0.5, max(0.08, T.vpip(j) * 0.8)))
        return min(1.0, max(0.02, pct))

    # ---- Monte Carlo ---------------------------------------------------------------------
    def postflop_aggr(self, obs, j):
        n = 0
        for (s, street, kind, amt) in obs.history:
            if s == j and street >= 1 and kind == "raise":
                n += 1
        return n

    def mc_equity(self, obs, c):
        opps = c.opps
        key = (obs.hand_number, obs.street, obs.hole, obs.board, tuple(self.postflop_aggr(obs, j) for j in opps))
        if key == self._mc_key:
            return self._mc_val
        k = len(opps)
        n = self.SAMPLES.get(k, self.SAMPLES_MANY)
        if obs.street == 3:
            n = int(n * 1.25)
        hole = list(obs.hole)
        board = list(obs.board)
        dead = 0
        for x in hole + board:
            dead |= 1 << x
        bkey = 0
        bsuit = [0, 0, 0, 0]
        bcnt = {}
        for x in board:
            bkey += CK[x]
            bsuit[x & 3] += 1
            bcnt[x >> 2] = bcnt.get(x >> 2, 0) + 1
        v = sorted(bcnt.values(), reverse=True)
        bcat = 4 if (v[0] >= 4 or (v[0] == 3 and len(v) > 1 and v[1] >= 2)) else (
            3 if v[0] == 3 else (2 if v[0] == 2 and len(v) > 1 and v[1] == 2 else (1 if v[0] == 2 else 0)))
        bcat_eng = CAT_OF_BOARD[bcat]
        specs = []
        for j in opps:
            lim = max(4, int(self.range_of(obs, j) * NCOMBO))
            ag = self.postflop_aggr(obs, j)
            bluff = min(0.6, 0.25 * self.tracker.aggression(j) ** 0.5) if ag else 1.0
            specs.append((lim, ag > 0, bluff))
        need = 5 - len(board)
        rnd = self.rng.random
        hk = CK[hole[0]] + CK[hole[1]]
        total = 0.0
        for _ in range(n):
            used = dead
            hands = []
            for lim, cond, bluff in specs:
                a = b = -1
                for _t in range(10):
                    a, b = COMBOS[int(rnd() * lim)]
                    if (used >> a) & 1 or (used >> b) & 1:
                        a = -1
                        continue
                    if cond:
                        ko = bkey + CK[a] + CK[b]
                        sc = NONFLUSH[ko & LOW32] >> 20
                        if ((ko >> 32) + 0x3333) & 0x8888:
                            sc = score_key(ko, [a, b] + board) >> 20
                        good = sc > bcat_eng or (need and (bsuit[a & 3] + ((b & 3) == (a & 3)) >= 3
                                                           or bsuit[b & 3] >= 3))
                        if not good and rnd() > bluff:
                            a = -1
                            continue
                    break
                if a < 0:
                    while True:
                        a = int(rnd() * 52)
                        b = int(rnd() * 52)
                        if a != b and not (used >> a) & 1 and not (used >> b) & 1:
                            break
                used |= (1 << a) | (1 << b)
                hands.append((a, b))
            ext = []
            ek = bkey
            while len(ext) < need:
                x = int(rnd() * 52)
                if (used >> x) & 1:
                    continue
                used |= 1 << x
                ext.append(x)
                ek += CK[x]
            fb = board + ext
            km = ek + hk
            mine = NONFLUSH[km & LOW32]
            if ((km >> 32) + 0x3333) & 0x8888:
                mine = score_key(km, hole + fb)
            best = -1
            ties = 0
            for a, b in hands:
                ko = ek + CK[a] + CK[b]
                s = NONFLUSH[ko & LOW32]
                if ((ko >> 32) + 0x3333) & 0x8888:
                    s = score_key(ko, [a, b] + fb)
                if s > best:
                    best = s
                    ties = 1 if s == mine else 0
                elif s == best and s == mine:
                    ties += 1
            if mine > best:
                total += 1.0
            elif mine == best:
                total += 1.0 / (ties + 1)
        prior = self.street_eq(obs, c, k) - 0.07 * sum(1 for sp in specs if sp[1])
        eq = (total + self.PRIOR_N * max(0.02, prior)) / (n + self.PRIOR_N)
        self._mc_key = key
        self._mc_val = eq
        return eq

    # ---- preflop -----------------------------------------------------------------------
    def preflop(self, obs, c):
        lg = obs.legal
        T = self.tracker
        bb = c.bb
        cls = c.cls
        pot = obs.pot
        if c.n_raises == 0:
            behind = c.behind
            if c.eff_bb <= self.PUSH_BB and lg.can_raise:
                # chip EV of a shove; the first player behind who calls takes it on
                ev = 0.0
                p_none = 1.0
                X = c.total
                for j in behind:
                    tj = obs.seats[j].stack + obs.seats[j].bet
                    risk = min(X, tj) / bb
                    pc = min(0.8, (0.08 + 1.4 / (risk + 1)) * (1.3 if j == obs.bb_seat else 1.0)
                             * min(2.0, max(0.5, T.call_allin(j) / 0.2)) ** 0.5)
                    eq = eq_vs_range(cls, pc)
                    m = min(X, tj)
                    win = pot + m - obs.seats[j].bet
                    lose = m - obs.my_bet
                    ev += p_none * pc * (eq * win - (1 - eq) * lose)
                    p_none *= 1 - pc
                ev += p_none * pot
                tax = 0.02 * c.total * max(0, 7 - obs.players_left) / 4
                if ev > tax:
                    return self.allin(obs)
                return self.passive(obs)
            raise_to = (2.5 + c.limpers) * bb
            add = raise_to - obs.my_bet
            p_fold = 1.0
            best_d = 0.0
            for j in behind:
                d = min(0.75, T.vpip(j) * (0.9 if j == obs.bb_seat else 0.6))
                p_fold *= 1 - d
                best_d = max(best_d, d)
            if c.limpers:
                p_fold *= 0.35
                best_d = max(best_d, 0.4)
            caller_pct = max(0.05, best_d)
            eq = eq_vs_range(cls, caller_pct)
            real = 0.95 if c.pos in ("BTN", "CO") else 0.8
            pot_called = pot + 2 * raise_to - obs.my_bet
            ev_called = real * eq * pot_called - add
            ev = p_fold * pot + (1 - p_fold) * ev_called
            if ev > 0.15 * bb and MW_PCT[cls] <= 0.5 and lg.can_raise:
                return self.raise_to(obs, raise_to)
            if c.pos == "SB" and c.limpers == 0 and MW_PCT[cls] <= 0.45 and lg.can_call:
                return Call()
            return self.passive(obs)
        raiser = c.last_raiser
        rng_pct = self.range_of(obs, raiser)
        eqs = [eq_vs_range(cls, rng_pct)]
        for j in c.opps:
            if j != raiser and obs.seats[j].bet > 0 and obs.seats[j].bet >= obs.seats[raiser].bet:
                eqs.append(eq_vs_range(cls, min(1.0, self.range_of(obs, j))))
        eq = multiway_eq(eqs)
        call = lg.call_amount
        need = call / (pot + call)
        if c.facing_allin or call >= 0.45 * obs.my_stack:
            margin = 0.03 + 0.012 * max(0, 8 - obs.players_left)
            if eq >= need + margin:
                return self.allin(obs) if lg.can_raise and not c.facing_allin else Call()
            return self.passive(obs)
        if eq >= 0.60 and lg.can_raise:
            if c.eff_bb <= 22:
                return self.allin(obs)
            return self.raise_to(obs, 3 * c.last_raise_to + c.callers * c.last_raise_to)
        real = 0.85 if c.ip else 0.72
        implied = 0.08 * c.eff if (cls // 13 == cls % 13) and c.eff >= 15 * call else 0.0
        if real * eq * (pot + call) + implied * 0.1 >= call and call <= 0.2 * c.eff:
            return Call()
        return self.passive(obs)

    # ---- postflop ----------------------------------------------------------------------
    def postflop(self, obs, c):
        lg = obs.legal
        eq = self.mc_equity(obs, c)
        pot = obs.pot
        st = obs.street
        k = len(c.opps)
        if c.to_call == 0:
            if not lg.can_raise:
                return Check()
            if eq >= self.VALUE_EQ:
                return self.raise_to(obs, obs.my_bet + 0.66 * pot)
            if st == 1 and c.pfr == obs.seat and k == 1 and eq >= 0.38:
                return self.raise_to(obs, 0.5 * pot)
            if k == 1 and st < 3 and 0.3 <= eq < self.VALUE_EQ and self.rng.random() < self.SEMI_BLUFF:
                return self.raise_to(obs, 0.5 * pot)
            return Check()
        call = c.to_call
        need = call / (pot + call)
        if eq >= 0.78 and lg.can_raise:
            return self.raise_to(obs, 2.8 * c.last_raise_to)
        margin = self.POST_MARGIN + (0.05 if call >= 0.4 * obs.my_stack else 0.0)
        if eq >= need + margin:
            return Call()
        return Fold()
