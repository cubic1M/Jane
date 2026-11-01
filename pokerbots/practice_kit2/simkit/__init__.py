"""Local simulator for the practice tournament (see README.md).

Nothing in this package is available to your bot on the grader: your
submission is a single file and may only import the modules listed in
simkit.rules.ALLOWED_IMPORTS.
"""

from .rules import (  # noqa: F401
    ALLOWED_IMPORTS,
    BLIND_SCHEDULE,
    HANDS_PER_LEVEL,
    INIT_TIME_LIMIT_MS,
    MAX_HANDS,
    NUM_PLAYERS,
    PAYOUTS_PER_MILLE,
    STARTING_STACK,
    TIME_LIMIT_MS,
)
