"""Exact exploitability of a preflop policy in the abstract game, and head-to-head runs.

    python3 -m bots.cfr_preflop.evaluate --policy cache/cfr/preflop_a_nlhe100_15m.pkl
    python3 -m bots.cfr_preflop.evaluate --policy <file> --vs balanced,equity,push \
        --pairs 3 --hands 500            # duplicate pairs vs other bots

Exploitability = (BR_SB + BR_BB) / 2: the average over both seats of what a best
responder wins against the policy, by backward induction over the tree with the
bucket matrices (exact in the abstract game). It does NOT include the abstraction
error (bucket matrix noise, the equity-realisation assumption, postflop play).
"""
from __future__ import annotations

import argparse
import math
import time

import numpy as np

from .game import PreflopGame


def best_response_value(game: PreflopGame, strategy: dict, p: int) -> float:
    """Value (chips per hand, chance-weighted) of player p's best response to the
    other player's `strategy` ({node id: (K, A) action probabilities})."""
    nodes = game.tree.nodes

    def br(nid, r_opp):
        node = nodes[nid]
        if node.is_terminal:
            return game.terminal_value(node, p, r_opp)
        if node.player == p:
            return np.max(np.stack([br(c, r_opp) for c in node.children]), axis=0)
        sig = strategy[nid]
        return sum(br(c, r_opp * sig[:, a]) for a, c in enumerate(node.children))

    return float(np.sum(br(game.tree.root, np.ones(game.K))))


def game_value(game: PreflopGame, strategy: dict) -> float:
    """SB's expected chips per hand when both play `strategy`."""
    nodes = game.tree.nodes

    def ev(nid, r_bb, r_sb):
        node = nodes[nid]
        if node.is_terminal:
            return float(r_sb @ game.terminal_value(node, 0, r_bb))
        sig = strategy[nid]
        tot = 0.0
        for a, c in enumerate(node.children):
            if node.player == 0:
                tot += ev(c, r_bb, r_sb * sig[:, a])
            else:
                tot += ev(c, r_bb * sig[:, a], r_sb)
        return tot

    return ev(game.tree.root, np.ones(game.K), np.ones(game.K))


def exploitability(game: PreflopGame, strategy: dict) -> dict:
    """Chips per hand; bb and mbb per hand use the spec's big blind."""
    b0 = best_response_value(game, strategy, 0)
    b1 = best_response_value(game, strategy, 1)
    e = 0.5 * (b0 + b1)
    bb = game.tree.spec.big_blind
    return dict(br_sb=b0, br_bb=b1, chips=e, bb=e / bb, mbb=1000 * e / bb,
                value_sb=game_value(game, strategy))


def policy_exploitability(pol) -> dict:
    return exploitability(pol.game(), pol.strategy)


# --------------------------------------------------------------------------------------
# Head to head (duplicate pairs)
# --------------------------------------------------------------------------------------
def head_to_head(make_a, make_b, spec, pairs: int = 3, hands: int = 500, seed0: int = 100):
    """Duplicate pairs: (A, B) and (B, A) with the same deal_seed. Returns A's bb/hand
    per pair, mean and standard error."""
    from engine.match import play_match
    res = []
    for k in range(pairs):
        seed = seed0 + k
        r1 = play_match(make_a(), make_b(), spec, deal_seed=seed, hands=hands)
        r2 = play_match(make_b(), make_a(), spec, deal_seed=seed, hands=hands)
        res.append(0.5 * (r1.bb_per_hand(0) + r2.bb_per_hand(1)))
    v = np.array(res)
    se = float(v.std(ddof=1) / math.sqrt(len(v))) if len(v) > 1 else float("nan")
    return dict(per_pair=v.round(4).tolist(), mean=float(v.mean()), se=se)


def main(argv=None):
    from .policy import load_policy
    ap = argparse.ArgumentParser()
    ap.add_argument("--policy", required=True)
    ap.add_argument("--vs", default="", help="comma-separated registry names for head-to-head")
    ap.add_argument("--pairs", type=int, default=3)
    ap.add_argument("--hands", type=int, default=500)
    ap.add_argument("--seed", type=int, default=100)
    ap.add_argument("--show", type=int, default=0, help="print the root strategy for N buckets")
    a = ap.parse_args(argv)
    pol = load_policy(a.policy)
    m = pol.meta
    print(f"policy {a.policy}: {pol.spec_name}, {pol.abstraction.kind} abstraction K={pol.abstraction.K}, "
          f"tree {pol.tree.describe()}")
    print(f"  trained {m.get('elapsed_s', 0):.0f}s: {m.get('iterations')} iterations "
          f"({m.get('iters_per_s', 0):.0f}/s), matrix {m.get('matrix_seconds', 0):.1f}s "
          f"({m.get('matrix_samples')} {m.get('matrix_mode')} samples, stderr {m.get('matrix_stderr', float('nan')):.4f})")
    t = time.perf_counter()
    ex = policy_exploitability(pol)
    print(f"  exploitability (abstract game, excludes abstraction error): {ex['bb']:.5f} bb/hand = "
          f"{ex['mbb']:.2f} mbb/hand  [BR_SB {ex['br_sb']:+.4f}, BR_BB {ex['br_bb']:+.4f} chips, "
          f"SB value {ex['value_sb']:+.4f} chips; {time.perf_counter() - t:.2f}s]")
    if a.show:
        root = pol.tree.nodes[pol.tree.root]
        sig = pol.strategy[root.id]
        W, E = pol.data["W"], pol.data["E"]
        strength = (W * E).sum(1) / np.maximum(W.sum(1), 1e-12)
        ranked = np.argsort(-strength)
        order = ranked[np.unique(np.linspace(0, len(ranked) - 1, a.show).astype(int))]
        print("  root (SB) strategy " + " ".join(root.labels))
        for b in order:
            print(f"    {pol.abstraction.labels[b]:>14s} " + " ".join(f"{x:.2f}" for x in sig[b]))
    if a.vs:
        from bots.preflop_cfr import make_bot as make_cfr
        from bots.registry import make
        from engine.variants import get_variant
        spec = get_variant(pol.spec_name)
        for name in a.vs.split(","):
            t = time.perf_counter()
            r = head_to_head(lambda: make_cfr(policy_path=a.policy), lambda: make(name), spec,
                             pairs=a.pairs, hands=a.hands, seed0=a.seed)
            print(f"  vs {name:10s}: {r['mean']:+.3f} +- {r['se']:.3f} bb/hand  pairs {r['per_pair']}  "
                  f"({time.perf_counter() - t:.0f}s)")


if __name__ == "__main__":
    main()
