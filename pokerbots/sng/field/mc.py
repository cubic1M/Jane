"""Monte Carlo equity bots: what most teams get when they ask Codex for "a poker bot".

Both compute equity against random hands for every live opponent, then play pot odds
against the fair share 1/(k+1) of k live opponents:
  * equity >= min(0.70, 2.0 x fair): raise (3bb open / 3x re-raise preflop, 3/4 pot
    postflop);  equity >= min(0.60, 1.5 x fair) and nobody has bet: bet half the pot;
  * otherwise call when equity >= the pot odds (+ 2%), else check/fold.
Equity against random hands overrates hands against real (tighter) ranges: these bots
call too much against strength. That flaw is deliberate, it is what they look like.
"""
from __future__ import annotations

import time

from .common import FieldBot, bet_pot, fold, open_size, passive, reraise, situation
from .equity import McEquity

_CALIBRATION: dict = {}


class McEquityBot(FieldBot):
    """Fixed sample count (default 200), no clock. A single batched evaluation of
    200 deals x (k+1) hands takes ~0.4-0.6 ms heads-up but 1-3 ms multiway (and
    ~2-25 ms on 4-card Omaha), so under the real 1 ms rule it is often auto-folded or
    auto-checked. mc_slow in field_mix is the same bot with 1000 samples."""
    name = "mc_equity"
    raise_mult, raise_cap, bet_mult, bet_cap, call_margin = 2.0, 0.70, 1.5, 0.60, 0.02

    def __init__(self, samples: int = 200):
        self.samples = samples

    def reset(self):
        self.mc = McEquity(self.spec, self.rng.randrange(1 << 30))

    def equity(self, obs, sit):
        return self.mc.fixed(obs.hole, obs.board, sit.opps, self.samples)

    def act(self, obs):
        sit = situation(obs)
        return self.decide(obs, sit, self.equity(obs, sit))

    def decide(self, obs, sit, eq):
        lg = obs.legal
        fair = 1.0 / (max(1, sit.opps) + 1)
        if eq >= min(self.raise_cap, self.raise_mult * fair) and lg.can_raise:
            if obs.street == 0:
                return open_size(obs, sit, 3) if sit.raises == 0 else reraise(obs, sit, 3)
            return bet_pot(obs, 0.75)
        if eq >= min(self.bet_cap, self.bet_mult * fair) and lg.can_check and lg.can_raise:
            if obs.street == 0:
                return open_size(obs, sit, 2.5)
            return bet_pot(obs, 0.5)
        if lg.can_check:
            return passive(obs)
        if eq >= sit.price + self.call_margin:
            return passive(obs)
        return fold(obs)


class McFastBot(McEquityBot):
    """Same decision rule, but sampling is time-boxed with perf_counter: batches are
    sized from a per-machine calibration and sampling stops before `budget` seconds
    (default 0.25 ms), so it stays under the 1 ms limit. With no time for even one
    deal it falls back to a rough equity guessed from the preflop rank."""
    name = "mc_fast"

    def __init__(self, budget: float = 0.00025, max_samples: int = 2000):
        self.budget = budget
        self.max_samples = max_samples

    def reset(self):
        super().reset()
        key = self.spec
        if key not in _CALIBRATION:
            _CALIBRATION[key] = self.mc.calibrate()
        overhead, self.cost = _CALIBRATION[key]
        self.overhead = 1.3 * overhead + 2e-5

    def act(self, obs):
        self._t0 = time.perf_counter()          # the clock starts when the decision does
        return super().act(obs)

    def equity(self, obs, sit):
        eq, _n, self.cost = self.mc.timeboxed(obs.hole, obs.board, sit.opps, self._t0, self.budget,
                                               self.cost, self.overhead, self.max_samples)
        if eq is not None:
            return eq
        # fallback: a rough equity from the preflop rank (top fraction) vs k opponents
        top = self.ranker.top(obs.hole)
        return max(0.05, (1 - top)) ** max(1, sit.opps) * 0.6 + 0.2 / (max(1, sit.opps) + 1)
