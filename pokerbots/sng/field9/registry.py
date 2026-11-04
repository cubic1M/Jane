"""Field 9: six sit-and-go bots of styles not covered by fields 6-8."""
BOTS = {
    "f9_threebet": ("sng.field9.bots", "ThreeBet"),
    "f9_limptrap": ("sng.field9.bots", "LimpTrap"),
    "f9_bubble": ("sng.field9.bots", "Bubble"),
    "f9_float": ("sng.field9.bots", "Float"),
    "f9_gto": ("sng.field9.bots", "Balanced"),
    "f9_meta": ("sng.field9.bots", "Meta"),
}

FIELDS = {"field9": [(name, 1.0) for name in BOTS]}
