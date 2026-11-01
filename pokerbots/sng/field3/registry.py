"""Field 3 bots and mix. Weights = how common each type is at a typical regional
(many generic agent-written bots and rushed bugs, few strong adaptive teams)."""
BOTS = {
    "f3_generic": ("sng.field3.bots.generic", "GenericBot"),
    "f3_mc_slow": ("sng.field3.bots.mc_slow", "MonteCarloBot"),
    "f3_shover": ("sng.field3.bots.shover", "ShoverBot"),
    "f3_quant_icm": ("sng.field3.bots.quant_icm", "QuantIcmBot"),
    "f3_buggy": ("sng.field3.bots.buggy", "BuggyBot"),
    "f3_exploiter": ("sng.field3.bots.exploiter", "ExploiterBot"),
    "f3_survivor": ("sng.field3.bots.survivor", "SurvivorBot"),
    "f3_ladder_pro": ("sng.field3.bots.ladder_pro", "LadderProBot"),
}

FIELDS = {
    "field3": [
        ("f3_generic", 3.0),
        ("f3_buggy", 2.0),
        ("f3_mc_slow", 1.5),
        ("f3_shover", 1.5),
        ("f3_survivor", 1.0),
        ("f3_quant_icm", 0.75),
        ("f3_ladder_pro", 0.75),
        ("f3_exploiter", 0.5),
    ],
}


def make(name: str):
    import importlib
    mod, cls = BOTS[name]
    return getattr(importlib.import_module(mod), cls)()
