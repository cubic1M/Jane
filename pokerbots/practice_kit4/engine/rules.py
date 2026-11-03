"""Every number in the README, in one place."""

SEATS = 8
STARTING_STACK = 2000
HANDS_PER_LEVEL = 25
MAX_HANDS = 200
# (small blind, big blind) for levels 1..8; level 8 runs to the hand cap.
BLINDS = [(10, 20), (20, 40), (30, 60), (50, 100),
          (75, 150), (100, 200), (150, 300), (200, 400)]
# Points by finishing place, 1st first. A table pays 275 points in total.
POINTS = [100, 65, 45, 30, 20, 10, 5, 0]

TIME_LIMIT_MS = 1.0        # per play() call
SETUP_LIMIT_MS = 1000.0    # import of the file + setup(rules), once
BENCH_AFTER = 3            # consecutive timeouts before a seat is benched

MAX_FILE_BYTES = 64 * 1024
NAME_MAX_CHARS = 24
ALLOWED_IMPORTS = frozenset({
    "math", "random", "itertools", "functools", "collections", "heapq",
    "bisect", "array", "struct", "operator", "typing", "dataclasses",
    "enum", "string", "json", "numpy",
})
FORBIDDEN_NAMES = frozenset({
    "open", "exec", "eval", "compile", "__import__", "input", "breakpoint",
    "globals", "locals", "vars", "exit", "quit", "help",
})
ALLOWED_DUNDER_ATTRS = frozenset({"__init__", "__name__"})

VARIANT = "six-plus"


def blinds_for_hand(hand):
    """Return (level, small_blind, big_blind) for 1-based hand number."""
    level = min((hand - 1) // HANDS_PER_LEVEL, len(BLINDS) - 1)
    sb, bb = BLINDS[level]
    return level + 1, sb, bb


def hands_until_blinds_rise(hand):
    """Hands left at this level including this one; None at the last level."""
    level = (hand - 1) // HANDS_PER_LEVEL
    if level >= len(BLINDS) - 1:
        return None
    return HANDS_PER_LEVEL - (hand - 1) % HANDS_PER_LEVEL
