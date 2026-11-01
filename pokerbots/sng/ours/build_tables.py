"""Offline builder for the fast hand-strength tables (sng.ours.strength).

    python3 -m sng.ours.build_tables --variant a_nlhe100 --minutes 3 --workers 4
    python3 -c "from sng.ours.build_tables import build; build(spec, 'cache/sng', 180)"

Method (one file per spec: cache/sng/strength_<spec.name>.npz):
  * Deal-sharing Monte Carlo. Each sample deals P = k_max + 1 random hands and a full
    random board, evaluated once with engine.evaluator. Every one of the P hands is a
    "hero"; its opponents are the next k hands (k = 1..k_max), so one deal gives P heroes
    x (preflop + every postflop street) training rows, each with the all-in share
    (win = 1, m-way tie = 1/m) against k = 1..k_max random opponents.
  * Preflop rows are bucketed by the suit-isomorphism class of the hole cards (169 for
    two cards, 16,432 for four) and 3 coarser keys (features.pre_keys); postflop rows by
    the 6 nested feature levels of features.post_keys. Every bucket mean is shrunk toward
    its parent bucket (empirical-Bayes prior strength n0 per level, estimated from the
    data), which handles rare buckets such as the 1-combo Omaha classes. The runtime
    looks up the finest level that was seen in training.
  * Discard variants are refused (the sit-and-go engine has none); strength.py then
    uses its heuristic.
  * Validation: fresh random situations per street with "true" equity from a large MC
    (n rollouts vs k_max opponents, every k read off the same rollouts); the table is
    queried through the runtime code path and the mean absolute error is reported per
    street and k (stored in the file's metadata).
Sample counts scale with the time budget: workers run batches until their deadline.
"""
from __future__ import annotations

import argparse
import json
import multiprocessing as mp
import os
import sys
import time
from pathlib import Path

import numpy as np

from engine.evaluator import get_evaluator
from sng.ours import features as F

VERSION = 1
DEFAULT_OUT = Path(__file__).resolve().parents[2] / "cache" / "sng"
TRAIN_FRAC = 0.72        # of the budget: training deals
VAL_FRAC = 0.20          # of the budget: validation MC (rest: merge, shrink, save)


def k_max_for(spec) -> int:
    """Most opponents the deck allows (capped at 7 = 8-handed)."""
    room = len(spec.deck) - spec.total_board_dealt
    return max(1, min(7, room // spec.hole_cards - 1))


def table_path(spec, out_dir=DEFAULT_OUT) -> Path:
    return Path(out_dir) / f"strength_{spec.name}.npz"


def _streets(spec):
    """Board sizes seen at the postflop streets (dedup, > 0)."""
    out, cum = [], 0
    for n in spec.board_cards_per_street:
        cum += n
        if cum > 0 and cum not in out:
            out.append(cum)
    return out


def shares(me, opp):
    """me (B,), opp (B,K) scores -> (B,K) all-in share vs the first k opponents."""
    best = np.maximum.accumulate(opp, axis=1)
    ties = np.cumsum(opp == me[:, None], axis=1)
    return np.where(me[:, None] >= best, 1.0 / (1.0 + ties), 0.0)


class Acc:
    """key -> count, sum and sum of squares of the K targets, and the key's parent key
    (next coarser level; -1 for the coarsest)."""

    def __init__(self, K):
        self.K = K
        self.index: dict = {}
        self.parent: dict = {}
        self.n = np.zeros(0, np.int64)
        self.s = np.zeros((0, K))
        self.q = np.zeros((0, K))

    def _grow(self, size):
        if size > len(self.n):
            cap = max(size, 2 * len(self.n), 1024)
            for name, shape in (("n", (cap,)), ("s", (cap, self.K)), ("q", (cap, self.K))):
                old = getattr(self, name)
                new = np.zeros(shape, old.dtype)
                new[:len(old)] = old
                setattr(self, name, new)

    def add(self, keys, targets, nlev):
        """keys (M * nlev,) grouped finest-first per row; targets (M, K)."""
        kk = keys.reshape(-1, nlev)
        par = np.concatenate([kk[:, 1:], np.full((len(kk), 1), -1, np.int64)], axis=1).ravel()
        tg = np.repeat(targets, nlev, axis=0)
        u, first, inv = np.unique(keys, return_index=True, return_inverse=True)
        index, parent = self.index, self.parent
        ul = u.tolist()
        for k, p in zip(ul, par[first].tolist()):
            if k not in index:
                index[k] = len(index)
                parent[k] = p
        idx = np.fromiter((index[k] for k in ul), np.int64, len(ul))
        self._grow(len(index))
        self.n[idx] += np.bincount(inv, minlength=len(u))
        for j in range(self.K):
            self.s[idx, j] += np.bincount(inv, weights=tg[:, j], minlength=len(u))
            self.q[idx, j] += np.bincount(inv, weights=tg[:, j] ** 2, minlength=len(u))

    def merge(self, other):
        keys = list(other.index.keys())
        if not keys:
            return
        src = np.fromiter(other.index.values(), np.int64, len(keys))
        for k in keys:
            if k not in self.index:
                self.index[k] = len(self.index)
                self.parent[k] = other.parent[k]
        idx = np.fromiter((self.index[k] for k in keys), np.int64, len(keys))
        self._grow(len(self.index))
        self.n[idx] += other.n[src]
        self.s[idx] += other.s[src]
        self.q[idx] += other.q[src]

    def arrays(self):
        m = len(self.index)
        keys = np.fromiter(self.index.keys(), np.int64, m)
        par = np.fromiter((self.parent[k] for k in self.index), np.int64, m)
        return keys, par, self.n[:m].copy(), self.s[:m].copy(), self.q[:m].copy()

    def __getstate__(self):
        return {"K": self.K, "arr": self.arrays()}

    def __setstate__(self, st):
        self.K = st["K"]
        keys, par, self.n, self.s, self.q = st["arr"]
        kl = keys.tolist()
        self.index = {k: i for i, k in enumerate(kl)}
        self.parent = dict(zip(kl, par.tolist()))


def _deal(rng, deck, B, ncards):
    return deck[np.argsort(rng.random((B, len(deck))), axis=1)[:, :ncards]]


def _targets(ev, holes, board, K):
    """holes (B,P,h), board (B,n) -> (B*P, K) shares of each hero vs the next k hands."""
    B, P, h = holes.shape
    sc = ev.evaluate_batch(holes.reshape(B * P, h), np.repeat(board, P, axis=0)).reshape(B, P)
    tg = np.empty((B, P, K))
    for i in range(P):
        tg[:, i] = shares(sc[:, i], sc[:, [(i + 1 + j) % P for j in range(K)]])
    return tg.reshape(B * P, K)


# ---- worker: training ------------------------------------------------------------------
def _train(spec, seed, t_end, batch, max_deals=None, pre_extra=0):
    """Shared deals (preflop + every street) plus `pre_extra` preflop-only batches per
    shared batch (cheap: no postflop features), for games with many preflop classes."""
    ctx = F.get_ctx(spec)
    ev = get_evaluator(spec)
    deck = np.array(ctx.deck, np.int64)
    K = k_max_for(spec)
    P, h, nbt = K + 1, spec.hole_cards, spec.total_board_dealt
    streets = _streets(spec)
    rng = np.random.default_rng(seed)
    pre, post = Acc(K), Acc(K)
    pre_keys, post_keys = F.pre_keys, F.post_keys
    NL, PL = F.NLEVELS, F.PRE_NLEVELS
    deals = pre_deals = 0
    while time.time() < t_end and (max_deals is None or deals < max_deals):
        cards = _deal(rng, deck, batch, P * h + nbt)
        holes = cards[:, :P * h].reshape(batch, P, h)
        board = cards[:, P * h:]
        tg = _targets(ev, holes, board, K)
        hl, bl = holes.tolist(), board.tolist()
        pk, qk, qr = [], [], []
        row = 0
        for bi in range(batch):
            b = bl[bi]
            bs = [b[:n] for n in streets]
            for hole in hl[bi]:
                pk.extend(pre_keys(ctx, hole))
                for bb in bs:
                    qk.extend(post_keys(ctx, hole, bb))
                    qr.append(row)
                row += 1
        pre.add(np.array(pk, np.int64), tg, PL)
        if qk:
            post.add(np.array(qk, np.int64), tg[qr], NL)
        deals += batch
        for _ in range(pre_extra):
            cards = _deal(rng, deck, batch, P * h + nbt)
            holes = cards[:, :P * h].reshape(batch, P, h)
            tg = _targets(ev, holes, cards[:, P * h:], K)
            pk = []
            for hand in holes.tolist():
                for hole in hand:
                    pk.extend(pre_keys(ctx, hole))
            pre.add(np.array(pk, np.int64), tg, PL)
            pre_deals += batch
    return pre, post, deals, pre_deals


# ---- worker: validation ----------------------------------------------------------------
def mc_truth(ev, deck, hole, board, K, nbt, n, rng):
    """(K,) MC equity vs k = 1..K random opponents and its (K,) standard error."""
    h = len(hole)
    used = set(hole) | set(board)
    rest = np.array([c for c in deck.tolist() if c not in used], np.int64)
    need = K * h + (nbt - len(board))
    d = _deal(rng, rest, n, need)
    fb = np.concatenate([np.broadcast_to(np.array(board, np.int64), (n, len(board))),
                         d[:, K * h:]], axis=1)
    me = ev.evaluate_batch(np.broadcast_to(np.array(hole, np.int64), (n, h)), fb)
    op = ev.evaluate_batch(d[:, :K * h].reshape(n * K, h), np.repeat(fb, K, axis=0)).reshape(n, K)
    s = shares(me, op)
    return s.mean(axis=0), s.std(axis=0) / np.sqrt(n)


def _validate(spec, seed, t_end, n_mc, per_street_max):
    ev = get_evaluator(spec)
    ctx = F.get_ctx(spec)
    deck = np.array(ctx.deck, np.int64)
    K = k_max_for(spec)
    nbt = spec.total_board_dealt
    rng = np.random.default_rng(seed)
    streets = [0] + _streets(spec)
    out = []
    i = 0
    while time.time() < t_end and i < per_street_max * len(streets):
        nb = streets[i % len(streets)]
        cards = rng.permutation(deck)[:spec.hole_cards + nb].tolist()
        hole, board = cards[:spec.hole_cards], cards[spec.hole_cards:]
        eq, se = mc_truth(ev, deck, hole, board, K, nbt, n_mc, rng)
        out.append((nb, hole, board, eq.tolist(), se.tolist()))
        i += 1
    return out


def _worker(args):
    spec, seed, t_train, t_val, batch, n_mc, per_street_max, max_deals, pre_extra = args
    pre, post, deals, pre_deals = _train(spec, seed, t_train, batch, max_deals, pre_extra)
    val = _validate(spec, seed + 7919, t_val, n_mc, per_street_max)
    return pre, post, deals, pre_deals, val


# ---- shrinkage ------------------------------------------------------------------------
def _eb_n0(n, s, q, parent_mean):
    """Empirical-Bayes prior strength n0 = sigma^2 / tau^2 (one value for all k, so the
    shrunk estimates stay monotone in k). n, s, q per child; parent_mean per child."""
    ok = n >= 2
    if ok.sum() < 5:
        return 20.0
    nn = n[ok][:, None].astype(float)
    m = s[ok] / nn
    var = np.maximum(q[ok] / nn - m * m, 0) * nn / (nn - 1)        # within-bucket variance
    sigma2 = (var * (nn - 1)).sum(axis=0) / (nn - 1).sum(axis=0)   # pooled, per k
    dev2 = (m - parent_mean[ok]) ** 2
    w = nn / nn.sum(axis=0)
    tau2 = np.maximum((w * (dev2 - var / nn)).sum(axis=0), 1e-6)
    return float(np.clip(np.median(sigma2 / tau2), 1.0, 5000.0))


def _finalize(acc, prior, level_of, nlevels, name):
    """Hierarchical shrinkage, coarsest level first: the coarsest level shrinks toward a
    flat 1/(k+1) prior (n0 = 5); every finer bucket toward its parent's estimate with an
    empirical-Bayes n0 per level. Returns keys, (M,K) float32 values, counts, n0s."""
    keys, par, n, s, q = acc.arrays()
    lv = level_of(keys)
    out_k, out_v, out_n, n0s = [], [], [], {}
    pidx = pest = None
    for L in range(nlevels - 1, -1, -1):
        sel = lv == L
        kk = keys[sel]
        if not len(kk):
            continue
        if pidx is None:
            est = (s[sel] + 5.0 * prior[None, :]) / (n[sel][:, None] + 5.0)
        else:
            pm = pest[np.array([pidx[p] for p in par[sel].tolist()], np.int64)]
            n0 = n0s[f"{name}_L{L}"] = _eb_n0(n[sel], s[sel], q[sel], pm)
            est = (s[sel] + n0 * pm) / (n[sel][:, None] + n0)
        pidx = {k: i for i, k in enumerate(kk.tolist())}
        pest = est
        out_k.append(kk)
        out_v.append(est)
        out_n.append(n[sel])
    vals = np.minimum.accumulate(np.clip(np.concatenate(out_v), 0, 1), axis=1)
    return np.concatenate(out_k), vals.astype(np.float32), np.concatenate(out_n), n0s


# ---- driver ---------------------------------------------------------------------------
def build(spec, out_dir=DEFAULT_OUT, budget_s=180.0, workers=None, seed=0, n_mc=None,
          val_per_street=None, batch=None, verbose=True, max_deals=None, pre_extra=None):
    """Build and save the strength table for `spec`; returns the metadata dict."""
    from sng.ours import strength as S
    if spec.discards:
        raise ValueError("discard variants are not supported (the sit-and-go engine has none); "
                         "strength.py falls back to its heuristic for them")
    t0 = time.time()
    workers = workers or min(4, os.cpu_count() or 1)
    ctx = F.get_ctx(spec)
    K = k_max_for(spec)
    exact = spec.hole_usage == "exactly"
    batch = batch or (200 if exact or spec.hole_cards > 2 else 400)
    # many preflop classes (more than 2 hole cards): add cheap preflop-only deals
    pre_extra = (1 if spec.hole_cards > 2 else 0) if pre_extra is None else pre_extra
    # validation MC size: precise enough that its noise barely moves the MAE
    n_mc = n_mc or (800 if exact or spec.hole_cards > 2 else 3000)
    val_per_street = val_per_street or max(20, int(budget_s * (0.6 if exact else 3) / workers))
    t_train = t0 + budget_s * TRAIN_FRAC
    t_val = t0 + budget_s * (TRAIN_FRAC + VAL_FRAC)
    args = [(spec, seed * 1000 + w, t_train, t_val, batch, n_mc, val_per_street,
             None if max_deals is None else max(1, max_deals // workers), pre_extra)
            for w in range(workers)]
    if verbose:
        print(f"[build] {spec.name}: k_max={K} workers={workers} budget={budget_s:.0f}s "
              f"batch={batch} n_mc={n_mc}", flush=True)
    if workers == 1:
        results = [_worker(args[0])]
    else:
        mpc = mp.get_context("fork") if "fork" in mp.get_all_start_methods() else mp.get_context()
        with mpc.Pool(workers) as pool:
            results = pool.map(_worker, args)
    t_mc = time.time() - t0
    pre, post = Acc(K), Acc(K)
    deals = pre_deals = 0
    val = []
    for p_, q_, d_, pd_, v_ in results:
        pre.merge(p_)
        post.merge(q_)
        deals += d_
        pre_deals += pd_
        val += v_
    prior = np.array([1.0 / (k + 1) for k in range(1, K + 1)])
    pre_k, pre_v, pre_n, n0a = _finalize(pre, prior, lambda k: k >> F.PRE_LVL_SHIFT,
                                         F.PRE_NLEVELS, "pre")
    post_k, post_v, post_n, n0b = _finalize(post, prior, lambda k: k >> F._LVL_SHIFT,
                                            F.NLEVELS, "post")
    meta = dict(version=VERSION, name=spec.name, spec=repr(spec),
                signature=repr(F.card_signature(spec)), k_max=K, workers=workers,
                budget_s=budget_s, deals=int(deals), heroes=int(deals * (K + 1)),
                preflop_only_deals=int(pre_deals),
                pre_keys={f"L{i}": int(((pre_k >> F.PRE_LVL_SHIFT) == i).sum())
                          for i in range(F.PRE_NLEVELS)},
                post_keys={f"L{i}": int(((post_k >> F._LVL_SHIFT) == i).sum())
                           for i in range(F.NLEVELS)},
                streets=_streets(spec), n0={**n0a, **n0b}, mc_seconds=round(t_mc, 1))
    tab = S.Table(ctx, pre_k, pre_v, post_k, post_v, K, meta)
    meta["validation"] = _report(tab, val, K, n_mc)
    meta["build_seconds"] = round(time.time() - t0, 1)
    out = table_path(spec, out_dir)
    out.parent.mkdir(parents=True, exist_ok=True)
    tmp = out.with_name(out.name + ".tmp.npz")
    np.savez_compressed(tmp, pre_keys=pre_k, pre_vals=pre_v, pre_n=pre_n, post_keys=post_k,
                        post_vals=post_v, post_n=post_n, meta=np.array(json.dumps(meta)))
    os.replace(tmp, out)
    S.forget(spec)
    if verbose:
        print(f"[build] wrote {out} ({out.stat().st_size / 1e6:.1f} MB) in "
              f"{meta['build_seconds']}s: {deals} deals, {meta['heroes']} heroes", flush=True)
        print(format_report(meta), flush=True)
    return meta


def _report(tab, val, K, n_mc):
    """MAE of the table vs the validation MC, per street (board size) and k."""
    by = {}
    for nb, hole, board, eq, se in val:
        pred = [tab.equity(hole, board, k) for k in range(1, K + 1)]
        r = by.setdefault(nb, {k_: np.zeros(K) for k_ in ("abs", "se", "bias", "sq", "se2")})
        r["n"] = r.get("n", 0) + 1
        d = np.array(pred) - np.array(eq)
        r["abs"] += np.abs(d)
        r["bias"] += d
        r["sq"] += d * d
        r["se"] += np.array(se)
        r["se2"] += np.array(se) ** 2
    rep = {}
    for nb in sorted(by):
        r = by[nb]
        n = max(1, r["n"])
        rmse = np.sqrt(r["sq"] / n)
        # the validation MC is itself noisy: remove its variance from the squared error
        rmse_c = np.sqrt(np.maximum(r["sq"] - r["se2"], 0) / n)
        rep[str(nb)] = dict(n=r["n"], mae=np.round(r["abs"] / n, 4).tolist(),
                            bias=np.round(r["bias"] / n, 4).tolist(),
                            mc_se=np.round(r["se"] / n, 4).tolist(),
                            rmse=np.round(rmse, 4).tolist(),
                            rmse_noise_corrected=np.round(rmse_c, 4).tolist())
    rep["n_mc"] = n_mc
    return rep


def format_report(meta) -> str:
    v = meta.get("validation", {})
    lines = [f"MAE vs MC (n_mc={v.get('n_mc')}), k = 1..{meta['k_max']}:"]
    for nb, r in v.items():
        if nb == "n_mc":
            continue
        name = "preflop" if nb == "0" else f"board {nb}"
        lines.append(f"  {name:8s} (n={r['n']:4d}) mae " + " ".join(f"{x:.3f}" for x in r["mae"])
                     + "  | rmse-noise " + " ".join(f"{x:.3f}" for x in r["rmse_noise_corrected"])
                     + "  | mc se " + " ".join(f"{x:.3f}" for x in r["mc_se"]))
    return "\n".join(lines)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--variant", required=True, help="engine.variants name (or prefix)")
    ap.add_argument("--minutes", type=float, default=3.0)
    ap.add_argument("--workers", type=int, default=min(4, os.cpu_count() or 1))
    ap.add_argument("--out", default=str(DEFAULT_OUT))
    ap.add_argument("--seed", type=int, default=0)
    a = ap.parse_args(argv)
    from engine.variants import get_variant
    build(get_variant(a.variant), a.out, a.minutes * 60, a.workers, a.seed)
    return 0


if __name__ == "__main__":
    sys.exit(main())
