"""Offline Monte Carlo strength tables for Six-Plus (prompt 2).

python3 planb5/build_tables.py [seconds]  -> writes planb5/tables_out.py
"""
import multiprocessing as mp
import os
import random
import sys
import time
from collections import Counter

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
from engine.cards import DECK, RANK_VALUE, evaluate  # noqa: E402

RANKCH = "6789TJQKA"


def cls(c1, c2):
    r1, r2 = RANK_VALUE[c1[0]], RANK_VALUE[c2[0]]
    hi, lo = max(r1, r2), min(r1, r2)
    a, b = RANKCH[hi - 6], RANKCH[lo - 6]
    if hi == lo:
        return a + b + "p"
    return a + b + ("s" if c1[1] == c2[1] else "o")


def board_cat(board):
    if len(board) >= 5:
        return evaluate(board)[0]
    cnt = sorted(Counter(c[0] for c in board).values(), reverse=True)
    if cnt[0] == 4:
        return 7
    if cnt[0] == 3:
        return 4
    if cnt[0] == 2:
        return 2 if len(cnt) > 1 and cnt[1] == 2 else 1
    return 0


def work(args):
    seed, secs = args
    rng = random.Random(seed)
    pre, post = {}, {}
    t_end = time.time() + secs
    deck = list(DECK)
    n = 0
    while time.time() < t_end:
        for _ in range(50):
            d = rng.sample(deck, 21)
            hands = [d[2 * i:2 * i + 2] for i in range(8)]
            board = d[16:21]
            sc = [evaluate(h + board) for h in hands]
            shares = []
            s0 = sc[0]
            best = s0
            ties = 1
            beaten = False
            for k in range(1, 8):
                s = sc[k]
                if s > best:
                    best = s
                    beaten = True
                elif s == best and not beaten:
                    ties += 1
                shares.append(0.0 if beaten else 1.0 / ties)
            h = hands[0]
            keys = [None, None, None]
            for st, nb in ((1, 3), (2, 4), (3, 5)):
                b = board[:nb]
                keys[st - 1] = (st, evaluate(h + b)[0], board_cat(b))
            c = cls(h[0], h[1])
            for k in range(1, 8):
                v = shares[k - 1]
                e = pre.setdefault((c, k), [0.0, 0])
                e[0] += v
                e[1] += 1
                for key in keys:
                    e = post.setdefault(key + (k,), [0.0, 0])
                    e[0] += v
                    e[1] += 1
            n += 1
    return pre, post, n


def main():
    secs = float(sys.argv[1]) if len(sys.argv) > 1 else 120.0
    nw = os.cpu_count() or 1
    with mp.Pool(nw) as pool:
        res = pool.map(work, [(1000 + i, secs) for i in range(nw)])
    pre, post, total = {}, {}, 0
    for p, q, n in res:
        total += n
        for src, dst in ((p, pre), (q, post)):
            for k, (s, c) in src.items():
                e = dst.setdefault(k, [0.0, 0])
                e[0] += s
                e[1] += c
    pre_out = {k: round(s / c, 4) for k, (s, c) in sorted(pre.items()) if c >= 20}
    # compact postflop: key int street*1000 + cat*100 + boardcat*10 + k -> int 1e4*eq
    post_out = {k[0] * 1000 + k[1] * 100 + k[2] * 10 + k[3]: int(round(1e4 * s / c))
                for k, (s, c) in sorted(post.items()) if c >= 20}
    # compact preflop: class -> 7 ints (1e4*eq) for k=1..7
    classes = sorted({k[0] for k in pre_out})
    pre_c = {c: [int(round(1e4 * pre_out[(c, k)])) for k in range(1, 8)]
             for c in classes if all((c, k) in pre_out for k in range(1, 8))}
    with open(os.path.join(HERE, "tables_out.py"), "w") as f:
        f.write(f"# {total} deals, {secs:.0f} s x {nw} workers\n")
        f.write("PRE = " + repr(pre_c).replace(" ", "") + "\n")
        f.write("POST = " + repr(post_out).replace(" ", "") + "\n")
    print(f"{total} deals; {len(pre_c)} preflop classes; {len(post_out)} postflop keys")


if __name__ == "__main__":
    main()
