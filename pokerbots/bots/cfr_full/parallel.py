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
  * Fresh deals for the deal pool (the bucket computation) are sampled in chunks of
    CHUNK deals in the same parallel phase. Chunk c of iteration t uses its own RNG seeded
    by (seed, t, c), so the sampled deals do not depend on which process took the chunk:
    a run with a fixed iteration count gives the same policy for every workers >= 2.
  * Load balance: dynamic self-scheduling. All processes (main included) take the next work
    item from a shared counter: subtrees first, longest (measured last iteration) first,
    then the sampling chunks. A process that is slow or descheduled (busy machine) simply
    takes fewer items, instead of holding up a barrier.
Processes use the "spawn" start method (safe on macOS as well as Linux).
"""
from __future__ import annotations

import multiprocessing as mp
import time
import traceback
from multiprocessing import shared_memory

import numpy as np

from .abstraction import CardAbstraction
from .tree import DECISION, Tree

CHUNK = 64  # fresh deals per sampling work item


def _cfg_from_dict(d):
    from .policy import _cfg_from_dict as f
    return f(d)


def _attach(name, shape):
    try:
        shm = shared_memory.SharedMemory(name=name, track=False)
    except TypeError:  # Python < 3.13 has no track flag
        shm = shared_memory.SharedMemory(name=name)
    return shm, np.ndarray(shape, dtype=np.float64, buffer=shm.buf)


def _chunk_rng(seed: int, t: int, c: int):
    return np.random.default_rng([int(seed), 7919, int(t), int(c)])


def _work(tr, ab, counter, tasks, chunks, seed, t):
    """Take work items from the shared counter until none is left. Returns
    ({node: values}, {node: seconds}, {chunk: (buckets, outcome)})."""
    vals, secs, samples = {}, {}, {}
    nt = len(tasks)
    total = nt + len(chunks)
    while True:
        with counter.get_lock():
            i = counter.value
            counter.value = i + 1
        if i >= total:
            break
        if i < nt:
            n, r0, r1, sel = tasks[i]
            t0 = time.perf_counter()
            vals[n] = tr._walk(n, r0, r1, sel)
            secs[n] = time.perf_counter() - t0
        else:
            c, size = chunks[i - nt]
            samples[c] = ab.sample(size, _chunk_rng(seed, t, c))
    return vals, secs, samples


def _helper(conn, counter, spec, tree_cfg, ab_state, K, dcfr, prune_frac, shm_spec, seed):
    from .train import CFRTrainer
    shms = []
    try:
        tree = Tree(spec, _cfg_from_dict(tree_cfg))
        ab = CardAbstraction.from_state(spec, ab_state)
        arrays = []
        for name, shape in shm_spec:
            shm, arr = _attach(name, shape)
            shms.append(shm)
            arrays.append(arr)
        tr = CFRTrainer(tree, K, *dcfr, prune_frac=prune_frac, arrays=tuple(arrays))
        ab.warm()
        conn.send(("ready", None))
        while True:
            msg = conn.recv()
            if msg is None:
                break
            bk, out, w, tasks, chunks, t = msg
            if tasks:
                tr.set_batch(bk, out, w)
            conn.send(("ok", _work(tr, ab, counter, tasks, chunks, seed, t) + (time.process_time(),)))
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
    (root value, n_sample freshly sampled deals as (buckets, outcome), or None)."""

    def __init__(self, spec, tree: Tree, ab: CardAbstraction, K, workers: int, seed: int = 0,
                 dcfr=(1.5, 0.0, 2.0), prune_frac=0.85, split_street=None):
        from .policy import infoset_bases
        from .train import CFRTrainer
        self.workers = int(workers)
        if self.workers < 2:
            raise ValueError("ParallelCFR needs workers >= 2 (workers=1 is the plain CFRTrainer)")
        self.ab = ab
        self.seed = int(seed)
        _, n_inf = infoset_bases(tree, list(K))
        A = tree.max_actions
        shapes = [(n_inf, A), (n_inf, A), (n_inf,)]
        self._shms, arrays = [], []
        self.procs, self.conns = [], []
        for shape in shapes:
            shm = shared_memory.SharedMemory(create=True, size=max(8, int(np.prod(shape)) * 8))
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
        self.stats = dict(top_s=0.0, parallel_s=0.0, items_main=0, items_total=0)
        self.helper_cpu = [0.0] * (self.workers - 1)   # CPU seconds used by each helper so far
        ctx = mp.get_context("spawn")
        self.counter = ctx.Value("l", 0)
        shm_spec = [(s.name, sh) for s, sh in zip(self._shms, shapes)]
        try:
            for _ in range(self.workers - 1):
                a, b = ctx.Pipe()
                p = ctx.Process(target=_helper, daemon=True,
                                args=(b, self.counter, spec, tree.cfg.to_dict(), ab.state(), list(K),
                                      tuple(dcfr), prune_frac, shm_spec, self.seed))
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
        for c in self.conns:
            try:
                c.send(None)
            except Exception:
                pass
        for p in self.procs:
            p.join(timeout=5)
            if p.is_alive():
                p.terminate()
        for shm in self._shms:
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

    # ---- one iteration ----------------------------------------------------------------------
    def iterate(self, buckets, outcome, weights=None, n_sample: int = 0):
        tr = self.tr
        t0 = time.perf_counter()
        tr.begin(buckets, outcome, weights)
        t = tr.t
        tasks = tr.collect(self.front) if self.front else {}
        order = sorted(tasks, key=lambda n: -self.cost[n])
        tlist = [(n,) + tasks[n] for n in order]
        chunks = [(c, min(CHUNK, n_sample - c * CHUNK)) for c in range(-(-n_sample // CHUNK))]
        t1 = time.perf_counter()
        self.counter.value = 0          # helpers are idle between iterations
        w = tr._w if weights is not None else None
        for c in self.conns:
            c.send((buckets, outcome, w, tlist, chunks, t))
        vals, secs, samples = _work(tr, self.ab, self.counter, tlist, chunks, self.seed, t)
        self.stats["items_main"] += len(vals) + len(samples)
        for i, c in enumerate(self.conns):
            v2, s2, sm2, cpu = self._recv(c)
            self.helper_cpu[i] = cpu
            vals.update(v2)
            secs.update(s2)
            samples.update(sm2)
        t2 = time.perf_counter()
        for n, dt in secs.items():
            self.cost[n] = 0.5 * self.cost[n] + 0.5 * dt
        self.stats["items_total"] += len(tlist) + len(chunks)
        if self.front:
            v = tr.finish(vals)
        else:  # no frontier (one-street game): the main process walks the whole tree
            B = len(tr._w)
            v = float(np.dot(tr._walk(0, np.ones(B), np.ones(B), None), tr._w))
            tr._discount()
        t3 = time.perf_counter()
        self.stats["top_s"] += (t1 - t0) + (t3 - t2)
        self.stats["parallel_s"] += t2 - t1
        fresh = None
        if chunks:
            ks = sorted(samples)
            fresh = (np.concatenate([samples[k][0] for k in ks], axis=2),
                     np.concatenate([samples[k][1] for k in ks]))
        return v, fresh
