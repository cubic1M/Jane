"""Field 4: six independently designed bots (stand-ins for strong AI-assisted teams)."""
from __future__ import annotations

BOTS = {
    "f4_icm": ("sng.field4.icm_shark", "IcmShark"),          # careful ICM push/fold specialist
    "f4_tag": ("sng.field4.tag_tracker", "TagTracker"),      # tight-aggressive with reads
    "f4_lag": ("sng.field4.pressure_lag", "PressureLag"),    # loose-aggressive pressure
    "f4_mc": ("sng.field4.mc_equity", "MonteCarloEq"),       # Monte Carlo equity vs ranges
    "f4_gto": ("sng.field4.balanced_gto", "BalancedGto"),    # balanced, mixed frequencies
    "f4_eqrule": ("sng.field4.eq_rules", "EqRules"),         # the brief's equity rules
}

FIELDS = {
    "field4": [("f4_icm", 1.0), ("f4_tag", 1.0), ("f4_lag", 1.0), ("f4_mc", 1.0), ("f4_gto", 1.0),
               ("f4_eqrule", 0.7)],
}
