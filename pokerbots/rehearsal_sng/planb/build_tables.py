#!/usr/bin/env python3
"""Monte Carlo strength tables for Six-Plus Hold'em (plan B, prompt 2).

    python3 planb/build_tables.py [--seconds 120] [--workers 4] > planb/tables.txt

Each deal: eight random hands plus a full board from the 36-card deck. Hero is
hand 0; for k = 1..7 the opponents are hands 1..k. Hero's share is 1 if it
beats all, 1/ties if tied for best, else 0 (judged at the river showdown).
Mean share is accumulated by
  PRE[(class, k)]                          class = e.g. "AKs", "T9o", "77p"
  POST[(street, my_cat, board_cat, k)]     street in flop/turn/river
Prints both dicts as Python literals (keys with >= 20 samples).
"""

import argparse
import multiprocessing as mp
import os
import random
import sys
import time

KIT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "kit")
sys.path.insert(0, KIT)

from cards import (FULL_DECK, FOUR_OF_A_KIND, FULL_HOUSE, HIGH_CARD, PAIR,  # noqa: E402
                   RANK_VALUE, RANKS, THREE_OF_A_KIND, TWO_PAIR, evaluate)

MIN_SAMPLES = 20


def hand_class(c1, c2):
    a, b = c1[0], c2[0]
    if RANK_VALUE[a] < RANK_VALUE[b]:
        a, b = b, a
    if a == b:
        return a + b + "p"
    return a + b + ("s" if c1[1] == c2[1] else "o")


def board_category(board):
    """Category the visible board alone makes (rank counts if under 5 cards)."""
    if len(board) >= 5:
        return evaluate(board, validate=False)[0]
    counts = {}
    for c in board:
        counts[c[0]] = counts.get(c[0], 0) + 1
    shape = sorted(counts.values(), reverse=True)
    if shape[0] == 4:
        return FOUR_OF_A_KIND
    if shape[0] == 3:
        return FULL_HOUSE if len(shape) > 1 and shape[1] >= 2 else THREE_OF_A_KIND
    if shape[0] == 2:
        return TWO_PAIR if len(shape) > 1 and shape[1] == 2 else PAIR
    return HIGH_CARD


def worker(seconds, seed, out):
    rng = random.Random(seed)
    deck = list(FULL_DECK)
    pre = {}    # key -> [sum, n]
    post = {}
    deadline = time.time() + seconds
    deals = 0
    while True:
        if deals % 256 == 0 and time.time() > deadline:
            break
        deals += 1
        cards = rng.sample(deck, 21)
        holes = [cards[2 * i:2 * i + 2] for i in range(8)]
        board = cards[16:21]
        scores = [evaluate(h + board, validate=False) for h in holes]
        hero = scores[0]
        shares = []
        best_other = None
        ties = 0
        for k in range(1, 8):
            s = scores[k]
            if best_other is None or s > best_other:
                best_other, ties = s, 1
            elif s == best_other:
                ties += 1
            if hero > best_other:
                shares.append(1.0)
            elif hero == best_other:
                shares.append(1.0 / (ties + 1))
            else:
                shares.append(0.0)
        hc = hand_class(*holes[0])
        keys = []
        for street, n in (("flop", 3), ("turn", 4), ("river", 5)):
            vis = board[:n]
            my = evaluate(holes[0] + vis, validate=False)[0] if n < 5 else hero[0]
            keys.append((street, my, board_category(vis)))
        for k in range(1, 8):
            sh = shares[k - 1]
            acc = pre.setdefault((hc, k), [0.0, 0])
            acc[0] += sh
            acc[1] += 1
            for st, my, bc in keys:
                acc = post.setdefault((st, my, bc, k), [0.0, 0])
                acc[0] += sh
                acc[1] += 1
    out.put((deals, pre, post))


def merge(dst, src):
    for key, (s, n) in src.items():
        acc = dst.setdefault(key, [0.0, 0])
        acc[0] += s
        acc[1] += n


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--seconds", type=float, default=120.0)
    ap.add_argument("--workers", type=int, default=max(1, os.cpu_count() or 1))
    ap.add_argument("--seed", type=int, default=2026)
    args = ap.parse_args()
    q = mp.Queue()
    procs = [mp.Process(target=worker, args=(args.seconds, args.seed + i, q))
             for i in range(args.workers)]
    for p in procs:
        p.start()
    deals, pre, post = 0, {}, {}
    for _ in procs:
        d, a, b = q.get()
        deals += d
        merge(pre, a)
        merge(post, b)
    for p in procs:
        p.join()
    pre_t = {k: round(s / n, 4) for k, (s, n) in sorted(pre.items()) if n >= MIN_SAMPLES}
    post_t = {k: round(s / n, 4) for k, (s, n) in sorted(post.items()) if n >= MIN_SAMPLES}
    print(f"# {deals} deals, {len(pre_t)} preflop keys, {len(post_t)} postflop keys")
    print("PRE = " + repr(pre_t))
    print("POST = " + repr(post_t))
    print(f"{deals} deals", file=sys.stderr)


if __name__ == "__main__":
    main()
