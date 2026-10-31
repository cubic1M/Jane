"""opp_quick: the bot a team ships when the 60 minutes go badly. Simple but competent.

Preflop: equity vs a random hand, compared with thresholds by position that are
calibrated per variant (quantiles of random hands' equities, so Omaha's compressed
equities work too). Postflop: Monte Carlo equity vs a random hand; bet 2/3 pot when
equity > 0.65, call when equity beats the pot odds, else check/fold.
Discards: the option with the best equity.
"""
from __future__ import annotations

import numpy as np

from engine.bot import Bot
from engine.equity import get_equity_model
from engine.game import Call, Check, Discard, Fold, RaiseTo

_QUANTILES: dict = {}   # spec -> preflop equity quantiles of random hands


def _calibrate(spec, m, n):
    q = _QUANTILES.get(spec)
    if q is None:
        rng = np.random.default_rng(7)
        deck = np.array(spec.deck)
        eqs = [m.preflop_equity(tuple(int(c) for c in rng.choice(deck, spec.hole_cards, replace=False)), n=n)
               for _ in range(120)]
        q = _QUANTILES[spec] = np.quantile(eqs, np.linspace(0, 1, 101))
    return q


class QuickBot(Bot):
    name = "opp_quick"

    def new_match(self, spec, seed=0):
        super().new_match(spec, seed)
        self.np_rng = np.random.default_rng(seed)
        self.m = get_equity_model(spec)
        ms = self.m.ms_per_sample()
        budget = 4.0 if not spec.time_per_decision else min(4.0, 150 * spec.time_per_decision)
        self.n = int(np.clip(budget / ms, 50, 1500))
        self.n_pre = int(np.clip(round(5.0 / ms, -2), 100, 1200))
        self.q = _calibrate(spec, self.m, self.n_pre)

    def pct(self, eq):   # equity -> percentile of random hands (0..100)
        return float(np.searchsorted(self.q, eq))

    def act(self, obs):
        lg = obs.legal
        if lg.discard_count:
            k = lg.discard_count
            n = max(30, self.n // max(1, len(obs.my_cards)))
            opts = self.m.discard_options(obs, n=n, rng=self.np_rng)
            return Discard(opts[0][0]) if opts else Discard(obs.my_cards[:k])
        pot, call = obs.pot, lg.call_amount
        if obs.street == 0:
            return self.preflop(obs, pot, call)
        eq = self.m.equity_obs(obs, n=self.n, rng=self.np_rng)
        if eq > 0.65 and lg.can_raise:
            return self.bet(obs, 2 / 3)
        if call == 0:
            return Check()
        return Call() if eq > call / (pot + call) else Fold()

    def preflop(self, obs, pot, call):
        lg = obs.legal
        p = self.pct(self.m.preflop_equity(obs.my_cards, n=self.n_pre))
        raises = sum(1 for r in obs.history if r.street == 0 and r.kind == "raise")
        # position thresholds (percentile of hand strength): button opens wide, BB defends
        if obs.position == 0:
            open_t, call_t = 45, 20
        else:
            open_t, call_t = 70, 35
        open_t, call_t = open_t + 15 * raises, call_t + 15 * raises
        if p >= min(open_t, 92) and lg.can_raise and raises < 3:
            return self.bet(obs, 1.0 if raises else 0.75)
        if call == 0:
            return Check()
        if p >= min(call_t, 90) or (call <= obs.big_blind and p >= 15):
            return Call()
        if p >= 85:
            return Call()
        return Fold()

    def bet(self, obs, frac):
        lg = obs.legal
        mx = max(obs.my_pip, obs.opp_pip)
        return RaiseTo(lg.clamp_raise(mx + frac * (obs.pot + lg.call_amount)))


def make_bot(**kw):
    return QuickBot()
