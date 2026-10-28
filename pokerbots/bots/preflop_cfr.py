"""Approach #4: preflop CFR + balanced postflop (registry name "preflop_cfr").

make_bot(budget="15m", policy_path=None) loads cache/cfr/preflop_<spec.name>_<budget>.pkl
(trained by `python3 -m bots.cfr_preflop.train`) in new_match. Preflop: track the
abstract node from obs.history and sample the CFR average strategy with self.rng
(bots/cfr_preflop/policy.py). Every street after the flop, and discards:
BalancedBot, unchanged (it infers the opponent's preflop range from the betting
history, so it works after any preflop line).

If the policy file is missing, unreadable or was trained for different rules, the
bot plays BalancedBot's preflop, sets self.using_fallback = True and prints one
warning to stderr. If a hand leaves the abstract tree (e.g. more raises than the
abstraction allows), that hand's remaining preflop decisions use BalancedBot too.
"""
from __future__ import annotations

import os
import sys

from bots.balanced import BalancedBot
from bots.cfr_preflop.policy import load_policy

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_DIR = os.path.join(ROOT, "cache", "cfr")

_CACHE: dict = {}      # path -> (mtime, policy)
_WARNED: set = set()


def policy_path_for(spec_name: str, budget: str, cache_dir: str = DEFAULT_DIR) -> str:
    return os.path.join(cache_dir, f"preflop_{spec_name}_{budget}.pkl")


def _load_cached(path):
    mt = os.path.getmtime(path)
    hit = _CACHE.get(path)
    if hit is None or hit[0] != mt:
        hit = _CACHE[path] = (mt, load_policy(path))
    return hit[1]


def _warn_once(msg: str) -> None:
    if msg not in _WARNED:
        _WARNED.add(msg)
        print(msg, file=sys.stderr)


class PreflopCFRBot(BalancedBot):
    name = "preflop_cfr"

    def __init__(self, budget: str = "15m", policy_path: str | None = None,
                 cache_dir: str | None = None, params: dict | None = None):
        super().__init__(params)
        self.budget = budget
        self.policy_path = policy_path
        self.cache_dir = cache_dir or DEFAULT_DIR
        self.policy = None
        self.using_fallback = True
        self.off_tree = 0          # preflop decisions that left the tree (played by balanced)
        self.cfr_decisions = 0

    def new_match(self, spec, seed=0):
        super().new_match(spec, seed)
        path = self.policy_path or policy_path_for(spec.name, self.budget, self.cache_dir)
        self.policy, self.using_fallback = None, True
        reason = None
        try:
            if not os.path.exists(path):
                reason = "missing"
            else:
                pol = _load_cached(path)
                if pol.matches(spec):
                    self.policy, self.using_fallback = pol, False
                else:
                    reason = "trained for different rules"
        except Exception as e:  # unreadable or incompatible file
            reason = f"unreadable ({type(e).__name__}: {e})"
        if reason:
            _warn_once(f"[preflop_cfr] policy {path} {reason}; using BalancedBot's preflop")
        self._hand = None
        self._own: dict = {}
        self._bucket = None

    def preflop_action(self, obs):
        if self.using_fallback:
            return super().preflop_action(obs)
        if self._hand != obs.hand_index:
            self._hand, self._own = obs.hand_index, {}
            self._bucket = self.policy.abstraction.bucket_of(obs.my_cards)
        res = self.policy.act(obs, self.rng, self._own, self._bucket)
        if res is None:
            self.off_tree += 1
            return super().preflop_action(obs)
        action, a = res
        if action.kind == "raise":
            self._own[len(obs.history)] = a
        self.cfr_decisions += 1
        return action


def make_bot(budget: str = "15m", policy_path: str | None = None, **kwargs):
    return PreflopCFRBot(budget=budget, policy_path=policy_path, **kwargs)
