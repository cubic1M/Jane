"""Name -> bot factory for the sit-and-go arena (names keep multiprocessing simple).

Grammar: name[:key=value;key=value] (values parsed as int/float when possible).
"""
from __future__ import annotations

import importlib

BOTS = {
    "random": ("sng.bots_basic", "RandomSng"),
    "station0": ("sng.bots_basic", "StationSng"),
    "push": ("sng.bots_basic", "PushSng"),
}


def _register_optional():
    for mod in ("sng.field.registry", "sng.field2.registry", "sng.ours.registry"):
        try:
            m = importlib.import_module(mod)
        except ImportError:
            continue
        BOTS.update(getattr(m, "BOTS", {}))


_register_optional()

FIELDS = {
    # equal-weight fallback until the field package registers its own mixes
    "basic": [("random", 1.0), ("station0", 1.0), ("push", 1.0)],
}


def _val(v):
    for f in (int, float):
        try:
            return f(v)
        except ValueError:
            pass
    return v


def make(name: str):
    base, _, opts = name.partition(":")
    mod, cls = BOTS[base]
    kw = {k: _val(v) for k, v in (o.split("=", 1) for o in opts.split(";") if o)} if opts else {}
    return getattr(importlib.import_module(mod), cls)(**kw)


def field_weights(name: str):
    for mod in ("sng.field.registry", "sng.field2.registry"):
        try:
            m = importlib.import_module(mod)
            FIELDS.update(getattr(m, "FIELDS", {}))
        except ImportError:
            pass
    if name == "default" and "default" not in FIELDS:
        name = "basic"
    return FIELDS[name]
