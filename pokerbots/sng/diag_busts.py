"""How does a bot bust? Classify the hand it busted in by its own decisive action.

    python3 -m sng.diag_busts --bot icm_tag --tables 300
"""
from __future__ import annotations

import argparse
import random
from collections import Counter

from sng.registry import field_weights, make
from sng.rules import SngRules
from sng.table import play_table


class Spy:
    def __init__(self, inner, log):
        self.inner, self.log = inner, log

    def new_table(self, rules, seat, seed=0):
        self.seat = seat
        self.last = None
        self.inner.new_table(rules, seat, seed)

    def act(self, obs):
        a = self.inner.act(obs)
        self.last = (obs.street, a.kind, obs.legal.call_amount, obs.my_stack, obs.big_blind, obs.players_left,
                     bool(obs.legal.can_raise) and a.kind == "raise" and a.amount == obs.legal.max_raise_to)
        return a

    def end_hand(self, info):
        if info["stacks"][self.seat] == 0 and info["deltas"][self.seat] < 0 and self.last:
            st, kind, call, stack, bb, left, shove = self.last
            what = ("shove" if shove else kind) + ("_pre" if st == 0 else "_post")
            depth = "<=10bb" if stack <= 10 * bb else "10-25bb" if stack <= 25 * bb else ">25bb"
            self.log.append((what, depth, left, info["hand_number"]))
        if hasattr(self.inner, "end_hand"):
            self.inner.end_hand(info)


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--bot", default="icm_tag")
    ap.add_argument("--tables", type=int, default=300)
    ap.add_argument("--field", default="default")
    a = ap.parse_args(argv)
    rules = SngRules()
    names, w = zip(*field_weights(a.field))
    log = []
    for t in range(a.tables):
        rng = random.Random(t)
        lineup = rng.choices(names, weights=w, k=7)
        s = t % 8
        bots = [make(x) for x in lineup[:s]] + [Spy(make(a.bot), log)] + [make(x) for x in lineup[s:]]
        play_table(bots, rules, seed=500000 + t)
    print(f"{a.bot}: {len(log)} busts in {a.tables} tables")
    for k, n in Counter((w, d) for w, d, _, _ in log).most_common():
        print(f"  {k[0]:12s} {k[1]:8s} {n:4d}")
    early = sum(1 for *_, h in log if h < 50)
    print(f"  busted before hand 50: {early}; with 6+ players left: {sum(1 for _, _, l, _ in log if l >= 6)}")


if __name__ == "__main__":
    main()
