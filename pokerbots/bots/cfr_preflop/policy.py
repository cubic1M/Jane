"""Policy file (save/load) and play-time use of the preflop average strategy.

A policy pickle holds plain data: the rules spec, the TreeConfig, the card
abstraction (class key -> bucket), the average strategy per decision node, the
matrices W and E it was solved with, and training metadata. Loading rebuilds the
tree from (spec, TreeConfig) and checks its fingerprint, so a policy can never be
applied to a different betting tree.

Play time (PreflopPolicy.act):
  1. replay the preflop history from the real starting stacks, walking the abstract
     tree in parallel: checks and calls follow the check/call edge; our own raises
     follow the edge we chose; opponent raises are translated to an abstract raise
     by pot fraction with the pseudo-harmonic mapping (a real all-in maps to the
     abstract all-in). Both are remembered per hand in `own` (history index -> edge),
     so a randomised translation stays the same for the rest of the hand;
  2. sample an abstract action from the average strategy for our bucket with the
     bot's rng;
  3. turn it into a real action: raise sizes are recomputed by the same size rule in
     the real state (identical to the tree amount when on-tree) and clamped to
     obs.legal; fold when checking is free becomes a check; a raise that is not legal
     becomes check/call.
  Returns None when the hand left the tree (e.g. a raise beyond the abstract raise
  cap, or stacks far from the trained depth); the bot then uses BalancedBot.
"""
from __future__ import annotations

import os
import pickle

import numpy as np

from engine.game import Call, Check, Fold, RaiseTo

from .abstraction import CardAbstraction
from .game import (CALL, CHECK, DECISION, FOLD, RAISE, BetState, PreflopGame, Tree, TreeConfig,
                   map_raise, raise_fraction, raise_target)

VERSION = 1


def rules_spec(spec):
    """The spec without fields that do not change the preflop game."""
    return spec.with_(name="", notes="", time_per_decision=None, time_per_match=None,
                      hands_per_match=1)


def save_policy(path: str, *, spec, tree: Tree, abstraction: CardAbstraction, strategy: dict,
                W: np.ndarray, E: np.ndarray, meta: dict) -> None:
    data = dict(version=VERSION, spec_name=spec.name, spec=rules_spec(spec),
                tree_config=tree.cfg.to_dict(), fingerprint=tree.fingerprint(),
                abstraction=abstraction,
                strategy={int(k): np.asarray(v, dtype=np.float32) for k, v in strategy.items()},
                W=np.asarray(W, dtype=np.float64), E=np.asarray(E, dtype=np.float32), meta=dict(meta))
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "wb") as f:
        pickle.dump(data, f, protocol=pickle.HIGHEST_PROTOCOL)
    os.replace(tmp, path)


def load_policy(path: str) -> "PreflopPolicy":
    with open(path, "rb") as f:
        data = pickle.load(f)
    if data.get("version") != VERSION:
        raise ValueError(f"{path}: policy version {data.get('version')} != {VERSION}")
    return PreflopPolicy(data)


class PreflopPolicy:
    def __init__(self, data: dict):
        self.data = data
        self.spec_name = data["spec_name"]
        self.spec = data["spec"]
        self.cfg = TreeConfig.from_dict(data["tree_config"])
        self.tree = Tree(self.spec, self.cfg)
        if self.tree.fingerprint() != data["fingerprint"]:
            raise ValueError("policy tree does not match the tree rebuilt from its spec")
        self.abstraction: CardAbstraction = data["abstraction"]
        self.strategy = {int(k): np.asarray(v, dtype=np.float64) for k, v in data["strategy"].items()}
        self.meta = data["meta"]
        root = self.tree.nodes[self.tree.root].state
        self.tree_eff = min(s + c for s, c in zip(root.stacks, root.committed))
        self.max_depth_ratio = 1.3

    def matches(self, spec) -> bool:
        return rules_spec(spec) == self.spec

    def game(self) -> PreflopGame:
        return PreflopGame(self.tree, self.data["W"], self.data["E"], self.cfg)

    # ---- play time -------------------------------------------------------------------
    def locate(self, obs, own: dict, rng):
        """(abstract node, real BetState) for the player to act, or None if off-tree.
        own: per-hand memo {history index: abstract edge} for raises (ours and
        translated ones); new translations are added to it."""
        if obs.position == 0:
            stacks = [obs.my_stack + obs.my_committed, obs.opp_stack + obs.opp_committed]
        else:
            stacks = [obs.opp_stack + obs.opp_committed, obs.my_stack + obs.my_committed]
        eff = min(stacks)
        r = eff / max(1, self.tree_eff)
        if r > self.max_depth_ratio or r < 1 / self.max_depth_ratio:
            return None
        real = BetState.initial(self.spec, stacks)
        nodes = self.tree.nodes
        node = nodes[self.tree.root]
        for i, rec in enumerate(obs.history):
            if rec.street != 0 or rec.kind not in (CHECK, CALL, RAISE):
                continue
            if node.kind != DECISION or node.player != rec.position or real.done \
                    or real.to_act != rec.position:
                return None
            if rec.kind in (CHECK, CALL):
                lab = "k" if rec.kind == CHECK else "c"
                if lab not in node.labels:
                    lab = "c" if lab == "k" else "k"   # abstract and real disagree on facing a bet
                    if lab not in node.labels:
                        return None
                a = node.labels.index(lab)
            else:
                a = own.get(i)
                if a is None:
                    a = self._translate(node, real, rec.amount, rng)
                    if a is None:
                        return None
                    own[i] = a      # translate each opponent raise once per hand
            real = real.apply(rec.kind, rec.amount)
            node = nodes[node.children[a]]
        if node.kind != DECISION or node.player != obs.position:
            return None
        return node, real

    def _translate(self, node, real: BetState, amount: int, rng):
        raises = [a for a, k in enumerate(node.kinds) if k == RAISE]
        if not raises:
            return None
        lg = real.legal()
        st = node.state
        p = st.to_act
        call_abs = min(max(st.pips) - st.pips[p], st.stacks[p])
        fracs = np.array([raise_fraction(node.amounts[a], max(st.pips), st.pot, call_abs) for a in raises])
        allin = next((k for k, a in enumerate(raises) if node.rules[a] == ("allin",)), -1)
        x = raise_fraction(amount, max(real.pips), real.pot, lg.call_amount)
        k = map_raise(fracs, x, rng.random(), allin, is_allin=amount >= lg.max_raise_to)
        return raises[k]

    def act(self, obs, rng, own: dict, bucket: int):
        """(engine Action, abstract action index) or None when off-tree."""
        loc = self.locate(obs, own, rng)
        if loc is None:
            return None
        node, real = loc
        probs = self.strategy[node.id][bucket]
        u = rng.random() * float(probs.sum())
        a = int(min(len(probs) - 1, np.searchsorted(np.cumsum(probs), u, side="right")))
        lg = obs.legal
        kind = node.kinds[a]
        if kind == FOLD:
            return (Check() if lg.can_check else Fold()), a
        if kind in (CHECK, CALL) or not lg.can_raise:
            return (Check() if lg.can_check else Call()), a
        st = node.state
        if real.pips == st.pips and real.stacks == st.stacks:
            amt = node.amounts[a]
        else:
            max_pip = max(obs.my_pip, obs.opp_pip)
            amt = raise_target(node.rules[a], max_pip=max_pip, my_pip=obs.my_pip,
                               my_stack=obs.my_stack, pot=obs.pot, call_amount=lg.call_amount,
                               bb=self.spec.big_blind, lo=lg.min_raise_to, hi=lg.max_raise_to,
                               commit_frac=self.cfg.commit_frac)
        return RaiseTo(lg.clamp_raise(amt)), a
