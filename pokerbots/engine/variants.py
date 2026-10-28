"""The variant specs used in the study. On the day, add one GameSpec here.

All variants use SB=1, BB=2 chips so results are comparable in big blinds.
"""
from __future__ import annotations

from .spec import SHORT_DECK_ORDER, DiscardRule, GameSpec

A_NLHE100 = GameSpec(
    name="a_nlhe100", starting_stack=200,
    notes="Heads-up no-limit hold'em, 100bb, stacks reset each hand.")

B_NLHE200 = GameSpec(
    name="b_nlhe200", starting_stack=400,
    notes="Heads-up NLHE, 200bb.")

C_DISCARD3 = GameSpec(
    name="c_discard3", hole_cards=3, starting_stack=400,
    discards=(DiscardRule(street=1, count=1, to_board=True, face_up=True, order="oop_first"),),
    notes="MIT Pokerbots 2026 style: 3 hole cards; after the flop is dealt (before flop "
          "betting) BB then SB discards one card face up onto the board; best 5 of "
          "2 hole + 7 board. 400 chips = 200bb.")

D_OMAHA4X2 = GameSpec(
    name="d_omaha4x2", hole_cards=4, hole_usage="exactly", hole_exact=2, starting_stack=200,
    notes="4 hole cards, use exactly 2 + 3 board (Omaha hand rules), no-limit, 100bb.")

E_SHORTDECK = GameSpec(
    name="e_shortdeck", deck_ranks=tuple(range(4, 13)), category_order=SHORT_DECK_ORDER,
    starting_stack=200,
    notes="Short deck (6+), 36 cards, flush > full house, trips > straight, A-6-7-8-9 "
          "wheel, blinds not antes, 100bb.")

F_NLHE20 = GameSpec(
    name="f_nlhe20", starting_stack=40,
    notes="Heads-up NLHE, 20bb (push/fold territory).")

G_PINEAPPLE = GameSpec(
    name="g_pineapple", hole_cards=3, starting_stack=200,
    discards=(DiscardRule(street=1, count=1, to_board=False, face_up=False, order="oop_first"),),
    notes="Crazy-pineapple style: 3 hole cards, discard 1 face down to the muck after the "
          "flop is dealt, then normal hold'em, 100bb.")

VARIANTS = {s.name: s for s in (A_NLHE100, B_NLHE200, C_DISCARD3, D_OMAHA4X2, E_SHORTDECK,
                                F_NLHE20, G_PINEAPPLE)}


# ---- day-of variants -------------------------------------------------------------
# On the day: copy the closest spec above, edit it to the announced rules, and add
# it to this tuple. Then: python3 dayof.py --variant <name>
H_PLO5 = GameSpec(
    name="h_plo5", hole_cards=5, hole_usage="exactly", hole_exact=2, betting="pot_limit",
    starting_stack=200, notes="HOLD-OUT drill: 5-card pot-limit Omaha, exactly 2 hole cards, 100bb.")

DAY_VARIANTS: tuple = (H_PLO5,)

ALL_VARIANTS = {**VARIANTS, **{s.name: s for s in DAY_VARIANTS}}


def get_variant(name: str) -> GameSpec:
    if name in ALL_VARIANTS:
        return ALL_VARIANTS[name]
    for k, v in ALL_VARIANTS.items():
        if k.split("_")[0] == name:
            return v
    raise KeyError(name)
