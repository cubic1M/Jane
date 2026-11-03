"""Field 6: five sit-and-go bots whose edge is postflop play."""
BOTS = {
    "f6_checkraiser": ("sng.field6.bots", "CheckRaiser"),
    "f6_floater": ("sng.field6.bots", "Floater"),
    "f6_overbettor": ("sng.field6.bots", "Overbettor"),
    "f6_riverbluffer": ("sng.field6.bots", "RiverBluffer"),
    "f6_raiser": ("sng.field6.bots", "Raiser"),
}

FIELDS = {"field6": [(name, 1.0) for name in BOTS]}
