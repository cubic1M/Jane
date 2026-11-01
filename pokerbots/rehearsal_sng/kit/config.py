"""Tournament constants for the rehearsal sit-and-go.

These are the values the tournament server uses. Editing them only changes your
local simulator, not the real event.
"""

VARIANT = "Six-Plus Hold'em"

NUM_SEATS = 8
STARTING_STACK = 2000
HANDS_PER_LEVEL = 25
MAX_HANDS = 200

# Per-decision limit, measured around each call to decide().
TIME_LIMIT_MS = 1.0
# Limit for constructing your Bot() at the start of each table.
INIT_TIME_LIMIT_MS = 1000.0

# (small blind, big blind, ante) for each level. Level 1 is hands 1-25,
# level 2 is hands 26-50, and so on. Level 8 runs to the hand cap.
BLIND_LEVELS = (
    (10, 20, 0),
    (15, 30, 0),
    (25, 50, 5),
    (40, 80, 10),
    (50, 100, 10),
    (75, 150, 15),
    (100, 200, 25),
    (150, 300, 25),
)

# Points by finishing position for this variant, listed from 8th place
# (first bot out) up to 1st place.
POINTS_BY_FINISH = (0, 5, 15, 25, 35, 50, 70, 100)


def level_for_hand(hand_number: int, hands_per_level: int = HANDS_PER_LEVEL,
                   num_levels: int = len(BLIND_LEVELS)) -> int:
    """Return the 1-based blind level for a 1-based hand number."""
    if hand_number < 1:
        raise ValueError("hand numbers start at 1")
    return min((hand_number - 1) // hands_per_level, num_levels - 1) + 1


def blinds_for_hand(hand_number: int) -> tuple[int, int, int]:
    """Return (small blind, big blind, ante) for a 1-based hand number."""
    return BLIND_LEVELS[level_for_hand(hand_number) - 1]


def points_for_place(place: int, table: tuple = POINTS_BY_FINISH) -> int:
    """Points for a 1-based finishing place (1 = winner)."""
    if not 1 <= place <= len(table):
        raise ValueError(f"place must be between 1 and {len(table)}")
    return table[len(table) - place]
