"""Offline Monte Carlo equity tables for Six-Plus Hold'em (prompt 2).

    python3 planb2/build_tables.py [seconds] [procs]   (run from rehearsal_sng/)

Writes planb2/tables_out.py with PRE and POST dict literals.
Uses the kit's evaluator (kit/cards.py).
"""
import os
import random
import sys
import time
from collections import Counter
from multiprocessing import Pool

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "kit"))
from cards import FULL_DECK, RANK_VALUE, evaluate  # noqa: E402

RANKS = "6789TJQKA"


def hand_class(c1, c2):
    a, b = c1[0], c2[0]
    if RANKS.index(a) < RANKS.index(b):
        a, b = b, a
    if a == b:
        return a + b + "p"
    return a + b + ("s" if c1[1] == c2[1] else "o")


def board_cat(board):
    """Category the board alone makes; rank counts when under 5 cards."""
    if len(board) >= 5:
        return evaluate(board, validate=False)[0]
    cnt = sorted(Counter(c[0] for c in board).values(), reverse=True)
    if cnt[0] == 4:
        return 7
    if cnt[0] == 3:
        return 4
    if cnt[0] == 2:
        return 2 if len(cnt) > 1 and cnt[1] == 2 else 1
    return 0


def worker(args):
    seconds, seed = args
    rng = random.Random(seed)
    pre = {}   # key -> [sum, n]
    post = {}
    deck = list(FULL_DECK)
    end = time.time() + seconds
    deals = 0
    while time.time() < end:
        for _ in range(50):
            rng.shuffle(deck)
            hands = [(deck[2 * i], deck[2 * i + 1]) for i in range(8)]
            board = deck[16:21]
            scores = [evaluate(list(h) + board, validate=False) for h in hands]
            hero = hands[0]
            hs = scores[0]
            # shares for each k
            shares = []
            best_opp = None
            for k in range(1, 8):
                s = scores[k]
                if best_opp is None or s > best_opp:
                    best_opp = s
                    ties = 1
                elif s == best_opp:
                    ties += 1
                if hs > best_opp:
                    shares.append(1.0)
                elif hs == best_opp:
                    shares.append(1.0 / (ties + 1))
                else:
                    shares.append(0.0)
            hc = hand_class(*hero)
            cats = []
            for street, nb in (("flop", 3), ("turn", 4), ("river", 5)):
                b = board[:nb]
                mine = hs[0] if nb == 5 else evaluate(list(hero) + b, validate=False)[0]
                cats.append((street, mine, board_cat(b)))
            for k in range(1, 8):
                sh = shares[k - 1]
                e = pre.setdefault((hc, k), [0.0, 0])
                e[0] += sh
                e[1] += 1
                for st, mine, bc in cats:
                    e = post.setdefault((st, mine, bc, k), [0.0, 0])
                    e[0] += sh
                    e[1] += 1
            deals += 1
    return pre, post, deals


def merge(dst, src):
    for k, (s, n) in src.items():
        e = dst.setdefault(k, [0.0, 0])
        e[0] += s
        e[1] += n


def main():
    seconds = float(sys.argv[1]) if len(sys.argv) > 1 else 120.0
    procs = int(sys.argv[2]) if len(sys.argv) > 2 else 2
    with Pool(procs) as pool:
        res = pool.map(worker, [(seconds, 1000 + i) for i in range(procs)])
    pre, post, deals = {}, {}, 0
    for p, q, d in res:
        merge(pre, p)
        merge(post, q)
        deals += d
    PRE = {k: round(s / n, 4) for k, (s, n) in sorted(pre.items()) if n >= 20}
    POST = {k: round(s / n, 4) for k, (s, n) in sorted(post.items()) if n >= 20}
    out = os.path.join(HERE, "tables_out.py")
    with open(out, "w") as f:
        f.write(f"# {deals} deals, {seconds}s x {procs} procs\n")
        f.write("PRE = " + repr(PRE) + "\n")
        f.write("POST = " + repr(POST) + "\n")
    print(f"deals={deals} pre={len(PRE)} post={len(POST)} -> {out}")


if __name__ == "__main__":
    main()
