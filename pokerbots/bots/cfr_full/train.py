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

Multi-core: --workers N (N = number of cores) runs every iteration across N processes:
the main process walks preflop+flop, the turn/river subtrees (disjoint infosets) are
walked in parallel and written straight into shared-memory regret tables, and the helper
processes also sample the fresh deals. For the same batch this is exactly the
single-process update (parallel.py). --suffix names the checkpoints
full_<variant>_<M>m_<suffix>.pkl, loaded with make_bot(budget="<M>m_<suffix>").

    python3 -m bots.cfr_full.train --variant a_nlhe100 --minutes 15 --checkpoints 5,10 \
        --workers 4 --suffix w4 --out cache/cfr/

Optional richer abstraction (defaults unchanged): --buckets 20,15,15,15,
--feature ehs2 (E[HS^2] buckets on flop/turn), --postflop-sizes '0.33,0.75,1.5;1.0'.
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

    def __init__(self, tree: Tree, K, alpha=1.5, beta=0.0, gamma=2.0, prune_frac=0.85, arrays=None):
        """arrays: optional preallocated (R, S, visits) zero arrays (e.g. views on shared
        memory, see parallel.py); by default they are allocated here."""
        self.tree = tree
        self.K = list(K)
        self.alpha, self.beta, self.gamma = alpha, beta, gamma
        self.prune_frac = prune_frac
        self.base, self.n_infosets = infoset_bases(tree, self.K)
        A = tree.max_actions
        self.A = A
        if arrays is None:
            arrays = (np.zeros((self.n_infosets, A)), np.zeros((self.n_infosets, A)), np.zeros(self.n_infosets))
        self.R, self.S, self.visits = arrays
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
        row_na = np.ones(self.n_infosets)
        for n in tree.decision_nodes:
            row_na[self.base[n]:self.base[n] + self.K[self._street[n]]] = self._na[n]
        self._inv_na = 1.0 / row_na
        self._sig = None

    # ---- strategies ---------------------------------------------------------------------
    def current_table(self, n):
        b, K, na = self.base[n], self.K[self._street[n]], self._na[n]
        pos = np.maximum(self.R[b:b + K, :na], 0.0)
        tot = pos.sum(axis=1, keepdims=True)
        return np.where(tot > 0, pos / np.where(tot > 0, tot, 1.0), 1.0 / na)

    def current_all(self) -> np.ndarray:
        """current_table for every infoset at once (row-wise the same arithmetic: unused
        action columns of R are 0, so the row sums are identical)."""
        pos = np.maximum(self.R, 0.0)
        tot = pos.sum(axis=1, keepdims=True)
        return np.where(tot > 0, pos / np.where(tot > 0, tot, 1.0), self._inv_na[:, None])

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
        B = self.begin(buckets, outcome, weights)
        v = self._walk(0, np.ones(B), np.ones(B), None)
        self._discount()
        return float(np.dot(v, self._w))

    def set_batch(self, buckets: np.ndarray, outcome: np.ndarray, weights=None) -> int:
        B = buckets.shape[2]
        self._bk = [[buckets[s, p].astype(np.int64) for p in (0, 1)] for s in range(buckets.shape[0])]
        self._out = outcome.astype(np.float64)
        self._w = np.full(B, 1.0 / B) if weights is None else np.asarray(weights, dtype=np.float64)
        # strategies of this iteration: a node's R rows change only after its own read
        self._sig = self.current_all()
        return B

    def begin(self, buckets, outcome, weights=None) -> int:
        """Start iteration t+1 on a batch (iterate() = begin + full walk + discount)."""
        B = self.set_batch(buckets, outcome, weights)
        self.t += 1
        self.deals += B
        return B

    # ---- split iteration (parallel.py): top of the tree here, frontier subtrees elsewhere --
    def frontier(self, split_street: int) -> list:
        """Decision nodes on street >= split_street whose parent is on an earlier street:
        roots of disjoint subtrees (disjoint infoset rows) that can be walked in parallel."""
        tr = self.tree
        return [n for n in tr.decision_nodes
                if tr.street[n] >= split_street and tr.parent[n] >= 0 and tr.street[tr.parent[n]] < split_street]

    def collect(self, front) -> dict:
        """Phase 1: walk the top of the tree without updates; returns {frontier node: (r0, r1,
        sel)}, the exact arguments the full walk would pass to each frontier subtree."""
        self._front, self._tasks, self._collecting = set(front), {}, True
        B = len(self._w)
        self._walk_top(0, np.ones(B), np.ones(B), None)
        return self._tasks

    def finish(self, values: dict) -> float:
        """Phase 2: frontier values in hand, walk the top again with updates, then discount.
        Together with the subtree walks this is exactly one iterate() on the same batch."""
        self._collecting, self._vals = False, values
        B = len(self._w)
        v = self._walk_top(0, np.ones(B), np.ones(B), None)
        self._vals = self._tasks = None
        self._discount()
        return float(np.dot(v, self._w))

    def _walk_top(self, n, r0, r1, sel):
        if n in self._front:
            if self._collecting:
                self._tasks[n] = (r0, r1, sel)
                return np.zeros(len(r0))
            return self._vals[n]
        k = self._kind[n]
        if k != DECISION:
            return self._walk(n, r0, r1, sel)
        return self._decision(n, r0, r1, sel, self._walk_top, not self._collecting)

    def _walk(self, n, r0, r1, sel):
        """r0, r1 = players' own reach; returns position-0 utility per active deal."""
        k = self._kind[n]
        if k == FOLD_T:
            return np.full(len(r0), self._u0[n])
        if k == SHOW_T:
            o = self._out if sel is None else self._out[sel]
            return self._u0[n] * o
        return self._decision(n, r0, r1, sel, self._walk, True)

    def _decision(self, n, r0, r1, sel, walk, update):
        p = self._player[n]
        s = self._street[n]
        bk = self._bk[s][p] if sel is None else self._bk[s][p][sel]
        na = self._na[n]
        sig = self._sig[self.base[n] + bk, :na]               # (m, na) current strategy
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
                res = walk(kids[a], rpa, ro, sel) if p == 0 else walk(kids[a], ro, rpa, sel)
                va[a] = res
            else:
                idx = np.flatnonzero(act)
                ss = idx if sel is None else sel[idx]
                if p == 0:
                    res = walk(kids[a], rpa[idx], ro[idx], ss)
                else:
                    res = walk(kids[a], ro[idx], rpa[idx], ss)
                row = va[a]
                row[:] = 0.0
                row[idx] = res
        v = np.einsum("ma,am->m", sig, va)
        if not update:
            return v
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
        self.add_arrays(*self.ab.sample(n, rng))

    def add_arrays(self, bk, out):
        n = len(out)
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
          fresh: float = 0.5, pool_batches: int = 32, workers: int = 1, suffix: str = "",
          max_iters: int = 0, split_street=None):
    """workers=1: the original single-process loop. workers=N>1: N processes walk disjoint
    subtrees of every iteration (exactly the same update for the same batch, see
    parallel.py) and N-1 of them sample the fresh deals. max_iters > 0 stops after that many
    iterations (writes the final checkpoint then; for tests/benchmarks). suffix is appended
    to checkpoint names: full_<variant>_<M>m_<suffix>.pkl (load with budget="<M>m_<suffix>")."""
    t_start = time.perf_counter()
    rng = np.random.default_rng(seed)
    tree = Tree(spec, tree_cfg)
    ab = CardAbstraction(spec, abs_cfg)
    ab.fit(rng, log=log)
    params = dict(alpha=1.0, beta=1.0, gamma=1.0) if linear else {}
    workers = max(1, int(workers))
    par = None
    if workers > 1:
        from .parallel import ParallelCFR
        dcfr = (1.0, 1.0, 1.0) if linear else (1.5, 0.0, 2.0)
        par = ParallelCFR(spec, tree, ab, ab.K, workers, seed=seed, dcfr=dcfr, split_street=split_street)
        tr = par.tr
    else:
        tr = CFRTrainer(tree, ab.K, **params)
    try:
        return _train_loop(spec, minutes, checkpoints, seed, out_dir, tree, ab, tr, par, rng, t_start,
                           batch, log_every, log, tag, fresh, pool_batches, workers, suffix, max_iters)
    finally:
        if par is not None:
            par.close()


def _train_loop(spec, minutes, checkpoints, seed, out_dir, tree, ab, tr, par, rng, t_start, batch,
                log_every, log, tag, fresh, pool_batches, workers, suffix, max_iters):
    B = batch or default_batch(spec, tree)
    n_fresh = max(1, int(round(fresh * B)))
    pool = DealPool(ab, max(B, pool_batches * B))
    pool.add(B, rng)
    t_fit = time.perf_counter() - t_start
    log(f"[train] {spec.name}: tree {tree.summary()} infosets {tr.n_infosets} batch {B} "
        f"fresh deals/iter {n_fresh} pool {pool.cap} workers {workers}"
        + (f" (split at street {par.split}, {len(par.front)} subtrees)" if par else "")
        + f" setup {t_fit:.1f}s (counted in the budget)")
    cps = sorted(set(float(c) for c in checkpoints) | {float(minutes)})
    written = []
    t_sample = t_cfr = 0.0
    fresh_deals = 0
    last_log = time.perf_counter()
    vals = []
    sfx = f"_{suffix}" if suffix else ""
    while cps:
        now = time.perf_counter()
        el = (now - t_start) / 60.0
        done = max_iters and tr.t >= max_iters
        if el >= cps[0] or done:
            m = cps.pop(0)
            if done:
                cps = []
            path = os.path.join(out_dir, f"{tag}_{spec.name}_{_fmt(m)}m{sfx}.pkl")
            run = max(1e-9, now - t_start - t_fit)
            meta = dict(iterations=tr.t, deals=tr.deals, elapsed_s=round(now - t_start, 1), budget_min=m,
                        setup_s=round(t_fit, 1), sample_s=round(t_sample, 1), cfr_s=round(t_cfr, 1),
                        batch=B, fresh=n_fresh, seed=seed, infosets=tr.n_infosets, touched=tr.touched(),
                        dcfr=(tr.alpha, tr.beta, tr.gamma), workers=workers,
                        iters_per_s=round(tr.t / run, 3), fresh_deals=fresh_deals,
                        fresh_deals_per_s=round(fresh_deals / run, 1))
            save_policy(path, make_policy_data(spec, tree, ab, tr.average_strategy(), tr.visits, meta))
            log(f"[checkpoint] {path}  iters {tr.t} deals {tr.deals} elapsed {now - t_start:.0f}s")
            written.append(path)
            continue
        t0 = time.perf_counter()
        if par is None:
            if tr.t > 0:
                pool.add(n_fresh, rng)
                fresh_deals += n_fresh
            bk, outc = pool.draw(B, rng)
            t1 = time.perf_counter()
            vals.append(tr.iterate(bk, outc))
            t2 = time.perf_counter()
            t_sample += t1 - t0
            t_cfr += t2 - t1
        else:
            bk, outc = pool.draw(B, rng)
            v, new = par.iterate(bk, outc, n_sample=n_fresh)
            t1 = time.perf_counter()
            if new is not None:
                pool.add_arrays(*new)
                fresh_deals += new[1].shape[0]
            t2 = time.perf_counter()
            vals.append(v)
            t_cfr += t1 - t0  # sampling runs inside the parallel step
            t_sample += t2 - t1
        if t2 - last_log >= log_every:
            last_log = t2
            run = t2 - t_start - t_fit
            extra = ""
            if par is not None:
                st = par.stats
                extra = (f"; per iter: serial top-of-tree {1e3 * st['top_s'] / tr.t:.0f} ms, parallel "
                         f"subtrees+sampling {1e3 * st['parallel_s'] / tr.t:.0f} ms, main took "
                         f"{st['items_main'] / max(1, st['items_total']):.0%} of the work items")
            log(f"[train] {spec.name} t={t2 - t_start:6.0f}s iters {tr.t} ({tr.t / run:.2f} it/s, "
                f"{tr.deals / run:.0f} batch deals/s, {fresh_deals / run:.0f} fresh deals/s; "
                f"sampling {t_sample / run:.0%}{extra}) infosets touched "
                f"{tr.touched()}/{tr.n_infosets}  root value(p0) {np.mean(vals[-50:]) / spec.big_blind:+.3f} bb")
    return written, tr, ab, tree


def _fmt(m: float) -> str:
    return str(int(m)) if float(m).is_integer() else str(m)


def _sizes(text: str):
    """'0.5,1.0;1.0' -> ((0.5, 1.0), (1.0,)): raise sizes per raise depth, depths split by ';'."""
    return tuple(tuple(float(x) for x in part.split(",") if x.strip()) for part in text.split(";"))


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
    ap.add_argument("--workers", type=int, default=1,
                    help="processes (1 = original single-process trainer; use the number of cores)")
    ap.add_argument("--suffix", default="", help="checkpoint name suffix: full_<variant>_<M>m_<suffix>.pkl")
    ap.add_argument("--max-iters", type=int, default=0, help="stop after this many iterations")
    # richer abstraction (defaults = the original abstraction)
    ap.add_argument("--buckets", default="", help="buckets per street, e.g. 20,15,15,15 (default 16,10,10,10)")
    ap.add_argument("--feature", default="ehs", choices=("ehs", "ehs2"),
                    help="postflop bucket feature: ehs = equity (default), ehs2 = E[HS^2] on streets "
                         "with cards to come (separates draws from made hands)")
    ap.add_argument("--postflop-sizes", default="",
                    help="postflop raise sizes as fractions of pot+call per raise depth, depths split "
                         "by ';' (default '0.5,1.0;1.0'), e.g. '0.33,0.75,1.5;1.0'")
    ap.add_argument("--preflop-sizes", default="", help="preflop sizes (default '0.75;1.0;0.6')")
    a = ap.parse_args(argv)
    spec = get_variant(a.variant)
    cps = [float(x) for x in a.checkpoints.split(",") if x.strip()]
    acfg = AbstractionConfig(feature=a.feature)
    if a.buckets:
        acfg = AbstractionConfig(buckets=tuple(int(x) for x in a.buckets.split(",")), feature=a.feature)
    tkw = {}
    if a.postflop_sizes:
        tkw["postflop"] = _sizes(a.postflop_sizes)
    if a.preflop_sizes:
        tkw["preflop"] = _sizes(a.preflop_sizes)
    written, *_ = train(spec, a.minutes, cps, seed=a.seed, out_dir=a.out, batch=a.batch,
                        log_every=a.log_every, linear=a.linear, fresh=a.fresh, workers=a.workers,
                        suffix=a.suffix, max_iters=a.max_iters, abs_cfg=acfg, tree_cfg=TreeConfig(**tkw),
                        log=lambda s: (print(s), sys.stdout.flush()))
    print("written:", " ".join(written))


if __name__ == "__main__":
    main()
