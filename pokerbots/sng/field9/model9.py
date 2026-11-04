"""Per-seat opponent statistics for the field9 bots, updated in end_hand (never inside act()).

Counters (each with its opportunity count): vpip / pfr per hand dealt, first-in opens and
limps, steals from the cut-off / button / small blind, 3-bets facing a single raise, folds
to a 3-bet after opening, folds of the blinds to a steal, c-bets and folds to c-bets, folds
facing any postflop bet, postflop aggression (bets+raises vs calls), open shoves and calls of
an all-in, and what was shown at showdown (strength percentile of open-shoves and of river
bets). rate(name, j) shrinks every rate to a population prior.
"""
from __future__ import annotations

PRIORS = dict(vpip=0.26, pfr=0.17, open=0.24, limp=0.04, steal=0.38, tb=0.07, f3=0.55, fts=0.66, cb=0.62,
              fcb=0.45, fb=0.45, cshove=0.12, shove=0.09, wtsd=0.28, agg=0.5, rbluff=0.25)
STRENGTH = dict(vpip=6.0, pfr=6.0, open=6.0, limp=6.0, steal=5.0, tb=10.0, f3=5.0, fts=5.0, cb=5.0, fcb=5.0,
                fb=6.0, cshove=6.0, shove=6.0, wtsd=6.0, agg=6.0, rbluff=4.0)


class Stats:
    NAMES = tuple(PRIORS)

    def __init__(self, n, pct=None):
        self.n = n
        self.pct = pct                      # strength percentile per hand class (or None)
        self.x = {k: [0.0] * n for k in self.NAMES}
        self.o = {k: [0.0] * n for k in self.NAMES}
        self.hands = [0] * n
        self.shove_pct = [[] for _ in range(n)]       # percentiles of shown open-shoves
        self._folded = set()

    def rate(self, name, j) -> float:
        k = STRENGTH[name]
        return (self.x[name][j] + k * PRIORS[name]) / (self.o[name][j] + k)

    def opp(self, name, j) -> float:
        return self.o[name][j]

    def _hit(self, name, j, yes):
        if 0 <= j < self.n:
            self.o[name][j] += 1
            if yes:
                self.x[name][j] += 1

    def shown_shove_width(self, j):
        """Width estimate of seat j's open-shoving range from shown hands (None if unseen)."""
        v = self.shove_pct[j]
        if len(v) < 2:
            return None
        return min(1.0, 2.0 * sum(v) / len(v))

    # ------------------------------------------------------------------------- update
    def update(self, history, showdown=None, start=None, bb=20, hclass=None, river_strength=None, ante=0):
        n = self.n
        self._folded = set()
        hist = [h for h in history if isinstance(h, tuple) and len(h) == 4 and isinstance(h[0], int)
                and 0 <= h[0] < n]
        posts = [h for h in hist if h[2] == "post"]
        if len(posts) < 2:
            return
        sb_seat, bb_seat = posts[0][0], posts[1][0]
        if start is None:
            start = [10 ** 9] * n
        in_hand = [start[j] > 0 for j in range(n)]
        for j in range(n):
            if in_hand[j]:
                self.hands[j] += 1
        # preflop order and players behind each seat
        order = [j for j in list(range(bb_seat + 1, n)) + list(range(0, bb_seat + 1)) if in_hand[j]]
        heads_up = len(order) == 2
        pos = {j: i for i, j in enumerate(order)}
        bet = [0] * n
        committed = [min(ante, start[j]) if in_hand[j] else 0 for j in range(n)]
        for s, _, _, a in posts:
            bet[s] += a
            committed[s] += a
        cur = max(bet[sb_seat], bet[bb_seat], bb)
        raises = []                     # preflop (seat, all_in)
        limpers = []
        acted = set()
        vp = set()
        pr = set()
        opener = None
        faced_shove = set()
        street = 0
        pf_aggr = None
        flop_bet_seen = False
        cbettor = None
        faced_bet = set()
        saw_flop = set()
        river_bettor = None
        for s, st, k, a in hist:
            if k == "post" or k == "discard":
                continue
            if st != street:
                street = st
                bet = [0] * n
                cur = 0
                faced_bet = set()
                if st == 1:
                    saw_flop = {j for j in range(n) if in_hand[j] and j not in self._folded}
                    pf_aggr = raises[-1][0] if raises else None
            stack_left = start[s] - committed[s]
            if st == 0:
                first = s not in acted
                if k in ("call", "raise"):
                    vp.add(s)
                if k == "raise":
                    pr.add(s)
                facing_allin = raises and raises[-1][1] and s != raises[-1][0]
                if facing_allin and s not in faced_shove:
                    faced_shove.add(s)
                    self._hit("cshove", s, k != "fold")
                if first and not raises and not limpers:
                    nb = len(order) - 1 - pos.get(s, 0)
                    self._hit("open", s, k == "raise")
                    self._hit("limp", s, k == "call")
                    if nb <= 3 and s != bb_seat or heads_up:
                        self._hit("steal", s, k == "raise")
                    if start[s] <= 20 * bb:
                        self._hit("shove", s, k == "raise" and committed[s] + a - bet[s] >= start[s])
                elif first and len(raises) == 1 and not raises[0][1]:
                    self._hit("tb", s, k == "raise")
                    if s in (sb_seat, bb_seat) and opener is not None and not limpers:
                        onb = len(order) - 1 - pos.get(opener, 0)
                        if onb <= 3 or heads_up:
                            self._hit("fts", s, k == "fold")
                elif s == opener and len(raises) == 2 and not raises[-1][1]:
                    self._hit("f3", s, k == "fold")
                acted.add(s)
                if k == "call":
                    if not raises:
                        limpers.append(s)
                    add = min(a, stack_left)
                    bet[s] += add
                    committed[s] += add
                elif k == "raise":
                    add = a - bet[s]
                    bet[s] = a
                    committed[s] += add
                    allin = committed[s] >= start[s]
                    if not raises and not limpers:
                        opener = s
                    raises.append((s, allin))
                    cur = a
                elif k == "fold":
                    self._folded.add(s)
                continue
            # postflop
            if cur > bet[s] and s not in faced_bet:
                faced_bet.add(s)
                self._hit("fb", s, k == "fold")
                if st == 1 and cbettor is not None and s != cbettor:
                    self._hit("fcb", s, k == "fold")
            if st == 1 and s == pf_aggr and not flop_bet_seen:
                self._hit("cb", s, k == "raise")
            if k == "raise":
                if st == 1 and not flop_bet_seen and s == pf_aggr:
                    cbettor = s
                if st == 1:
                    flop_bet_seen = True
                if st == 3:
                    river_bettor = s
                self._hit("agg", s, True)
                add = a - bet[s]
                bet[s] = a
                committed[s] += add
                cur = a
            elif k == "call":
                self._hit("agg", s, False)
                add = min(a, stack_left)
                bet[s] += add
                committed[s] += add
            elif k == "fold":
                self._folded.add(s)
        for j in range(n):
            if in_hand[j]:
                self._hit("vpip", j, j in vp)
                self._hit("pfr", j, j in pr)
        shown = showdown if isinstance(showdown, dict) else {}
        for j in saw_flop:
            self._hit("wtsd", j, j in shown)
        if self.pct is not None and hclass is not None:
            # shown open-shoves: their strength percentile
            if raises and opener is not None and raises[0][0] == opener and raises[0][1] and opener in shown:
                cards = shown[opener]
                if cards and len(cards) == 2:
                    self.shove_pct[opener].append(self.pct[hclass(cards[0], cards[1])])
            if river_bettor is not None and river_bettor in shown and river_strength is not None:
                try:
                    weak = river_strength(river_bettor, shown[river_bettor])
                    self._hit("rbluff", river_bettor, weak)
                except Exception:  # noqa: BLE001
                    pass
        self._folded = set()
