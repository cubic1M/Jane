"""Named rule sets for the arena and the tuner. On the day: add one entry with the kit's
card rules, blind schedule, antes and point table (1st place first)."""
from engine.spec import SHORT_DECK_ORDER, GameSpec

from sng.rules import NLHE

PRESETS = {
    "default": {},
    # rehearsal kit (rehearsal_sng/README.md): six-plus hold'em, antes from level 3
    "rehearsal_sixplus": dict(
        spec=GameSpec(name="rehearsal_sixplus", deck_ranks=tuple(range(4, 13)), category_order=SHORT_DECK_ORDER,
                      starting_stack=2000, small_blind=10, big_blind=20, stack_reset_per_hand=False),
        blinds=((10, 20), (15, 30), (25, 50), (40, 80), (50, 100), (75, 150), (100, 200), (150, 300)),
        antes=(0, 0, 5, 10, 10, 15, 25, 25),
        payouts=(100, 70, 50, 35, 25, 15, 5, 0)),
}
