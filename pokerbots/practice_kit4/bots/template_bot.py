"""Starter bot: copy this file, rename NAME, and edit play()."""

NAME = "template"


def setup(rules):
    # Called once after import (1,000 ms budget for import + setup together).
    # `rules` describes the event, including the deck and the hand ranking.
    pass


def play(view, memory):
    """Return the number of chips to push into the pot now.

    -1 (or anything below `owe`) folds, 0 checks when nothing is owed,
    `owe` calls, `view["min_add"]` or more raises, `view["max_add"]` is all-in.
    `memory` is a dict that is yours for the whole table.
    """
    owe, bb = view["owe"], view["bb"]
    r1, r2 = view["hole"][0][0], view["hole"][1][0]
    good = r1 == r2 or (r1 in "AKQ" and r2 in "AKQ")
    if view["street"] == 0:
        if good and view["min_add"] is not None:
            return max(view["min_add"], owe + 2 * bb)    # open or re-raise
        if owe <= bb and (good or r1 == "A" or r2 == "A"):
            return owe                                   # limp / check / call
        return 0 if owe == 0 else -1                     # check if free, else fold
    if owe == 0:
        return 0
    return owe if good and owe <= view["pot"] // 2 else -1
