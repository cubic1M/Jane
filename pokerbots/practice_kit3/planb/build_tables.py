#!/usr/bin/env python3
"""Offline: Monte Carlo strength tables for Pitch Hold'em (3 hole cards, discard 1).

Simulates the variant: 8 players dealt 3 cards, every player discards with the
same heuristic policy (planb/bot.py keep_score), then a full board. For each
deal and each hero seat h (rotated, so 8 samples per deal) and k = 1..7
opponents (the next k seats), hero's share = 1 / (ties for best) or 0.

Tables:
  PRE  key (kept two-card class, k)              -> mean share
  POST key (street, my category, board category,
            flush-draw flag, k)                   -> mean share

Usage: python3 planb/build_tables.py [seconds] [out.py]
"""
import multiprocessing as mp
import os
import random
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
from engine.evaluator import evaluate  # noqa: E402

RANKS = "23456789TJQKA"


def keep_score(a, b):
    ra, rb = a % 13, b % 13
    hi, lo = (ra, rb) if ra >= rb else (rb, ra)
    s = hi * 2 + lo
    if ra == rb:
        s += 40 + ra * 2
    if a // 13 == b // 13:
        s += 4
    if 0 < hi - lo <= 2:
        s += 2
    return s


def discard_policy(h):
    best, keep = None, None
    for i in range(3):
        k = [h[j] for j in range(3) if j != i]
        sc = keep_score(k[0], k[1])
        if best is None or sc > best:
            best, keep = sc, k
    return keep


def two_class(a, b):
    ra, rb = a % 13, b % 13
    if ra < rb:
        ra, rb = rb, ra
    if ra == rb:
        return RANKS[ra] + RANKS[rb] + "p"
    return RANKS[ra] + RANKS[rb] + ("s" if a // 13 == b // 13 else "o")


def board_cat(board):
    """Category the board alone makes; by rank counts when under 5 cards."""
    if len(board) >= 5:
        return evaluate(board)[0]
    cnt = {}
    for c in board:
        cnt[c % 13] = cnt.get(c % 13, 0) + 1
    v = sorted(cnt.values(), reverse=True)
    if v[0] == 4:
        return 7
    if v[0] == 3:
        return 3
    if v[0] == 2:
        return 2 if len(v) > 1 and v[1] == 2 else 1
    return 0


def flush_draw(hole, board, cat):
    if cat >= 5 or len(board) >= 5:
        return 0
    for s in (hole[0] // 13, hole[1] // 13):
        if sum(1 for c in hole + board if c // 13 == s) == 4:
            return 1
    return 0


def worker(args):
    seconds, seed = args
    rng = random.Random(seed)
    pre, post = {}, {}
    deck = list(range(52))
    t_end = time.time() + seconds
    deals = 0
    while time.time() < t_end:
        for _ in range(50):
            rng.shuffle(deck)
            holes = [discard_policy(deck[3 * i:3 * i + 3]) for i in range(8)]
            board = deck[24:29]
            vals = [evaluate(h + board) for h in holes]
            bc = (board_cat(board[:3]), board_cat(board[:4]), evaluate(board)[0])
            for h in range(8):
                hole = holes[h]
                cls = two_class(hole[0], hole[1])
                keys = []
                for si, n in enumerate((3, 4, 5)):
                    cat = evaluate(hole + board[:n])[0] if n < 5 else vals[h][0]
                    keys.append((si, cat, bc[si], flush_draw(hole, board[:n], cat)))
                mine = vals[h]
                best_opp, ties, beaten = None, 0, False
                for k in range(1, 8):
                    v = vals[(h + k) % 8]
                    if v > mine:
                        beaten = True
                    elif v == mine:
                        ties += 1
                    share = 0.0 if beaten else 1.0 / (1 + ties)
                    e = pre.setdefault((cls, k), [0.0, 0])
                    e[0] += share
                    e[1] += 1
                    for kk in keys:
                        e = post.setdefault(kk + (k,), [0.0, 0])
                        e[0] += share
                        e[1] += 1
        deals += 50
    return pre, post, deals


def merge(dst, src):
    for k, (s, n) in src.items():
        e = dst.setdefault(k, [0.0, 0])
        e[0] += s
        e[1] += n


def class_order():
    out = []
    for hi in range(12, -1, -1):
        for lo in range(hi, -1, -1):
            if hi == lo:
                out.append(RANKS[hi] + RANKS[lo] + "p")
            else:
                out.append(RANKS[hi] + RANKS[lo] + "s")
                out.append(RANKS[hi] + RANKS[lo] + "o")
    return out


def main():
    seconds = float(sys.argv[1]) if len(sys.argv) > 1 else 120.0
    out_path = sys.argv[2] if len(sys.argv) > 2 else os.path.join(HERE, "tables_out.py")
    n = os.cpu_count() or 1
    with mp.Pool(n) as pool:
        res = pool.map(worker, [(seconds, 1000 + i) for i in range(n)])
    pre, post, deals = {}, {}, 0
    for p, q, d in res:
        merge(pre, p)
        merge(post, q)
        deals += d
    print("deals: %d" % deals, file=sys.stderr)
    classes = class_order()
    pre_s = []
    for c in classes:
        for k in range(1, 8):
            s, m = pre.get((c, k), (0.0, 0))
            pre_s.append("%03d" % min(999, round(999 * s / m)) if m >= 20 else "   ")
    post_s = []
    for si in range(3):
        for mc in range(9):
            for bcat in range(9):
                for fd in range(2):
                    for k in range(1, 8):
                        s, m = post.get((si, mc, bcat, fd, k), (0.0, 0))
                        post_s.append("%03d" % min(999, round(999 * s / m)) if m >= 20 else "   ")
    with open(out_path, "w") as f:
        f.write("# generated by build_tables.py: %d deals x 8 heroes\n" % deals)
        f.write("PRE = %r\n" % "".join(pre_s))
        f.write("POST = %r\n" % "".join(post_s))
    # readable check
    for c in ("AAp", "KKp", "AKs", "AKo", "T9s", "J4o", "22p", "53o"):
        print(c, [round(pre[(c, k)][0] / pre[(c, k)][1], 3) for k in range(1, 8)], file=sys.stderr)


if __name__ == "__main__":
    main()
