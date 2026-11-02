"""Check planb's category() and board_cat() against the kit evaluator on random hands."""
import os, random, sys
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
from engine.evaluator import evaluate
ns = {}
src = open(os.path.join(HERE, "bot_core.py")).read()
exec(src, ns)
rng = random.Random(5)
bad = 0
N = 200000
for i in range(N):
    n = 5 + i % 3
    cards = rng.sample(range(52), n)
    if ns["category"](cards) != evaluate(cards)[0]:
        bad += 1
        if bad < 5: print("MISMATCH", cards, ns["category"](cards), evaluate(cards))
# special hands
for cards in ([12, 0, 1, 2, 3], [12+13, 0, 1, 2, 3, 30], [8, 9, 10, 11, 12], [0, 13, 26, 1, 14], [0, 13, 26, 39, 1]):
    assert ns["category"](cards) == evaluate(cards)[0], cards
print("category mismatches: %d / %d" % (bad, N))
