"""Train the preflop policy: equity matrix + full-width vectorised Discounted CFR.

    python3 -m bots.cfr_preflop.train --variant a_nlhe100 --minutes 30 \
        --checkpoints 5,15,30 --seed 0 --out cache/cfr/

writes cache/cfr/preflop_<variant>_<M>m.pkl at each checkpoint M (wall clock from the
start, INCLUDING the abstraction and matrix estimation).

Why full-width CFR and not MCCFR: the abstract preflop game has ~20-30 decision
nodes and K <= 169 buckets per player, and chance is a K x K matrix product at
each terminal, so one exact iteration over the whole tree costs a few ms. Sampling
(MCCFR) would only add variance; Discounted CFR (alpha=1.5, beta=0, gamma=2,
alternating updates) converges to well under 1 mbb/hand in seconds.

Schedule (accuracy grows with the budget, and checkpoint M of a long run is the
same computation as a standalone M-minute run):
  * setup: hand universe, classes, exact chance weights; for 3+ hole cards the class
    scores and buckets (score_frac of the FIRST checkpoint);
  * each checkpoint segment: mat_frac of it adds Monte Carlo samples to the equity
    matrix (samples accumulate across segments), then the rest runs DCFR on the
    refreshed matrix (regrets warm-started, average strategy restarted), then the
    exact exploitability is computed and the policy saved.
"""
from __future__ import annotations

import argparse
import os
import sys
import time
from dataclasses import dataclass, field

import numpy as np

from .abstraction import (Sampler, Universe, build_bucket_abstraction, build_class_abstraction,
                          exact_pair_weights)
from .evaluate import exploitability
from .game import PreflopGame, Tree, TreeConfig
from .policy import rules_spec, save_policy

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DEFAULT_OUT = os.path.join(ROOT, "cache", "cfr")


@dataclass
class TrainConfig:
    n_buckets: int = 50            # 3+ hole cards
    max_classes: int = 200         # use suit classes directly up to this many
    pool_size: int = 1200          # hands per board in pool mode (3+ hole cards)
    pair_batch: int = 20000        # deals per step in pair mode
    score_frac: float = 0.10       # share of the first checkpoint for class scores
    mat_frac: float = 0.85         # share of each checkpoint segment for the matrix
    universe_cap: int = 400_000
    alpha: float = 1.5
    beta: float = 0.0
    gamma: float = 2.0
    tree: TreeConfig = field(default_factory=TreeConfig)


# --------------------------------------------------------------------------------------
# Discounted CFR, vectorised over buckets
# --------------------------------------------------------------------------------------
class DCFR:
    def __init__(self, game: PreflopGame, alpha=1.5, beta=0.0, gamma=2.0):
        self.game = game
        self.alpha, self.beta, self.gamma = alpha, beta, gamma
        K = game.K
        dec = game.tree.decision_nodes
        self.reg = {n.id: np.zeros((K, n.num_actions)) for n in dec}
        self.ssum = {n.id: np.zeros((K, n.num_actions)) for n in dec}
        self.t = 0

    def reset_average(self):
        for v in self.ssum.values():
            v[:] = 0.0

    def current(self, nid) -> np.ndarray:
        r = np.maximum(self.reg[nid], 0.0)
        s = r.sum(1, keepdims=True)
        return np.where(s > 0, r / np.where(s > 0, s, 1.0), 1.0 / r.shape[1])

    def average(self) -> dict:
        out = {}
        for nid, s in self.ssum.items():
            tot = s.sum(1, keepdims=True)
            out[nid] = np.where(tot > 0, s / np.where(tot > 0, tot, 1.0), 1.0 / s.shape[1])
        return out

    def iterate(self) -> None:
        self.t += 1
        t = self.t
        K = self.game.K
        for p in (0, 1):
            w = ((t - 1) / t) ** self.gamma
            for nid, n in self._own_nodes(p):
                self.ssum[nid] *= w
            self._cfr(self.game.tree.root, p, np.ones(K), np.ones(K))
            pos = t ** self.alpha / (t ** self.alpha + 1)
            neg = t ** self.beta / (t ** self.beta + 1)
            for nid, n in self._own_nodes(p):
                r = self.reg[nid]
                r *= np.where(r > 0, pos, neg)

    def _own_nodes(self, p):
        return [(n.id, n) for n in self.game.tree.decision_nodes if n.player == p]

    def _cfr(self, nid, p, r_own, r_opp):
        node = self.game.tree.nodes[nid]
        if node.is_terminal:
            return self.game.terminal_value(node, p, r_opp)
        sig = self.current(nid)
        if node.player == p:
            vals = np.empty_like(sig)
            for a, c in enumerate(node.children):
                vals[:, a] = self._cfr(c, p, r_own * sig[:, a], r_opp)
            v = np.einsum("ka,ka->k", sig, vals)
            self.reg[nid] += vals - v[:, None]
            self.ssum[nid] += r_own[:, None] * sig
            return v
        v = np.zeros(self.game.K)
        for a, c in enumerate(node.children):
            ra = r_opp * sig[:, a]
            if ra.any():
                v += self._cfr(c, p, r_own, ra)
            else:
                # the opponent never goes here: counterfactual values are 0 so regrets
                # do not change, but p's own nodes below must still enter the average
                # (their reach under p's strategy is not 0)
                self._accumulate(c, p, r_own)
        return v

    def _accumulate(self, nid, p, r_own):
        node = self.game.tree.nodes[nid]
        if node.is_terminal or not r_own.any():
            return
        sig = self.current(nid)
        if node.player == p:
            self.ssum[nid] += r_own[:, None] * sig
            for a, c in enumerate(node.children):
                self._accumulate(c, p, r_own * sig[:, a])
        else:
            for c in node.children:
                self._accumulate(c, p, r_own)


# --------------------------------------------------------------------------------------
# Training run
# --------------------------------------------------------------------------------------
def _label(minutes: float) -> str:
    return f"{int(minutes)}m" if float(minutes).is_integer() else f"{minutes:g}m"


def policy_path(out_dir: str, spec_name: str, minutes) -> str:
    lab = minutes if isinstance(minutes, str) else _label(minutes)
    return os.path.join(out_dir, f"preflop_{spec_name}_{lab}.pkl")


def build_abstraction(spec, cfg: TrainConfig, seconds: float, rng, seed: int = 0):
    """(universe, abstraction, label per universe combo, exact W or None)."""
    u = Universe(spec, cfg.universe_cap, seed)
    if u.C <= cfg.max_classes:
        ab = build_class_abstraction(spec, u)
        labels = u.cls
        W = exact_pair_weights(u, labels, ab.K) if u.enumerated else None
    else:
        ab = build_bucket_abstraction(spec, u, cfg.n_buckets, seconds, rng, cfg.pool_size)
        lut = np.array([ab.key_to_bucket[int(k)] for k in u.class_keys], dtype=np.int64)
        labels = lut[u.cls]
        W = None
    return u, ab, labels, W


def train(spec, minutes: float, checkpoints=None, seed: int = 0, out_dir: str = DEFAULT_OUT,
          cfg: TrainConfig = None, log=None) -> list:
    """Returns the list of written policy paths."""
    cfg = cfg or TrainConfig()
    log = log or (lambda s: print(s, flush=True))
    checkpoints = sorted(float(c) for c in (checkpoints or [minutes]))
    t0 = time.perf_counter()

    def el():
        return time.perf_counter() - t0

    rng = np.random.default_rng(seed)
    tree = Tree(rules_spec(spec), cfg.tree)
    log(f"[{spec.name}] tree: {tree.describe()}")
    u, ab, labels, W_exact = build_abstraction(spec, cfg, cfg.score_frac * checkpoints[0] * 60, rng, seed)
    setup_s = el()
    log(f"[{spec.name}] abstraction: {ab.kind} K={ab.K} from {len(u.combos)} combos / {u.C} classes "
        f"({setup_s:.1f}s{', ' + str({k: v for k, v in ab.info.items() if k != 'bucket_mean_equity'}) if ab.info else ''})")
    sampler = Sampler(spec, u, labels, ab.K, per_hand=False, pool_size=cfg.pool_size,
                      pair_batch=cfg.pair_batch, rng=rng)
    solver = None
    hist, written = [], []
    cfr_seconds = 0.0
    for ck in checkpoints:
        seg = ck * 60 - el()
        sampler.run(max(0.2, cfg.mat_frac * seg))
        E, cnt, se = sampler.matrix()
        if W_exact is not None:
            W = W_exact
        elif sampler.mode == "pool":
            W = cnt / cnt.sum()
        else:
            W = np.outer(ab.freq, ab.freq)
        game = PreflopGame(tree, W, E, cfg.tree)
        log(f"[{spec.name}] {el():6.1f}s matrix: {sampler.seconds:.1f}s total, {sampler.samples} "
            f"{'boards' if sampler.mode == 'pool' else 'deals'}, stderr {se:.4f}")
        if solver is None:
            solver = DCFR(game, cfg.alpha, cfg.beta, cfg.gamma)
        else:
            solver.game = game
            solver.reset_average()
        t_seg = time.perf_counter()
        it0 = solver.t
        it_cost = 0.0
        next_log = 1
        last_log_t = time.perf_counter()
        while True:
            reserve = 2.5 * it_cost + 0.3
            if el() >= ck * 60 - reserve and solver.t > it0:
                break
            ti = time.perf_counter()
            solver.iterate()
            it_cost = 0.8 * it_cost + 0.2 * (time.perf_counter() - ti) if it_cost else time.perf_counter() - ti
            k = solver.t - it0
            if k >= next_log or time.perf_counter() - last_log_t > 30:
                ex = exploitability(game, solver.average())
                hist.append((round(el(), 2), solver.t, ex["mbb"]))
                log(f"[{spec.name}] {el():6.1f}s iter {solver.t:6d}  exploitability {ex['mbb']:9.3f} mbb/hand")
                next_log = max(next_log * 2, k + 1)
                last_log_t = time.perf_counter()
        seg_cfr = time.perf_counter() - t_seg
        cfr_seconds += seg_cfr
        avg = solver.average()
        ex = exploitability(game, avg)
        hist.append((round(el(), 2), solver.t, ex["mbb"]))
        meta = dict(budget=_label(ck), seed=seed, elapsed_s=el(), setup_seconds=setup_s,
                    iterations=solver.t, segment_iterations=solver.t - it0,
                    cfr_seconds=cfr_seconds,
                    iters_per_s=(solver.t - it0) / max(seg_cfr, 1e-9),
                    matrix_seconds=sampler.seconds, matrix_samples=sampler.samples,
                    matrix_mode=sampler.mode, matrix_stderr=se,
                    exploitability_mbb=ex["mbb"], exploitability_log=list(hist),
                    abstraction_info=ab.info, train_config=repr(cfg))
        path = policy_path(out_dir, spec.name, ck)
        save_policy(path, spec=spec, tree=tree, abstraction=ab, strategy=avg, W=W, E=E, meta=meta)
        written.append(path)
        log(f"[{spec.name}] {el():6.1f}s checkpoint {_label(ck)}: {solver.t} iterations "
            f"({meta['iters_per_s']:.0f}/s), exploitability {ex['mbb']:.3f} mbb/hand "
            f"(SB value {ex['value_sb'] / spec.big_blind:+.4f} bb) -> {path}")
    return written


def main(argv=None):
    from engine.variants import get_variant
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--variant", required=True)
    ap.add_argument("--minutes", type=float, required=True)
    ap.add_argument("--checkpoints", default="", help="comma-separated minutes (default: --minutes)")
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--out", default=DEFAULT_OUT)
    ap.add_argument("--buckets", type=int, default=None, help="buckets for 3+ hole cards")
    ap.add_argument("--mat-frac", type=float, default=None)
    a = ap.parse_args(argv)
    spec = get_variant(a.variant)
    cks = [float(x) for x in a.checkpoints.split(",") if x.strip()] or [a.minutes]
    cks = [c for c in cks if c <= a.minutes + 1e-9]
    cfg = TrainConfig()
    if a.buckets:
        cfg.n_buckets = a.buckets
    if a.mat_frac is not None:
        cfg.mat_frac = a.mat_frac
    train(spec, a.minutes, cks, seed=a.seed, out_dir=a.out, cfg=cfg)


if __name__ == "__main__":
    sys.exit(main())
