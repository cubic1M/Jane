"""Field bots for sng.registry (module, class) plus named field mixes."""
from sng.field import FIELD_WEIGHTS

BOTS = {
    "mc_equity": ("sng.field.mc", "McEquityBot"),
    "mc_slow": ("sng.field.registry", "McSlow"),
    "mc_fast": ("sng.field.mc", "McFastBot"),
    "chen_tag": ("sng.field.tag", "ChenTag"),
    "lag": ("sng.field.lag", "Lag"),
    "nit": ("sng.field.nit", "Nit"),
    "station": ("sng.field.station", "Station"),
    "maniac": ("sng.field.maniac", "Maniac"),
    "pushfold_icm": ("sng.field.pushfold", "PushFoldIcm"),
    "adaptive": ("sng.field.adaptive", "Adaptive"),
}


def McSlow():
    from sng.field.mc import McEquityBot
    return McEquityBot(samples=1000)


FIELDS = {
    "default": list(FIELD_WEIGHTS.items()),
    # a stronger regional: fewer broken bots, more short-stack specialists and TAGs
    "strong": [("pushfold_icm", 25), ("adaptive", 20), ("chen_tag", 25), ("lag", 10), ("nit", 10),
               ("mc_fast", 10)],
    # a weak field: many slow / loose bots
    "weak": [("mc_equity", 20), ("mc_slow", 15), ("station", 20), ("maniac", 15), ("chen_tag", 15),
             ("lag", 15)],
}
