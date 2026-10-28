"""Full-game MCCFR trainer for the abstract game, plus CLI.

Algorithm: mini-batch chance-sampled CFR ("vectorised MCCFR"). Each iteration samples
a batch of B complete deals (both hands, the full board, both players' greedy
discards) and turns each into a bucket sequence per player and a showdown result.
It then makes one full-width pass over the public betting tree for all B deals at
once with numpy: reach probabilities, values and regrets are arrays over deals, and
regrets/average-strategy sums go to the infoset (node, bucket) with np.bincount.
For a fixed sampled batch this is exact vanilla CFR on the empirical chance
distribution, so it is an unbiased MCCFR (chance sampling with B samples).

Why not external/outcome sampling: those walk one deal at a time in pure Python
(~5 us per node visit). Here the Python cost is per tree node per batch and the
per-deal work is numpy. Deals whose reach is 0 for both players are dropped from a
subtree (exact pruning), so deep, rarely reached lines are cheap.

Weighting: Discounted CFR (Brown & Sandholm 2019) with alpha=1.5, beta=0, gamma=2:
after iteration t positive regrets are scaled by t^a/(t^a+1), negative ones by 1/2,
and the average strategy by (t/(t+1))^gamma. It converged fastest on the Kuhn test
with sampled batches (see tests); --linear switches to linear CFR (1, 1, 1).

Budget: the wall clock starts BEFORE the abstraction is fitted (preflop class
table + bucket boundaries), so a 60-minute policy used 60 minutes in total.
Checkpoints are written at the given minutes as cache/cfr/full_<variant>_<M>m.pkl.

    python3 -m bots.cfr_full.train --variant a_nlhe100 --minutes 60 \
        --checkpoints 15,30,60 --seed 0 --out cache/cfr/
"""
from __future__ import annotations

import argparse
import os
import sys
import time

import numpy as np

from engine.spec import GameSpec
from engine.variants import get_variant

from .abstraction import AbstractionConfig, CardAbstraction
from .policy import infoset_bases, make_policy_data, save_policy
from .tree import DECISION, FOLD_T, SHOW_T, Tree, TreeConfig


class CFRTrainer:
    """Vectorised CFR over the abstract tree. `K` = buckets per street."""

    def __init__(self, tree: Tree, K, alpha=1.5, beta=0.0, gamma=2.0, prune_frac=0.85):
        self.tree = tree
        self.K = list(K)
        self.alpha, self.beta, self.gamma = alpha, beta, gamma
        self.prune_frac = prune_frac
        self.base, self.n_infosets = infoset_bases(tree, self.K)
        A = tree.max_actions
        self.A = A
        self.R = np.zeros((self.n_infosets, A))
        self.S = np.zeros((self.n_infosets, A))
        self.visits = np.zeros(self.n_infosets)
        self.t = 0
        self.deals = 0
        # flat per-node data for the DFS
        self._kind = tree.kind
        self._player = tree.player
        self._street = tree.street
        self._children = tree.children
        self._u0 = tree.u0
        self._na = [len(a) for a in tree.actions]
        self._ar = {na: np.arange(na) for na in set(self._na) if na}

    # ---- strategies ---------------------------------------------------------------------
    def current_table(self, n):
        b, K, na = self.base[n], self.K[self._street[n]], self._na[n]
        pos = np.maximum(self.R[b:b + K, :na], 0.0)
        tot = pos.sum(axis=1, keepdims=True)
        return np.where(tot > 0, pos / np.where(tot > 0, tot, 1.0), 1.0 / na)

    def average_strategy(self) -> np.ndarray:
        out = np.zeros_like(self.S)
        for n in self.tree.decision_nodes:
            b, K, na = self.base[n], self.K[self._street[n]], self._na[n]
            s = self.S[b:b + K, :na]
            tot = s.sum(axis=1, keepdims=True)
            out[b:b + K, :na] = np.where(tot > 0, s / np.where(tot > 0, tot, 1.0), 1.0 / na)
        return out

    # ---- one iteration --------------------------------------------------------------------
    def iterate(self, buckets: np.ndarray, outcome: np.ndarray, weights=None) -> float:
        """One CFR iteration on a batch: buckets (S, 2, B), outcome (B,) in {-1,0,1}
        (+1 = position 0 wins). weights: optional chance probability per deal (default 1/B).
        Returns the batch's root value for position 0 under the current strategy."""
        B = buckets.shape[2]
        self._bk = [[buckets[s, p].astype(np.int64) for p in (0, 1)] for s in range(buckets.shape[0])]
        self._out = outcome.astype(np.float64)
        w = np.full(B, 1.0 / B) if weights is None else np.asarray(weights, dtype=np.float64)
        self._w = w
        self.t += 1
        self.deals += B
        v = self._walk(0, np.ones(B), np.ones(B), None)
        self._discount()
        return float(np.dot(v, w))

    def _walk(self, n, r0, r1, sel):
        """r0, r1 = players' own reach; returns position-0 utility per active deal."""
        k = self._kind[n]
        if k == FOLD_T:
            return np.full(len(r0), self._u0[n])
        if k == SHOW_T:
            o = self._out if sel is None else self._out[sel]
            return self._u0[n] * o
        p = self._player[n]
        s = self._street[n]
        bk = self._bk[s][p] if sel is None else self._bk[s][p][sel]
        na = self._na[n]
        sig = self.current_table(n)[bk]                      # (m, na)
        if p == 0:
            rp, ro = r0, r1
        else:
            rp, ro = r1, r0
        m = len(rp)
        va = np.empty((na, m))
        ro_pos = ro > 0
        kids = self._children[n]
        for a in range(na):
            rpa = rp * sig[:, a]
            act = (rpa > 0) | ro_pos
            cnt = int(np.count_nonzero(act))
            if cnt == 0:
                va[a] = 0.0
                continue
            if cnt >= self.prune_frac * m:
                res = self._walk(kids[a], rpa, ro, sel) if p == 0 else self._walk(kids[a], ro, rpa, sel)
                va[a] = res
            else:
                idx = np.flatnonzero(act)
                ss = idx if sel is None else sel[idx]
                if p == 0:
                    res = self._walk(kids[a], rpa[idx], ro[idx], ss)
                else:
                    res = self._walk(kids[a], ro[idx], rpa[idx], ss)
                row = va[a]
                row[:] = 0.0
                row[idx] = res
        v = np.einsum("ma,am->m", sig, va)
        cw = self._w if sel is None else self._w[sel]
        b = self.base[n]
        K = self.K[s]
        ar = self._ar[na]
        flat = (bk[:, None] * na + ar).ravel()
        # counterfactual regrets of the acting player (utility sign flips for position 1)
        roc = ro * cw
        reg = (va - v).T * (roc if p == 0 else -roc)[:, None]
        rpc = rp * cw
        self.R[b:b + K, :na] += np.bincount(flat, weights=reg.ravel(), minlength=K * na).reshape(K, na)
        self.S[b:b + K, :na] += np.bincount(flat, weights=(sig * rpc[:, None]).ravel(),
                                            minlength=K * na).reshape(K, na)
        self.visits[b:b + K] += np.bincount(bk, weights=rpc, minlength=K)
        return v

    def _discount(self):
        t = self.t
        a = t ** self.alpha
        pf = a / (a + 1.0)
        bb = t ** self.beta
        nf = bb / (bb + 1.0)
        R = self.R
        np.multiply(R, np.where(R > 0, pf, nf), out=R)
        self.S *= (t / (t + 1.0)) ** self.gamma

    def touched(self) -> int:
        return int(np.count_nonzero(self.visits > 0))


def default_batch(spec: GameSpec, tree: Tree) -> int:
    return 1024


class DealPool:
    """Ring buffer of sampled deals. Each iteration adds `fresh` new deals and draws its
    batch uniformly (without replacement) from the pool, so every batch is still an
    unbiased sample of chance while the expensive bucket computation is amortised over
    ~B/fresh uses per deal. Deals are retired oldest-first once the pool is full."""

    def __init__(self, ab, cap: int):
        self.ab = ab
        self.cap = cap
        self.bk = np.zeros((ab.S, 2, cap), dtype=np.int16)
        self.out = np.zeros(cap, dtype=np.int8)
        self.size = 0
        self.head = 0

    def add(self, n, rng):
        bk, out = self.ab.sample(n, rng)
        idx = (self.head + np.arange(n)) % self.cap
        self.bk[:, :, idx] = bk
        self.out[idx] = out
        self.head = (self.head + n) % self.cap
        self.size = min(self.cap, self.size + n)

    def draw(self, B, rng):
        if self.size <= B:
            idx = np.arange(self.size)
        else:
            idx = rng.choice(self.size, B, replace=False)
        return self.bk[:, :, idx], self.out[idx]


def train(spec: GameSpec, minutes: float, checkpoints=(), seed: int = 0, out_dir: str = "cache/cfr/",
          tree_cfg: TreeConfig = TreeConfig(), abs_cfg: AbstractionConfig = AbstractionConfig(),
          batch: int = 0, log_every: float = 20.0, linear: bool = False, log=print, tag: str = "full",
          fresh: float = 0.5, pool_batches: int = 32):
    t_start = time.perf_counter()
    rng = np.random.default_rng(seed)
    tree = Tree(spec, tree_cfg)
    ab = CardAbstraction(spec, abs_cfg)
    ab.fit(rng, log=log)
    params = dict(alpha=1.0, beta=1.0, gamma=1.0) if linear else {}
    tr = CFRTrainer(tree, ab.K, **params)
    B = batch or default_batch(spec, tree)
    n_fresh = max(1, int(round(fresh * B)))
    pool = DealPool(ab, max(B, pool_batches * B))
    pool.add(B, rng)
    t_fit = time.perf_counter() - t_start
    log(f"[train] {spec.name}: tree {tree.summary()} infosets {tr.n_infosets} batch {B} "
        f"fresh deals/iter {n_fresh} pool {pool.cap} setup {t_fit:.1f}s (counted in the budget)")
    cps = sorted(set(float(c) for c in checkpoints) | {float(minutes)})
    written = []
    t_sample = t_cfr = 0.0
    last_log = time.perf_counter()
    vals = []
    while cps:
        now = time.perf_counter()
        el = (now - t_start) / 60.0
        if el >= cps[0]:
            m = cps.pop(0)
            path = os.path.join(out_dir, f"{tag}_{spec.name}_{_fmt(m)}m.pkl")
            meta = dict(iterations=tr.t, deals=tr.deals, elapsed_s=round(now - t_start, 1), budget_min=m,
                        setup_s=round(t_fit, 1), sample_s=round(t_sample, 1), cfr_s=round(t_cfr, 1),
                        batch=B, fresh=n_fresh, seed=seed, infosets=tr.n_infosets, touched=tr.touched(),
                        dcfr=(tr.alpha, tr.beta, tr.gamma))
            save_policy(path, make_policy_data(spec, tree, ab, tr.average_strategy(), tr.visits, meta))
            log(f"[checkpoint] {path}  iters {tr.t} deals {tr.deals} elapsed {now - t_start:.0f}s")
            written.append(path)
            continue
        t0 = time.perf_counter()
        if tr.t > 0:
            pool.add(n_fresh, rng)
        bk, outc = pool.draw(B, rng)
        t1 = time.perf_counter()
        vals.append(tr.iterate(bk, outc))
        t2 = time.perf_counter()
        t_sample += t1 - t0
        t_cfr += t2 - t1
        if t2 - last_log >= log_every:
            last_log = t2
            run = t2 - t_start - t_fit
            log(f"[train] {spec.name} t={t2 - t_start:6.0f}s iters {tr.t} ({tr.t / run:.2f} it/s, "
                f"{tr.deals / run:.0f} batch deals/s; sampling {t_sample / run:.0%}) infosets touched "
                f"{tr.touched()}/{tr.n_infosets}  root value(p0) {np.mean(vals[-50:]) / spec.big_blind:+.3f} bb")
    return written, tr, ab, tree


def _fmt(m: float) -> str:
    return str(int(m)) if float(m).is_integer() else str(m)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--variant", required=True)
    ap.add_argument("--minutes", type=float, required=True)
    ap.add_argument("--checkpoints", default="")
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--out", default="cache/cfr/")
    ap.add_argument("--batch", type=int, default=0)
    ap.add_argument("--linear", action="store_true", help="linear CFR weights instead of DCFR(1.5,0,2)")
    ap.add_argument("--log-every", type=float, default=20.0)
    ap.add_argument("--fresh", type=float, default=0.5, help="fraction of each batch that is newly sampled")
    a = ap.parse_args(argv)
    spec = get_variant(a.variant)
    cps = [float(x) for x in a.checkpoints.split(",") if x.strip()]
    written, *_ = train(spec, a.minutes, cps, seed=a.seed, out_dir=a.out, batch=a.batch,
                        log_every=a.log_every, linear=a.linear, fresh=a.fresh,
                        log=lambda s: (print(s), sys.stdout.flush()))
    print("written:", " ".join(written))


if __name__ == "__main__":
    main()
