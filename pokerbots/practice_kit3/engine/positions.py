"""Position names, listed from the button clockwise (index 0 is the button)."""

_NAMES = {
    2: ["BTN", "BB"],                     # heads-up: the BTN posts the small blind
    3: ["BTN", "SB", "BB"],
    4: ["BTN", "SB", "BB", "CO"],
    5: ["BTN", "SB", "BB", "HJ", "CO"],
    6: ["BTN", "SB", "BB", "UTG", "HJ", "CO"],
    7: ["BTN", "SB", "BB", "UTG", "MP", "HJ", "CO"],
    8: ["BTN", "SB", "BB", "UTG", "UTG1", "MP", "HJ", "CO"],
}


def position_names(n):
    """Names for n players dealt in, button first, clockwise."""
    if n not in _NAMES:
        raise ValueError("tables hold 2..8 players, got %d" % n)
    return list(_NAMES[n])
