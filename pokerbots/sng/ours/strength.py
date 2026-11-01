"""Fast hand strength for the 1 ms decision limit: pure Python + dict lookups.

    from sng.ours import strength as S
    S.preload(spec)                      # once, at table start (loads ~0.1-0.5 s)
    S.equity(hole, board, k, spec)       # all-in equity vs k random hands (ties split)
    S.preflop_equity(hole, k, spec)
    S.postflop_equity(hole, board, k, spec)
    S.hand_class(hole, spec)             # 'AKs', 'QQ', 'AaKaQbJb' (Omaha), ...
    S.has_table(spec)

Tables (cache/sng/strength_<name>.npz, from sng.ours.build_tables) are matched by the
spec's CARD rules (deck, hole cards, usage, board structure, category order), not by its
name: strength_<spec.name>.npz is tried first, then any table in cache/sng with the same
card signature. So the sit-and-go spec 'sng_nlhe' uses the a_nlhe100 table (same cards).
Without a table every call falls back to a cheap heuristic (never raises, never slow).
k above the table's k_max (tiny decks) is extrapolated; k <= 0 returns 1.0.
"""
from __future__ import annotations

import json
from pathlib import Path

from sng.ours import features as F

CACHE_DIR = Path(__file__).resolve().parents[2] / "cache" / "sng"

_post_features = F.post_features
_fine_key = F.fine_key
_all_keys = F.all_keys
_pre_key = F.pre_key
_pre_keys = F.pre_keys


# ---- heuristics (no table) ------------------------------------------------------------
def _multiway(p, k):
    """Equity vs k from equity vs 1 (odds model; exact at p = 0.5: 1 / (k + 1))."""
    if k <= 1:
        return p
    if p <= 0.0:
        return 0.0
    if p >= 1.0:
        return 1.0
    o = (1.0 - p) / p
    return 1.0 / (1.0 + k * o ** (1.0 - 0.045 * (min(k, 7) - 1)))


def _heur_pre1(ctx, hole):
    rk = ctx.ranks
    span = max(1, len(rk) - 1)
    lo_r = rk[0]
    rs = sorted([(c >> 2) for c in hole], reverse=True)
    xs = [(r - lo_r) / span for r in rs]
    if len(hole) == 2:
        if rs[0] == rs[1]:
            return 0.5 + 0.35 * xs[0]
        p = 0.30 + 0.20 * xs[0] + 0.12 * xs[1]
        if (hole[0] & 3) == (hole[1] & 3):
            p += 0.03
        if rs[0] - rs[1] <= 2:
            p += 0.02
        return p
    suits = [0, 0, 0, 0]
    for c in hole:
        suits[c & 3] += 1
    p = 0.40 + 0.12 * sum(xs) / len(xs)
    p += 0.03 * sum(1 for n in suits if n >= 2)
    p += 0.04 * (len(rs) - len(set(rs)) > 0)
    return min(0.75, max(0.3, p))


_HEUR_CAT = (0.33, 0.58, 0.76, 0.83, 0.86, 0.90, 0.95, 0.985, 0.998)


def _heur_post1(ctx, hole, board):
    try:
        f = _post_features(ctx, hole, board)
        score, _ = F.evaluate(ctx, hole, board)
    except Exception:
        return 0.5
    p = _HEUR_CAT[min(8, (score >> 20) - 1)]
    if f[1] == 2 or f[1] == 3:              # pocket pair / pair with the board: by position
        p += 0.08 - 0.06 * f[2]
    if f[1] in (1, 6, 9, 23, 24, 25, 26):   # board made the hand: hero has little
        p -= 0.12
    if ctx.total_board > len(board):        # draws: f[5] flush draw, f[6] straight outs
        p += (0.10 if f[5] in (1, 2) else 0.0) + 0.05 * f[6]
    return min(0.999, max(0.05, p))


# ---- tables -------------------------------------------------------------------------------
class Table:
    """In-memory lookup tables; values stored flat: vals[i * K + k - 1]."""

    def __init__(self, ctx, pre_keys, pre_vals, post_keys, post_vals, K, meta):
        self.ctx = ctx
        self.K = int(K)
        self.meta = meta
        self.pre = dict(zip(pre_keys.tolist(), range(len(pre_keys))))
        self.pv = pre_vals.ravel().tolist()
        self.post = dict(zip(post_keys.tolist(), range(len(post_keys))))
        self.qv = post_vals.ravel().tolist()
        self._memo = {}           # (hole, board) -> row: repeated calls for other k are free

    def _kv(self, vals, i, k):
        K = self.K
        if k <= K:
            return vals[i * K + k - 1]
        e = vals[i * K + K - 1]                # extrapolate beyond k_max
        return e ** (k / K)

    def preflop(self, hole, k):
        d = self.pre
        i = d.get(_pre_key(hole))
        if i is None:
            for key in _pre_keys(self.ctx, hole)[1:]:
                i = d.get(key)
                if i is not None:
                    break
            else:
                return _multiway(_heur_pre1(self.ctx, hole), k)
        return self._kv(self.pv, i, k)

    def postflop(self, hole, board, k):
        mk = (tuple(hole), tuple(board))
        memo = self._memo
        i = memo.get(mk)
        if i is None:
            f = _post_features(self.ctx, hole, board)
            d = self.post
            i = d.get(_fine_key(f))
            if i is None:
                for key in _all_keys(f)[1:]:
                    i = d.get(key)
                    if i is not None:
                        break
                else:
                    i = -1
            if len(memo) > 50000:
                memo.clear()
            memo[mk] = i
        if i < 0:
            return _multiway(_heur_post1(self.ctx, hole, board), k)
        return self._kv(self.qv, i, k)

    def equity(self, hole, board, k):
        if k <= 0:
            return 1.0
        if board:
            return self.postflop(hole, board, k)
        return self.preflop(hole, k)


class _Heuristic:
    """Stand-in when no table matches the spec."""
    K = 7
    meta = None

    def __init__(self, ctx):
        self.ctx = ctx

    def preflop(self, hole, k):
        return _multiway(_heur_pre1(self.ctx, hole), k)

    def postflop(self, hole, board, k):
        return _multiway(_heur_post1(self.ctx, hole, board), k)

    def equity(self, hole, board, k):
        if k <= 0:
            return 1.0
        return self.postflop(hole, board, k) if board else self.preflop(hole, k)


def _read_meta(path):
    import numpy as np
    with np.load(path) as z:
        return json.loads(str(z["meta"]))


def load_file(path, spec):
    """Load one table file for `spec` (raises if it does not match the card rules)."""
    import numpy as np
    ctx = F.get_ctx(spec)
    with np.load(path) as z:
        meta = json.loads(str(z["meta"]))
        if meta.get("signature") != repr(ctx.sig):
            raise ValueError(f"{path}: built for different card rules")
        return Table(ctx, z["pre_keys"], z["pre_vals"], z["post_keys"], z["post_vals"],
                     meta["k_max"], meta)


def find_table_file(spec, cache_dir=None):
    """Path of a table whose card signature matches spec, or None."""
    d = Path(cache_dir) if cache_dir else CACHE_DIR
    sig = repr(F.card_signature(spec))
    first = d / f"strength_{spec.name}.npz"
    cands = ([first] if first.exists() else []) + sorted(
        p for p in d.glob("strength_*.npz") if p != first) if d.exists() else []
    for p in cands:
        try:
            if _read_meta(p).get("signature") == sig:
                return p
        except Exception:
            continue
    return None


_BY_SIG: dict = {}
_LAST = [None, None]          # (spec object, table): identity fast path


def _get(spec):
    if spec is _LAST[0]:
        return _LAST[1]
    sig = F.card_signature(spec)
    tab = _BY_SIG.get(sig)
    if tab is None:
        ctx = F.get_ctx(spec)
        tab = None
        try:
            p = find_table_file(spec)
            if p is not None:
                tab = load_file(p, spec)
        except Exception:
            tab = None
        if tab is None:
            tab = _Heuristic(ctx)
        _BY_SIG[sig] = tab
    _LAST[0], _LAST[1] = spec, tab
    return tab


def preload(spec) -> bool:
    """Load (or set up the fallback for) spec now; True if a real table is in use."""
    return has_table(spec)


def has_table(spec) -> bool:
    return isinstance(_get(spec), Table)


def table_meta(spec):
    """Build metadata (sample counts, validation MAE, ...) or None without a table."""
    return _get(spec).meta


def forget(spec=None):
    """Drop cached tables (all, or the one for spec's card rules) so they reload."""
    if spec is None:
        _BY_SIG.clear()
    else:
        _BY_SIG.pop(F.card_signature(spec), None)
    _LAST[0] = _LAST[1] = None


def use_table(spec, tab):
    """Install an in-memory Table for spec (tests / just-built tables)."""
    _BY_SIG[F.card_signature(spec)] = tab
    _LAST[0] = _LAST[1] = None


# ---- public API ---------------------------------------------------------------------------
def equity(hole, board, k, spec) -> float:
    """All-in equity of hole (+ board) vs k random opponent hands; preflop if no board.
    k is rounded to an int (interpolate between k values yourself if you need to)."""
    try:
        k = int(round(k))
        return _get(spec).equity(hole, board, k)
    except Exception:
        return 1.0 / (k + 1) if k >= 0 else 1.0


def preflop_equity(hole, k, spec) -> float:
    """Equity of the hole cards vs k random hands, before any board card."""
    try:
        k = int(round(k))
        return 1.0 if k <= 0 else _get(spec).preflop(hole, k)
    except Exception:
        return 1.0 / (k + 1) if k >= 0 else 1.0


def postflop_equity(hole, board, k, spec) -> float:
    """Equity vs k random hands given the board so far (any street after preflop)."""
    try:
        k = int(round(k))
        if k <= 0:
            return 1.0
        tab = _get(spec)
        return tab.postflop(hole, board, k) if board else tab.preflop(hole, k)
    except Exception:
        return 1.0 / (k + 1) if k >= 0 else 1.0


def hand_class(hole, spec=None) -> str:
    """Suit-isomorphism class label of the hole cards ('AKs', 'AKo', 'QQ', 'AaKaQbJb')."""
    return F.class_label(hole)


def hand_class_key(hole) -> int:
    """Integer class key (the preflop table key)."""
    return _pre_key(hole)
