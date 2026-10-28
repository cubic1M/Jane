"""Exploitability estimate of a trained policy inside its abstract game.

    python3 -m bots.cfr_full.evaluate --policy cache/cfr/full_a_nlhe100_15m.pkl [--deals 50000]

Method (sampled best response, two independent deal sets):
  1. Sample deal set A (the policy's own abstraction: same buckets, same greedy discards).
     For each player i, freeze the opponent's AVERAGE strategy and compute a best
     response by backward induction over the betting tree, vectorised over all deals:
     at each of i's infosets (node, bucket) pick the action with the highest
     opponent-reach-weighted value summed over the deals in that infoset. This is the
     exact best response for the empirical deal distribution of A.
  2. Evaluate those fixed BR strategies on an independent deal set C, together with
     the value of the policy against itself.
Reported (mbb/hand = 1000 * chips / big blind):
  * held-out: gain_i = u_i(BR_i, sigma_-i) - u_i(sigma) on C, expl = (BR_0 + BR_1)/2.
    This is an unbiased estimate of what a particular valid abstract strategy wins,
    so in expectation it is a LOWER bound on the true abstract-game exploitability.
  * in-sample: the same numbers on A; biased UPWARDS (the BR overfits A's noise).
The truth lies (statistically) between the two; both fall as training converges.
Approximations: the BR uses the same imperfect-recall infosets as the policy
(node + current-street bucket) and backward induction ignores its own reach at
earlier streets, so it is a strong but not necessarily optimal imperfect-recall BR;
chance is sampled (standard errors are printed for the held-out numbers).
"""
from __future__ import annotations

import argparse
import time

import numpy as np

from engine.variants import VARIANTS

from .policy import Policy, load_policy_data
from .tree import DECISION, FOLD_T, SHOW_T


class BREvaluator:
    def __init__(self, tree, K, strategy):
        from .policy import infoset_bases
        self.tree = tree
        self.K = list(K)
        self.strat = np.asarray(strategy, dtype=np.float64)
        self.base, _ = infoset_bases(tree, self.K)
        self.na = [len(a) for a in tree.actions]

    def _set(self, buckets, outcome, weights=None):
        B = buckets.shape[2]
        self._bk = [[buckets[s, p].astype(np.int64) for p in (0, 1)] for s in range(buckets.shape[0])]
        self._out = outcome.astype(np.float64)
        self._w = np.full(B, 1.0 / B) if weights is None else np.asarray(weights, dtype=np.float64)
        return B

    # value of a profile where `br` (or nobody, br=-1) plays the pure `choice` table
    def best_response(self, br: int, buckets, outcome, weights=None, choice=None):
        """Returns (value for player br, per-deal values, choice dict). choice=None computes the
        BR on this set; otherwise the given pure strategy is evaluated."""
        B = self._set(buckets, outcome, weights)
        self._br = br
        self._fixed = choice
        self._choice = {} if choice is None else choice
        v = self._walk(0, np.ones(B), None)
        return float(np.dot(v, self._w)), v, self._choice

    def profile_value(self, buckets, outcome, weights=None):
        """Value (position 0 utility) of the policy against itself, and per-deal values."""
        B = self._set(buckets, outcome, weights)
        self._br = -1
        v = self._walk(0, np.ones(B), None)
        return float(np.dot(v, self._w)), v

    def _walk(self, n, r, sel):
        """r = reach of the non-BR side (both players when br = -1). Returns the BR
        player's utility per deal (position 0 utility when br = -1)."""
        tr = self.tree
        k = tr.kind[n]
        sgn = -1.0 if self._br == 1 else 1.0
        if k == FOLD_T:
            return np.full(len(r), sgn * tr.u0[n])
        if k == SHOW_T:
            o = self._out if sel is None else self._out[sel]
            return sgn * tr.u0[n] * o
        p = tr.player[n]
        s = tr.street[n]
        bk = self._bk[s][p] if sel is None else self._bk[s][p][sel]
        na = self.na[n]
        kids = tr.children[n]
        m = len(r)
        va = np.zeros((na, m))
        if p == self._br:
            for a in range(na):
                va[a] = self._walk(kids[a], r, sel)
            K = self.K[s]
            if self._fixed is None:
                cw = self._w if sel is None else self._w[sel]
                flat = (bk[:, None] * na + np.arange(na)).ravel()
                Q = np.bincount(flat, weights=(va.T * (r * cw)[:, None]).ravel(),
                                minlength=K * na).reshape(K, na)
                ch = np.argmax(Q, axis=1)
                self._choice[n] = ch
            else:
                ch = self._fixed.get(n)
                if ch is None:
                    ch = np.zeros(K, dtype=np.int64)
            return va[ch[bk], np.arange(m)]
        b = self.base[n]
        sig = self.strat[b + bk, :na]
        for a in range(na):
            ra = r * sig[:, a]
            act = ra > 0
            cnt = int(np.count_nonzero(act))
            if cnt == 0:
                continue
            if cnt == m:
                va[a] = self._walk(kids[a], ra, sel)
            else:
                idx = np.flatnonzero(act)
                ss = idx if sel is None else sel[idx]
                va[a, idx] = self._walk(kids[a], ra[idx], ss)
        return np.einsum("ma,am->m", sig, va)


def exploitability(tree, K, strategy, set_a, set_c, bb: float):
    """set_* = (buckets, outcome[, weights]). Returns a dict of mbb/hand numbers."""
    ev = BREvaluator(tree, K, strategy)
    scale = 1000.0 / bb
    out = {}
    u0_c, pv_c = ev.profile_value(*set_c)
    u0_a, _ = ev.profile_value(*set_a)
    for br in (0, 1):
        va, _, ch = ev.best_response(br, *set_a)
        vc, per_c, _ = ev.best_response(br, *set_c, choice=ch)
        own_a = u0_a if br == 0 else -u0_a
        own_c = u0_c if br == 0 else -u0_c
        diff = per_c - (pv_c if br == 0 else -pv_c)
        w = set_c[2] if len(set_c) > 2 and set_c[2] is not None else None
        se = (diff.std() / np.sqrt(len(diff))) if w is None else 0.0
        out[f"br{br}_in"] = va * scale
        out[f"br{br}_out"] = vc * scale
        out[f"gain{br}_in"] = (va - own_a) * scale
        out[f"gain{br}_out"] = (vc - own_c) * scale
        out[f"gain{br}_out_se"] = se * scale
    out["value0"] = u0_c * scale
    out["expl_in"] = (out["br0_in"] + out["br1_in"]) / 2
    out["expl_out"] = (out["br0_out"] + out["br1_out"]) / 2
    return out


def evaluate_policy(path: str, deals: int = 50000, seed: int = 12345, log=print) -> dict:
    data = load_policy_data(path)
    spec = VARIANTS.get(data["spec_name"])
    if spec is None:
        from .policy import _spec_from_repr
        spec = _spec_from_repr(data["spec_repr"])
    pol = Policy(spec, data)
    rng = np.random.default_rng(seed)
    t0 = time.perf_counter()

    def draw(n):
        bks, outs = [], []
        done = 0
        while done < n:
            b = min(4096, n - done)
            bk, o = pol.abs.sample(b, rng)
            bks.append(bk)
            outs.append(o)
            done += b
        return np.concatenate(bks, axis=2), np.concatenate(outs)

    set_a = draw(deals)
    set_c = draw(deals)
    t1 = time.perf_counter()
    res = exploitability(pol.tree, pol.abs.K, pol.strategy, set_a, set_c, spec.big_blind)
    t2 = time.perf_counter()
    res["deals"] = deals
    res["seconds"] = round(t2 - t0, 1)
    meta = pol.meta
    if log:
        log(f"policy {path}: {spec.name} iters {meta.get('iterations')} deals {meta.get('deals')} "
            f"budget {meta.get('budget_min')}m  (sampling {t1 - t0:.0f}s, BR {t2 - t1:.0f}s, {deals} deals x2)")
        log(f"  value of policy vs itself (pos0/SB): {res['value0']:+.1f} mbb/h")
        for br in (0, 1):
            log(f"  BR vs frozen {'BB' if br == 0 else 'SB'} (BR plays {'SB' if br == 0 else 'BB'}): "
                f"gain held-out {res[f'gain{br}_out']:+.1f} +- {res[f'gain{br}_out_se']:.1f}  "
                f"in-sample {res[f'gain{br}_in']:+.1f} mbb/h")
        log(f"  EXPLOITABILITY estimate: held-out (lower) {res['expl_out']:.1f} mbb/h, "
            f"in-sample (upper-biased) {res['expl_in']:.1f} mbb/h; "
            f"= {res['expl_out'] / 1000:.3f} .. {res['expl_in'] / 1000:.3f} bb/h")
    return res


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--policy", required=True, nargs="+")
    ap.add_argument("--deals", "--iters", type=int, default=50000, dest="deals",
                    help="deals per set (two independent sets are drawn)")
    ap.add_argument("--seed", type=int, default=12345)
    a = ap.parse_args(argv)
    for p in a.policy:
        evaluate_policy(p, a.deals, a.seed)


if __name__ == "__main__":
    main()
