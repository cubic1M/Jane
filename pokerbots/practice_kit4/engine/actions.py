"""Turning the integer a bot returns into a legal action.

The bot returns how many chips it pushes into the pot NOW (see README 4.3).
"""
import operator

FOLD, CHECK, CALL, RAISE = "fold", "check", "call", "raise"


def to_int(raw):
    """Python int or numpy integer -> int. Anything else (bool, float,
    str, None, ...) -> None, which the engine treats as an invalid reply."""
    if isinstance(raw, bool):
        return None
    try:
        return operator.index(raw)
    except TypeError:
        return None


def interpret(raw, owe, stack, can_raise, min_add):
    """Return (kind, chips_added) or None if raw is not an integer."""
    x = to_int(raw)
    if x is None:
        return None
    call_amt = min(owe, stack)
    if x < 0:
        return (FOLD, 0)
    if owe == 0 and x == 0:
        return (CHECK, 0)
    if x < call_amt:
        return (FOLD, 0)
    if x >= stack:                                # all-in intent
        if can_raise and stack > owe:
            return (RAISE, stack)
        return (CALL, call_amt) if owe else (CHECK, 0)
    if can_raise and x >= min_add:
        return (RAISE, x)
    return (CALL, call_amt) if owe else (CHECK, 0)


def default_action(owe):
    """Used after an error, an invalid reply, or while benched."""
    return (CHECK, 0) if owe == 0 else (FOLD, 0)
