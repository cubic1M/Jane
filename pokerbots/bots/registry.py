"""Name -> bot factory. Modules are imported lazily so one broken bot does not
break the others. Each bot module exposes make_bot(**kwargs) -> Bot."""
from __future__ import annotations

import importlib

# name: (module, kwargs)
BOTS = {
    "random_legal": ("bots.random_legal", {}),
    "equity": ("bots.equity_heuristic", {}),
    "balanced": ("bots.balanced", {}),
    "adaptive": ("bots.adaptive", {}),
    "preflop_cfr": ("bots.preflop_cfr", {}),
    "full_cfr": ("bots.full_cfr", {}),
    "adaptive_cfr": ("bots.adaptive_cfr", {}),
    "hybrid": ("bots.hybrid", {}),
    "push": ("bots.dummies", {"kind": "push"}),
    "station": ("bots.dummies", {"kind": "station"}),
    "maniac": ("bots.dummies", {"kind": "maniac"}),
}


def make(name: str, **kw):
    """make('balanced'), make('preflop_cfr', budget='15m'), make('balanced+lp') for lead protection."""
    lead = name.endswith("+lp")
    base = name[:-3] if lead else name
    mod, defaults = BOTS[base]
    m = importlib.import_module(mod)
    bot = m.make_bot(**{**defaults, **kw})
    if lead:
        from bots.lead_protection import LeadProtection
        bot = LeadProtection(bot)
    return bot
