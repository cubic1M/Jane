"""Multi-process CFR iterations (train.py --workers N).

Why not shard the batch by deals: the walk's cost is mostly per tree NODE (Python + numpy
call overhead, ~50-90 us per decision node), not per deal, so N shards of B/N deals each
still visit nearly the whole tree and the speed-up stays below 1.5x.

Design (subtree parallel, exact):
  * The regret table R, strategy sums S and visit masses live in shared memory.
  * Each iteration the main process walks the top of the tree (streets < split_street:
    preflop and flop by default) WITHOUT updates and records, for every frontier node
    (first decision node on street >= split_street), the exact (r0, r1, sel) arguments
    the single-process walk would pass to it (CFRTrainer.collect).
  * The frontier subtrees are disjoint, so their infoset rows in R/S are disjoint: they are
    walked in parallel by the main process and N-1 helper processes, each writing its own
    rows directly into shared memory, and return the per-deal subtree values.
  * The main process walks the top again with those values and updates (CFRTrainer.finish),
    then applies the DCFR discount.
  Within an iteration the current strategy at a node only depends on R rows of that node,
  which nothing else touches before the node itself is updated, so this is EXACTLY the
  single-process iteration on the same batch (bit-identical; see the tests).
  * Load balance: frontier subtrees are assigned longest-first to the least loaded process
    (LPT), with each subtree's cost measured in the previous iteration.
  * Helpers also sample the fresh deals (the bucket computation) for the deal pool, after
    their walk, so sampling runs in parallel too. Each helper has its own seeded RNG stream,
    so a run with a fixed iteration count is deterministic for a given (seed, workers).
Processes use the "spawn" start method (safe on macOS as well as Linux).
"""
from __future__ import annotations

import multiprocessing as mp
import time
import traceback
from multiprocessing import shared_memory

import numpy as np

from .abstraction import CardAbstraction
from .tree import DECISION, Tree, TreeConfig


def _cfg_from_dict(d):
    from .policy import _cfg_from_dict as f
    return f(d)


def _attach(name, shape):
    try:
        shm = shared_memory.SharedMemory(name=name, track=False)
    except TypeError:  # Python < 3.13 has no track flag
        shm = shared_memory.SharedMemory(name=name)
    return shm, np.ndarray(shape, dtype=np.float64, buffer=shm.buf)


def _helper(conn, spec, tree_cfg, ab_state, K, dcfr, prune_frac, shm_spec, seed_seq):
    from .train import CFRTrainer
    shms = []
    try:
        tree = Tree(spec, _cfg_from_dict(tree_cfg))
        ab = CardAbstraction.from_state(spec, ab_state) if ab_state is not None else None
        arrays = []
        for name, shape in shm_spec:
            shm, arr = _attach(name, shape)
            shms.append(shm)
            arrays.append(arr)
        tr = CFRTrainer(tree, K, *dcfr, prune_frac=prune_frac, arrays=tuple(arrays))
        rng = np.random.default_rng(seed_seq)
        if ab is not None:
            ab.warm()
        conn.send(("ready", None))
        while True:
            msg = conn.recv()
            if msg is None:
                break
            bk, out, w, tasks, n_sample = msg
            tr.set_batch(bk, out, w)
            res = []
            for n, r0, r1, sel in tasks:
                t0 = time.perf_counter()
                v = tr._walk(n, r0, r1, sel)
                res.append((n, v, time.perf_counter() - t0))
            t0 = time.perf_counter()
            samp = ab.sample(n_sample, rng) if (n_sample and ab is not None) else None
            conn.send(("ok", (res, samp, time.perf_counter() - t0)))
    except Exception:
        try:
            conn.send(("error", traceback.format_exc()))
        except Exception:
            pass
    finally:
        for shm in shms:
            shm.close()


def default_split(tree: Tree) -> int:
    """Street at which subtrees are handed out: the turn (2) when the game has one (55
    subtrees of <= 5% of the tree each in hold'em), else the last street."""
    S = tree.spec.num_streets
    return min(2, S - 1) if S > 1 else 0


class ParallelCFR:
    """Owns the shared R/S/visits arrays, a main-process CFRTrainer on them, and N-1 helpers.

    iterate(bk, out, n_sample) runs one exact CFR iteration on the batch and returns
    (root value, freshly sampled deals or None)."""

    def __init__(self, spec, tree: Tree, ab: CardAbstraction, K, workers: int, seed: int = 0,
                 dcfr=(1.5, 0.0, 2.0), prune_frac=0.85, split_street=None, sample=True):
        from .policy import infoset_bases
        from .train import CFRTrainer
        self.workers = int(workers)
        if self.workers < 2:
            raise ValueError("ParallelCFR needs workers >= 2 (workers=1 is the plain CFRTrainer)")
        _, n_inf = infoset_bases(tree, list(K))
        A = tree.max_actions
        shapes = [(n_inf, A), (n_inf, A), (n_inf,)]
        self._shms, arrays = [], []
        for shape in shapes:
            nbytes = int(np.prod(shape)) * 8
            shm = shared_memory.SharedMemory(create=True, size=max(8, nbytes))
            arr = np.ndarray(shape, dtype=np.float64, buffer=shm.buf)
            arr[...] = 0.0
            self._shms.append(shm)
            arrays.append(arr)
        self.tr = CFRTrainer(tree, K, *dcfr, prune_frac=prune_frac, arrays=tuple(arrays))
        self.split = default_split(tree) if split_street is None else int(split_street)
        self.front = self.tr.frontier(self.split) if self.split > 0 else []
        sub = [0] * tree.n_nodes
        for n in range(tree.n_nodes - 1, -1, -1):
            sub[n] = (tree.kind[n] == DECISION) + sum(sub[c] for c in tree.children[n])
        self.cost = {n: 60e-6 * sub[n] for n in self.front}   # seconds; refined by measurement
        self.top_cost = 120e-6 * (len(tree.decision_nodes) - sum(sub[n] for n in self.front))
        self.samp_cost = 0.0
        self.stats = dict(top_s=0.0, wait_s=0.0, own_s=0.0, own_cpu_s=0.0)
        ctx = mp.get_context("spawn")
        seeds = np.random.SeedSequence([int(seed), 7919]).spawn(self.workers - 1)
        shm_spec = [(s.name, sh) for s, sh in zip(self._shms, shapes)]
        self.procs, self.conns = [], []
        try:
            for i in range(self.workers - 1):
                a, b = ctx.Pipe()
                p = ctx.Process(target=_helper, daemon=True,
                                args=(b, spec, tree.cfg.to_dict(), ab.state() if sample else None, list(K),
                                      tuple(dcfr), prune_frac, shm_spec, seeds[i]))
                p.start()
                self.procs.append(p)
                self.conns.append(a)
            for c in self.conns:
                self._recv(c)
        except Exception:
            self.close()
            raise

    # ---- plumbing ------------------------------------------------------------------------
    def _recv(self, c):
        kind, payload = c.recv()
        if kind == "error":
            raise RuntimeError("CFR helper process failed:\n" + payload)
        return payload

    def close(self):
        for c in getattr(self, "conns", []):
            try:
                c.send(None)
            except Exception:
                pass
        for p in getattr(self, "procs", []):
            p.join(timeout=5)
            if p.is_alive():
                p.terminate()
        for shm in getattr(self, "_shms", []):
            try:
                shm.close()
                shm.unlink()
            except Exception:
                pass
        self.procs, self.conns, self._shms = [], [], []

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()

    # ---- assignment -------------------------------------------------------------------------
    def _assign(self, tasks: dict, n_helpers_sampling: bool):
        """LPT: longest measured subtree first, to the currently least loaded process.
        Process 0 is this (main) process; it is pre-charged with the top-of-tree walks,
        helpers with their sampling share."""
        W = self.workers
        load = [2.0 * self.top_cost] + [self.samp_cost if n_helpers_sampling else 0.0] * (W - 1)
        out = [[] for _ in range(W)]
        for n in sorted(tasks, key=lambda n: -self.cost[n]):
            i = int(np.argmin(load))
            out[i].append(n)
            load[i] += self.cost[n]
        return out

    # ---- one iteration ----------------------------------------------------------------------
    def iterate(self, buckets, outcome, weights=None, n_sample: int = 0):
        tr = self.tr
        t0 = time.perf_counter()
        tr.begin(buckets, outcome, weights)
        tasks = tr.collect(self.front) if self.front else {}
        t1 = time.perf_counter()
        groups = self._assign(tasks, n_sample > 0)
        H = self.workers - 1
        shares = [n_sample // H + (1 if i < n_sample % H else 0) for i in range(H)]
        w = tr._w if weights is not None else None
        for i, c in enumerate(self.conns):
            c.send((buckets, outcome, w, [(n,) + tasks[n] for n in groups[i + 1]], shares[i]))
        vals = {}
        t2 = time.perf_counter()
        c2 = time.process_time()
        for n in groups[0]:
            a = time.perf_counter()
            vals[n] = tr._walk(n, *tasks[n])
            self.cost[n] = 0.5 * self.cost[n] + 0.5 * (time.perf_counter() - a)
        t3 = time.perf_counter()
        samples, st = [], []
        for c in self.conns:
            res, samp, ts = self._recv(c)
            for n, v, dt in res:
                vals[n] = v
                self.cost[n] = 0.5 * self.cost[n] + 0.5 * dt
            if samp is not None:
                samples.append(samp)
            st.append(ts)
        t4 = time.perf_counter()
        if self.front:
            v = tr.finish(vals)
        else:  # no frontier (one-street game): the main process walks the whole tree
            B = len(tr._w)
            v = float(np.dot(tr._walk(0, np.ones(B), np.ones(B), None), tr._w))
            tr._discount()
        t5 = time.perf_counter()
        if st:
            self.samp_cost = 0.5 * self.samp_cost + 0.5 * float(np.mean(st))
        self.top_cost = 0.5 * self.top_cost + 0.25 * ((t1 - t0) + (t5 - t4))
        self.stats["top_s"] += (t1 - t0) + (t5 - t4)
        self.stats["own_s"] += t3 - t2
        self.stats["own_cpu_s"] += time.process_time() - c2
        self.stats["wait_s"] += t4 - t3
        fresh = None
        if samples:
            fresh = (np.concatenate([s[0] for s in samples], axis=2), np.concatenate([s[1] for s in samples]))
        return v, fresh
