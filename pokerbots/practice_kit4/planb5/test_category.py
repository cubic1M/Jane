"""Check the bot's own category() against the kit evaluator on random hands."""
import os
import random
import sys
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
from engine.cards import DECK, evaluate  # noqa: E402
from engine.seats import BotFile  # noqa: E402

bot = BotFile(sys.argv[1]).module
rng = random.Random(5)
bad = 0
for i in range(200000):
    n = rng.choice((5, 6, 7))
    cs = rng.sample(DECK, n)
    if bot.category(cs) != evaluate(cs)[0]:
        bad += 1
        if bad < 5:
            print("mismatch", cs, bot.category(cs), evaluate(cs))
print("mismatches:", bad, "of 200000")
