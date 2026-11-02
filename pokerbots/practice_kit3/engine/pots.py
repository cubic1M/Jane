"""Main pot / side pot construction and odd-chip splitting."""


def build_pots(contribs, folded):
    """contribs: {pid: chips put in this hand}; folded: set of pids.

    Returns [(amount, [eligible pids])], main pot first. Eligible lists keep the
    iteration order of contribs. A pot whose only eligible player is the sole
    contributor at that level is an uncalled bet and is returned to that player
    by the normal award (they are its only eligible player).
    """
    levels = sorted({c for c in contribs.values() if c > 0})
    pots = []
    prev = 0
    for lvl in levels:
        amount = 0
        for c in contribs.values():
            amount += min(c, lvl) - min(c, prev)
        eligible = [p for p, c in contribs.items() if c >= lvl and p not in folded]
        if not eligible:
            # only folded money at this level (cannot happen in legal play): merge down
            if pots:
                a, e = pots[-1]
                pots[-1] = (a + amount, e)
            prev = lvl
            continue
        if pots and pots[-1][1] == eligible:
            pots[-1] = (pots[-1][0] + amount, eligible)
        else:
            pots.append((amount, eligible))
        prev = lvl
    return pots


def split_amount(amount, winners_in_order):
    """Split chips evenly; odd chips go one each to winners in the given order
    (the engine passes them clockwise starting left of the button)."""
    n = len(winners_in_order)
    share, rest = divmod(amount, n)
    out = {}
    for i, w in enumerate(winners_in_order):
        out[w] = share + (1 if i < rest else 0)
    return out
