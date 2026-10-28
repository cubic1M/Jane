"""Robustness drill: plausible day-of bugs in the rules mapping.

The engine still enforces the true rules (legal actions come from the engine);
only what the bot BELIEVES is corrupted, as if our adapter layer were wrong.

Bugs (each tested on the variant where it is plausible):
  posflip  (a) adapter swaps blind order: bot is told SB when it is BB and vice versa
  usage    (d) Omaha "exactly 2" mapped as hold'em "any 5 of hole+board"
  ranking  (e) short deck mapped with standard hand rankings / straights
  depth    (f) 20bb game mapped with the default 100bb spec (forgot to change it)
  muck     (c) face-up discard to board mapped as a face-down discard to muck

Metric: bb/hand of the bugged bot against its own clean version (0 = harmless),
plus error/illegal counts (a bot that crashes folds every hand: collapse).

    python -m experiments.robustness [--pairs 6] [--hands 1000] [--workers 3]
"""
from __future__ import annotations

import argparse
from dataclasses import replace

from engine.bot import Bot
from engine.spec import STANDARD_ORDER

BUGS = {
    "posflip": "a_nlhe100",
    "usage": "d_omaha4x2",
    "ranking": "e_shortdeck",
    "depth": "f_nlhe20",
    "muck": "c_discard3",
}


def corrupt_spec(spec, bug):
    from engine.variants import get_variant
    if bug == "usage":
        return replace(spec, hole_usage="any")
    if bug == "ranking":
        return replace(spec, category_order=STANDARD_ORDER)
    if bug == "depth":
        return get_variant("a_nlhe100")
    if bug == "muck":
        return replace(spec, discards=tuple(replace(d, to_board=False, face_up=False) for d in spec.discards))
    return spec


class Miswired(Bot):
    def __init__(self, inner, bug: str):
        self.inner = inner
        self.bug = bug
        self.name = f"{inner.name}!{bug}"

    def new_match(self, spec, seed=0):
        super().new_match(spec, seed)
        self.inner.new_match(corrupt_spec(spec, self.bug), seed)

    def act(self, obs):
        if self.bug == "posflip":
            obs = replace(obs, position=1 - obs.position)
        return self.inner.act(obs)

    def end_hand(self, result):
        if self.bug == "posflip":
            result = replace(result, position=1 - result.position)
        self.inner.end_hand(result)

    def end_match(self):
        self.inner.end_match()


def main(argv=None):
    from experiments.common import run_jobs
    ap = argparse.ArgumentParser()
    ap.add_argument("--bots", default="equity,balanced,adaptive,preflop_cfr@15m,full_cfr@30m,adaptive_cfr@15m")
    ap.add_argument("--bugs", default=",".join(BUGS))
    ap.add_argument("--pairs", type=int, default=6)
    ap.add_argument("--hands", type=int, default=1000)
    ap.add_argument("--workers", type=int, default=3)
    a = ap.parse_args(argv)
    jobs = []
    for bug in a.bugs.split(","):
        v = BUGS[bug]
        for bot in a.bots.split(","):
            for k in range(a.pairs):
                jobs.append(dict(exp="robustness", variant=v, a=f"{bot}!{bug}", b=bot,
                                 seed=50_000 + k, hands=a.hands))
    run_jobs(jobs, workers=a.workers, label="robustness")


if __name__ == "__main__":
    main()
