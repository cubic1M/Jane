"""Tournament constants. README.md is the authority; this file mirrors it."""

STARTING_STACK = 2000
NUM_PLAYERS = 8
MAX_HANDS = 200          # a table stops after hand 200 if 2+ bots remain
HANDS_PER_LEVEL = 25     # level 1 = hands 1-25, level 2 = hands 26-50, ...

# (level, small blind, big blind, ante).  Antes start at level 4 (hand 76).
BLIND_SCHEDULE = [
    (1, 10, 20, 0),
    (2, 15, 30, 0),
    (3, 25, 50, 0),
    (4, 50, 100, 10),
    (5, 75, 150, 15),
    (6, 100, 200, 25),
    (7, 150, 300, 40),
    (8, 200, 400, 50),
]

# Points per finishing place, 1st place first, as parts of a 1000-point pool.
PAYOUTS_PER_MILLE = [350, 220, 150, 100, 75, 50, 35, 20]
POINTS_POOL = 1000

TIME_LIMIT_MS = 1.0          # per decision, including JSON round trip
INIT_TIME_LIMIT_MS = 500.0   # module import + init(config), per table

# Submission rules (single file).
ALLOWED_IMPORTS = frozenset({
    "__future__", "math", "random", "itertools", "functools", "collections",
    "heapq", "bisect", "json", "time", "statistics", "typing", "dataclasses",
    "enum", "operator", "array", "copy", "numpy",
})
BANNED_NAMES = frozenset({
    "open", "exec", "eval", "compile", "__import__", "input", "breakpoint",
    "globals", "vars", "setattr", "delattr",
})
MAX_FILE_BYTES = 100_000


def level_for_hand(hand_number, hands_per_level=HANDS_PER_LEVEL,
                   schedule=BLIND_SCHEDULE):
    """Return (level, sb, bb, ante) for a 1-based hand number."""
    idx = min((hand_number - 1) // hands_per_level, len(schedule) - 1)
    return schedule[idx]


def hands_left_in_level(hand_number, hands_per_level=HANDS_PER_LEVEL,
                        schedule=BLIND_SCHEDULE):
    """Hands still to be played at the current level AFTER this one.

    None on the last level (blinds never rise again)."""
    idx = (hand_number - 1) // hands_per_level
    if idx >= len(schedule) - 1:
        return None
    return (idx + 1) * hands_per_level - hand_number
