"""Pre-build strength tables for likely day-of card variants (no discards).

    python3 -m sng.ours.build_more [--minutes 4] [--only name1,name2]

Each table is matched at run time by its card rules, not its name, so the day's spec
uses it automatically if the deck, hole cards, board, usage and ranking match.
"""
from __future__ import annotations

import argparse
import time
from pathlib import Path

from engine.spec import SHORT_DECK_ORDER, STANDARD_ORDER, GameSpec
from sng.ours.build_tables import build

ROOT = Path(__file__).resolve().parents[2]


def _swap(order, a, b):
    o = list(order)
    i, j = o.index(a), o.index(b)
    o[i], o[j] = o[j], o[i]
    return tuple(o)


BASE = dict(starting_stack=2000, small_blind=10, big_blind=20, stack_reset_per_hand=False)
VARIANTS = {
    # standard deck, flush beats full house
    "v_flush_over_fh": GameSpec(name="v_flush_over_fh", category_order=_swap(STANDARD_ORDER, "flush", "full_house"),
                                **BASE),
    # standard deck, trips beat a straight (and flush > full house): six-plus ranking on 52 cards
    "v_sixplus_rank_52": GameSpec(name="v_sixplus_rank_52", category_order=SHORT_DECK_ORDER, **BASE),
    # short deck with the standard ranking
    "v_shortdeck_std": GameSpec(name="v_shortdeck_std", deck_ranks=tuple(range(4, 13)), **BASE),
    # three hole cards, use any
    "v_three_hole_any": GameSpec(name="v_three_hole_any", hole_cards=3, **BASE),
    # three hole cards, use exactly two
    "v_three_hole_exact2": GameSpec(name="v_three_hole_exact2", hole_cards=3, hole_usage="exactly", hole_exact=2,
                                    **BASE),
    # Omaha with 4 hole cards, use any
    "v_omaha4_any": GameSpec(name="v_omaha4_any", hole_cards=4, **BASE),
    # five-card Omaha (exactly 2)
    "v_plo5": GameSpec(name="v_plo5", hole_cards=5, hole_usage="exactly", hole_exact=2, **BASE),
    # no river: three streets, flop 3 + turn 1
    "v_no_river": GameSpec(name="v_no_river", board_cards_per_street=(0, 3, 1), **BASE),
    # four-card flop then a river (three betting rounds)
    "v_four_flop": GameSpec(name="v_four_flop", board_cards_per_street=(0, 4, 1), **BASE),
}


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--minutes", type=float, default=4)
    ap.add_argument("--only", default=None)
    a = ap.parse_args(argv)
    names = a.only.split(",") if a.only else list(VARIANTS)
    for n in names:
        out = ROOT / "cache" / "sng" / f"strength_{n}.npz"
        if out.exists():
            print(f"skip {n} (exists)", flush=True)
            continue
        t0 = time.time()
        build(VARIANTS[n], str(ROOT / "cache" / "sng"), a.minutes * 60)
        print(f"{n}: {time.time() - t0:.0f}s", flush=True)


if __name__ == "__main__":
    main()
