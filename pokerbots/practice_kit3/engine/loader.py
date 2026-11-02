"""Load a single-file bot. Every call of the returned factory executes the file
again in a brand-new module, so module globals never survive from one table to
the next (the tournament does the same: bot state resets per table)."""

import os
import types

_counter = [0]


def load_factory(path):
    path = os.path.abspath(path)
    with open(path, "rb") as f:
        source = f.read()
    code = compile(source, path, "exec")
    base = os.path.splitext(os.path.basename(path))[0]

    def factory():
        _counter[0] += 1
        mod = types.ModuleType("kit3bot_%s_%d" % (base, _counter[0]))
        mod.__file__ = path
        exec(code, mod.__dict__)
        cls = getattr(mod, "Agent", None)
        if cls is None:
            raise AttributeError("%s defines no class named Agent" % path)
        return cls()

    return factory


def bot_name(path):
    return os.path.splitext(os.path.basename(path))[0]
