"""Full-game abstracted CFR bot (approach #5).

make_bot(budget="15m", policy_path=None) loads cache/cfr/full_<spec.name>_<budget>.pkl
in new_match. Without a policy it plays a simple equity rule, sets
self.using_fallback = True and prints one warning to stderr.

Per decision:
  * discard phase: greedy equity discard via EquityModel.discard_options (same rule
    the trainer simulates), n sized from EquityModel.ms_per_sample();
  * betting: replay the observed history through the abstract tree, translating the
    opponent's off-tree raise sizes with the randomized pseudo-harmonic mapping
    (Ganzfried & Sandholm) between the two nearest abstract sizes (all-ins map to the
    all-in action); our own past actions map to the abstract action we chose. If the
    tree cannot follow (e.g. more raises than the cap, or a line that ended in the
    abstraction but continues for real), re-sync to the nearest abstract node with the
    same street, player and facing-a-bet flag, by pot size, stack depth and raise count;
  * bucket the hand with the policy's own abstraction (same boundaries, same sample
    count), sample an action from the average strategy (actions below `threshold`
    probability are dropped, a light purification), and convert it to a real action
    using the REAL pot: raise_to = max_pip + f * (pot + call) with f the abstract
    node's effective size, clamped into [min_raise_to, max_raise_to].
"""
from __future__ import annotations

import math
import os
import sys

import numpy as np

from engine.bot import Bot
from engine.equity import get_equity_model
from engine.game import Call, Check, Discard, Fold, RaiseTo

from bots.cfr_full.policy import load_policy
from bots.cfr_full.tree import A_CALL, A_CHECK, A_FOLD, A_RAISE, DECISION, BetState, map_raise

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_DIR = os.path.join(ROOT, "cache", "cfr")
_POLICY_CACHE: dict = {}
_WARNED: set = set()
_KIND = {"fold": A_FOLD, "check": A_CHECK, "call": A_CALL, "raise": A_RAISE}


def policy_path_for(spec_name: str, budget: str, cache_dir: str = DEFAULT_DIR) -> str:
    return os.path.join(cache_dir, f"full_{spec_name}_{budget}.pkl")


def _load_cached(path, spec):
    key = (os.path.abspath(path), os.path.getmtime(path), repr(spec))
    pol = _POLICY_CACHE.get(key)
    if pol is None:
        pol = load_policy(path, spec)
        _POLICY_CACHE.clear() if len(_POLICY_CACHE) > 8 else None
        _POLICY_CACHE[key] = pol
    return pol


class FullCFRBot(Bot):
    name = "full_cfr"

    def __init__(self, budget="15m", policy_path=None, threshold=0.05, cache_dir=None, verbose=True):
        self.budget = str(budget)
        self.policy_path = policy_path
        self.threshold = float(threshold)
        self.cache_dir = cache_dir or DEFAULT_DIR
        self.verbose = verbose
        self.using_fallback = True
        self.policy = None
        self.stats = dict(decisions=0, resyncs=0, offtree_maps=0)

    # ---- lifecycle ----------------------------------------------------------------------
    def new_match(self, spec, seed=0):
        super().new_match(spec, seed)
        self.np_rng = np.random.default_rng(seed)
        self.eqm = get_equity_model(spec)
        path = self.policy_path or policy_path_for(spec.name, self.budget, self.cache_dir)
        self.policy = None
        self.using_fallback = True
        try:
            self.policy = _load_cached(path, spec)
            self.using_fallback = False
        except Exception as e:  # missing or mismatched policy: equity fallback, never crash
            if self.verbose and path not in _WARNED:
                _WARNED.add(path)
                print(f"[full_cfr] WARNING: no usable policy at {path} ({type(e).__name__}: {e}); "
                      f"using the equity fallback", file=sys.stderr)
        if self.policy is not None:
            tr = self.policy.tree
            self._cands = {}
            for n in tr.decision_nodes:
                key = (tr.player[n], tr.street[n], tr.facing[n])
                self._cands.setdefault(key, []).append(n)
            for key, ns in self._cands.items():
                p = key[0]
                self._cands[key] = (
                    np.array(ns),
                    np.log(np.array([tr.pot[n] for n in ns], dtype=float)),
                    np.log1p(np.array([min(tr.stacks[n]) for n in ns], dtype=float)),
                    np.array([tr.depth[n] for n in ns], dtype=float),
                    np.array([any(a[0] == A_RAISE for a in tr.actions[n]) for n in ns]))
        ms = self.eqm.ms_per_sample()
        self._disc_n = int(np.clip(10.0 / max(ms, 1e-4) / 4, 40, 400))
        self._eq_n = int(np.clip(4.0 / max(ms, 1e-4), 40, 300))
        self._hand = None

    # ---- acting -------------------------------------------------------------------------
    def act(self, obs):
        lg = obs.legal
        if obs.phase == "discard" or lg.discard_count:
            opts = self.eqm.discard_options(obs, n=self._disc_n, rng=self.np_rng)
            return Discard(opts[0][0])
        try:
            a = self._fallback(obs) if self.using_fallback else self._policy_action(obs)
        except Exception as e:  # never return garbage: degrade to the equity rule
            if self.verbose:
                print(f"[full_cfr] error {type(e).__name__}: {e}; equity rule for this decision",
                      file=sys.stderr)
            a = self._fallback(obs)
        if not lg.is_legal(a):
            a = lg.passive()
        return a

    def _fallback(self, obs):
        lg = obs.legal
        eq = self.eqm.equity_obs(obs, n=self._eq_n, rng=self.np_rng)
        call = lg.call_amount
        pot = obs.pot
        if lg.can_raise and eq > (0.8 if call else 0.65):
            to = max(obs.my_pip, obs.opp_pip) + 0.75 * (pot + call)
            return RaiseTo(lg.clamp_raise(to))
        if call == 0:
            return Check()
        return Call() if eq > call / (pot + call) + 0.05 else Fold()

    # ---- tracking ---------------------------------------------------------------------
    def _new_hand(self, obs):
        p = obs.position
        st = [0, 0]
        st[p] = obs.my_stack + obs.my_committed
        st[1 - p] = obs.opp_stack + obs.opp_committed
        self._hand = obs.hand_index
        self._state = BetState(self.spec, stacks=st)
        self._node = 0
        self._done = 0
        self._mine = None  # (node, action index) of our last decision
        self._buckets = {}

    def _advance(self, obs):
        tr = self.policy.tree
        st = self._state
        hist = obs.history
        for rec in hist[self._done:]:
            if rec.kind == "discard":
                continue
            st.resolve()
            k = _KIND[rec.kind]
            n = self._node
            if n is not None and (tr.kind[n] != DECISION or tr.player[n] != rec.position
                                  or tr.street[n] != st.street):
                n = None
            idx = None
            if n is not None:
                acts = tr.actions[n]
                if rec.position == obs.position and self._mine and self._mine[0] == n:
                    idx = self._mine[1]
                    if acts[idx][0] != k:
                        idx = None
                if idx is None:
                    idx = self._translate(n, st, rec, k)
                if idx is not None and acts[idx][0] != k:
                    idx = None
            self._node = tr.children[n][idx] if (n is not None and idx is not None) else None
            st.apply(k, rec.amount)
        self._done = len(hist)
        st.resolve()

    def _translate(self, n, st, rec, k):
        tr = self.policy.tree
        acts = tr.actions[n]
        if k != A_RAISE:
            for i, a in enumerate(acts):
                if a[0] == k:
                    return i
            return None
        call, _, _, hi = st.legal()
        mp = max(st.pips)
        x = (rec.amount - mp) / max(1, st.pot + call)
        fr = tr.raise_fracs(n, st)
        i = map_raise(fr, x, rec.amount >= hi, self.rng.random())
        if i is not None:
            fx = [f for j, f, _ in fr if j == i][0]
            if abs(fx - x) > 0.05 * max(1.0, x):
                self.stats["offtree_maps"] += 1
        return i

    def _resync(self, obs):
        self.stats["resyncs"] += 1
        lg = obs.legal
        key = (obs.position, obs.street, lg.call_amount > 0)
        c = self._cands.get(key)
        if c is None:
            return None
        ids, lp, ls, dp, can_r = c
        eff = min(obs.my_stack, obs.opp_stack)
        d = (np.abs(lp - math.log(max(1, obs.pot))) + 0.5 * np.abs(ls - math.log1p(eff))
             + 0.3 * np.abs(dp - self._state.depth) + 2.0 * (can_r != lg.can_raise))
        return int(ids[int(np.argmin(d))])

    def _policy_action(self, obs):
        if obs.hand_index != self._hand:
            self._new_hand(obs)
        self._advance(obs)
        tr = self.policy.tree
        lg = obs.legal
        n = self._node
        if (n is None or tr.kind[n] != DECISION or tr.player[n] != obs.position
                or tr.street[n] != obs.street or tr.facing[n] != (lg.call_amount > 0)):
            n = self._resync(obs)
            if n is None:
                return self._fallback(obs)
            self._node = n
        self.stats["decisions"] += 1
        b = self._buckets.get(obs.street)
        if b is None:
            b = self._buckets[obs.street] = self.policy.abs.obs_bucket(obs, self.np_rng)
        p = self.policy.probs(n, b)
        if self.threshold > 0:
            q = np.where(p >= self.threshold, p, 0.0)
            p = q / q.sum() if q.sum() > 0 else p
        u = self.rng.random()
        i = int(np.searchsorted(np.cumsum(p), u * p.sum(), side="right"))
        i = min(i, len(p) - 1)
        while p[i] <= 0:  # guard against rounding at the end of the cdf
            i -= 1
        self._mine = (n, i)
        return self._to_real(n, i, obs)

    def _to_real(self, n, i, obs):
        tr = self.policy.tree
        lg = obs.legal
        kind, amt, f = tr.actions[n][i]
        if kind == A_FOLD:
            return Check() if lg.can_check else Fold()
        if kind in (A_CHECK, A_CALL) or not lg.can_raise:
            return lg.passive()
        if f < 0:
            return RaiseTo(lg.max_raise_to)
        pips = tr.pips[n]
        p = tr.player[n]
        base = tr.pot[n] + (max(pips) - pips[p])
        x = (amt - max(pips)) / base
        to = max(obs.my_pip, obs.opp_pip) + x * (obs.pot + lg.call_amount)
        return RaiseTo(lg.clamp_raise(to))


def make_bot(**kwargs):
    return FullCFRBot(**kwargs)
