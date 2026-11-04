"""Named rule sets for the arena and the tuner. On the day: add one entry with the kit's
card rules, blind schedule, antes and point table (1st place first)."""
from engine.spec import SHORT_DECK_ORDER, DiscardRule, GameSpec

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
    # practice kit 4 (practice_kit4/README.md): six-plus hold'em, no antes, 25 hands per level
    "kit4_sixplus": dict(
        spec=GameSpec(name="kit4_sixplus", deck_ranks=tuple(range(4, 13)), category_order=SHORT_DECK_ORDER,
                      starting_stack=2000, small_blind=10, big_blind=20, stack_reset_per_hand=False),
        blinds=((10, 20), (20, 40), (30, 60), (50, 100), (75, 150), (100, 200), (150, 300), (200, 400)),
        antes=(0,) * 8,
        payouts=(100, 65, 45, 30, 20, 10, 5, 0)),
    # pot-splitting variants (engine/showdown.py)
    "holdem_hilo8": dict(spec=GameSpec(name="holdem_hilo8", showdown="hilo8", starting_stack=2000, small_blind=10,
                                       big_blind=20, stack_reset_per_hand=False)),
    "omaha_hilo8": dict(spec=GameSpec(name="omaha_hilo8", showdown="hilo8", hole_cards=4, hole_usage="exactly",
                                      hole_exact=2, betting="pot_limit", starting_stack=2000, small_blind=10,
                                      big_blind=20, stack_reset_per_hand=False)),
    "double_board": dict(spec=GameSpec(name="double_board", showdown="double_board", board_cards_per_street=(0, 6, 2, 2),
                                       starting_stack=2000, small_blind=10, big_blind=20, stack_reset_per_hand=False)),
    # discard / draw variants (sng/tests/test_discards.py shapes)
    "discard_to_board": dict(spec=GameSpec(name="t_to_board", hole_cards=3, starting_stack=2000, small_blind=10,
                                           big_blind=20, stack_reset_per_hand=False,
                                           discards=(DiscardRule(street=1, count=1, to_board=True, face_up=True),))),
    "draw_holdem": dict(spec=GameSpec(name="t_draw_holdem", starting_stack=2000, small_blind=10, big_blind=20,
                                      stack_reset_per_hand=False,
                                      discards=(DiscardRule(street=1, count=1, to_board=False, face_up=False,
                                                            draw=True, min_count=0),))),
    # practice-kit-2 style: the 0-1 card draw happens AFTER the flop betting
    "draw_after_flop": dict(spec=GameSpec(name="t_draw_after_flop", starting_stack=2000, small_blind=10,
                                          big_blind=20, stack_reset_per_hand=False,
                                          discards=(DiscardRule(street=1, count=1, to_board=False, face_up=False,
                                                                draw=True, min_count=0, after_betting=True),))),
    "five_draw": dict(spec=GameSpec(name="t_five_draw", hole_cards=5, board_cards_per_street=(0, 0),
                                    starting_stack=2000, small_blind=10, big_blind=20, stack_reset_per_hand=False,
                                    discards=(DiscardRule(street=1, count=3, to_board=False, face_up=False,
                                                          draw=True, min_count=0),))),
    "omaha_discard2": dict(spec=GameSpec(name="t_dead_down", hole_cards=4, starting_stack=2000, small_blind=10,
                                         big_blind=20, stack_reset_per_hand=False,
                                         discards=(DiscardRule(street=1, count=2, to_board=False, face_up=False,
                                                               order="ip_first"),))),
}


# module-level names for `python3 -m sng.ours.anyvar --spec sng.presets:<NAME>` (any-variant tables)
HOLDEM_HILO8 = PRESETS["holdem_hilo8"]["spec"]
OMAHA_HILO8 = PRESETS["omaha_hilo8"]["spec"]
DOUBLE_BOARD = PRESETS["double_board"]["spec"]
KIT4_SIXPLUS = PRESETS["kit4_sixplus"]["spec"]
