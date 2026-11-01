"""field2: a second, independently designed opponent field for the sit-and-go arena.

Six designs a strong one-hour team could plausibly build (see each module's docstring):
nash (push/fold + ICM), gto (balanced TAG, mixed strategies), exploit (per-seat opponent
model), bubble (stack-rank ICM pressure), equity (precomputed equity tables, pot/implied
odds) and shark (fold-equity push model + ICM + opponent stats).
"""
BOTS = {
    "f2_nash": ("sng.field2.nash", "F2Nash"),
    "f2_gto": ("sng.field2.gto", "F2Gto"),
    "f2_exploit": ("sng.field2.exploit", "F2Exploit"),
    "f2_bubble": ("sng.field2.bubble", "F2Bubble"),
    "f2_equity": ("sng.field2.equity", "F2Equity"),
    "f2_shark": ("sng.field2.shark", "F2Shark"),
}

FIELDS = {
    "field2": [(name, 1.0) for name in BOTS],
}
