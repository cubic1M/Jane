"""Every tournament constant in one place. The README quotes these values."""

STARTING_STACK = 2000
SEATS = 8

# (small blind, big blind) per level; a level lasts HANDS_PER_LEVEL hands of the
# table's own hand counter. The last level repeats if a table somehow runs longer.
BLIND_LEVELS = [
    (10, 20), (15, 30), (25, 50), (40, 80),
    (60, 120), (100, 200), (150, 300), (250, 500),
]
HANDS_PER_LEVEL = 25
MAX_HANDS = 200

HOLE_CARDS = 3          # dealt preflop; one is discarded face up before the flop

# Points by finishing place (index 0 = 1st place). Sum = 22 per 8-bot table.
POINTS = [12, 7, 4, 2, 0, 0, 0, -3]

DECISION_LIMIT_MS = 1.0     # per decision, notification time since last decision included
SETUP_LIMIT_MS = 250.0      # load file + Agent() + on_table_start, per table

SUBMISSION_MAX_BYTES = 32000    # bytes of the file as stored (UTF-8), not KiB
ALLOWED_IMPORTS = frozenset({
    "__future__", "math", "random", "itertools", "functools", "collections",
    "heapq", "bisect", "time", "typing", "dataclasses", "enum", "operator",
})
FORBIDDEN_NAMES = frozenset({
    "eval", "exec", "compile", "open", "__import__", "input", "breakpoint",
    "exit", "quit", "globals", "__builtins__",
})


def blinds_for_hand(hand_number, levels=BLIND_LEVELS, per_level=HANDS_PER_LEVEL):
    """Return (level_number_1_based, sb, bb) for a 1-based table hand number."""
    idx = min((hand_number - 1) // per_level, len(levels) - 1)
    sb, bb = levels[idx]
    return idx + 1, sb, bb
