"""Card abstraction and the bucket-vs-bucket equity matrix (approach #4, preflop CFR).

Everything is driven by the GameSpec.

Card abstraction
  * 2 hole cards: suit-isomorphic classes from engine.equity.canonical (169 for 52
    cards, 81 for the 36-card short deck); each class is one "bucket".
  * 3+ hole cards: K equity buckets (default 50), cut at equal combo-weight
    percentiles of the class score = preflop equity vs a random hand. The score is a
    per-class Monte Carlo estimate shrunk (by inverse variance) towards a weighted
    least-squares fit on bots.balanced.hand_features, so classes that were sampled
    rarely (Omaha has 16432 classes) still get a sensible score.
  Buckets are weighted by combos: chance weights W[i, j] = probability that the SB
  holds bucket i and the BB bucket j (exact disjoint-combo counts for 2 hole cards,
  estimated from the sampler otherwise). The mapping (class key -> bucket) is stored
  with the policy, so play time uses exactly the training buckets.

Equity model (mirrors engine.equity.EquityModel.equity from the start of a hand)
  * board cards uniform over the unseen deck;
  * discards to the BOARD: a uniformly random card of each hand goes to the board;
  * discards to the MUCK: each player keeps the subset that is best on the final board.
  E[i, j] = P(win) + 0.5 P(tie) of bucket i vs bucket j, estimated by Monte Carlo:
  * "pool" mode (no discards to the board, so each hand's score depends only on its
    own cards and the board): per sampled board, score every hand of a pool once (all
    2-card combos, or a random pool of 3+-card hands) and compare ALL disjoint pairs;
    each evaluation is reused ~1000 times;
  * "pair" mode (discards to the board couple the two hands): independent deals.
  The sampler accumulates across calls, so the matrix gets more accurate the longer
  the budget; two half-sample accumulators give a standard-error estimate.
"""
from __future__ import annotations

import math
import time
from dataclasses import dataclass, field
from itertools import combinations, permutations

import numpy as np

from engine.equity import canonical
from engine.evaluator import get_evaluator

_PERMS = np.array(list(permutations(range(4))), dtype=np.int64)
RANKS = "23456789TJQKA"


# --------------------------------------------------------------------------------------
# Canonical keys
# --------------------------------------------------------------------------------------
def encode(sorted_cards) -> int:
    v = 0
    for c in sorted_cards:
        v = v * 52 + int(c)
    return v


def decode(key: int, h: int) -> tuple:
    out = []
    for _ in range(h):
        out.append(key % 52)
        key //= 52
    return tuple(reversed(out))


def class_key(cards) -> int:
    """Integer key of engine.equity.canonical(cards)."""
    return encode(canonical(cards))


def canon_keys(cards: np.ndarray) -> np.ndarray:
    """Vectorised class_key for an (N, h) array (same lexicographic minimum as canonical)."""
    cards = np.asarray(cards, dtype=np.int64)
    h = cards.shape[1]
    w = 52 ** np.arange(h - 1, -1, -1, dtype=np.int64)
    rk, su = cards & ~3, cards & 3
    best = None
    for perm in _PERMS:
        k = np.sort(rk | perm[su], axis=1) @ w
        best = k if best is None else np.minimum(best, k)
    return best


def class_label(cards) -> str:
    """'AKs', 'QQ', '72o' for 2 cards; rank string (+ suit pattern size) otherwise."""
    cs = sorted(cards, key=lambda c: -(c >> 2))
    r = "".join(RANKS[c >> 2] for c in cs)
    if len(cs) == 2:
        if cs[0] >> 2 == cs[1] >> 2:
            return r
        return r + ("s" if (cs[0] & 3) == (cs[1] & 3) else "o")
    return r + f"/{len(set(c & 3 for c in cs))}s"


def card_masks(cards: np.ndarray) -> np.ndarray:
    return np.bitwise_or.reduce(np.left_shift(np.int64(1), np.asarray(cards, dtype=np.int64)), axis=1)


# --------------------------------------------------------------------------------------
# Showdown model
# --------------------------------------------------------------------------------------
class Showdown:
    def __init__(self, spec):
        self.spec = spec
        self.ev = get_evaluator(spec)
        self.n_disc = sum(d.count for d in spec.discards)
        # as EquityModel._future_to_board(0)
        self.to_board = next((d.to_board for d in spec.discards if d.street >= 0), True)
        self.n_board = spec.total_board_dealt
        self.factorizable = self.n_disc == 0 or not self.to_board

    def best_keep(self, hole: np.ndarray, board: np.ndarray) -> np.ndarray:
        if self.n_disc == 0:
            return self.ev.evaluate_batch(hole, board)
        h = hole.shape[1]
        best = None
        for keep in combinations(range(h), h - self.n_disc):
            s = self.ev.evaluate_batch(hole[:, list(keep)], board)
            best = s if best is None else np.maximum(best, s)
        return best

    def pair_outcomes(self, h0: np.ndarray, h1: np.ndarray, boards: np.ndarray, rng) -> np.ndarray:
        """Result for the h0 player per row: 1 win, 0.5 tie, 0 loss."""
        if self.factorizable:
            s0, s1 = self.best_keep(h0, boards), self.best_keep(h1, boards)
        else:
            d = self.n_disc
            n = len(h0)
            a = np.take_along_axis(h0, np.argsort(rng.random(h0.shape), axis=1), axis=1)
            b = np.take_along_axis(h1, np.argsort(rng.random(h1.shape), axis=1), axis=1)
            fb = np.concatenate([boards, a[:, :d], b[:, :d]], axis=1)
            s0 = self.ev.evaluate_batch(a[:, d:], fb)
            s1 = self.ev.evaluate_batch(b[:, d:], fb)
            assert len(s0) == n
        return (s0 > s1) + 0.5 * (s0 == s1)


# --------------------------------------------------------------------------------------
# The hand universe: all combos (or a large random sample) with class ids
# --------------------------------------------------------------------------------------
class Universe:
    def __init__(self, spec, cap: int = 400_000, seed: int = 0):
        self.spec = spec
        self.h = spec.hole_cards
        deck = np.array(spec.deck, dtype=np.int64)
        self.D = len(deck)
        total = math.comb(self.D, self.h)
        self.enumerated = total <= cap
        if self.enumerated:
            self.combos = np.array(list(combinations(deck.tolist(), self.h)), dtype=np.int64)
        else:  # very large games: a random sample of hands stands in for the universe
            rng = np.random.default_rng(seed)
            idx = np.argsort(rng.random((cap, self.D)), axis=1)[:, :self.h]
            self.combos = np.unique(np.sort(deck[idx], axis=1), axis=0)
        self.masks = card_masks(self.combos)
        keys = canon_keys(self.combos)
        self.class_keys, self.cls, self.class_count = np.unique(keys, return_inverse=True,
                                                               return_counts=True)
        self.cls = self.cls.astype(np.int64)
        self.C = len(self.class_keys)

    def class_cards(self) -> np.ndarray:
        return np.array([decode(int(k), self.h) for k in self.class_keys], dtype=np.int64)


# --------------------------------------------------------------------------------------
# Monte Carlo sampler
# --------------------------------------------------------------------------------------
class Sampler:
    """Draws boards/deals and accumulates win and count statistics.

    labels: (N,) label per universe combo (class id for stage 1, bucket for stage 2).
    per_hand=True accumulates per label (equity vs a random hand), otherwise per
    (label, label) pair (the matrix), in two halves for an error estimate."""

    def __init__(self, spec, universe: Universe, labels: np.ndarray, L: int, *, per_hand: bool,
                 pool_size: int = 1200, pair_batch: int = 20000, rng=None):
        self.spec, self.u, self.L = spec, universe, L
        self.labels = np.asarray(labels, dtype=np.int64)
        self.per_hand = per_hand
        self.sd = Showdown(spec)
        self.deck = np.array(spec.deck, dtype=np.int64)
        self.pos = np.full(52, -1, dtype=np.int64)
        self.pos[self.deck] = np.arange(len(self.deck))
        self.pool_size, self.pair_batch = pool_size, pair_batch
        self.rng = rng if rng is not None else np.random.default_rng(0)
        shape = (L,) if per_hand else (2, L * L)
        self.wins = np.zeros(shape)
        self.cnt = np.zeros(shape)
        self.appear = np.zeros(L)
        self.steps = 0
        self.samples = 0       # boards (pool mode) or deals (pair mode)
        self.seconds = 0.0

    @property
    def mode(self) -> str:
        return "pool" if self.sd.factorizable else "pair"

    def run(self, seconds: float) -> None:
        t0 = time.perf_counter()
        end = t0 + max(0.0, seconds)
        while True:
            if self.mode == "pool":
                self._pool_step()
            else:
                self._pair_step()
            self.steps += 1
            if time.perf_counter() >= end:
                break
        self.seconds += time.perf_counter() - t0

    # ---- pool mode -------------------------------------------------------------------
    def _pool_step(self):
        u, rng = self.u, self.rng
        nb = self.sd.n_board
        board = self.deck[np.argsort(rng.random(len(self.deck)))[:nb]]
        bmask = int(np.bitwise_or.reduce(np.left_shift(np.int64(1), board))) if nb else 0
        valid = np.flatnonzero((u.masks & bmask) == 0)
        whole = len(valid) <= self.pool_size
        idx = valid if whole else valid[rng.integers(0, len(valid), self.pool_size)]
        s = self.sd.best_keep(u.combos[idx], np.broadcast_to(board, (len(idx), nb)))
        lab = self.labels[idx]
        if whole:   # pairs sharing a card, from the precomputed universe list
            oa, ob = self._universe_overlaps()
            pos = np.full(len(u.combos), -1, dtype=np.int64)
            pos[idx] = np.arange(len(idx))
            pa, pb = pos[oa], pos[ob]
            keep = (pa >= 0) & (pb >= 0)
            pa, pb = pa[keep], pb[keep]
        else:
            m = u.masks[idx]
            pa, pb = np.nonzero((m[:, None] & m[None, :]) != 0)
        g_ov = 0.5 * (1.0 + np.sign(s[pa] - s[pb]))       # overlapping pairs (incl. a == a)
        if self.per_hand:
            ss = np.sort(s)
            w = 0.5 * (np.searchsorted(ss, s, "left") + np.searchsorted(ss, s, "right"))
            w = w - np.bincount(pa, g_ov, len(idx))
            c = len(idx) - np.bincount(pa, minlength=len(idx))
            self._add_hands(lab, w / np.maximum(c, 1))
        else:
            rows, n_lab = _rank_counts(s, lab, self.L)    # (n, L) wins vs each label, (L,)
            half = self.steps & 1
            LL = self.L * self.L
            w = np.bincount((lab[:, None] * self.L + np.arange(self.L)[None, :]).ravel(),
                            rows.ravel(), LL)
            ov = lab[pa] * self.L + lab[pb]
            self.wins[half] += w - np.bincount(ov, g_ov, LL)
            self.cnt[half] += np.outer(n_lab, n_lab).ravel() - np.bincount(ov, minlength=LL)
        self.samples += 1

    def _universe_overlaps(self):
        """All ordered (a, b) universe pairs that share a card, including a == b."""
        if getattr(self, "_ov", None) is None:
            m = self.u.masks
            A, B = [], []
            for a0 in range(0, len(m), 1024):
                a, b = np.nonzero((m[a0:a0 + 1024, None] & m[None, :]) != 0)
                A.append(a + a0)
                B.append(b)
            self._ov = (np.concatenate(A), np.concatenate(B))
        return self._ov

    # ---- pair mode -------------------------------------------------------------------
    def _pair_step(self):
        u, rng = self.u, self.rng
        B, N, nb = self.pair_batch, len(u.combos), self.sd.n_board
        i0 = rng.integers(0, N, B)
        i1 = rng.integers(0, N, B)
        ok = (u.masks[i0] & u.masks[i1]) == 0
        i0, i1 = i0[ok], i1[ok]
        h0, h1 = u.combos[i0], u.combos[i1]
        keys = rng.random((len(i0), len(self.deck)))
        rows = np.arange(len(i0))[:, None]
        keys[rows, self.pos[h0]] = 2.0
        keys[rows, self.pos[h1]] = 2.0
        bidx = np.argpartition(keys, nb - 1, axis=1)[:, :nb] if nb else np.zeros((len(i0), 0), np.int64)
        boards = self.deck[bidx]
        out = self.sd.pair_outcomes(h0, h1, boards, rng)
        l0, l1 = self.labels[i0], self.labels[i1]
        if self.per_hand:
            self._add_hands(np.concatenate([l0, l1]), np.concatenate([out, 1.0 - out]))
        else:
            half = self.steps & 1
            p01, p10 = l0 * self.L + l1, l1 * self.L + l0
            self.wins[half] += np.bincount(p01, out, self.L ** 2) + np.bincount(p10, 1.0 - out, self.L ** 2)
            self.cnt[half] += np.bincount(p01, minlength=self.L ** 2) + np.bincount(p10, minlength=self.L ** 2)
        self.samples += len(i0)

    def _add_hands(self, lab, x):
        """per_hand mode: one equity observation x per hand appearance."""
        self.wins += np.bincount(lab, x, self.L)
        self.cnt += np.bincount(lab, x * x, self.L)      # sum of squares
        self.appear += np.bincount(lab, minlength=self.L)

    # ---- results ---------------------------------------------------------------------
    def hand_equity(self):
        """per_hand mode: (mean equity per label, appearances per label, pooled
        per-appearance variance)."""
        app = self.appear
        eq = np.where(app > 0, self.wins / np.maximum(app, 1), 0.5)
        within = self.cnt - app * eq * eq                 # sum of squared deviations
        dof = np.maximum(app - 1, 0)
        var1 = float(within[dof > 0].sum() / max(dof.sum(), 1)) if dof.any() else 0.25
        return eq, app, max(var1, 1e-6)

    def matrix(self):
        """(E, counts, stderr) in pair mode; E[i, j] is i's equity vs j."""
        L = self.L
        w, c = self.wins.sum(0).reshape(L, L), self.cnt.sum(0).reshape(L, L)
        E = np.where(c > 0, w / np.maximum(c, 1e-12), 0.5)
        Ea = np.where(self.cnt[0] > 0, self.wins[0] / np.maximum(self.cnt[0], 1e-12), np.nan).reshape(L, L)
        Eb = np.where(self.cnt[1] > 0, self.wins[1] / np.maximum(self.cnt[1], 1e-12), np.nan).reshape(L, L)
        ok = np.isfinite(Ea) & np.isfinite(Eb)
        wt = c * ok
        se = float(np.sqrt(np.sum(wt * np.nan_to_num(Ea - Eb) ** 2) / max(wt.sum(), 1e-12)) / 2) \
            if ok.any() else float("nan")
        return E, c, se


def _rank_counts(s: np.ndarray, lab: np.ndarray, L: int):
    """rows[a, j] = sum over pool hands b with label j of [s_a > s_b] + 0.5 [s_a == s_b]
    (b == a included; callers subtract overlapping pairs), and the label counts."""
    n = len(s)
    order = np.argsort(s, kind="stable")
    ss, ls = s[order], lab[order]
    cum = np.zeros((n + 1, L))
    cum[np.arange(1, n + 1), ls] = 1.0
    np.cumsum(cum, axis=0, out=cum)
    lt = cum[np.searchsorted(ss, ss, "left")]
    le = cum[np.searchsorted(ss, ss, "right")]
    rows = np.empty((n, L))
    rows[order] = 0.5 * (lt + le)
    return rows, cum[-1]


# --------------------------------------------------------------------------------------
# The card abstraction
# --------------------------------------------------------------------------------------
@dataclass
class CardAbstraction:
    kind: str                       # "class" (2 hole cards) or "bucket"
    K: int
    hole: int
    key_to_bucket: dict             # class key (int) -> bucket
    freq: np.ndarray                # (K,) share of combos per bucket
    labels: list                    # label per bucket
    boundaries: np.ndarray = None   # bucket kind: score cut points (K - 1)
    coef: np.ndarray = None         # bucket kind: regression on hand_features (fallback)
    deck_ranks: tuple = ()
    info: dict = field(default_factory=dict)

    def bucket_of(self, cards) -> int:
        b = self.key_to_bucket.get(class_key(cards))
        if b is not None:
            return int(b)
        # only possible when the universe was sampled: regression score
        from bots.balanced import hand_features
        sc = float(hand_features(np.array([list(cards)]), self.deck_ranks)[0] @ self.coef)
        return int(np.searchsorted(self.boundaries, sc, side="right"))


def build_class_abstraction(spec, u: Universe) -> CardAbstraction:
    reps = u.class_cards()
    labels = [class_label(r) for r in reps]
    freq = u.class_count / u.class_count.sum()
    return CardAbstraction("class", u.C, u.h, {int(k): i for i, k in enumerate(u.class_keys)},
                           freq, labels, deck_ranks=tuple(spec.deck_ranks))


def class_scores(spec, u: Universe, seconds: float, rng, pool_size: int = 1200):
    """Per-class preflop equity vs a random hand: Monte Carlo shrunk towards a regression."""
    from bots.balanced import hand_features
    s = Sampler(spec, u, u.cls, u.C, per_hand=True, pool_size=pool_size, rng=rng)
    s.run(seconds)
    mc, app, var1 = s.hand_equity()
    X = hand_features(u.class_cards(), spec.deck_ranks)
    wt = app.astype(np.float64)
    A = X.T @ (X * wt[:, None]) + 1e-3 * np.eye(X.shape[1])
    coef = np.linalg.solve(A, X.T @ (wt * mc))
    pred = X @ coef
    var_mc = var1 / np.maximum(app, 1e-9)
    seen = app > 0
    noise = float(np.average(var_mc[seen], weights=wt[seen])) if seen.any() else 0.0
    resid = float(np.average((mc[seen] - pred[seen]) ** 2, weights=wt[seen])) if seen.any() else 0.0
    resid_var = max(resid - noise, 2.5e-5)
    w = np.where(seen, resid_var / (resid_var + var_mc), 0.0)
    score = pred + w * (mc - pred)
    info = dict(stage1_seconds=round(s.seconds, 2), stage1_samples=s.samples,
                mean_appearances=float(app.mean()), resid_sd=math.sqrt(resid_var),
                mc_noise_sd=math.sqrt(noise))
    return score, coef, info


def build_bucket_abstraction(spec, u: Universe, K: int, seconds: float, rng,
                             pool_size: int = 1200) -> CardAbstraction:
    score, coef, info = class_scores(spec, u, seconds, rng, pool_size)
    order = np.argsort(score, kind="stable")
    wts = u.class_count[order].astype(np.float64)
    cum = np.cumsum(wts) - 0.5 * wts
    b_sorted = np.minimum(K - 1, (cum / wts.sum() * K).astype(np.int64))
    bucket = np.empty(u.C, dtype=np.int64)
    bucket[order] = b_sorted
    K_eff = int(bucket.max()) + 1
    freq = np.bincount(bucket, weights=u.class_count, minlength=K_eff)
    freq = freq / freq.sum()
    s_sorted = score[order]
    boundaries = np.array([s_sorted[b_sorted >= k][0] for k in range(1, K_eff)])
    mean_score = np.bincount(bucket, weights=score * u.class_count, minlength=K_eff) / \
        np.maximum(np.bincount(bucket, weights=u.class_count, minlength=K_eff), 1e-12)
    labels = [f"b{k:02d}({mean_score[k]:.3f})" for k in range(K_eff)]
    info["bucket_mean_equity"] = mean_score.round(4).tolist()
    return CardAbstraction("bucket", K_eff, u.h, {int(k): int(b) for k, b in zip(u.class_keys, bucket)},
                           freq, labels, boundaries=boundaries, coef=coef,
                           deck_ranks=tuple(spec.deck_ranks), info=info)


def exact_pair_weights(u: Universe, combo_bucket: np.ndarray, K: int) -> np.ndarray:
    """W[i, j] = number of disjoint (SB combo in i, BB combo in j) pairs, normalised."""
    m = u.masks
    W = np.zeros(K * K)
    step = 2048
    for a in range(0, len(m), step):
        D = (m[a:a + step, None] & m[None, :]) == 0
        pidx = (combo_bucket[a:a + step, None] * K + combo_bucket[None, :]).ravel()
        W += np.bincount(pidx, D.ravel().astype(np.float64), K * K)
    W = W.reshape(K, K)
    return W / W.sum()
