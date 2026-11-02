"""Parser for the action strings a bot returns from on_action_request.

Grammar (case-insensitive, leading/trailing whitespace ignored):
    "f"          fold
    "c"          call, or check when nothing is owed
    "r <bb>"     raise TO <bb> big blinds (street total), one or more spaces/tabs
                 between "r" and the number. <bb> is a plain decimal: digits with
                 an optional fractional part ("3", "2.5", ".5", "2."). No sign,
                 no exponent, no comma, no unit suffix.
The amount is rounded to the nearest 0.5 bb, halves rounded up (2.25 -> 2.5,
2.24 -> 2.0). Anything else raises ActionError.
"""

import re
from decimal import Decimal, ROUND_HALF_UP, InvalidOperation

_RAISE_RE = re.compile(r"^r\s+(\d+(?:\.\d*)?|\.\d+)$")


class ActionError(ValueError):
    pass


def parse_action(text):
    """Return ('f', None), ('c', None) or ('r', half_big_blinds:int)."""
    if not isinstance(text, str):
        raise ActionError("action must be a str, got %s" % type(text).__name__)
    s = text.strip().lower()
    if s == "f":
        return ("f", None)
    if s == "c":
        return ("c", None)
    m = _RAISE_RE.match(s)
    if not m:
        raise ActionError("unrecognised action %r" % text)
    try:
        halves = (Decimal(m.group(1)) * 2).quantize(Decimal(1), rounding=ROUND_HALF_UP)
    except InvalidOperation:
        raise ActionError("bad amount in %r" % text)
    return ("r", int(halves))


def half_bbs_to_chips(half_bbs, bb):
    """0.5 bb units -> chips. Every scheduled big blind is even, so this is exact."""
    return half_bbs * bb // 2
