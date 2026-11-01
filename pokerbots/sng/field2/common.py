"""Shared helpers for the field2 bots (an independent opponent field).

Everything here is either built once per card spec (cached at module level, outside
the timed act() path) or is pure Python cheap enough for a 1 ms decision:

  * Scorer: an engine-compatible hand scorer. For "any" hole usage it is pure Python
    (~10 us); for "exactly k" (Omaha) it uses the engine's fast 5-card path.
  * PreflopTable: per-class preflop equities from a shared score bank (all hole combos
    x a few hundred random boards): equity vs a random hand, vs 2 and 3 random hands,
    the class-vs-class matrix and equity vs the top-w% range. Hole-card counts other
    than 2 (Omaha) fall back to a heuristic score with sampled percentiles.
  * read_postflop: made-hand strength + draws + board texture, spec-aware.
  * Ctx: the facts about the current decision every bot needs (to call, raisers,
    position, effective stack, ...).
  * push/fold chart (heads-up Nash-like by effective stack, shrunk per player behind),
    ICM for one player, bubble factors, sizing helpers.
"""
from __future__ import annotations

import itertools
import math
import random
from functools import lru_cache

import numpy as np

from engine.evaluator import _tables, get_evaluator
from engine.game import Call, Check, Fold, RaiseTo  # noqa: F401  (re-exported for bots)


# ---------------------------------------------------------------------------------------
# scoring
# ---------------------------------------------------------------------------------------
class Scorer:
    """Engine-compatible scores (higher is better, same encoding as engine.evaluator)."""

    def __init__(self, spec):
        self.spec = spec
        t = _tables(tuple(spec.category_order), tuple(sorted(spec.deck_ranks)), spec.ace_low_straight)
        c = t["cat"]
        self.order = tuple(spec.category_order)
        self.cat = dict(c)
        self.top5 = t["top5"].tolist()
        self.top3 = t["top3"].tolist()
        self.top2 = t["top2"].tolist()
        self.high = t["high"].tolist()
        self.st = t["straight_top"].tolist()
        self.fl = t["flush"].tolist()
        self.HIGH = c["high_card"] << 20
        self.PAIR = c["pair"] << 20
        self.TWO = c["two_pair"] << 20
        self.TRIPS = c["trips"] << 20
        self.STR = c["straight"] << 20
        self.FH = c["full_house"] << 20
        self.QUADS = c["quads"] << 20
        self.any = spec.hole_usage == "any"
        self.ev = get_evaluator(spec)
        # category value -> strength rank 0..8 in the standard sense (0 high card .. 8 SF)
        std = ("high_card", "pair", "two_pair", "trips", "straight", "flush", "full_house",
               "quads", "straight_flush")
        self.cat_name = {v: k for k, v in c.items()}
        self.std_index = {v: std.index(k) for k, v in c.items()}
        self.ranks = tuple(sorted(spec.deck_ranks))
        self.n_ranks = len(self.ranks)
        if not self.any:
            # the engine builds its 5-card table and combo index lazily: do it now, not in act()
            d = list(spec.deck)
            h = spec.hole_cards
            shown = 0
            for k in spec.board_cards_per_street:
                shown += k
                if shown >= 5 - spec.hole_exact:
                    self.ev.evaluate(d[:h], d[h:h + shown])

    def score_cards(self, cards) -> int:
        """Best 5 of any number of cards (fewer than 5 is scored as is)."""
        cnt = [0] * 13
        sm = [0, 0, 0, 0]
        for c in cards:
            r = c >> 2
            cnt[r] += 1
            sm[c & 3] |= 1 << r
        S = P = T = Q = 0
        for r in range(13):
            k = cnt[r]
            if k:
                b = 1 << r
                S |= b
                if k >= 2:
                    P |= b
                    if k >= 3:
                        T |= b
                        if k >= 4:
                            Q |= b
        high = self.high
        best = self.HIGH | self.top5[S]
        fl = self.fl
        for m in sm:
            v = fl[m]
            if v > best:
                best = v
        st = self.st[S]
        if st >= 0:
            v = self.STR | (st << 16)
            if v > best:
                best = v
        if P:
            pr = high[P]
            Sx = S & ~(1 << pr)
            v = self.PAIR | (pr << 16) | (self.top3[Sx] << 4)
            if v > best:
                best = v
            P2 = P & ~(1 << pr)
            if P2:
                pr2 = high[P2]
                rem = Sx & ~(1 << pr2)
                v = self.TWO | (pr << 16) | (pr2 << 12) | (max(high[rem], 0) << 8)
                if v > best:
                    best = v
        if T:
            tr = high[T]
            St = S & ~(1 << tr)
            v = self.TRIPS | (tr << 16) | (self.top2[St] << 8)
            if v > best:
                best = v
            Pt = P & ~(1 << tr)
            if Pt:
                v = self.FH | (tr << 16) | (max(high[Pt], 0) << 12)
                if v > best:
                    best = v
        if Q:
            qr = high[Q]
            Sq = S & ~(1 << qr)
            v = self.QUADS | (qr << 16) | (max(high[Sq], 0) << 12)
            if v > best:
                best = v
        return best

    def score(self, hole, board) -> int:
        if self.any:
            return self.score_cards(tuple(hole) + tuple(board))
        return self.ev.evaluate(hole, board)

    def std_cat(self, score: int) -> int:
        return self.std_index[score >> 20]


@lru_cache(maxsize=None)
def _scorer_cached(key, spec):
    return Scorer(spec)


def get_scorer(spec) -> Scorer:
    key = (spec.category_order, tuple(spec.deck_ranks), spec.ace_low_straight, spec.hole_usage, spec.hole_exact)
    return _scorer_cached(key, spec)


# ---------------------------------------------------------------------------------------
# preflop tables
# ---------------------------------------------------------------------------------------
WIDTHS = (0.02, 0.04, 0.07, 0.10, 0.15, 0.20, 0.30, 0.40, 0.55, 0.75, 1.0)


class PreflopTable:
    """Per-class preflop numbers. `cls(hole)` -> class index; arrays indexed by class."""

    two_card = True

    def __init__(self, spec, n_boards=400, seed=20261101):
        self.spec = spec
        ev = get_evaluator(spec)
        deck = list(spec.deck)
        combos = list(itertools.combinations(deck, 2))
        keys = sorted({self.key(a, b) for a, b in combos}, key=lambda k: (-k[0], -k[1], -k[2]))
        self.keys = keys
        self.kidx = {k: i for i, k in enumerate(keys)}
        K, C = len(combos), len(keys)
        ca = np.array(combos, dtype=np.int64)
        ccls = np.array([self.kidx[self.key(a, b)] for a, b in combos], dtype=np.int64)
        rng = np.random.default_rng(seed)
        darr = np.array(deck, dtype=np.int64)
        B = n_boards
        boards = darr[rng.random((B, len(deck))).argsort(axis=1)[:, :5]]
        S = ev.eval_any(np.concatenate([np.repeat(ca, B, axis=0), np.tile(boards, (K, 1))], axis=1)).reshape(K, B)
        cm = (np.left_shift(np.int64(1), ca[:, 0]) | np.left_shift(np.int64(1), ca[:, 1]))
        bm = np.bitwise_or.reduce(np.left_shift(np.int64(1), boards), axis=1)
        V = (cm[:, None] & bm[None, :]) == 0
        rep = [int(np.flatnonzero(ccls == c)[0]) for c in range(C)]
        Wc = np.zeros((C, C))
        Cc = np.zeros((C, C))
        eq2 = np.zeros(C)
        eq3 = np.zeros(C)
        R = 1200
        for c in range(C):
            h = rep[c]
            ok = V & V[h][None, :] & ((cm & cm[h]) == 0)[:, None]
            sh = S[h][None, :]
            w = (sh > S) + 0.5 * (sh == S)
            Wv = (w * ok).sum(axis=1)
            Cv = ok.sum(axis=1)
            Wc[c] = np.bincount(ccls, weights=Wv, minlength=C)
            Cc[c] = np.bincount(ccls, weights=Cv, minlength=C)
            # multiway vs 2 and 3 random hands from the bank
            b = rng.integers(B, size=R)
            v = rng.integers(K, size=(R, 3))
            m1, m2, m3 = cm[v[:, 0]], cm[v[:, 1]], cm[v[:, 2]]
            valid = V[h, b] & V[v[:, 0], b] & V[v[:, 1], b] & ((m1 & cm[h]) == 0) & ((m2 & cm[h]) == 0) & ((m1 & m2) == 0)
            s0 = S[h, b]
            s1, s2, s3 = S[v[:, 0], b], S[v[:, 1], b], S[v[:, 2], b]
            mx2 = np.maximum(s1, s2)
            share2 = np.where(s0 > mx2, 1.0, np.where(s0 == mx2, 0.5, 0.0))
            eq2[c] = share2[valid].mean() if valid.any() else 0.0
            valid3 = valid & V[v[:, 2], b] & ((m3 & cm[h]) == 0) & ((m3 & m1) == 0) & ((m3 & m2) == 0)
            mx3 = np.maximum(mx2, s3)
            share3 = np.where(s0 > mx3, 1.0, np.where(s0 == mx3, 0.4, 0.0))
            eq3[c] = share3[valid3].mean() if valid3.any() else 0.0
        # symmetrise: eq(a vs b) + eq(b vs a) = 1 (two hero reps per matchup -> less noise)
        M = Wc / np.maximum(Cc, 1)
        M = 0.5 * (M + (1.0 - M.T))
        Cc = 0.5 * (Cc + Cc.T)
        Wc = M * Cc
        self.M = M                                       # class vs class equity
        self.Wc, self.Cc = Wc, Cc
        self.eq1 = Wc.sum(axis=1) / np.maximum(Cc.sum(axis=1), 1)
        self.eq2, self.eq3 = eq2, eq3
        self.ncombo = np.bincount(ccls, minlength=C).astype(float)
        order = np.argsort(-self.eq1, kind="stable")
        self.order = order
        cum = np.cumsum(self.ncombo[order]) / self.ncombo.sum()
        pct = np.zeros(C)
        pct[order] = cum
        self.pct = pct                                   # fraction of combos at least this good
        self.rank = np.zeros(C, dtype=np.int64)
        self.rank[order] = np.arange(C)
        # equity vs the top-w range (classes in eq1 order until w of the combos are covered)
        cutoffs = [max(1, int(np.searchsorted(cum, w - 1e-9) + 1)) for w in WIDTHS]
        cutoffs = [min(C, x) for x in cutoffs]
        cw = np.cumsum(Wc[:, order], axis=1)
        cc = np.cumsum(Cc[:, order], axis=1)
        self.eqw = np.stack([cw[:, k - 1] / np.maximum(cc[:, k - 1], 1) for k in cutoffs], axis=1)
        # python lists for fast lookups in act()
        self.pct_l = self.pct.tolist()
        self.eq1_l = self.eq1.tolist()
        self.eq2_l = eq2.tolist()
        self.eq3_l = eq3.tolist()
        self.eqw_l = self.eqw.tolist()
        self.pairs = [k[0] == k[1] for k in keys]
        self.suited = [bool(k[2]) for k in keys]
        self.gap = [k[0] - k[1] for k in keys]
        self.hi = [k[0] for k in keys]

    @staticmethod
    def key(a, b):
        ra, rb = a >> 2, b >> 2
        s = (a & 3) == (b & 3)
        if ra < rb:
            ra, rb = rb, ra
        return (ra, rb, bool(s and ra != rb))

    def cls(self, hole) -> int:
        a, b = hole[0], hole[1]
        ra, rb = a >> 2, b >> 2
        if ra < rb:
            ra, rb = rb, ra
        return self.kidx[(ra, rb, (a & 3) == (b & 3) and ra != rb)]

    def eq_vs_top(self, c: int, w: float) -> float:
        """Equity of class c vs the top-w fraction of hands (interpolated over WIDTHS)."""
        row = self.eqw_l[c]
        if w <= WIDTHS[0]:
            return row[0]
        for i in range(1, len(WIDTHS)):
            if w <= WIDTHS[i]:
                a, b = WIDTHS[i - 1], WIDTHS[i]
                f = (w - a) / (b - a)
                return row[i - 1] * (1 - f) + row[i] * f
        return row[-1]

    def eq_vs_n(self, c: int, n: int) -> float:
        if n <= 1:
            return self.eq1_l[c]
        if n == 2:
            return self.eq2_l[c]
        e3 = self.eq3_l[c]
        if n == 3:
            return e3
        return e3 * (0.78 ** (n - 3))

    def eq_vs_weights(self, c: int, weights) -> float:
        """Equity vs a weighted class range (weights: array per class)."""
        w = np.asarray(weights, dtype=float)
        num = (self.Wc[c] * w).sum()
        den = (self.Cc[c] * w).sum()
        return float(num / den) if den > 0 else 0.5


def heuristic_score(hole) -> float:
    """Preflop score for hands with more than 2 hole cards (Omaha-like)."""
    ranks = sorted((c >> 2 for c in hole), reverse=True)
    suits = {}
    for c in hole:
        suits.setdefault(c & 3, []).append(c >> 2)
    s = 0.0
    counts = {}
    for r in ranks:
        counts[r] = counts.get(r, 0) + 1
    for r, k in counts.items():
        if k == 2:
            s += 4.0 + 0.6 * r
        elif k >= 3:
            s -= 2.0
    for u, rs in suits.items():
        if len(rs) >= 2:
            s += 2.0 + 0.18 * max(rs) - (1.0 if len(rs) >= 3 else 0.0)
    uniq = sorted(counts, reverse=True)
    for i in range(len(uniq) - 1):
        g = uniq[i] - uniq[i + 1]
        if g <= 3:
            s += (4 - g) * 0.7
    s += 0.25 * sum(ranks)
    return s


class HeuristicPreflop:
    """Fallback for hole counts other than 2: percentiles from a sampled distribution."""

    two_card = False

    def __init__(self, spec, n=4000, seed=7):
        rng = random.Random(seed)
        deck = list(spec.deck)
        h = spec.hole_cards
        self.dist = sorted(heuristic_score(rng.sample(deck, h)) for _ in range(n))
        self.n = n

    def pct_of(self, hole) -> float:
        import bisect
        s = heuristic_score(hole)
        i = bisect.bisect_left(self.dist, s)
        return max(0.003, 1.0 - i / self.n)

    @staticmethod
    def eq_from_pct(p: float, n_opp: int = 1) -> float:
        e1 = 0.64 - 0.26 * p
        return e1 ** (0.75 * max(1, n_opp)) if n_opp > 1 else e1

    @staticmethod
    def eq_vs_top_pct(p: float, w: float) -> float:
        # monotone, ~0.5 when equal percentiles
        return 0.5 + 0.32 * (w - p) / (w + p + 0.15)


_PF = {}


def get_preflop(spec):
    key = (tuple(spec.deck_ranks), spec.category_order, spec.ace_low_straight, spec.hole_cards,
           spec.hole_usage, spec.hole_exact)
    t = _PF.get(key)
    if t is None:
        if spec.hole_cards == 2 and spec.hole_usage == "any":
            t = PreflopTable(spec)
        else:
            t = HeuristicPreflop(spec)
        _PF[key] = t
    return t


class PF:
    """Per-decision preflop view: pct (top fraction), eq helpers, uniform across specs."""
    __slots__ = ("t", "c", "pct", "pair", "suited", "hi", "gap")

    def __init__(self, table, hole):
        self.t = table
        if table.two_card:
            c = table.cls(hole)
            self.c = c
            self.pct = table.pct_l[c]
            self.pair = table.pairs[c]
            self.suited = table.suited[c]
            self.hi = table.hi[c]
            self.gap = table.gap[c]
        else:
            self.c = -1
            self.pct = table.pct_of(hole)
            rs = [x >> 2 for x in hole]
            self.pair = len(set(rs)) < len(rs)
            self.suited = len({x & 3 for x in hole}) < len(hole)
            self.hi = max(rs)
            self.gap = 3

    def eq_vs_top(self, w):
        if self.c >= 0:
            return self.t.eq_vs_top(self.c, w)
        return HeuristicPreflop.eq_vs_top_pct(self.pct, w)

    def eq_vs_n(self, n):
        if self.c >= 0:
            return self.t.eq_vs_n(self.c, n)
        return HeuristicPreflop.eq_from_pct(self.pct, n)


# ---------------------------------------------------------------------------------------
# postflop reading
# ---------------------------------------------------------------------------------------
class Read:
    __slots__ = ("hs", "outs", "fd", "sd", "cat", "label", "eq", "wet", "paired", "board_flush",
                 "nutty", "draw_eq")

    def __repr__(self):
        return f"Read({self.label} hs={self.hs:.2f} outs={self.outs} eq={self.eq:.2f})"


def read_postflop(sc: Scorer, hole, board) -> Read:
    """Made-hand strength `hs` (~equity vs a random hand now), draws and texture.
    `eq` blends hs with the chance to improve by the river."""
    rd = Read()
    board = tuple(board)
    hole = tuple(hole)
    nb = len(board)
    bsuit = [0, 0, 0, 0]
    bmask = 0
    bcnt = {}
    for c in board:
        bsuit[c & 3] += 1
        r = c >> 2
        bmask |= 1 << r
        bcnt[r] = bcnt.get(r, 0) + 1
    branks = sorted(bcnt, reverse=True)
    btop = branks[0] if branks else -1
    max_bs = max(bsuit)
    paired = len(bcnt) < nb
    rd.paired = paired
    rd.board_flush = max_bs
    st = sc.st
    # board "connectedness": a straight possible with 2 more cards
    conn = 0
    for r in sc.ranks:
        if not bmask >> r & 1 and st[bmask | (1 << r)] >= 0:
            conn += 1
    rd.wet = (max_bs >= 3) or (max_bs == 2 and nb == 3) or conn >= 1 or _gaps_small(branks)
    hr = sorted((c >> 2 for c in hole), reverse=True)
    if sc.any:
        my = sc.score_cards(hole + board)
        bd = sc.score_cards(board)
        hs, label, nutty = _strength_any(sc, my, bd, hr, branks, btop, bcnt, max_bs, paired, hole, board)
    else:
        my = sc.ev.evaluate(hole, board)
        hs, label, nutty = _strength_exact(sc, my, max_bs, paired)
    rd.cat = sc.std_cat(my)
    rd.nutty = nutty
    # draws (not on the river)
    outs = 0
    fd = False
    sd = 0
    to_come = sc.spec.total_board_dealt - nb
    if to_come > 0 and rd.cat < 5:
        hsuit = [0, 0, 0, 0]
        for c in hole:
            hsuit[c & 3] += 1
        need_h = 1 if sc.any else 2
        for u in range(4):
            if hsuit[u] >= need_h and bsuit[u] <= 3 and (bsuit[u] + min(hsuit[u], 2 if not sc.any else 5)) == 4 \
                    and (sc.any or bsuit[u] == 2):
                fd = True
        if rd.cat < 4:
            allmask = bmask
            for r in hr:
                allmask |= 1 << r
            if st[allmask] < 0:
                for r in sc.ranks:
                    b = 1 << r
                    if not allmask & b and st[allmask | b] >= 0 and st[bmask | b] < 0:
                        sd += 1
                if not sc.any:
                    sd = sd // 2
        outs = (sc.n_ranks - 4 if fd else 0) + 4 * sd - (2 if fd and sd else 0)
        if rd.cat == 0 and sc.any:
            outs += sum(1 for r in hr if r > btop) * 2   # overcards, discounted
        outs = min(outs, 18)
    rd.outs = outs
    rd.fd = fd
    rd.sd = sd
    unseen = len(sc.spec.deck) - nb - len(hole)
    if outs and to_come > 0:
        miss = 1.0
        for k in range(min(to_come, 2)):
            miss *= max(0.0, 1.0 - outs / (unseen - k))
        de = 1.0 - miss
    else:
        de = 0.0
    rd.draw_eq = de
    rd.hs = hs
    rd.label = label
    rd.eq = hs + (1.0 - hs) * de * 0.8 if de else hs
    return rd


def _gaps_small(branks):
    if len(branks) < 3:
        return False
    return branks[0] - branks[2] <= 4


def _strength_any(sc, my, bd, hr, branks, btop, bcnt, max_bs, paired, hole, board):
    cat = sc.std_cat(my)
    bcat = sc.std_cat(bd)
    nutty = False
    hi = hr[0]
    if cat == 0:
        return 0.06 + 0.2 * (hi / 12.0) ** 2, "air", False
    if cat == 1:
        pr = (my >> 16) & 15
        if bcat == 1:                                   # the pair is on the board
            return 0.08 + 0.2 * (hi / 12.0) ** 2, "board_pair", False
        pocket = len(hr) >= 2 and hr.count(pr) >= 2 and pr not in bcnt
        above = sum(1 for r in branks if r > pr)
        if pocket:
            if above == 0:
                hs = 0.74 + 0.012 * (pr - btop)
                lab = "overpair"
            else:
                hs = 0.5 - 0.08 * above
                lab = "underpair"
        else:
            kick = max((r for r in hr if r != pr), default=0)
            if above == 0:
                hs = 0.58 + 0.014 * kick
                lab = "top_pair"
            elif above == 1:
                hs = 0.46 + 0.006 * kick
                lab = "second_pair"
            else:
                hs = 0.36 + 0.004 * kick
                lab = "low_pair"
        if max_bs >= 4:
            hs -= 0.15
        elif max_bs == 3:
            hs -= 0.04
        return max(0.1, hs), lab, False
    if cat == 2:
        if bcat == 2:
            return 0.12 + 0.15 * (hi / 12.0), "board_two_pair", False
        if bcat == 1:                                   # board pair + my pair
            pr_hi = (my >> 16) & 15
            pr_lo = (my >> 12) & 15
            mine = pr_lo if bcnt.get(pr_hi, 0) >= 2 else pr_hi
            above = sum(1 for r in branks if r > mine and bcnt.get(r, 0) < 2)
            hs = (0.7 if above == 0 else 0.56 - 0.05 * above)
            if hr.count(mine) >= 2 and above == 0:
                hs = 0.78
            return hs - (0.1 if max_bs >= 4 else 0.0), "pair_plus", False
        top2 = (my >> 16) & 15 == btop
        hs = 0.84 if top2 else 0.79
        if max_bs >= 4:
            hs -= 0.15
        return hs, "two_pair", False
    if cat == 3:
        tr = (my >> 16) & 15
        if bcat == 3:
            return 0.2 + 0.2 * (hi / 12.0), "board_trips", False
        if bcnt.get(tr, 0) == 1:                        # set
            hs = 0.92
            lab = "set"
            nutty = not paired
        else:
            kick = max((r for r in hr if r != tr), default=0)
            hs = 0.8 + 0.006 * kick
            lab = "trips"
        if max_bs >= 4:
            hs -= 0.12
        return hs, lab, nutty
    if cat == 4:
        if bcat == 4:
            return 0.45, "board_straight", False
        hs = 0.88
        if max_bs >= 3:
            hs -= 0.07 * (max_bs - 2)
        if paired:
            hs -= 0.06
        return hs, "straight", max_bs < 3 and not paired
    if cat == 5:
        if bcat == 5:
            # board flush: do I hold a higher card of that suit?
            u = max(range(4), key=lambda s: sum(1 for c in board if c & 3 == s))
            mh = max((c >> 2 for c in hole if c & 3 == u), default=-1)
            bl = min(c >> 2 for c in board if c & 3 == u)
            return (0.75 if mh >= 11 else 0.55) if mh > bl else 0.35, "board_flush", False
        u = None
        for s in range(4):
            if sum(1 for c in hole + board if c & 3 == s) >= 5:
                u = s
        mh = max((c >> 2 for c in hole if c & 3 == u), default=0)
        hs = 0.88 + 0.008 * mh
        if paired:
            hs -= 0.06
        return min(hs, 0.98), "flush", mh >= 11 and not paired
    if cat == 6:
        if bcat == 6:
            return 0.5, "board_boat", False
        return 0.96, "boat", True
    return 0.99, "monster", True


_EXACT_HS = (0.05, 0.22, 0.45, 0.62, 0.74, 0.84, 0.93, 0.98, 0.995)


def _strength_exact(sc, my, max_bs, paired):
    cat = sc.std_cat(my)
    hs = _EXACT_HS[cat]
    if cat < 5 and max_bs >= 3:
        hs -= 0.1
    if cat < 6 and paired:
        hs -= 0.08
    return max(0.03, hs), sc.order[(my >> 20) - 1], cat >= 6


# ---------------------------------------------------------------------------------------
# decision context
# ---------------------------------------------------------------------------------------
class Ctx:
    """Facts about the decision. Built once per act() (a few us)."""

    def __init__(self, obs):
        self.obs = obs
        lg = obs.legal
        self.lg = lg
        seats = obs.seats
        n = len(seats)
        self.n = n
        me = obs.seat
        self.me = me
        bb = max(1, obs.big_blind)
        self.bb = bb
        self.street = obs.street
        self.to_call = lg.call_amount
        self.pot = obs.pot
        active = [s.seat for s in seats if s.in_hand and not s.folded]
        self.active = active
        opps = [j for j in active if j != me]
        self.opps = opps
        self.n_opp = len(opps)
        self.live_opps = [j for j in opps if not seats[j].all_in]
        self.cur_bet = max(s.bet for s in seats)
        my_total = obs.my_stack + obs.my_bet
        opp_max = max((seats[j].stack + seats[j].bet for j in opps), default=0)
        self.eff = min(my_total, opp_max)                     # chips this street, effective
        self.eff_bb = self.eff / bb
        self.start_stack = obs.my_stack + seats[me].committed    # my stack at the start of the hand
        self.stack_bb = self.start_stack / bb
        self.alive = [s.seat for s in seats if s.in_hand]
        st = obs.street
        hist = obs.history
        n_r = 0
        last_r = None
        callers = 0
        limpers = 0
        acted = set()
        pf_raiser = None
        pf_raises = 0
        for (j, s, kind, amt) in hist:
            if s == 0 and kind == "raise":
                pf_raiser = j
                pf_raises += 1
            if s != st or kind == "post":
                continue
            acted.add(j)
            if kind == "raise":
                n_r += 1
                last_r = j
                callers = 0
            elif kind == "call":
                if n_r == 0:
                    limpers += 1
                else:
                    callers += 1
        self.n_raises = n_r
        self.last_raiser = last_r
        self.callers = callers
        self.limpers = limpers
        self.pf_raiser = pf_raiser
        self.pf_raises = pf_raises
        self.i_pfr = pf_raiser == me
        self.acted = acted
        # order of action this street
        if st == 0:
            start = obs.bb_seat
        else:
            start = obs.button
        order = [(start + 1 + i) % n for i in range(n)]
        self.order = order
        pos = order.index(me)
        self.behind = [j for j in order[pos + 1:] if j in opps and not seats[j].all_in]
        self.n_behind = len(self.behind)
        # preflop: seats after me still to act (for an unopened pot, everybody to the BB)
        later = [j for j in opps if order.index(j) > pos]
        self.in_position = st > 0 and all(order.index(j) < pos for j in self.live_opps)
        self.n_later = len(later)
        self.unopened = st == 0 and n_r == 0
        self.facing_allin = last_r is not None and seats[last_r].all_in
        self.raiser_total = (seats[last_r].stack + seats[last_r].committed) if last_r is not None else 0
        self.is_bb = me == obs.bb_seat
        self.is_sb = me == obs.sb_seat
        self.is_btn = me == obs.button

    def pot_odds(self) -> float:
        tc = self.to_call
        return tc / (self.pot + tc) if tc > 0 else 0.0

    def stacks_now(self):
        """Start-of-hand stacks of the seats with chips."""
        return [s.stack + s.committed for s in self.obs.seats if s.in_hand]


# ---------------------------------------------------------------------------------------
# actions and sizing
# ---------------------------------------------------------------------------------------
def raise_to(ctx: Ctx, amount, shove_frac=0.55):
    """RaiseTo(amount) clamped; if it commits more than shove_frac of the stack, shove.
    Falls back to the passive action when raising is not legal."""
    lg = ctx.lg
    if not lg.can_raise:
        return lg.passive()
    total = ctx.obs.my_stack + ctx.obs.my_bet
    amt = lg.clamp(amount)
    if amt >= shove_frac * total:
        amt = lg.max_raise_to
    return RaiseTo(amt)


def bet_frac(ctx: Ctx, frac, shove_frac=0.55):
    """Bet or raise frac of the pot (pot after calling, for raises)."""
    amt = ctx.cur_bet + frac * (ctx.pot + ctx.to_call)
    return raise_to(ctx, amt, shove_frac)


def shove(ctx: Ctx):
    lg = ctx.lg
    if lg.can_raise:
        return RaiseTo(lg.max_raise_to)
    return lg.passive()


def fold_or_check(ctx: Ctx):
    return Check() if ctx.lg.can_check else Fold()


def call_or_check(ctx: Ctx):
    return ctx.lg.passive()


def safe(lg, a):
    """Last line of defence: an illegal action becomes check/fold."""
    if lg.is_legal(a):
        return a
    if a.kind == "raise" and lg.can_raise:
        return RaiseTo(lg.clamp(a.amount))
    if a.kind == "call" and lg.can_check:
        return Check()
    return Check() if lg.can_check else Fold()


# ---------------------------------------------------------------------------------------
# push/fold chart (heads-up Nash-like % of hands by effective stack in big blinds)
# ---------------------------------------------------------------------------------------
_PUSH_HU = ((1, 1.0), (2, 1.0), (3, 0.92), (4, 0.84), (5, 0.75), (6, 0.68), (7, 0.62), (8, 0.58),
            (10, 0.51), (12, 0.45), (14, 0.40), (16, 0.36), (18, 0.32), (20, 0.29), (25, 0.22),
            (30, 0.16), (40, 0.10))
_CALL_HU = ((1, 1.0), (2, 0.92), (3, 0.76), (4, 0.64), (5, 0.56), (6, 0.50), (7, 0.45), (8, 0.41),
            (10, 0.36), (12, 0.31), (14, 0.28), (16, 0.25), (18, 0.23), (20, 0.21), (25, 0.17),
            (30, 0.13), (40, 0.09))


def _interp(tbl, x):
    if x <= tbl[0][0]:
        return tbl[0][1]
    for (x0, y0), (x1, y1) in zip(tbl, tbl[1:]):
        if x <= x1:
            return y0 + (y1 - y0) * (x - x0) / (x1 - x0)
    return tbl[-1][1]


def push_pct(stack_bb: float, behind: int, shrink=0.74) -> float:
    """Fraction of hands to open-shove with `behind` players still to act."""
    return _interp(_PUSH_HU, stack_bb) * shrink ** max(0, behind - 1)


def call_pct(stack_bb: float, behind: int = 0, shrink=0.8) -> float:
    """Fraction of hands to call a shove heads-up-like, tighter with players behind."""
    return _interp(_CALL_HU, stack_bb) * shrink ** behind


# ---------------------------------------------------------------------------------------
# ICM
# ---------------------------------------------------------------------------------------
def icm_one(stacks, payouts, i) -> float:
    """Malmuth-Harville ICM equity of player i (stacks of the players still in)."""
    n = len(stacks)
    st = [float(s) for s in stacks]
    if st[i] <= 0:
        return 0.0
    pay = list(payouts[:n]) + [0.0] * max(0, n - len(payouts))
    memo = {}
    full = (1 << n) - 1
    bit_i = 1 << i
    idx = range(n)

    def f(mask, k):
        v = memo.get(mask)
        if v is not None:
            return v
        tot = 0.0
        for j in idx:
            if mask >> j & 1:
                tot += st[j]
        if tot <= 0:
            return 0.0
        res = st[i] / tot * pay[k]
        if k + 1 < n and any(pay[k + 1:]):
            for j in idx:
                if j != i and mask >> j & 1 and st[j] > 0:
                    res += st[j] / tot * f(mask & ~(1 << j), k + 1)
        memo[mask] = res
        return res

    return f(full, 0) if full & bit_i else 0.0


def bubble_factors(stacks, payouts, i):
    """Bubble factor of player i vs each other player j for an all-in for the effective
    stack: (equity lost when losing) / (equity gained when winning). dict j -> BF."""
    base = icm_one(stacks, payouts, i)
    out = {}
    for j in range(len(stacks)):
        if j == i or stacks[j] <= 0:
            continue
        e = min(stacks[i], stacks[j])
        w = list(stacks)
        w[i] += e
        w[j] -= e
        l = list(stacks)
        l[i] -= e
        l[j] += e
        ew = icm_one(w, payouts, i) if w[j] > 0 else _icm_drop(w, payouts, i, j)
        el = 0.0 if l[i] <= 0 else icm_one(l, payouts, i)
        if l[i] <= 0:
            # busting now: I get the points of the current last paid place
            el = payouts[len(stacks) - 1] if len(stacks) - 1 < len(payouts) else 0.0
        gain = ew - base
        loss = base - el
        out[j] = loss / gain if gain > 1e-9 else 3.0
    return base, out


def _icm_drop(stacks, payouts, i, j):
    """ICM for i after j busts (j takes the last remaining place)."""
    n = len(stacks)
    rest = [s for k, s in enumerate(stacks) if k != j]
    ii = i - (1 if j < i else 0)
    return icm_one(rest, payouts[:n - 1], ii)


def icm_required_equity(risk, win, bf) -> float:
    """Equity needed to call/push when risking `risk` to win `win` with bubble factor bf."""
    return bf * risk / (bf * risk + win) if (risk + win) > 0 else 0.0


# ---------------------------------------------------------------------------------------
# opponent statistics (per seat, this table only)
# ---------------------------------------------------------------------------------------
class OppStats:
    """Per-seat counters parsed from end_hand histories, with Bayesian priors."""

    def __init__(self, n):
        self.n = n
        z = lambda: [0.0] * n  # noqa: E731
        self.hands = z()
        self.vpip = z()
        self.pfr = z()
        self.agg = z()          # postflop bets + raises
        self.pas = z()          # postflop calls
        self.cbet_faced = z()
        self.cbet_fold = z()
        self.steal_faced = z()
        self.steal_fold = z()
        self.shoves = z()       # preflop all-in raises
        self.shove_opps = z()
        self.three_bets = z()
        self.three_opps = z()
        self.sd_pct = [[] for _ in range(n)]   # preflop percentile of hands shown after putting money in

    def update(self, info, start_stacks, pf_table=None, n_seats=None):
        hist = info["history"]
        seen_vpip = set()
        seen_pfr = set()
        dealt = [j for j in range(self.n) if start_stacks[j] > 0]
        for j in dealt:
            self.hands[j] += 1
        committed = [0] * self.n
        street_bet = {}
        cur_street = 0
        pf_raises = 0
        pf_raiser = None
        faced_open = set()
        flop_bet_by_pfr = False
        faced_cbet = set()
        for (j, s, kind, amt) in hist:
            if s != cur_street:
                cur_street = s
                street_bet = {}
            if kind == "post":
                street_bet[j] = amt
                committed[j] += amt
                continue
            if s == 0:
                if kind in ("call", "raise"):
                    seen_vpip.add(j)
                if kind == "raise":
                    seen_pfr.add(j)
                    if pf_raises == 1:
                        self.three_bets[j] += 1
                    if amt - street_bet.get(j, 0) >= start_stacks[j] - committed[j] - 0:
                        self.shoves[j] += 1
                    pf_raises += 1
                    pf_raiser = j
                if pf_raises <= 1 and kind in ("fold", "call", "raise") and j not in faced_open:
                    if pf_raises == 1 and pf_raiser != j:
                        faced_open.add(j)
                        self.three_opps[j] += 1
            else:
                if kind == "raise":
                    self.agg[j] += 1
                elif kind == "call":
                    self.pas[j] += 1
                if s == 1:
                    if kind == "raise" and j == pf_raiser and not flop_bet_by_pfr and len(street_bet) == 0:
                        flop_bet_by_pfr = True
                    elif flop_bet_by_pfr and j != pf_raiser and j not in faced_cbet and kind in ("fold", "call", "raise"):
                        faced_cbet.add(j)
                        self.cbet_faced[j] += 1
                        if kind == "fold":
                            self.cbet_fold[j] += 1
            if kind == "raise":
                add = amt - street_bet.get(j, 0)
                street_bet[j] = amt
                committed[j] += add
            elif kind == "call":
                street_bet[j] = street_bet.get(j, 0) + amt
                committed[j] += amt
        for j in dealt:
            self.shove_opps[j] += 1
        for j in seen_vpip:
            self.vpip[j] += 1
        for j in seen_pfr:
            self.pfr[j] += 1
        sd = info.get("showdown")
        if sd and pf_table is not None and pf_table.two_card:
            for j, hole in sd.items():
                if len(hole) == 2:
                    self.sd_pct[j].append(pf_table.pct_l[pf_table.cls(hole)])

    # smoothed rates
    def vpip_rate(self, j):
        return (self.vpip[j] + 2.5) / (self.hands[j] + 10)

    def pfr_rate(self, j):
        return (self.pfr[j] + 1.5) / (self.hands[j] + 10)

    def af(self, j):
        return (self.agg[j] + 3) / (self.pas[j] + 2)

    def fold_cbet(self, j):
        return (self.cbet_fold[j] + 2.5) / (self.cbet_faced[j] + 5)

    def shove_rate(self, j):
        return (self.shoves[j] + 0.3) / (self.shove_opps[j] + 10)

    def three_rate(self, j):
        return (self.three_bets[j] + 0.6) / (self.three_opps[j] + 8)


def start_stacks_from_info(info):
    st = info["stacks"]
    d = info["deltas"]
    return [st[j] - d[j] for j in range(len(st))]


# ---------------------------------------------------------------------------------------
# bot base
# ---------------------------------------------------------------------------------------
class F2Base:
    """new_table / end_hand plumbing. Subclasses implement decide(obs) -> Action.
    use_icm: keep bubble factors vs every seat, refreshed in end_hand (untimed).
    use_stats: keep OppStats for every seat."""

    name = "f2_base"
    use_icm = False
    use_stats = False

    def __init__(self, **kw):
        self.kw = kw

    def new_table(self, rules, seat, seed=0):
        self.rules = rules
        self.spec = rules.spec
        self.seat = seat
        self.n = rules.num_players
        self.rng = random.Random(seed)
        self.sc = get_scorer(rules.spec)
        self.pft = get_preflop(rules.spec)
        self.payouts = tuple(rules.payouts)
        self.stacks = [rules.starting_stack] * self.n
        self.icm_eq = 0.0
        self.bf = {}
        self.stats = OppStats(self.n) if self.use_stats else None
        if self.use_icm:
            self._refresh_icm()
        self.setup()

    def setup(self):
        pass

    def _refresh_icm(self):
        alive = [j for j in range(self.n) if self.stacks[j] > 0]
        if self.seat not in alive or len(alive) < 2:
            self.bf = {}
            return
        st = [self.stacks[j] for j in alive]
        i = alive.index(self.seat)
        base, bfs = bubble_factors(st, self.payouts[:len(alive)], i)
        self.icm_eq = base
        self.bf = {alive[k]: v for k, v in bfs.items()}

    def end_hand(self, info):
        start = start_stacks_from_info(info)
        self.stacks = list(info["stacks"])
        if self.stats is not None:
            self.stats.update(info, start, self.pft)
        if self.use_icm:
            self._refresh_icm()
        self.after_hand(info)

    def after_hand(self, info):
        pass

    def act(self, obs):
        a = self.decide(obs)
        return safe(obs.legal, a)

    def decide(self, obs):
        return obs.legal.passive()

    # helpers
    def bf_of(self, j, default=1.0):
        return self.bf.get(j, default)

    def pf(self, obs):
        return PF(self.pft, obs.hole)

    def read(self, obs):
        return read_postflop(self.sc, obs.hole, obs.board)
