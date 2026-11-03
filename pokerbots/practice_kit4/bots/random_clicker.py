"""Clicks buttons at random. Uses the random module (seeded by run_local.py)."""
import random

NAME = "random clicker"


def play(view, memory):
    owe, pot = view["owe"], view["pot"]
    r = random.random()
    if r < 0.25:
        return -1
    if r < 0.75 or view["min_add"] is None:
        return owe
    if r < 0.95:
        return max(view["min_add"], owe + pot)
    return view["max_add"]
