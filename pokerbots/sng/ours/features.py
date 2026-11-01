"""Pure-Python hand features, shared by build_tables (offline) and strength (runtime).

Everything here is plain Python on ints (no numpy): it runs in the 1 ms decision path.
Cards are ints 0..51, rank = c >> 2 (0 = '2' .. 12 = 'A'), suit = c & 3.

Two things are computed from (hole, board):
  * pre_keys(ctx, hole): the suit-isomorphism class of the hole cards (169 classes for 2
    cards, 16,432 for 4) plus three coarser keys for shrinkage (see pre_keys).
  * post_keys(ctx, hole, board): five nested bucket keys (LEVELS) built from
      - the made hand under the spec (category order, deck, 'any' / 'exactly N' hole usage),
        evaluated by a pure-Python evaluator that reproduces engine.evaluator scores,
      - how the hole cards make it (board pair vs pocket pair vs pairing the board, set vs
        trips, hole cards in a straight / flush), its rank relative to the board
        (over / top / second ... pair), kicker class, flush nut-ness, better straights
        possible,
      - draws (flush draw: nut / non-nut / backdoor; straight outs: 0 / 1 / 2+ ranks),
      - board texture (max suit count, pairedness, connectedness) and the street.
Context objects (Ctx) are cached by the spec's card rules (card_signature), so specs that
differ only in name, stacks or betting share one context and one table.
"""
from __future__ import annotations

from itertools import combinations
from math import prod

CATS = ("high_card", "pair", "two_pair", "trips", "straight", "flush",
        "full_house", "quads", "straight_flush")
PRIMES = (2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41)

# ---- rank-mask tables shared by every spec ------------------------------------------
_NM = 1 << 13


def _bits_desc(m):
    return [r for r in range(12, -1, -1) if m >> r & 1]


def _pack(digits):
    v = 0
    for d in digits:
        v = (v << 4) | d
    return v


HIGH = [-1] * _NM      # highest rank in mask (-1 if empty)
HIGH0 = [0] * _NM      # same, 0 if empty (engine convention)
TOP2 = [0] * _NM
TOP3 = [0] * _NM
TOP5 = [0] * _NM
for _m in range(_NM):
    _b = _bits_desc(_m)
    if _b:
        HIGH[_m] = HIGH0[_m] = _b[0]
    TOP2[_m] = _pack((_b + [0, 0])[:2])
    TOP3[_m] = _pack((_b + [0, 0, 0])[:3])
    TOP5[_m] = _pack((_b + [0] * 5)[:5])
ABOVE = [((1 << 13) - 1) & ~((1 << (r + 1)) - 1) for r in range(13)]   # ranks strictly above r
del _m, _b


def card_signature(spec) -> tuple:
    """The fields of a GameSpec that change hand strength (not stacks, blinds, betting)."""
    return (tuple(sorted(spec.deck_ranks)), int(spec.hole_cards), spec.hole_usage,
            int(spec.hole_exact) if spec.hole_usage == "exactly" else -1,
            tuple(spec.board_cards_per_street), tuple(spec.discards),
            tuple(spec.category_order), bool(spec.ace_low_straight))


class Ctx:
    """Per-spec lookup tables for the pure-Python evaluator and features."""

    def __init__(self, spec):
        self.sig = card_signature(spec)
        self.ranks = sorted(spec.deck_ranks)
        self.deckmask = sum(1 << r for r in self.ranks)
        self.deck = [(r << 2) | s for r in self.ranks for s in range(4)]
        self.h = int(spec.hole_cards)
        self.exact = spec.hole_usage == "exactly"
        self.e = int(spec.hole_exact) if self.exact else 0
        self.order = tuple(spec.category_order)
        cv = {name: i + 1 for i, name in enumerate(self.order)}   # engine category values
        self.cv = cv
        (self.c_hi, self.c_pr, self.c_2p, self.c_tr, self.c_st, self.c_fl, self.c_fh,
         self.c_q, self.c_sf) = (cv[n] for n in CATS)
        # straight windows (same rule as engine.evaluator)
        rk = self.ranks
        win = []
        for i in range(len(rk) - 4):
            w = rk[i:i + 5]
            if w[-1] - w[0] == 4:
                win.append((sum(1 << r for r in w), w[-1]))
        if spec.ace_low_straight and 12 in rk and len(rk) >= 5:
            w = [12] + rk[:4]
            win.append((sum(1 << r for r in w), rk[3]))
        win.sort(key=lambda x: -x[1])
        self.windows = win
        stop = [-1] * _NM
        swin = [0] * _NM
        for m in range(_NM):
            st, mx = -1, 0
            for wm, top in win:
                if m & wm == wm and top > st:
                    st = top
                c = (m & wm).bit_count()
                if c > mx:
                    mx = c
            stop[m] = st
            swin[m] = mx
        self.stop = stop
        self.swin = swin
        fl = [0] * _NM
        for m in range(_NM):
            if m.bit_count() >= 5:
                v = (self.c_fl << 20) | TOP5[m]
                if stop[m] >= 0:
                    v = max(v, (self.c_sf << 20) | (stop[m] << 16))
                fl[m] = v
        self.flush_tbl = fl
        # board cards seen -> street index; cards still to come
        cum, self.street_of_nb = 0, {}
        for i, n in enumerate(spec.board_cards_per_street):
            cum += n
            self.street_of_nb[cum] = i
        self.total_board = cum
        # how many board ranks an opponent needs in a window to hold a straight / flush
        self.need_b = (5 - self.e) if self.exact else max(0, 5 - self.h)
        if self.exact:
            self.r5 = self._rank5_table()
            self._combo_idx = {}

    # ---- exactly-N usage: rank-only 5-card scores keyed by prime product --------------
    def _rank5_table(self):
        from itertools import combinations_with_replacement
        t = {}
        for ranks in combinations_with_replacement(self.ranks, 5):
            if max(ranks.count(r) for r in ranks) > 4:
                continue
            cards = [(r << 2) | (i % 4) for i, r in enumerate(ranks)]   # never a flush
            p = 1
            for r in ranks:
                p *= PRIMES[r]
            t[p] = eval_any(self, cards)[0]
        return t

    def combo_idx(self, n, k):
        key = (n, k)
        v = self._combo_idx.get(key)
        if v is None:
            v = self._combo_idx[key] = tuple(combinations(range(n), k))
        return v


_CTX: dict = {}


def get_ctx(spec) -> Ctx:
    sig = card_signature(spec)
    c = _CTX.get(sig)
    if c is None:
        c = _CTX[sig] = Ctx(spec)
    return c


# ---- pure-Python evaluators (scores identical to engine.evaluator) --------------------
def eval_any(ctx, cards):
    """Best hand from all cards ('any' usage). Returns (score, flush_suit or -1).
    Works for fewer than 5 cards too (partial boards): then only rank categories."""
    cnt = [0] * 13
    sm = [0, 0, 0, 0]
    S = P = T = Q = 0
    for c in cards:
        r = c >> 2
        b = 1 << r
        n = cnt[r] + 1
        cnt[r] = n
        if n == 1:
            S |= b
        elif n == 2:
            P |= b
        elif n == 3:
            T |= b
        else:
            Q |= b
        sm[c & 3] |= b
    best = (ctx.c_hi << 20) | TOP5[S]
    fs = -1
    ft = ctx.flush_tbl
    for s in range(4):
        m = sm[s]
        if m.bit_count() >= 5:
            v = ft[m]
            if v > best:
                best, fs = v, s
    st = ctx.stop[S]
    if st >= 0:
        v = (ctx.c_st << 20) | (st << 16)
        if v > best:
            best, fs = v, -1
    if P:
        pr = HIGH[P]
        Sx = S & ~(1 << pr)
        v = (ctx.c_pr << 20) | (pr << 16) | (TOP3[Sx] << 4)
        if v > best:
            best, fs = v, -1
        P2 = P & ~(1 << pr)
        if P2:
            pr2 = HIGH[P2]
            v = (ctx.c_2p << 20) | (pr << 16) | (pr2 << 12) | (HIGH0[Sx & ~(1 << pr2)] << 8)
            if v > best:
                best, fs = v, -1
        if T:
            tr = HIGH[T]
            v = (ctx.c_tr << 20) | (tr << 16) | (TOP2[S & ~(1 << tr)] << 8)
            if v > best:
                best, fs = v, -1
            Pt = P & ~(1 << tr)
            if Pt:
                v = (ctx.c_fh << 20) | (tr << 16) | (HIGH[Pt] << 12)
                if v > best:
                    best, fs = v, -1
            if Q:
                qr = HIGH[Q]
                v = (ctx.c_q << 20) | (qr << 16) | (HIGH0[S & ~(1 << qr)] << 12)
                if v > best:
                    best, fs = v, -1
    return best, fs


def eval_exact(ctx, hole, board, hs=None, bs=None):
    """Best hand using exactly ctx.e hole cards and 5 - e board cards.
    Returns (score, flush_suit or -1). Needs len(board) >= 5 - e and len(hole) >= e.
    hs / bs: per-suit rank masks of hole / board if the caller already has them."""
    e = ctx.e
    nbk = 5 - e
    hp_ = [PRIMES[c >> 2] for c in hole]
    bp_ = [PRIMES[c >> 2] for c in board]
    if e == 2:
        hp = {hp_[i] * hp_[j] for i, j in ctx.combo_idx(len(hole), 2)}
    else:
        hp = {prod([hp_[i] for i in idx]) for idx in ctx.combo_idx(len(hole), e)}
    if nbk == 3:
        bp = {bp_[i] * bp_[j] * bp_[k] for i, j, k in ctx.combo_idx(len(board), 3)}
    else:
        bp = {prod([bp_[i] for i in idx]) for idx in ctx.combo_idx(len(board), nbk)}
    r5 = ctx.r5
    best = max([r5[a * b] for a in hp for b in bp])
    fs = -1
    # flushes: e hole cards and 5 - e board cards of one suit
    if hs is None:
        hs = [0, 0, 0, 0]
        bs = [0, 0, 0, 0]
        for c in hole:
            hs[c & 3] |= 1 << (c >> 2)
        for c in board:
            bs[c & 3] |= 1 << (c >> 2)
    for s in range(4):
        hm, bm = hs[s], bs[s]
        if bm.bit_count() >= nbk and hm.bit_count() >= e:
            v = (ctx.c_fl << 20) | _pack(sorted(_bits_desc(hm)[:e] + _bits_desc(bm)[:nbk],
                                                reverse=True))
            for wm, top in ctx.windows:          # straight flush (windows sorted high first)
                hw = hm & wm
                miss = wm & ~bm
                if miss & ~hw == 0 and miss.bit_count() <= e <= hw.bit_count():
                    v = max(v, (ctx.c_sf << 20) | (top << 16))
                    break
            if v > best:
                best, fs = v, s
    return best, fs


def evaluate(ctx, hole, board):
    """Spec-aware score of the hero's best hand (engine-compatible when complete)."""
    if ctx.exact and len(board) >= 5 - ctx.e and len(hole) >= ctx.e:
        return eval_exact(ctx, hole, board)
    return eval_any(ctx, list(hole) + list(board))


# ---- preflop class keys -------------------------------------------------------------
def pre_key(hole) -> int:
    """Suit-isomorphism class: the multiset of per-suit rank masks, packed."""
    m = [0, 0, 0, 0]
    for c in hole:
        m[c & 3] |= 1 << (c >> 2)
    m.sort(reverse=True)
    return m[0] | (m[1] << 13) | (m[2] << 26) | (m[3] << 39)


PRE_LVL_SHIFT = 58
PRE_NLEVELS = 4


def pre_keys(ctx, hole) -> list:
    """Preflop keys, finest first:
      L0 suit-isomorphism class (exact),
      L1 rank multiset + sorted suit-group sizes (drops which ranks share a suit),
      L2 feature class: rank multiplicity pattern, suit pattern, top-rank class, rank-sum
         bucket, connectedness, 'nut suit' (a 2+ suit group holds the deck's top rank),
      L3 rank multiplicity pattern + suit pattern."""
    m = [0, 0, 0, 0]
    sc = [0, 0, 0, 0]
    rc = [0] * 13
    for c in hole:
        r = c >> 2
        m[c & 3] |= 1 << r
        sc[c & 3] += 1
        rc[r] += 1
    ms = sorted(m, reverse=True)
    fine = ms[0] | (ms[1] << 13) | (ms[2] << 26) | (ms[3] << 39)
    ranks = sorted([c >> 2 for c in hole], reverse=True)
    v = 0
    for r in ranks:
        v = (v << 4) | (r + 1)
    sp = sorted(sc, reverse=True)
    spk = (sp[0] << 9) | (sp[1] << 6) | (sp[2] << 3) | sp[3]
    l1 = (1 << PRE_LVL_SHIFT) | (v << 12) | spk
    mult = 0
    for x in sorted([x for x in rc if x], reverse=True):
        mult = (mult << 3) | x
    hm = 0
    for r in ranks:
        hm |= 1 << r
    rk = ctx.ranks
    topc = _cls((ABOVE[ranks[0]] & ctx.deckmask).bit_count(), 3)
    lo, span = rk[0], max(1, rk[-1] - rk[0])
    ssum = (sum(ranks) - lo * len(ranks)) * 5 // (span * len(ranks) + 1)
    conn = ctx.swin[hm]
    top_rank = rk[-1]
    nut = 0
    for s in range(4):
        if sc[s] >= 2 and m[s] >> top_rank & 1:
            nut = 1
    l2 = ((2 << PRE_LVL_SHIFT) | (mult << 24) | (spk << 12) | (topc << 9) | (ssum << 6)
          | (conn << 1) | nut)
    l3 = (3 << PRE_LVL_SHIFT) | (mult << 12) | spk
    return [fine, l1, l2, l3]


RANK_CHARS = "23456789TJQKA"


def class_label(hole) -> str:
    """'AKs', 'AKo', 'QQ' for two cards; canonical cards like 'AaKaQbJb' otherwise
    (letters a, b, c, d are suits relabelled in canonical order)."""
    if len(hole) == 2:
        a, b = sorted(hole, key=lambda c: -(c >> 2))
        ra, rb = RANK_CHARS[a >> 2], RANK_CHARS[b >> 2]
        if ra == rb:
            return ra + rb
        return ra + rb + ("s" if (a & 3) == (b & 3) else "o")
    m = [0, 0, 0, 0]
    for c in hole:
        m[c & 3] |= 1 << (c >> 2)
    m.sort(reverse=True)
    out = []
    for i, mm in enumerate(m):
        for r in _bits_desc(mm):
            out.append(RANK_CHARS[r] + "abcd"[i])
    return "".join(out)


# ---- postflop bucket keys -----------------------------------------------------------
# Feature tuple fields (each < 32, packed 5 bits apiece):
#   0 street  1 t (hand type)  2 a  3 b  4 c (type-specific details)
#   5 fd (flush draw: 0 none, 1 non-nut, 2 nut, 3 backdoor)  6 sd (straight-out ranks 0/1/2+)
#   7 tf (max board suit count)  8 tp (board pairedness)  9 ts (board connectedness)
# Levels, finest first; each level's fields include its parent's, so a parent key is the
# child key with fields masked off and the level tag replaced.
NFIELDS = 10
LEVELS = (
    (0, 1, 2, 3, 4, 5, 6, 7, 8, 9),
    (0, 1, 2, 3, 5, 6, 7, 8),
    (0, 1, 2, 5, 6, 7),
    (0, 1, 2),
    (0, 1),
)
NLEVELS = len(LEVELS)
_FIELD_MASK = [sum(31 << (5 * i) for i in lv) for lv in LEVELS]
_LVL_SHIFT = 5 * NFIELDS


def level_of(key: int) -> int:
    return key >> _LVL_SHIFT


def parent_key(key: int) -> int:
    """Key of the next coarser level (the coarsest level has no parent: -1)."""
    lv = key >> _LVL_SHIFT
    if lv + 1 >= NLEVELS:
        return -1
    return ((lv + 1) << _LVL_SHIFT) | (key & _FIELD_MASK[lv + 1])


def _cls(n, cap):
    return n if n < cap else cap


def post_features(ctx, hole, board):
    """Feature tuple (street, t, a, b, c, fd, sd, tf, tp, ts). See the field list above."""
    nb = len(board)
    street = ctx.street_of_nb.get(nb)
    if street is None:                       # unusual board size: nearest street below
        street = max([s for n, s in ctx.street_of_nb.items() if n <= nb] or [1])
    to_come = ctx.total_board - nb
    hm = 0
    hrc = [0] * 13
    hs = [0, 0, 0, 0]
    hsc = [0, 0, 0, 0]
    for c in hole:
        r = c >> 2
        hrc[r] += 1
        hm |= 1 << r
        s = c & 3
        hs[s] |= 1 << r
        hsc[s] += 1
    bm = 0
    brc = [0] * 13
    bs = [0, 0, 0, 0]
    bsc = [0, 0, 0, 0]
    for c in board:
        r = c >> 2
        brc[r] += 1
        bm |= 1 << r
        s = c & 3
        bs[s] |= 1 << r
        bsc[s] += 1
    if ctx.exact and nb >= 5 - ctx.e and len(hole) >= ctx.e:
        score, fsuit = eval_exact(ctx, hole, board, hs, bs)
    else:
        score, fsuit = eval_any(ctx, list(hole) + list(board))
    cat = ctx.order[(score >> 20) - 1]
    d0 = (score >> 16) & 15
    d1 = (score >> 12) & 15
    bmax = HIGH[bm]
    dm = ctx.deckmask
    exact = ctx.exact
    top_h = HIGH[hm]
    sec_m = hm & ~(1 << top_h)

    def pos(r):                               # distinct board ranks above r
        return _cls((bm & ABOVE[r]).bit_count(), 3)

    def kclass(r, excl, cap=3):               # deck ranks above r not excluded
        return _cls((ABOVE[r] & dm & ~excl).bit_count(), cap)

    a = b = c = 0
    if cat == "high_card":
        t = 0
        a = _cls((hm & ABOVE[bmax]).bit_count() if bmax >= 0 else 2, 2)
        b = kclass(top_h, bm, 6)
        c = kclass(HIGH[sec_m], bm | (1 << top_h), 6) if sec_m else 6
    elif cat == "pair":
        pr = d0
        hp = hrc[pr]
        if hp == 0:                           # pair on board, hero plays kickers
            t = 1
            a = _cls((hm & ABOVE[bmax]).bit_count(), 2)
            b = kclass(top_h, bm, 6)
            c = kclass(HIGH[sec_m], bm | (1 << top_h), 5) if sec_m else 5
        elif brc[pr] == 0:                    # pocket pair
            t = 2
            a = pos(pr)
            b = kclass(pr, bm, 8)             # how many ranks could make a better pocket pair
        else:                                 # one hole card pairs the board
            t = 3
            a = pos(pr)
            km = hm & ~(1 << pr)
            b = kclass(HIGH[km], bm | (1 << pr), 5) if km else 5
            c = kclass(pr, bm, 6)             # height of the pair itself
    elif cat == "two_pair":
        p1, p2 = d0, d1
        h1, h2 = hrc[p1] > 0, hrc[p2] > 0
        if h1 and h2:
            t = 4
            a = pos(p1)
            b = pos(p2)
        elif h1 or h2:
            ph = p1 if h1 else p2
            t = 5
            a = pos(ph) + (4 if brc[ph] == 0 else 0)
            b = 1 if h1 else 0                # hero's pair is the top one
            c = kclass(ph, bm, 5)
        else:
            t = 6
            a = kclass(top_h, bm, 5)
            b = kclass(HIGH[sec_m], bm | (1 << top_h), 4) if sec_m else 4
    elif cat == "trips":
        tr = d0
        n = hrc[tr]
        if n >= 2:
            t = 7                             # set
            a = pos(tr)
        elif n == 1:
            t = 8                             # trips (board pair + hole card)
            a = pos(tr)
            km = hm & ~(1 << tr)
            b = kclass(HIGH[km], bm | (1 << tr)) if km else 3
        else:
            t = 9                             # trips on board
            a = kclass(top_h, bm, 5)
            b = kclass(HIGH[sec_m], bm | (1 << top_h), 4) if sec_m else 4
    elif cat == "straight":
        top = d0
        wm = 0
        for w, tp_ in ctx.windows:
            if tp_ == top:
                wm = w
                break
        nh = (wm & hm & ~bm).bit_count()
        t = 10 + _cls(nh, 2)
        nb_need = ctx.need_b
        higher = 0
        for w, tp_ in ctx.windows:
            if tp_ > top and (w & bm).bit_count() >= nb_need:
                higher += 1
        a = _cls(higher, 3)
    elif cat == "flush":
        s = fsuit
        hsm = hs[s]
        if exact:
            uses = True
        elif bsc[s] >= 5:
            fifth = _bits_desc(bs[s])[4]
            uses = HIGH[hsm] > fifth if hsm else False
        else:
            uses = True
        t = 14 if uses else 13
        ref = HIGH[hsm] if (uses and hsm) else HIGH[bs[s]]
        a = _cls((ABOVE[ref] & dm & ~bs[s] & ~hsm).bit_count(), 4)
        b = _cls(max(0, bsc[s] - 3), 2)
    elif cat == "full_house":
        tr, pr = d0, d1
        t = 15 + (2 if hrc[tr] else 0) + (1 if hrc[pr] else 0)
        a = _cls((bm & ABOVE[tr]).bit_count(), 2)
        b = 1 if tr > pr else 0
    elif cat == "quads":
        t = 19 + (1 if hrc[d0] else 0)
        a = kclass(top_h, bm | (1 << d0)) if not hrc[d0] else 0
    else:                                      # straight flush
        t = 21 + (1 if fsuit >= 0 and hs[fsuit] else 0)
    cur = score >> 20
    # ---- draws -----------------------------------------------------------------
    fd = sd = 0
    if to_come > 0:
        if ctx.c_fl > cur:
            e = ctx.e
            for s in range(4):
                h_n = hsc[s]
                if h_n == 0:
                    continue
                b_n = bsc[s]
                if exact:
                    if h_n < e:
                        continue
                    gap = (5 - e) - b_n
                else:
                    gap = 5 - h_n - b_n
                if gap == 1:
                    hi = HIGH[hs[s]]
                    nut = (ABOVE[hi] & dm & ~bs[s] & ~hs[s]) == 0
                    v = 2 if nut else 1
                    if v > fd or fd == 3:
                        fd = v
                elif gap == 2 and to_come >= 2 and fd == 0:
                    fd = 3
        if ctx.c_st > cur:
            outs = 0
            if exact:
                e = ctx.e
                for w, _ in ctx.windows:
                    hw = w & hm
                    if hw.bit_count() < e:
                        continue
                    miss = w & ~bm
                    extra = miss & ~hw
                    if extra:
                        if extra.bit_count() == 1 and miss.bit_count() - 1 <= e:
                            outs |= extra
                    elif miss.bit_count() == e + 1:
                        outs |= miss
            else:
                hb = hm | bm
                for w, _ in ctx.windows:
                    miss = w & ~hb
                    if miss.bit_count() == 1 and (w & hm & ~bm):
                        outs |= miss
            sd = _cls((outs & dm).bit_count(), 2)
    # ---- board texture -----------------------------------------------------------
    tf = _cls(max(bsc), 4)
    mc = max(brc)
    if mc >= 3:
        tp = 3
    elif mc == 2:
        tp = 2 if sum(1 for x in brc if x >= 2) >= 2 else 1
    else:
        tp = 0
    sw = ctx.swin[bm]
    ts = 0 if sw <= 2 else (1 if sw == 3 else 2)
    return street, t, a, b, c, fd, sd, tf, tp, ts


def fine_key(f) -> int:
    """Finest-level key of a post_features tuple (level 0)."""
    street, t, a, b, c, fd, sd, tf, tp, ts = f
    return (street | (t << 5) | (a << 10) | (b << 15) | (c << 20) | (fd << 25) | (sd << 30)
            | (tf << 35) | (tp << 40) | (ts << 45))


def all_keys(f) -> list:
    """Keys of every level, finest first."""
    k = fine_key(f)
    return [k] + [(lv << _LVL_SHIFT) | (k & _FIELD_MASK[lv]) for lv in range(1, NLEVELS)]


def post_keys(ctx, hole, board):
    return all_keys(post_features(ctx, hole, board))


def pre_key_cards(key: int) -> list:
    """A representative hand of a pre_key class (suits 0..3 in canonical order)."""
    out = []
    for i in range(4):
        m = (key >> (13 * i)) & 8191
        out += [(r << 2) | i for r in range(13) if m >> r & 1]
    return out
