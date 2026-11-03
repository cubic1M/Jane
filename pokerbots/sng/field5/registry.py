"""Field 5: five independently written sit-and-go bots."""
BOTS = {
    "f5_nash": ("sng.field5.nash", "NashBot"),
    "f5_reg": ("sng.field5.reg", "RegBot"),
    "f5_bully": ("sng.field5.bully", "BullyBot"),
    "f5_trapper": ("sng.field5.trapper", "TrapperBot"),
    "f5_adapt": ("sng.field5.adapt", "AdaptBot"),
}

FIELDS = {"field5": [(name, 1.0) for name in BOTS]}
