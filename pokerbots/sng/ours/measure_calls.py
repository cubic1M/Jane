"""Measure how often a field calls a lone preflop all-in, by situation.

Every bot at the table is wrapped; whenever one faces exactly one voluntary preflop
action, an all-in raise, it records (players in the hand, depth bucket, its position,
the shover's position, called?). The probe seat shoves wide when short so there are
enough shoves to measure. Output: cache/sng/callfreq_<field>.json, read by the
best-response chart builder (sng/ours/pushfold.py: best_response_charts).

    python3 -m sng.ours.measure_calls --field blend --tables 600
"""
from __future__ import annotations

import argparse
import json
import multiprocessing as mp
import random
from collections import defaultdict

from sng.ours.pushfold import CACHE, DEPTHS
from sng.ours.pushfold_chart import Chart
from sng.registry import field_weights, make
from sng.rules import SngRules
from sng.table import play_table


def _depth(eff_bb):
    return min(DEPTHS, key=lambda d: abs(d - eff_bb))


class Rec:
    def __init__(self, inner, log):
        self.inner, self.log = inner, log

    def new_table(self, rules, seat, seed=0):
        self.inner.new_table(rules, seat, seed)

    def end_hand(self, info):
        if hasattr(self.inner, "end_hand"):
            self.inner.end_hand(info)

    def act(self, obs):
        a = self.inner.act(obs)
        if obs.street == 0 and obs.history and not getattr(obs.legal, "discard_count", 0):
            vol = [h for h in obs.history if h[1] == 0 and h[2] in ("call", "raise")]
            if len(vol) == 1 and vol[0][2] == "raise" and obs.seats[vol[0][0]].all_in:
                order = Chart._order(obs)
                r = vol[0][0]
                if obs.seat in order and r in order and 2 <= len(order) <= 8:
                    shove = obs.seats[r].committed
                    eff = min(obs.my_stack + obs.my_bet, shove) / obs.big_blind
                    self.log.append((len(order), _depth(eff), order.index(obs.seat), order.index(r),
                                     int(a.kind == "call")))
        return a


class WideShover:
    """Probe: plays icm_tag but shoves first-in with ~40% of hands at <= 20bb."""

    def __init__(self):
        self.inner = make("icm_tag")

    def new_table(self, rules, seat, seed=0):
        self.inner.new_table(rules, seat, seed)
        self.rng = random.Random(seed)

    def end_hand(self, info):
        self.inner.end_hand(info)

    def act(self, obs):
        lg = obs.legal
        if obs.street == 0 and lg.can_raise and not [h for h in obs.history if h[1] == 0 and h[2] in ("call", "raise")]:
            if (obs.my_stack + obs.my_bet) <= 20 * obs.big_blind and self.rng.random() < 0.4:
                from engine.game import RaiseTo
                return RaiseTo(lg.max_raise_to)
        return self.inner.act(obs)


def _job(args):
    t, field, seed0 = args
    rng = random.Random(seed0 + t)
    names, w = zip(*field)
    lineup = rng.choices(names, weights=w, k=7)
    log = []
    bots = [Rec(make(x), log) for x in lineup]
    bots.insert(t % 8, WideShover())
    play_table(bots, SngRules(), seed=seed0 * 1000 + t)
    return log


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--field", default="blend")
    ap.add_argument("--tables", type=int, default=600)
    ap.add_argument("--workers", type=int, default=3)
    ap.add_argument("--seed0", type=int, default=777)
    a = ap.parse_args(argv)
    field = field_weights(a.field)
    with mp.Pool(a.workers) as pool:
        logs = pool.map(_job, [(t, field, a.seed0) for t in range(a.tables)])
    acc = defaultdict(lambda: [0, 0])
    for log in logs:
        for n, d, me, r, called in log:
            acc[f"{n},{d},{me},{r}"][0] += called
            acc[f"{n},{d},{me},{r}"][1] += 1
    out = {k: v for k, v in acc.items()}
    path = CACHE / f"callfreq_{a.field}.json"
    path.write_text(json.dumps(out))
    tot = sum(v[1] for v in out.values())
    called = sum(v[0] for v in out.values())
    print(f"{path.name}: {tot} shoves faced, overall call rate {called / max(1, tot):.3f}, {len(out)} cells")


if __name__ == "__main__":
    main()
