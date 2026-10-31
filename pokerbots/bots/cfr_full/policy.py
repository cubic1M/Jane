"""Save/load of trained full-game CFR policies.

A policy file (pickle) holds everything play needs, so play-time bucketing and
tree mapping match training exactly:
  spec_name, spec_repr     the GameSpec it was trained for (checked on load)
  tree_cfg                 TreeConfig fields (the tree is rebuilt from spec + cfg)
  n_nodes                  node count of that tree (checked on load)
  abstraction              CardAbstraction.state(): boundaries, preflop table, sample counts
  strategy                 float32 (num_infosets, max_actions) average strategy, rows normalised
  visits                   float32 (num_infosets,) total own-reach mass (0 = never reached)
  meta                     iterations, deals, elapsed seconds, budget, timings
  format                   2 since the optional abstraction fields (cfg "feature"); files
                           without it are format 1 and load unchanged (feature = "ehs")
"""
from __future__ import annotations

import os
import pickle

import numpy as np

from engine.spec import GameSpec

from .abstraction import CardAbstraction
from .tree import DECISION, Tree, TreeConfig


def infoset_bases(tree: Tree, K) -> tuple[list, int]:
    """base[n] = first infoset index of decision node n (-1 for terminals); total count."""
    base = [-1] * tree.n_nodes
    tot = 0
    for n in range(tree.n_nodes):
        if tree.kind[n] == DECISION:
            base[n] = tot
            tot += K[tree.street[n]]
    return base, tot


def _cfg_from_dict(d: dict) -> TreeConfig:
    return TreeConfig(**{k: (tuple(tuple(x) for x in v) if k in ("preflop", "postflop") else v)
                         for k, v in d.items()})


class Policy:
    def __init__(self, spec: GameSpec, data: dict):
        self.spec = spec
        self.data = data
        self.tree = Tree(spec, _cfg_from_dict(data["tree_cfg"]))
        if self.tree.n_nodes != data["n_nodes"]:
            raise ValueError("policy tree does not match this spec/config")
        self.abs = CardAbstraction.from_state(spec, data["abstraction"])
        self.base, self.n_infosets = infoset_bases(self.tree, self.abs.K)
        self.strategy = np.asarray(data["strategy"], dtype=np.float32)
        self.visits = np.asarray(data.get("visits", np.ones(len(self.strategy))), dtype=np.float32)
        self.meta = data.get("meta", {})

    def probs(self, node: int, bucket: int) -> np.ndarray:
        """Average-strategy distribution over the node's abstract actions. Unvisited
        infosets borrow from the nearest visited bucket of the same node, else uniform."""
        na = len(self.tree.actions[node])
        K = self.abs.K[self.tree.street[node]]
        b0 = self.base[node]
        bucket = int(min(max(bucket, 0), K - 1))
        for d in range(K):
            for b in (bucket - d, bucket + d):
                if 0 <= b < K and self.visits[b0 + b] > 0:
                    p = self.strategy[b0 + b, :na].astype(np.float64)
                    s = p.sum()
                    if s > 0:
                        return p / s
        return np.full(na, 1.0 / na)


def make_policy_data(spec, tree, abstraction, strategy, visits, meta) -> dict:
    return dict(format=2, spec_name=spec.name, spec_repr=repr(spec), tree_cfg=tree.cfg.to_dict(),
                n_nodes=tree.n_nodes, abstraction=abstraction.state(),
                strategy=np.asarray(strategy, dtype=np.float32),
                visits=np.asarray(visits, dtype=np.float32), meta=dict(meta))


def save_policy(path: str, data: dict) -> None:
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "wb") as f:
        pickle.dump(data, f, protocol=pickle.HIGHEST_PROTOCOL)
    os.replace(tmp, path)


def load_policy_data(path: str) -> dict:
    with open(path, "rb") as f:
        return pickle.load(f)


def load_policy(path: str, spec: GameSpec) -> Policy:
    data = load_policy_data(path)
    if data["spec_repr"] != repr(spec):
        # name, time limits and match length do not change the game tree; anything else does
        from bots.cfr_full.library import game_key
        b_spec = _spec_from_repr(data["spec_repr"])
        if b_spec is None or game_key(spec) != game_key(b_spec):
            raise ValueError(f"policy {path} was trained for a different spec ({data['spec_name']})")
    return Policy(spec, data)


def _spec_from_repr(r: str):
    try:
        from engine.spec import DiscardRule, GameSpec  # noqa: F401  (used by eval)
        return eval(r, {"GameSpec": GameSpec, "DiscardRule": DiscardRule})
    except Exception:
        return None
