"""Field 8: five sit-and-go bots, each an honest attempt to win the format."""
BOTS = {
    "f8_nash": ("sng.field8.bots", "Nash"),
    "f8_solver": ("sng.field8.bots", "Solver"),
    "f8_adaptive": ("sng.field8.bots", "Adaptive"),
    "f8_endgame": ("sng.field8.bots", "Endgame"),
    "f8_ensemble": ("sng.field8.bots", "Ensemble"),
}

FIELDS = {"field8": [(name, 1.0) for name in BOTS]}
